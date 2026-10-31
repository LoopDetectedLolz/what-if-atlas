# What-If Atlas — architecture and milestone plan

> ## ⏸️ Scope change, 2026-10-30
>
> **The recordings are parked. The editor is the product.** WWII and human
> origins, the keyframe format, the player and the recorder are all on ice — the
> research behind them is kept below (§4 historical borders, §5 the two
> recordings) so nothing has to be re-learned, but none of it is being built.
>
> **The painting model changed as a result**, and it is now the heart of the app.
> Paint applies to REGIONS, not pixels, at a granularity that follows the zoom:
> zoomed out the smallest paintable unit is a whole country, zoom in and it
> becomes a province, then an urban area. Colour cannot cross a border because
> there is no way to express it.
>
> Decided 2026-10-30, and both already built:
>
> - **Coarse paint goes underneath.** One colour map per level, rendered coarse
>   beneath fine. Colouring a country can never destroy the provinces coloured
>   inside it.
> - **Hatching is stripes on one world grid**, so hatched neighbours line up
>   seamlessly and read as a single mask.
>
> See §3a for what the editor actually does now.

Every factual claim below was researched live and then independently fact-checked by a
second agent against primary sources. Where the two disagreed, the fact-checker won.
**9 claims from the first pass were wrong, outdated, or unverifiable** — those corrections
are folded in and flagged with ⚠️ where they changed a decision.

---

## 1. What changed from your brief, and why

Six things in the brief don't survive contact with the sources. I'd rather say so now
than discover them at milestone 5.

| Your brief | What research found | What I propose |
|---|---|---|
| `aourednik/historical-basemaps` for WWII borders | **GPL-3.0**, and the author has separately stated in writing that commercial use is not permitted — so the actual permission set is self-contradictory. Whether GPL copyleft even reaches a GeoJSON coordinate file is an open question in the repo's own issue #74, unanswered. | **Use OpenHistoricalMap instead (CC0).** It has *day-precision* validity dates for exactly the entities we need — Deutsches Reich in 10 phases from 1935-03-01 to 1945-05-08, État français in 3, Militärverwaltung in Belgien und Nordfrankreich, Repubblica Sociale Italiana. Keep historical-basemaps as a visual cross-check only, never in derived data. |
| Military "major equipment counts" | There is **no open, non-IISS source** for tank/aircraft/ship inventories. The Factbook's equipment field is qualitative prose with zero numbers. Wikidata has no quantitative military properties at all. SIPRI's arms-transfer TIV measures *volume of transfers delivered*, not inventories — SIPRI says explicitly it must not be read as one. | **Drop equipment counts from scope** (confirmed 2026-10-30). A real cut from your spec, but it also makes a "who would win" ranking impossible to build even by accident, which you wanted. |
| Active and reserve personnel as numbers | World Bank `MS.MIL.TOTL.P1` **is IISS data** (the source you ruled out) and has no values after 2020. NATO's own figures are in an image-only PDF — 15 pages, zero embedded fonts, the tables are pictures. | Ship the Factbook's **prose** verbatim with its own hedges ("information varies; approximately…"), as a text field. Parsing it into a number would strip exactly the uncertainty the source insisted on. |
| CIA World Factbook as a live source | ⚠️ **The CIA retired the Factbook on 4 February 2026.** Every `cia.gov` Factbook URL now redirects to a farewell page. It will never be updated again. | Use the `factbook.json` community mirror (CC0), **pinned to a commit SHA**, and label the layer in the UI as "CIA World Factbook, final edition, January 2026". |
| World Bank for military spending (CC BY 4.0) | ⚠️ **Trap.** `MS.MIL.XPND.GD.ZS`, `MS.MIL.XPND.CD` and `MS.MIL.XPND.ZS` all carry *"SIPRI terms and conditions"* in DataBank's per-indicator metadata — including SIPRI's 10% extraction limit — regardless of the friendly CC BY 4.0 badge shown on some pages. | Moot now — **defence budgets and % of GDP are out of scope** (your call, 2026-10-30). From the World Bank use **only** `NY.GDP.MKTP.CD` and `SP.POP.TOTL`, which are genuinely CC BY 4.0. |
| Military "defense budget and % of GDP" | Every route is either SIPRI-encumbered (SIPRI itself, the World Bank mirrors) or a dead upstream (Factbook, retired Feb 2026). | **Omitted entirely** (your call). This removes SIPRI from the project completely — no permission email, no 10% rule, no licence risk in the military layer at all. |
| Oil and gas **proved reserves** per country | No licence-clean source exists. EIA's international set has coal reserves only. The Energy Institute Statistical Review forbids extensive reproduction and bans redistributing S&P-sourced data. OPEC's bulletin is all-rights-reserved. | Ship GEM's field-level reserves aggregated to country totals, labelled **"reserves in tracked fields"** — licence-clean but *methodologically different* from proved reserves, so it must not be labelled as them. Or omit. |

One more, smaller: **Natural Earth has not shipped a release since May 2022.** No file
reflects the 2022 Russian annexation claims over Donetsk, Luhansk, Zaporizhzhia and
Kherson, or the 2023 dissolution of Nagorno-Karabakh. Borders are frozen at mid-2022 and
the app should say so.

---

## 2. Hosting — and plainly what stays discoverable

**Recommendation: a separate public repo, deployed by GitHub Actions, with no CNAME file.**

The mechanics, confirmed against GitHub's own docs and then tested live against your
account:

- GitHub's docs: *"if you set a custom domain for a user site…, that same custom domain
  will be used for all project sites owned by the same account."* So a repo named
  `what-if-atlas` serves at **`networkfieldnotes.com/what-if-atlas/`** automatically.
- I tested it live today: `https://loopdetectedlolz.github.io/some-project/` returns
  **HTTP 301** to `networkfieldnotes.com/some-project/`. So the `github.io` address is
  *not* a separate address you could keep quiet — everything funnels to the custom domain.
- **Do not put a CNAME file in the atlas repo.** GitHub enforces that a domain is unique
  across all Pages sites, and your user-page repo already holds `networkfieldnotes.com`.
  Adding it to a second repo is the single most likely way to take the blog offline.
  (With an Actions deploy, CNAME is ignored entirely anyway.)

### Separate repo vs subfolder in the blog repo

They land on the **same origin**, so this is a question of repo hygiene, not privacy:

| | Separate repo | Subfolder in blog repo |
|---|---|---|
| URL | `networkfieldnotes.com/what-if-atlas/` | `networkfieldnotes.com/atlas/` |
| Origin | identical — **shares the blog's storage quota** | identical |
| Deploy | own Actions workflow, own cadence | must not collide with `build-blog.py` |
| Risk | none to the blog | a bad build script run could touch it |

I recommend **separate repo**: independent deploy, independent history, and no chance of
`build-blog.py` or a stray `git clean` touching it. The cost is one more repo on your
public profile.

### What stays discoverable if the repo is public

Straight answer, no hedging:

**Crawlable and indexable by Google** — the repo page itself, your public profile listing
it, the README's text, the releases page, and the Pages URL. **Not crawlable** — forks,
the network graph, commit history, the file tree, blame, raw files, archives, and the
profile's `?tab=repositories` view. **Any logged-in GitHub user** can find the source via
code search, regardless of crawling.

**The repo name is the URL path.** There is no way to decouple them. So "unlisted" and
"memorable" pull against each other, and whatever name you pick is visible on your profile.

**Going private does not help.** Access-controlled Pages requires an organisation on
GitHub Enterprise Cloud. On a personal account, a private repo still serves a fully public
site — you'd pay for Pro and buy only source privacy, not an unlisted site.

### noindex, done in the right order

- `<meta name="robots" content="noindex, nofollow">` in the atlas HTML. **This is the only
  mechanism that works on Pages alone**, and it covers HTML only — not the PMTiles or JSON.
- An `X-Robots-Tag` response header via a **Cloudflare Transform Rule** on
  `starts_with(http.request.uri.path, "/what-if-atlas")` — this is the only way to cover
  the data files. Needs your Cloudflare dashboard — see §7, Still open.
- **Do not add a `robots.txt` Disallow yet.** Disallow and noindex defeat each other: if
  crawlers can't fetch the page they never see the noindex, and a URL that leaks by other
  means can stay indexed as a bare URL with no way to push it out. Serve noindex first;
  add Disallow later, once it has dropped out of the index.
- A `robots.txt` inside the atlas repo is **pointless** — per RFC 9309 it only has effect
  at the host root. The rules belong in the blog's root `robots.txt`, which means
  `build-blog.py:1681` — it rewrites that file from a hardcoded string on every build, so
  a hand-edit to the committed file is silently erased on the next run.
- The blog's `sitemap.xml` is a fixed list plus posts, so the atlas never appears in it.
  Nothing to do, but worth not breaking.

### Hard limits that shape the tile budget

- **100 MiB per file** — a hard push block, not a warning. Any PMTiles archive must stay
  under it, or be tracked with Git LFS *and* deployed via Actions with `lfs: true`.
  (Branch-based publishing with LFS silently serves a ~130-byte pointer file, which
  surfaces as a baffling PMTiles parse error.)
- **1 GB published site** — hard cap.
- **100 GB/month bandwidth** — soft. Irrelevant for one learner; a Cloudflare cache rule
  on the atlas path absorbs repeat tile reads if it's ever shared wider.
- **Range requests work.** Confirmed: Pages returns proper `206` responses both directly
  and through Cloudflare. PMTiles will work.

### Deploy workflow

Pinned to the versions that are actually current today. ⚠️ GitHub's *own* starter workflow
is three majors behind on three of four actions — don't copy it.

```yaml
# .github/workflows/deploy.yml
name: Deploy atlas to Pages
on:
  push:
    branches: [main]
  workflow_dispatch:
permissions:
  contents: read
  pages: write
  id-token: write          # required: deploy-pages uses OIDC
concurrency:
  group: "pages"
  cancel-in-progress: false
jobs:
  build:
    runs-on: ubuntu-latest
    steps:
      - uses: actions/checkout@v7
        with: { lfs: true }
      - uses: actions/setup-node@v7
        with: { node-version: 22, cache: npm }
      - run: npm ci
      - run: npm run build
      - uses: actions/configure-pages@v6
      - uses: actions/upload-pages-artifact@v5
        with: { path: dist }
  deploy:
    needs: build
    runs-on: ubuntu-latest
    environment:
      name: github-pages
      url: ${{ steps.deployment.outputs.page_url }}
    steps:
      - id: deployment
        uses: actions/deploy-pages@v5
```

Set the repo's Pages source to **GitHub Actions** (not "Deploy from a branch").
Your `gh` token is currently invalid — `gh auth login` before this milestone.

---

## 3. Architecture

### Stack, pinned

