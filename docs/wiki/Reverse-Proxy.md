# Reverse proxy

To open DockerUpdates from outside your LAN, put it behind a reverse proxy with HTTPS, and **never** forward port `3000` on your router. Remember that whoever signs in controls Docker on your server (see [Security](Security.md)).

## Nginx Proxy Manager

1. **Proxy Hosts > Add Proxy Host**
   - Domain: `docker.example.com`
   - Scheme `http`, Forward Hostname / IP: the server IP, Forward Port: `3000`
   - Enable **Websockets Support** (needed by the container console and the live logs), and **Block Common Exploits**
2. **SSL** tab: request a Let's Encrypt certificate, enable **Force SSL**, **HTTP/2** and **HSTS**.
3. Ideally add an **Access List** (IP allow-list or basic auth) as an extra layer.
4. Do **not** add CORS headers or custom `add_header Access-Control-*` lines.
5. Tell DockerUpdates about the proxy, in **Settings > Server & access** (applies right away) or in `.env` (recreate the container):
   - **Trust a reverse proxy** on, with the IP of Nginx Proxy Manager ([`TRUST_PROXY`](Configuration.md#trust_proxy))
   - **HTTPS-only session cookie** on ([`COOKIE_SECURE`](Configuration.md#cookie_secure)), once you only use `https://`

## Which IP is "the proxy IP"?

The address DockerUpdates sees the connection coming from:

- NPM on **another machine**: that machine's LAN IP.
- NPM in a container on the **same server**, forwarding to the server IP: usually the Docker bridge gateway of NPM's network (e.g. `172.18.0.1`). Using the whole network range is fine: `172.18.0.0/16`.
- Not sure? Open **Admin Panel > Dashboard**: the *IP* of your own session, opened through the proxy, should be your real IP. In the audit lines of **Server logs**, `via=` shows the address that really connected: that is the proxy.

## Other proxies

Any proxy works if it:

- passes the original `Host` header (or you add the public address to [`ALLOWED_ORIGINS`](Configuration.md#allowed_origins))
- sets `X-Forwarded-For` and `X-Forwarded-Proto`
- supports WebSockets (`Upgrade` / `Connection` headers) for the console and live logs

Caddy example:

```caddy
docker.example.com {
  reverse_proxy 192.168.1.20:3000
}
```

Traefik labels example:

```yaml
labels:
  - traefik.enable=true
  - traefik.http.routers.dockerupdates.rule=Host(`docker.example.com`)
  - traefik.http.routers.dockerupdates.entrypoints=websecure
  - traefik.http.routers.dockerupdates.tls.certresolver=letsencrypt
  - traefik.http.services.dockerupdates.loadbalancer.server.port=3000
```

## Common problems

| Symptom | Cause and fix |
| --- | --- |
| *Origin not allowed* when saving anything | The proxy changes the `Host` header. Pass it unchanged, or add the public URL to `ALLOWED_ORIGINS` |
| The console stays blank or disconnects | WebSockets are not enabled in the proxy |
| Everyone gets locked out together after a few failed logins | `TRUST_PROXY` is not set, so all logins through the proxy share one counter. Set it |
| Cannot sign in over `http://` anymore | `COOKIE_SECURE` is on: use `https://`, or turn it off |
