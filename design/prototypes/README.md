# three.js look prototypes

Reference implementations for Phase 7 (see `docs/plans/phase-7-threejs.md`).
They are single-file pages: `/*DEM*/` is a placeholder for a script that sets
`window.KANDA_DEM` (heightmap + water/forest masks + peaks for the Knuckles
Range), produced by `extract.mjs` then `extract2.mjs` from the local terrain
tiles. Inline the output in place of the placeholder to run one.

- `look-lab.src.html` — Ember / Drift / Papercraft
- `toon-lab.src.html` — Clay / Block World / Arena / Ink / Wild

Shipping skins: Arena (default), Ember, Clay, Block World, Ink.
The extract scripts use absolute paths from the machine they were written on;
adjust before reuse.
