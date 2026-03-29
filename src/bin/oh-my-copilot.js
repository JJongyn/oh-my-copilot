#!/usr/bin/env node
'use strict';

const major = parseInt(process.version.slice(1).split('.')[0], 10);
if (major < 18) {
  console.error(`oh-my-copilot requires Node.js >= 18. You have ${process.version}.`);
  process.exit(1);
}

const path = require('path');
const bundlePath = path.join(__dirname, '..', 'dist', 'bundle.js');

try {
  require(bundlePath);
} catch (err) {
  console.error('oh-my-copilot: not built yet. Run: npm run build');
  console.error(`  (Looked in: ${bundlePath})`);
  if (process.env.DEBUG) console.error(err);
  process.exit(1);
}
