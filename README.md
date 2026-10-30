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

To try it on the iPad over the same wifi, the dev server already binds all
interfaces: open `http://<your-mac-lan-ip>:5173/what-if-atlas/`.

```bash
npm run build      # type-checks, then builds to dist/
npm run preview    # serves dist/ at http://localhost:4173/what-if-atlas/
```

## Where things are

| Path | What |
|---|---|
| `src/map/` | Map construction, the atlas style, and the worker fix |
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
