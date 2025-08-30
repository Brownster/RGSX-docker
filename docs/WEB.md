## RGSX Web API (headless)

This replaces the Pygame UI with a small FastAPI service that exposes browsing and download endpoints. It reuses the existing download logic and writes files into `/roms/<system>` (mount this to your NAS).

### Endpoints
- `GET /api/status` – basic health and paths.
- `GET /api/platforms` – list systems (id, name, folder, image).
- `GET /api/platforms/{platform_id}/games` – list games for a platform (name, url, size). Requires data bootstrap.
- `GET /api/history` – download history. Optional `status` filter (`completed|downloading|extracting|error|canceled`) and `limit`.
- `POST /api/download` – body: `{ platform, game_name, url, is_archive? }` – starts a download; returns `{ task_id }`.
- `POST /api/cancel` – body: `{ task_id? , url? }` – requests cancellation by id and/or url.
- `GET /api/progress?url=...` – normalized object for this URL with `status`, `percent`, `speed`, sizes, message. Without `url`, returns recent entries.
- `GET /api/search?q=...&platform_id?=...` – simple server-side search; optional `limit`.
- `GET /web` – serves a minimal static test UI (drop your built frontend into `rgsx_web/static` to override).

### Data bootstrap
On first start, if `sources.json` or the `games` directory is missing, the service downloads `rgsx-data.zip` (same source as the GUI) and extracts it into `/saves/ports/rgsx`.

### Run with Docker
Use `docker-compose.web.example.yml`:

```env
NAS_ROMS=/mnt/nas/roms
RGSX_SAVES=/mnt/nas/rgsx-saves
```

```bash
docker compose -f docker-compose.web.example.yml up -d --build
```

Then open `http://<host>:8080/docs` for interactive API docs.

### Notes
- 1fichier links require a premium API key in `/saves/ports/rgsx/1FichierAPI.txt`.
- The API’s games endpoint reads from `/saves/ports/rgsx/games/<platform>.json`.
- This is a minimal API. If you want a full web UI, add a frontend that hits these endpoints (React/Vue/Svelte or simple HTML/JS) and serve it via the same FastAPI app.
- For live progress, use `ws://<host>/ws/progress?url=<encoded_url>` (or `wss://` when behind HTTPS).

### Auth and rate limiting (optional)
- Set `RGSX_API_KEY` to require `X-Api-Key` (or `?api_key=`) on all API routes and WebSocket.
- Set `RGSX_RATE_LIMIT` like `60/min` to rate limit per client IP. Defaults to off.

### Serving a React build
- Build your React app and copy the production build into `rgsx_web/static` (e.g., `cp -r dist/* rgsx_web/static/`).
- Access it at `http://<host>:8080/web`.
- For client-side routing, prefer mounting at `/web` root and linking within that base.
