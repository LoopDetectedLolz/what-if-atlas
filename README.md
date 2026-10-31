# What-If Atlas

An interactive world atlas for learning geography and geopolitics: colour in
countries, draw on the land with an Apple Pencil, mark who occupies what, and
play back history as animated recordings.

Built for an iPad in Safari first, desktop browsers second. Static site, no
server, no API keys, no paid tile services.

**[PLAN.md](PLAN.md) is the design document** — architecture, data licences,
milestones, and the decisions already settled. Read it before changing anything
structural.

---

## Running it

```bash
npm install
npm run dev
```

Then open <http://localhost:5173/what-if-atlas/> — note the subpath, which
matches the deployed base.

⚠️ `vite.config.ts` serves `tiles/*.pmtiles.gz` through a small handler of its
own. Those files are **not** gzipped despite the name (see below), and Vite's
static server would otherwise answer with `Content-Encoding: gzip` and the
browser would fail to inflate them. Deleting that handler breaks the map
locally while leaving the deployed site working.

To try it on the iPad over the same wifi, the dev server already binds all
interfaces: open `http://<your-mac-lan-ip>:5173/what-if-atlas/`.

```bash
npm run build      # type-checks, then builds to dist/
npm run preview    # serves dist/ at http://localhost:4173/what-if-atlas/
```

## Where things are

| Path | What |
|---|---|
| `src/map/` | Map construction, the atlas style, the label layers, and the worker fix |
| `src/dev/fps.ts` | Frame-rate probe — the milestone sign-off gate |
| `src/ui/glass.css` | The glass system, ported from networkfieldnotes.com |
| `probe.html` | **Milestone-0 device probe** — see below |
| `data/` | Sources, licences, and the scripts that build each dataset |
| `.github/workflows/deploy.yml` | Build and deploy to GitHub Pages |

## The device probe

`probe.html` answers the one question the whole pen design rests on, and which
no specification answers: **on iPad Safari, does WebKit keep delivering pen
`pointermove` after `preventDefault()` on a stylus-only `touchstart`?**

It has to run on the real iPad to mean anything. It is readable and reportable
on-device because there is no usable console there: four guided tests with
auto-detected verdicts, the Pencil's actual capabilities, and a **Copy report**
button.

## The fading borders

Colour two neighbouring regions the same and the line between them fades out
over 300 ms, so the pair reads as one bloc; coastlines never fade. This needs
the region outlines cut apart at build time into borders and coastline, because
MapLibre's opacity is per feature and a country's outline is one feature
carrying both — `data/scripts/build-borders.mjs`, then its own PMTiles archives.

PLAN.md §10 has the rest: why a border's id is a PAIR id, why the border
archives must be cut with the same settings as the fills they sit on, what the
colour-match rule does and does not cover, and why a continent fill snaps
instead of easing.

## Labels

The map draws its own place names with **no glyph pipeline, no font server and
no API key**: MapLibre v6 takes the self-hosted `public/fonts/*.woff2` directly
through the style's `font-faces` property and rasterizes glyphs in the browser.
Anchors come from `public/data/labels.json`, built from Natural Earth's own
cartographer-chosen label coordinates, and the reveal schedule is NE's label
rank rather than hand-tuned zoom cutoffs. **Names on/off** is in the toolbar.

PLAN.md §9 has the full reasoning, including why labels are a separate point
dataset rather than symbols on the paintable polygon layers, and why Noto Sans
is self-hosted for one Unicode block.

## Deploying

Serves at `networkfieldnotes.com/what-if-atlas/` — a GitHub Pages *project*
page inherits the *user* page's custom domain automatically.

Two rules, both load-bearing:

1. **No `CNAME` file in this repo, and no custom domain in its Pages settings.**
   GitHub enforces that a domain is unique across all Pages sites and
   `LoopDetectedLolz.github.io` already holds `networkfieldnotes.com`. Adding it
   here is the most likely way to take the blog offline.
2. Set **Settings → Pages → Source** to **GitHub Actions**, not "Deploy from a
   branch".

The repo name *is* the URL path. Renaming the repo changes the public URL and
the `base` in `vite.config.ts` must change with it.

### Verifying a deploy

```bash
sh data/scripts/check-deploy.sh
```

Checks the page, `noindex`, the static assets, and — the one that matters —
that each PMTiles archive answers a byte range out of its **real, uncompressed
bytes**, at two different offsets.

⚠️ **The tile archives are named `*.pmtiles.gz` and are not gzipped.** The
extension is load-bearing: GitHub Pages compresses `application/octet-stream`
and then slices byte ranges out of the compressed copy, which feeds PMTiles
garbage and renders an empty map while every other asset loads fine.
`application/gzip` is a type Pages leaves alone. Do not gunzip them or "fix"
the name — see PLAN.md §8.

⚠️ Do not verify byte serving with a plain `curl -r 0-1023`, and do not trust
"got a 206 with no `content-encoding`" either. Both pass while the site is
broken for every real browser. The check that cannot be fooled is the total in
`content-range: bytes a-b/TOTAL` against the real file size, plus a strong
(non-`W/`) etag. Three weaker checks gave false passes here; PLAN.md §8 lists
them.

### Keeping it unlisted

`<meta name="robots" content="noindex, nofollow">` is in the HTML — the only
mechanism that works on Pages alone, and it covers HTML only. The PMTiles and
JSON need an `X-Robots-Tag` header, which has to come from Cloudflare.

Do **not** add a `robots.txt` `Disallow` yet: it and `noindex` defeat each other,
because a blocked crawler never reads the `noindex`. And a `robots.txt` inside
this repo has no effect at all — per RFC 9309 it only counts at the host root,
which lives in the blog repo, where `build-blog.py` rewrites it on every build.

This is search hygiene, not access control. Anyone with the URL can open it.

## Licence

**Code:** not yet chosen — add a `LICENSE` before this repo is shared with
anyone.

**Data:** every dataset's licence is recorded in
[`data/README.md`](data/README.md), and they are not all the same. Natural Earth
is public domain, OpenHistoricalMap is CC0, Global Energy Monitor is CC BY 4.0
with a required attribution string, and some sources (USHMM, FAS) are cite-only.
The project's own derived data files are intended to be **CC0** — which is also
why `aourednik/historical-basemaps` is kept out of them: it is GPL-3.0 and its
author has separately said commercial use is not permitted, so its copyleft
would spread into anything derived from it.
