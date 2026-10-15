# Verification harnesses

Three zero-dependency Node harnesses that guard the game in `index.html` and its
split sources under `js/` and `styles/`. No `npm install`, no `package.json`, no
build step. Node built-ins only.

| File | What it verifies |
| --- | --- |
| `verification/sim-test.js` | The game simulation logic, 63 behavioral checks. Runs headless, no browser required. |
| `verification/cdp-probe.mjs` | The real page in a real browser over `file://`, driving it through the Chrome DevTools Protocol. |
| `verification/verify-split-parity.mjs` | The structural invariants that hold for the `js/` + `styles/` split, plus opt-in byte parity against the pre-split original. |

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

Guards the split of the single-file game into `index.html` plus ordered classic
`js/` scripts and `styles/hud.css`. It runs in two modes.

### Default mode — the permanent guard

With no arguments it runs only checks that stay true for the split layout
itself, forever, and it must stay green on the current tree. It checks that:

- `styles/hud.css` carries no HTML tags, has balanced braces, and keeps its
  `@media` rule;
- no `js/` file is empty, and every `js/` file parses standalone as a classic
  script (`node --check`);
- every top-level declaration name is unique across the six files;
- every `getElementById('x')` id referenced from the `js/` files exists as an
  `id` in `index.html`, and `index.html` has no duplicate ids;
- `index.html` has no `<style>` block and no inline script body;
- `index.html`'s script tags carry no `type="module"`, `defer`, or `async`;
- the six classic `<script src="js/...">` tags appear in the required order as
  the last elements before `</body>`;
- every referenced script file and the referenced stylesheet exist on disk.

It prints one `PASS`/`FAIL` line per check, a one-line note that byte-level
parity is a migration-time assertion, and a `SUMMARY` line.

```sh
cd /Users/erendt/Code/pesawat && node verification/verify-split-parity.mjs
```

Expected output ends with:

```
SUMMARY: 15/15 checks passed
```

### Parity mode — opt-in migration proof

Pass `--expect-unchanged <git-rev>` to additionally assert the one-time lossless
migration. It takes the original single file, locates the `<style>` and
`<script>` anchors and the `"use strict";` prologue by line search (never by
hardcoded line numbers), and derives the original CSS body and original script
body from those anchors alone. It then additionally checks that:

- `styles/hud.css` is byte-identical to the original style body plus one
  trailing newline;
- the six files `js/01-shaders.js` … `js/06-renderer.js`, each with only its
  leading `"use strict";` line removed, concatenate in load order to something
  byte-identical to the original script body plus one trailing newline, with no
  other normalization;
- the resolved original matches a recorded pre-split `sha256` fingerprint, so
  pointing at the wrong revision fails loudly with an explicit wrong-revision
  message instead of reporting a confusing content diff.

The correct revision is `924b8fc`, the last commit before the split. When the
script body fails, the output lists the individual `js/` files whose bodies are
no longer found verbatim in the original, so the legitimately changed files are
named rather than described only by a hash.

Byte parity is a **migration-time assertion**. Once the game source is
legitimately edited — as it is after the mothership rescale and the new enemy and
mechanics work — parity against `924b8fc` is *expected to fail*. That is exactly
why it is opt-in: the default run stays a useful permanent guard instead of
reporting historical drift as a defect.

```sh
cd /Users/erendt/Code/pesawat && node verification/verify-split-parity.mjs --expect-unchanged 924b8fc
```

Parity mode prints the computed `sha256` values (original source, expected CSS
body + `LF`, actual `styles/hud.css`, expected script body + `LF`, actual
concatenated `js` 01..06), then a `SUMMARY` line. On the current tree it is
expected to fail with `FAIL` lines naming `styles/hud.css` and
`js/04-static-meshes.js`, `js/05-simulation.js`, and `js/06-renderer.js`.

### Arguments

| Argument | Meaning |
| --- | --- |
| *(none)* | Default mode: run the permanent split invariants only. |
| `--expect-unchanged <git-rev>` | Enable parity mode, reading the pre-split single file via `git show <rev>:index.html`. Pass `924b8fc`, the last commit before the split. |
| `--original <path>` | Enable parity mode, reading the pre-split single file from a file instead of git. |
| `--help`, `-h` | Print usage describing both modes and every flag, and exit `0`. |

`--expect-unchanged` and `--original` are mutually exclusive; either one turns on
parity mode.

### Exit codes

| Code | Meaning |
| --- | --- |
| `0` | All checks passed. |
| `1` | One or more checks failed; the `FAIL` lines name them. |
| `2` | The harness could not run: bad or missing argument, unreadable `index.html`, unreadable `--original` path, or a failed `git show`. |
