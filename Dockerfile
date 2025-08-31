FROM python:3.11-slim-bookworm

# Build arg to optionally include GUI deps (pygame). Default off for web-only images
ARG INCLUDE_PYGAME=0

# Install runtime deps: minimal for web mode; GUI deps added conditionally
RUN apt-get update \
    && apt-get install -y --no-install-recommends \
       iputils-ping curl \
       unrar-free \
       # GUI/VNC tools only when running GUI mode; harmless to have present, but skip heavy SDL libs here\
       xvfb x11vnc fluxbox websockify novnc \
    && rm -rf /var/lib/apt/lists/*

# Python requirements (web)
RUN pip install --no-cache-dir requests fastapi uvicorn[standard]

# Optional: install pygame and SDL libs for GUI builds
RUN if [ "$INCLUDE_PYGAME" = "1" ]; then \
      set -eux; \
      apt-get update; \
      apt-get install -y --no-install-recommends \
        python3-dev build-essential \
        libsdl2-2.0-0 libsdl2-image-2.0-0 libsdl2-mixer-2.0-0 libsdl2-ttf-2.0-0 \
        libjpeg62-turbo libpng16-16 libfreetype6 libgl1 libglu1-mesa; \
      pip install --no-cache-dir pygame==2.5.2; \
      rm -rf /var/lib/apt/lists/*; \
    fi

# App location and data mount points
WORKDIR /opt
RUN mkdir -p /roms /saves

# Copy RGSX application (package directory) into /opt/RGSX
COPY ports/RGSX /opt/RGSX

# Copy Web API and static UI
COPY rgsx_web /opt/rgsx_web

# Environment for headless X and SDL
ENV DISPLAY=:0 \
    SDL_VIDEODRIVER=x11 \
    SDL_AUDIODRIVER=dummy \
    LANG=C.UTF-8 \
    LC_ALL=C.UTF-8

# Expose VNC (5900) and noVNC (6080) for GUI mode, and 8080 for Web mode
EXPOSE 5900 6080 8080

# Add entrypoint that starts Xvfb, VNC and launches RGSX
COPY docker/entrypoint.sh /entrypoint.sh
RUN chmod +x /entrypoint.sh

ENTRYPOINT ["/entrypoint.sh"]
