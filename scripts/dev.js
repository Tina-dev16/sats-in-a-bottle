import { spawn } from 'node:child_process';
const run = (cmd, args, tag) => {
  const p = spawn(cmd, args, { stdio: ['ignore', 'pipe', 'pipe'], env: process.env });
  const pipe = (s) => (d) => d.toString().split('\n').filter(Boolean).forEach((l) => s.write(`[${tag}] ${l}\n`));
  p.stdout.on('data', pipe(process.stdout));
  p.stderr.on('data', pipe(process.stderr));
  p.on('exit', (c) => { console.log(`[${tag}] exited ${c}`); process.exit(c ?? 0); });
  return p;
};
const kids = [
  run('node', ['--watch', '--no-warnings', 'server/index.js'], 'api'),
  run('npx', ['vite', '--config', 'web/vite.config.js'], 'web'),
];
process.on('SIGINT', () => { kids.forEach((k) => k.kill()); process.exit(0); });
