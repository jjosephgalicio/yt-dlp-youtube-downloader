const $ = (id) => document.getElementById(id);

const els = {
  url: $("url"),
  fetchBtn: $("fetch-btn"),
  urlError: $("url-error"),
  formatsSection: $("formats-section"),
  videoTitle: $("video-title"),
  videoUploader: $("video-uploader"),
  videoDuration: $("video-duration"),
  formatsBody: $("formats-body"),
  customFormat: $("custom-format"),
  customBtn: $("custom-btn"),
  downloadSection: $("download-section"),
  selectedFormat: $("selected-format"),
  startBtn: $("start-btn"),
  stopBtn: $("stop-btn"),
  shutdownBtn: $("shutdown-btn"),
  themeBtn: $("theme-btn"),
  barFill: $("bar-fill"),
  statPct: $("stat-pct"),
  statBytes: $("stat-bytes"),
  statSpeed: $("stat-speed"),
  statEta: $("stat-eta"),
  statStatus: $("stat-status"),
  log: $("log"),
  result: $("result"),
};

let currentEventSource = null;
// Selection is either { kind: "format", value: "<yt-dlp -f string>" }
// or { kind: "preset", value: "<preset-key>", label: "<display>" }.
let selection = null;

function showError(msg) {
  els.urlError.textContent = msg;
  els.urlError.classList.remove("hidden");
}

function clearError() {
  els.urlError.classList.add("hidden");
  els.urlError.textContent = "";
}

function fmtBytes(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  const units = ["B", "KB", "MB", "GB", "TB"];
  let i = 0;
  let v = n;
  while (v >= 1024 && i < units.length - 1) { v /= 1024; i++; }
  return `${v.toFixed(v < 10 && i > 0 ? 2 : 1)} ${units[i]}`;
}

function fmtSpeed(n) {
  if (n == null || !Number.isFinite(n)) return "—";
  return `${fmtBytes(n)}/s`;
}

function fmtEta(s) {
  if (s == null || !Number.isFinite(s)) return "—";
  const m = Math.floor(s / 60);
  const sec = Math.floor(s % 60);
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function fmtDuration(s) {
  if (!s) return "";
  const h = Math.floor(s / 3600);
  const m = Math.floor((s % 3600) / 60);
  const sec = Math.floor(s % 60);
  if (h) return `${h}:${m.toString().padStart(2, "0")}:${sec.toString().padStart(2, "0")}`;
  return `${m}:${sec.toString().padStart(2, "0")}`;
}

function setLoading(btn, loading) {
  btn.disabled = loading;
  btn.dataset.originalText = btn.dataset.originalText || btn.textContent;
  btn.textContent = loading ? "Loading…" : btn.dataset.originalText;
}

async function fetchFormats() {
  const url = els.url.value.trim();
  if (!url) return showError("Please enter a URL.");
  clearError();
  els.formatsSection.classList.add("hidden");
  els.downloadSection.classList.add("hidden");
  setLoading(els.fetchBtn, true);

  try {
    const res = await fetch("/api/formats", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "Failed to fetch formats");
    renderFormats(data);
  } catch (e) {
    showError(e.message);
  } finally {
    setLoading(els.fetchBtn, false);
  }
}

function renderFormats(data) {
  els.videoTitle.textContent = data.title || "(no title)";
  els.videoUploader.textContent = data.uploader || "";
  els.videoDuration.textContent = data.duration ? fmtDuration(data.duration) : "";

  const tbody = els.formatsBody;
  tbody.innerHTML = "";

  // Synthetic recommended row at top
  const rec = document.createElement("tr");
  rec.className = "recommended";
  rec.innerHTML = `
    <td>bestvideo+bestaudio</td>
    <td>combined</td>
    <td>best</td>
    <td>—</td>
    <td>—</td>
    <td>—</td>
    <td>recommended</td>
    <td><button class="secondary" data-fmt="bestvideo+bestaudio">Pick</button></td>
  `;
  tbody.appendChild(rec);

  // Sort: video (highest res first), then combined, then audio
  const sorted = [...data.formats].sort((a, b) => {
    const order = { video: 0, combined: 1, audio: 2, other: 3 };
    if (order[a.type] !== order[b.type]) return order[a.type] - order[b.type];
    const ah = parseInt(a.resolution) || 0;
    const bh = parseInt(b.resolution) || 0;
    return bh - ah;
  });

  for (const f of sorted) {
    const tr = document.createElement("tr");
    const codec = [f.vcodec, f.acodec].filter(Boolean).join(" / ") || "—";
    tr.innerHTML = `
      <td>${escapeHtml(f.id)}</td>
      <td>${f.type}</td>
      <td>${escapeHtml(f.resolution || "—")}</td>
      <td>${f.fps || "—"}</td>
      <td>${escapeHtml(codec)}</td>
      <td>${fmtBytes(f.filesize)}</td>
      <td>${escapeHtml(f.note || "")}</td>
      <td><button class="secondary" data-fmt="${escapeHtml(f.id)}">Pick</button></td>
    `;
    tbody.appendChild(tr);
  }

  tbody.querySelectorAll("button[data-fmt]").forEach((btn) => {
    btn.addEventListener("click", () => pickFormat(btn.dataset.fmt));
  });

  els.formatsSection.classList.remove("hidden");
}

function escapeHtml(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({
    "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;"
  }[c]));
}

