# DockerUpdates documentation

DockerUpdates is a self-hosted web dashboard to manage the Docker containers of your server and keep them updated: live status and resources, update checks, scheduled automatic updates, notifications, logs, a console, a container editor and more.

![DockerUpdates dashboard](https://raw.githubusercontent.com/PixlGalaxy/DockerUpdates/main/docs/screenshots/home.webp)

## Start here

| Page | What you will find |
| --- | --- |
| [Installation](Installation.md) | Requirements, `docker run`, Docker Compose, Unraid, first sign-in, updating |
| [Configuration](Configuration.md) | Every environment variable (`.env`), one by one, with examples |
| [Settings](Settings.md) | Every option of the Settings page in the web UI |
| [Automatic updates](Automatic-Updates.md) | Update checks, schedules, cooldown, per-container rules |
| [Notifications](Notifications.md) | Discord, Telegram, ntfy and signed webhooks |
| [Reverse proxy](Reverse-Proxy.md) | Nginx Proxy Manager, HTTPS, `TRUST_PROXY`, `COOKIE_SECURE` |
| [Private registries](Private-Registries.md) | GHCR, Docker Hub and other private images |
| [LAN network](LAN-Network.md) | Dedicated LAN IPs for containers (macvlan / ipvlan) |
| [Admin Panel](Admin-Panel.md) | Sessions, server logs, IP access and bans, system information |
| [Security](Security.md) | Security model, hardening checklist, `no-new-privileges` |
| [Troubleshooting](Troubleshooting.md) | Common problems and how to fix them |

## How configuration works

DockerUpdates reads its configuration from **environment variables** (usually a `.env` file passed with `--env-file` or `env_file:`). Most of them can later be changed in the web UI, in **Settings**:

- A value saved in the web UI **takes precedence** over the `.env` file and applies right away.
- A value that was never saved in the UI keeps following the `.env` file.
- The `.env` file is read by Docker **only when the container is created**. After editing it, recreate the container (`docker compose up -d`, or `docker rm -f` + `docker run`). A restart, from the UI or with `docker restart`, does not read it again.

Each field in Settings shows where its current value comes from: **Set here**, **From .env**, **Auto-detected** or **Default**.

## Links

- Source code and issues: <https://github.com/PixlGalaxy/DockerUpdates>
- Image: `ghcr.io/pixlgalaxy/dockerupdates:latest` (`linux/amd64`, `linux/arm64`)
- Report a vulnerability privately: [Security advisories](https://github.com/PixlGalaxy/DockerUpdates/security/advisories/new)
