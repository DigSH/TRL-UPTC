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

`withGlossary()` wraps glossary terms found in question text in `<abbr>` tooltips. Its regex uses
lookarounds with an explicit accented-letter class instead of `\b`, because JS word boundaries do not
recognise `á í ó ú ñ` — a term like "Límites operacionales" would not match with `\b`.

## Print / PDF

The "download PDF" buttons are `window.print()` against the print stylesheet at the bottom of
`styles.css`. Three non-obvious constraints there, each fixing a real bug — do not drop them:

- **`print-color-adjust: exact`** on bars, chips and steps. Browsers omit backgrounds when printing, so
  progress bars print as empty outlines without it.
- **The `@media (max-width: 720px)` layout applies when printing**, because an A4 page is narrower than
  the breakpoint. The print block re-declares `.bar-row` as a 3-column grid to undo it.
- **The palette override repeats every theme selector** (`:root`, `[data-theme="dark"]`,
  `[data-theme="light"]`, `:not([data-theme="light"])`). A bare `:root` loses on specificity to the
  dark-theme selectors, so printing while in dark mode would produce black pages.

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

## Deployment

GitHub Pages serves branch `main` from the repository root (`.nojekyll` present). Pushing to `main`
deploys. If the `pages build and deployment` Actions run stalls in `queued` — it has happened, and
cancelling it returned HTTP 500 — force a build directly:

```bash
curl -X POST -H "Authorization: Bearer $TOKEN" \
  https://api.github.com/repos/DigSH/TRL-UPTC/pages/builds
```

## Untracked assets

`Cabezote VIE-01.png`, `cab_otri.svg` and `log_otri.svg` sit in the repo root but are deliberately
**not committed** — institutional branding the user added, pending a decision on where it goes
(site header, PDF report header). Confirm with the user before committing or wiring them in.