function pickFormat(fmt) {
  setSelection({ kind: "format", value: fmt }, fmt);
}

function pickPreset(key, label) {
  setSelection({ kind: "preset", value: key, label }, label);
}

function setSelection(sel, displayText) {
  selection = sel;
  els.selectedFormat.textContent = displayText;
  els.downloadSection.classList.remove("hidden");
  els.startBtn.disabled = false;
  els.startBtn.textContent = "Start download";
  els.stopBtn.classList.add("hidden");
  els.barFill.style.width = "0%";
  els.barFill.classList.remove("done", "error");
  els.statPct.textContent = "0%";
  els.statBytes.textContent = "";
  els.statSpeed.textContent = "";
  els.statEta.textContent = "";
  els.statStatus.textContent = "";
  els.log.textContent = "";
  els.result.classList.add("hidden");
  els.result.className = "result hidden";
  els.downloadSection.scrollIntoView({ behavior: "smooth", block: "center" });
}

function startDownload() {
  if (!selection) return;
  const url = els.url.value.trim();
  if (!url) return;

  els.startBtn.disabled = true;
  els.startBtn.textContent = "Downloading…";
  els.stopBtn.classList.remove("hidden");
  els.barFill.classList.remove("done", "error");
  els.result.classList.add("hidden");
  els.log.textContent = "";

  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }

  const paramObj = { url };
  if (selection.kind === "preset") paramObj.preset = selection.value;
  else paramObj.format = selection.value;
  const params = new URLSearchParams(paramObj);
  const es = new EventSource(`/api/download?${params.toString()}`);
  currentEventSource = es;

  es.addEventListener("progress", (ev) => {
    const d = JSON.parse(ev.data);
    let pct = 0;
    if (d.total && d.downloaded) {
      pct = Math.min(100, (d.downloaded / d.total) * 100);
    }
    els.barFill.style.width = `${pct}%`;
    els.statPct.textContent = `${pct.toFixed(1)}%`;
    els.statBytes.textContent = `${fmtBytes(d.downloaded)} / ${fmtBytes(d.total)}`;
    els.statSpeed.textContent = fmtSpeed(d.speed);
    els.statEta.textContent = `ETA ${fmtEta(d.eta)}`;
    els.statStatus.textContent = d.status || "";
  });

  es.addEventListener("log", (ev) => {
    const d = JSON.parse(ev.data);
    const div = document.createElement("div");
    if (d.stderr) div.className = "stderr";
    div.textContent = d.line;
    els.log.appendChild(div);
    els.log.scrollTop = els.log.scrollHeight;
  });

  es.addEventListener("done", (ev) => {
    const d = JSON.parse(ev.data);
    es.close();
    currentEventSource = null;
    els.barFill.style.width = "100%";
    els.barFill.classList.add("done");
    els.statPct.textContent = "100%";
    els.statStatus.textContent = "done";
    els.startBtn.disabled = false;
    els.startBtn.textContent = "Start download";
    els.stopBtn.classList.add("hidden");
    showResult(true, d.file);
  });

  es.addEventListener("error", (ev) => {
    let msg = "Download failed";
    try {
      if (ev.data) msg = JSON.parse(ev.data).message || msg;
    } catch {}
    es.close();
    currentEventSource = null;
    els.barFill.classList.add("error");
    els.statStatus.textContent = "error";
    els.startBtn.disabled = false;
    els.startBtn.textContent = "Start download";
    els.stopBtn.classList.add("hidden");
    showResult(false, msg);
  });
}

