# Admin Panel

The **Admin Panel** (header) has four sections. The section is kept in the URL (`/admin?section=logs`), so a reload or a bookmark opens the same view.

## Dashboard

- Counters: active sessions, failed logins in the last lockout window, locked addresses and banned IPs, plus a banner when errors or warnings were logged in the last hour.
- **Active sessions**: IP (and the IP used to sign in, if it changed), browser and system, user, when it signed in and last activity. **Sign out** one browser, or **Sign out others** to keep only yours. Use it if you see a session you do not recognise, then change your password in [Settings > Account](Settings.md#account).
- **Recent failed logins** since the last restart: time, IP, the address that really connected (`via`) and the username tried.

## Server logs

DockerUpdates' own output, newest first: the last 5,000 lines kept in memory (cleared on restart). The same lines are in `docker logs dockerupdates`.

- **Live** follows new lines; **Pause** freezes the view.
- Filter by source (**APP** messages, **AUDIT** trail) and level (INFO, WARN, ERROR); **Download** saves the current view.

The audit trail records sign-ins, lockouts, bans, blocked origins, settings changes and every state-changing action (`user="admin" POST /api/containers/…/restart -> 200`). With a proxy, `via=` shows the address that really connected.

## IP access

- **Locked out**: addresses locked after too many failed logins, and the global lock. **Unlock** lifts it. The limits are in [Settings > Login & sessions](Settings.md#login--sessions).
- **Banned IPs**: block an IP or a CIDR range (`203.0.113.7`, `203.0.113.0/24`) with an optional reason. Banned clients get nothing at all, not even the sign-in page or the console. Bans are saved in the data volume. Loopback, your own IP and your reverse proxy cannot be banned, so you cannot lock yourself out.

A warning at the top appears while no reverse proxy is pinned ([`TRUST_PROXY`](Configuration.md#trust_proxy)).

## System

- **DockerUpdates**: app version, Node.js, platform, uptime, memory used, whether it runs in a container; and its own container: image, image ID, restart policy, creation date and **no-new-privileges** (see [Security](Security.md#no-new-privileges)).
- **Docker engine**: version, API version, operating system, kernel, CPUs / memory, architecture, containers and images.
- **Data volume**: its path, disk usage and the size of each file.
