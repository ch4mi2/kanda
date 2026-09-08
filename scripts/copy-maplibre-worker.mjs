#!/usr/bin/env node
// maplibre-gl's worker script resolves its own URL relative to wherever the
// main bundle is actually served from (`new URL('./maplibre-gl-worker.mjs',
// import.meta.url)`). In dev that's node_modules, served directly — fine.
// In a production build, Vite/Rollup inlines maplibre-gl's code into the
// single hashed bundle under /assets/, so the worker ends up requested as
// /assets/maplibre-gl-worker.mjs — a file Rollup never emits on its own,
// since it only sees the ESM source, not this raw worker file as an asset.
//
// The fix is to make that exact path exist as a static file. Copying it
// into public/assets/ makes Vite copy it to dist/assets/ verbatim, which
// works as long as Vite's default output assets directory ("assets") is
// unchanged. Run automatically before every build (see package.json).
import { copyFile, mkdir } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import path from 'node:path';

const here = fileURLToPath(new URL('.', import.meta.url));
const src = path.resolve(here, '../node_modules/maplibre-gl/dist/maplibre-gl-worker.mjs');
const destDir = path.resolve(here, '../public/assets');
const dest = path.join(destDir, 'maplibre-gl-worker.mjs');

await mkdir(destDir, { recursive: true });
await copyFile(src, dest);
console.log('Copied maplibre-gl-worker.mjs into public/assets/');