| | Version | Note |
|---|---|---|
| MapLibre GL JS | **^6.16** | Not 5.x. Four of five Safari/iOS fixes shipped in 6.10–6.16; **6.16 specifically fixes maps that stop loading after iOS kills background workers** — exactly what an iPad tab left open over lunch hits. v6 is ESM-only; style-spec v25 errors on legacy expressions. |
| tippecanoe | 2.79.0 (brew) | The maintained `felt` fork. Emits PMTiles directly with `-o out.pmtiles` — no convert step. |
| pmtiles CLI | 1.31.2 (brew) | For `pmtiles show --metadata` (the only way to read the `vector_layers` ids your style's `source-layer` must match) and `pmtiles verify`. Run both before every deploy. |
| Natural Earth | **pinned to tag v5.1.2** | Vendored into the repo. ⚠️ `naturalearthdata.com`'s own download links return HTTP 500 today; `naciscdn.org` serves only zipped shapefiles. Fetch once from `raw.githubusercontent.com` at the pinned tag and commit it — never fetch at CI time. |
| flag-icons | pinned **7.6.0** | MIT. Trim `$flag-icons-included-countries` to the codes actually used — the full package is 3.99 MB / 542 SVGs. Don't claim the artwork is public domain; the project says MIT and its upstream was deleted. |

### Layout

```
what-if-atlas/
├── index.html
├── vite.config.ts              base: '/what-if-atlas/'
├── src/
│   ├── map/
│   │   ├── map.ts              ONE Map for the app's lifetime
│   │   ├── style.ts            light atlas style spec
│   │   ├── protocols.ts        pmtiles protocol + IndexedDB Source
│   │   └── layers/             countries, admin1, places, borders,
│   │                           hillshade, hatching, strokes, energy
│   ├── state/
│   │   ├── store.ts            command stack (apply/invert) = undo/redo
│   │   ├── scenario.ts         the saved document
│   │   └── persistence.ts      IndexedDB + export/import .json
│   ├── tools/                  palette, pen, eraser, occupation
│   ├── panels/                 country, military, energy, sources
│   ├── bookmarks/
│   ├── recording/              format, player, recorder
│   └── ui/                     glass.css, layout.css
├── data/
│   ├── README.md               source, licence, date pulled, build script
│   ├── raw/                    vendored sources (NE GeoJSON, GEM XLSX)
│   ├── scripts/                one build script per dataset
│   └── out/                    generated JSON/GeoJSON
├── tiles/                      built PMTiles
├── recordings/
│   ├── README.md               the format, documented
│   ├── wwii.json
│   └── human-origins.json
├── public/fonts/               self-hosted woff2 (see below)
└── .github/workflows/deploy.yml
```

### Base map

**Point of view: `ne_10m_admin_0_countries_usa`.** The reason is practical, not political —
it is effectively gap-free. The `_iso` and `_tlc` files leave the whole of Jammu &
Kashmir, the whole of Arunachal Pradesh, Crimea and the Golan as **sea-coloured holes**,
and that's a trap precisely because a spot-check passes: Delhi, Haifa and Dibrugarh all
resolve fine while Kashmir silently renders as ocean.

The app must **say** this is a point of view, not neutrality — Natural Earth names the file
that way deliberately. The consequences a sharp student will notice: Northern Cyprus drawn
inside Cyprus, Somaliland inside Somalia, Kosovo as a country, the Golan inside Israel
(the post-2019 US position, not the UN's). That goes on a "How this map draws borders" page.

Two refinements that turn the political choice into the teaching moment you asked for:

- Overlay `ne_10m_admin_0_disputed_areas` (99 polygons) and the disputed boundary lines,
  styled as dashed + hatched with an info note. Natural Earth explicitly invites this:
  *"Please feel free to mashup our disputed area themes."*
- The default countries file already carries `FCLASS_*` and `ADM0_A3_*` columns for **33
  points of view in one 13 MB file**. So "how would China draw this?" is a toggle, not 31
  extra downloads — tapping Taiwan can show `FCLASS_CN='Admin-1 states provinces'`. This
  is arguably the best civics feature available here for nearly free.

⚠️ **Subtlety that would otherwise bite:** no 50m or 110m POV file exists. Shipping 110m at
low zoom would silently flip the student back to the de facto POV — Crimea would change
colour as they zoomed out. So the 10m `_usa` file gets simplified **by us** with mapshaper,
and one consistent POV serves every zoom.

Also: `ne_10m_admin_0_countries_usa` has **no polygon over the Siachen Glacier**. Patch it
from the default file deliberately, rather than having a student find the hole.

**Keys.** Join on `ADM0_A3` for countries — the only country field that is both unique
(258/258) and stable across versions. `adm1_code` for provinces. **Never** `ISO_A2`/`ISO_A3`
(22 `-99` values). Natural Earth uses the literal string `-99` for missing text and the
number `-99` for missing numerics across a dozen fields, so one guard helper gets used
everywhere — otherwise a raw render puts "-99" on screen in front of the learner.

**City reveal** rides on `MIN_ZOOM`, a fractional zoom Natural Earth authored for exactly
this purpose (1.7–9 across 19 values, no nulls):
`["<=", ["get","MIN_ZOOM"], ["zoom"]]`. Layered capitals (`ADM0CAP==1`) → major cities
(`SCALERANK<=2`) → towns (`SCALERANK>=6`). Ship **50m** places (1,251 features, 3.35 MB),
not 10m (7,342, 19.4 MB) — for `SCALERANK` 0–4 the two are equivalent and 50m keeps all
202 capitals.

**Hillshade without 3D terrain.** `hillshade` and `setTerrain` are independent in MapLibre,
so we get the shaded atlas look while skipping the entire expensive terrain pipeline
(render-to-texture drapes, depth framebuffers, DEM raycasts). There is **no
`hillshade-opacity`** — fade it in with `hillshade-exaggeration` interpolated on zoom, and
use `hillshade-method: 'igor'`. DEM source: Mapterhorn (terrarium, 512px, CORS-open,
Cloudflare R2) with AWS terrarium as fallback. ⚠️ Mapterhorn's usable **maxzoom is 13, not
12** — verified by probing tiles over Mt Rainier (z13 → 200, z14 → 404).

Both DEM endpoints are **gifts, not services**: AWS's own docs say the S3 tiles are "meant
for efficient networking with EC2 resources only" and aren't behind CloudFront; Mapterhorn
is a volunteer project with no SLA. Self-hosting is off the table — the planet archive is
**331 GiB at z0–12** against a 1 GB site cap.

### The fading shared borders

**Built.** The headline feature: colour two neighbours the same and the line between them
fades out over 300 ms, so the pair reads as one bloc. Coastlines never fade. Full account in
§10 — what follows is the shape of it.

- **Build time:** the region outlines are cut apart into shared borders and coastline, each
  border its own feature carrying a PAIR id (`FRA|DEU`). Two archives, `borders` from the
  country file and `subborders` from the province file, each cut with the same tippecanoe
  settings as the polygons it belongs to so the line cannot drift off the colour boundary.
  Measured: median 0 px of drift, worst 0.9 px, at every zoom including overzoom.
- **The fade itself:** numeric feature-state eased in a `requestAnimationFrame` loop —
  `'line-opacity': ['coalesce', ['feature-state','op'], 1]` — smoothstepped from 1 to 0.06
  over 300 ms. **Not** `line-opacity-transition` with a boolean feature-state (proven not to
  interpolate), and **never** a `match` expression rebuilt per frame with `setPaintProperty`
  (proven to invalidate the whole layer).
- **Bulk changes snap instead of easing.** Past 80 borders moving at once — a continent
  fill — the change is applied directly. Easing hundreds of borders would mean hundreds of
  paint-array uploads a frame to animate a detail nobody is watching, and a bulk operation
  is not something the user is watching a transition of.

⚠️ **The cost model this plan carried was wrong**, and §10 corrects it: MapLibre batches
feature-state changes and applies them once per frame, so the cost scales with the number of
TILES touched, not with the number of `setFeatureState` calls. The per-frame cost on an iPad
is still **not measured**. It remains the first thing the performance probe measures.

### Pen and Apple Pencil

⚠️ The most important correction in the whole research pass: **the pen gate must be built
on Touch events, not Pointer Events.** MapLibre listens to `touchstart`/`touchmove`/
`mousedown` on `map.getCanvasContainer()` — it never sees Pointer Events at all. So:

- **Gate** with WebKit's `Touch.touchType`:
  `map.on('touchstart', e => { const cs=[...e.originalEvent.changedTouches];
  if (cs.length && cs.every(t => t.touchType==='stylus')) e.preventDefault(); })`.
  `MapTouchEvent.preventDefault()` is documented to suppress DragPan — so pencil contacts
  don't pan the map, while finger contacts still reach MapLibre's gesture handlers normally.
- **Draw** from Pointer Events (`pointerType === 'pen'`) onto an overlay `<canvas>` sibling
  above the map canvas, `pointer-events: none`, `touch-action: none`.
- Feature-detect everything: `getCoalescedEvents` (Safari 18.2+) for sub-frame samples,
  `'altitudeAngle' in e`, `pressure`.

**This rests on behaviour no spec defines.** The Pointer Events spec explicitly declines to
say how Pointer and Touch events interleave on a UA supporting both — so whether WebKit
keeps delivering pen `pointermove` *after* you `preventDefault()` the stylus `touchstart`
is genuinely unknown. **Hence milestone 0:** a 30-line test page on the real iPad, before
any real code. If WebKit doesn't cooperate, the fallback is a pen/pan mode toggle, which
eliminates the problem entirely — and that is the agreed fallback (§7).

Also expect `pointercancel`: it *must* fire when the browser takes the viewport for
pan/zoom and *may* fire for palm rejection. A resting palm cutting a stroke mid-flight is
documented behaviour, so strokes commit incrementally rather than only on `pointerup`.

**Stroke geometry.** Width is set in screen pixels at draw time, converted to metres at
that zoom, the polyline buffered, then **clipped to the land mask** so it can never touch
ocean. Stored as GeoJSON polygons — anchored to the ground, correct at every zoom.

### Occupation hatching

MapLibre has no native hatch pattern. Pre-render one diagonal-hatch sprite per palette
colour at build time and select it with a `match` on the occupier, as `fill-pattern` over
the base fill. Avoids both runtime canvas work and per-frame pattern generation.

### Panels, and the glass problem

Your design system ports directly — the tokens, three glass levels, the single easing
`cubic-bezier(0.32,0.72,0,1)`, and the rule that only opacity and transform animate (which
the border fade happens to obey exactly).

Two adaptations:

1. **The map is light, your chrome is dark.** `--text` is near-white on 7%-white glass —
   illegible over a white map. Your Academy theme already set the precedent (`body.acad`
   swaps in near-black glass), so the atlas gets a `body.atlas` variant the same way rather
   than a second design system.
2. ⚠️ **Keep `backdrop-filter` off anything overlapping the moving map.** WebKit's own
   documentation says it "forces the engine to perform more rendering passes" and to use it
   "only where it is most necessary" — and a MapLibre canvas repaints every frame during a
   pinch, so an overlapping blurred panel re-blurs every frame *by construction*. Nobody
   has published numbers for this. Mitigation: the sidebar gets a near-opaque background
   (your `.panel` fallback, already in the system), and blur is enabled only on floating
   panels while the map is idle.

The 24-colour map palette is a deliberate exception to "don't add a new colour" — it's
content, not chrome. I'd note that in `DESIGN-KIT.md` rather than leave it as a silent break.

**Layout by size classes, not orientation.** Apple's HIG (updated 2026-09-09) says outright
*"Determine layout based on size classes, not device type or orientation"* and now lists
resizable iPad windows as a characteristic apps must handle — so iPadOS 26 can make the app
any width at any time, and a portrait/landscape plan would break. Container queries and
width breakpoints, `dvh`/`svh` units, `env(safe-area-inset-*)`.

**Fonts self-hosted.** Your blog pulls Instrument Sans and JetBrains Mono from the Google
Fonts CDN; an offline PWA can't. Both are OFL, so self-hosting as woff2 is permitted.

### Offline — and the part that will quietly break

⚠️ **The Cache API cannot store a 206 response.** `Cache.put()` rejects partial responses
by spec, and PMTiles works entirely by HTTP Range requests. Workbox's own docs confirm a
range-requested asset will never populate the cache at runtime. So the obvious
service-worker approach is a dead end.

Instead, implement the pmtiles `Source` interface against IndexedDB:
`class IdbSource implements Source { getBytes(offset, length) }`, slicing a stored Blob.
Two tiers:

- **z0–z5 world archive** (~100–150 MB) as the offline floor, downloaded on an explicit tap
  after `navigator.storage.persist()` succeeds.
- **z6+ streamed** from Pages via the normal FetchSource.

⚠️ **Home Screen install has to be first-class onboarding, not an afterthought.** WebKit's
tracking-prevention policy deletes IndexedDB, Cache Storage and service worker
registrations after **7 days without interaction** — and *"the first-party domain of home
screen web applications is exempt."* A learner who uses the atlas from a Safari tab will
silently lose a 150 MB download. Since iPadOS 26 there are zero installability
requirements, so installing is just the Share sheet — but the app has to ask.

No source gives a real measured `navigator.storage.estimate()` figure on iPadOS; the 1 GB,
500 MB, 50 MB and 38.7 GB numbers in circulation are all unsourced. WebKit documents only
percentages of total disk. So the offline budget gets measured on the actual device, not
assumed.

### Memory is the real iPad risk, not frame rate

Open MapLibre issue #7667: iOS kills the WebView as MapLibre memory grows **120–250 MB per
load cycle**, with low-RAM devices dying after 3–6 reloads. An iPad left open across
sessions, or a dev loop that reloads constantly, is the exact reported trigger. Mitigations
are structural, so they go in from day one: exactly **one** Map for the app's lifetime,
`map.remove()` on teardown, `removeProtocol('pmtiles')` when the last map goes, a bounded
`maxTileCacheSize`, `pixelRatio: Math.min(devicePixelRatio, 2)`, `antialias: false`.

---

## 3a. The editor's paint model

### Snap levels

| Level | Source | Features | Active from zoom | Stable key |
|---|---|---|---|---|
| Country | `ne_10m_admin_0_countries_usa` | 254 | 0 | `ADM0_A3` |
| Province | `ne_10m_admin_1_states_provinces` | 4,596 | 4.5 | `adm1_code` |
| City | `ne_50m_urban_areas` | 2,143 | 8 | synthesised `U####` |

The level follows the zoom and can be pinned by hand.

Three facts from the data that shaped this:

- **There is no global county level.** `ne_10m_admin_2_counties` is 3,224
  features and every one is American. So "cities" means built-up **urban areas**,
  the only global city polygons Natural Earth has.
- **Urban areas carry no id and no name** — all 2,143 have `name: null`. Ids are
  synthesised from sorted centroids (deterministic for the pinned input), and
  names are joined from the highest-ranked populated place inside each polygon.
  639 of 2,143 get a name that way; the rest stay unnamed.
- **Urban areas do not tile the plane.** They are isolated blobs with rural land
  between them, so a snap at city level falls back to province and then country.
  Without that fallback most of the map would be unpaintable at city zoom.

### Why colour cannot leave the lines

It is not clamped or clipped — it is unrepresentable. A stroke paints whole
regions, so "outside the border" is not a state the document can hold. Dragging
the pen sweeps across regions, filling each one it crosses, and the sweep
interpolates between pointer samples (every 8 px) because a fast drag otherwise
skips narrow countries entirely.

### Why coarse paint cannot destroy fine paint

`paint` is one map per level, and the renderer declares `country-fill` beneath
`province-fill` beneath `urban-fill`. Painting France writes a single entry to
`paint.country` and touches nothing else; the provinces coloured inside it still
draw on top. **Verified:** Italy painted green, Bologna and Verona painted navy
on top, Italy then repainted brick at country level — Bologna stayed navy.

### Fill

Flood fill crosses neighbours that share the seed's current colour, using a
precomputed adjacency table built from **shared boundary vertices**
(`data/scripts/build-neighbours.mjs`, 339 country borders, 10,769 province
borders). Bounding-box overlap was tried first and is useless: Chile's box
covers half of South America and the United Kingdom's touches France straight
across the Channel. The build script asserts France has its 10 neighbours
(including Brazil and Suriname via Guyane) and that GBR and FRA are *not*
adjacent.

Fill stops at the edge of the **continent** — or, at province level, the parent
country. Without that bound it is correct and useless: Africa and Eurasia are
land-connected through Sinai, so a fill from Chad reached **112 countries**.
Bounded, the same tap fills 60, all African, stopping cleanly at Sinai.

Islands have no neighbours and so fill alone, which is right: there is no land
route off Madagascar.

### Occupation hatching, on one world grid

Diagonal stripes in the occupier's colour, over whatever the region is already
painted. **Verified:** Germany, Poland and Czechia painted three different
colours and hatched in one occupier colour — the stripes cross both shared
borders with no phase break and read as a single mask, with each base colour
still legible underneath.

How the grid stays continuous: **MapLibre positions a `fill-pattern` in TILE
space, not per feature**, so every polygon in a tile samples the same grid and
adjacent regions line up automatically. For that to survive tile edges, the
pattern must tile seamlessly *and* divide the 512 px tile size — hence a 32 px
pattern with a 16 px stripe period. Both divide 512.

⚠️ **`feature-state` cannot drive `fill-pattern`.** The style spec gives it the
parameters `["zoom", "feature"]` only, unlike `fill-color`. So hatching cannot
reuse the painting mechanism; the pattern is selected by
`['match', ['get','id'], …]`, rebuilt when the hatch set changes. One layer per
level, no extra geometry.

⚠️ **Stripe coverage is thickness × √2 ÷ period**, not thickness ÷ period: a
45° line covers √2 times its width along a horizontal cut. 5.5 px looked like
half-and-half and swamped the fill below; 4 px gives about 35%.

Why not stripe geometry clipped per region, which was the original plan? It
would give crisp vector stripes, but clipping needs each region's FULL polygon
and `queryRenderedFeatures` only ever returns tile-clipped pieces of what is on
screen — the hatch would stop at the viewport edge and need recomputing on every
pan. The accepted cost of the pattern approach is that stripes are raster, so
they soften at extreme zoom, and the pattern resamples at integer zoom steps.

### Verified working

Country and province painting, zoom-driven snapping with manual pinning, the
sweep brush, continent-bounded fill, occupation hatching, transactional undo
(one sweep or one fill undoes as a single step), an eraser that clears both
colour and hatching, the 24-colour palette, relief toggle, export/import.
PMTiles serve over HTTP Range requests (`206 Partial Content` confirmed).

### Not built yet

**The shared-border fade** — the adjacency table it needs is now built.

---

## 4. Data, by licence

Every dataset gets a `/data/README.md` entry with source, licence, date pulled, and the
script that builds it. Every *value* carries its own provenance:
`{value, unit, year, source_name, source_url, licence, retrieved, estimate, note}` — and
**the build fails on a missing provenance field**, so "every number shows its source and
year" is enforced rather than remembered.

### Clean — ships freely

| Dataset | Licence | Use |
|---|---|---|
| Natural Earth 5.1.2 | Public domain | Countries, admin1, places, coastline, disputed areas |
| OpenHistoricalMap | **CC0** | WWII de jure boundaries, day-precision dates |
| Wikidata | CC0 | Alliance membership, camp coordinates, identifiers |
| GEBCO 2026 | Public domain | Paleo-coastline thresholding |
| USGS MCS 2026 | CC0 | Lithium, cobalt, rare earths — production and reserves |
| USGS PP1802 | Public domain | Critical-mineral mines (2017 vintage, approximate, no owner field) |
| EIA bulk `INTL.zip` | Public domain | Oil/gas/coal production, coal reserves — **keyless**, so your no-API-keys rule holds completely |
| World Bank `NY.GDP.MKTP.CD`, `SP.POP.TOTL` | CC BY 4.0 | GDP, population |
| factbook.json | CC0 mirror of PD | Country facts, military prose, deployments |
| Ember yearly CSV | CC BY 4.0 | Electricity capacity **and** generation by fuel — one file, one attribution |
| Dalton 2023 NADI-1 | CC BY | Ice sheets, 49 timesteps 25–1 ka |
| CRC806 Paleocoastlines | CC BY 3.0 | 23 ready-made land masks, 200 ka → present, Europe/Near East/N Africa |
| flag-icons 7.6.0 | MIT | Flags |

⚠️ **Mirror CRC806 immediately** — its host page currently reads *"Currently offline, some
contents may be unavailable."* It's the single best ready-made Pleistocene shoreline set
and it may vanish. It also covers Doggerland and the Mediterranean, exactly where naive
GEBCO thresholding is least trustworthy.

### Attribution required, needs care

- **Global Energy Monitor** — CC BY 4.0, and the Global Integrated Power Tracker is the
  spine of the power-plant layer: one download covering coal, oil/gas, nuclear, hydro,
  solar, wind, geothermal and bioenergy at unit level with coordinates, capacity, status,
  fuel, owner, parent and stable join keys. Plus the Oil & Gas Extraction, Coal Mine and
  pipeline trackers.
  ⚠️ **Every GEM download is behind a form** (name, email, organisation, sector, country,
  and a **100-character minimum "how will you use this" field**) that mints a short-lived
  signed URL. There is **no stable public file URL**, so automated refresh is impossible —
  GEM is a *vendored* dependency, re-downloaded by hand, with the release month recorded
  per file.
  ⚠️ **Filter the TransitionZero rows** in the solar tracker — records with a non-empty
  `TZ ID` are CC BY-NC 4.0, not CC BY 4.0. Shipping them unfiltered is a quiet licence
  violation. Dropping them still leaves 100,000+ utility-scale phases.
- **Mapterhorn / AWS terrarium** — the attribution is a compliance trap, not a one-liner:
  the required credits span a dozen datasets, four CC BY versions, two Open Government
  Licences and a NOAA not-for-navigation restriction.

### Restricted

- **SIPRI — now out of the project entirely.** With defence budgets omitted, there is
  nothing left that needs SIPRI, so the 10% extraction rule, the permission email and the
  World Bank mirror trap all stop applying. Recorded here because it's the kind of decision
  that gets quietly reversed later: *adding spending back means writing to SIPRI first.*
- **FAS / Bulletin of the Atomic Scientists** (nuclear warheads) — FAS asserts plain
  copyright with no licence and offers no download. The Bulletin requires prior written
  permission even for non-commercial educational reuse, **bars automated collection, and
  prohibits AI/ML training on its content**. So: cite as linked estimates, or omit. No
  scraping, either way.
- **USHMM** — cite-only. Their terms also explicitly prohibit using Museum content to
  train or fine-tune any machine-learning model.
- **Avoid OpenStreetMap entirely in the data layers.** GEM already supplies pipeline routes
  as CC BY 4.0 GeoJSON. Any OSM-derived file we shipped would be a Derivative Database
  under ODbL share-alike, which would force ODbL onto that file and complicate every file
  that merges OSM geometry with GEM attributes. Since the basemap is Natural Earth, the
  project keeps a clean single-licence story.

### Dropped, with reasons

**CShapes 2.0** — I had it verified directly from its own CSV: Austria is one unbroken
geometry from 1919 to 2019 (**no Anschluss**), Poland is one geometry from 1921 to
1945-05-07 (**no 1939 partition**), and there is nothing at all in Europe between May 1941
and May 1943. Useless for this, and CC BY-NC-SA on top.

**Euratlas** — GIS data exists only for centennial years, so there is no 1938, 1939 or 1945
dataset at any price. (€150 + VAT per year file.)

**Energy Institute Statistical Review**, **IRENA** (WAF blocks all scripted access, 403),
**IISS** (your constraint).

---

## 5. The two recordings

### Format

A recording is timestamped keyframes. Documented in `/recordings/README.md` so Cold War or
Roman Empire are drop-in later. Per frame:

```jsonc
{
  "date": "1941-06-22",
  "date_precision": "day",          // day | month | approx
  "theatre": "eastern-front",
  "caption": "…",
  "camera": { "center": [30, 50], "zoom": 4.2, "bearing": 0 },
  "control": [ { "id": "DEU-1234", "faction": "axis", "extent_approximate": false } ],
  "fronts": [ … ], "arrows": [ … ], "cities": [ … ],
  "extent_confidence": "firm",      // firm | approximate | disputed
  "sources": [ { "org": "…", "url": "…", "retrieved": "2026-10-30" } ]
}
```

`sources` is an **array**, because several frames genuinely need more than one and a single
string would force a choice between citations.

### Recording 1 — WWII, 1937–1945

~99 monthly frames + ~55–60 event frames ≈ **160 total**. 23 of those months are flagged
approximate and render with a visible approximation treatment rather than a crisp boundary.

**Control geometry comes from dissolving Natural Earth 10m admin1 by a control attribute**
— a build-time join table keyed on `adm1_code` + month. Public domain in, public domain
out, no licence obligation, and crucially **nothing is traced from a copyrighted atlas**.
(Tracing a Wikimedia CC BY-SA map, a West Point plate or a GeaCron screenshot would make
our GeoJSON a derivative — share-alike at best, infringement at worst.)

⚠️ Must use **10m**: `ne_50m_admin_1_states_provinces` has 294 features covering 9 countries
and **zero European coverage**, so the 50m plan simply doesn't work.

A **hybrid render**, because the two layers answer different questions and conflating them
is the main historical error this app could make:

- **OHM polygons** = de jure territory (annexations, puppet states, occupation regimes).
- **Our NE dissolve** = "area of military control, approximate", semi-transparent, labelled.

Where the modern-province approximation visibly breaks — these get the approximation
treatment, and I'd rather name them now than have him find them:

- The **1939 Molotov–Ribbentrop line** ran along the Bug and San through modern Lubelskie
  and Podkarpackie. No modern voivodeship edge matches it.
- **Yugoslavia's** 1941 partition cuts across modern Slovenian and Croatian boundaries.
- **Manchukuo** — Rehe/Jehol has no modern equivalent province at all.
- **Vichy vs occupied France**, **Italian Libya**, **pre-1947 British India**.
- Admin1 levels are wildly inconsistent: Germany 16, Poland 16, Austria 9, Slovakia 8, but
  France 101, Italy 110, Latvia 119, **Slovenia 193**. Slovenia and Latvia need
  pre-dissolving to a coarser level or the join table becomes unmanageable.

**Front lines are authored, not sourced.** There is no openly licensed month-by-month WWII
front-line geodata anywhere — OHM has none (a targeted query returned 192 forts and
bunkers and exactly one occupation zone), Stanford's set is 404 and all-rights-reserved,
and the two GitHub front-line atlases have no licence file at all. That's hand work.

Decisions already made on historical-integrity grounds:

- **Do not colour the USSR as Allied before 22 June 1941.** It gets a distinct
  non-belligerent class for 1939-09-01 → 1941-06-21, captioned with dated facts (pact
  23 Aug 1939, Poland 17 Sep, Finland 30 Nov, Baltics Aug 1940, Bessarabia summer 1940),
  not a verdict. Factions are modelled as control classes plus a per-faction
  `role_changes` array, so Italy flipping on 1943-09-08, Finland twice, Romania on
  1944-08-23 and Bulgaria in Sept 1944 are all data, not duplicated factions.
- **Japanese control in China renders as corridors and garrisons** — rail lines, river
  valleys, coastal cities — labelled "zone of control, approximate". **Never solid fill.**
  Solid-shading eastern China is both factually wrong and the single most common error in
  WWII map animations.
- **Do not tween polygons** between monthly frames on the Eastern Front, in China or in
  North Africa. Interpolated front lines invent precision no source supports. Discrete
  steps with a short cross-fade, or a deliberately feathered front line. (Camera still
  interpolates smoothly — that's presentation, not evidence.)
- **Every 1945 boundary is legally provisional** — Potsdam set the Oder–Neisse line
  "pending a final peace treaty" that didn't arrive until 1990. A confident 1945 end-state
  map is misleading.

⚠️ Corrections the fact-checker caught: the **Moscow Peace Treaty was signed 12 March 1940**,
not 13 (13 March is the ceasefire). The State Department's WWII milestone series **"has been
retired and is no longer maintained"**, and `history.army.mil` / `history.navy.mil` were
unreachable — so every cited page gets mirrored and timestamped at build time.

**Holocaust layer.** Factual, age-appropriate, and built to USHMM's own teaching
guidelines treated as product requirements rather than a disclaimer:

- Wikidata CC0 coordinates (229 camp/ghetto items) joined to dates transcribed from the
  USHMM *Encyclopedia of Camps and Ghettos* — only 47 of those items carry an inception
  date, so **the dates are the work**.
- **No graphic imagery at all.** IHRA states the Holocaust "can be taught effectively
  without using graphic photographs or film footage." Neutral geometric symbols, factual
  labels, each point carrying its operating-date range and source URL.
- Default **off**, behind a short content note. Every figure shown with its source
  attached — Holocaust and Nanjing victim numbers are active targets of organised denial,
  and an unsourced number is a liability. (The Nanjing range alone spans 40,000 to over
  340,000 depending on scope.)
- **No simulation mechanics** — no counting-objects interaction, no animated death toll.
  That's USHMM guideline 10, and it decides whether this layer may participate in the
  what-if mechanic at all. Settled: it may not (§7).
- Cite "United States Holocaust Memorial Museum" unabbreviated, as their terms require.

### Recording 2 — Human origins, ~300 ka → ~1300 CE

**Paleo-coastlines by thresholding GEBCO, not by hunting for vectors** — no openly licensed
global Pleistocene shoreline vector set exists. Two-curve sea level: **Spratt & Lisiecki
2016** (free ASCII at NCEI, DOI 10.25921/rd66-5820) for 300→35 ka, **Lambeck et al. 2014**
(PNAS) for 35 ka→present. Precomputed per time-slice at build time. GEBCO global is 4 GB
compressed / 7.2 GB uncompressed, so the pipeline subsets and downsamples rather than
naively processing the full 15-arc-second grid per slice.

**Render the uncertainty.** Spratt & Lisiecki's own bootstrapped uncertainty is 9–12 m
(1σ), and the LGM lowstand is published as a 134–140 m *band*. So: a feathered or double
coastline, never a crisp line.

⚠️ **Badge the glacial-isostatic-adjustment caveat** where thresholding a modern grid is
most wrong — **Beringia** and **Doggerland** (forebulge subsidence), **Scandinavia** and
**Hudson Bay** (ice-dome rebound, still ongoing). The error there is tens of metres, enough
to show land where there was sea.

**Species as fade bands, not hard-edged polygons** — that's what the literature supports.
Higham et al. 2014 found Neanderthal disappearance was regionally staggered with
2,600–5,400 years of overlap with modern humans. The Denisovan range gets a deliberately
different treatment (dashed, low-opacity, wide) because its extent is inferred largely from
the genetics of living people, not from fossils — there are three, plus the debated Harbin
attribution.

**Structural spine:** the **50.5–43.5 ka** Neanderthal admixture window (Iasi et al. 2024,
*Science*; Sümer et al. 2024, *Nature*) — the field's biggest recent revision.

**At least six distinct interbreeding markers**, not one: Neanderthal → all non-Africans;
Denisovan D0 → East Asians/Siberians; D1 and D2 → Papuans from source populations that
split over 350 ka apart (so two separate markers); super-archaic → Denisovans;
Neanderthal–Denisovan F1s (Denisova 11).

**Debated questions as first-class UI objects** with two cited positions each, not
footnotes: Australia 65 ka (Clarkson 2017) vs ~50 ka (Allen & O'Connell 2020); White Sands
23–21 ka (Bennett 2021, Pigati 2023) vs the dating critiques; Homo naledi's dates and the
burial claim; Denisovan extent; the number of out-of-Africa waves; Luzon and Flores arrival.

⚠️ Citation corrections the fact-checker caught, all of which would have shipped as wrong
references: there is **no "Lambeck & Chappell 1998"** (it's 2001, *Science*, and the 125±5 m
figure traces to Fleming 1998 / Yokoyama 2000); Bird et al. 2018's reconstruction is drawn
at **−75 m, not −52.5 m**; the Walker et al. 2020 Storegga quote is *"neither universally
catastrophic, nor was it a final flooding event"* and Dogger Island's phase starts at
**c. 9000 cal BP, not 9.5 ka**. Also: the Ehlers & Gibbard ice-extent booksite is
**decommissioned**, not merely unlicensed — the files can't be obtained from the cited
source at all, which is why NADI-1 is the choice.

**Two editorial calls.** *Homo heidelbergensis* is **omitted** — including it would mean
presenting a contested taxon with no verifiable range on the same visual footing as
Neanderthals and Denisovans (§7, default). Still open: the framing of culturally sensitive
sites, specifically **Madjedbebe, which is on Mirarr country**, and the framing of
Australian and Aotearoa settlement.

---

## 5a. What milestone 0 actually found

Written down because several of these are not in any tutorial and would each
have cost a day later.

**The MapLibre v6 worker does not survive bundling, and fails almost silently.**
v6 computes its worker URL at runtime as a sibling of its own module —
`new URL('./maplibre-gl-worker.mjs', import.meta.url)`. A bundler cannot see
through `import.meta.url`, so Vite never copies that file; the chunk lands at
`assets/maplibre-<hash>.js`, MapLibre asks for
`assets/maplibre-gl-worker.mjs`, and a static host serves the 404 page:

```
Failed to load module script: non-JavaScript MIME type of "text/html"
Error: Worker failed to load. Check that the worker URL is correct.
```

The map then renders **nothing at all** while the page looks healthy. Fixed in
`src/map/worker.ts` by letting Vite emit the worker as an asset and handing
MapLibre the result:

```ts
import { setWorkerUrl } from 'maplibre-gl';
import workerUrl from 'maplibre-gl/dist/maplibre-gl-worker.mjs?url';
setWorkerUrl(workerUrl);
```

Taking it from `node_modules` means it can never drift from the installed
version — which matters, since MapLibre stamps `?v=<version>` on the URL it
would otherwise build itself.

**Other v6 API facts, confirmed against the installed package rather than docs:**

- **No default export.** `import maplibregl from 'maplibre-gl'` fails to compile
  and `default` is genuinely `undefined` at runtime. Named imports only.
- **`antialias` is no longer a `MapOptions` key.** It moved into
  `canvasContextAttributes`, whose documented defaults are already
  `antialias: false, powerPreference: 'high-performance', contextType: 'webgl2'`.
  Passing a partial object risks clobbering the siblings, so the defaults are
  left alone rather than restated.
- **`MapTouchEvent.preventDefault()` is real and precisely scoped** — the
  typings state it suppresses `DragPanHandler` and
  `TwoFingersTouchZoomRotateHandler` on `touchstart`. That is exactly the pen
  gate, confirmed before any code was written against it.
- TypeScript's `lib.dom` **already types** `altitudeAngle`, `azimuthAngle`,
  `force` and `getPredictedEvents` as required members, so shimming them is a
  type error. Only `Touch.touchType` genuinely needs declaring. Being typed is
  not being implemented, so all four are still probed at runtime.

**Labels were thought to need a glyph pipeline. They do not** — see §9, which
corrects this. Milestone 0 shipped **no labels at all**, which is also the
honest baseline for the frame-rate probe, and the reason recorded here at the
time was that MapLibre cannot render text without PBF glyph ranges, so with no
API key the only route was generating our own at build time from the
self-hosted woff2 (`fontnik` / `@maplibre/font-maker`). That was true of
MapLibre v4. It is not true of the v6 this project pins.

**`ADM0_A3` verified on real data.** Unique 177/177 in the 110m file, while
`ISO_A3` already carries 5 `-99` values at that scale. The key choice holds.

**Hillshade works with no key and no 3D terrain.** Mapterhorn is live and
serving; `hillshade-method: 'igor'` over the Himalayas gives exactly the flat
atlas look wanted, with `setTerrain` never called.

**A process lesson that cost time here:** full-page screenshots at tablet size
are **not** trustworthy for verifying a light map. White land on a pale blue
ocean with hairline borders compresses away to flat colour, and the map looked
broken when it was rendering perfectly. Verify map output with PNG crops
(`zoom` on a region), not full-page JPEGs. The ocean was deepened slightly
(`#CFE4F2` → `#B9D7EB`) and the hairline thickened (0.4px → 0.7px) as a genuine
legibility gain, but the original was never broken.

---

## 6. Milestones — revised for the editor

| # | Scope | State |
|---|---|---|
| **0** | Spike + skeleton. Vite, MapLibre v6, subpath deploy, glass theme, self-hosted fonts, Pencil probe, FPS harness. | **Built.** Pencil probe still needs a run on the real iPad. |
| **E1** | Region tiles, snap levels, layered painting, sweep brush, fill, undo/redo, palette, export/import. | **Built and verified.** |
| **E2** | Grid-anchored occupation hatching. | **Built and verified** — via a tile-anchored fill-pattern, not clipped geometry; see §3a for why. |
| **E3** | Labels, then the shared-border fade, and bookmarks with thumbnails. | **Built and verified** — labels with no glyph pipeline (§9), the fade (§10), bookmarks with real thumbnails (§12). |
| **E4** | Free-hand pen clipped within a single region, for shapes that are not whole regions. Eraser for strokes. | **Built and verified** — see §11. The full-geometry problem turned out not to block it. |
| **E5** | Offline/PWA, iPad polish, performance pass. | |

**Parked:** the country/military/energy info panels, the recording engine, the
player and recorder, the WWII recording, the human-origins recording. The
research for all of these is preserved above.

### The old milestone list, for reference

I've added a **milestone 0**, because two things should be proven before anything is built
on them: the pen gate rests on undefined WebKit behaviour, and a subpath PWA deploy has
known failure modes. Both are cheap to test now and expensive to discover at milestone 7.

| # | Scope | Done when |
|---|---|---|
| **0** | **Spike + skeleton.** Pen/touch interleaving test page on the real iPad. Vite + `base` + Actions deploy + noindex + self-hosted fonts + glass theme. FPS probe harness. | Deployed. The test page reports whether pen `pointermove` survives `preventDefault()` on stylus `touchstart` — written down either way — plus what the Pencil Pro/2nd-gen actually exposes for `pressure`, `altitudeAngle` and `getCoalescedEvents` on this iPadOS. PWA installs from the subpath with correct icons and `start_url`. |
| **1** | Base map, zoom reveal, colouring, fading borders, bookmarks, save/export. **Plus the glyph pipeline** (new — see §5a). | White countries, soft blue ocean, hillshade fading in. Labels render from self-generated glyph PBFs. Tap-to-colour with 24 colours + reset, undo/redo. Shared borders fade to near-zero at 300 ms when neighbours match; coastlines never fade. Bookmarks fly with a tuned curve. Export/import round-trips. |
| **2** | Pen, eraser, provinces, occupation hatching. | Pencil paints land only, never ocean; strokes anchored and correct across zooms; width in screen px at draw time. Eraser works. Admin1 colourable at mid zoom. Hatching renders in the occupier's colour over the base fill. |
| **3** | Country, military, energy panels and layers. Runtime point-of-view switching. | Every number shows source and year — enforced by the schema, not by discipline. Military layer carries alliances, nuclear status as cited estimates, and Factbook prose — **no budgets, no composite score**. Energy map layer with control/ownership. |
| **4** | Recording engine, player, recorder. | Scrubber with event markers, play/pause, speed, step, optional read-aloud. Camera interpolates; areas cross-fade. Recorder builds and exports a recording. `/recordings/README.md` complete. |
| **5** | WWII recording. | ~160 cited keyframes across three theatres. Approximations visibly flagged. Holocaust layer per USHMM guidelines, default off. |
| **6** | Human origins recording. | 300 ka → 1300 CE. Ice-age coastlines with GIA caveat badges. Debated questions as dual-cited UI objects. |
| **7** | Offline/PWA, iPad polish, performance pass. | Two-tier tiles; offline floor in IndexedDB; Home Screen onboarding. Measured on the device. |

### The sign-off gate, every milestone

You asked for iPad-viewport testing and a frame-rate check. One warning from the research:
**desktop emulation is not a trustworthy proxy.** Chrome DevTools device mode runs Blink on
the Mac's GPU; iPad Safari is WebKit with a different compositor, tiling strategy and a
thermally limited GPU. So emulation is for layout only, and the real gate is:

1. A dev-only FPS probe sampling the `requestAnimationFrame` timestamp, reporting p50/p95/
   worst and the count of frames over 20 ms. (Safari has no Long Animation Frames API, so
   in-page sampling is the only option.)
2. A **fixed gesture script** — 5 pinch-zooms z4→z10 over a dense area, 5 two-finger pans,
   one Pencil stroke — run on the actual iPad.
3. Fix the device, iPadOS version, battery level and warm-up state each time. Thermal
   throttling on a passively cooled iPad can halve sustained frame rate, so comparing a
   cold run to a warm one manufactures both false regressions and false wins.

Target 60 fps (iPad Safari caps near 60 Hz). **Watch memory as carefully as frame rate** —
issue #7667 is the most likely thing to make the app feel broken.

---

## 7. Decisions

### Settled 2026-10-30

| Decision | Consequence |
|---|---|
| **Apple Pencil Pro / 2nd gen** | Pressure **is** available, so brush width can be pressure-driven with the slider setting its ceiling. Still feature-detected rather than assumed, and `getCoalescedEvents`/`altitudeAngle` need Safari 18.2+ — milestone 0 reports what the device actually exposes. |
| **Spike the pen gate; mode toggle as fallback** | Milestone 0 ships the 30-line test page first. If WebKit keeps delivering pen `pointermove` after `preventDefault()` on a stylus `touchstart`, simultaneous draw-and-pan is in. If not, a pen/pan toggle lands instead and nothing else in the design changes. The result gets written down either way. |
| **Omit defence budgets and % of GDP entirely** | SIPRI leaves the project completely — no permission email, no 10% rule, no World Bank indicator trap. The military layer becomes: alliances (Wikidata CC0), nuclear status as linked cited estimates, geography, and the Factbook's hedged prose for personnel, deployments and equipment. Entirely uncontroversial, and no "who would win" comparison is constructible from it even by accident. |
| **"Unlisted" = search hygiene only** | Public repo named plainly (`what-if-atlas` → `networkfieldnotes.com/what-if-atlas/`), `noindex` meta, absent from nav and sitemap, no `robots.txt` Disallow at first. Anyone with the URL can open it, and that's accepted. No Pro subscription, no alternative host. |

**My reading of "omit spending entirely"**, so you can correct it cheaply: I'm dropping the
*money* — budgets and % of GDP — and keeping the public-domain Factbook **prose** fields
(personnel strengths, deployments abroad, service age, equipment descriptions), since those
were never the licence problem. If you meant strip the whole military panel back to
alliances and nuclear status only, say so and I'll cut deeper.

### Defaults I'll run with unless you object

Project data licensed **CC0**. **V-E Day labelled 8 May**, with 7 and 9 May in the frame
detail (USHMM itself uses all three on different pages). Colonial empires shaded with their
metropoles. Period place names leading, modern equivalents in parentheses. No casualty
figures in the recording itself. Chinese Communist base areas **omitted with a note** — no
source gives a defensible extent. *Homo heidelbergensis* **omitted** — contested taxon, no
verifiable range. Holocaust layer **excluded from the what-if mechanic** (USHMM guideline
10). Runtime point-of-view switching built in milestone 3, since it's nearly free from the
`FCLASS_*` columns already in the file.

### Still open

**Do you have the Cloudflare dashboard for networkfieldnotes.com?** It's the only way to
set `X-Robots-Tag` on the PMTiles and JSON — the `noindex` meta tag covers HTML only. Not a
blocker for milestone 0; needed before milestone 1 deploys real data files.

**Culturally sensitive framing** (milestone 6, so not urgent): Madjedbebe is on Mirarr
country, and the framing of Australian and Aotearoa settlement is a judgement call I'd
rather you made than defaulted.

---

## 8. Byte serving on GitHub Pages — solved, and how it misled me twice

**Status: fixed 2026-10-30.** The archives are served as `*.pmtiles.gz`.

### The fault

PMTiles reads an archive entirely through HTTP range requests. GitHub Pages
gzips any response whose content type it does not recognise, and then answers a
byte-range request by slicing **the compressed copy**. So the first block
decodes (the magic number is intact), everything after it is garbage, no tile
ever parses, and the map renders nothing while the page, the manifest, the
service worker and every JSON file all load perfectly.

`.pmtiles` is served as `application/octet-stream`, which Pages compresses.

### How to recognise it in one header

```
content-range: bytes 0-16383/3357828      <-- total is the GZIPPED size
etag: W/"6ae4fc52-3a4d08"                 <-- weak etag: representation transformed
                                              0x3a4d08 = 3,820,808 = the real size
```

The total in `content-range: bytes a-b/TOTAL` **must equal the archive's real
byte size**. The weak `W/` prefix says the same thing independently, and the
strong-etag form encodes the true length in hex.

Observed while the fault was live:

| archive | content-range total | real size |
|---|---|---|
| countries.pmtiles | 3,357,828 | 3,820,808 |
| provinces.pmtiles | 19,325,567 | 24,188,387 |
| urban.pmtiles | 4,288,441 | 12,771,423 |

### The fix: an extension Pages will not compress

Measured on the live host with a 1 MiB payload served under eight extensions:

| extension | content type | etag | range total | |
|---|---|---|---|---|
| `.png` | image/png | strong | 1,048,576 | safe |
| `.woff2` | font/woff2 | strong | 1,048,576 | safe |
| `.mp4` | video/mp4 | strong | 1,048,576 | safe |
| `.zip` | application/x-zip-compressed | strong | 1,048,576 | safe |
| `.gz` | application/gzip | strong | 1,048,576 | **chosen** |
| `.wasm` | application/wasm | weak | 4,402 | broken |
| `.bin` | application/octet-stream | weak | 4,402 | broken |
| `.pmtiles` | application/octet-stream | weak | 4,402 | broken |

**`.gz` over `.png`** because the failure modes are not equally quiet. Nothing
in the chain ever transforms `application/gzip`, whereas a fake PNG would be
silently rewritten the day anyone turns on Cloudflare Polish — and a corrupted
archive looks exactly like this bug all over again. Polish is off on the zone
today (real PNGs come back byte-identical, no `cf-polished` header), but "off
today" is not a property worth depending on.

⚠️ **The files are not gzipped.** Do not gunzip them, do not "fix" the
extension. `src/map/regions.ts`, `data/scripts/build-tiles.sh` and
`data/README.md` all carry the warning, because the name invites exactly that
mistake.

Byte serving itself is fine once the content type is right: ranges at offset 0,
mid-file and at the tail all come back byte-identical to the local file.

### Three false passes, all mine

Worth recording, because each one looked like proof.

1. **`curl -r 0-1023`** — passes. curl sends no `Accept-Encoding` by default,
   so it gets an uncompressed, correct `206` while every browser is broken.
2. **Browser-like `Accept-Encoding` plus "206 and no `content-encoding`"** —
   passes. A range sliced out of a compressed representation satisfies both
   conditions; the header is simply absent from the `206`.
3. **Asking for `Accept-Encoding: identity`** — passes nothing, but it is worth
   knowing it does not help either: Pages serves the compressed representation
   regardless of what the client asks for. There is no request-side workaround.

`data/scripts/check-deploy.sh` now checks the content-range total against the
local file size **and** the etag strength, at two different offsets.

### And it was never Cloudflare

I spent a round on this and sent Dustin to the Cloudflare dashboard for a
Compression Rule that could not have helped. The disproof is one request:

```
curl -r 0-16383 https://loopdetectedlolz.github.io/what-if-atlas/tiles/countries.pmtiles
  content-range: bytes 0-16383/3357828      <-- same wrong total at the origin
  via: 1.1 varnish                          <-- Fastly, which fronts GitHub Pages
```

The Pages origin is broken identically, so the compression happens before
Cloudflare ever sees the response. The earlier note in this section claimed the
opposite on the grounds that `loopdetectedlolz.github.io` 301s to the custom
domain — it does, but following the redirect still reaches Pages' own CDN, and
`server: cloudflare` on the final response says only that Cloudflare proxied
it, not that Cloudflare transformed it. The Compression Rule is harmless and
can stay or go.

**The lesson worth keeping:** when a CDN is in the path, test the origin before
blaming the CDN. One request would have saved the whole detour.

### Verified live, 2026-10-30

On `https://networkfieldnotes.com/what-if-atlas/`, after clearing the service
worker and caches:

- all three sources `loaded=true`, with the right zoom ranges (0–7, 2–9, 4–12)
- 88 countries rendered at z3.4 with correct `ADM0_A3` ids and names
- tapping painted FRA, DEU, ITA and TUR — `feature-state.color = #5E9E4B` on each
- at z6 over France, 175 départements rendered with correct parent countries,
  so the 24 MB provinces archive reads correctly over ranges
- renders correctly at iPad portrait (768×1024) and landscape (1024×768)

⚠️ **Frame rate is still unmeasured.** `requestAnimationFrame` is throttled to
~1–2 Hz in the automated browser pane whether it is shown or hidden — the idle
baseline measures 2 fps with no map work at all, so every number from it is an
artifact of the harness, not the map. The frame-rate half of the milestone gate
has to be run on the iPad, alongside `probe.html`.

### Still to do: the offline story needs the whole-file source anyway

This fix restores lazy range loading, which is the right runtime behaviour. But
the PWA requirement in the brief still collides with ranges: `Cache.put()`
rejects a `206`, so range-loaded tiles cannot be cached by the service worker.

Milestone E5 therefore still implements a PMTiles `Source` that fetches each
archive whole — one plain `200`, compression harmless, cacheable — and serves
`getBytes` by slicing locally out of IndexedDB. Per-level and lazy, so crossing
zoom 4.5 pulls provinces and nothing pulls the 38.9 MB up front.

Once that lands, the `.gz` extension stops being load-bearing. It should stay
anyway: the range path remains the fast path on first visit.


---

## 9. Labels — and the glyph pipeline that turned out to be unnecessary

Two sections above said labels would need a build-time glyph pipeline, and
budgeted new scope for it. They were wrong, and this records why, so nobody
rebuilds the thing we did not need.

### What the old reasoning got right, and where it expired

MapLibre genuinely cannot draw text from a `.woff2` the way a web page can. It
renders signed-distance-field glyphs out of a texture atlas, and historically
the only source for those was a `glyphs` URL serving PBF ranges of 256
codepoints — which means a font server, or generating the ranges at build time
with `fontnik`. That is what §5a planned for.

**MapLibre v6 added a second route, and this project already pinned v6.** The
style specification now has a root `font-faces` property: a map from the name a
symbol layer asks for in `text-font` to the actual font FILES to draw it with.
MapLibre downloads each file, registers it with the browser's CSS Font Loading
API under a private family name, and rasterizes each glyph on demand with
TinySDF — the same code path that has drawn CJK locally for years, now reachable
for any script. Read it in `src/render/font_face_manager.ts` and
`src/render/glyph_manager.ts` of the installed package; the style-spec
`sdk-support` block still points at an open issue, but the implementation ships.

So the atlas has **no `glyphs` URL, no PBF ranges, no font server and no new
build step**. The style points at `public/fonts/*.woff2` — the same files the UI
has been using since milestone 0.

What this costs, honestly: glyphs are rasterized on the device instead of
arriving pre-baked, so the first frame with a new character does a little work
on the main thread. For a Latin-only label set that is a few hundred glyphs,
once, cached for the session.

### One weight, because a font file has no weight descriptor

MapLibre constructs each face as `new FontFace(family, data)` with no `weight`
descriptor, so a variable font renders at its default instance — 400. There is
no way to ask the style for a semibold. Hierarchy therefore comes from case,
tracking, size and colour: countries in letter-spaced capitals, provinces and
cities in sentence case, all with a white halo wide enough to stay readable over
any of the 24 paint colours.

### Instrument Sans cannot spell Vietnamese

Google serves Instrument Sans in `latin` and `latin-ext` only — the typeface has
no Vietnamese coverage. Fifteen characters of Natural Earth's admin-1 names live
in U+1EA0-1EF9 and in no other subset: Đắk Nông, Quảng Trị, Thừa Thiên - Huế.
Checked against all 5,500 region names, those are the **only** characters the two
Latin subsets miss, so Cyrillic, Greek and CJK stay correctly out of the bundle.

The fix is a third self-hosted file: Noto Sans, narrowed to exactly that block,
declared after Instrument Sans so it can never claim a character Instrument Sans
has. A Vietnamese name renders its base letters in Instrument Sans and its
accented ones in Noto — indistinguishable at label size, and identical on every
device, which a system fallback would not be.

⚠️ The `unicode-range` values are **generated**, not hand-written, into
`src/map/fonts.generated.ts` by `data/scripts/fetch-fonts.sh`. Google's split is
not the obvious one — `latin` stops at U+00FF and `latin-ext` owns U+0100-02BA —
and MapLibre takes the first declared face whose range covers a codepoint. A
widened range hands characters to a file that does not contain them, and they
come back from the system font.

### Label anchors are their own dataset

`public/data/labels.json` — 6,092 points, 1.0 MB raw and 134 KB over the wire —
built by `data/scripts/build-labels.mjs`. Labels are **not** drawn off the
paintable polygon layers, for two reasons:

1. **MapLibre labels a polygon once per TILE.** A country spanning several tiles
   gets several labels — "Russia" repeated across Siberia — and nothing dedupes
   them, because the copies do not overlap so the collision index never fires.
2. **Natural Earth already carries cartographer-chosen label points**, and they
   beat any centroid: `LABEL_X`/`LABEL_Y` on admin-0 (present on all 252),
   `latitude`/`longitude` on admin-1 (all 4,589). A bounding-box centre puts
   Chile's label in the Pacific.

City labels come from `ne_50m_populated_places` (1,251 points), not the
urban-area polygons, which have no names at all. 586 of those places have no
urban polygon around them, so the map names Reykjavík even where there is no
city-level region to paint; `urban_id` ties the rest back to their polygon.

### The reveal schedule is Natural Earth's, not invented

Every anchor carries NE's own label priority — `LABELRANK` for countries,
`min_label` for provinces, `SCALERANK` for places — and it does two jobs:

- **`symbol-sort-key`**, so MapLibre places labels in that order and the ones
  that will not fit lose the collision. That is the progressive zoom reveal,
  straight from the data, with one layer per level instead of hand-tuned zoom
  cutoffs. It also has the nicer property that a minor name sitting in empty
  space appears early, because there is nothing to collide with.
- **`text-size`**, interpolated on rank inside the stops of the zoom
  interpolation. Without this the hierarchy is invisible: Vatican City and
  Andorra sit in open space, win their collisions outright and draw at exactly
  the size Poland does.

⚠️ A rank-driven size has to go **inside** the `['zoom']` interpolation's stops.
A zoom expression must be the outermost expression of a property, so multiplying
one by a per-feature factor is rejected.

### Layer order is the collision priority, and it is back to front

MapLibre places symbols starting from the **top** layer — `PauseablePlacement`
walks the layer order in reverse — so a later layer wins the space. The label
layers are therefore declared province → place dots → places → **countries
last**: in a crowded view of Europe, "Belgium" should survive and "Charleroi"
should be the one to go.

### Turning names off is a layout property, never a restyle

`setStyle` discards every feature-state, so rebuilding the style to hide some
text would throw away the whole painting. The toggle sets `visibility` on the
four layers. The flag is still passed to `atlasStyle`, so that a style
replacement — the relief toggle — comes back in the state the user left it.

### Verified, 2026-10-30

On the dev server at z3.4 through z8.6: 44 country and 71 place labels at the
world view with the rank-driven sizes visibly separating Poland from Andorra;
French départements at z6 with Paris's capital dot; London boroughs at z8.6;
Vietnamese province names rendering with every diacritic; names legible in white
halo over the darkest navy in the palette; the toggle surviving a relief
restyle; iPad portrait (768×1024) and landscape (1024×768) both clean.

**Not verified: frame rate with labels on.** The browser pane throttles
`requestAnimationFrame` to ~2 fps at idle, so no number from it means anything.
Symbol layers are the most expensive thing on this map and this is the first
time the atlas has had any — the iPad run that still owes us `probe.html` owes
us this too.

### A trap when verifying from an automated browser

`Style.loadJSON` defers `_load` to an animation frame. A browser pane that is
hidden or unpainted delivers no frames, so **the style never starts loading at
all**: `getStyle()` stays undefined, `isStyleLoaded()` stays false, no source
cache is ever created, and it looks exactly like a failed fetch — with an empty
console and every network request sitting at 200.

It is not stuck. Forcing one frame, by taking a screenshot, finishes the load
immediately. Check that before debugging a deploy that appears not to load; this
has now looked like a real fault twice. The same throttling is why no frame-rate
number from that pane means anything (§8).

### A regression this turned up: the dev server and the `.gz` that is not gzipped

The `*.pmtiles.gz` rename in §8 fixed GitHub Pages and **broke `npm run dev`**.
The static server Vite uses takes the extension at its word and answers with
`Content-Encoding: gzip`, so the browser tries to inflate plain bytes and fails
with `ERR_CONTENT_DECODING_FAILED` — the map renders nothing locally while the
deployed site is fine, the exact inverse of the bug the rename cured.

`vite.config.ts` now serves those files itself, with range support and no
content encoding, for both `dev` and `preview`. Worth noticing that §8's own
verification could not have caught this: it only ever tested the deployed site.

---

## 10. The shared-border fade — how it is actually done

Colour Austria, Czechia, Slovakia and Hungary the same red and the lines between
them disappear; what is left is one bloc with a border against Germany, Poland,
Italy and Romania. That is the feature. This section is the parts of it that
were not obvious.

### A border has to be its own feature before it can fade

MapLibre's opacity is per feature. A country polygon's outline is ONE feature
carrying its coastline and every border it has, so fading it takes the coast
with it. There is no expression that fades part of a feature, and none that
reads another feature's state — which is the second half of the problem, because
deciding whether a border fades means comparing the two regions on either side
of it and a style expression can only see the feature it is drawing.

So the outlines are taken apart at build time by `data/scripts/build-borders.mjs`.
Every segment of every ring is counted by how many regions own it: one owner is
coastline, two owners is the border between them. Output: 339 country border
pairs and 10,769 province pairs, emitted ONCE each rather than twice as the
polygons carry them.

The comparison then happens in JavaScript against the scenario, and the answer
is pushed into the border's own feature-state (`src/tools/borders.ts`).

### Ids are pair ids, and that is what makes it cheap

A border feature's id is `A|B`, the two region ids sorted. One border is usually
several disjoint chains — broken by a lake, by a third country at a tripoint, by
an island — and **every chain of a pair carries the same id**. MapLibre keys
feature-state by id and applies it to every feature carrying that id, so one
`setFeatureState` call fades a whole border however many pieces it is in. The
France–Germany border is one call, not forty.

⚠️ The sort order in `borderId()` and in the build script must agree. A
disagreement silently fades nothing at all.

### The lines must be cut with the same settings as the fills they sit on

A border line is drawn directly on the seam between two fills, so if it is
simplified differently from those fills it drifts off the colour boundary and
the map shows a line *beside* the join instead of on it. `borders` therefore
matches `countries` (z0–7, `--simplification=6`) and `subborders` matches
`provinces` (z2–9, `--simplification=5`).

That this works at all is down to `--no-simplification-of-shared-nodes`, which
was already in the tile build for a different reason — it stops a shared border
cracking into two slightly different lines and showing hairline gaps between
neighbours. Because it preserves every node shared between features, the border
vertices survive simplification in BOTH the polygons and the lines, and the two
coincide exactly.

Measured, not assumed, by comparing the rendered line geometry against the
rendered fill geometry in screen pixels: **median 0 px, 99th percentile 0.6 px,
worst 0.9 px** for country borders at z3, z5, z7.5 and z9.5; the same for
coastline once vertices near the viewport edge are excluded, where the fill tile
may simply not have loaded yet and the measurement is comparing against nothing.

### The province coastline is deliberately missing

`subborders` has borders only. The province coastline is the same line as the
country coastline — 407,896 segments against 407,006 — and it is never seen,
because the country coast is drawn over it, darker and wider at every zoom.
Dropping it took the province border data from 862k vertices to 450k.

### The rule, and the two readings of it that were rejected

**A border fades when the regions on both sides are painted the same colour, at
that border's own level.**

- **White does not count.** `#FFFFFF` is the reset swatch, and the resting map is
  white regions with every border drawn. A border vanishing between two
  deliberately-whitened regions would read as a bug, not as a merge.
- **Painting a country does not dissolve the province lines inside it.** The
  rejected reading was "effective colour": a province with no paint of its own
  inherits its country's, so painting France would fade all of France's internal
  borders. It is consistent, and it is wrong for this map — those provinces were
  not coloured, nothing was merged, and the child about to paint départements
  inside blue France needs to see where they are.
- **Colouring one French département and one German Land the same does not erase
  the France–Germany line.** That is a country-level fact and it takes colouring
  both countries. The province border between those two does fade, which is the
  honest answer: those two provinces match, those two countries do not.

Hatching is not considered. An occupied region is still a region with a border;
the stripes say who holds it, and nothing has merged. Verified: Sweden and
Finland both occupied in the same colour keep their border.

### What is animated, and what is not

⚠️ **This plan previously said every per-feature opacity change triggers a full
`gl.bufferSubData` of the layer's paint array, and budgeted 200–250 KB a frame
for 700 segments on that basis. That is not what the code does.** MapLibre
batches state changes and applies them once per update cycle
(`SourceFeatureState.coalesceChanges`, from `tile_manager.ts`), and each tile
guards on a revision so its buckets rewrite at most once per pass. A hundred
`setFeatureState` calls in one frame cost one bucket update per affected TILE,
not a hundred uploads.

⚠️ But read the upload exactly, because it is not the shape you would guess:
`VertexBuffer.updateData` is `gl.bufferSubData(ARRAY_BUFFER, 0, wholeArray)` —
offset zero, the entire paint array for that tile's bucket, **the same size
whether one border changed in it or three hundred did**. So the per-frame cost
is (tiles containing something that changed) × (that tile's whole paint array),
and fading ONE border costs the same per frame as fading every border in the
same tiles.

Measured here, the JavaScript half is nothing at all: 80 calls in under 0.1 ms,
2,000 in 0.8 ms. What is left is that per-tile rewrite, and it scales with tiles
touched — which is why the bound is still worth having, and why the case it
protects is the one that touches every tile on screen:

- A tap moves a handful of borders. Those ease — smoothstep, 1 → 0.06 over
  300 ms. Linear reads as a hard switch at both ends.
- A continent fill moves hundreds, across every tile in view. Past `EASE_LIMIT`
  (80) the change is simply applied. Africa filled in one tap is 129 borders at
  z2.6 and it is instant, which is also what a bulk operation should feel like.

Work is bounded on the input side too: the fade walks the PAINTED regions and
their neighbours, never the 11,000 borders in the data, and coalesces every edit
that arrives before the next frame into one pass — a pen sweep calls
`store.set()` once per region crossed.

### Things that would have broken it

- **`map.setStyle` does NOT throw away feature-state**, though this plan and a
  comment in main.ts have both said so since milestone 0. `setStyle(object)`
  defaults to the diff path, which leaves untouched sources alone; measured, a
  probe feature-state AND a probe registered image both survive the relief
  toggle. `BorderFader.resync()` stays as insurance, because a sprite or glyph
  change forces a full rebuild and `{diff: false}` asks for one — and it does
  not animate, because nothing changed for the user.
- **Tiles arrive after the paint.** They need no help: MapLibre keeps
  feature-state per source and pushes all of it into each tile as it loads
  (`SourceFeatureState.initializeTileState`), so a border tile that arrives after
  the paint comes up already faded. Read that before adding a `sourcedata`
  re-apply like the one `PaintRenderer` carries.
- **A border returning to full strength removes its state** rather than storing a
  1. Every stored state is re-sent to every tile that loads, so a long session
  would otherwise accumulate thousands of no-ops.

### The alternative to measure on the iPad, not here

v6 has a primitive this does not use: a `global-state` reference inside a
transitionable data-CONSTANT property. `line-layer-opacity: ['global-state',
'borderFade']` plus one `setGlobalStateProperty` call starts a genuine eased GPU
transition with no per-frame JavaScript and no paint-array upload at all — the
whole 300 ms for one call instead of eighteen frames of `bufferSubData`.

It is NOT adopted, and the reasons are worth writing down so nobody re-derives
them:

- Driving it needs the borders split across two layers — one for the borders
  holding still, one for the cohort currently fading — with a boolean
  feature-state picking which layer each border draws in. Whether that split
  actually works in 6.16 is contested: `line-layer-opacity` takes only `zoom`
  and `global-state` as expression parameters, so nothing per-feature can reach
  inside it, and the design leans on a second expression on the same layer doing
  the selecting.
- One global-state key fades one cohort. Two borders changing 100 ms apart need
  a key pool or a policy of snapping whatever is in flight.
- `line-layer-opacity` renders the whole layer to a scratch framebuffer and
  composites it, for as long as the transition runs. That is a full-viewport
  pass that the current technique does not pay, and on an iPad it may well cost
  more than the uploads it saves.

So the two are a genuine trade — per-frame buffer uploads against a per-frame
full-viewport pass — and neither has been measured on the device that matters.
**That measurement belongs in the same iPad session as the frame-rate gate.**
The version that ships is the one that is verified.

### Verified, 2026-10-30

On the dev server and the production build: Spain + Portugal + France merge and
Andorra and Gibraltar stay outlined inside them; Austria + Czechia + Slovakia +
Hungary merge with all five internal pairs faded and Germany, Italy and Poland
untouched; Africa filled in one tap fades 129 borders and keeps every coastline;
Yonne + Nièvre merge at province level with exactly one border faded and no
country border touched; undo removes the fade and redo restores it; the relief
toggle survives in both directions; hatching does not merge anything; iPad
portrait and landscape both correct.

The easing curve was checked by stepping the fader's clock deterministically —
1 → 0.835 → 0.483 → 0.158 → 0.06 — because the browser pane throttles
`requestAnimationFrame` to about 1 Hz and collapses the whole 300 ms into two
frames. **The fade's smoothness, like the frame rate, has never been seen at a
real frame rate.** It has to be watched on the iPad.

---

## 11. The free-hand pen — and why the full-geometry problem did not block it

Everything else in this editor paints whole REGIONS, and that is what makes
"colour cannot leave the lines" true by construction: there is no way to express
a mark that crosses a border, so none can be made. The pen is the exception, so
it has to earn the same guarantee a different way — the drawn shape is
INTERSECTED with the region it started in, and whatever lies outside is thrown
away before it is ever stored.

Verified: a stroke dragged from the middle of Spain west to screen x=190, well
out past Portugal and into the Atlantic, stops dead at x=314 — the Portuguese
border. Another, drawn across Spain to the Mediterranean, stops on the coastline
at Valencia. "Paints on land only" needs no separate rule: regions are land, and
a stroke begun over water finds no region and is declined.

### The clip geometry: the objection, and why it does not apply here

§3's hatching note gives up on clipped vector stripes because clipping needs a
region's FULL polygon and `queryRenderedFeatures` only ever returns tile-clipped
pieces of what is on screen — the hatch would stop at the viewport edge and need
recomputing on every pan.

Every word of that is still true, and none of it bites here. A hatch must cover
its whole region continuously, forever, at every zoom. A stroke is drawn ONCE,
by hand, on screen, in one gesture: whatever the pen could reach is on screen,
so the pieces on screen cover it, and once intersected the result is a fixed
geographic polygon that never needs computing again.

The query is bounded by the stroke's own screen box rather than the viewport, so
what comes back is the two or three tiles the stroke actually crosses. That box
is projected fresh at commit time, not remembered from when the samples were
taken, because a finger may have panned the map the whole time.

**Two limits, both real and both documented rather than solved.** A stroke drawn
at low zoom is clipped against geometry simplified for that zoom, so its cut edge
follows a coarser border than you see after zooming in. And if the map is panned
mid-stroke until part of the mark leaves the viewport, the clip can only use what
is still on screen.

Measured, for Italy's border, rather than guessed: a clip taken at zoom 3 sits at
most **438 m** off the finest geometry the app ever draws, median 113 m. That is
0.1 px at the zoom it was drawn at — invisible, and it stays invisible until you
zoom a long way past where you were working: about 4 px at zoom 9 and 32 px at
zoom 12.

The fix, if it ever matters, is known: clip against the archive's MAXZOOM
geometry pulled straight from PMTiles rather than against what the map happens
to be rendering. That costs an MVT decoder in the bundle and a few range
requests per stroke, to remove an error nobody can see at the zoom they are
drawing at. Not taken. If a child ever draws at the world view and then zooms to
a city and sees ink across a border, this is why, and that is the fix.

### Why the path is recorded in longitude and latitude

Because a finger may pan or pinch WHILE the Pencil draws — the gesture model
this app is built on. Screen coordinates would smear the stroke across the map
as it moved. Every sample is unprojected the moment it arrives, so the ink stays
on the ground it was laid on, and the live preview reprojects itself for free
because MapLibre is already drawing it from a geographic source.

### The width is not a width, it is an area

A nib has thickness, so the path becomes a polygon: a disc at every sample plus
the quad swept between consecutive samples, all unioned. That gives round caps
and round joins for nothing — the disc at a corner IS the join — and it is the
one construction that stays correct when the path doubles back on itself, which
a hand-drawn line does constantly. Apple Pencil pressure varies the disc, so the
line thickens and thins; a mouse reports a constant 0.5 and is drawn at full
weight instead of permanently at half.

⚠️ **The cost is in the union, and it had to be bounded.** Measured: 100 samples
union in 12 ms, 400 in 93 ms, and a Pencil samples at up to 240 Hz, so a
two-second stroke arrives with hundreds of points mostly a fraction of a pixel
apart. Three passes — drop samples too close to see, run Ramer–Douglas–Peucker,
then raise the tolerance and repeat if still over 200 points — make the cost
depend on the SHAPE of the stroke rather than how long it was drawn for. Checked
with 200, 480 and 960 raw samples: all three collapse to about 180 points and
commit in 10–12 ms.

⚠️ **The tolerance is in screen pixels and must be converted.** A world unit
here is a pixel at zoom 11 and nothing like a pixel anywhere else: at zoom 4 one
screen pixel is 128 world units, at zoom 15 a sixteenth of one. Left unconverted
it would thin a stroke drawn at the world view into a straight line and leave one
drawn at street level untouched. This was a real bug, caught by the geometry
tests before it reached the screen.

### A stroke is a MULTI-polygon, and the format had to change

Clipping a hand-drawn mark to a region routinely breaks it into pieces: the
stroke wanders out of the country and back in, or crosses a lake drawn as a
hole. `Stroke.rings` was a single GeoJSON Polygon and could only ever have
stored the first piece — silently losing half of a child's mark.

So version 3 of the scenario format stores `shape`, a MultiPolygon, and
`migrate()` lifts an old `rings` into it. Verified with the case that motivates
it: a stroke run out of Spain into Portugal and back, on two different lines, is
stored as two polygons, both cut at the border.

### Smaller things that were decided rather than defaulted

- **The pen obeys the snap level.** Zoomed out it is held by a whole country;
  zoomed in by a province, then a city — the same rule as the brush, so there is
  nothing extra to learn, and the hover outline already shows the boundary that
  is about to hold you.
- **The pen may decline a gesture**, which no other tool does. It asks for a
  region BEFORE calling preventDefault, so a stroke begun at sea is left to the
  map to pan with rather than swallowed.
- **A finger tap does nothing** while the pen is selected. Fingers pan; a tap
  would otherwise leave a dot wherever the map was steadied.
- **The eraser lifts strokes first**, before clearing the region underneath,
  because a mark drawn ON a country is the thing being pointed at. MapLibre does
  the hit test — the strokes are a rendered layer, so `queryRenderedFeatures` is
  the whole implementation.
- **A half-drawn stroke survives `pointercancel`.** That is a guess, not a
  decision: `probe.html` exists to find out whether a resting palm cancels a
  Pencil stroke on iPadOS and it has STILL never been run on the device. Keeping
  matches what painting does, and a wrong mark can be undone where a lost one
  must be drawn again.
- **The live preview is a line, not the real outline.** Building the outline
  costs tens of milliseconds and the preview has to keep up with the nib.

### Three input bugs the pen exposed, all of them older than the pen

Adding a tool that holds a gesture open for seconds at a time found faults that
tap-to-paint had been hiding.

- **Any finger ended the Pencil's stroke.** `pointerup`, `pointerleave` and
  `pointercancel` all fire for every pointer on the element, and none of the
  three handlers checked WHICH. So lifting the finger that had been panning the
  map committed the half-drawn stroke and silently threw the rest away —
  defeating the exact gesture the whole input model exists to support. The
  handlers now key on the pointer that started the stroke. Verified: a stroke
  survives both a finger's `pointerup` and a palm's `pointercancel` from other
  pointers and commits its full length.
- **A hovering Apple Pencil counted as drawing.** `paints()` accepted any `pen`
  pointer regardless of `buttons`, and a Pencil reports `pointermove` while
  hovering above the glass with `buttons === 0`. So `hover()` was unreachable on
  the one device this is built for: no region outline, no toolbar readout. For
  the pen that outline is the entire affordance — it is the boundary the stroke
  is about to be cut at. Fixed by requiring `buttons === 1` for a pen as well as
  a mouse, and verified: a hovering Pencil now names the region under the nib.
- **The eraser hit-tested a single pixel.** A stroke's width is baked into the
  ground when it is drawn, so it shrinks on screen as you zoom out — a 7 px mark
  drawn at zoom 6 is under half a pixel wide at zoom 2 — and the eraser felt
  broken on anything thin. It now uses the same 6 px box the snap tool uses.
  Verified with a tap four pixels clear of the ink, which a bullseye test misses
  and the box catches.

And one in the scenario store: **undo silently rearranged a drawing.** Restoring
an erased stroke pushed it onto the end of the list, and array order is draw
order is z-order, so the mark came back on top of everything drawn since; undoing
a clear-all rebuilt the whole stack inside out. The edit now carries the index it
came from. Rearranging a child's drawing is worse than losing it, because nothing
says it happened.

### A correction to §10, in the half it did not cover

§10 established that `map.setStyle` does NOT discard feature-state. **It does
discard GeoJSON source data.** The two are kept in different places, and the
diff path that preserves the one replaces the other — the strokes are a GeoJSON
source and would vanish on every relief toggle without the explicit re-push in
`reloadStyle`. Do not read §10 as a general statement that setStyle preserves
everything.

The same applies to the `labels` source, which is declared with a URL: each
relief toggle re-fetches a megabyte of label anchors. Harmless on a desktop, not
free on an iPad over school wifi, and worth fixing when the offline work lands.

### Still unresolved: the pen and the finger genuinely fight

Worth writing down precisely, because it is the gesture the brief is built on
and it does not yet work the way the brief wants.

`MapTouchEvent.preventDefault()` does not suppress one handler, it resets ALL of
them. So a Pencil landing while a finger is mid-pan freezes that pan until the
pen lifts. Worse: when the finger lifts first, `TouchPanHandler` re-arms with
whatever contacts remain — which is the stylus — and the pen starts panning the
map, with the ground following the nib.

There is no clean fix from here. MapLibre cannot be told to ignore one touch,
and the two obvious variants both fail: gating on all CURRENT touches rather
than the changed ones lets the pen pan whenever a finger is also down, and
gating on the changed ones is what produces the freeze. The real options are a
custom pan handler or accepting it, and choosing between them needs the device.
**This belongs at the top of the iPad list, with `probe.html`.**

### Verified, 2026-10-30

Driven through the real pointer path with synthetic Pencil events carrying
pressure: a 221-sample squiggle commits in 10.3 ms; the preview tracks the nib
and clears on release; the mark is cut at the Portuguese border and at the
Mediterranean coast; a stroke begun at sea adds nothing; the eraser lifts exactly
the stroke under the tap and undo brings it back; strokes survive the relief
restyle in both directions; the format round-trips and lifts a version-2 file;
iPad portrait draws correctly at 768×1024.

**Not verified: how it feels.** Synthetic events are evenly spaced and perfectly
smooth, which is the one thing a real hand is not, and the browser pane cannot
show the frame rate. Whether the preview keeps up with a Pencil, whether 7 px is
the right nib, and whether the commit hitch is noticeable all belong to the iPad
session that already owes us `probe.html`, the frame-rate gate and the border
fade's smoothness.

---

## 12. Bookmarks — and getting a picture of the map out of WebGL

A bookmark is where the map was, not what was drawn on it: centre, zoom,
bearing, pitch, a name, and a thumbnail of what it looks at. Tapping one flies
back. They ride along in the scenario file, so a saved atlas remembers its own
tour.

### The thumbnail is the interesting part

MapLibre has no snapshot API, and the usual answer — create the WebGL context
with `preserveDrawingBuffer: true` — is the wrong trade here. That flag costs
something on **every frame**, forever, on a map that has to stay smooth under a
pen, to serve a button pressed once in a while.

So the capture reads the buffer before the browser throws it away:

```js
map.on('render', onceOnly);   // inside this, the drawing buffer is still intact
map.triggerRepaint();
```

⚠️ **The draw has to happen inside that event.** A moment later the buffer is
gone and `toDataURL` returns a perfectly valid, perfectly blank image — no
error, no warning, just an empty rectangle in the list. Measured here with the
context attributes confirmed as `preserveDrawingBuffer: false`: read naively,
29 KB of nothing; read inside the render event, a 445 KB PNG with 79 distinct
colours.

Only the DOWNSCALE happens in that window. Encoding the full 1132×838 canvas
there would cost 445 KB and the time to make it; drawing it into a 160×100
canvas takes about 5 ms and the encode can happen afterwards at leisure.

**WebP, but checked.** It is about a fifth smaller than JPEG — 5.7 KB against
6.8 KB, where PNG is 18.2 KB — but a browser that cannot encode WebP silently
returns a PNG instead of failing, at three times the size under a name that
looks right. So the returned data URL's own type is checked, and JPEG is the
fallback. Measured in practice: 2.9–4.1 KB a thumbnail.

**And the whole thing is allowed to fail.** If the trick does not work in some
browser, `captureView` returns null and the bookmark saves without a picture —
the row still gets a tile so the list does not go ragged. Blankness is detected
by counting distinct colours rather than trusting the encode, because a blank
capture is a *valid* image and nothing else would catch it.

### Bookmarks are deliberately not undoable

Undo means "take back that paint". A child who saves a view, paints three
countries and taps undo wants the last country back — not the bookmark quietly
deleted, which would be indistinguishable from one that never saved. So
`addBookmark`/`removeBookmark` change the scenario and emit, but never touch the
undo stack. They still export and import; they are simply not edits to the
drawing. Verified: deleting a bookmark and pressing undo leaves the list alone.

### Named by what it looks at, not by asking

A prompt on a tablet is a keyboard in front of the map, and the answer is almost
always the name of the place on screen. So a saved view takes the name of
whatever is under the middle of it, at the editor's current snap level — a view
saved while painting provinces is named after a province. Collisions become
"Spain 2". Verified: Madrid, Roma, Tokyo, Hauts-de-Seine, each from one tap.

### An imported file is a file from anywhere

A bookmark's thumbnail goes straight into an `<img src>` and its name into
markup, so `migrate()` now validates every field rather than trusting the shape.
Verified against a real file import driven through the actual file input:

- a `thumb` that is a remote `https://` URL — **dropped** (it would have been a
  tracking pixel that fires whenever the list is opened)
- a `thumb` that is an SVG data URL — **dropped** (SVG can carry script)
- a `thumb` of 60 KB — **dropped**, 48 KB cap
- `zoom: 99` → clamped to 22, `pitch: 400` → 85, `bearing: 'x'` → 0
- centres that are out of range, NaN, or missing — the whole bookmark dropped
- a name of `<img src=x onerror=...>` and an id crafted to break out of its
  attribute — both rendered as plain text, neither payload fired

### Smaller decisions

- **Collapsed by default.** With thumbnails the list grows taller than
  everything above it in a toolbar that already scrolls, and the tools have to
  stay reachable.
- **It scrolls itself into view after a save**, because otherwise on anything
  shorter than a desktop a view saves itself out of sight and the button looks
  broken.
- **`prefers-reduced-motion` jumps instead of flying.** Someone who asked the
  system for less motion still wants to get there.
- **Flight curve 1.55, speed 1.1, capped at 2.2 s.** A little more arc than
  MapLibre's default 1.42, so the world falls away and comes back, which is the
  point of a bookmark in an atlas; capped so that comparing two places does not
  mean waiting out a journey each time.

### Verified, 2026-10-30

Three views saved from one tap each with real thumbnails; flying from Tokyo to
Madrid lands exactly on the stored centre and zoom; deleting removes the right
one and undo leaves the list alone; a hostile import is defanged in every field;
iPad portrait keeps 50 px rows and a reachable panel.

**Not verified: the flight.** `flyTo` animates on `requestAnimationFrame`, which
this browser pane throttles to about 1 Hz, so the arrival is correct and the
journey is unobservable — the same limitation as the border fade's easing and
the pen's preview. Whether 2.2 s is right, and whether the curve feels like an
atlas or like a video game, is one more thing for the iPad.

---

## 13. Autosave — and why "Saved" is a careful word here

Until this, the editor forgot everything the moment the tab reloaded. Export has
always existed, but export is a thing you have to REMEMBER to do, and the people
who most need the work kept are the least likely to think of it. A twenty-minute
drawing should survive a dropped tab.

`idb` had been a declared dependency since milestone 0 and was imported nowhere;
§3's own architecture listing named a `persistence.ts` that was never written.

### The honest part

⚠️ **IndexedDB ON IOS IS NOT STORAGE, IT IS A CACHE WITH GOOD MANNERS.** §3
already recorded the rule for the offline tiles and it applies just as much to a
2 KB drawing: WebKit deletes IndexedDB after **seven days without interaction**,
and the exemption is for apps added to the Home Screen, not for tabs. A child who
draws, then goes away for a fortnight, comes back to nothing.

So the indicator does not say "Saved" and stop there. It says what is true:

> Saved on this device — add to the Home Screen, or Export, to keep it longer
> than a week.

...and only drops the second half when `navigator.storage.persist()` has actually
been granted, which exempts the origin. An indicator that says "Saved" when it
means "saved for about a week" is worse than no indicator, because it is the
reason someone will not bother to export.

### Four ways this could lose the work, and what each one does instead

- **Writing a blank over a real save.** The read is asynchronous; one tap
  arriving before it finishes would otherwise persist an empty scenario straight
  over the saved one — losing everything in order to save nothing. Nothing is
  written until the first read has finished, and the change listener is not even
  subscribed until then, so there is no window at all rather than a short one.
- **A record that cannot be read.** It is moved to a second key and the live one
  is deleted, rather than being overwritten by the blank scenario that replaces
  it. An unreadable save may still be recoverable by hand; it is certainly not
  improved by being written over. And the interface SAYS SO — "The last drawing
  could not be read, so this one starts fresh" — because starting blank after a
  failed read looks exactly like starting blank for the first time, and that is
  the moment a child most needs telling.
- **Running out of room.** The bookmark thumbnails are nearly all the bulk, so a
  quota failure retries once without them. A drawing without its pictures is far
  better than no drawing. Verified by making `IDBObjectStore.put` throw
  `QuotaExceededError` on the write that carried a thumbnail: the retry landed,
  the bookmark and its name survived, the picture did not.
- **The tab being killed.** iOS discards a backgrounded tab without warning, so
  the save also flushes immediately on the way out instead of waiting out its
  debounce.

### ⚠️ The two goodbye events do not have the same target

`visibilitychange` is fired **at the document**. It reaches a `window` listener
only by bubbling — which happens to work, but is not what the event is for, and
a listener that never runs looks exactly like a save that was not needed.
`pagehide` is a window event. They are now bound separately.

This was a real bug in the first version of this code, and the first test passed
anyway because the test dispatched the event at both targets. It was caught by
asking what the BROWSER does rather than what the test did: dispatched the
spec-accurate way, at the document alone, the window listener never fired.

### Timing

Writes are debounced 700 ms after the last change, because a pen sweep emits one
change per region crossed — but never deferred more than 5 s, so someone drawing
without pause is never far from a crash and a lost session.

### Verified, 2026-10-30

Paint three countries and save a bookmark, reload: all three come back with the
bookmark, 7.4 KB in the store. A corrupt record is salvaged under its own key,
the live one cleared, the failure reported in the toolbar in warning colour. A
quota failure keeps the work and drops the pictures. A document-only
`visibilitychange` flushes a change the debounce had not yet written. iPad
portrait restores and the notice wraps to three lines inside the toolbar.

**Not verified: the seven-day eviction itself**, which cannot be tested in an
afternoon and is the whole reason the wording is what it is. Nor whether
`navigator.storage.persist()` is granted on iPadOS — it is denied in this
browser, and whether a Home Screen install flips it is one more thing for the
device.

---

## 14. The colour that vanished when you zoomed out

Reported from use, not found by a test: *"when zooming out, some provinces and
countries that were colored in go white again at some point."*

### What was happening

tippecanoe reduces "tiny polygons" at low zoom by default — anything smaller
than about a pixel is accumulated into dust or dropped. That is right for a
basemap and wrong for this one, because **a region that is not in the tile has
no feature id, so its feature-state cannot be applied and it renders white**.

Nothing was lost: the colour stayed in the scenario the whole time and came back
on zooming in. But a child does not know that, and a map that forgets what you
coloured is a map you stop trusting.

Measured by decoding the archives and listing which feature ids are present at
each zoom, rather than by looking at the screen:

| archive | z0 | z1 | z2 | z3 | z4 | z5 | z6 | z7 |
|---|---|---|---|---|---|---|---|---|
| countries, of 254 | −29 | −16 | −6 | −3 | −3 | −3 | −2 | −1 |
| provinces, of 4,596 | — | — | −170 | −64 | −14 | −2 | −1 | −1 |

Luxembourg, Monaco, Andorra, San Marino, Liechtenstein and Gibraltar were all
gone by z2. **Vatican City was absent from every zoom in both archives** — it
could never be painted at all, at any zoom, and nobody had noticed.

### The fix, and what it cost

`--no-tiny-polygon-reduction`. Countries are now complete from z5, provinces
from z3, and the Vatican is paintable from z3. The cost is nothing worth
measuring: countries 3.64 → 3.66 MB, provinces 23.07 → 23.09 MB. Urban areas
were already complete at every zoom, because they start at z4 where the blobs
are big enough to survive.

What it cannot fix is quantisation. A tile is a 4096-unit grid; at z0 the
Vatican is about a ten-thousandth of one unit across, so there is no area for it
to round to. Five micro-territories are still absent at the world view — Vatican
City, Coral Sea Islands, Clipperton, Ashmore and Cartier, Scarborough Reef — and
all five appear as you zoom in. Raising the tile detail does not help: even at
65,536 units the Vatican is still under one unit at z0.

### Why the existing guard did not catch it

`build-tiles.sh` already carried a careful header about flags that must not be
used, naming `--coalesce`, `--coalesce-smallest-as-needed` and
`--drop-densest-as-needed`, all for exactly this reason. It missed the one that
is **on by default**, which is the only one you do not have to type.

And `data/README.md` claimed "every feature survives: 254 / 4,596 / 2,143 in,
the same out" — a true-sounding check that counted distinct features across the
whole archive instead of per zoom, and so could never have detected this. The
check that would have caught it is the one now in PLAN: decode each tile and ask
which ids are present at each level.

### Verified, 2026-10-31

Six states that used to vanish — Luxembourg, Liechtenstein, Monaco, Andorra,
San Marino, Germany — painted and then checked against what is actually DRAWN at
z0, z1, z2, z3, z4, z5 and z6. All six come back `drawn-coloured` at every zoom
where they are in view.

⚠️ Note for anyone testing this again: `map.getFeatureState()` returns the
stored state whether or not the feature exists in the current tiles, so it
reports success even while the map shows white. The honest test is
`queryRenderedFeatures`, which only returns what the tiles actually carry. The
first version of this check used `getFeatureState` and passed on a broken build.

### Two things the deploy itself exposed

⚠️ **A tile fix does not reach anyone for up to four hours.** The archives are
served from fixed paths — `tiles/countries.pmtiles.gz` never changes name — and
Pages sends `cache-control: max-age=14400`. The deploy watcher here timed out
after ten minutes still being handed the OLD archive, and only once Cloudflare
revalidated (`cf-cache-status: EXPIRED`) did the new one appear. Nothing is
broken, but "deployed" and "reaching users" are four hours apart for tile data,
and that is worth knowing before concluding a tile fix did not work.

⚠️ **`public/sw.js` caches `data/*.json` forever, on an assumption that is only
half true.** Its comment reads "Vite's filenames are content-hashed, so a cached
hit can never be stale" — correct for `assets/*`, and wrong for
`data/labels.json` and `data/neighbours.json`, which are served from fixed paths
and cached first. A returning user would never receive an update to either.
Tiles are safe only by accident: the worker skips range requests, so it never
caches them at all. **Fixed in §15**, which also records the two ways the first
attempt at the fix measured the wrong thing.

### The rest of the self-check, same session

Everything else was re-run from a wiped store on the fixed build:

| | |
|---|---|
| clean boot | 8 sources loaded, 20 layers, 5 tools, no failing resource of 83 |
| painting | country, province and urban all apply and survive a z0↔z9 round trip |
| fill | bounded to the continent |
| hatching | persists to the scenario; two neighbours hatched alike keep their border |
| eraser / undo / redo | erase removes, undo restores, redo removes again |
| border fade | ESP\|PRT goes 1 → 0 on a match, ESP\|FRA untouched |
| labels | render, including Vietnamese diacritics |
| pen | dragged to x=284, ink stops at x=447, Spain ends at x=450 |
| bookmarks | saved with a 3.4 KB thumbnail |
| relief toggle | paint, fade, strokes and bookmarks all survive the restyle |
| names toggle | 4 labels → 0 → 4 |
| autosave | paint, strokes, bookmarks and the recomputed fade all restore |
| export / import | round-trips exactly, 6.1 KB, stroke geometry and thumbnail intact |

## 15. The service worker that froze the data files

§14 recorded this and left it: `public/sw.js` cached `data/*.json` cache-first
and for ever, on a comment that read *"Vite's filenames are content-hashed, so a
cached hit can never be stale"*. True of `assets/*`, false of everything else.
Fixed here.

### What it cost

Nothing visible, which is why it could have run for a year. The files pinned
were `data/labels.json`, `data/neighbours.json`, `fonts.css`, `fonts/*.woff2`,
`icons/*.png` and `manifest.webmanifest` — every one of them on a fixed path. A
returning visitor was stuck with whatever copy they first downloaded, with no
way out but clearing site data.

`neighbours.json` is the one that would have hurt: it is what the fill tool
floods across and what decides which borders may fade. A corrected adjacency
table would never have arrived, and the symptom — fill stopping at the wrong
coastline — looks nothing like a caching bug.

### The strategy now

| | |
|---|---|
| `assets/*` | cache-first. A content hash in the name means a hit cannot be stale. |
| `tiles/*` | never stored. Read by Range request, and `Cache.put()` rejects a 206 — they escaped the old rule by accident, now deliberately. |
| everything else | stale-while-revalidate, against the server's own `max-age`. |

**The default is the fix, not the two exceptions.** A file added to `public/`
later now inherits stale-while-revalidate, which is wrong for at most one load.
The old default was wrong until the user wiped the site.

Freshness is measured against the origin's own `Cache-Control`, so Pages'
`max-age=600` for the JSON and `max-age=14400` for the fonts are each honoured
at their own pace rather than on some number invented in the worker.

### Three things that only showed up under test

⚠️ **The age must come from our own stamp, not the response's `Date`.** A
conditional refresh answered `304` is served out of the HTTP cache, and whether
the stored `Date` is then updated is up to the engine. Where it is not, the copy
is permanently past its max-age and *every* load fires a revalidation that can
never settle it. Our own stamp converges by construction — and because both ends
of the subtraction come from the same clock, an iPad that is minutes or hours out
cancels instead of either freezing a file or storming the network.

⚠️ **`Cache.addAll()` writes straight past `store()`.** The shell and
`fonts.css` were precached that way and so carried no stamp — and an unstamped
entry is stale by definition, so those two would have revalidated on every load
for ever while the files beside them behaved. Found by listing the live cache,
not by reading the code.

⚠️ **A plain `fetch()` can be answered from the browser's HTTP cache without
reaching the network**, which made both halves of the scheme measure the wrong
thing: a background refresh would replace a stale copy with one exactly as
stale and stamp it as new, and a cold miss would store a copy already up to
`max-age` old and stamp it as current — stacking the HTTP cache's window on top
of ours. `cache: 'no-cache'` forces a conditional request instead. It does not
mean "download again": every file here has an ETag, so an unchanged 324 KB
`neighbours.json` costs a `304` of a few hundred bytes.

### `npm run preview` cannot test any of this

None of the behaviour above exists without response headers vite preview does
not send: no `max-age`, no `ETag`, no `Vary`. Against it every branch takes a
path it would never take in production. Hence
`data/scripts/serve-like-pages.mjs` (launch config `atlas-like-pages`), which
serves `dist/` with the headers measured from the live site, answers `304` to a
conditional GET, and supports Range so the tiles still stream.

Its `max-age` split is by extension, not directory — Cloudflare's default
cacheable-extension list, so `assets/main-<hash>.js` gets 14400 while
`assets/maplibre-gl-worker-<hash>.mjs` beside it gets 600. The first version of
the fixture guessed 600 for everything under `assets/`; the live cache after
this deploy said otherwise. It changes nothing for the worker, which takes
`assets/*` cache-first and never reads their max-age — but a fixture that
misreports production is how this whole class of bug starts.

### Measured, on the real Cache API

Old worker, server changed underneath it: the client served the stale table on
load 1, 2, 3, 4 and 5 — one network request in total, and never the new file.
New worker: stale copy served in **7 ms** with no network wait, the refresh
landing behind it, and the corrected table on the next load. A day's worth of
staleness across the whole app cost five `304`s and one `200` — the one file
that had actually changed.

Then on the live site, after deploying: `atlas-v1` alone (the old cache gone),
twelve entries, every one stamped, no tile archive among them. A stale copy
served in 15 ms and the refresh converging to an age of 2 s, so it will not ask
again for another ten minutes. Cloudflare answers a conditional GET with `304`
and **0 bytes** for both JSON files, which is what makes a refresh of the 1 MB
`labels.json` free. Note that the browser reports a revalidated response to the
page as `200`, so a network panel cannot tell these apart — `curl -H
'If-None-Match: …'` can.

### Still open, found by reviewing this change

⚠️ **A VERSION bump pulls the cache out from under an already-open page.**
`install` skip-waits and `activate` deletes every other `atlas-` cache and
claims live clients, so an atlas left open on an iPad across a deploy keeps
running the old build against an almost-empty cache. The deletion is
load-bearing — `caches.match()` searches every cache, so without it the old
frozen copies would simply shadow the new ones — so this is a real tension, not
an oversight. The install half is fixed: it no longer catches its own failure,
so a precache that fails now discards the worker and leaves the previous one
serving its intact cache, instead of promoting an empty one and wiping the good
one on the way through.

## 16. Offline, which had never actually worked

Found by reviewing §15, then confirmed by listing the cache rather than reading
the code: **the app had never booted offline.** The header of `public/sw.js`
claimed "offline on a second visit". The cache after a first visit held two
entries — the shell and `fonts.css` — and no `assets/` at all.

### Why a first visit cached nothing

`src/main.ts` registers the worker from the window `load` event, and `load`
does not fire until every subresource of the page has already been fetched. By
the time `install` runs there is nothing left for the fetch handler to see. So
visit 2 was the first load the worker controlled end to end, which made visit 3
the first that could have worked offline — and WebKit's seven-day eviction
(§13) puts an idle iPad back to visit 1 over and over.

What an offline visit 2 actually gave you is worth being precise about, because
it is worse than a failure: the shell loaded from the precache, every script
and stylesheet it asked for failed, and the child got **an unstyled HTML
skeleton with dead buttons, stuck on "Opening the last drawing…"**. A page that
looks loaded and does nothing.

### Reading the filenames instead of guessing them

A hand-rolled worker cannot know Vite's hashed filenames at build time, but it
can read them at install time out of the shell it has just fetched. `precache()`
does three passes:

1. the shell, and every `src`/`href` in it. Scripts and stylesheets are
   **required** — without them an offline load is the dead page above;
2. asset names written *inside* those bundles. **MapLibre's worker chunk is
   reached only this way**: it appears nowhere in the shell, existing as a bare
   string in the maplibre chunk that is handed to `WORKER_URL` at runtime. Miss
   it and the map cannot start at all. It is also the only cross-asset
   reference in the entire bundle, so one hop is enough;
3. the woff2 files the stylesheets name, then the icons, manifest and the two
   data tables — best effort, because the app degrades without these rather
   than dying, and a worker that refuses to install is worse than one that
   installs without a font.

Nothing reachable only through CSS: every `url()` in the built stylesheets is a
`data:` URI, so there is no third hop to follow. Tiles are refused explicitly
even when the shell preloads one, so the crawl can never drag a 24 MB archive in.

### What it costs

The cache goes from 2 entries to **19, 3.09 MB** — but almost none of that is
new traffic. Install runs after `load`, so the browser has just fetched most of
it and `fetchFresh` asks conditionally. Measured on a cold first visit: the 1 MB
maplibre bundle, the 519 KB worker chunk and both JSON tables all came back
`304`. The only real downloads were the four font subsets the page had not yet
needed, the two icons and the manifest — about 100 KB.

### Measured, offline

Server stopped, so the origin is genuinely unreachable. The app boots: 4
stylesheets, 24 swatches, 5 tools, 7 font faces, a map canvas — indistinguishable
from online apart from the basemap.

⚠️ **A screenshot does not prove this.** The browser's own HTTP cache holds the
same files and would have served them whether or not any of this worked. The
isolating test is `fetch(url, {cache: 'reload'})`, which skips the HTTP cache
entirely — with the server down, anything that still resolves can only have come
from the service worker. All six probes returned full byte counts
(`maplibre-BZb1ahH5.js` 1,065,411 b, the worker chunk 519,372 b,
`noto-sans-vietnamese.woff2` 14,508 b), while the two controls — a tile and a
nonexistent path, neither of them cached — both failed with `TypeError: Failed
to fetch`. That is the network being dead and the cache answering anyway.

The old behaviour was then reproduced on the spot by deleting everything from
the cache except the shell and `fonts.css` and reloading, still offline: the
unstyled skeleton, exactly as described above. Same worker, same offline
condition, only the cache contents different.

Back online, a gutted cache refills through the ordinary runtime path without a
VERSION bump — though only with what the page actually requests, since `install`
runs once per version.

### Still not offline

The tile archives. They are read by Range request and `Cache.put()` rejects a
206, so an offline launch is a working editor over empty ocean. That is §3's
job and belongs in IndexedDB, not here.
