<p align="center">
  <img src="frontend/public/docker.png" alt="DockerUpdates" width="110" />
</p>

<h1 align="center">DockerUpdates</h1>

<p align="center">
  A self-hosted web dashboard to manage the Docker containers of your server and keep them updated, Unraid style.
</p>

<p align="center">
  <a href="https://github.com/PixlGalaxy/DockerUpdates/actions/workflows/docker-image.yml"><img src="https://github.com/PixlGalaxy/DockerUpdates/actions/workflows/docker-image.yml/badge.svg" alt="Build" /></a>
  <a href="LICENSE"><img src="https://img.shields.io/badge/license-MIT-blue.svg" alt="MIT License" /></a>
  <img src="https://img.shields.io/badge/image-ghcr.io%2Fpixlgalaxy%2Fdockerupdates-2496ED?logo=docker&logoColor=white" alt="Image" />
</p>

<p align="center">
  <img src="docs/screenshots/home.webp" alt="DockerUpdates dashboard: containers with health status, updates available, live CPU and memory" width="100%" />
</p>

---

## Features

- **Container overview**: state, image and tag, network, IP / MAC, container and LAN ports, volumes, uptime, autostart. Right-click a container for every action
- **Live resources**: CPU and RAM refreshed every second, with the limits configured on each container; host CPU and RAM always visible in the header
- **Health alerts**: health check status on every container (healthy, unhealthy, starting) and notifications when a container becomes unhealthy, recovers, crashes or keeps restarting
- **Update checks**: check one or all containers and see the exact change (`4bbda4e -> 9f3c2d1`); private registries supported (GHCR, Docker Hub, any registry) using your `docker login`
- **Automatic updates**: global schedule (hourly, daily, weekly, monthly or cron) plus per-container schedules, "update" or "notify only", time zone aware, with an optional cooldown so only images published N days ago are installed
- **Notifications**: Discord (rich embeds), Telegram, ntfy and generic webhooks (HMAC signed), with a test button
- **Update history** per container, and **image cleanup** (after each update and/or on a schedule)
- **Logs and console**: live logs with filter and download, and an interactive shell inside any running container
- **Self-update**: DockerUpdates updates itself safely through a short-lived helper container
- **Edit containers like Unraid**: name, image, network, auto-restart, memory limit slider, ports, volumes, environment variables and **Extra parameters** (`--cpus=1.5 --hostname=app …`) validated as you type
- **Templates**: every created or edited container is saved as a template; import / export as JSON
- **Dedicated LAN IPs (macvlan / ipvlan)**: enable it once in Settings (the server network is detected automatically, nothing to run on the host), then give containers a fixed IP with an availability check
- **Bulk actions**: start / stop / pause / resume all (DockerUpdates never stops or pauses itself)
- **Icons**: custom icon URL per image, Unraid icon label, or the app's favicon discovered automatically
- **Secure by default**: login, revocable sessions, brute-force lockout, strict same-origin API, CSP and security headers, audit log ([SECURITY.md](SECURITY.md))
- Light / dark theme, search and filters, Linux and Windows (Docker Desktop) hosts

## Screenshots

<table>
  <tr>
    <td width="50%"><img src="docs/screenshots/context-menu.webp" alt="Container actions on right-click" /><p align="center"><b>Right-click actions</b><br />Console, logs, edit, update, history and more</p></td>
    <td width="50%"><img src="docs/screenshots/update-log-finished.webp" alt="Live update log" /><p align="center"><b>Live update log</b><br />Pull progress, the docker run command and cleanup, Unraid style</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/auto-update.webp" alt="Auto-update schedule" /><p align="center"><b>Automatic updates</b><br />Global schedule, cooldown and "update" or "notify only"</p></td>
    <td><img src="docs/screenshots/auto-update-containers.webp" alt="Per-container auto-update" /><p align="center"><b>Per container</b><br />Global, custom time or off for every container</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/edit.webp" alt="Container editor" /><p align="center"><b>Unraid-style editor</b><br />Memory slider, fixed IP check, ports, volumes and extra parameters</p></td>
    <td><img src="docs/screenshots/settings.webp" alt="Notification settings" /><p align="center"><b>Notifications</b><br />Discord embeds, Telegram, ntfy and signed webhooks</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/logs.webp" alt="Live logs" /><p align="center"><b>Live logs</b><br />Follow, filter, timestamps and download</p></td>
    <td><img src="docs/screenshots/console.webp" alt="Container console" /><p align="center"><b>Console</b><br />Interactive shell inside any running container</p></td>
  </tr>
  <tr>
    <td><img src="docs/screenshots/history.webp" alt="Update history" /><p align="center"><b>Update history</b><br />Every update with the exact version change</p></td>
    <td><img src="docs/screenshots/home-dark.webp" alt="Dark theme" /><p align="center"><b>Dark theme</b><br />Light and dark, with host CPU and RAM in the header</p></td>
  </tr>
</table>

## Quick start

DockerUpdates runs as a container that talks to the host Docker daemon through its socket.

### 1. Create the configuration

```bash
mkdir -p ~/dockerupdates/data && cd ~/dockerupdates

cat > .env <<EOF
ADMIN_USER=admin
ADMIN_PASSWORD=$(openssl rand -base64 18)
SESSION_SECRET=$(openssl rand -hex 32)
HOST_IP=$(hostname -I | awk '{print $1}')
EOF
chmod 600 .env

cat .env   # note your generated password
```

### 2. Run it

**Docker CLI**

