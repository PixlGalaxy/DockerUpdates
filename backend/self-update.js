// Entry point of the short-lived helper container that updates DockerUpdates itself.
// Usage (started automatically by docker.js): node self-update.js <container-id>
import { recreateContainer } from './docker.js';

const target = process.argv[2];
if (!target) {
  console.error('Usage: node self-update.js <container-id>');
  process.exit(1);
}

// Give the main app a moment to send its HTTP response before it is stopped.
await new Promise((r) => setTimeout(r, 3000));

try {
  const name = await recreateContainer(target);
  console.log(`DockerUpdates container "${name}" updated.`);
} catch (err) {
  console.error('Self-update failed (previous container restored):', err);
  process.exit(1);
}
