#!/bin/sh
# Cut the three paintable region layers into PMTiles archives.
#
# Input:   data/out/{countries,provinces,urban}.geojson  (build-regions.mjs)
# Output:  public/tiles/{countries,provinces,urban}.pmtiles.gz
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
# Usage: sh data/scripts/build-tiles.sh      (from the repo root)

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

# Countries: paintable from the world view up. z0 holds all 254 in one tile.
tippecanoe -o "$BUILD/countries.pmtiles" -l countries \
  -Z0 -z7 --simplification=6 $KEEP \
  data/out/countries.geojson

# Provinces: 4,596 features. Min zoom 2 rather than 3 so the level is already
# queryable just before it becomes the active snap level.
tippecanoe -o "$BUILD/provinces.pmtiles" -l provinces \
  -Z2 -z9 --simplification=5 $KEEP \
  data/out/provinces.geojson

# Urban areas: small blobs, so they need detail rather than reach.
tippecanoe -o "$BUILD/urban.pmtiles" -l urban \
  -Z4 -z12 --simplification=3 $KEEP \
  data/out/urban.geojson

echo
echo "layer metadata (source-layer names must match the style):"
for f in "$BUILD"/*.pmtiles; do
  echo "  $(basename "$f"):"
  pmtiles show "$f" 2>/dev/null | sed -n 's/^/    /p' | head -12 || echo "    (install pmtiles for metadata: brew install pmtiles)"
done

# Install under the served name. See the header: the .gz is a serving
# workaround, not compression.
echo
echo "installed (NOT gzipped — see the header of this script):"
for f in "$BUILD"/*.pmtiles; do
  dest="$OUT/$(basename "$f").gz"
  cp "$f" "$dest"
  printf '  %-34s %7.1f MB\n' "$(basename "$dest")" "$(echo "scale=1; $(stat -f%z "$dest")/1048576" | bc)"
done
