#!/bin/sh
# Generate the PWA / apple-touch icons from one SVG source.
#
# Needs rsvg-convert:  brew install librsvg
# Usage: sh data/scripts/build-icons.sh      (from the repo root)
#
# Two artworks, because they have different safe areas:
#   icon.svg           — "any" purpose, artwork fills the tile
#   icon-maskable.svg  — "maskable", artwork kept inside the centre 80% so
#                        Android/iOS can crop it to a circle or squircle
#                        without clipping the globe.

set -eu

SRC=data/raw/icons
OUT=public/icons
mkdir -p "$SRC" "$OUT"

# ── the plain icon ──────────────────────────────────────────────────────────
cat > "$SRC/icon.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs>
    <linearGradient id="sky" x1="0" y1="0" x2="0.6" y2="1">
      <stop offset="0" stop-color="#0E2A3C"/>
      <stop offset="1" stop-color="#061019"/>
    </linearGradient>
    <clipPath id="globe"><circle cx="256" cy="256" r="168"/></clipPath>
  </defs>
  <rect width="512" height="512" rx="112" fill="url(#sky)"/>
  <circle cx="256" cy="256" r="168" fill="#CFE4F2"/>
  <g clip-path="url(#globe)" fill="#FFFFFF">
    <!-- Suggested landmasses, not a real projection: an icon, not a map. -->
    <path d="M96 150 q60-34 118-10 q46 20 30 58 q-14 34-62 30 q-52-4-74-28 q-18-20-12-50Z"/>
    <path d="M150 268 q44-16 72 10 q24 22 10 62 q-14 42-44 70 q-26 24-42 2 q-16-24-8-66 q6-42 12-78Z"/>
    <path d="M286 142 q78-26 128 6 q36 24 14 56 q-24 34-82 34 q-56 0-76-32 q-16-28 16-64Z"/>
    <path d="M300 258 q56-14 82 18 q22 28 2 70 q-20 42-56 44 q-32 2-40-36 q-8-42 12-96Z"/>
    <path d="M404 352 q34-10 44 16 q8 24-14 40 q-22 16-38-4 q-14-20 8-52Z"/>
  </g>
  <g fill="none" stroke="#2FA8E0" stroke-width="7" opacity="0.85">
    <circle cx="256" cy="256" r="168"/>
    <!-- graticule -->
    <path d="M256 88 v336"/>
    <path d="M88 256 h336"/>
    <ellipse cx="256" cy="256" rx="84" ry="168"/>
    <path d="M100 186 h312 M100 326 h312" opacity="0.6"/>
  </g>
</svg>
SVG

# ── the maskable icon: same globe, scaled into the centre 80% ───────────────
cat > "$SRC/icon-maskable.svg" <<'SVG'
<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 512 512" width="512" height="512">
  <defs><clipPath id="g2"><circle cx="256" cy="256" r="134"/></clipPath></defs>
  <rect width="512" height="512" fill="#0E2A3C"/>
  <circle cx="256" cy="256" r="134" fill="#CFE4F2"/>
  <g clip-path="url(#g2)" fill="#FFFFFF">
    <path d="M140 171 q48-27 94-8 q37 16 24 46 q-11 27-50 24 q-41-3-59-22 q-14-16-9-40Z"/>
    <path d="M183 265 q35-13 58 8 q19 18 8 50 q-11 34-35 56 q-21 19-34 2 q-13-19-6-53 q5-34 9-63Z"/>
    <path d="M292 165 q62-21 102 5 q29 19 11 45 q-19 27-65 27 q-45 0-61-26 q-13-22 13-51Z"/>
    <path d="M303 258 q45-11 66 14 q17 23 1 56 q-16 34-45 35 q-25 2-32-29 q-6-33 10-76Z"/>
  </g>
  <g fill="none" stroke="#2FA8E0" stroke-width="6" opacity="0.85">
    <circle cx="256" cy="256" r="134"/>
    <path d="M256 122 v268 M122 256 h268"/>
    <ellipse cx="256" cy="256" rx="67" ry="134"/>
  </g>
</svg>
SVG

for s in 192 512; do
  rsvg-convert -w "$s" -h "$s" "$SRC/icon.svg" -o "$OUT/icon-$s.png"
done
# apple-touch-icon: 180px, and iOS composites it on an opaque tile anyway.
rsvg-convert -w 180 -h 180 "$SRC/icon.svg" -o "$OUT/icon-180.png"
rsvg-convert -w 512 -h 512 "$SRC/icon-maskable.svg" -o "$OUT/icon-maskable-512.png"

for f in "$OUT"/*.png; do
  printf '  %-30s %6d B\n' "$(basename "$f")" "$(stat -f%z "$f")"
done
