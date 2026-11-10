# AI assistants (MCP)

DockerUpdates can be connected to Claude, ChatGPT and other AI apps through the [Model Context Protocol](https://modelcontextprotocol.io). The assistant can then answer questions about your server ("which containers have updates?", "why does Jellyfin keep restarting?") and, if you allow it, act on it.

It is **off by default**. Turn it on in **Settings → AI assistants (MCP)** and click **Save**.

## Server URL

The card shows the URL to give the AI app: the address you opened DockerUpdates with, plus `/mcp`.

| You open DockerUpdates at | URL | Works with |
| --- | --- | --- |
| `http://192.168.1.10:3000` (LAN) | `http://192.168.1.10:3000/mcp` | Apps running on your network, such as Claude Code |
| `https://docker.example.com` (reverse proxy) | `https://docker.example.com/mcp` | claude.ai, ChatGPT, Claude Desktop, Claude Code from anywhere |

claude.ai and ChatGPT connect **from their own servers on the internet**, so they need an HTTPS domain, for example through Nginx Proxy Manager (see [Reverse proxy](Reverse-Proxy.md)). Open DockerUpdates through that domain to get the right URL. Set `TRUST_PROXY` to the proxy's IP so the URLs use `https`.

## Connect an app

- **Claude** (claude.ai, Desktop, mobile): Settings → Connectors → **Add custom connector**, paste the URL, **Connect**.
- **ChatGPT**: Settings → Apps & Connectors → **Create** (developer mode), paste the URL, authentication **OAuth**.
- **Claude Code**: `claude mcp add --transport http dockerupdates <URL>`, then `/mcp` to sign in.

The app opens a DockerUpdates page: sign in, check the app name and where it sends you back (for example `claude.ai`), and click **Approve**. Only approve requests you started yourself.

Connected apps are listed in the card with **Disconnect**. Changing your password disconnects all of them.

### Access tokens

For apps configured by hand, create an **access token** in the card (it is shown once) and send it as a header:

```bash
claude mcp add --transport http dockerupdates https://docker.example.com/mcp \
  --header "Authorization: Bearer dut_..."
```

## Access levels

| Level | What the AI can do |
| --- | --- |
| **Read only** (default) | List containers and stacks, read settings, logs, update status, history and host info |
| **Read + basic actions** | Also start / stop / restart containers and stacks, check for updates, update containers |
| **Full control** | Also create, edit and remove containers, create, change and remove compose stacks, and run commands inside containers |

Editing or removing a container or stack, and running a command in a container, are marked as destructive: Claude and ChatGPT ask you before running them. DockerUpdates' own container can never be stopped, edited, removed or entered by the AI.

Secret-looking environment values (passwords, tokens, keys) are shown to the AI as `********`. When it sends that mask back in an edit, the real value is kept.

## Where new containers keep their data

The AI must follow the folder layout of your existing containers. DockerUpdates detects the folder most of them use (for example `/mnt/user/appdata` when your binds look like `/mnt/user/appdata/plex/config`) and tells the AI to use `<folder>/<container-name>/...`. You can set the folder yourself in **Data folder**.

Docker volumes are always refused for containers and stacks created or changed by the AI, so no data ends up in `/var/lib/docker/volumes`:

- named volumes (`pgdata:/var/lib/postgresql/data`)
- anonymous volumes, including a `VOLUME` declared by the image that is not mapped to a host folder

The AI gets an error with the folder to use instead, for example `/opt/appdata/jellyfin/config -> /config`.

Every action is written to the audit log (Admin Panel → Server logs) with the app's name.
