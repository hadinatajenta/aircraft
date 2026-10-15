# Verification harnesses

Three zero-dependency Node harnesses that guard the game in `index.html` and its
split sources under `js/` and `styles/`. No `npm install`, no `package.json`, no
build step. Node built-ins only.

| File | What it verifies |
| --- | --- |
| `verification/sim-test.js` | The game simulation logic, 63 behavioral checks. Runs headless, no browser required. |
| `verification/cdp-probe.mjs` | The real page in a real browser over `file://`, driving it through the Chrome DevTools Protocol. |
| `verification/verify-split-parity.mjs` | That the split into `js/` and `styles/` is byte-for-byte lossless against a pre-split original. |

---

## 1. Simulation harness — `verification/sim-test.js`

Runs the game script inside a Node `vm` sandbox with a stub `document`,
`window`, and seeded `Math.random`, then exercises the simulation directly across
eight scenarios:

- **A** initial state and reset semantics
- **B** health-bar thresholds and colours
- **C** the heavy gunship station-keeping and fire behaviour
- **D** damage sources and their per-hit weights
- **E** player bolts destroying recon drones and scoring
- **F** render batches and the projected hull tracker
- **G** the failed mission being frozen and restartable
- **H** an idle player being pressured but not executed on sight

No browser is required: it reads `index.html` from disk and then loads the game
source in-process. It understands both layouts, so the same harness runs against
the original single-file build and the current split build:

- if `index.html` holds an inline classic `<script>` block, that block is used;
- otherwise the six `<script src="js/...">` files are read in document order and
  concatenated into one script, which is what makes the split provably
  behaviour-preserving: the same 63 checks produce byte-identical output against
  both builds.

If neither layout yields a script it prints a clear message and exits `2`.

```sh
cd /Users/erendt/Code/pesawat && node verification/sim-test.js
```

It resolves `index.html` relative to its own location
(`path.resolve(__dirname, '..', 'index.html')`), so it can be run from any
working directory:

```sh
cd /tmp && node /Users/erendt/Code/pesawat/verification/sim-test.js
```

To point it at a different copy of the game, set `SKYSTRIKE_FILE` to an absolute
path:

```sh
SKYSTRIKE_FILE=/path/to/index.html node verification/sim-test.js
```

Expected output ends with:

```
63/63 checks passed
```

---

## 2. End-to-end harness — `verification/cdp-probe.mjs`

Launches a headless Chromium-family browser, navigates it to the URL you pass,
waits for the page to reach a steady state, and prints a JSON report describing
the WebGPU badge, the error overlay, the hull tracker, the score, and any
console errors the page produced.

```sh
cd /Users/erendt/Code/pesawat && node verification/cdp-probe.mjs --url "file:///Users/erendt/Code/pesawat/index.html" --expect-badge-active
```

Add `--json` to pretty-print the report.

### Why `file://` matters

The game ships as a single `index.html` that a player opens by double-clicking
it, which means the page runs from a `file://` URL. That has a hard consequence:
ES modules (`<script type="module">`) are blocked over `file://` by browsers'
origin rules, while classic `<script>` blocks are not. This harness therefore
loads the game exactly the way a double-click does, so it catches regressions
that only appear when the page is opened from disk rather than served over HTTP.

### Browser discovery

The harness picks the first browser binary that exists on disk, in this order:

1. `$CHROME_BIN`
2. `/Applications/Brave Browser.app/Contents/MacOS/Brave Browser`
3. `/Applications/Google Chrome.app/Contents/MacOS/Google Chrome`

If none exists it prints a clear message and exits with code `3`.

### macOS console noise that is filtered

The harness ignores console errors containing `CVDisplayLink` or
`SharedImageManager`. Headless Chromium on macOS emits both as routine,
non-fatal warnings from its graphics stack; they are not caused by the game and
would otherwise be reported as page errors.

---

## Exit codes

### `sim-test.js`

| Code | Meaning |
| --- | --- |
| `0` | All 63 checks passed. |
| `1` | One or more checks failed; the failing labels are printed. |

### `cdp-probe.mjs`

| Code | Meaning |
| --- | --- |
| `0` | The probe completed. If `--expect-badge-active` was passed, the WebGPU badge was active. |
| `1` | The probe completed but `--expect-badge-active` was passed and the badge was not active. |
| `2` | The harness itself failed: missing `--url`, the DevTools endpoint never became ready, no page target was found, or the WebSocket connection errored. |
| `3` | No browser binary was found. Set `CHROME_BIN` or install Brave Browser / Google Chrome. |

---

## Dependencies

None. All three harnesses use only Node built-ins (`fs`, `path`, `vm`,
`child_process`, `os`, `crypto`, `url`) and the global `fetch`/`WebSocket`
available in modern Node. Any Node.js version with those globals (Node 22+)
works.

---

## Split-parity harness — `verification/verify-split-parity.mjs`

Proves that the ordered split of the pre-split single-file game is lossless. It
takes the original single file, locates the `<style>` and `<script>` anchors by
line search (never by hardcoded line numbers), and derives the original CSS body
and the original script body from those anchors alone. It then re-reads the
current repo and checks that:

- `styles/hud.css` is byte-identical to the original style body plus one
  trailing newline;
- the six files `js/01-shaders.js` … `js/06-renderer.js`, each with only its
  leading `"use strict";` line removed, concatenate in load order to something
  byte-identical to the original script body plus one trailing newline, with no
  other normalization;
- the CSS carries no HTML tags, has balanced braces, and keeps its `@media`
  rule;
- the concatenated script has exactly two `initSkystrike` occurrences and ends
  with the `window.addEventListener('load', initSkystrike);` registration line;
- no `js/` file is empty, every `js/` file parses standalone as a classic
  script (`node --check`), the split preserves the total script line count,
  every top-level declaration name is unique across the six files, and every
  `getElementById('x')` id exists as `id="x"` in `index.html`;
- the resolved original matches a recorded pre-split `sha256` fingerprint, so
  pointing at the wrong revision fails loudly instead of reporting a bogus
  mismatch;
- `index.html` has no `<style>` block, no inline script body, and no
  `type="module"`, `defer`, or `async` on its script tags, and its six classic
  script tags appear in the required order as the last elements of `<body>`.

It prints one `PASS`/`FAIL` line per check with the computed `sha256` values,
then a `SUMMARY` line.

### Arguments

| Argument | Meaning |
| --- | --- |
| `--original <path>` | Read the pre-split single-file source from a file. |
| `--original-rev <git-rev>` | Read it via `git show <rev>:index.html`. Defaults to `924b8fc`, the last pre-split commit, so the harness keeps working after the split is committed. |
| `--help`, `-h` | Print usage and exit `0`. |

If neither source yields content — a missing path, an unknown revision, or an
empty result — it prints a clear message and exits `2`.

### Example

```sh
cd /Users/erendt/Code/pesawat && node verification/verify-split-parity.mjs
```

Expected output ends with:

```
SUMMARY: 23/23 checks passed
```

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All checks passed. |
| `1` | One or more checks failed; the `FAIL` lines name them. |
| `2` | The harness could not obtain an original source: bad or missing argument, unreadable `--original` path, or a failed `git show`. |
