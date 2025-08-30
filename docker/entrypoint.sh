#!/usr/bin/env bash
set -euo pipefail

# Mode: gui (pygame over VNC) or web (FastAPI)
RGSX_MODE=${RGSX_MODE:-web}
WEB_PORT=${WEB_PORT:-8080}

# Optional display size via env (GUI mode)
DISPLAY_WIDTH=${DISPLAY_WIDTH:-1280}
DISPLAY_HEIGHT=${DISPLAY_HEIGHT:-720}
DISPLAY_DEPTH=${DISPLAY_DEPTH:-24}

# Ensure expected folders exist for volume mounts
mkdir -p /roms /saves/ports/rgsx

# Setup 1fichier API key if provided via environment
if [ ! -z "${ONEFICHIER_API_KEY:-}" ]; then
  echo "Setting up 1fichier API key from environment"
  echo "${ONEFICHIER_API_KEY}" > /saves/ports/rgsx/1fichierAPI.txt
fi

if [ "$RGSX_MODE" = "web" ]; then
  echo "[entrypoint] Launching RGSX Web API on 0.0.0.0:${WEB_PORT}"
  cd /opt
  exec uvicorn rgsx_web.app:app --host 0.0.0.0 --port ${WEB_PORT}
else
  # GUI mode (default)
  # Start a virtual X display
  XVFB_WHD="${DISPLAY_WIDTH}x${DISPLAY_HEIGHT}x${DISPLAY_DEPTH}"
  echo "[entrypoint] Starting Xvfb :0 ${XVFB_WHD}"
  Xvfb :0 -screen 0 ${XVFB_WHD} -nolisten tcp &

  # Start a minimal WM to keep apps happy
  fluxbox >/dev/null 2>&1 &

  # Start VNC server bound to :0
  echo "[entrypoint] Starting x11vnc on :0 (port 5900)"
  x11vnc -display :0 -nopw -forever -shared -rfbport 5900 >/dev/null 2>&1 &

  # Optionally expose via websockify/noVNC (6080)
  if command -v websockify >/dev/null 2>&1; then
    echo "[entrypoint] Starting websockify for noVNC on :6080"
    websockify --web=/usr/share/novnc/ 6080 localhost:5900 >/dev/null 2>&1 &
  fi

  # Make sure Python can find the package by name "RGSX"
  cd /opt

  echo "[entrypoint] Launching RGSX (headless X)"
  exec python -m RGSX
fi
