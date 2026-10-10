# Compose stacks

A stack is a group of containers described in one `docker-compose` file (for example an app with its database). DockerUpdates shows the containers of each compose project together, under one stack row.

## Two kinds of stacks

| | **Compose** (created in DockerUpdates) | **Compose · external** (started elsewhere) |
| --- | --- | --- |
| Where the file is | `STACKS_DIR/<name>/compose.yaml` | Wherever you ran `docker compose` |
| Edit | **Edit compose file**: saved and redeployed with `docker compose up -d` | Edit it in its own file; the container form is disabled so the containers never differ from it |
| Update | `docker compose pull` + `up -d --no-deps` for the services with an update | Each container is recreated with the same settings and the new image, as for any container |
| Start / stop / restart | `docker compose start / stop / restart` | Container by container |
| Remove | **Remove stack**: `docker compose down` (volumes are kept) | Not from DockerUpdates |

Every stack, managed or external, shows the CPU and RAM of all its running services, their ports, an autostart switch for all of them, and an update button when any service has an update. Right-click a stack for its actions, **Select color** and **Set icon** (an image URL shown instead of the stack symbol, like the Icon URL of a container).

## Create a stack

1. Click **Add compose** (next to **Add container**).
2. Enter a name (lowercase letters, digits, `-` and `_`: it becomes the compose project name).
3. Paste the compose file and, if it uses `${VARIABLES}`, an `.env` file.
4. **Deploy stack**: the file is checked with `docker compose config` first (a rejected file is not saved and the error stays in the editor), then the images are pulled and the stack starts with a live log.

## Relative paths

Relative paths in a compose file (`./db:/var/lib/mysql`) resolve inside the stack folder, but the folder is created by the Docker daemon **on the host**. When DockerUpdates runs in a container, mount a stacks folder at the same path on both sides:

```yaml
services:
  dockerupdates:
    environment:
      - STACKS_DIR=/opt/stacks
    volumes:
      - /opt/stacks:/opt/stacks
```

Without it, a compose file with relative paths is refused (named volumes and absolute host paths work anyway), so no data ends up in an unexpected folder.

## Notes

- **Autostart** on a stack sets the restart policy of every service at once, without restarting them. On a managed stack it is also written to the compose file (`restart: unless-stopped` or `restart: "no"` on every service, comments kept), so a redeploy or an update keeps it. On an external stack, change `restart:` in its own file too, or the next `docker compose up` brings the old value back.
- **Automatic updates** work for stack services like for any container; services of a managed stack are updated together with `docker compose`.
- Pulls of a stack use the host's `docker login` (`/root/.docker/config.json`); `REGISTRY_AUTH` is not used by `docker compose`.
