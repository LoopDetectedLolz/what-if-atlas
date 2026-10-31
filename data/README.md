# /data — sources, licences, and how to rebuild

Every dataset in the atlas is listed here with its **source, licence, date
pulled, and the script that builds it**, so refreshing is a matter of rerunning
a script rather than remembering what was done.

Two rules this directory enforces:

1. **Commit the DERIVED artefacts, not the sources.** The deploy workflow runs
   only `npm ci && npm run build` — it has no tippecanoe and cannot cut tiles —
   so `public/tiles/*.pmtiles.gz` and `public/data/*.json` are versioned and
   served as-is. The ~81 MB of Natural Earth source GeoJSON is **not** versioned: it is
   reproducible from a pinned tag via `scripts/fetch-sources.sh`.

   Sources that *cannot* be re-fetched by a script are a different matter and do
   get vendored — every Global Energy Monitor download sits behind a
   registration form that mints a short-lived signed URL, so there is no stable
   file URL to automate.
2. **Every value carries its own provenance.** Numeric values are stored as
   `{value, unit, year, source_name, source_url, licence, retrieved, estimate,
   note}` — not as bare numbers. The build fails on a missing provenance field,
   so "every number shows its source and year" is enforced rather than
   remembered.

---

## Rebuilding from a clean checkout

```sh
sh   data/scripts/fetch-sources.sh      # ~81 MB from the pinned v5.1.2 tag
node data/scripts/build-regions.mjs     # normalise, assign stable ids
node data/scripts/build-neighbours.mjs  # adjacency + continent table
node data/scripts/build-labels.mjs      # label anchors for the map's place names
node data/scripts/build-borders.mjs     # cut the outlines into borders and coastline
sh   data/scripts/build-tiles.sh        # PMTiles (needs: brew install tippecanoe)
```

Only the committed outputs matter: `public/tiles/*.pmtiles.gz` and
`public/data/*.json`. Fonts and icons change rarely and have their own scripts.

`build-tiles.sh` takes archive names, so iterating on one does not mean cutting
all five: `sh data/scripts/build-tiles.sh borders subborders`.

## Current contents

| Dataset | File | Source | Licence | Pulled | Built by |
|---|---|---|---|---|---|
| Countries (paintable) | `../public/tiles/countries.pmtiles.gz` | `ne_10m_admin_0_countries_usa` @ v5.1.2 | **Public domain** | 2026-10-30 | `build-regions.mjs` → `build-tiles.sh` |
| Provinces (paintable) | `../public/tiles/provinces.pmtiles.gz` | `ne_10m_admin_1_states_provinces` | Public domain | 2026-10-30 | same |
| Urban areas (paintable) | `../public/tiles/urban.pmtiles.gz` | `ne_50m_urban_areas` + `ne_50m_populated_places` for names | Public domain | 2026-10-30 | same |
| Country borders + coastline | `../public/tiles/borders.pmtiles.gz` | cut out of `countries.geojson` | Public domain | 2026-10-30 | `build-borders.mjs` → `build-tiles.sh` |
| Province borders | `../public/tiles/subborders.pmtiles.gz` | cut out of `provinces.geojson` | Public domain | 2026-10-30 | same |
| Adjacency + continents | `../public/data/neighbours.json` | derived from the above | Public domain | 2026-10-30 | `build-neighbours.mjs` |
| Label anchors | `../public/data/labels.json` | `LABEL_X`/`LABEL_Y` on admin-0, `latitude`/`longitude` on admin-1, `ne_50m_populated_places` | Public domain | 2026-10-30 | `build-labels.mjs` |
| Placeholder basemap | `../public/data/placeholder-countries.geojson` | `ne_110m_admin_0_countries` | Public domain | 2026-10-30 | `build-placeholder.mjs` |
| Fonts (UI **and** map labels) | `../public/fonts/*.woff2` | Google Fonts — Instrument Sans, JetBrains Mono, Noto Sans | **SIL OFL 1.1** | 2026-10-30 | `fetch-fonts.sh` |
| App icons | `../public/icons/*.png` | drawn here | — | 2026-10-30 | `build-icons.sh` |

