#!/bin/sh
# Download the Natural Earth source layers into data/raw/.
#
# Source:   nvkelso/natural-earth-vector, pinned to tag v5.1.2
# Licence:  PUBLIC DOMAIN (Natural Earth)
# Size:     ~81 MB in total, which is why these are NOT committed — they are
#           reproducible from a pinned tag, and only the derived tiles
#           (public/tiles/*.pmtiles) and tables (public/data/*.json) are
#           versioned.
#
# Fetched from raw.githubusercontent.com at the tag rather than from
# naturalearthdata.com, whose own per-file download links return HTTP 500, and
# rather than naciscdn.org, which serves only zipped shapefiles.
#
# Full pipeline from a clean checkout:
#
#   sh   data/scripts/fetch-sources.sh      # this script  (~81 MB download)
#   node data/scripts/build-regions.mjs     # normalise, assign stable ids
#   node data/scripts/build-neighbours.mjs  # adjacency + continent table
#   sh   data/scripts/build-tiles.sh        # PMTiles  (needs tippecanoe)
#
# Usage: sh data/scripts/fetch-sources.sh    (from the repo root)

set -eu

TAG=v5.1.2
BASE="https://raw.githubusercontent.com/nvkelso/natural-earth-vector/$TAG/geojson"
OUT=data/raw

# The point-of-view file the atlas draws, the default file it is patched from,
# provinces, urban areas, places (for city names), and the 110m placeholder.
LAYERS="
ne_10m_admin_0_countries_usa
ne_10m_admin_0_countries
ne_10m_admin_1_states_provinces
ne_50m_urban_areas
ne_50m_populated_places
ne_110m_admin_0_countries
"

mkdir -p "$OUT"

for layer in $LAYERS; do
  dest="$OUT/$layer.geojson"
  if [ -s "$dest" ]; then
    printf '  have  %s\n' "$layer"
    continue
  fi
  printf '  fetch %s ... ' "$layer"
  curl -sSfL "$BASE/$layer.geojson" -o "$dest"
  printf '%s MB\n' "$(echo "scale=1; $(wc -c < "$dest")/1048576" | bc)"
done

echo
echo "next: node data/scripts/build-regions.mjs"
