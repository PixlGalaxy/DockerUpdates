# Settings

Everything on the **Settings** page is stored in the data volume (`/app/backend/data`) and survives updates. Most cards have their own **Save** button that appears when something changed; the top **Save / Discard** buttons cover General, Update checks, Notifications, Health and Image cleanup.

## General

| Option | Description |
| --- | --- |
| Time zone | Used by every schedule (auto-update and cleanup). The initial value comes from [`TZ`](Configuration.md#tz) |

## Update checks

Background checks only **mark** containers with *Update available*; nothing is installed unless [Automatic updates](Automatic-Updates.md) are set to do it.

| Option | Description |
| --- | --- |
| Check when DockerUpdates starts | Run a check a few minutes after the app starts (for example after it updated itself), instead of waiting for the next interval |
| Check interval | How often every container is checked: from every 15 minutes to every week, or *Never (startup only)* |

A new or edited container is also checked 3 seconds after it starts, so it does not stay *Not checked*.

## Notifications

Which events are sent and to which channels. See [Notifications](Notifications.md).

## LAN network (macvlan)

Gives containers their own IP on your LAN. See [LAN network](LAN-Network.md).

## Health

| Option | Description |
| --- | --- |
| Stop containers in a restart loop | If a container crashes within a minute of starting and Docker restarts it this many times in a row (2 to 50, default 5), it is stopped and you get a notification |

## Image cleanup

| Option | Description |
| --- | --- |
| Remove old image after an update | Deletes the previous image right after a container is updated, if nothing else uses it |
| What to remove | *Dangling images only* (untagged leftovers, recommended) or *Unused images* (every image not used by a container, including tagged ones you may want to keep) |
| Scheduled cleanup | Run the cleanup on a schedule |
| Clean up now | Shows how many images and how much space would be freed, and runs it immediately |

## Account

The username and password used to sign in. Both start as [`ADMIN_USER` / `ADMIN_PASSWORD`](Configuration.md#login) from `.env`.

- **Username**: type the new one and click **Apply**. A popup asks for your **current password**.
- **Password**: type the new password twice; the page tells you live whether they match and whether it is long enough (8+ characters, 12+ recommended). **Change password** opens the same popup asking for the current password.
- A wrong current password counts as a failed login (same lockout as the sign-in page).
- After a change you stay signed in; **every other session is signed out**.
- The password is stored as a scrypt hash, never in clear text.

Forgot the login you set here? Use [`RESET_LOGIN_CONFIG`](Configuration.md#reset_login_config).

## Server & access

Values from `.env` are shown filled in and can be overridden here. What you save takes precedence over `.env` and applies right away. Each field has a badge: **Set here**, **From .env**, **Auto-detected** or **Default**.

| Option | Variable | Description |
| --- | --- | --- |
| Host IP | [`HOST_IP`](Configuration.md#host_ip) | Pre-filled with the detected IP. Type another one to override it, **Auto** goes back to detection. Shown in **orange** with "This IP is not correct" when it is not an address of the server |
| Server name | [`HOST_NAME`](Configuration.md#host_name) | Pre-filled with the name from Docker; type to override, **Auto** to go back |
| Trust a reverse proxy | [`TRUST_PROXY`](Configuration.md#trust_proxy) | Switch plus the proxy IPs (comma separated, ranges allowed). The field is greyed out while the switch is off |
| HTTPS-only session cookie | [`COOKIE_SECURE`](Configuration.md#cookie_secure) | Warns you when you turn it on while using plain HTTP |
| Extra allowed origins | [`ALLOWED_ORIGINS`](Configuration.md#allowed_origins) | Normally empty |
| Console keep-alive | [`CONSOLE_WS_KEEPALIVE`](Configuration.md#console_ws_keepalive) | Seconds between pings on an open console so the reverse proxy does not close it when idle. 0 = off; 25 for Nginx Proxy Manager |
| Session secret | [`SESSION_SECRET`](Configuration.md#session_secret) | Shows *Configured* or *Not set*. **Change** generates a random secret (you can also type one, 32+ characters); it is only visible until you save. Saving signs out every other session |
| PORT, Docker connection | [`PORT`](Configuration.md#port), [`DOCKER_HOST`](Configuration.md#docker_host--docker_socket) | Read-only: only in `.env` |

## Registry credentials

Rows of **registry / username / token** for private registries ([`REGISTRY_AUTH`](Configuration.md#registry_auth)). Tokens are never sent back to the browser: a saved token shows as `********` and is kept when you save other changes. See [Private registries](Private-Registries.md).

## Login & sessions

| Option | Default | Range | Description |
| --- | --- | --- | --- |
| Session lifetime | 12 h | 1 to 720 h | Sign in again after this long, even when active |
| Idle timeout | 120 min | 5 to 10080 min | Sign out after this long without activity |
| Failed logins per IP | 5 | 3 to 100 | Failures from one address before it is locked out |
| Failed logins in total | 30 | 10 to 1000 | Failures from all addresses before sign-in is locked for everyone (stops IP rotation) |
| Lockout window | 15 min | 1 to 1440 min | Failures are counted over this window, and a lockout lasts this long |

Below the limits, a **security checklist** shows whether a reverse proxy is pinned, the cookie is HTTPS-only, a session secret is set and the password is long enough. Lockouts can be lifted in [Admin Panel > IP access](Admin-Panel.md#ip-access).