> ⚠️ **The placeholder basemap is only used by `probe.html`** and carries the
> wrong point of view — the 110m file has no POV variant, so it uses Natural
> Earth's de facto POV with Crimea drawn as Russian. The editor uses the
> `_usa` POV tiles. Do not read anything into the placeholder's borders.

### ⚠️ The tile archives are not gzipped, despite the `.gz`

`public/tiles/*.pmtiles.gz` are plain, uncompressed PMTiles archives. **Do not
gunzip them and do not "correct" the extension.**

PMTiles reads an archive entirely through HTTP range requests. GitHub Pages
gzips any response whose content type it does not recognise — `.pmtiles` is
`application/octet-stream` — and then answers a range request by slicing the
compressed copy, so PMTiles reads garbage and the map renders nothing while
every other asset loads fine. `application/gzip` is a type Pages leaves alone.

Measured, not guessed: `.png`, `.woff2`, `.mp4`, `.zip` and `.gz` all serve
ranges correctly; `.pmtiles`, `.bin` and `.wasm` do not. `.gz` was chosen over
`.png` because nothing in the chain ever transforms it, while a fake PNG would
be silently rewritten if Cloudflare Polish were ever enabled. Full working in
[`../PLAN.md`](../PLAN.md) §8.

Verify after any deploy: `sh data/scripts/check-deploy.sh`.

### Labels are a separate dataset, on purpose

`public/data/labels.json` is 6,092 points — one per country, province and
populated place — carrying **Natural Earth's own label coordinates**, not
centroids computed here. Two reasons, both visible on screen if ignored:

1. MapLibre labels a polygon once **per tile**, so a country spanning several
   tiles would be named several times over, and nothing dedupes it.
2. `LABEL_X`/`LABEL_Y` and admin-1's `latitude`/`longitude` are
   cartographer-placed. A bounding-box centre puts Chile's label in the Pacific.

Each point also carries NE's own label priority as `rank` — `LABELRANK`,
`min_label`, `SCALERANK` by level, lower being more important — which drives
both the placement order and the text size. The reveal schedule is therefore
Natural Earth's judgement, not a hand-tuned table. Full reasoning in
[`../PLAN.md`](../PLAN.md) §9.

### ⚠️ The fonts draw the map, not just the UI

MapLibre v6 rasterizes map labels from the `public/fonts/*.woff2` files directly
through the style's `font-faces` property, so there is no glyph-PBF pipeline and
no font server. That makes the subset list load-bearing: a name whose characters
no subset covers falls back to whatever sans-serif the device has.

**Instrument Sans has no Vietnamese** — Google serves it `latin` and `latin-ext`
only. Natural Earth's Vietnamese province names need U+1EA0-1EF9, so Noto Sans
is self-hosted narrowed to exactly that block. Those 15 characters are the only
ones the two Latin subsets miss across all 5,500 region names.

`fetch-fonts.sh` writes the ranges into `src/map/fonts.generated.ts`. Do not
hand-edit them: Google's split is not the obvious one and a widened range hands
characters to a file that does not contain them.

### The borders are a separate dataset because a border has to fade on its own

MapLibre's opacity is per feature, and a country polygon's outline is one
feature carrying its coastline AND every border it has — fading it takes the
coast with it. So `build-borders.mjs` counts every segment of every ring by how
many regions own it: one owner is coastline, two owners is the border between
them, emitted once rather than twice as the polygons carry it.

Each border feature's id is the PAIR, `FRA|DEU`, and every disjoint chain of one
border carries that same id, so a single `setFeatureState` fades the whole thing.
339 country pairs, 10,769 province pairs.

The script cross-checks itself against `neighbours.json`: the two are built from
the same shared vertices and answer the same question, so a pair in one and not
the other would mean a border that cannot fade or a fill that floods across a
line still drawn. They agree exactly, 339 and 10,769, in both directions.

⚠️ **`subborders` has no coastline, deliberately.** The province coastline is the
same line as the country coastline and is never seen underneath it — that is
nearly half the province border data saved for nothing visible.

⚠️ **The border archives must be cut with the same tippecanoe settings as the
polygons they belong to**, or the line drifts off the colour boundary it is
drawing. `borders` matches `countries`, `subborders` matches `provinces`. Full
reasoning and the measured drift in [`../PLAN.md`](../PLAN.md) §10.

