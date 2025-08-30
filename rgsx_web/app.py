import os
import sys
import asyncio
import json
import logging
from typing import Optional
import shutil
from urllib.parse import unquote

from fastapi import FastAPI, HTTPException, WebSocket, WebSocketDisconnect, Query, Request, Depends, Header
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles
from pydantic import BaseModel

# Ensure RGSX module local imports work (config imports rgsx_settings as top-level)
RGSX_DIR = os.path.join(os.path.dirname(__file__), "..", "RGSX")
RGSX_DIR_ABS = os.path.abspath(RGSX_DIR)
if RGSX_DIR_ABS not in sys.path:
    sys.path.insert(0, RGSX_DIR_ABS)

# Reuse existing modules
import config as cfg
from utils import load_sources, sanitize_filename, normalize_platform_name
from rgsx_settings import apply_symlink_path
from history import load_history, save_history, add_to_history, init_history
import network

import requests
from zipfile import ZipFile
from io import BytesIO

logger = logging.getLogger("rgsx_web")

app = FastAPI(title="RGSX Web API", version="0.1.1")

# Enable CORS for simple frontends during development
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Optional static UI (drop your built frontend into rgsx_web/static)
static_dir = os.path.join(os.path.dirname(__file__), "static")
if not os.path.exists(static_dir):
    os.makedirs(static_dir, exist_ok=True)
app.mount("/web", StaticFiles(directory=static_dir, html=True), name="web")

def sync_system_images_to_static():
    """Optionally copy known system logos from saves to a local static folder.
    Keeps the web UI independent of the saves mount for logos already present.
    Only copies if the source exists and the destination file is missing.
    """
    src_dir = getattr(cfg, 'IMAGES_FOLDER', None)
    if not src_dir or not os.path.isdir(src_dir):
        return
    dst_dir = os.path.join(static_dir, 'system-images')
    os.makedirs(dst_dir, exist_ok=True)
    exts = {'.png', '.jpg', '.jpeg', '.webp', '.svg'}
    try:
        for name in os.listdir(src_dir):
            if os.path.splitext(name)[1].lower() not in exts:
                continue
            src_path = os.path.join(src_dir, name)
            dst_path = os.path.join(dst_dir, name)
            if not os.path.exists(dst_path) and os.path.isfile(src_path):
                shutil.copy2(src_path, dst_path)
    except Exception:
        # Non-fatal: we still serve directly from saves as a fallback
        pass

# Serve system images directly from saves folder if present
try:
    if os.path.isdir(getattr(cfg, 'IMAGES_FOLDER', '')):
        app.mount("/assets/system-images", StaticFiles(directory=cfg.IMAGES_FOLDER), name="system-images")
except Exception:
    pass

# Optional API auth and rate limiting
API_KEY = os.getenv("RGSX_API_KEY", "").strip()
RATE_LIMIT = os.getenv("RGSX_RATE_LIMIT", "").strip()  # e.g., "60/min"

def _parse_rate_limit(s: str):
    try:
        if not s:
            return (0, 0)
        count, per = s.split("/")
        count = int(count)
        window = 60 if per == "min" else 1
        return (count, window)
    except Exception:
        return (0, 0)

RL_COUNT, RL_WINDOW = _parse_rate_limit(RATE_LIMIT)
_rl_cache = {}

async def dep_auth(x_api_key: str | None = Header(default=None), request: Request = None):
    if not API_KEY:
        return
    supplied = x_api_key or (request.query_params.get("api_key") if request else None)
    if supplied != API_KEY:
        raise HTTPException(status_code=401, detail="invalid api key")

async def dep_rate_limit(request: Request):
    if RL_COUNT <= 0 or RL_WINDOW <= 0:
        return
    now = asyncio.get_event_loop().time()
    key = request.client.host if request and request.client else "unknown"
    bucket = _rl_cache.get(key, [])
    # drop old
    bucket = [t for t in bucket if now - t < RL_WINDOW]
    if len(bucket) >= RL_COUNT:
        raise HTTPException(status_code=429, detail="rate limit exceeded")
    bucket.append(now)
    _rl_cache[key] = bucket


def ensure_data():
    os.makedirs(cfg.SAVE_FOLDER, exist_ok=True)
    init_history()
    # If core data is missing, try to fetch rgsx-data.zip like the GUI does
    data_missing = (
        not os.path.exists(cfg.SOURCES_FILE)
        or not os.path.exists(cfg.GAMES_FOLDER)
        or (os.path.exists(cfg.GAMES_FOLDER) and not any(os.scandir(cfg.GAMES_FOLDER)))
    )
    # Honor DISABLE_DATA_UPDATE flag
    if data_missing and not getattr(cfg, 'DISABLE_DATA_UPDATE', False):
        logger.info("RGSX data missing; downloading rgsx-data.zip...")
        resp = requests.get(cfg.OTA_data_ZIP, timeout=60, stream=True)
        resp.raise_for_status()
        with ZipFile(BytesIO(resp.content)) as zf:
            zf.extractall(cfg.SAVE_FOLDER)
        logger.info("RGSX data downloaded and extracted")


