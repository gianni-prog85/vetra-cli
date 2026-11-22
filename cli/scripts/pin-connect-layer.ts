#!/usr/bin/env tsx
/**
 * Post-build step of `pnpm build:connect`: pins the `external-packages`
 * cascade layer first in `dist/connect/index.html` (see
 * `cli/src/lifecycle/connect-layer-order.ts`). Idempotent. Fails when the
 * bundle is missing or has no `<head>`, so a broken build is not shipped.
 */
import fs from 'node:fs';
import path from 'node:path';
import { pinExternalPackagesLayer } from '../src/lifecycle/connect-layer-order.js';

const PROJECT_ROOT = path.resolve(import.meta.dirname, '..', '..');
const indexFile = path.resolve(process.argv[2] ?? path.join(PROJECT_ROOT, 'dist', 'connect', 'index.html'));

if (!fs.existsSync(indexFile)) {
  console.error(`pin-connect-layer: ${indexFile} not found; run ph-cli connect build first`);
  process.exit(1);
}
const html = fs.readFileSync(indexFile, 'utf8');
const pinned = pinExternalPackagesLayer(html);
if (pinned === null) {
  console.error(`pin-connect-layer: no <head> in ${indexFile}`);
  process.exit(1);
}
if (pinned === html) {
  console.log('pin-connect-layer: external-packages layer already pinned');
} else {
  fs.writeFileSync(indexFile, pinned);
  console.log(`pin-connect-layer: pinned external-packages as the lowest cascade layer in ${indexFile}`);
}
