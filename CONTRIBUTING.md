# Contributing to Kanda

Thanks for wanting to help. Kanda (කන්ද, Sinhala for "mountain") is a
peak-identification and orientation tool for Sri Lanka — you stand on a summit,
look around, and the app names what you're seeing. Every design decision follows
from that use case.

This is a hobby project. Issues and PRs are welcome; please keep changes focused
and in the spirit of the app.

## Getting set up

```bash
git clone https://github.com/<owner>/kanda.git
cd kanda
npm install
```

### Quick start (remote tiles)

```bash
npm run dev
```

With no `.env.local`, the app streams elevation tiles live from the AWS Open
Data bucket. It works, but it re-downloads ~2,000 tiles per session and feels
slow. Fine for a first look or a UI-only change.

### Full local pipeline (recommended)

Everything under `public/tiles/` is gitignored — the scripts are the
reproducible artifact, not the binaries. After a fresh clone:

```bash
npm run fetch:terrain      # ~54 MB elevation pyramid -> public/tiles/terrain/
npm run repair:dem         # repair DEM spikes/pits + one smooth pass
npm run generate:texture   # DEM + forest -> texture tile pyramid (~10 min)
npm run pack:texture       # -> public/tiles/texture.pmtiles
npm run pack:pmtiles       # -> public/tiles/terrain.pmtiles
npm run fetch:glyphs       # self-hosted map label glyphs -> public/fonts/
```

Then:

```bash
cp .env.local.example .env.local   # sets VITE_TILE_MODE=local
npm run dev
```

`.env.local` with `VITE_TILE_MODE=local` (or `pmtiles`) should always exist in
development — without it the app silently runs in slow remote mode.

## Before you open a PR

All four must pass — CI runs the same checks on every PR:

```bash
npm run lint     # oxlint
npx tsc -b       # typecheck
npm test         # vitest — ramp monotonicity + solar math
npm run build    # tsc + vite build
```

## Branch naming

Branch off `main`:

- `feature/<short-name>` — new capability
- `bugfix/<short-name>` — fixing broken behaviour
- `docs/<short-name>` — docs only

## Pull requests

- One logical change per PR.
- Fill in the PR template: summary, linked issue, test plan, screenshots for
  anything visual.
- `main` is protected: a PR, passing CI, and one approval are required to merge.
- Map/camera work needs a screenshot or a short screen capture — screenshots
  lie less than assumptions here.

## Code conventions

- **`CLAUDE.md` is the source of truth for architecture and the traps.** Read it
  before touching the map code — it carries decisions that have already cost
  time.
- **MapLibre is used imperatively inside `useEffect`, never `react-map-gl`.**
  Terrain and camera work fight declarative wrappers. React earns its place in
  the UI panels, not in the map instance.
- `src/config/tiles.ts` is the single choke point for tile URLs and camera
  defaults. Change providers there and nowhere else.
- The map's whole look is data in `src/skins/` — no palette lives in
  `buildStyle.ts`.
- Design tokens are CSS custom properties in `src/index.css`; read `var(--ink)`,
  never a raw hex.
- Match the style of the code around you — comment density, naming, idiom.
- No new runtime dependencies without a reason in the PR description. The app
  makes zero external API calls at runtime and has no API keys; keep it that
  way.

## Reporting bugs / requesting features

Use the issue templates. For bugs, include steps to reproduce, what you
expected, what happened, and your browser + OS. Most users are on phones —
mention if it's mobile-specific.

## Code of Conduct

This project follows the [Contributor Covenant](CODE_OF_CONDUCT.md). By
participating you agree to uphold it.
