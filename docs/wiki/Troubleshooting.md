# Troubleshooting

Start with **Admin Panel > Server logs** or `docker logs dockerupdates`: most problems are explained there.

## I changed `.env` but nothing changed

Docker copies `.env` into the container only when it is **created**. Restart, Force update and `docker restart` keep the old values. Recreate it: `docker compose up -d`, or `docker rm -f dockerupdates` and the same `docker run` again. Also check whether that setting was saved in the web UI: a value saved in [Settings](Settings.md) takes precedence over `.env` (look for the **Set here** badge).

## I forgot my username or password

If you changed them in Settings > Account: set [`RESET_LOGIN_CONFIG=true`](Configuration.md#reset_login_config), recreate the container, sign in with `ADMIN_USER` / `ADMIN_PASSWORD` from `.env`, then set it back to `false` and recreate again.

If you never changed them: they are `ADMIN_USER` / `ADMIN_PASSWORD` in your `.env` (`docker exec dockerupdates printenv ADMIN_USER`).

## "Too many failed attempts"

Wait for the lockout window (15 minutes by default), or unlock it from another signed-in browser in **Admin Panel > IP access**. If everyone behind your reverse proxy is locked out together, set **Trust a reverse proxy** ([`TRUST_PROXY`](Configuration.md#trust_proxy)).

## Everyone is signed out after every restart or update

No session secret is set. Set one in **Settings > Server & access** or [`SESSION_SECRET`](Configuration.md#session_secret).

## The header shows the wrong IP

The IP is detected automatically. A wrong one usually comes from an old `HOST_IP` in `.env` (shown in orange in Settings > Server & access) or from an IP typed in Settings. Click **Auto**, or remove `HOST_IP` from `.env`. See [`HOST_IP`](Configuration.md#host_ip).

## "Auth required" on a container

The image is private. Add credentials: see [Private registries](Private-Registries.md).

## "Check failed" on a container

Hover the badge for the reason. Usual causes: the tag no longer exists, the registry is down or rate-limited (Docker Hub), or DockerUpdates has no internet access (DNS / firewall).

## "Could not use Icon URL"

- *opens a web page, not an image*: use the direct link to the image file (right-click the image > Copy image address). Links to GitHub / GitLab file pages are converted automatically.
- *did not answer within 15 s*: check the URL and that DockerUpdates can reach the internet.

## "Port … is already in use"

The host port you typed in Add / Edit is used by another container (running, or stopped with the port reserved) or by a service on the server. Pick another host port.

## The console does not open

The console shows the reason in red inside the terminal:

- *Could not open the console connection*: the connection never reached DockerUpdates. Almost always the reverse proxy does not allow WebSockets: in Nginx Proxy Manager turn on **Websockets Support** in the proxy host; in Cloudflare turn on *Network > WebSockets*. See [Reverse proxy](Reverse-Proxy.md).
- *Origin not allowed*: the proxy changes the `Host` header. Pass it unchanged, or add the public address to [Allowed origins](Configuration.md#allowed_origins).
- *Your session expired*: sign in again.
- *Session closed · Connection lost* after about a minute without typing: the reverse proxy closes idle connections. Set **Console keep-alive** to `25` in Settings > Server & access ([`CONSOLE_WS_KEEPALIVE`](Configuration.md#console_ws_keepalive)).
- *The container is not running* / *has no shell*: the container must be running and have `sh` or `bash` (minimal images such as distroless or scratch have none).

Refused connections are also written to **Admin Panel > Server logs** as `console refused: …`, with the origin and host the server received.

## Origin not allowed / Missing Origin header

Your reverse proxy changes the `Host` header. Pass it unchanged, or add the public URL to [`ALLOWED_ORIGINS`](Configuration.md#allowed_origins).

## DockerUpdates does not start

Check `docker logs dockerupdates`:

- *ADMIN_USER and ADMIN_PASSWORD must be set*: add them to `.env`.
- *ADMIN_PASSWORD is too weak*: 8+ characters, not a default value, not the username.
- *SESSION_SECRET must be at least 32 characters*: use `openssl rand -hex 32`.
- *connect ENOENT /var/run/docker.sock*: mount the Docker socket (`-v /var/run/docker.sock:/var/run/docker.sock`).

## Settings or history disappeared after an update

The data volume is not mounted: add `-v ~/dockerupdates/data:/app/backend/data` (or `./data:/app/backend/data` in Compose).
