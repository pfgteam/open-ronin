#!/usr/bin/env bash
# ui-audit.sh — visual-cohesion regression guard for Open Ronin
# Counts banned styling patterns in web/src. Exits 1 if any are found.
# Rules: see UI_GUIDELINES.md. Established after the 2026-08-13 cohesion audit.
set -uo pipefail

ROOT="$(cd "$(dirname "$0")/.." && pwd)"
SRC="$ROOT/web/src"
fail=0

check() {
  local label="$1" pattern="$2"
  local count
  count=$(grep -rEho "$pattern" --include='*.tsx' "$SRC" 2>/dev/null | wc -l | tr -d ' ')
  if [ "$count" -gt 0 ]; then
    echo "FAIL  $label: $count occurrence(s)"
    grep -rEn "$pattern" --include='*.tsx' "$SRC" | head -5 | sed 's/^/      /'
    fail=1
  else
    echo "ok    $label"
  fi
}

echo "== Open Ronin UI audit =="

# Dark mode: slate-800 painted on Card's own slate-800 background
check "dark:hover:bg-slate-800 (invisible in Card)" 'dark:hover:bg-slate-800'
check "dark:border-slate-800 (invisible in Card)"   'dark:border-slate-800[^/0-9]'

# Color: one green, no strays, slate-only neutrals
check "emerald-* (use green-*)"                     '[-:]emerald-[0-9]'
check "blue-* (use primary-*)"                      '[-:]blue-[0-9]'
check "gray/zinc/neutral/stone neutrals"            '[-:](gray|zinc|neutral|stone)-[0-9]'
check "secondary-* (removed scale)"                 '[-:]secondary-[0-9]'

# Typography: no arbitrary px sizes (decimals too — text-[12.5px] counts)
check "text-[Npx] arbitrary size (use text-2xs/xs)" 'text-\[[0-9.]+px\]'

# Radius: no bare `rounded`. Covers "..."/backtick class strings, mid-classlist,
# and single-quoted class LISTS ('rounded foo' / 'foo rounded') — but not a lone
# 'rounded', which is indistinguishable from a TS string literal (GraphCanvas shape).
check "bare 'rounded' (use rounded-md)"             "[\"\` ]rounded[\"\` ]|'rounded | rounded'"

# --- Gaps found in the 2026-09-16 UI/UX audit -------------------------------
# Each of these existed BECAUSE the checks above did not cover them, so the
# guidelines read as enforced while the drift shipped.

# Focus: the guidelines ban focus:ring-0/ring-1 outright. A chrome-less input
# is fine, but it needs focus-visible styling on itself or its container —
# QuickAddModal (⌘K from every page) had no focus indicator at all.
check "focus:ring-0/1 (no visible focus)"           'focus:ring-[01][^0-9]'

# Focus: reskin 1/n's 3px primary-50 halo is ~1.05:1 on the card — invisible.
# Fields use fieldFocus / controls use controlFocus (components/ui/focus.ts).
check "focus:ring-primary-50 halo (invisible focus)" 'focus:ring-primary-50[^0-9]'

# Color: the hex check below only matches #rrggbb, so space-separated rgb()
# smuggled blue-500, indigo-500 and two banned neutral families into
# GraphCanvas untouched.
check "raw rgb()/rgba() (use tokens)"               'rgba?\([0-9]'

# Color: a hex inside a base64 data: URI is invisible to every check here.
# _form.tsx's select chevron carried Tailwind's slate-400 (#94a3b8) this way.
check "base64 data: URI in a class (hides colors)"  'base64,[A-Za-z0-9+/=]{40,}'

# --- Style guide adoption (2026-11-05) --------------------------------------
# Decisions locked in the Open Ronin style guide (UI_GUIDELINES.md, "Style
# guide decisions"). Hard checks fail the build; ratchets fail only when a
# count GROWS past scripts/ui-audit-baseline.txt (lower it as screens are
# swept; never raise it to make a build pass).

# Decision 2: one modal radius. rounded-xl / rounded-2xl left the system.
check "rounded-xl/2xl/3xl (use rounded-lg)"         '\brounded-(xl|2xl|3xl)\b'
# Decision 4: shadow-panel is the only elevation.
check "shadow-sm/md/lg/xl/2xl (use shadow-panel)"   '\bshadow-(sm|md|lg|xl|2xl)\b'
# Decision 6: the z scale (z-10 sticky table parts ... z-[100] toast).
check "z-[1] (use z-10)"                            'z-\[1\]'
# Colours built in template strings dodge every other colour check.
check "template rgba()/hsl() (use tokens)"          '(rgba?|hsla?)\(\$\{'

BASELINE="$ROOT/scripts/ui-audit-baseline.txt"
base() { grep -E "^$1=" "$BASELINE" 2>/dev/null | cut -d= -f2; }
ratchet() {
  local key="$1" label="$2" count="$3"
  local max
  max=$(base "$key")
  if [ -z "$max" ]; then
    echo "info  $label: $count (no baseline)"
  elif [ "$count" -gt "$max" ]; then
    echo "FAIL  $label: $count (baseline $max; it grew — use the primitive or token instead)"
    fail=1
  else
    echo "ok    $label: $count (baseline $max)"
  fi
}
count_outside_ui() { grep -rEo "$1" --include='*.tsx' "$SRC" 2>/dev/null | grep -v '/components/ui/' | wc -l | tr -d ' '; }

# Hex colours in tsx. Known-legit: the Google logo in auth/login, colour
# input defaults, documented fallbacks. A planted hex grows the count and fails.
ratchet hex "hardcoded hex in tsx" "$(grep -rEho '#[0-9a-fA-F]{6}\b' --include='*.tsx' "$SRC" 2>/dev/null | wc -l | tr -d ' ')"
# Raw form elements outside components/ui (phase 0 ratchet; phase 3 sweeps them down).
ratchet raw_button   "raw <button> outside components/ui"   "$(count_outside_ui '<button\b')"
ratchet raw_input    "raw <input> outside components/ui"    "$(count_outside_ui '<input\b')"
ratchet raw_select   "raw <select> outside components/ui"   "$(count_outside_ui '<select\b')"
ratchet raw_textarea "raw <textarea> outside components/ui" "$(count_outside_ui '<textarea\b')"
# Rework 5.10: native checkboxes, retyped focus strings, Loading literals.
ratchet native_checkbox "native checkboxes outside components/ui" "$(count_outside_ui 'type="checkbox"')"
ratchet focus_retyped "retyped focus rings (import controlFocus / fieldFocus)" "$(grep -rEo 'focus-visible:ring-2 focus-visible:ring-primary-500' --include='*.tsx' "$SRC" 2>/dev/null | grep -v '/components/ui/' | wc -l | tr -d ' ')"
ratchet loading_literal "Loading… literals (use Skeleton / a named state)" "$(grep -rEo 'Loading(…|\.\.\.)' --include='*.tsx' "$SRC" 2>/dev/null | wc -l | tr -d ' ')"
# Decision 12: an action is a Button, never a bare link with an onClick (informational).
linkclick=$(grep -rEn '<(a|Link)\b[^>]*onClick' --include='*.tsx' "$SRC" 2>/dev/null | wc -l | tr -d ' ')
echo "info  <a>/<Link> with onClick: $linkclick (decision 12: make these Buttons)"

echo
if [ "$fail" -eq 1 ]; then
  echo "UI audit FAILED — see UI_GUIDELINES.md for the correct patterns."
  exit 1
fi
echo "UI audit passed."
