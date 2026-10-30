#!/bin/sh
# Re-download the self-hosted fonts.
#
# Source:   Google Fonts (fonts.googleapis.com / fonts.gstatic.com)
# Fonts:    Instrument Sans, JetBrains Mono, Noto Sans
# Licence:  SIL Open Font License 1.1 — self-hosting and redistribution permitted
# Why:      the app is an offline-capable PWA, so it cannot depend on the Fonts CDN
#           at runtime. (networkfieldnotes.com itself does load them from the CDN.)
#
# All three families are VARIABLE fonts: Google serves the same file for every weight
# in the range, so this script de-duplicates and emits one file per family+subset with
# a `font-weight: <min> <max>` range.
#
# ⚠️ THESE FILES DRAW THE MAP LABELS TOO, NOT JUST THE UI. MapLibre v6 takes font
# files directly through the style's `font-faces` property and rasterizes glyphs in
# the browser, so there is no glyph-PBF pipeline and no font server — see
# src/map/style.ts and PLAN.md section 9. That makes the subset list load-bearing:
# a name whose characters no subset covers falls back to whatever sans-serif the
# device happens to have, which differs between the iPad and a desktop.
#
# Subsets per family:
#   Instrument Sans   latin, latin-ext      the UI and the map labels
#   JetBrains Mono    latin, latin-ext      monospace UI numerals
#   Noto Sans         vietnamese            ONE Unicode block, for the map
#
# ⚠️ INSTRUMENT SANS HAS NO VIETNAMESE. Google serves it latin and latin-ext only —
# the typeface simply does not cover U+1EA0-1EF9 — and 15 characters of Natural
# Earth's admin-1 names live there: Đắk Nông, Quảng Trị, Thừa Thiên - Huế. Verified
# against data/out/*.geojson, those are the ONLY characters in all 5,500 region names
# that latin and latin-ext miss, so Cyrillic, Greek and CJK are still correctly left
# out. Noto Sans covers that one block and is narrowed to it by NOTO_VIETNAMESE below,
# so it can never pre-empt Instrument Sans for a character Instrument Sans has. A
# Vietnamese province name therefore renders its base letters in Instrument Sans and
# its two accented ones in Noto Sans — close enough to pass at label size, and
# identical on every device, which a system fallback would not be.
#
# Writes:  public/fonts/*.woff2  and  public/fonts.css
# fonts.css deliberately sits one level ABOVE the woff2 files so its relative
# url(fonts/...) resolves correctly under a subpath base such as /what-if-atlas/.
#
# Usage: sh data/scripts/fetch-fonts.sh     (run from the repo root)

set -eu

OUT=public/fonts
# macOS `mktemp -d` with no template ignores TMPDIR and uses the per-user temp
# directory, which a sandbox may not allow writing to. Spell the template out.
TMP=$(mktemp -d "${TMPDIR:-/tmp}/atlas-fonts.XXXXXX")
trap 'rm -rf "$TMP"' EXIT

UA='Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'
CSS='https://fonts.googleapis.com/css2?family=Instrument+Sans:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&family=Noto+Sans:wght@400;500;600&display=swap'

mkdir -p "$OUT"
# A modern UA is required or the API serves legacy ttf/woff instead of woff2.
curl -sSf -A "$UA" "$CSS" -o "$TMP/gf.css"

python3 - "$TMP" "$OUT" <<'PY'
import hashlib, os, re, subprocess, sys

tmp, out = sys.argv[1], sys.argv[2]
css = open(os.path.join(tmp, 'gf.css'), encoding='utf-8').read()

# Which subsets each family keeps. See the script header: the map labels are drawn
# from these same files, so this list decides what the map can spell.
SUBSETS = {
    'instrument-sans': ('latin', 'latin-ext'),
    'jetbrains-mono': ('latin', 'latin-ext'),
    'noto-sans': ('vietnamese',),
}

# Google's `vietnamese` subset also claims Ă, Đ, Ơ, Ư and the combining marks, all of
# which Instrument Sans already has. Narrowing Noto to the one block Instrument Sans
# is missing keeps every character it can draw itself in the right typeface — MapLibre
# picks the first declared face that covers a codepoint, so an overlap would decide
# this by declaration order instead.
NOTO_VIETNAMESE = 'U+1EA0-1EF9'
RANGE_OVERRIDES = {('noto-sans', 'vietnamese'): NOTO_VIETNAMESE}

RANGES, urls = {}, {}
for subset, blk in re.findall(r'/\* ([a-z-]+) \*/\s*(@font-face \{.*?\})', css, re.S):
    fam = re.search(r"font-family: '([^']+)'", blk).group(1)
    slug = fam.lower().replace(' ', '-')
    if subset not in SUBSETS.get(slug, ()):
        continue
    urls[(slug, subset)] = re.search(r'url\((https://[^)]+\.woff2)\)', blk).group(1)
    RANGES[(slug, subset)] = (RANGE_OVERRIDES.get((slug, subset))
                              or re.search(r'unicode-range: ([^;]+);', blk).group(1))