```bash
docker run -d --name dockerupdates --restart unless-stopped \
  --env-file ~/dockerupdates/.env \
  -p 3000:3000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v ~/.docker/config.json:/root/.docker/config.json:ro \
  -v ~/dockerupdates/data:/app/backend/data \
  --security-opt no-new-privileges \
  ghcr.io/pixlgalaxy/dockerupdates:latest
```

**Docker Compose**

```yaml
services:
  dockerupdates:
    image: ghcr.io/pixlgalaxy/dockerupdates:latest
    container_name: dockerupdates
    restart: unless-stopped
    env_file: .env
    ports:
      - "3000:3000"
    volumes:
      - /var/run/docker.sock:/var/run/docker.sock
      - ~/.docker/config.json:/root/.docker/config.json:ro   # optional: private registries
      - ./data:/app/backend/data                            # settings, sessions, history, templates, icons
    security_opt:
      - no-new-privileges:true
```

Open `http://<server-ip>:3000` and sign in.

The `data` volume keeps settings, notification channels, update history, templates, icons and login sessions across updates. Without it, they are lost every time the container is recreated.

> If `~/.docker/config.json` does not exist (you never ran `docker login`), remove that volume line.

## Configuration

All settings are environment variables (see [`backend/.env.example`](backend/.env.example)).

| Variable | Required | Default | Description |
| --- | :---: | --- | --- |
| `ADMIN_USER` | Yes | | Login username |
| `ADMIN_PASSWORD` | Yes | | Login password. Default or < 8 character passwords are rejected; use 12+ |
| `SESSION_SECRET` | | random | Signs session cookies, 32+ characters (`openssl rand -hex 32`) |
| `SESSION_HOURS` | | `12` | Maximum session lifetime |
| `SESSION_IDLE_MINUTES` | | `120` | Sign out after this much inactivity |
| `PORT` | | `3000` | HTTP port inside the container |
| `HOST_IP` | | auto | IP shown in the header and the *LAN IP:Port* links. Set it when running in Docker |
| `HOST_NAME` | | Docker host name | Server name shown in the header |
| `REGISTRY_AUTH` | | | Registry credentials, e.g. `ghcr.io=user:token,docker.io=user:token` |
| `TRUST_PROXY` | | private networks | IP of your reverse proxy (trusted for `X-Forwarded-*`) |
| `COOKIE_SECURE` | | `false` | `true` to always send the session cookie over HTTPS only |
| `ALLOWED_ORIGINS` | | | Extra origins allowed to call the API (normally not needed) |
| `DOCKER_HOST` / `DOCKER_SOCKET` | | platform socket | Custom Docker connection |

Changes to `.env` apply when the container is **recreated** (`docker rm -f` + `docker run`), not on `docker restart`.

## Private registries

To check and pull updates of private images, DockerUpdates needs registry credentials:

1. **Reuse your `docker login`** (recommended): run `docker login ghcr.io` on the host and mount `~/.docker/config.json` read-only, as in the quick start.
2. **Or** set `REGISTRY_AUTH=ghcr.io=<user>:<token>`. Use this if your login is stored in a credential helper (`"credsStore"` in `config.json`).

Use tokens with read-only scope (`read:packages` for GHCR). Containers whose registry rejects the pull show **Auth required** with a hint.

## Behind Nginx Proxy Manager

1. Create a *Proxy Host* pointing to `http://<server-ip>:3000`
2. SSL tab: request a certificate, enable **Force SSL**, **HTTP/2** and **HSTS**
3. Enable **Websockets Support** (needed by the container console), **Block Common Exploits** and, ideally, an **Access List** (IP allow-list or basic auth)
4. In `.env` add `TRUST_PROXY=<npm-ip>` and `COOKIE_SECURE=true`, then recreate the container
5. Do not forward port `3000` on your router, and do not add CORS headers in NPM

See the full [hardening checklist](SECURITY.md#hardening-checklist).

## Updating

- **From the app**: *Update* on the DockerUpdates row (or *Update all*). A helper container recreates it with the new image and the page reloads automatically.
- **Manually**:

  ```bash
  docker pull ghcr.io/pixlgalaxy/dockerupdates:latest
  docker rm -f dockerupdates
  # run the same `docker run` command again
  ```

## Development

Requirements: Node.js 22.9+ and a running Docker daemon.

```bash
# Backend (http://localhost:3000)
cd backend
cp .env.example .env      # set a strong ADMIN_PASSWORD
npm install
npm run dev

# Frontend (http://localhost:5173, proxies /api to the backend)
cd frontend
npm install
npm run dev
```

If you add npm packages on Windows or macOS, regenerate the lockfile on Linux before committing. npm leaves out optional dependencies of other platforms, and `npm ci` in the Docker build then fails with "Missing: ... from lock file":

```bash
docker run --rm -v "$PWD/frontend:/src" -w /src node:26-alpine npm install --package-lock-only --ignore-scripts
```

Build the image locally:

```bash
docker build --build-arg APP_VERSION=dev -t dockerupdates .
```

**Stack:** React 19 + TypeScript + Vite + Tailwind CSS 4 (frontend), Node.js + Express 5 + dockerode (backend). CI builds multi-arch images (`linux/amd64`, `linux/arm64`) and publishes them to GHCR; Dependabot keeps actions, npm packages and the base image updated.

## Security

DockerUpdates has full control over Docker on the host: treat access to it like root access. Read [SECURITY.md](SECURITY.md) for the security model, built-in protections and how to report a vulnerability privately.

## License

[MIT](LICENSE) © 2026 [PixlGalaxy](https://github.com/PixlGalaxy)

You can use, modify and redistribute DockerUpdates freely, as long as the copyright notice (the **DockerUpdates** name and its authors) and the license text are kept.
