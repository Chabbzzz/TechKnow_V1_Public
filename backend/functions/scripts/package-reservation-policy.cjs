const fs = require('node:fs');
const path = require('node:path');

// Firebase uploads only the functions source directory. Package the shared
// browser/server policy inside that directory before every deployment.
const source = path.resolve(__dirname, '../../domain/reservations.js');
const target = path.resolve(__dirname, '../shared/reservations.cjs');
fs.mkdirSync(path.dirname(target), { recursive: true });
fs.copyFileSync(source, target);
console.log('Packaged shared reservation policy for Cloud Functions.');