### Tile flags that must not change

`build-tiles.sh` deliberately avoids `--coalesce`,
`--coalesce-smallest-as-needed` and `--drop-densest-as-needed`. All three merge
or drop features, and the editor paints regions **by feature id** — a merged
feature cannot be coloured independently and a dropped one disappears from the
map.

⚠️ **And `--no-tiny-polygon-reduction`, which is the one that was missed.**
tippecanoe reduces polygons smaller than about a pixel at low zoom by default.
This README used to claim "every feature survives: 254 / 4,596 / 2,143 in, the
same out", and that was wrong — it counted distinct features across the whole
archive rather than per zoom. Measured per zoom before the fix:

| archive | z0 | z1 | z2 | z3 | z4 | z5 |
|---|---|---|---|---|---|---|
| countries, of 254 | −29 | −16 | −6 | −3 | −3 | −3 |
| provinces, of 4,596 | — | — | −170 | −64 | −14 | −2 |

Vatican City was absent from **every** zoom and could never be painted at all.
With the flag, countries are complete from z5 and provinces from z3, and the
cost is 0.02 MB per archive. Full account in [`../PLAN.md`](../PLAN.md) §14.

### The `+00?` province ids are upstream's, not corruption

Three provinces carry ids like `JEY+00?`, `MCO+00?` and `IMN+00?` — Jersey,
Monaco and the Isle of Man. That `+00?` is Natural Earth's own literal
`adm1_code` for crown dependencies and microstates that have no real admin-1
subdivision, not a build bug. They stay unique because the ADM0 prefix differs,
so painting keys on them correctly. Do not "clean" them: the id is the paint
key, and rewriting it would orphan any saved scenario that used it.

### Why `ADM0_A3` and not `ISO_A3`

`ADM0_A3` is the only country field in Natural Earth that is both unique and
stable across versions. Verified on the 110m file already in this repo:
`ADM0_A3` is unique 177/177, while `ISO_A3` carries 5 `-99` values at that
scale alone. Natural Earth uses the literal string `-99` for missing text and
the number `-99` for missing numerics across a dozen fields, so every reader
guards for it — otherwise `-99` ends up on screen in front of the learner.

---

## Planned (by milestone)

Recorded now so the licence position is decided before any code depends on it.
Full reasoning in [`../PLAN.md`](../PLAN.md) §4.

### Clean — redistributable, ships freely

| Dataset | Licence | For |
|---|---|---|
| Natural Earth 10m (`_usa` POV, admin1, places, disputed areas) | Public domain | The real basemap (M1) |
| OpenHistoricalMap | **CC0** | WWII de jure boundaries, day-precision dates (M5) |
| Wikidata | CC0 | Alliance membership, camp coordinates (M3, M5) |
| GEBCO 2026 | Public domain | Paleo-coastline thresholding (M6) |
| USGS Mineral Commodity Summaries 2026 | CC0 | Lithium, cobalt, rare earths (M3) |
| USGS PP1802 | Public domain | Critical-mineral mines — 2017, approximate, no owner field (M3) |
| EIA bulk `INTL.zip` | Public domain | Oil/gas/coal production, coal reserves — **keyless** (M3) |
| World Bank `NY.GDP.MKTP.CD`, `SP.POP.TOTL` | CC BY 4.0 | GDP, population (M3) |
| factbook.json | CC0 mirror of public-domain data | Country facts, military prose (M3) |
| Ember yearly CSV | CC BY 4.0 | Electricity capacity **and** generation (M3) |
| Dalton et al. 2023 NADI-1 | CC BY | Ice-sheet extents, 49 timesteps 25–1 ka (M6) |
| CRC806 Paleocoastlines | CC BY 3.0 | 23 land masks, 200 ka → present (M6) |
| flag-icons 7.6.0 | MIT | Flags (M3) |

> ⚠️ **Mirror CRC806 early.** Its host page currently reads *"Currently offline,
> some contents may be unavailable."* It is the best ready-made Pleistocene
> shoreline set and covers Doggerland and the Mediterranean, precisely where
> naive GEBCO thresholding is least trustworthy.

