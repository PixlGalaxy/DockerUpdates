# Security

DockerUpdates controls the Docker daemon of the host. **Access to DockerUpdates is equivalent to root access on that server**: anyone who signs in can start a privileged container. Protect it accordingly.

The full security policy, the built-in protections and how to report a vulnerability privately are in [SECURITY.md](https://github.com/PixlGalaxy/DockerUpdates/blob/main/SECURITY.md).

## Hardening checklist

- [ ] A long, unique password (16+ characters), changed in [Settings > Account](Settings.md#account) or set in `ADMIN_PASSWORD`
- [ ] A session secret ([`SESSION_SECRET`](Configuration.md#session_secret)), so sessions survive restarts and cookies cannot be forged
- [ ] Outside your LAN, only through a [reverse proxy](Reverse-Proxy.md) with HTTPS, **Trust a reverse proxy** set to its IP and the **HTTPS-only session cookie** on
- [ ] Port `3000` **not** forwarded on your router
- [ ] An extra layer in front of it: an NPM Access List, Cloudflare Access, or a VPN (WireGuard, Tailscale)
- [ ] The container runs with [`no-new-privileges`](#no-new-privileges)
- [ ] Read-only registry tokens
- [ ] The image kept up to date
- [ ] From time to time, check **Admin Panel > Dashboard** for unknown sessions and **Server logs** for audit lines

[Settings > Login & sessions](Settings.md#login--sessions) shows a checklist of the main items.

## no-new-privileges

Shown in **Admin Panel > System**. It tells whether DockerUpdates' container was created with the Docker option `--security-opt no-new-privileges`.

This option turns on a Linux kernel protection: no process inside the container can gain more privileges than it started with. Programs with the setuid / setgid bit (`su`, `sudo`, `passwd`…) and file capabilities stop granting extra rights. If someone managed to run code inside the container, they could not use them to escalate. It does not change how DockerUpdates works.

It is defence in depth: DockerUpdates runs as root and has the Docker socket, which is already root-equivalent on the host, so it is not a strong barrier on its own. It is still recommended, which is why it shows in orange as *Not set (recommended)* when missing.

To turn it on, **recreate** the container (a restart is not enough):

- `docker run`: add `--security-opt no-new-privileges`
- Compose:

  ```yaml
  security_opt:
    - no-new-privileges:true
  ```

- Unraid: add `--security-opt no-new-privileges` to *Extra Parameters*

Admin Panel > System then shows it as **Enabled**.

## What the app does for you

- Login with per-IP and global lockouts, a delay on failures and constant-time comparison; wrong current passwords in Settings count too
- Revocable sessions stored hashed; HttpOnly, SameSite=Strict, HMAC-signed cookies
- Same-origin-only API (no CORS), strict Content-Security-Policy and security headers
- Secrets (notification URLs, tokens, registry tokens, the session secret, the password hash) stored in the data volume with `0600` permissions and never sent back to the browser
- An audit log of every sign-in and state-changing action, and an IP / CIDR ban list
