# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## What this is

Web version of an institutional Excel instrument (`Herramienta de diagnostico TRL.xlsm`) that estimates
the Technology Readiness Level (TRL 1–9) of a technology from a 73-question yes/no questionnaire.
Published as a static site on GitHub Pages: https://digsh.github.io/TRL-UPTC/

Static site with **no build step, no dependencies, no framework**. `index.html` + three files in
`assets/`. The UI language is Spanish — keep all user-facing strings, comments and commit messages in
Spanish to match the existing code.

## Commands

```bash
python -m http.server 8000        # serve locally, open http://localhost:8000
node tools/verify.js              # run the test suite (must pass before publishing)
python tools/build_data.py        # regenerate assets/data.js from the Excel (needs: pip install openpyxl)
python tools/build_brand.py       # regenerate assets/img/ from assets/brand/ (needs: pip install Pillow)
```

`verify.js` has no test framework — it is a plain script with a `check(name, actual, expected)` helper
that exits non-zero on failure. There is no way to run a single test; the whole file runs in ~1s. To
add a case, append a `check(...)` call *before* the final `console.log`/`process.exit` block at the
bottom of the file.

`build_data.py` defaults to `../Herramienta de diagnostico TRL.xlsm` (outside the repo, one directory
above it). Pass an explicit path as argv[1] if it lives elsewhere.

## The invariant that matters

The scoring logic is a **faithful replica of the `RESULTADOS` sheet** of the Excel workbook. Do not
"improve" it — the institution's diagnoses must match the original instrument.

- Each question carries a TRL level (column B of each Excel sheet).
- Per level: `ratio = "Sí" answers / total questions of that level`.
- The assigned TRL is the **highest** level whose ratio **exceeds** its threshold, scanning 9 → 1
  (formula `RESULTADOS!J21`). Comparison is strict `>`, not `>=`.
- Thresholds: TRL 1–2 → 0.79 · TRL 3–4 and 6 → 0.60 · TRL 5, 7–9 → 0.70.
- Unanswered questions count as "No".

Consequence worth remembering when touching the roadmap: because the scan takes the *highest*
qualifying level, **lower levels can be unconsolidated under a high TRL** (a technology can read TRL 7
with levels 4 and 5 below threshold). `buildRoadmap()` surfaces the lowest unconsolidated level as the
bottleneck for exactly this reason.

Minimum "Sí" answers to clear a level is `floor(threshold × total) + 1`. The `+ 1e-9` epsilon in that
expression is load-bearing: without it `0.6 × 10` represented as `5.999…` would demand one activity too
few. `verify.js` checks this against a brute-force search over all three thresholds for totals 1–40.

## Generated data — do not hand-edit

`assets/data.js` is **generated** by `tools/build_data.py` from the Excel workbook and starts with a
banner saying so. Editing it by hand means the next regeneration silently reverts your change.

To change question text, glossary terms, TRL descriptions or work-plan activities: edit the Excel, then
regenerate. For evident typos in the source workbook, add an entry to the `ERRATA` dict in
`build_data.py` rather than editing the Excel or the generated file — that keeps a record of what
diverges from the institutional source and survives regeneration.

Structural facts that `verify.js` locks down (73 questions total): per-level counts
`{1:5, 2:5, 3:9, 4:8, 5:8, 6:12, 7:7, 8:11, 9:8}` and per-category counts `[7, 10, 24, 4, 13, 4, 11]`.
These mirror `RESULTADOS!H27:H43` and `H47:H59`.

## Architecture

`assets/app.js` is a single IIFE with no modules. Flow: `init()` reads `localStorage`, calls the
`build*()` functions once to generate DOM from `window.TRL_DATA`, then `render*()` functions re-run on
state change. All state is one object — `{ answers: {questionId: 'yes'|'no'}, profile: {} }` — persisted
to `localStorage` under `trl-uptc-v1` (theme under `trl-uptc-theme`). Nothing leaves the browser; there
is no backend.

Navigation is hash-based over sibling `<section class="panel" data-panel="…">` elements toggled with the
`hidden` attribute; `show(tabId)` is the single entry point and triggers the lazy renders for the
results and roadmap panels. Question panels are generated from data, so `TABS` is built dynamically —
adding a category to the Excel adds a tab with no HTML change.

**Nothing derived is ever cached.** `renderResults()` and `renderPlan()` recompute from
`state.answers` on every visit to their panel, so the diagnosis and the roadmap can never disagree
with each other or go stale after an answer changes (verified end-to-end: flipping one answer moves
the pending count and makes the affected TRL block appear/disappear). If you add memoisation for
performance — it is not needed at 73 questions — you own the invalidation.

The tab bar **must not scroll horizontally**: it wraps (`flex-wrap`, no `overflow-x`) and the seven
questionnaire sections are compact numbered chips rather than text labels, because twelve text tabs
did not fit and forced a horizontal scrollbar. Full section names live in `title`/`aria-label` and in
the open section's own heading. Keep any new tab label short.

