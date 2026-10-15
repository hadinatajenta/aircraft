import { readFileSync, existsSync } from 'node:fs';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { dirname, resolve, isAbsolute, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const SCRIPT_FILES = [
  '01-shaders.js',
  '02-math.js',
  '03-geometry-builder.js',
  '04-static-meshes.js',
  '05-simulation.js',
  '06-renderer.js'
];

const INDEX_RELATIVE = 'index.html';
const STYLESHEET_RELATIVE = 'styles/hud.css';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');

const STYLE_OPEN_PATTERN = /^\s*<style\b/;
const STYLE_CLOSE_PATTERN = /^\s*<\/style>/;
const SCRIPT_OPEN_PATTERN = /^\s*<script\b/;
const SCRIPT_CLOSE_PATTERN = /^\s*<\/script>/;
const DIRECTIVE_PROLOGUE_PATTERN = /^\s*"use strict";\s*$/;
const DIRECTIVE_PROLOGUE = '"use strict";';
const DECLARATION_PATTERN = /^ {4}(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const GET_ELEMENT_BY_ID_PATTERN = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
const HTML_TAG_PATTERN = /<[a-zA-Z!/][^>]*>/;
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const SCRIPT_OPEN_TAG_PATTERN = /<script\b[^>]*>/gi;
const SRC_ATTRIBUTE_PATTERN = /src\s*=\s*["']([^"']+)["']/i;
const ID_ATTRIBUTE_PATTERN = /(?:\s|^)id\s*=\s*["']([^"']*)["']/gi;
const LINK_TAG_PATTERN = /<link\b[^>]*>/gi;
const STYLESHEET_REL_PATTERN = /\brel\s*=\s*["']stylesheet["']/i;
const HREF_ATTRIBUTE_PATTERN = /\bhref\s*=\s*["']([^"']+)["']/i;
const MEDIA_RULE_PATTERN = /@media\b/;

const PRE_SPLIT_REVISION = '924b8fc';
const EXPECTED_ORIGINAL_SHA256 = '749664f37cdd2de979d5906f34982e3e5776bb78b0aeb38ca130f5338795d15a';

let checkCount = 0;
let failureCount = 0;

function printUsage() {
  process.stderr.write('usage: node verification/verify-split-parity.mjs [--expect-unchanged <git-rev> | --original <path>]\n');
  process.stderr.write('\n');
  process.stderr.write('Two modes:\n');
  process.stderr.write('  default mode (no flags)  run only the structural invariants that stay true for the split layout:\n');
  process.stderr.write('                           css sanity, standalone js parsing, unique declarations, id wiring,\n');
  process.stderr.write('                           index.html script-tag shape and ordering, and file existence.\n');
  process.stderr.write('  parity mode (opt-in)     additionally assert the one-time lossless migration against the pre-split\n');
  process.stderr.write('                           single-file original, then exit 1 on any byte mismatch.\n');
  process.stderr.write('\n');
  process.stderr.write('Flags:\n');
  process.stderr.write('  --expect-unchanged <git-rev>  enable parity mode, reading the original via `git show <rev>:index.html`\n');
  process.stderr.write('  --original <path>             enable parity mode, reading the original from a file instead\n');
  process.stderr.write('  --help, -h                    print this usage and exit 0\n');
  process.stderr.write('\n');
  process.stderr.write(`The correct revision is ${PRE_SPLIT_REVISION}, the last commit before the split. Byte parity is a\n`);
  process.stderr.write('migration-time assertion: it is expected to FAIL once the game source is legitimately edited, which is\n');
  process.stderr.write('exactly why it is opt-in and not part of the default run.\n');
}

function exitHarnessFailure(message) {
  process.stderr.write(`HARNESS FAILURE: ${message}\n`);
  process.exit(2);
}

function parseArguments(argv) {
  let originalPath = null;
  let originalRev = null;
  for (let index = 0; index < argv.length; index += 1) {
    const token = argv[index];
    if (token === '--expect-unchanged') {
      if (index + 1 >= argv.length) {
        printUsage();
        exitHarnessFailure('--expect-unchanged requires a git revision argument');
      }
      originalRev = argv[index + 1];
      index += 1;
    } else if (token === '--original') {
      if (index + 1 >= argv.length) {
        printUsage();
        exitHarnessFailure('--original requires a path argument');
      }
      originalPath = argv[index + 1];
      index += 1;
    } else if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    } else {
      printUsage();
      exitHarnessFailure(`unrecognized argument: ${token}`);
    }
  }
  if (originalPath !== null && originalRev !== null) {
    printUsage();
    exitHarnessFailure('--expect-unchanged and --original are mutually exclusive');
  }
  return { originalPath, originalRev };
}

function readOriginal(originalPath, originalRev) {
  if (originalPath !== null) {
    const absolutePath = isAbsolute(originalPath) ? originalPath : resolve(process.cwd(), originalPath);
    let content;
    try {
      content = readFileSync(absolutePath, 'utf8');
    } catch (error) {
      exitHarnessFailure(`cannot read --original path ${absolutePath}: ${error.message}`);
    }
    if (content.length === 0) {
      exitHarnessFailure(`--original path ${absolutePath} yielded no content`);
    }
    return { label: absolutePath, content };
  }
  let content;
  try {
    content = execFileSync('git', ['-C', ROOT, 'show', `${originalRev}:${INDEX_RELATIVE}`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    });
  } catch (error) {
    exitHarnessFailure(`git show ${originalRev}:${INDEX_RELATIVE} failed: ${error.message}`);
  }
  if (content.length === 0) {
    exitHarnessFailure(`git show ${originalRev}:${INDEX_RELATIVE} yielded no content`);
  }
  return { label: `${originalRev}:${INDEX_RELATIVE}`, content };
}

function sha256(content) {
  const buffer = Buffer.isBuffer(content) ? content : Buffer.from(content, 'utf8');
  return createHash('sha256').update(buffer).digest('hex');
}

function findAnchorLine(lines, pattern, startIndex) {
  for (let index = startIndex; index < lines.length; index += 1) {
    if (pattern.test(lines[index])) {
      return index;
    }
  }
  return -1;
}

function record(label, passed, detail) {
  checkCount += 1;
  if (!passed) {
    failureCount += 1;
  }
  const status = passed ? 'PASS' : 'FAIL';
  const suffix = detail ? ` -> ${detail}` : '';
  process.stdout.write(`${status}  ${label}${suffix}\n`);
}

function recordSkipped(label, reason) {
  record(label, false, `skipped: ${reason}`);
}

function stripDirectivePrologue(sourceText) {
  const firstNewlineIndex = sourceText.indexOf('\n');
  if (firstNewlineIndex === -1) {
    return sourceText;
  }
  const firstLine = sourceText.slice(0, firstNewlineIndex).trim();
  if (firstLine === DIRECTIVE_PROLOGUE) {
    return sourceText.slice(firstNewlineIndex + 1);
  }
  return sourceText;
}

function countOccurrences(text, pattern) {
  const matches = text.match(pattern);
  return matches === null ? 0 : matches.length;
}

function hasBalancedBraces(text) {
  let depth = 0;
  for (const character of text) {
    if (character === '{') {
      depth += 1;
    } else if (character === '}') {
      depth -= 1;
      if (depth < 0) {
        return false;
      }
    }
  }
  return depth === 0;
}

function readScriptSources() {
  return SCRIPT_FILES.map((fileName) => {
    const relativePath = `js/${fileName}`;
    try {
      return { name: fileName, relativePath, content: readFileSync(join(ROOT, relativePath), 'utf8'), readError: null };
    } catch (error) {
      return { name: fileName, relativePath, content: null, readError: error.message };
    }
  });
}

function readStyleSheetContent() {
  try {
    return readFileSync(join(ROOT, STYLESHEET_RELATIVE), 'utf8');
  } catch (error) {
    return null;
  }
}

function collectTopLevelDeclarations(scriptSources) {
  const declarationOwners = new Map();
  for (const source of scriptSources) {
    const body = stripDirectivePrologue(source.content);
    for (const line of body.split('\n')) {
      const match = line.match(DECLARATION_PATTERN);
      if (match) {
        const name = match[1];
        if (!declarationOwners.has(name)) {
          declarationOwners.set(name, []);
        }
        declarationOwners.get(name).push(source.relativePath);
      }
    }
  }
  return declarationOwners;
}

function extractScriptTagBodies(html) {
  const bodies = [];
  const pattern = new RegExp(SCRIPT_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(html);
  while (match !== null) {
    bodies.push(match[1]);
    match = pattern.exec(html);
  }
  return bodies;
}

function extractScriptSources(html) {
  const sources = [];
  const pattern = new RegExp(SCRIPT_OPEN_TAG_PATTERN.source, 'gi');
  let match = pattern.exec(html);
  while (match !== null) {
    const srcMatch = match[0].match(SRC_ATTRIBUTE_PATTERN);
    sources.push(srcMatch === null ? null : srcMatch[1]);
    match = pattern.exec(html);
  }
  return sources;
}

function extractStylesheetHref(html) {
  for (const tag of html.match(LINK_TAG_PATTERN) || []) {
    if (!STYLESHEET_REL_PATTERN.test(tag)) {
      continue;
    }
    const hrefMatch = tag.match(HREF_ATTRIBUTE_PATTERN);
    if (hrefMatch !== null) {
      return hrefMatch[1];
    }
  }
  return null;
}

function extractElementIds(html) {
  const ids = [];
  const pattern = new RegExp(ID_ATTRIBUTE_PATTERN.source, 'gi');
  let match = pattern.exec(html);
  while (match !== null) {
    ids.push(match[1]);
    match = pattern.exec(html);
  }
  return ids;
}

function findDuplicateIds(html) {
  const counts = new Map();
  for (const id of extractElementIds(html)) {
    counts.set(id, (counts.get(id) || 0) + 1);
  }
  return [...counts.entries()]
    .filter(([, count]) => count > 1)
    .map(([id, count]) => `${id} x${count}`);
}

function findChangedScriptFiles(scriptSources, expectedScriptContent) {
  const changedFiles = [];
  for (const source of scriptSources) {
    if (source.content === null || !expectedScriptContent.includes(stripDirectivePrologue(source.content))) {
      changedFiles.push(source.relativePath);
    }
  }
  return changedFiles;
}

function runDefaultChecks(indexHtml, scriptSources, styleSheetContent) {
  const missingScriptFiles = scriptSources.filter((source) => source.content === null);
  const allScriptFilesPresent = missingScriptFiles.length === 0;
  const missingReason = missingScriptFiles.length === 0
    ? ''
    : `missing or unreadable ${missingScriptFiles.map((source) => source.relativePath).join(', ')}`;

  const referencedSources = extractScriptSources(indexHtml).filter((source) => source !== null);
  const missingReferencedSources = referencedSources.filter((source) => !existsSync(join(ROOT, source)));
  record(
    'every referenced script file exists on disk',
    missingReferencedSources.length === 0,
    missingReferencedSources.length === 0
      ? `${referencedSources.length} referenced scripts present`
      : `missing ${missingReferencedSources.join(', ')}`
  );

  const stylesheetHref = extractStylesheetHref(indexHtml);
  const stylesheetExists = stylesheetHref !== null && existsSync(join(ROOT, stylesheetHref));
  record(
    'referenced stylesheet exists on disk',
    stylesheetExists,
    stylesheetHref === null ? 'no stylesheet <link> found' : `${stylesheetHref}${stylesheetExists ? ' present' : ' missing'}`
  );

  if (styleSheetContent !== null) {
    record('styles/hud.css contains no HTML tags', !HTML_TAG_PATTERN.test(styleSheetContent), 'no tag-like sequences');
    record('styles/hud.css braces balanced', hasBalancedBraces(styleSheetContent), 'open and close brace depth returns to zero');
    record(
      'styles/hud.css retains @media rule',
      MEDIA_RULE_PATTERN.test(styleSheetContent),
      `@media occurrences ${countOccurrences(styleSheetContent, /@media/g)}`
    );
  } else {
    recordSkipped('styles/hud.css contains no HTML tags', 'styles/hud.css missing or unreadable');
    recordSkipped('styles/hud.css braces balanced', 'styles/hud.css missing or unreadable');
    recordSkipped('styles/hud.css retains @media rule', 'styles/hud.css missing or unreadable');
  }

  if (allScriptFilesPresent) {
    const emptyScriptFiles = scriptSources.filter((source) => source.content.trim() === '').map((source) => source.relativePath);
    record(
      'no js file is empty',
      emptyScriptFiles.length === 0,
      emptyScriptFiles.length === 0 ? `${SCRIPT_FILES.length} files non-empty` : `empty files ${emptyScriptFiles.join(', ')}`
    );
  } else {
    recordSkipped('no js file is empty', missingReason);
  }

  if (allScriptFilesPresent) {
    const syntaxFailures = [];
    for (const source of scriptSources) {
      try {
        execFileSync(process.execPath, ['--check', join(ROOT, source.relativePath)], { stdio: 'pipe' });
      } catch (error) {
        const reported = String(error.stderr || '').split('\n').map((line) => line.trim()).filter(Boolean);
        syntaxFailures.push(`${source.relativePath}: ${reported[0] || 'syntax error'}`);
      }
    }
    record(
      'every js file parses standalone as a classic script',
      syntaxFailures.length === 0,
      syntaxFailures.length === 0 ? `${SCRIPT_FILES.length} files parsed by node --check` : syntaxFailures.join('; ')
    );
  } else {
    recordSkipped('every js file parses standalone as a classic script', missingReason);
  }

  let concatenatedScript = null;
  if (allScriptFilesPresent) {
    concatenatedScript = scriptSources.map((source) => stripDirectivePrologue(source.content)).join('');
    const declarationOwners = collectTopLevelDeclarations(scriptSources);
    const duplicateDeclarations = [...declarationOwners.entries()].filter(([, owners]) => owners.length > 1);
    const declarationCount = [...declarationOwners.values()].reduce((total, owners) => total + owners.length, 0);
    record(
      'top-level declaration names unique across all six files',
      duplicateDeclarations.length === 0,
      duplicateDeclarations.length === 0
        ? `${declarationCount} declarations, ${declarationOwners.size} unique names`
        : `duplicates ${duplicateDeclarations.map(([name, owners]) => `${name} in ${owners.join(' + ')}`).join('; ')}`
    );
  } else {
    recordSkipped('top-level declaration names unique across all six files', missingReason);
  }

  if (concatenatedScript !== null) {
    const indexIds = new Set(extractElementIds(indexHtml));
    const elementIds = [...new Set([...concatenatedScript.matchAll(GET_ELEMENT_BY_ID_PATTERN)].map((match) => match[1]))];
    const missingIds = elementIds.filter((id) => !indexIds.has(id));
    record(
      'every getElementById id exists in index.html',
      missingIds.length === 0,
      missingIds.length === 0 ? `${elementIds.length} ids all present` : `missing ${missingIds.join(', ')}`
    );
  } else {
    recordSkipped('every getElementById id exists in index.html', missingReason);
  }

  const duplicateIds = findDuplicateIds(indexHtml);
  record(
    'index.html has no duplicate ids',
    duplicateIds.length === 0,
    duplicateIds.length === 0 ? 'all id attributes unique' : `duplicates ${duplicateIds.join(', ')}`
  );

  record('index.html has no <style> block', !/<style\b/i.test(indexHtml), '<style> occurrences: none');

  const scriptTagBodies = extractScriptTagBodies(indexHtml);
  const inlineBodies = scriptTagBodies.filter((body) => body.trim() !== '');
  record(
    'index.html has no inline script body',
    inlineBodies.length === 0,
    `${scriptTagBodies.length} script tags, ${inlineBodies.length} with a body`
  );

  const scriptOpenTags = indexHtml.match(new RegExp(SCRIPT_OPEN_TAG_PATTERN.source, 'gi')) || [];
  const forbiddenAttributes = scriptOpenTags.filter((tag) =>
    /\btype\s*=\s*["']module["']/i.test(tag) || /\bdefer\b/i.test(tag) || /\basync\b/i.test(tag)
  );
  record(
    'index.html script tags have no type=module, defer or async',
    forbiddenAttributes.length === 0,
    `${scriptOpenTags.length} script tags checked`
  );

  const expectedSources = SCRIPT_FILES.map((fileName) => `js/${fileName}`);
  const actualSources = extractScriptSources(indexHtml);
  const sourcesInOrder = actualSources.length === expectedSources.length &&
    actualSources.every((source, index) => source === expectedSources[index]);
  record('six script tags present in required order', sourcesInOrder, `found [${actualSources.join(', ')}]`);

  const lastScriptCloseIndex = indexHtml.toLowerCase().lastIndexOf('</script>');
  const trailingAfterLastScript = lastScriptCloseIndex === -1 ? '' : indexHtml.slice(lastScriptCloseIndex + '</script>'.length);
  const scriptTagsAtEndOfBody = /^\s*<\/body>\s*<\/html>\s*$/i.test(trailingAfterLastScript);
  record(
    'six script tags are last elements before </body>',
    scriptTagsAtEndOfBody,
    `trailing text "${trailingAfterLastScript.replace(/\s+/g, ' ').trim()}"`
  );
}

function runParityChecks(original, scriptSources, styleSheetContent, concatenatedScript) {
  const originalSha = sha256(original.content);
  process.stdout.write(`sha256 original source (${original.label})            = ${originalSha}\n`);

  const fingerprintMatches = originalSha === EXPECTED_ORIGINAL_SHA256;
  record(
    'original source matches the recorded pre-split fingerprint',
    fingerprintMatches,
    fingerprintMatches
      ? `sha256 ${originalSha}`
      : `wrong revision for parity: expected revision ${PRE_SPLIT_REVISION} with sha256 ${EXPECTED_ORIGINAL_SHA256}, got sha256 ${originalSha}; pass ${PRE_SPLIT_REVISION}, the last commit before the split`
  );

  if (!fingerprintMatches) {
    process.stdout.write('NOTE: skipping content parity checks because the resolved original is not the recorded pre-split file.\n');
    return;
  }

  const originalLines = original.content.split('\n');
  const styleOpenIndex = findAnchorLine(originalLines, STYLE_OPEN_PATTERN, 0);
  const styleCloseIndex = styleOpenIndex === -1 ? -1 : findAnchorLine(originalLines, STYLE_CLOSE_PATTERN, styleOpenIndex + 1);
  const scriptOpenIndex = findAnchorLine(originalLines, SCRIPT_OPEN_PATTERN, 0);
  const scriptCloseIndex = scriptOpenIndex === -1 ? -1 : findAnchorLine(originalLines, SCRIPT_CLOSE_PATTERN, scriptOpenIndex + 1);
  const prologueIndex = scriptOpenIndex === -1 ? -1 : findAnchorLine(originalLines, DIRECTIVE_PROLOGUE_PATTERN, scriptOpenIndex + 1);

  record(
    'style anchors located in original',
    styleOpenIndex !== -1 && styleCloseIndex !== -1,
    `open line ${styleOpenIndex + 1}, close line ${styleCloseIndex + 1}`
  );
  record(
    'script anchors located in original',
    scriptOpenIndex !== -1 && scriptCloseIndex !== -1,
    `open line ${scriptOpenIndex + 1}, close line ${scriptCloseIndex + 1}`
  );
  record('directive prologue line located in original', prologueIndex !== -1, `line ${prologueIndex + 1}`);

  const anchorsLocated = styleOpenIndex !== -1 && styleCloseIndex !== -1 &&
    scriptOpenIndex !== -1 && scriptCloseIndex !== -1 && prologueIndex !== -1;

  const expectedCssBody = anchorsLocated ? originalLines.slice(styleOpenIndex + 1, styleCloseIndex).join('\n') : null;
  const expectedScriptBody = anchorsLocated ? originalLines.slice(prologueIndex + 1, scriptCloseIndex).join('\n') : null;

  const expectedCssContent = expectedCssBody === null ? null : `${expectedCssBody}\n`;
  const expectedScriptContent = expectedScriptBody === null ? null : `${expectedScriptBody}\n`;

  process.stdout.write(`sha256 expected css body + LF                     = ${expectedCssContent === null ? '<unavailable>' : sha256(expectedCssContent)}\n`);
  process.stdout.write(`sha256 actual styles/hud.css                      = ${styleSheetContent === null ? '<unavailable>' : sha256(styleSheetContent)}\n`);
  process.stdout.write(`sha256 expected script body + LF                  = ${expectedScriptContent === null ? '<unavailable>' : sha256(expectedScriptContent)}\n`);
  process.stdout.write(`sha256 actual concatenated js 01..06              = ${concatenatedScript === null ? '<unavailable>' : sha256(concatenatedScript)}\n`);

  if (expectedCssContent !== null && styleSheetContent !== null) {
    record(
      'css body parity (styles/hud.css vs original)',
      expectedCssContent === styleSheetContent,
      `styles/hud.css expected sha256 ${sha256(expectedCssContent)} got sha256 ${sha256(styleSheetContent)}`
    );
  } else {
    record('css body parity (styles/hud.css vs original)', false, 'skipped: original anchors or styles/hud.css unavailable');
  }

  if (expectedScriptContent !== null && concatenatedScript !== null) {
    const scriptParity = expectedScriptContent === concatenatedScript;
    let detail = `expected sha256 ${sha256(expectedScriptContent)} got sha256 ${sha256(concatenatedScript)}`;
    if (!scriptParity) {
      const changedFiles = findChangedScriptFiles(scriptSources, expectedScriptContent);
      detail += changedFiles.length > 0
        ? `; changed files vs pre-split: ${changedFiles.join(', ')}`
        : '; no individual file body matched the pre-split original';
    }
    record('script body parity (js 01..06 concatenated vs original)', scriptParity, detail);
  } else {
    record('script body parity (js 01..06 concatenated vs original)', false, 'skipped: original anchors or js sources unavailable');
  }
}

const { originalPath, originalRev } = parseArguments(process.argv.slice(2));
const parityMode = originalPath !== null || originalRev !== null;

const indexHtmlPath = join(ROOT, INDEX_RELATIVE);
let indexHtml;
try {
  indexHtml = readFileSync(indexHtmlPath, 'utf8');
} catch (error) {
  exitHarnessFailure(`cannot read ${indexHtmlPath}: ${error.message}`);
}

const scriptSources = readScriptSources();
const styleSheetContent = readStyleSheetContent();
const allScriptFilesPresent = scriptSources.every((source) => source.content !== null);
const concatenatedScript = allScriptFilesPresent
  ? scriptSources.map((source) => stripDirectivePrologue(source.content)).join('')
  : null;

if (!parityMode) {
  process.stdout.write('NOTE: byte-level parity with the pre-split original is a migration-time assertion and is only checked with --expect-unchanged <git-rev>.\n');
}

runDefaultChecks(indexHtml, scriptSources, styleSheetContent);

if (parityMode) {
  const original = readOriginal(originalPath, originalRev);
  runParityChecks(original, scriptSources, styleSheetContent, concatenatedScript);
}

process.stdout.write(`SUMMARY: ${checkCount - failureCount}/${checkCount} checks passed\n`);
process.exit(failureCount === 0 ? 0 : 1);
