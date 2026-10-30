# /data — sources, licences, and how to rebuild

Every dataset in the atlas is listed here with its **source, licence, date
pulled, and the script that builds it**, so refreshing is a matter of rerunning
a script rather than remembering what was done.

Two rules this directory enforces:

1. **Commit the DERIVED artefacts, not the sources.** The deploy workflow runs
   only `npm ci && npm run build` — it has no tippecanoe and cannot cut tiles —
   so `public/tiles/*.pmtiles` and `public/data/*.json` are versioned and served
   as-is. The ~81 MB of Natural Earth source GeoJSON is **not** versioned: it is
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
sh   data/scripts/build-tiles.sh        # PMTiles (needs: brew install tippecanoe)
```

Only the last two steps' outputs are committed. Fonts and icons change rarely and
have their own scripts.

## Current contents

| Dataset | File | Source | Licence | Pulled | Built by |
|---|---|---|---|---|---|
| Countries (paintable) | `../public/tiles/countries.pmtiles` | `ne_10m_admin_0_countries_usa` @ v5.1.2 | **Public domain** | 2026-10-30 | `build-regions.mjs` → `build-tiles.sh` |
| Provinces (paintable) | `../public/tiles/provinces.pmtiles` | `ne_10m_admin_1_states_provinces` | Public domain | 2026-10-30 | same |
| Urban areas (paintable) | `../public/tiles/urban.pmtiles` | `ne_50m_urban_areas` + `ne_50m_populated_places` for names | Public domain | 2026-10-30 | same |
| Adjacency + continents | `../public/data/neighbours.json` | derived from the above | Public domain | 2026-10-30 | `build-neighbours.mjs` |
| Placeholder basemap | `../public/data/placeholder-countries.geojson` | `ne_110m_admin_0_countries` | Public domain | 2026-10-30 | `build-placeholder.mjs` |
| UI fonts | `../public/fonts/*.woff2` | Google Fonts | **SIL OFL 1.1** | 2026-10-30 | `fetch-fonts.sh` |
| App icons | `../public/icons/*.png` | drawn here | — | 2026-10-30 | `build-icons.sh` |

> ⚠️ **The placeholder basemap is only used by `probe.html`** and carries the
> wrong point of view — the 110m file has no POV variant, so it uses Natural
> Earth's de facto POV with Crimea drawn as Russian. The editor uses the
> `_usa` POV tiles. Do not read anything into the placeholder's borders.

### Tile flags that must not change

`build-tiles.sh` deliberately avoids `--coalesce`,
`--coalesce-smallest-as-needed` and `--drop-densest-as-needed`. All three merge
or drop features, and the editor paints regions **by feature id** — a merged
feature cannot be coloured independently and a dropped one disappears from the
map. Size is controlled by simplification alone, and every feature survives:
254 / 4,596 / 2,143 in, the same out.

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
| `scripts/build-tiles.sh` | Cuts the PMTiles archives (needs `brew install tippecanoe`). |
| `scripts/fetch-fonts.sh` | Re-downloads the self-hosted UI fonts and regenerates `public/fonts.css`. |
| `scripts/build-placeholder.mjs` | Builds the probe page's placeholder basemap from Natural Earth 110m. |
| `scripts/build-icons.sh` | Renders the PWA icons from SVG (needs `brew install librsvg`). |
| `scripts/check-deploy.sh` | Smoke-tests the **deployed** site, including byte serving the way a browser asks for it. Run after any deploy or CDN change. |

Run all of them from the repository root.
