# Installation

DockerUpdates runs as a container that talks to the Docker daemon of the host through its socket.

## Requirements

- A Linux server with Docker (Docker Desktop on Windows / macOS also works, without the [LAN network](LAN-Network.md) feature)
- `amd64` or `arm64`
- Port `3000` free on the server (or any other port you map)

## 1. Create the configuration

```bash
mkdir -p ~/dockerupdates/data && cd ~/dockerupdates

cat > .env <<EOF2
ADMIN_USER=admin
ADMIN_PASSWORD=$(openssl rand -base64 18)
SESSION_SECRET=$(openssl rand -hex 32)
EOF2
chmod 600 .env

cat .env   # note your generated password
```

Only `ADMIN_USER` and `ADMIN_PASSWORD` are required. Every other variable is optional: see [Configuration](Configuration.md).

## 2. Run it

### Docker CLI

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

### Docker Compose

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

```bash
docker compose up -d
```

### Unraid

Add a container from the Docker tab with:

| Field | Value |
| --- | --- |
| Repository | `ghcr.io/pixlgalaxy/dockerupdates:latest` |
| Network type | `bridge` |
| Port | Container `3000` → Host `3000` |
| Path | `/var/run/docker.sock` → `/var/run/docker.sock` |
| Path | `/mnt/user/appdata/dockerupdates` → `/app/backend/data` |
| Variables | `ADMIN_USER`, `ADMIN_PASSWORD`, `SESSION_SECRET` (and any other from [Configuration](Configuration.md)) |
| Extra Parameters | `--security-opt no-new-privileges` |

## What each volume is for

| Mount | Required | Purpose |
| --- | :---: | --- |
| `/var/run/docker.sock` | Yes | Lets DockerUpdates control Docker. This is root-level access to the host: see [Security](Security.md) |
| `/app/backend/data` | Strongly recommended | Settings, notification channels, update history, templates, icons, login sessions, the login changed in the UI. Without it, all of that is lost every time the container is recreated |
| `~/.docker/config.json` (read-only) | Optional | Reuses your `docker login` for [private registries](Private-Registries.md). Remove the line if the file does not exist |
| Stacks folder, same path on both sides (e.g. `/opt/stacks:/opt/stacks`, with `STACKS_DIR=/opt/stacks`) | Optional | Only for [compose stacks](Compose-Stacks.md) whose compose file uses relative paths (`./data`). Without it, stacks are saved in the data volume and compose files with relative paths are refused |

## 3. Sign in

Open `http://<server-ip>:3000` and sign in with `ADMIN_USER` / `ADMIN_PASSWORD`.

Recommended first steps:

1. **Settings > Account**: change the password if you used a simple one.
2. **Settings > Server & access**: check that the Host IP is right, and set a session secret if you did not.
3. **Settings > Notifications**: connect Discord, Telegram, ntfy or a webhook.
4. **Auto-Update**: choose when containers are updated.

To publish it outside your LAN, read [Reverse proxy](Reverse-Proxy.md) first.

## Updating DockerUpdates

- **From the app**: click *Update* on the DockerUpdates row (or *Update all*). A short-lived helper container recreates it with the new image and the page reloads by itself.
- **Manually**:

  ```bash
  docker compose pull && docker compose up -d
  # or
  docker pull ghcr.io/pixlgalaxy/dockerupdates:latest
  docker rm -f dockerupdates
  # then run the same `docker run` command again
  ```

Your data volume keeps everything across updates.

## Uninstalling

```bash
docker rm -f dockerupdates
rm -rf ~/dockerupdates   # only if you also want to delete settings and history
```

Containers created or edited with DockerUpdates are normal Docker containers and keep running.
