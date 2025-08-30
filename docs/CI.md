## CI: Multi-arch Docker images on tags

This repository includes a GitHub Actions workflow that builds and publishes multi-arch Docker images whenever you push a tag (e.g., `v1.2.3`).

Workflow: `.github/workflows/docker-multiarch.yml`

What it does
- Builds for `linux/amd64`, `linux/arm64`, and `linux/arm/v7`.
- Pushes to GitHub Container Registry (GHCR) by default as `ghcr.io/<owner>/<repo>:<tag>` and `:latest`.
- Optionally pushes to Docker Hub if credentials are provided.
- If a frontend exists at `rgsx_web/ui` with a `package.json`, the workflow builds it (`npm ci && npm run build`) and copies the output (`dist/` or `build/`) into `rgsx_web/static/` before building the image.

Trigger
- Pushing a tag that matches `v*` or `V*`.
- Manual run via “Run workflow”.

Configuration
- GHCR requires no extra secrets; `GITHUB_TOKEN` is used automatically.
- Docker Hub (optional): set the following in repo Settings → Secrets and variables → Actions:
  - Secrets:
    - `DOCKERHUB_USERNAME`
    - `DOCKERHUB_TOKEN` (Create a Docker Hub access token)
  - Variable (or Secret):
    - `DOCKERHUB_IMAGE` (e.g., `myuser/rgsx`)

How tags map to images
- Tag `v1.2.3` → images tagged `:v1.2.3` and `:latest`.
- You can also add more tag patterns in the workflow if you need.

Usage
- After a tag build completes, pull the image on any host:
  - GHCR: `docker pull ghcr.io/<owner>/<repo>:v1.2.3`
  - Docker Hub (if enabled): `docker pull myuser/rgsx:v1.2.3`

Notes
- The same image supports both GUI and Web modes via `RGSX_MODE` env (`gui` or `web`).
- Consider pinning exact tags (e.g., `v1.2.3`) in production instead of `latest`.
- If you maintain a React/Vue UI under `rgsx_web/ui`, ensure `npm run build` outputs to `dist` or `build`. The workflow syncs that to `rgsx_web/static/` which is what the FastAPI app serves at `/web`.
