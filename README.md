# yt-dlp Web UI

A simple local web page that wraps `yt-dlp.exe`. Paste a URL, pick a preset (MP4 / MP3 at various qualities) or browse all formats, and watch the progress bar.

## Features

- One-click MP4 presets: Best, 1080p, 720p, 480p, 360p
- One-click MP3 presets: High (~245 kbps) / Low (~85 kbps)
- Full format table for advanced selection (custom format strings supported)
- Live progress bar via Server-Sent Events
- Stop button to cancel an in-progress download
- Shutdown button to cleanly stop the server
- Light / dark theme toggle (light by default, choice persisted)

## Setup

This repo doesn't ship the binaries — you need to drop them next to the source.

1. Clone this repo.
2. Download `yt-dlp.exe` from <https://github.com/yt-dlp/yt-dlp/releases/latest> and place it in the project root.
3. Download `ffmpeg.exe` (and `ffprobe.exe`) from the official yt-dlp ffmpeg builds at <https://github.com/yt-dlp/FFmpeg-Builds/releases/latest> — grab `ffmpeg-master-latest-win64-gpl.zip`, extract `bin/ffmpeg.exe` and `bin/ffprobe.exe` into the project root.
   - Required for MP3 conversion and merging high-quality MP4 (1080p+).
   - Without it, only MP4 360p / 720p (single-file streams) will work.
4. Make sure Node.js is installed (`node --version` should be 18+).

Your project folder should look like:

```
yt-dlp-youtube-downloader/
├── ffmpeg.exe        (you add this)
├── ffprobe.exe       (you add this)
├── yt-dlp.exe        (you add this)
├── server.js
├── package.json
├── start.bat
├── public/
└── ...
```

## Run it

Double-click [`start.bat`](start.bat). On first launch it runs `npm install`, then starts the server on `http://localhost:9000` and opens the page in your default browser.

Or from a terminal:

```
npm install
npm start
```

Then visit <http://localhost:9000>.

## How it works

- `server.js` — Express server. Spawns `yt-dlp.exe` for each request and streams progress back via Server-Sent Events. Detects local `ffmpeg.exe` and shows a banner if it's missing.
- `public/` — vanilla HTML/CSS/JS frontend, no build step.
- Downloads land in the project root, named `<title> [<id>].<ext>`.

## Stop it

Click the Shutdown button in the page header, or close the terminal window opened by `start.bat`, or press Ctrl+C in that terminal.

## Design doc

See [`docs/superpowers/specs/2026-05-04-yt-dlp-web-ui-design.md`](docs/superpowers/specs/2026-05-04-yt-dlp-web-ui-design.md) for the architecture and decisions behind the tool.
