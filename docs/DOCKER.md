## RGSX in Docker (Pi + NAS)

By default, the container runs the Web API + minimal UI at `/web` so you can use it from any browser. Downloads are written directly to your NAS share. A GUI (VNC) variant is also provided.

### What you get
- Headless RGSX (Pygame) accessible via VNC (port 5900) and browser (http://host:6080)
- Writes ROMs to `/roms` (mount this to your NAS path)
- Persists settings/history under `/saves/ports/rgsx`
- Multi-arch (works on Raspberry Pi, x86_64, etc.)

### Repo layout
- `Dockerfile`: multi-arch headless image
- `docker/entrypoint.sh`: starts Xvfb, VNC/noVNC, and RGSX
- `docker-compose.example.yml`: example Compose service

### Quick start (Web mode, default)
1) Build or pull the image

   - Build locally:
     ```bash
     docker compose -f docker-compose.example.yml build
     ```

2) Set environment variables (NAS paths)

   - For example, create a `.env` file alongside the compose:
     ```env
     NAS_ROMS=/mnt/nas/roms
     RGSX_SAVES=/mnt/nas/rgsx-saves
     WEB_PORT=8080
     ```
   - Ensure these paths exist and are writable by the container user. You can also set a `user:` in Compose to match your NAS permissions.

3) Launch
   ```bash
   docker compose -f docker-compose.example.yml up -d
   ```

4) Access the UI
   - API docs: `http://<host>:${WEB_PORT}/docs`
   - Minimal UI: `http://<host>:${WEB_PORT}/web`

5) First run
   - RGSX downloads its data on first launch. Settings and history are stored under `/saves/ports/rgsx` in your mapped `RGSX_SAVES` path.
   - If you have a 1Fichier API key, put it in `/saves/ports/rgsx/1FichierAPI.txt`.

### Volumes mapping
- `/roms` → NAS folder that you want populated with per-system subfolders (e.g., `/mnt/nas/roms`).
- `/saves` → persistent storage for RGSX settings and caches (e.g., `/mnt/nas/rgsx-saves`). RGSX stores its files in `/saves/ports/rgsx`.

### SteamOS / Bazzite / EmuDeck / Handhelds
- Point EmulationStation/EmuDeck to the same NAS `roms` share, or mount it locally.
- RGSX writes into per-system subfolders under `/roms` (e.g., `/roms/snes`, `/roms/psx`, etc.).
- On SteamOS/Bazzite, mount your NAS under your EmuDeck ROMs path or add a second ROMs directory pointing to the share.
- On handheld Linux devices (ES frontends), mount the same share and refresh the gamelist.
- On Android, access the NAS via SMB apps or mount solutions and copy desired titles over.

### GUI (VNC) variant
- Use `docker-compose.gui.example.yml` to run the original Pygame UI over VNC/noVNC.
- Ports:
  - 5900 (VNC), 6080 (noVNC in browser)
- Edit `DISPLAY_WIDTH/HEIGHT` as you like.

### Raspberry Pi notes
- The image is headless and doesn’t require an attached display. Control it via browser/VNC.
- If your NAS requires specific permissions, run the container with a matching UID/GID:
  ```yaml
  user: "1000:1000"
  ```
- If you see audio warnings, they are harmless (audio is disabled via `SDL_AUDIODRIVER=dummy`).

### Troubleshooting
- Black screen in browser/VNC: ensure `SDL_VIDEODRIVER=x11` is set (default in the Dockerfile), and the container has enough RAM.
- No downloads or network errors: ensure the container has internet access and your firewall doesn’t block outgoing traffic. The app’s internet self-test uses `ping` and HTTP.
- RAR extraction fails: `unrar-free` is installed. Some archives may require the non-free `unrar` package; if needed, install it in the image or adjust your base OS sources.
- Update prompts: RGSX can self-update its data (stored in `/saves`). Restart the app if requested.

### Updater controls (recommended for Docker)
- `RGSX_DISABLE_UPDATER=1`: disables the in-app code updater (OTA). Use image rebuilds to update instead. Default enabled in `docker-compose.example.yml`.
- `RGSX_DISABLE_DATA_UPDATE=1`: disables automatic data bootstrap/update (`rgsx-data.zip`). Leave off if you want automatic dataset updates; turn on to pin dataset.
 - `WEB_PORT`: sets the HTTP listen port inside the container (default 8080). The compose example maps host:port to the same value for simplicity.
