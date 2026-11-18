export {};
// Starts the server and Vite together
const procs = [
  Bun.spawn([process.execPath, '--watch', 'server/index.ts'], { stdout: 'inherit', stderr: 'inherit' }),
  Bun.spawn([process.execPath, '--bun', 'node_modules/vite/bin/vite.js', '--config', 'web/vite.config.ts'], { stdout: 'inherit', stderr: 'inherit' }),
];
const stop = () => { procs.forEach((p) => p.kill()); process.exit(0); };
process.on('SIGINT', stop);
process.on('SIGTERM', stop);
await Promise.race(procs.map((p) => p.exited));
stop();
