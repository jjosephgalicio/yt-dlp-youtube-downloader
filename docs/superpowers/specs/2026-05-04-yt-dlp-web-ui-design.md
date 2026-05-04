# yt-dlp Web UI — Design

Date: 2026-05-04
Status: Approved (pending user review of this doc)

## Goal

A simple local web page that wraps the existing `yt-dlp.exe` so the user can paste a URL, pick a format, and download with a live progress bar — instead of typing the command in PowerShell.

## Scope

- **Local-only**: runs on `http://localhost:9000`, single user, no auth
- **Full format control**: lists every format yt-dlp reports and lets the user pick one (or paste a custom format string)
- **Live progress**: real-time progress bar via Server-Sent Events
- Downloads land in the same folder as `yt-dlp.exe` (`c:\Users\JJ Galicio\Downloads\YT DLP\`)

Out of scope: hosted deployment, auth, queueing, history, playlists-as-batch UI, multi-user.

## Architecture

```
[ Browser ]  ──HTTP──>  [ Express on :9000 ]  ──spawn──>  [ yt-dlp.exe ]
     ^                          │
     └────── SSE stream ◄───────┘  (progress lines piped back)
```

- Node + Express backend
- Each request spawns `yt-dlp.exe` as a child process
- Two main endpoints: `/api/formats` (request/response JSON), `/api/download` (SSE)
- Static frontend served from `public/`

## Backend endpoints

### `GET /`
Serves `public/index.html`.

### `POST /api/formats`
- Body: `{ "url": "<youtube url>" }`
- Spawns `yt-dlp.exe -J <url>` (dumps full info JSON)
- Returns simplified array of formats:
  ```json
  {
    "title": "video title",
    "duration": 1234,
    "formats": [
      { "id": "248", "type": "video", "ext": "webm", "resolution": "1920x1080", "fps": 30, "vcodec": "vp9", "acodec": "none", "filesize": 145000000, "note": "1080p" },
      { "id": "251", "type": "audio", "ext": "webm", "acodec": "opus", "abr": 160, "filesize": 4200000, "note": "audio only" }
    ],
    "recommended": "bestvideo+bestaudio"
  }
  ```
- On yt-dlp error: HTTP 400 with `{ error: "<stderr tail>" }`

### `GET /api/download?url=...&format=...`
- Server-Sent Events stream
- Spawns:
  ```
  yt-dlp.exe -f <format> \
    --newline \
    --progress-template "PROGRESS:%(progress.downloaded_bytes)s/%(progress.total_bytes)s/%(progress.speed)s/%(progress.eta)s/%(progress.status)s" \
    -o "%(title)s [%(id)s].%(ext)s" \
    <url>
  ```
- Parses each stdout line:
  - Lines starting with `PROGRESS:` → emit SSE `progress` event with parsed fields
  - Other lines → emit `log` event with the raw line
- On stderr: buffer; if process exits non-zero, emit `error` with stderr tail
- On clean exit: emit `done` event with the final filename (parsed from `[download] Destination: ...` or `[Merger] Merging formats into "..."`)

### `POST /api/open-folder`
- Body: optional
- Runs `start "" "<download dir>"` to open Windows Explorer
- Returns `{ ok: true }`

## Frontend

Single page, three sections stacked:

1. **URL input row**: text field + "Get formats" button
2. **Format table** (hidden until formats fetched):
   - Synthetic top row: "Best video + Best audio" (default, pre-highlighted)
   - One row per format: ID, type, resolution, codec, fps, size, note, "Pick" button
   - Below: "Custom format string" text input for power users (e.g. `bestvideo[height<=720]+bestaudio`)
3. **Download panel** (hidden until format picked):
   - Selected format summary
   - "Start download" button
   - Progress bar (fills via SSE)
   - Live stats: downloaded / total, speed, ETA
   - Collapsible log area with raw yt-dlp lines
   - On completion: filename + "Open folder" button
   - On error: red bar + stderr tail

**Frontend structure:**
- `public/index.html` — markup
- `public/app.js` — vanilla JS, no framework. Wires up fetch for `/api/formats`, `EventSource` for `/api/download`
- `public/style.css` — minimal styling

## Concurrency

One download per browser tab. Multiple tabs spawn multiple `yt-dlp.exe` processes — no global lock. Acceptable since this is single-user local.

## Error handling

| Failure | UI response |
|---|---|
| Invalid URL | Format-fetch returns 400, UI shows error message above the input |
| yt-dlp.exe missing | Server logs error on startup; format-fetch returns 500 |
| Network error during download | SSE `error` event, progress bar turns red, stderr tail shown |
| User closes tab mid-download | Server kills the child process when the SSE connection drops |

## File layout

```
YT DLP/
├── yt-dlp.exe              (existing)
├── GUIDE.txt               (existing)
├── server.js               (Express app)
├── package.json            (express dep)
├── start.bat               (launcher: npm start + open browser)
├── README.md               (one-paragraph usage)
├── docs/superpowers/specs/2026-05-04-yt-dlp-web-ui-design.md  (this file)
└── public/
    ├── index.html
    ├── app.js
    └── style.css
```

## Testing

Manual smoke test using the URL from `GUIDE.txt` (`https://www.youtube.com/watch?v=C1Vgn0GqkP0`):

1. Run `start.bat`, browser opens to `http://localhost:9000`
2. Paste URL, click "Get formats" → table populates
3. Click default "Best video + Best audio" row → download panel appears
4. Click "Start download" → progress bar advances, completes
5. Click "Open folder" → Explorer opens to YT DLP folder showing the new file
6. Repeat with a custom format string (`bestaudio`) to verify audio-only path
7. Negative test: paste a garbage URL → error message displays
