#!/bin/sh
# Smoke-test the deployed site. Run after any deploy, or after changing
# anything in front of it (Cloudflare rules, DNS, Pages settings).
#
# Usage: sh data/scripts/check-deploy.sh [base-url]
#        default base: https://networkfieldnotes.com/what-if-atlas
#
# ⚠️ THE POINT OF THIS SCRIPT IS THE BYTE-SERVING CHECK, AND WHY IT IS FUSSY.
#
# PMTiles reads each archive entirely through HTTP range requests. A host that
# compresses the response cannot then honour a byte range against the real
# bytes — and GitHub Pages does exactly that for any content type it does not
# recognise, answering the range by slicing the COMPRESSED copy. PMTiles reads
# garbage past the first block and the map renders nothing at all while every
# other check on the page passes.
#
# That is why the archives are served as `*.pmtiles.gz` — they are NOT gzipped;
# `application/gzip` is simply a type Pages leaves alone. See PLAN.md section 8.
#
# THREE WEAKER CHECKS EACH GAVE A FALSE PASS ON THIS PROJECT:
#
#   1. A bare `curl -r 0-1023` — curl sends no Accept-Encoding by default, so
#      it gets an uncompressed, correct 206 even when every browser is broken.
#   2. Browser-like Accept-Encoding plus "is it a 206 with no content-encoding"
#      — a range sliced out of a compressed representation satisfies both.
#   3. Asking for `Accept-Encoding: identity` — Pages ignores it and serves the
#      compressed representation anyway.
#
# The check that cannot be fooled is the total in the content-range header:
#
#     content-range: bytes 0-16383/<total>
#
# <total> must equal the real byte size of the archive. A smaller total means
# the range came from a compressed copy. A weak `W/` etag says the same thing:
# the representation has been transformed.

set -eu

BASE="${1:-https://networkfieldnotes.com/what-if-atlas}"
BROWSER_AE='gzip, deflate, br, zstd'
# The GitHub Pages origin, behind the custom domain. Checking both tells you
# which layer is at fault instead of leaving you to guess.
ORIGIN="${ORIGIN:-https://loopdetectedlolz.github.io/what-if-atlas}"
fails=0

say()  { printf '%s\n' "$*"; }
ok()   { printf '  \033[32mok\033[0m    %s\n' "$*"; }
bad()  { printf '  \033[31mFAIL\033[0m  %s\n' "$*"; fails=$((fails + 1)); }

say "checking $BASE"
say

# ── the page itself ─────────────────────────────────────────────────────────
code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/")
[ "$code" = 200 ] && ok "page serves (200)" || bad "page returned $code"

if curl -sS "$BASE/" | grep -q 'name="robots" content="noindex'; then
  ok "noindex meta present"
else
  bad "noindex meta MISSING — the page would be indexable"
fi

# ── static assets ───────────────────────────────────────────────────────────
for f in manifest.webmanifest sw.js fonts.css data/neighbours.json \
         data/labels.json fonts/instrument-sans-latin.woff2 \
         fonts/instrument-sans-latin-ext.woff2 fonts/noto-sans-vietnamese.woff2 \
         icons/icon-192.png icons/icon-512.png probe.html; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$f")
  [ "$code" = 200 ] && ok "$f" || bad "$f returned $code"
done

# ── byte serving, the way a browser asks ────────────────────────────────────
#
# Reads at offset 0 and again deep inside the archive: PMTiles reads from
# arbitrary offsets, and a host can get the first range right and later ones
# wrong.
say
say "byte serving (browser-like Accept-Encoding):"
for t in countries provinces urban borders subborders; do
  name="$t.pmtiles.gz"
  local_file="public/tiles/$name"
  real=''
  [ -f "$local_file" ] && real=$(wc -c < "$local_file" | tr -d ' ')

  for range in 0-16383 1048576-1064959; do
    # ⚠️ RETRY ON A DROPPED REQUEST, OR THIS SCRIPT LIES IN THE OTHER DIRECTION.
    # A connection that fails outright leaves no status line, which read as "the
    # host ignored the range" — a frightening and completely wrong diagnosis for
    # one dropped packet on a 38 MB archive. Only an answer the host actually
    # gave is worth judging.
    attempt=0
    while [ "$attempt" -lt 3 ]; do
      attempt=$((attempt + 1))
      hdr=$(curl -sS --retry 0 -r "$range" -H "Accept-Encoding: $BROWSER_AE" -D - -o "/dev/null" \
            "$BASE/tiles/$name" 2>/dev/null | tr -d '\r')
      status=$(printf '%s\n' "$hdr" | awk '/^HTTP\/[0-9.]+ [0-9]{3}/ {s=$2} END {print s}')
      [ -n "$status" ] && break
    done
    enc=$(printf '%s\n' "$hdr" | awk 'tolower($1) == "content-encoding:" {print $2}')
    etag=$(printf '%s\n' "$hdr" | awk 'tolower($1) == "etag:" {print $2}')
    # content-range: bytes <start>-<end>/<total>
    total=$(printf '%s\n' "$hdr" | awk 'tolower($1) == "content-range:" {split($3, a, "/"); print a[2]}')

    if [ -z "$status" ]; then
      bad "$name @$range: no response after $attempt attempts — the request never completed, which is a network problem and not a serving one"
    elif [ "$status" != 206 ]; then
      bad "$name @$range: status $status, expected 206 — the host ignored the range"
    elif [ -n "$enc" ]; then
      bad "$name @$range: 206 but content-encoding: $enc — a compressed range is not byte serving"
    elif [ -z "$total" ]; then
      bad "$name @$range: 206 but no content-range header"
    elif [ -n "$real" ] && [ "$total" != "$real" ]; then
      bad "$name @$range: content-range total is $total, file is $real — the range was sliced from a COMPRESSED copy, so PMTiles reads garbage"
    elif [ "${etag#W/}" != "$etag" ]; then
      bad "$name @$range: weak etag $etag — the response was transformed in flight"
    elif [ -z "$real" ]; then
      ok "$name @$range: 206, total $total (no local copy to compare against)"
    else
      ok "$name @$range: 206, strong etag, total matches the file"
    fi
  done
done

# ── which layer is at fault, if any ─────────────────────────────────────────
#
# Informational. If the origin is broken too, no Cloudflare setting can fix it
# and the fault is GitHub Pages' own CDN.
if [ "$fails" -ne 0 ]; then
  say
  say "comparing against the GitHub Pages origin ($ORIGIN):"
  o=$(curl -sS -L -r 0-16383 -H "Accept-Encoding: $BROWSER_AE" -D - -o /dev/null \
      "$ORIGIN/tiles/countries.pmtiles.gz" 2>/dev/null | tr -d '\r' \
      | awk 'tolower($1) == "content-range:" {split($3, a, "/"); print a[2]}' | tail -1)
  say "  origin content-range total: ${o:-none}"
  say "  If this is wrong too, the compression is GitHub Pages, not Cloudflare,"
  say "  and no Cloudflare rule will fix it. See PLAN.md section 8."
fi

say
if [ "$fails" -eq 0 ]; then
  say "all checks passed"
else
  say "$fails check(s) failed"
  exit 1
fi
