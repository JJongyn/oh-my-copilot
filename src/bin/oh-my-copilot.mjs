#!/usr/bin/env node
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const major = parseInt(process.version.slice(1).split('.')[0], 10);
if (major < 18) {
  console.error(`oh-my-copilot requires Node.js >= 18. You have ${process.version}.`);
  process.exit(1);
}

const __dirname = dirname(fileURLToPath(import.meta.url));
const bundlePath = new URL('../dist/bundle.mjs', import.meta.url).href;

try {
  await import(bundlePath);
} catch (err) {
  const msg = err?.message ?? '';
  if (err?.code === 'ERR_MODULE_NOT_FOUND' || msg.includes('bundle.mjs')) {
    console.error('oh-my-copilot: not built yet. Run: npm run build');
  } else {
    console.error('oh-my-copilot: startup error:', msg);
    if (process.env.DEBUG) console.error(err);
  }
  process.exit(1);
}