`withGlossary()` wraps glossary terms found in question text in `<abbr>` tooltips. Its regex uses
lookarounds with an explicit accented-letter class instead of `\b`, because JS word boundaries do not
recognise `á í ó ú ñ` — a term like "Límites operacionales" would not match with `\b`.

## Print / PDF

The "download PDF" buttons are `window.print()` against the print stylesheet at the bottom of
`styles.css`. Four non-obvious constraints there, each fixing a real bug — do not drop them:

- **`print-color-adjust: exact`** on bars, chips and steps. Browsers omit backgrounds when printing, so
  progress bars print as empty outlines without it.
- **The `@media (max-width: 720px)` layout applies when printing**, because an A4 page is narrower than
  the breakpoint. The print block re-declares `.bar-row` as a 3-column grid to undo it.
- **The palette override repeats every theme selector** (`:root`, `[data-theme="dark"]`,
  `[data-theme="light"]`, `:not([data-theme="light"])`). A bare `:root` loses on specificity to the
  dark-theme selectors, so printing while in dark mode would produce black pages.
- **All animations and transitions are disabled in print.** The `.panel` entrance animation starts at
  `opacity: 0`, and a print snapshot can catch it there — every page comes out blank. This is not
  hypothetical; it happened.

Related trap in `styles.css`: `.bar-fill` needs an explicit `display: block`. It is a `<span>`, and
`width`/`height` do not apply to inline boxes — the bars silently never filled.

### Verifying print output locally

Headless Chrome **produces blank PDFs when reusing a `--user-data-dir`**. Always delete the profile
directory first:

```bash
CH="/c/Program Files/Google/Chrome/Application/chrome.exe"
rm -rf ./prof
"$CH" --headless=new --disable-gpu --run-all-compositor-stages-before-draw \
  --user-data-dir="$(cygpath -w "$PWD/prof")" --no-pdf-header-footer \
  --virtual-time-budget=9000 --print-to-pdf="$(cygpath -w "$PWD/out.pdf")" \
  "http://localhost:8000/index.html#resultados"
```

`--print-to-pdf` needs a **Windows** path (`cygpath -w`) or it fails with access denied. To inspect the
result, render pages to PNG with PyMuPDF (`fitz`) and read the images — the PDF has no extractable text
layer worth reading. Since results depend on `localStorage`, seed it with a temporary page that writes
the key and then `location.replace('index.html#…')`, and delete that page afterwards.

### Verifying interactive behaviour

`verify.js` only covers the scoring maths; it cannot see the UI. To check behaviour that depends on
clicking — does panel X update after action Y? — write a throwaway page in the repo root that loads
`index.html` in a same-origin `<iframe>`, drives it (`.tab[data-tab="…"]`.click(), `#q-<id>-yes`.click()),
writes findings into a `<pre>`, and read it back with headless Chrome's `--dump-dom`. Delete the page
afterwards. This is how the "does the roadmap recalculate too?" question was answered with evidence
instead of by reading code.

## Deployment

GitHub Pages serves branch `main` from the repository root (`.nojekyll` present). Pushing to `main`
deploys. If the `pages build and deployment` Actions run stalls in `queued` — it has happened, and
cancelling it returned HTTP 500 — force a build directly:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/DigSH/TRL-UPTC/pages/builds
```

## Brand assets

`assets/brand/` holds the institutional masters **exactly as supplied** — never edit them.
`assets/img/` holds the web-ready files, all **generated** by `tools/build_brand.py`.

**The site shows no logos** — the user asked for them to be removed. Only the UPTC/ViE letterhead
survives, and only at the top of the printed report so it reads as an official document. `log_otri.svg`
and `cab_otri.svg` stay in `assets/brand/` as masters but are not published; the code that derived
theme-aware logo variants from them is in git history (commit 5e5a84f) if it is ever wanted back.
Do not re-add logos to the page without asking.

The colour palette in `styles.css` uses the official UPTC institutional colours: **`#1d1d1b`** (charcoal
black) and **`#FFCC20`** (institutional gold), softened with warm stone neutrals (`#f5f4f0`, `#eceae3`)
and smooth CSS gradients (`--grad-brand`, `--grad-bar`, `--grad-gold-soft`) so `#FFCC20` never looks
overly saturated while maintaining WCAG AA/AAA contrast (`#FFCC20` on `#1d1d1b` is 11.4:1; on light
backgrounds, `--gold-deep: #9e7800` or `#1d1d1b` is used for text).

The guide `.hero` and `.score-card` include lightweight inline SVG watermarks allusive to **TRL 1–9**
(a 9-bar ascending readiness staircase, precision engineering rings/gear, and circuit traces) over the
`#141413` → `#1d1d1b` → `#3a3115` gradient.

Institutional hierarchy, which the footer reflects: **UPTC → Vicerrectoría de Investigación y
Extensión → OTRI**.
