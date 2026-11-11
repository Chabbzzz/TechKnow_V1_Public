// Package the customer web app and static portals without publishing server files.
const fs = require('node:fs');
const path = require('node:path');
const { spawnSync } = require('node:child_process');
const root = path.resolve(__dirname, '..');
const output = path.join(root, 'dist', 'hosting');
const result = spawnSync(process.execPath, [
  path.join(root, 'node_modules/expo/bin/cli'), 'export', '--platform', 'web',
  '--output-dir', output, '--max-workers', '2',
], { cwd: root, stdio: 'inherit' });
if (result.error) throw result.error;
if (result.status !== 0) process.exit(result.status || 1);

function copy(relative) {
  const target = path.join(output, relative);
  fs.mkdirSync(path.dirname(target), { recursive: true });
  fs.copyFileSync(path.join(root, relative), target);
}
// Only these public, browser-consumed modules belong in the hosting artifact.
const publicModules = [
  'backend/config/firebase-config.js',
  'backend/domain/reservations.js',
  'backend/services/admin.js',
  'backend/services/review-moderation.js',
  'backend/services/permits.js',
  'backend/services/presence.js',
  'backend/services/product-categories.js',
  'backend/dashboard-data.js',
  'ml/taglish-hiligaynon/index.js',
  'ml/taglish-hiligaynon/lexicon.js',
];
publicModules.forEach(copy);
for (const entry of fs.readdirSync(path.join(root, 'web'), { withFileTypes: true })) {
  if (entry.isFile() && /\.(html|css|js|png|svg|ico|webp|jpe?g)$/.test(entry.name)) copy('web/' + entry.name);
}
console.log('\nHosting build ready: dist/hosting');
console.log('Landing page: /web/landing.html | Customer app: / | Store login: /web/login.html');