@app.on_event("startup")
def startup():
    ensure_data()
    # Initialize in-memory history for network module updates
    try:
        cfg.history = load_history()
    except Exception:
        cfg.history = []
    # Try to copy system logos locally for stable serving
    sync_system_images_to_static()


@app.get("/api/status", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def status():
    return {
        "sources": os.path.exists(cfg.SOURCES_FILE),
        "games_dir": os.path.exists(cfg.GAMES_FOLDER),
        "roms_dir": cfg.ROMS_FOLDER,
        "saves_dir": cfg.SAVE_FOLDER,
    }


@app.get("/api/platforms", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def get_platforms():
    ensure_data()
    sources = load_sources() or []
    # Return a trimmed view
    items = []
    for s in sources:
        img_name = s.get("system_image")
        img_url = None
        try:
            if img_name:
                # Prefer local static copy if present
                local_path = os.path.join(static_dir, 'system-images', img_name)
                if os.path.exists(local_path):
                    img_url = f"/web/system-images/{img_name}"
                else:
                    img_path = os.path.join(cfg.IMAGES_FOLDER, img_name)
                    if os.path.exists(img_path):
                        img_url = f"/assets/system-images/{img_name}"
        except Exception:
            img_url = None
        items.append({
            "platform": s.get("platform"),
            "id": s.get("platform"),
            "name": s.get("nom"),
            "folder": s.get("folder"),
            "system_image": img_name,
            "image_source": img_name,
            "image_url": img_url,
        })
    return items


@app.get("/api/platforms/{platform_id}/games", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def get_games(platform_id: str):
    ensure_data()
    # Completed URL set for convenience
    completed = set()
    for e in load_history() or []:
        raw = (e.get("status") or "").lower()
        if raw in ("download_ok", "completed", "done") and e.get("url"):
            completed.add(e["url"])
    games_path = os.path.join(cfg.SAVE_FOLDER, "games", f"{platform_id}.json")
    if not os.path.exists(games_path):
        raise HTTPException(404, f"Games list not found for platform {platform_id}")
    with open(games_path, "r", encoding="utf-8") as f:
        data = json.load(f)

    # Normalize various possible formats
    def normalize(entry):
        if isinstance(entry, dict):
            name = entry.get("name") or entry.get("title")
            url = entry.get("url") or entry.get("link")
            size = entry.get("size") or entry.get("filesize")
        elif isinstance(entry, list):
            name = entry[0] if len(entry) > 0 else None
            url = entry[1] if len(entry) > 1 else None
            size = entry[2] if len(entry) > 2 else None
        else:
            name = url = size = None
        if not url or not name:
            return None
        return {
            "name": name,
            "url": url,
            "size": size,
            "completed": url in completed,
        }

    items = []
    if isinstance(data, list):
        items = data
    elif isinstance(data, dict):
        if isinstance(data.get("games"), list):
            items = data.get("games")
        elif isinstance(data.get("items"), list):
            items = data.get("items")
        else:
            # Attempt to iterate dict values
            items = list(data.values())

    result = []
    for e in items:
        g = normalize(e)
        if g:
            result.append(g)
    return result


@app.get("/api/history", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def get_history(status: Optional[str] = None, limit: int = 0):
    hist = load_history() or []
    if status:
        s = status.lower()
        def norm(e):
            raw = (e.get("status") or "").lower()
            if raw in ("download_ok", "completed", "done"): return "completed"
            if raw in ("erreur", "error", "failed"): return "error"
            if raw in ("extracting",): return "extracting"
            if raw in ("telechargement", "downloading"): return "downloading"
            if raw in ("canceled", "cancelled"): return "canceled"
            return raw or "unknown"
        hist = [e for e in hist if norm(e) == s]
    if limit and limit > 0:
        hist = hist[-limit:]
    return hist


class DownloadRequest(BaseModel):
    platform: str
    game_name: str
    url: str
    is_archive: Optional[bool] = None


@app.post("/api/download", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
async def start_download(req: DownloadRequest):
    ensure_data()
    # Initialize sources once to set cfg.platform_dicts for path mapping
    load_sources()

    # Create a task id
    task_id = str(asyncio.get_event_loop().time()).replace(".", "")

    # Append to history immediately
    hist_entry = add_to_history(req.platform, req.game_name, "downloading", url=req.url, progress=0)
    # Keep in-memory history in sync so network.py can update it
    try:
        cfg.history = load_history()
    except Exception:
        pass

    # Decide path based on URL type
    if network.is_1fichier_url(req.url):
        task = asyncio.create_task(
            network.download_from_1fichier(req.url, req.platform, req.game_name, bool(req.is_archive), task_id)
        )
    else:
        task = asyncio.create_task(
            network.download_rom(req.url, req.platform, req.game_name, bool(req.is_archive), task_id)
        )

    return {"task_id": task_id, "history": hist_entry}


class BatchDownloadRequest(BaseModel):
    downloads: list[DownloadRequest]

@app.post("/api/downloads/batch", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
async def start_batch_download(req: BatchDownloadRequest):
    ensure_data()
    load_sources()

    tasks = []
    for download_req in req.downloads:
        task = await start_download(download_req)
        tasks.append(task)
    
    return {"tasks": tasks}


class CancelRequest(BaseModel):
    task_id: Optional[str] = None
    url: Optional[str] = None


@app.post("/api/cancel", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def cancel_download(req: CancelRequest):
    if not req.task_id and not req.url:
        raise HTTPException(400, "task_id or url is required")
    network.request_cancel(task_id=req.task_id, url=req.url)
    return {"ok": True}


class RedownloadRequest(BaseModel):
    url: str

@app.post("/api/history/redownload", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
async def redownload_from_history(req: RedownloadRequest):
    ensure_data()
    hist = load_history() or []
    
    history_entry = None
    for entry in reversed(hist):
        if entry.get("url") == req.url:
            history_entry = entry
            break
            
    if not history_entry:
        raise HTTPException(404, f"History entry not found for url {req.url}")

    platform = history_entry.get("platform")
    game_name = history_entry.get("game_name") or history_entry.get("name")
    
    if not platform or not game_name:
        raise HTTPException(400, "History entry is missing platform or game_name")

    is_archive = history_entry.get("is_archive", False)

    download_req = DownloadRequest(
        platform=platform,
        game_name=game_name,
        url=req.url,
        is_archive=is_archive
    )
    
    return await start_download(download_req)


@app.get("/api/progress", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def progress(url: Optional[str] = None):
    hist = load_history() or []

    def normalize(entry):
        status_raw = (entry.get("status") or "").lower()
        # Normalize various internal statuses
        if status_raw in ("download_ok", "completed", "done"):
            status = "completed"
        elif status_raw in ("erreur", "error", "failed"):
            status = "error"
        elif status_raw in ("extracting",):
            status = "extracting"
        elif status_raw in ("telechargement", "downloading"):
            status = "downloading"
        elif status_raw in ("canceled", "cancelled"):
            status = "canceled"
        else:
            status = status_raw or "unknown"

        downloaded = entry.get("downloaded_size") or 0
        total = entry.get("total_size") or 0
        percent = int(downloaded * 100 / total) if total else entry.get("progress", 0) or 0
        return {
            "url": entry.get("url"),
            "game_name": entry.get("game_name") or entry.get("name"),
            "platform": entry.get("platform"),
            "status": status,
            "percent": max(0, min(100, percent)),
            "speed": entry.get("speed", 0.0),
            "downloaded_size": downloaded,
            "total_size": total,
            "timestamp": entry.get("timestamp"),
            "message": entry.get("message", ""),
        }

    if url:
        url_dec = unquote(url)
        items = [h for h in hist if h.get("url") in (url, url_dec)]
        if not items:
            return {"url": url, "status": "unknown", "percent": 0}
        latest_raw = items[-1]
        latest = normalize(latest_raw)
        # Heuristic: if backend missed final update but file exists on disk, mark completed
        try:
            # Ensure sources are loaded for folder mapping
            if not getattr(cfg, 'platform_dicts', None):
                load_sources()
            platform = latest_raw.get('platform')
            game_name = latest_raw.get('game_name') or latest_raw.get('name')
            if platform and game_name:
                folder = None
                for pd in getattr(cfg, 'platform_dicts', []) or []:
                    if pd.get('platform') == platform:
                        folder = pd.get('folder') or normalize_platform_name(platform)
                        break
                if not folder:
                    folder = normalize_platform_name(platform)
                dest_dir = apply_symlink_path(cfg.ROMS_FOLDER, folder)
                dest_path = os.path.join(dest_dir, sanitize_filename(game_name))
                if os.path.exists(dest_path) and latest.get('status') not in ('completed', 'error', 'canceled'):
                    # Update history to completed
                    for e in hist:
                        if e.get('url') in (url, url_dec) and e.get('status') in ('downloading', 'Téléchargement', 'Extracting'):
                            e['status'] = 'Download_OK'
                            e['progress'] = 100
                            e['message'] = 'Completed (by file presence)'
                            break
                    save_history(hist)
                    latest['status'] = 'completed'
                    latest['percent'] = 100
        except Exception as _:
            pass
        return latest

    # No URL: return last 10 normalized entries overall
    return [normalize(h) for h in hist[-10:]]


@app.websocket("/ws/progress")
async def ws_progress(ws: WebSocket, url: str = Query(...), api_key: Optional[str] = Query(default=None)):
    # Authenticate websocket if key configured
    if API_KEY and api_key != API_KEY:
        await ws.close(code=4401)
        return
    await ws.accept()
    try:
        # Normalize possibly encoded URL
        url_raw = unquote(url)
        last_percent = -1
        while True:
            data = progress(url_raw)
            # When called with url, progress(url) returns an object
            if isinstance(data, dict):
                await ws.send_json(data)
                status = data.get("status")
                if status in ("completed", "error", "canceled"):
                    break
            else:
                # Fallback, send last item
                if data:
                    await ws.send_json(data[-1])
            await asyncio.sleep(0.5)
    except WebSocketDisconnect:
        return


@app.get("/api/search", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def search(q: str, platform_id: Optional[str] = None, limit: int = 100):
    """Global search across all platforms.
    - Matches by game name (primary)
    - If the query matches a platform name/alias, returns top games from that platform
    Handles different games JSON shapes (list[dict] or list[list]).
    """
    ensure_data()
    ql = (q or "").strip().lower()
    results: list[dict] = []

    def normalize_entry(pid, entry):
        # Accept dict or list entries
        if isinstance(entry, dict):
            name = entry.get("name") or entry.get("title")
            url = entry.get("url") or entry.get("link")
            size = entry.get("size") or entry.get("filesize")
        elif isinstance(entry, list):
            name = entry[0] if len(entry) > 0 else None
            url = entry[1] if len(entry) > 1 else None
            size = entry[2] if len(entry) > 2 else None
        else:
            return None
        if not name or not url:
            return None
        return {"platform": pid, "name": name, "url": url, "size": size}

    def load_platform_games(pid):
        p = os.path.join(cfg.SAVE_FOLDER, "games", f"{pid}.json")
        if not os.path.exists(p):
            return []
        try:
            with open(p, "r", encoding="utf-8") as f:
                data = json.load(f)
        except Exception:
            return []
        if isinstance(data, list):
            return [d for d in data]
        if isinstance(data, dict):
            if isinstance(data.get("games"), list):
                return data.get("games")
            if isinstance(data.get("items"), list):
                return data.get("items")
            # Fallback to values aggregation
            return list(data.values())
        return []

    def search_platform(pid):
        games = load_platform_games(pid)
        out = []
        for e in games:
            n = normalize_entry(pid, e)
            if not n:
                continue
            if ql and ql not in (n["name"] or "").lower():
                continue
            out.append(n)
            if 0 < limit <= len(out):
                break
        return out

    sources = load_sources() or []

    if platform_id:
        results = search_platform(platform_id)
    else:
        # First pass: match game names across all platforms
        for s in sources:
            results.extend(search_platform(s.get("platform")))
            if 0 < limit <= len(results):
                break
        # If none, try interpreting the query as a platform name
        if not results and ql:
            for s in sources:
                plat = (s.get("platform") or "").lower()
                disp = (s.get("nom") or "").lower()
                folder = (s.get("folder") or "").lower()
                if ql in plat or ql in disp or ql in folder:
                    # Return top N games (no name filter)
                    games = load_platform_games(s.get("platform"))
                    for e in games:
                        n = normalize_entry(s.get("platform"), e)
                        if n:
                            results.append(n)
                            if 0 < limit <= len(results):
                                break
                    if 0 < limit <= len(results):
                        break

    return results[:limit] if limit and limit > 0 else results


# Settings: 1fichier API key management
@app.get("/api/settings/onefichier", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def get_onefichier_status():
    """Returns whether a 1fichier API key is present (does not return the key)."""
    try:
        key_path = os.path.join(cfg.SAVE_FOLDER, "1fichierAPI.txt")
        if os.path.exists(key_path):
            with open(key_path, "r", encoding="utf-8") as f:
                key = f.read().strip()
            return {"present": bool(key), "length": len(key)}
        return {"present": False, "length": 0}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))


class OnefichierUpdate(BaseModel):
    api_key: str


@app.post("/api/settings/onefichier", dependencies=[Depends(dep_auth), Depends(dep_rate_limit)])
def set_onefichier_key(payload: OnefichierUpdate):
    """Stores/updates the 1fichier API key in the saves folder."""
    try:
        key = (payload.api_key or "").strip()
        key_path = os.path.join(cfg.SAVE_FOLDER, "1fichierAPI.txt")
        os.makedirs(os.path.dirname(key_path), exist_ok=True)
        with open(key_path, "w", encoding="utf-8") as f:
            f.write(key)
        return {"ok": True, "present": bool(key)}
    except Exception as e:
        raise HTTPException(status_code=500, detail=str(e))