function stopDownload() {
  if (!currentEventSource) return;
  // Closing the EventSource drops the SSE connection; the server's
  // req.on("close") handler kills the yt-dlp subprocess.
  currentEventSource.close();
  currentEventSource = null;
  els.barFill.classList.add("error");
  els.statStatus.textContent = "stopped";
  els.startBtn.disabled = false;
  els.startBtn.textContent = "Start download";
  els.stopBtn.classList.add("hidden");
  showResult(false, "Download stopped by user.");
}

async function shutdownServer() {
  if (!confirm("Shut down the server? The page will stop working — relaunch with start.bat to use it again.")) {
    return;
  }
  if (currentEventSource) {
    currentEventSource.close();
    currentEventSource = null;
  }
  try {
    await fetch("/api/shutdown", { method: "POST" });
  } catch {
    // Server may close the connection before responding — that's expected.
  }
  document.body.innerHTML = `
    <main style="text-align:center; padding:80px 20px;">
      <h1 style="margin:0 0 12px;">Server stopped</h1>
      <p style="color:#9aa3ad;">Run <code>start.bat</code> in the YT DLP folder to launch it again.</p>
    </main>
  `;
}

function showResult(success, payload) {
  els.result.className = `result ${success ? "success" : "failure"}`;
  els.result.classList.remove("hidden");
  if (success) {
    els.result.innerHTML = `
      <div>
        <div class="label">Saved</div>
        <div class="filename">${escapeHtml(payload || "(unknown filename)")}</div>
      </div>
      <button id="open-folder-btn" class="secondary">Open folder</button>
    `;
    $("open-folder-btn").addEventListener("click", () => {
      fetch("/api/open-folder", { method: "POST" });
    });
  } else {
    els.result.innerHTML = `
      <div>
        <div class="label">Error</div>
        <div class="filename">${escapeHtml(payload)}</div>
      </div>
    `;
  }
}

els.fetchBtn.addEventListener("click", fetchFormats);
els.url.addEventListener("keydown", (e) => {
  if (e.key === "Enter") fetchFormats();
});
els.customBtn.addEventListener("click", () => {
  const v = els.customFormat.value.trim();
  if (v) pickFormat(v);
});
els.customFormat.addEventListener("keydown", (e) => {
  if (e.key === "Enter") {
    const v = els.customFormat.value.trim();
    if (v) pickFormat(v);
  }
});
els.startBtn.addEventListener("click", startDownload);
els.stopBtn.addEventListener("click", stopDownload);
els.shutdownBtn.addEventListener("click", shutdownServer);

els.themeBtn.addEventListener("click", () => {
  const current = document.documentElement.dataset.theme === "dark" ? "dark" : "light";
  const next = current === "dark" ? "light" : "dark";
  if (next === "dark") {
    document.documentElement.dataset.theme = "dark";
  } else {
    delete document.documentElement.dataset.theme;
  }
  try { localStorage.setItem("theme", next); } catch (e) { /* no-op */ }
});

// Preset buttons: each has data-preset and a label as its text.
document.querySelectorAll(".preset-btn[data-preset]").forEach((btn) => {
  btn.addEventListener("click", () => {
    const url = els.url.value.trim();
    if (!url) {
      showError("Please enter a URL first.");
      return;
    }
    clearError();
    const key = btn.dataset.preset;
    const label = btn.textContent.trim();
    const groupLabel = btn.closest(".presets-group")?.querySelector(".presets-label")?.textContent?.trim() || "";
    const display = groupLabel ? `${groupLabel} ${label}` : label;
    pickPreset(key, display);
    // For presets we start the download immediately — user already made their choice.
    startDownload();
  });
});

// Fetch health info on load: show ffmpeg warning banner if missing.
fetch("/api/health")
  .then((r) => r.json())
  .then((data) => {
    if (data && data.ffmpeg === false) {
      const w = document.getElementById("ffmpeg-warning");
      if (w) w.classList.remove("hidden");
    }
  })
  .catch(() => { /* health check is best-effort */ });
