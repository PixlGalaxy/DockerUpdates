# Private registries

To check and pull updates of private images (GitHub Container Registry, private Docker Hub repositories, GitLab, a self-hosted registry…), DockerUpdates needs credentials. Containers whose registry rejects the pull show **Auth required** with a hint.

Use tokens with **read-only** access.

## Option 1: Settings > Registry credentials (easiest)

Add one row per registry: **registry** (`ghcr.io`, `docker.io`, `registry.gitlab.com`, `my.registry:5000`), **username** and **token**. Saved tokens are never shown again (`********`).

This list replaces [`REGISTRY_AUTH`](Configuration.md#registry_auth) from `.env`.

## Option 2: reuse your `docker login`

On the host:

```bash
docker login ghcr.io
```

and mount the file read-only into the container (as in [Installation](Installation.md)):

```bash
-v ~/.docker/config.json:/root/.docker/config.json:ro
```

The file is read on every pull, so a new `docker login` is picked up without restarting.

This does not work when your login is kept in a **credential helper** (`"credsStore"` or `"credHelpers"` in `config.json`, common on desktops): DockerUpdates cannot read it. Use option 1 or 3.

## Option 3: `REGISTRY_AUTH` in `.env`

```env
REGISTRY_AUTH=ghcr.io=myuser:ghp_xxx,docker.io=myuser:dckr_pat_xxx
```

## Order

For each registry, credentials are taken from Settings (or `REGISTRY_AUTH` if nothing was saved there) first, then from the mounted `config.json`, and otherwise the pull is anonymous.

[Compose stacks](Compose-Stacks.md) created in DockerUpdates are pulled by `docker compose`, which only reads the mounted `config.json` (option 2): credentials saved in Settings or in `REGISTRY_AUTH` are not used for them.

## Creating tokens

| Registry | Token | Scope |
| --- | --- | --- |
| GitHub (`ghcr.io`) | *Settings > Developer settings > Personal access tokens (classic)* | `read:packages` |
| Docker Hub (`docker.io`) | *Account settings > Personal access tokens* | Read-only |
| GitLab (`registry.gitlab.com`) | *Preferences > Access tokens* or a deploy token | `read_registry` |