> ⚠️ **factbook.json's upstream is dead.** The CIA retired the World Factbook on
> 4 February 2026 and every cia.gov Factbook URL now redirects to a farewell
> page. Pin the mirror to a **commit SHA**, record it in the output's provenance
> block, and label the layer "CIA World Factbook, final edition, January 2026".

### Attribution required, handle with care

- **Global Energy Monitor** (CC BY 4.0) — the Global Integrated Power Tracker is
  the spine of the power-plant layer. Every download is behind a form (name,
  email, organisation, sector, country, and a **100-character minimum** "how will
  you use this" field) returning a short-lived signed URL. There is **no stable
  public file URL**, so GEM is vendored and refreshed by hand, with the release
  month recorded per file.
  ⚠️ **Filter the TransitionZero rows** out of the solar tracker — records with a
  non-empty `TZ ID` are CC BY-NC 4.0, not CC BY 4.0.
- **Mapterhorn / AWS terrarium** DEM — attribution spans a dozen datasets, four
  CC BY versions, two Open Government Licences and a NOAA not-for-navigation
  restriction. `© Mapterhorn` is the minimum, not the whole obligation.

### Restricted or excluded

- **SIPRI** — out of the project entirely, since defence budgets are out of
  scope. Adding spending back means writing to SIPRI first (their 10% extraction
  rule). ⚠️ The World Bank's `MS.MIL.*` indicators are **SIPRI-encumbered**
  despite displaying a CC BY 4.0 badge, so they are not a workaround.
- **FAS / Bulletin of the Atomic Scientists** — no permissive licence; the
  Bulletin bars automated collection and prohibits AI/ML training on its
  content. Nuclear figures are cited and linked, never scraped or redistributed.
- **USHMM** — cite-only; their terms also prohibit using Museum content to train
  any machine-learning model.
- **OpenStreetMap** — avoided entirely in the data layers. Any OSM-derived file
  would be a Derivative Database under ODbL share-alike. GEM already supplies
  pipeline routes under CC BY 4.0, so the project keeps a single-licence story.
- **`aourednik/historical-basemaps`** — GPL-3.0, and the author has separately
  stated commercial use is not permitted, so the permission set contradicts
  itself. Cross-check only; never in derived data.
- **CShapes 2.0** — verified useless here: Austria is one unbroken geometry
  1919–2019 (no Anschluss), Poland one geometry to 1945-05-07 (no 1939
  partition). Also CC BY-NC-SA.
- **Euratlas** (centennial years only — no 1938/1939/1945 at any price),
  **Energy Institute Statistical Review**, **IRENA** (WAF blocks scripted
  access), **IISS** (excluded by project constraint).

---

## Scripts

| Script | Does |
|---|---|
| `scripts/fetch-sources.sh` | Downloads the Natural Earth layers at the pinned tag into `data/raw/`. Idempotent. |
| `scripts/build-regions.mjs` | Normalises the three paintable levels and assigns stable ids. |
| `scripts/build-neighbours.mjs` | Builds the adjacency table from shared vertices, plus the continent lookup. Self-checking. |
| `scripts/build-labels.mjs` | Builds the map's label anchors from Natural Earth's own label coordinates. |
| `scripts/build-borders.mjs` | Cuts the region outlines into shared borders and coastline, so a border can fade on its own. Self-checking against the adjacency table. |
| `scripts/build-tiles.sh` | Cuts the PMTiles archives (needs `brew install tippecanoe`). Takes archive names to cut just those. |
| `scripts/fetch-fonts.sh` | Re-downloads the self-hosted fonts, regenerating `public/fonts.css` **and** `src/map/fonts.generated.ts`, which the map's `font-faces` are built from. |
| `scripts/build-placeholder.mjs` | Builds the probe page's placeholder basemap from Natural Earth 110m. |
| `scripts/build-icons.sh` | Renders the PWA icons from SVG (needs `brew install librsvg`). |
| `scripts/check-deploy.sh` | Smoke-tests the **deployed** site, including byte serving the way a browser asks for it. Run after any deploy or CDN change. |

Run all of them from the repository root.
