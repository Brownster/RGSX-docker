# RGSX Docker Web UI

This document provides instructions for running RGSX as a Docker container with a modern web interface, replacing the original Pygame UI.

## Features

- **Modern Web UI** - Clean, responsive interface inspired by the original RGSX theme
- **Full API** - RESTful API for all game browsing and download functionality  
- **Real-time Progress** - WebSocket-based download progress monitoring
- **Search & Filter** - Global search across all platforms and games
- **Download History** - Track completed, failed, and active downloads
- **Mobile Friendly** - Responsive design works on phones and tablets

## Quick Start

### Development Setup

1. Copy the environment template:
```bash
cp .env.example .env
```

2. Edit `.env` to set your paths:
```bash
# Required: Set these paths
NAS_ROMS=/path/to/your/roms
RGSX_SAVES=/path/to/your/rgsx-data
```

3. Start development container:
```bash
docker-compose -f docker-compose.dev.yml up -d
```

4. Open http://localhost:8080 in your browser

### Production Setup

1. Configure environment:
```bash
cp .env.example .env
# Edit .env with your production settings
```

2. Start production stack:
```bash
docker-compose -f docker-compose.prod.yml up -d
```

3. Optional: Enable Nginx reverse proxy:
```bash
docker-compose -f docker-compose.prod.yml --profile nginx up -d
```

## Configuration

### Volume Mounts

| Path | Description |
|------|-------------|
| `/roms` | Downloaded games destination |
| `/saves` | RGSX settings and cache data |

### Environment Variables

| Variable | Default | Description |
|----------|---------|-------------|
| `RGSX_MODE` | `web` | Run mode: `web` or `gui` |
| `WEB_PORT` | `8080` | Web server port |
| `RGSX_API_KEY` | - | Optional API authentication |
| `RGSX_RATE_LIMIT` | - | Rate limiting (e.g., `60/min`) |
| `TZ` | `UTC` | Timezone |

### 1fichier Support

For premium 1fichier downloads, place your API key in:
```
${RGSX_SAVES}/ports/rgsx/1fichierAPI.txt
```
Or set the environment variable `ONEFICHIER_API_KEY` (the entrypoint writes it to the file above on startup).

## Web UI Usage

### Navigation
- **Platform View** - Browse available game systems
- **Game List** - View games for selected platform  
- **Search** - Global search across all games
- **History** - View download history and status
- **Settings** - Configure 1fichier API key and update game data

### Downloads
- Click "Download" on any game to start
- Monitor progress in real-time
- Cancel active downloads
- View completed downloads in history

### Data Updates
- **Automatic Updates** - Platform and game lists auto-update on startup if missing
- **Manual Updates** - Use Settings → "Update Platform & Game Lists" to refresh
- **Persistent** - Updates save to `/saves` volume and survive container rebuilds
- **Container-Safe** - Code updates disabled (use image rebuilds instead)

### Keyboard Shortcuts
- `Ctrl + /` - Open global search
- `Escape` - Return to platform view

## API Documentation

The FastAPI backend provides a complete REST API:

- **Interactive docs**: http://localhost:8080/docs
- **OpenAPI spec**: http://localhost:8080/openapi.json

### Key Endpoints

| Method | Endpoint | Description |
|--------|----------|-------------|
| GET | `/api/platforms` | List all platforms |
| GET | `/api/platforms/{id}/games` | List games for platform |
| POST | `/api/download` | Start download |
| GET | `/api/history` | Download history |
| GET | `/api/search` | Search games |
| GET | `/api/update/status` | Data update status |
| POST | `/api/update/data` | Manual data update |
| WS | `/ws/progress` | Download progress |

## Development

### Hot Reload
The development compose file supports hot reloading:
- Web UI files: `./rgsx_web/static` → `/opt/rgsx_web/static`
- Python code: Uncomment the volume mount in dev config

### Custom Frontend
To replace the web UI with your own:
1. Build your frontend (React, Vue, etc.)
2. Copy build output to `./rgsx_web/static/`
3. Restart container

### Building Custom Images
```bash
docker build -t my-rgsx .
```

## Production Considerations

### Security
- Set `RGSX_API_KEY` for authentication
- Use `RGSX_RATE_LIMIT` to prevent abuse
- Consider running behind Nginx reverse proxy

### Performance  
- Resource limits configured in production compose
- Nginx handles static files and caching
- WebSocket connections for real-time updates

### Monitoring
- Health checks enabled
- Logs available via `docker logs`
- API status endpoint: `/api/status`

## Troubleshooting

### Common Issues

1. **Permission errors**: Ensure volume paths are writable
```bash
chmod -R 755 /path/to/roms /path/to/saves
```

2. **No platforms shown**: Check data download in logs
```bash
docker logs rgsx-web-dev
```

3. **Downloads fail**: Verify network connectivity and 1fichier API key

### Data Reset
To reset all data:
```bash
rm -rf ./saves/ports/rgsx/*
docker-compose restart
```

### Logs
```bash
# View application logs
docker logs rgsx-web-dev -f

# View nginx logs (if using proxy)
docker logs rgsx-nginx -f
```

## Migration from Pygame UI

The web version preserves all core functionality:
- ✅ Platform browsing
- ✅ Game downloads  
- ✅ Search functionality
- ✅ Download history
- ✅ 1fichier support
- ✅ Multi-format extraction

**Removed features** (Pygame-specific):
- Controller input
- Audio/music playback
- Fullscreen interface

## Support

- Original RGSX: https://discord.gg/Vph9jwg3VV
- Docker issues: Check logs and environment configuration
- Web UI bugs: Inspect browser developer tools
