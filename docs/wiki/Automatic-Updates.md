# Automatic updates

DockerUpdates separates **checking** for updates from **installing** them.

## How an update is detected

For each container, DockerUpdates pulls its image tag (for example `nginx:latest`) and compares the image ID with the one the container runs. When they differ, the row shows **Update available** with the exact change:

- the version label (`org.opencontainers.image.version`) when both images have it, e.g. `1.27.0 → 1.27.1`
- otherwise the commit (`org.opencontainers.image.revision`) or the short image ID, e.g. `4bbda4e → 9f3c2d1`

Other states: **Up to date**, **Auth required** (private registry, see [Private registries](Private-Registries.md)), **Local image** (built locally, nothing to check), **Check failed** (hover it for the reason) and **Not checked**.

## When checks run

- **Background checks**: when DockerUpdates starts and then on the interval chosen in [Settings > Update checks](Settings.md#update-checks). They only mark updates.
- **After creating or editing a container**: 3 seconds after it starts.
- **Manually**: the refresh icon on a row, *Check for update* in its menu, or **Check for updates** at the bottom (all containers).

## Installing updates manually

- **Update available** button on a row, or **Force update** in the right-click menu (recreates even without a new image).
- **Update all** at the bottom: every container with an update.
- **Update stack** on a [compose stack](Compose-Stacks.md) row: every service of the stack with an update.

The live log shows the pull progress, the equivalent `docker run` command and the cleanup. You can close it while the update runs: a notice at the top follows it (orange while running, green when it finishes and then hides after 3 seconds, red if something failed). While it runs or after errors, tap it to open the log again. The container is recreated with **exactly the same configuration** (ports, volumes, environment, networks, labels, restart policy…). If the new container fails to start, the previous one is restored.

DockerUpdates updates itself through a short-lived helper container, and the page reloads by itself.

Services of a stack created in DockerUpdates are not recreated by DockerUpdates: their update runs `docker compose pull` and `docker compose up -d --no-deps` for those services (all the services of the same stack in one go), so the compose file stays the source of truth. The log shows the compose output instead of the `docker run` command. Containers of a stack started elsewhere are updated like any other container. Scheduled updates follow the same rules.

## The Auto-Update page

### Global schedule

| Option | Description |
| --- | --- |
| Enable automatic updates | Master switch for the global schedule |
| Action | **Check & update** installs updates; **Check & notify only** just sends a notification |
| Frequency | Hourly, daily, weekly, monthly, or a custom **cron** expression, in the time zone of [Settings > General](Settings.md#general). The next runs are shown below |
| Apply to all containers | New containers follow the global schedule unless you change them below |
| Graceful stop timeout | Seconds to wait for a container to stop before it is killed during an update (default 15) |
| Cooldown | Only auto-update to images **published at least N days ago**, so broken day-one releases are skipped. You are still notified right away; the update is installed once the image is old enough |

The top of the page shows the status, the next global run and the last run, with **Run now** to run it immediately.

### Per container

Each container can be:

- **Global**: follows the global schedule
- **Custom**: its own schedule, action and cooldown (empty cooldown = the global value)
- **Off**: never updated automatically (local images are always off)

Use the filter (All / Global / Custom / Off) to find them. Remember to click **Apply** at the top after changing anything on this page.

## Tips

- Pin important containers to a version tag (`postgres:16`) instead of `latest`: the update then only brings patches of that version.
- Use **notify only** or a **cooldown** for databases and critical services, and update them by hand after reading the release notes.
- Turn on [notifications](Notifications.md) for *Update failed*.
