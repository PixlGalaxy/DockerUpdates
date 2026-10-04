# Security Policy

DockerUpdates controls the Docker daemon of the host it runs on. **Access to DockerUpdates is equivalent to root access on that host**, so security reports are taken seriously.

## Supported versions

Only the latest image is supported. Security fixes are released as a new `ghcr.io/pixlgalaxy/dockerupdates:latest` image (each build is also tagged `sha-<commit>`).

| Version | Supported |
| --- | --- |
| `latest` (main branch) | Yes |
| Older `sha-*` tags | No (update to `latest`) |

## Reporting a vulnerability

**Please do not open a public issue for security problems.**

Report it privately through GitHub:
**[Report a vulnerability](https://github.com/PixlGalaxy/DockerUpdates/security/advisories/new)** (repository → *Security* → *Report a vulnerability*).

Please include:

- What is affected and the impact (e.g. auth bypass, command execution, data exposure)
- Steps to reproduce or a proof of concept
- The version (footer of the app, or the image `sha-` tag) and how it is deployed (direct port, reverse proxy…)

What to expect:

- Acknowledgement within **7 days**
- A fix or mitigation plan as soon as the issue is confirmed; critical issues are prioritised
- Credit in the release notes / advisory if you want it

## Security model

DockerUpdates is designed for a **single administrator** managing their own server.

- It needs the Docker socket (`/var/run/docker.sock`), which grants full control of the host. Anyone who logs in can start privileged containers.
- There is one account, defined by `ADMIN_USER` / `ADMIN_PASSWORD` in the `.env` file. The password is never stored by the app.
- Sessions are revocable on logout or from Admin Panel > Dashboard (sign out one browser or every other one), and expire after the idle timeout (default 120 minutes) or the session lifetime (default 12 hours). Both are set in Settings > Login & sessions; `SESSION_IDLE_MINUTES` / `SESSION_HOURS` only give the initial values. They are persisted in the data volume so updates do not log you out; only a SHA-256 hash of each session id is stored, and changing `ADMIN_USER`, `ADMIN_PASSWORD` or `SESSION_SECRET` invalidates all of them.
- The container console runs a shell inside containers (`docker exec`). It uses a WebSocket that requires a valid session and an `Origin` matching the app, and every console session is written to the audit log.
- Notification secrets (webhook URLs, bot tokens) are stored in the data volume and never sent back to the browser in clear text.

### Built-in protections

| Area | Protection |
| --- | --- |
| Login | Per-IP lockout (default 5 failures / 15 min), global lockout (default 30 failures / 15 min), both adjustable in Settings > Login & sessions; 1 s delay on failures, constant-time comparison. Lockouts can be lifted from Admin Panel > IP access. Without `TRUST_PROXY`, the lockout also counts the address that opened the connection, so fake `X-Forwarded-For` values cannot dodge it |
| Passwords | App refuses to start with a default or < 8 character password |
| Cookies | `HttpOnly`, `SameSite=Strict`, `Secure` over HTTPS (or forced with `COOKIE_SECURE=true`), HMAC-signed |
| CSRF / CORS | Same-origin only API: no CORS headers, preflights rejected, cross-site fetches rejected, `Origin` must match the app for every state-changing request (also blocks sibling subdomains behind the same proxy) |
| Headers | Strict Content-Security-Policy (no inline scripts), `X-Frame-Options: DENY`, HSTS, `nosniff`, `Referrer-Policy`, `Permissions-Policy`, `Cache-Control: no-store` on the API |
| Proxy | Only proxies listed in `TRUST_PROXY` may set `X-Forwarded-For` / `X-Forwarded-Proto`. When it is not set, private networks are trusted, a warning is printed at startup, and audit lines show the real peer (`via=`) next to the forwarded IP |
| Input | Container IDs validated (no Docker API path traversal), 100 KB request body limit, Extra parameters parsed against an allow-list of `docker run` flags, `__proto__` / `constructor` / `prototype` keys ignored in settings |
| IP bans | Admin Panel > IP access keeps a persistent list of banned IPs and CIDR ranges (data volume, `ip-bans.json`). Banned clients get a 403 for every request, including static files and the console WebSocket. Loopback, your own IP and your reverse proxy cannot be banned, so you cannot lock yourself out |
| Icons | Size-limited (1 MB), type-checked downloads, served with a sandboxing CSP. Icon URLs from image labels are only followed when they are `http(s)` |
| Registry credentials | Read-only mount of `~/.docker/config.json`, or `REGISTRY_AUTH`; never sent to the browser |
| Auditing | Logins, lockouts, bans, blocked origins and every state-changing API call are logged (`docker logs dockerupdates`). The last 5000 log lines are also shown in Admin Panel > Server logs (memory only, cleared on restart) |

## Fixed issues

| Date | Severity | Issue | Fix |
| --- | --- | --- | --- |
| 2026-10-04 | Medium | With `TRUST_PROXY` unset (the default), every host on a private network was trusted to send `X-Forwarded-For`. A LAN client could send a different fake IP on each attempt and bypass the per-IP login lockout (only the global limit of 30 attempts / 15 min applied). It could also forge the IP written to the audit log. | The lockout also tracks the real connecting address when `TRUST_PROXY` is not set, audit lines include it as `via=`, and a startup warning asks for `TRUST_PROXY`. Behind a reverse proxy without `TRUST_PROXY`, failed logins through the proxy now share one lockout: set `TRUST_PROXY` to avoid that. |
| 2026-10-04 | Low | `PUT /api/settings` merged `__proto__` keys from the request body, which let an authenticated request change the prototype of the in-memory settings objects (no global pollution, lost on restart). | Dangerous keys are skipped during the merge. |
| 2026-10-04 | Low | The `net.unraid.docker.icon` label of any pulled image was fetched without checking its scheme. | Only `http://` and `https://` label URLs are fetched. |

## Hardening checklist

When exposing DockerUpdates outside your LAN (e.g. through Nginx Proxy Manager):

- [ ] Use a long, unique `ADMIN_PASSWORD` (16+ characters) and a random `SESSION_SECRET` (`openssl rand -hex 32`)
- [ ] Serve it **only over HTTPS** through the reverse proxy (Force SSL + HSTS) and set `COOKIE_SECURE=true`
- [ ] Set `TRUST_PROXY` to the IP of your reverse proxy
- [ ] Do **not** forward port `3000` on your router; only the reverse proxy should reach it
- [ ] Add an extra layer in front of it: an NPM **Access List** (IP allow-list or basic auth), Cloudflare Access, a VPN (WireGuard / Tailscale)…
- [ ] Do not add CORS headers in the proxy configuration
- [ ] Run the container with `--security-opt no-new-privileges`
- [ ] Use registry tokens with read-only scope (`read:packages`)
- [ ] Keep the image updated
- [ ] Review Admin Panel > Server logs (or `docker logs dockerupdates`) for `[audit]` entries from time to time, and check Admin Panel > Dashboard for sessions you do not recognise
