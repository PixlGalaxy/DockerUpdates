# Container list

The home page lists every container with its state, version, network, ports, volumes, CPU and RAM, autostart and uptime. **Advanced view** (top) shows or hides the network, IP / MAC and volume columns. Right-click a container (or click its icon or name) for every action: WebUI, console, logs, start / stop, edit, update, history, template export…

Compose stacks and folders show as one row with their containers below it; the arrow folds them. A stack or folder row adds up the CPU, RAM and ports of its containers, and has its own update button, autostart switch and menu (right-click it or use `⋮`).

## Order

1. Click the **lock** next to the refresh button: the lock turns red and a hint shows how to move containers.
2. Drag a container by its handle, or press and hold it anywhere (a mouse also lifts it by moving), and drop it in its new place. The arrow keys move the focused handle too.
3. Click the lock again to save the order and the folders.

The order is saved on the server, so it is the same in every browser. Compose stacks move as one block (their containers stay with their stack). New containers go at the end, alphabetically.

## Folders

Folders group standalone containers, like app icons on a phone. While the lock is open, folders show their containers, and where a container sits decides whether it is in a folder:

| To… | Do this (lock open) |
| --- | --- |
| Make a folder | Drag a container onto the **middle** of another one and hold it there: after one second the row is outlined in blue (a phone vibrates). Drop it: both go into a new folder in that place, and you name it |
| Add a container to a folder | Drag it among the containers of the folder, or drop it on the folder row |
| Take it out | Drag it out of the folder, above the folder row or below its last container |
| Reorder inside a folder | Drag it within the folder |

Near the top or bottom edge of a row, dragging only moves the container. Nothing is saved until the lock is closed; a folder left with no container goes away.

From the menu of a folder:

| Action | What it does |
| --- | --- |
| Update folder | Updates the containers of the folder with an update |
| Check for updates | Checks each container of the folder |
| Start all / Stop all / Restart all | On every container of the folder (DockerUpdates itself is never stopped) |
| Rename folder | Up to 40 characters |
| Select color | One of 10 colors; **Automatic** picks one from the folder |
| Ungroup folder | Removes the folder; its containers go back to the list in its place |

Outside the reorder mode, **Remove from <folder>** in the menu of a container also takes it out of its folder, right below it. The autostart switch of a folder sets autostart on every container in it. The search also finds containers by the name of their folder.

Containers of a [compose stack](Compose-Stacks.md) are already grouped by their stack and cannot go into a folder. Folders are saved on the server (`data/folders.json`); a renamed container stays in its folder. If two browsers change folders at the same time, the last one saved wins.