for slug, wanted in SUBSETS.items():
    missing = [s for s in wanted if (slug, s) not in urls]
    if missing:
        sys.exit(f'ERROR: Google Fonts served no {", ".join(missing)} subset for {slug} '
                 '— check the family name and the subset spelling in the CSS')

for (slug, subset), url in urls.items():
    dest = os.path.join(out, f'{slug}-{subset}.woff2')
    subprocess.run(['curl', '-sSf', '-o', dest, url], check=True)

# Sanity check: two subsets of one family must differ, or the parse mis-assigned them.
for slug, wanted in SUBSETS.items():
    seen = {}
    for subset in wanted:
        path = os.path.join(out, f'{slug}-{subset}.woff2')
        digest = hashlib.md5(open(path, 'rb').read()).hexdigest()
        if digest in seen:
            sys.exit(f'ERROR: {slug} {subset} and {seen[digest]} are identical '
                     '— check the CSS parse')
        seen[digest] = subset

FAMS = [('Instrument Sans', 'instrument-sans', '400 700'),
        ('JetBrains Mono', 'jetbrains-mono', '400 500'),
        ('Noto Sans', 'noto-sans', '400 600')]
blocks = []
for label, slug, wrange in FAMS:
    for subset in SUBSETS[slug]:
        blocks.append(
            '@font-face {\n'
            f"  font-family: '{label}';\n"
            '  font-style: normal;\n'
            f'  font-weight: {wrange};\n'
            '  font-display: swap;\n'
            f"  src: url(fonts/{slug}-{subset}.woff2) format('woff2-variations');\n"
            f'  unicode-range: {RANGES[(slug, subset)]};\n'
            '}')

subset_note = '\n'.join(
    f'   {label}: {", ".join(SUBSETS[slug])}' for label, slug, _ in FAMS)

open(os.path.join(out, os.pardir, 'fonts.css'), 'w', encoding='utf-8').write(
    '/* Self-hosted fonts, all SIL Open Font License 1.1.\n'
    '   GENERATED by data/scripts/fetch-fonts.sh — do not hand-edit.\n\n'
    '   Self-hosted so the app works offline; the blog loads these from the Google\n'
    '   Fonts CDN. All are VARIABLE fonts, so one file serves every weight in the\n'
    '   range. The MAP LABELS are drawn from these same files through the style\'s\n'
    '   `font-faces` property, so the subset list decides what the map can spell —\n'
    '   Noto Sans is here for one Unicode block Instrument Sans does not cover.\n'
    '   Subsets:\n'
    f'{subset_note}\n*/\n\n'
    + '\n\n'.join(blocks) + '\n')

# The map's font faces, as a TypeScript module rather than a second copy of the
# ranges in the style. The style needs them synchronously, before the first frame,
# so this cannot be a JSON file it fetches; and they must not be hand-written, since
# Google's split between latin and latin-ext is not the obvious one — latin-ext owns
# U+0100-02BA, so a latin face declared as U+0-2FF would claim every character it
# does not actually contain and silently fall back to the system font.
LABEL_FAMILIES = ('instrument-sans', 'noto-sans')
faces = []
for slug in LABEL_FAMILIES:
    for subset in SUBSETS[slug]:
        ranges = ', '.join(f"'{r.strip()}'" for r in RANGES[(slug, subset)].split(','))
        faces.append(f"  {{ file: '{slug}-{subset}.woff2', ranges: [{ranges}] }},")

open(os.path.join(out, os.pardir, os.pardir, 'src', 'map', 'fonts.generated.ts'), 'w',
     encoding='utf-8').write(
    '/**\n'
    ' * The font files the map labels are rasterized from, in the order MapLibre\n'
    ' * should try them.\n'
    ' *\n'
    ' * GENERATED by data/scripts/fetch-fonts.sh — do not hand-edit.\n'
    ' *\n'
    ' * ⚠️ The ranges are Google\'s own subset boundaries, copied from the stylesheet\n'
    ' * it serves, and they are not the obvious ones: `latin` stops at U+00FF and\n'
    ' * `latin-ext` owns U+0100-02BA. MapLibre takes the first declared face whose\n'
    ' * range covers a codepoint, so a widened range here would hand a character to a\n'
    ' * file that does not contain it and the glyph would come from the system font.\n'
    ' */\n\n'
    'export interface LabelFace {\n'
    '  /** File name under public/fonts/. */\n'
    '  file: string;\n'
    '  /** CSS `unicode-range` entries this file is allowed to cover. */\n'
    '  ranges: string[];\n'
    '}\n\n'
    'export const LABEL_FACES: LabelFace[] = [\n'
    + '\n'.join(faces) + '\n];\n')

total = sum(os.path.getsize(os.path.join(out, f)) for f in os.listdir(out))
print(f'{len(urls)} woff2 files + fonts.css + src/map/fonts.generated.ts, '
      f'{total / 1024:.0f} KB of fonts')
PY
