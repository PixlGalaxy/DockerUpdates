# Configuration

DockerUpdates is configured with environment variables, usually in a `.env` file (`--env-file .env` with `docker run`, `env_file: .env` with Compose). A commented example is in [`backend/.env.example`](https://github.com/PixlGalaxy/DockerUpdates/blob/main/backend/.env.example).

## When changes apply

- **`.env` file**: Docker copies the variables into the container **when it is created**. After editing `.env`, recreate the container: `docker compose up -d`, or `docker rm -f dockerupdates` and the same `docker run` again. *Restart*, *Force update* and `docker restart` keep the old values.
- **Web UI (Settings)**: most variables can also be set in [Settings](Settings.md). Those values are stored in the data volume, apply right away and **take precedence over `.env`**. A field that was never saved in the UI keeps following `.env`.

To check the value a running container got: `docker exec dockerupdates printenv HOST_IP` (replace the name).

## Summary

| Variable | Required | Default | Also in the web UI |
| --- | :---: | --- | --- |
| [`ADMIN_USER`](#admin_user) | Yes | | Settings > Account |
| [`ADMIN_PASSWORD`](#admin_password) | Yes | | Settings > Account |
| [`RESET_LOGIN_CONFIG`](#reset_login_config) | | `false` | |
| [`SESSION_SECRET`](#session_secret) | | random | Settings > Server & access |
| [`SESSION_HOURS`](#session_hours) | | `12` | Settings > Login & sessions |
| [`SESSION_IDLE_MINUTES`](#session_idle_minutes) | | `120` | Settings > Login & sessions |
| [`HOST_IP`](#host_ip) | | auto-detected | Settings > Server & access |
| [`HOST_NAME`](#host_name) | | Docker host name | Settings > Server & access |
| [`TRUST_PROXY`](#trust_proxy) | | private networks | Settings > Server & access |
| [`COOKIE_SECURE`](#cookie_secure) | | `false` | Settings > Server & access |
| [`ALLOWED_ORIGINS`](#allowed_origins) | | | Settings > Server & access |
| [`CONSOLE_WS_KEEPALIVE`](#console_ws_keepalive) | | `0` (off) | Settings > Server & access |
| [`REGISTRY_AUTH`](#registry_auth) | | | Settings > Registry credentials |
| [`PORT`](#port) | | `3000` | Read-only |
| [`DOCKER_HOST` / `DOCKER_SOCKET`](#docker_host--docker_socket) | | platform socket | Read-only |
| [`TZ`](#tz) | | system time zone | Settings > General |
| [`DATA_DIR`](#data_dir) | | `/app/backend/data` | |
| [`STACKS_DIR`](#stacks_dir) | | `DATA_DIR/stacks` | |
| [`DOCKER_CLI`](#docker_cli) | | `docker` | |
| [`DOCKER_CONFIG`](#docker_config) | | `/root/.docker` | |
| [`SELF_CONTAINER`](#self_container) | | auto-detected | |

---

## Login

### `ADMIN_USER`

**Required.** Username to sign in.

```env
ADMIN_USER=admin
```

Once you change the username in **Settings > Account**, the one saved there is used instead, and this variable is only used again after a [`RESET_LOGIN_CONFIG`](#reset_login_config).

### `ADMIN_PASSWORD`

**Required.** Password to sign in. The app refuses to start when it is shorter than 8 characters, a common value (`admin`, `password`, `change-me`…) or the same as the username. Use 12+ characters, ideally 16+.

```env
ADMIN_PASSWORD=a-long-unique-password
# or generate one: openssl rand -base64 18
```

Changing the password in **Settings > Account** stores it as a scrypt hash in the data volume (`login.json`); from then on this variable is ignored until a [`RESET_LOGIN_CONFIG`](#reset_login_config). The variable stays required, because it is the way back in.

### `RESET_LOGIN_CONFIG`

Default `false`. For a **forgotten username or password** set in the web UI.

With `true`, at startup DockerUpdates deletes the username and password saved in Settings > Account, so `ADMIN_USER` / `ADMIN_PASSWORD` from `.env` work again. Other settings are not touched.

```env
RESET_LOGIN_CONFIG=true
```

1. Set it to `true` and **recreate** the container (a restart is not enough, see [When changes apply](#when-changes-apply)).
2. Sign in with the `.env` login.
3. Set it back to `false` (or remove it) and recreate again. While it is `true`, every restart resets the login, and Settings > Account shows a warning.

---

## Sessions

### `SESSION_SECRET`

Default: a random value generated at every start. Signs the session cookies (HMAC).

Without it, everyone is signed out every time DockerUpdates restarts or updates. Use at least 32 random characters:

```env
SESSION_SECRET=3f9c...   # openssl rand -hex 32
```

A value shorter than 32 characters stops the app at startup. Changing it signs out every session. It can also be set (or generated) in **Settings > Server & access**; the UI shows it only while you change it, then only as *Configured*.

### `SESSION_HOURS`

Default `12`. Maximum lifetime of a session, in hours (1 to 720): you have to sign in again after this long, even when active.

Only the **initial value**: once saved in **Settings > Login & sessions**, the value there is used.

### `SESSION_IDLE_MINUTES`

Default `120`. Sign out after this many minutes without activity (5 to 10080).

Only the **initial value**, like `SESSION_HOURS`.

---

## Server

### `HOST_IP`

Default: detected automatically. The IP of the server shown in the header and used for the *LAN IP:Port* links, favicon discovery and the port-in-use check.

DockerUpdates reads the server's main network interface (from a short-lived helper container on the host network when it runs in a bridge container) at startup and every 30 minutes, so it follows DHCP changes. Set `HOST_IP` only to show **another address of the same server** (for example a second network card):

```env
HOST_IP=192.168.1.20
```

A `HOST_IP` that is **not** an address of the server (typically an old IP after moving the server to another network) is ignored: the detected IP is used, a warning is written to the server logs and Settings > Server & access shows it in orange. An IP typed in the web UI is always used, with the same orange warning when it looks wrong.

### `HOST_NAME`

Default: the host name reported by Docker. Name shown in the header next to the IP.

```env
HOST_NAME=tower
```

### `PORT`

Default `3000`. HTTP port **inside** the container. Usually you leave it alone and change the published port instead (`-p 8080:3000`). If you change it, change the container side of `-p` too (`-p 3000:8080` with `PORT=8080`).

Shown read-only in Settings: changing it from the UI would break the port mapping and lock you out.

### `DOCKER_HOST` / `DOCKER_SOCKET`

Default: `/var/run/docker.sock` on Linux, `//./pipe/docker_engine` on Windows. How DockerUpdates connects to Docker.

```env
# Unix socket in another location
DOCKER_SOCKET=/run/user/1000/docker.sock
# or a remote / TCP daemon (protect it with TLS or a socket proxy!)
DOCKER_HOST=tcp://192.168.1.20:2375
```

`DOCKER_HOST` takes precedence. Shown read-only in Settings.

### `TZ`

Default: the container's time zone (usually UTC). Only the **initial** time zone of the schedules (auto-update, cleanup); afterwards it is chosen in **Settings > General**.

```env
TZ=America/Lima
```

### `DATA_DIR`

Default `/app/backend/data`. Folder for settings, sessions, history, templates, icons and the login set in the UI. Mount a volume there instead of changing it.

### `STACKS_DIR`

Default `DATA_DIR/stacks`. Folder of the compose stacks created with **Add compose** (one folder per stack, with its `compose.yaml` and `.env`). Docker creates the relative paths of a compose file (`./db`) on the host, so mount this folder at the same path on the host and in the container:

```env
STACKS_DIR=/opt/stacks
```

```yaml
volumes:
  - /opt/stacks:/opt/stacks
```

See [Compose stacks](Compose-Stacks.md).

### `DOCKER_CLI`

Default `docker`. The docker CLI with the compose plugin, used for compose stacks (both are included in the image). Only set it when running from source and `docker` is not in `PATH`, e.g. Docker Desktop on macOS: `/Applications/Docker.app/Contents/Resources/bin/docker`.

---

## Reverse proxy and browser security

See [Reverse proxy](Reverse-Proxy.md) for a complete setup.

### `TRUST_PROXY`

Default: private networks. Which proxies may tell DockerUpdates the visitor's real IP and protocol through the `X-Forwarded-For` / `X-Forwarded-Proto` headers.

When you use a reverse proxy (Nginx Proxy Manager, Traefik, Caddy…), set it to the proxy's IP:

```env
TRUST_PROXY=192.168.1.10
# several proxies or a range:
TRUST_PROXY=192.168.1.10, 172.18.0.0/16
```

- **Not set**: any device on a private network is trusted. A warning is printed at startup, and the login lockout also counts the address that really connected, so faked headers cannot dodge it. Behind a proxy, all failed logins through it then share one lockout counter: set `TRUST_PROXY` to avoid that.
- **Set**: only those addresses are trusted; the lockout and the audit log use each visitor's real IP.

In **Settings > Server & access** it is a switch plus the proxy IP field, and it applies without a restart.

### `COOKIE_SECURE`

Default `false`. With `true`, the browser only sends the login cookie over HTTPS. Turn it on once you **only** open DockerUpdates through `https://`; afterwards signing in over `http://` no longer works.

```env
COOKIE_SECURE=true
```

Without it, the cookie is still marked Secure automatically whenever the request comes over HTTPS.

### `ALLOWED_ORIGINS`

Default: empty. The API only accepts requests whose `Origin` matches the address you opened (protection against CSRF). Add other origins only if your proxy rewrites the `Host` header and you get *Origin not allowed* errors:

```env
ALLOWED_ORIGINS=https://docker.example.com
```

Comma separated, scheme and host only (no path).

### `CONSOLE_WS_KEEPALIVE`

Default `0` (off). The container console uses a WebSocket, and reverse proxies close one that carries no traffic for a while: Nginx Proxy Manager (nginx) after **60 seconds**. A console left idle is then cut and you have to click *Reconnect*.

With a value, DockerUpdates sends a ping every that many seconds (10 to 300) while a console is open. Pings count as traffic, so the proxy keeps the console open. Use a value below the proxy timeout:

```env
CONSOLE_WS_KEEPALIVE=25
```

Not needed without a reverse proxy. Applies to consoles opened after the change. Also in **Settings > Server & access** (*Console keep-alive*).

---

## Registries

### `REGISTRY_AUTH`

Default: empty. Credentials for private registries, used to check and pull updates. Format `registry=user:token`, comma separated (the token may contain `:`):

```env
REGISTRY_AUTH=ghcr.io=PixlGalaxy:ghp_xxx,docker.io=myuser:dckr_pat_xxx
```

The list saved in **Settings > Registry credentials** replaces this one. See [Private registries](Private-Registries.md) for the alternatives (reusing `docker login`).

### `DOCKER_CONFIG`

Default `/root/.docker`. Folder where DockerUpdates looks for `config.json` (your `docker login`). Change it only if you mount that file somewhere else.

---

## Advanced

### `SELF_CONTAINER`

Default: detected. Name or ID of DockerUpdates' own container. It is detected from `/proc/self/mountinfo` or the container host name; set it only if self-updates or the "this is DockerUpdates" badge do not work (for example with a custom `--hostname`):

```env
SELF_CONTAINER=dockerupdates
```

### `APP_VERSION`

Set when the image is built (the commit shown in the footer). Do not set it yourself.

---

## Full example

```env
# Login (required)
ADMIN_USER=admin
ADMIN_PASSWORD=a-long-unique-password
RESET_LOGIN_CONFIG=false

# Sessions
SESSION_SECRET=paste-the-output-of-openssl-rand-hex-32
SESSION_HOURS=12
SESSION_IDLE_MINUTES=120

# Behind Nginx Proxy Manager over HTTPS
TRUST_PROXY=192.168.1.10
COOKIE_SECURE=true

# Optional
TZ=America/Lima
HOST_NAME=tower
REGISTRY_AUTH=ghcr.io=myuser:ghp_readonlytoken
```
