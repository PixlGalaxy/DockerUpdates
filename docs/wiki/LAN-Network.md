# LAN network (macvlan / ipvlan)

Gives containers their **own IP on your LAN**, like Unraid's `br0`: other devices reach them directly (for example Pi-hole on `192.168.1.53`), without port mappings.

Not available on Docker Desktop (Windows / macOS).

## Enable it

1. **Settings > LAN network > Detect network**. DockerUpdates reads the server's interface, subnet and gateway with a short-lived helper container; there is nothing to run on the host.
2. Check the values:
   - **Name** of the Docker network (default `lan`)
   - **Parent** interface (e.g. `eth0`, `enp3s0`)
   - **Subnet** and **gateway**
   - **IP range** (optional, recommended): a smaller block reserved for containers, e.g. `192.168.1.192/27`, outside your router's DHCP pool so addresses never clash
   - **Driver**: `macvlan` on wired connections; `ipvlan` is chosen automatically on Wi-Fi, because access points usually reject extra MAC addresses
3. **Enable**.

The network is **permanent**: it cannot be disabled from the app, because containers depend on it. To remove it, move those containers to another network and run `docker network rm lan` on the host.

## Give a container an IP

In **Add container** or **Edit**: choose the LAN network and type an IP in **Fixed IP**, then **Check**. DockerUpdates verifies that it is inside the subnet, is not the gateway, network or broadcast address, is not used by another container (also stopped ones that reserve it), and that no device on the LAN answers on it.

## Known limitation

With macvlan, the **server itself cannot reach** containers on the LAN network (and they cannot reach the server), by design of the Linux kernel. Other devices on the LAN can. If a container needs to talk to the host, keep it on a bridge network, or add a macvlan "shim" interface on the host.
