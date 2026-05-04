const express = require("express");
const { spawn } = require("child_process");
const path = require("path");
const fs = require("fs");

const PORT = 9000;
const ROOT = __dirname;
const YT_DLP = path.join(ROOT, "yt-dlp.exe");
const DOWNLOAD_DIR = ROOT;

if (!fs.existsSync(YT_DLP)) {
  console.error(`yt-dlp.exe not found at ${YT_DLP}`);
  process.exit(1);
}

// Preset definitions. Keys are referenced by the frontend via ?preset=<key>.
// MP4 presets prefer pre-merged single-file MP4 (no ffmpeg needed), falling
// back to separate streams that get merged via --merge-output-format mp4
// (which DOES require ffmpeg).
// MP3 presets always require ffmpeg.
const PRESETS = {
  mp4_best:  { label: "MP4 Best",  args: ["-f", "bv*[ext=mp4]+ba[ext=m4a]/b[ext=mp4]/bv*+ba/b", "--merge-output-format", "mp4"] },
  mp4_1080:  { label: "MP4 1080p", args: ["-f", "bv*[ext=mp4][height<=1080]+ba[ext=m4a]/b[ext=mp4][height<=1080]/bv*[height<=1080]+ba/b[height<=1080]", "--merge-output-format", "mp4"] },
  mp4_720:   { label: "MP4 720p",  args: ["-f", "bv*[ext=mp4][height<=720]+ba[ext=m4a]/b[ext=mp4][height<=720]/bv*[height<=720]+ba/b[height<=720]", "--merge-output-format", "mp4"] },
  mp4_480:   { label: "MP4 480p",  args: ["-f", "bv*[ext=mp4][height<=480]+ba[ext=m4a]/b[ext=mp4][height<=480]/bv*[height<=480]+ba/b[height<=480]", "--merge-output-format", "mp4"] },
  mp4_360:   { label: "MP4 360p",  args: ["-f", "bv*[ext=mp4][height<=360]+ba[ext=m4a]/b[ext=mp4][height<=360]/bv*[height<=360]+ba/b[height<=360]", "--merge-output-format", "mp4"] },
  mp3_high:  { label: "MP3 High (~245kbps)", args: ["-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "0"] },
  mp3_low:   { label: "MP3 Low (~85kbps)",   args: ["-f", "bestaudio/best", "--extract-audio", "--audio-format", "mp3", "--audio-quality", "7"] },
};

// Check ffmpeg availability — needed for MP3 conversion and MP4 merging.
// yt-dlp auto-detects ffmpeg.exe in its own directory, so we check there first
// (no system install required), then fall back to PATH.
function checkFfmpeg() {
  const local = path.join(ROOT, "ffmpeg.exe");
  if (fs.existsSync(local)) return Promise.resolve(true);
  return new Promise((resolve) => {
    const p = spawn("ffmpeg", ["-version"], { stdio: "ignore" });
    p.on("error", () => resolve(false));
    p.on("exit", (code) => resolve(code === 0));
  });
}

const app = express();
app.use(express.json());
app.use(express.static(path.join(ROOT, "public")));

function isHttpUrl(s) {
  if (typeof s !== "string") return false;
  try {
    const u = new URL(s);
    return u.protocol === "http:" || u.protocol === "https:";
  } catch {
    return false;
  }
}

// Run yt-dlp and collect stdout into a string. Used for -J (info dump).
function runYtDlpJson(url) {
  return new Promise((resolve, reject) => {
    const proc = spawn(YT_DLP, ["-J", "--no-warnings", url], { cwd: DOWNLOAD_DIR });
    let stdout = "";
    let stderr = "";
    proc.stdout.on("data", (d) => (stdout += d.toString()));
    proc.stderr.on("data", (d) => (stderr += d.toString()));
    proc.on("error", reject);
    proc.on("close", (code) => {
      if (code !== 0) {
        const tail = stderr.trim().split(/\r?\n/).slice(-5).join("\n");
        return reject(new Error(tail || `yt-dlp exited with code ${code}`));
      }
      try {
        resolve(JSON.parse(stdout));
      } catch (e) {
        reject(new Error("Could not parse yt-dlp JSON output"));
      }
    });
  });
}

function simplifyFormats(info) {
  const formats = (info.formats || []).map((f) => {
    const hasVideo = f.vcodec && f.vcodec !== "none";
    const hasAudio = f.acodec && f.acodec !== "none";
    let type = "other";
    if (hasVideo && hasAudio) type = "combined";
    else if (hasVideo) type = "video";
    else if (hasAudio) type = "audio";
    return {
      id: f.format_id,
      type,
      ext: f.ext,
      resolution: f.resolution || (f.height ? `${f.width}x${f.height}` : ""),
      fps: f.fps || null,
      vcodec: f.vcodec === "none" ? "" : f.vcodec || "",
      acodec: f.acodec === "none" ? "" : f.acodec || "",
      abr: f.abr || null,
      filesize: f.filesize || f.filesize_approx || null,
      note: f.format_note || "",
    };
  });
  return {
    title: info.title || "",
    duration: info.duration || null,
    uploader: info.uploader || "",
    formats,
  };
}

app.post("/api/formats", async (req, res) => {
  const { url } = req.body || {};
  if (!isHttpUrl(url)) {
    return res.status(400).json({ error: "Invalid URL" });
  }
  try {
    const info = await runYtDlpJson(url);
    res.json(simplifyFormats(info));
  } catch (e) {
    res.status(400).json({ error: e.message });
  }
});

// SSE download endpoint.
app.get("/api/download", (req, res) => {
  const { url, format, preset } = req.query;
  if (!isHttpUrl(url)) {
    res.status(400).json({ error: "Invalid URL" });
    return;
  }

  // Resolve which yt-dlp args to use: preset wins if provided, else format string.
  let selectionArgs;
  if (typeof preset === "string" && PRESETS[preset]) {
    selectionArgs = PRESETS[preset].args;
  } else {
    const fmt = (typeof format === "string" && format.trim()) || "bestvideo+bestaudio";
    selectionArgs = ["-f", fmt];
  }

  res.set({
    "Content-Type": "text/event-stream",
    "Cache-Control": "no-cache",
    Connection: "keep-alive",
    "X-Accel-Buffering": "no",
  });
  res.flushHeaders();

  const send = (event, data) => {
    res.write(`event: ${event}\n`);
    res.write(`data: ${JSON.stringify(data)}\n\n`);
  };

  const progressTpl =
    "PROGRESS:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.total_bytes_estimate)s/%(progress.speed)s/%(progress.eta)s/%(progress.status)s";

  const args = [
    ...selectionArgs,
    "--newline",
    "--no-warnings",
    "--progress-template", progressTpl,
    "-o", "%(title)s [%(id)s].%(ext)s",
    url,
  ];

  const proc = spawn(YT_DLP, args, { cwd: DOWNLOAD_DIR });

  let lastFile = null;
  let stderrBuf = "";
  let stdoutLeftover = "";

  const handleLine = (line) => {
    if (!line) return;
    if (line.startsWith("PROGRESS:")) {
      const parts = line.slice("PROGRESS:".length).split("/");
      const [downloaded, total, totalEst, speed, eta, status] = parts;
      const num = (s) => {
        if (!s || s === "NA") return null;
        const n = Number(s);
        return Number.isFinite(n) ? n : null;
      };
      send("progress", {
        downloaded: num(downloaded),
        total: num(total) || num(totalEst),
        speed: num(speed),
        eta: num(eta),
        status: status || "downloading",
      });
      return;
    }
    // Capture filenames from yt-dlp's various output lines.
    const dest = line.match(/^\[download\] Destination: (.+)$/);
    if (dest) lastFile = path.basename(dest[1].trim());
    const already = line.match(/^\[download\] (.+) has already been downloaded$/);
    if (already) lastFile = path.basename(already[1].trim());
    const merger = line.match(/^\[Merger\] Merging formats into "(.+)"$/);
    if (merger) lastFile = path.basename(merger[1].trim());
    send("log", { line });
  };

  proc.stdout.on("data", (chunk) => {
    const text = stdoutLeftover + chunk.toString();
    const lines = text.split(/\r?\n/);
    stdoutLeftover = lines.pop(); // last (possibly partial) line saved for next chunk
    for (const ln of lines) handleLine(ln);
  });

  proc.stderr.on("data", (chunk) => {
    const text = chunk.toString();
    stderrBuf += text;
    // Forward stderr lines to the log stream too — useful info often goes there.
    for (const ln of text.split(/\r?\n/)) {
      if (ln.trim()) send("log", { line: ln, stderr: true });
    }
  });

  proc.on("error", (e) => {
    send("error", { message: e.message });
    res.end();
  });

  proc.on("close", (code) => {
    if (stdoutLeftover) handleLine(stdoutLeftover);
    if (code === 0) {
      send("done", { file: lastFile });
    } else {
      const tail = stderrBuf.trim().split(/\r?\n/).slice(-5).join("\n");
      send("error", { message: tail || `yt-dlp exited with code ${code}` });
    }
    res.end();
  });

  // If the client disconnects mid-download, kill the child.
  req.on("close", () => {
    if (!proc.killed && proc.exitCode === null) {
      proc.kill();
    }
  });
});

app.post("/api/open-folder", (req, res) => {
  // Windows: `start "" "<path>"` opens the folder in Explorer.
  spawn("cmd", ["/c", "start", "", DOWNLOAD_DIR], { detached: true, stdio: "ignore" }).unref();
  res.json({ ok: true, path: DOWNLOAD_DIR });
});

// Cache ffmpeg-presence between calls (it doesn't change at runtime).
let ffmpegAvailable = null;
app.get("/api/health", async (req, res) => {
  if (ffmpegAvailable === null) {
    ffmpegAvailable = await checkFfmpeg();
  }
  res.json({ ffmpeg: ffmpegAvailable, presets: Object.fromEntries(Object.entries(PRESETS).map(([k, v]) => [k, { label: v.label }])) });
});

app.post("/api/shutdown", (req, res) => {
  res.json({ ok: true });
  // Give the response a moment to flush, then exit.
  setTimeout(() => {
    console.log("Shutdown requested by client. Exiting.");
    process.exit(0);
  }, 200);
});

app.listen(PORT, () => {
  console.log(`yt-dlp web UI running at http://localhost:${PORT}`);
  console.log(`Downloads will be saved to: ${DOWNLOAD_DIR}`);
  checkFfmpeg().then((has) => {
    ffmpegAvailable = has;
    if (!has) {
      console.warn("");
      console.warn("WARNING: ffmpeg not found in PATH.");
      console.warn("  - MP3 presets will fail (need ffmpeg for audio conversion)");
      console.warn("  - MP4 1080p / Best may fail (need ffmpeg for merging high-quality streams)");
      console.warn("  - MP4 720p / 480p / 360p will work in most cases (single-file MP4)");
      console.warn("  Install ffmpeg: https://ffmpeg.org/download.html");
      console.warn("  Or via winget: winget install Gyan.FFmpeg");
      console.warn("");
    }
  });
});
