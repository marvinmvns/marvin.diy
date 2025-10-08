# Media Wall Player

A pure Node.js media wall that plays all videos and images from the local `./videos` folder in a fullscreen, continuously looping playlist. The app is tuned for kiosk-style deployments (including Raspberry Pi) and modern desktop/mobile browsers. It requires no third-party dependencies and exposes a simple API plus robust caching so devices can loop content for long periods with minimal CPU/RAM load.

## Features

- 🔁 **Continuous fullscreen slideshow** – Autoplays all media as soon as the page loads, re-shuffling the playlist after each pass.
- 🎞️ **Mixed media support** – Handles `.mp4`, `.webm`, `.ogv` videos alongside `.jpg`, `.jpeg`, `.png`, `.gif`, and `.webp` still images.
- 🔊 **Inline controls** – Toggle sound for video items, exit fullscreen, and automatically mute when images are displayed.
- 🛠️ **Self-contained Node.js server** – Streams files with HTTP range support, strong caching headers, and a health check endpoint.
- 💾 **Caching-aware experience** – Service Worker caches the application shell while leaving media files to the browser's native cache with long-lived HTTP headers.
- 🧰 **Zero external dependencies** – Uses only Node.js core modules, ideal for constrained environments or offline kiosks.

## Requirements

- Node.js 18 or newer (or the active LTS release on Raspberry Pi).
- Media files placed in the local `videos/` directory.
- A modern browser (Chromium, Firefox, Safari, etc.) with fullscreen and Service Worker support.

## Project Structure

```
project/
├── server.js          # Pure Node.js HTTP server
├── README.md          # This guide
├── public/
│   ├── index.html     # Fullscreen player UI
│   ├── app.js         # Playlist logic and media controls
│   └── sw.js          # Service Worker for shell caching
└── videos/            # Drop .mp4/.webm/.ogv/.jpg/.jpeg/.png/.gif/.webp files here
```

## Getting Started

1. **Install Node.js**
   - Use the official packages from [nodejs.org](https://nodejs.org/) or your distribution's repository.
   - On Raspberry Pi (Debian-based), you can install the current LTS: `curl -fsSL https://deb.nodesource.com/setup_lts.x | sudo -E bash - && sudo apt install -y nodejs`.

2. **Clone or copy the project**
   ```bash
   git clone <repo-url> media-wall
   cd media-wall
   ```

3. **Add media files**
   - Create the `videos/` folder if it does not exist: `mkdir -p videos`.
   - Place your video and/or image files directly inside the folder. Recommended formats:
     - Videos: `.mp4` (H.264 baseline/high for maximum compatibility), `.webm`, `.ogv`.
     - Images: `.jpg`, `.jpeg`, `.png`, `.gif`, `.webp`.
   - File names appear in the API response and are used for playback; avoid renaming while the server is running to prevent cache inconsistencies.

4. **Run the server**
   ```bash
   node server.js
   ```
   - The server listens on `HOST=0.0.0.0` and `PORT=3000` by default. Override using environment variables, e.g. `PORT=8080 node server.js`.
   - On first launch you'll see a warning if the `videos/` folder is missing.

5. **Open the player**
   - Navigate to `http://<host>:<port>/` (e.g. `http://raspberrypi.local:3000/`).
   - The page enters fullscreen, loads a shuffled playlist, and starts autoplaying immediately.
   - Videos play with `object-fit: cover` to fill the viewport; images fade in and out on a timer.

## Controls

- **Sound toggle** – Enables or mutes video audio. The control is automatically disabled while an image is displayed.
- **Exit fullscreen** – Leaves fullscreen mode; media continues looping within the window.
- **Error handling** – If a media item fails to load or play, the client skips to the next item without interrupting playback.

## API & Endpoints

| Method | Path             | Description                                                    |
| ------ | ---------------- | -------------------------------------------------------------- |
| GET    | `/`              | Serves the fullscreen media player (HTML shell).               |
| GET    | `/app.js`        | Playlist and control logic (cached via Service Worker).        |
| GET    | `/sw.js`         | Service Worker script (cached via Service Worker).             |
| GET    | `/healthz`       | Simple health check returning `200 OK` with `ok` body.         |
| GET    | `/api/videos`    | Returns JSON array of `{ name, type }` media descriptors.      |
| GET    | `/videos/<file>` | Streams a media file with Range support (videos only).         |

### `/api/videos` Response Example
```json
[
  { "name": "clip01.mp4", "type": "video" },
  { "name": "poster.jpg", "type": "image" }
]
```
- The playlist logic uses this endpoint to shuffle and loop through every available file.
- The response is always sorted alphabetically for stable ordering before shuffling client-side.

## Caching Strategy

### HTTP Layer
- **Videos**: Served with `Cache-Control: public, max-age=31536000, immutable`, plus `ETag` and `Last-Modified` headers. Range requests (`Accept-Ranges: bytes`) are fully supported, enabling efficient seeking and resuming.
- **Images**: Share the same long-lived cache headers as videos, ensuring quick reloads without re-downloading content.
- **Static assets**: HTML/JS/CSS responses use `Cache-Control: public, max-age=604800` (7 days) alongside `ETag` and `Last-Modified`.

### Service Worker
- Registered at `/sw.js` and scoped to the root path.
- **Pre-cache**: `index.html` and `app.js` on install so the app shell loads offline.
- **Cache-first strategy**: Responds from cache when available while fetching updates in the background.
- **Media passthrough**: Requests to `/videos/` are never intercepted so browsers can handle Range requests and native media caching.

## Deployment Tips

- **Systemd service**: For kiosk setups, wrap `node server.js` in a systemd unit and configure auto-restart.
- **Reverse proxy**: Optionally place Nginx or Caddy in front for TLS termination. Ensure it preserves `Range` headers and forwards large responses efficiently.
- **Content updates**: Replace files in `videos/` and reload the browser. Cached static assets may require a hard refresh or cache invalidation if you modify client files.
- **Performance**: Prefer hardware-accelerated video codecs (H.264) for Raspberry Pi compatibility. Keep an eye on CPU usage during long loops.

## Troubleshooting

| Symptom | Possible Cause & Fix |
| ------- | ------------------- |
| Page shows "Nenhum vídeo" message | No supported files in `./videos/`. Add media and reload. |
| Videos refuse to play audio | Ensure the sound toggle is set to ON. Browsers keep autoplay muted until the user toggles sound. |
| Media stops after one item | Check browser console for errors; unsupported codecs may fail to play. Replace with compatible files. |
| Service Worker not updating | Clear browser storage or increment the cache name in `public/sw.js` when changing shell assets. |
| HTTP 403 on media | File path may include unsafe segments. Keep files directly under `videos/` without subdirectories. |

## Development Notes

- The project intentionally avoids Express or other frameworks to minimize footprint and dependencies.
- `server.js` exposes reusable helper functions (`send`, `serveMedia`, etc.) if you want to extend routing.
- When adding new media types, update `VIDEO_EXTENSIONS`, `IMAGE_EXTENSIONS`, and `MIME` maps consistently.
- Consider adding playback telemetry or remote management by expanding the API if kiosk monitoring is required.

## License

This project is provided as-is; adapt or extend it to suit your installation requirements.
