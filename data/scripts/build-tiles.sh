#!/bin/sh
# Cut the region layers and the border lines into PMTiles archives.
#
# Input:   data/out/{countries,provinces,urban}.geojson      (build-regions.mjs)
#          data/out/borders-{country,province}.geojson       (build-borders.mjs)
# Output:  public/tiles/{countries,provinces,urban}.pmtiles.gz
#          public/tiles/{borders,subborders}.pmtiles.gz
# Needs:   brew install tippecanoe   (felt/tippecanoe, 2.17+ writes PMTiles directly)
#
# ⚠️ THE OUTPUT FILES ARE NOT GZIPPED, DESPITE THE NAME. Do not "fix" the
# extension, and do not gunzip them.
#
# GitHub Pages gzips any response whose content type it does not recognise, and
# then answers a byte-range request by slicing that COMPRESSED copy — so
# PMTiles, which reads an archive entirely through ranges, gets garbage and the
# map renders nothing. `.pmtiles` is served as `application/octet-stream` and is
# compressed; `application/gzip` is not. Measured on the live host:
#
#   .png .woff2 .mp4 .zip .gz   strong etag, correct content-range total
#   .pmtiles .bin .wasm         weak W/ etag, total = the GZIPPED size
#
# `.gz` is the choice because nothing in the chain ever transforms it, whereas a
# fake `.png` would be silently rewritten if Cloudflare Polish were turned on.
# See PLAN.md section 8. Verify after deploying: sh data/scripts/check-deploy.sh
#
# ⚠️ THE FLAGS MATTER MORE HERE THAN FOR A NORMAL BASEMAP.
#
# The editor paints regions by feature id, so every feature must survive at
# every zoom where it is paintable, with its identity intact. That rules out
# the flags you would normally reach for on a country basemap:
#
#   --coalesce                     merges adjacent features with equal
#                                  attributes — would fuse countries together
#   --coalesce-smallest-as-needed  merges small features into neighbours when a
#                                  tile is too big — silently destroys identity
#   --drop-densest-as-needed       drops features — a country would vanish
#
# Instead: keep EVERY feature (-pf -pk), and control size with simplification
# only. --no-simplification-of-shared-nodes (the non-deprecated replacement for
# --detect-shared-borders) keeps a shared border from cracking into two
# slightly different lines, which would show as hairline gaps between
# neighbours — very visible once both sides are coloured in.
#
# ⚠️ THE BORDER ARCHIVES MUST BE CUT WITH THE SAME SETTINGS AS THE POLYGONS THEY
# BELONG TO. A border line is drawn directly on top of the seam between two
# fills, so if it is simplified differently from those fills it drifts off the
# colour boundary and the map shows a line beside the join instead of on it.
# borders matches countries, subborders matches provinces — zoom range and
# --simplification both. Change one and change its pair.
#
# Usage: sh data/scripts/build-tiles.sh                  (all of them)
#        sh data/scripts/build-tiles.sh borders          (just the named ones)
#
# Cutting everything takes minutes; naming one archive is how you iterate on it.

set -eu

command -v tippecanoe >/dev/null || { echo "tippecanoe not found: brew install tippecanoe"; exit 1; }

OUT=public/tiles
mkdir -p "$OUT"

# tippecanoe and the pmtiles CLI both key off the .pmtiles extension, so build
# under the real name in scratch and install under the served name.
BUILD="${TMPDIR:-/tmp}/atlas-tiles"
mkdir -p "$BUILD"

# tippecanoe scratches in /tmp by default; honour TMPDIR so it works inside a
# sandbox that only allows writes to the project dir and TMPDIR.
TMP="${TMPDIR:-/tmp}"
KEEP="-pf -pk --no-simplification-of-shared-nodes --reorder --hilbert --force -t $TMP"

# name | source geojson | zoom range | simplification
#
#   countries   paintable from the world view up; z0 holds all 254 in one tile
#   provinces   4,596 features; min zoom 2 so the level is queryable just before
#               it becomes the active snap level
#   urban       small blobs, so they need detail rather than reach
#   borders     country coastline and country borders, cut apart so a border can
#               fade on its own; matches countries
#   subborders  province borders only — the province coastline is the country
#               coastline and is never seen under it; matches provinces
ARCHIVES="
countries  data/out/countries.geojson        -Z0 -z7  6
provinces  data/out/provinces.geojson        -Z2 -z9  5
urban      data/out/urban.geojson            -Z4 -z12 3
borders    data/out/borders-country.geojson  -Z0 -z7  6
subborders data/out/borders-province.geojson -Z2 -z9  5
"

wanted="$*"
built=""

echo "$ARCHIVES" | while read -r name src zmin zmax simp; do
  [ -n "$name" ] || continue
  case " $wanted " in
    "  ") ;;                                  # no arguments: build everything
    *" $name "*) ;;                           # named on the command line
    *) continue ;;
  esac
  [ -f "$src" ] || { echo "missing input: $src — run the build script that makes it"; exit 1; }
  echo "cutting $name from $src"
  tippecanoe -o "$BUILD/$name.pmtiles" -l "$name" "$zmin" "$zmax" --simplification="$simp" $KEEP "$src"

  # The source-layer name in src/map/*.ts must match -l above, and a mismatch
  # renders an empty map with no error at all.
  echo "  layer metadata:"
  pmtiles show "$BUILD/$name.pmtiles" 2>/dev/null | sed -n 's/^/    /p' | head -8 \
    || echo "    (install pmtiles for metadata: brew install pmtiles)"

  # Install under the served name. See the header: the .gz is a serving
  # workaround, not compression.
  dest="$OUT/$name.pmtiles.gz"
  cp "$BUILD/$name.pmtiles" "$dest"
  printf '  installed %-26s %7.1f MB (NOT gzipped)\n' "$name.pmtiles.gz" \
    "$(echo "scale=1; $(stat -f%z "$dest")/1048576" | bc)"
done

echo
echo "done. Verify a deploy with: sh data/scripts/check-deploy.sh"
echo "$built" >/dev/null
