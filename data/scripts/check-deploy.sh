#!/bin/sh
# Smoke-test the deployed site. Run after any deploy, or after changing
# anything in front of it (Cloudflare rules, DNS, Pages settings).
#
# Usage: sh data/scripts/check-deploy.sh [base-url]
#        default base: https://networkfieldnotes.com/what-if-atlas
#
# ⚠️ THE POINT OF THIS SCRIPT IS THE BYTE-SERVING CHECK, AND WHY IT IS FUSSY.
#
# PMTiles reads each archive with HTTP range requests. A naive `curl -r 0-1023`
# PASSES even when the site is broken, because curl sends no Accept-Encoding by
# default and therefore gets an uncompressed, correct 206. A browser sends
# `Accept-Encoding: gzip, br`, and a CDN that compresses the response cannot
# then honour a byte range: it returns the WHOLE archive as a 200, PMTiles
# throws "Server returned no content-length header...", and the map renders
# nothing at all while the rest of the page looks perfectly healthy.
#
# So every range check below sends browser-like Accept-Encoding and asserts
# BOTH that the status is 206 AND that content-encoding is absent.
#
# This exact failure shipped once (see PLAN.md section 8): Cloudflare gzipped
# .pmtiles, and a curl check reported it as verified.

set -eu

BASE="${1:-https://networkfieldnotes.com/what-if-atlas}"
BROWSER_AE='gzip, deflate, br, zstd'
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
         icons/icon-192.png icons/icon-512.png probe.html; do
  code=$(curl -sS -o /dev/null -w '%{http_code}' "$BASE/$f")
  [ "$code" = 200 ] && ok "$f" || bad "$f returned $code"
done

# ── byte serving, the way a browser asks ────────────────────────────────────
say
say "byte serving (browser-like Accept-Encoding):"
for t in countries provinces urban; do
  hdr=$(curl -sS -r 0-16383 -H "Accept-Encoding: $BROWSER_AE" -D - -o /dev/null \
        "$BASE/tiles/$t.pmtiles" 2>/dev/null | tr -d '\r')

  status=$(printf '%s\n' "$hdr" | awk '/^HTTP\/[0-9.]+ [0-9]{3}/ {s=$2} END {print s}')
  enc=$(printf '%s\n' "$hdr" | awk 'tolower($1) == "content-encoding:" {print $2}')
  range=$(printf '%s\n' "$hdr" | awk 'tolower($1) == "content-range:" {print $2, $3}')

  if [ "$status" != 206 ]; then
    bad "$t.pmtiles: status $status, expected 206 — the CDN ignored the range and sent the whole file"
  elif [ -n "$enc" ]; then
    bad "$t.pmtiles: 206 but content-encoding: $enc — a compressed range is not byte serving"
  elif [ -z "$range" ]; then
    bad "$t.pmtiles: 206 but no content-range header"
  else
    ok "$t.pmtiles: 206, uncompressed, content-range $range"
  fi
done

say
if [ "$fails" -eq 0 ]; then
  say "all checks passed"
else
  say "$fails check(s) failed"
  say
  say "If the byte-serving checks failed, the usual cause is CDN compression on"
  say ".pmtiles. Fix in Cloudflare: Rules -> Compression Rules -> if URI Path"
  say "starts with /what-if-atlas/tiles/ then compression off. Scope it to the"
  say "path; do not disable Brotli/gzip for the whole site. See PLAN.md section 8."
  exit 1
fi
