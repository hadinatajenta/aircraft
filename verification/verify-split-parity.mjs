import { readFileSync } from 'node:fs';
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

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const STYLE_OPEN_PATTERN = /^\s*<style\b/;
const STYLE_CLOSE_PATTERN = /^\s*<\/style>/;
const SCRIPT_OPEN_PATTERN = /^\s*<script\b/;
const SCRIPT_CLOSE_PATTERN = /^\s*<\/script>/;
const DIRECTIVE_PROLOGUE = '"use strict";';
const DECLARATION_PATTERN = /^ {4}(?:async\s+)?(?:function|const|let|var|class)\s+([A-Za-z_$][\w$]*)/;
const GET_ELEMENT_BY_ID_PATTERN = /getElementById\(\s*['"]([^'"]+)['"]\s*\)/g;
const HTML_TAG_PATTERN = /<[a-zA-Z!/][^>]*>/;
const SCRIPT_TAG_PATTERN = /<script\b[^>]*>([\s\S]*?)<\/script>/gi;
const SCRIPT_OPEN_TAG_PATTERN = /<script\b[^>]*>/gi;
const SRC_ATTRIBUTE_PATTERN = /src\s*=\s*["']([^"']+)["']/i;
const LOAD_LISTENER_PATTERN = /window\.addEventListener\(\s*'load'\s*,\s*initSkystrike\s*\)/;
const PRE_SPLIT_REVISION = '924b8fc';
const EXPECTED_ORIGINAL_SHA256 = '749664f37cdd2de979d5906f34982e3e5776bb78b0aeb38ca130f5338795d15a';

let checkCount = 0;
let failureCount = 0;

function printUsage() {
  process.stderr.write('usage: node verification/verify-split-parity.mjs [--original <path> | --original-rev <git-rev>]\n');
  process.stderr.write('  --original <path>       read the pre-split single-file source from a file\n');
  process.stderr.write('  --original-rev <rev>    read it via `git show <rev>:index.html` (default: ' + PRE_SPLIT_REVISION + ')\n');
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
    if (token === '--original') {
      if (index + 1 >= argv.length) {
        printUsage();
        exitHarnessFailure('--original requires a path argument');
      }
      originalPath = argv[index + 1];
      index += 1;
    } else if (token === '--original-rev') {
      if (index + 1 >= argv.length) {
        printUsage();
        exitHarnessFailure('--original-rev requires a git revision argument');
      }
      originalRev = argv[index + 1];
      index += 1;
    } else if (token === '--help' || token === '-h') {
      printUsage();
      process.exit(0);
    } else {
      printUsage();
      exitHarnessFailure(`unrecognized argument: ${token}`);
    }
  }
  if (originalPath === null && originalRev === null) {
    originalRev = PRE_SPLIT_REVISION;
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
    content = execFileSync('git', ['-C', ROOT, 'show', `${originalRev}:index.html`], {
      encoding: 'utf8',
      maxBuffer: 256 * 1024 * 1024
    });
  } catch (error) {
    exitHarnessFailure(`git show ${originalRev}:index.html failed: ${error.message}`);
  }
  if (content.length === 0) {
    exitHarnessFailure(`git show ${originalRev}:index.html yielded no content`);
  }
  return { label: `${originalRev}:index.html`, content };
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

function findLastNonEmptyLine(lines) {
  for (let index = lines.length - 1; index >= 0; index -= 1) {
    if (lines[index].trim() !== '') {
      return lines[index];
    }
  }
  return null;
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

function escapeRegExp(text) {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function collectTopLevelDeclarations(files) {
  const declarationOwners = new Map();
  for (const fileName of files) {
    const body = stripDirectivePrologue(readFileSync(join(ROOT, 'js', fileName), 'utf8'));
    for (const line of body.split('\n')) {
      const match = line.match(DECLARATION_PATTERN);
      if (match) {
        const name = match[1];
        if (!declarationOwners.has(name)) {
          declarationOwners.set(name, []);
        }
        declarationOwners.get(name).push(fileName);
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

const { originalPath, originalRev } = parseArguments(process.argv.slice(2));
const original = readOriginal(originalPath, originalRev);

record('original source resolved', original.content.length > 0, `${original.label}, ${original.content.length} bytes`);
record(
  'original source matches the recorded pre-split fingerprint',
  sha256(original.content) === EXPECTED_ORIGINAL_SHA256,
  `expected ${EXPECTED_ORIGINAL_SHA256.slice(0, 16)} got ${sha256(original.content).slice(0, 16)}`
);

const originalLines = original.content.split('\n');
const styleOpenIndex = findAnchorLine(originalLines, STYLE_OPEN_PATTERN, 0);
const styleCloseIndex = styleOpenIndex === -1 ? -1 : findAnchorLine(originalLines, STYLE_CLOSE_PATTERN, styleOpenIndex + 1);
const scriptOpenIndex = findAnchorLine(originalLines, SCRIPT_OPEN_PATTERN, 0);
const scriptCloseIndex = scriptOpenIndex === -1 ? -1 : findAnchorLine(originalLines, SCRIPT_CLOSE_PATTERN, scriptOpenIndex + 1);
const prologueIndex = scriptOpenIndex === -1 ? -1 : findAnchorLine(originalLines, /^\s*"use strict";\s*$/, scriptOpenIndex + 1);

record('style anchors located in original', styleOpenIndex !== -1 && styleCloseIndex !== -1, `open line ${styleOpenIndex + 1}, close line ${styleCloseIndex + 1}`);
record('script anchors located in original', scriptOpenIndex !== -1 && scriptCloseIndex !== -1, `open line ${scriptOpenIndex + 1}, close line ${scriptCloseIndex + 1}`);
record('directive prologue line located in original', prologueIndex !== -1, `line ${prologueIndex + 1}`);

const anchorsLocated = styleOpenIndex !== -1 && styleCloseIndex !== -1 &&
  scriptOpenIndex !== -1 && scriptCloseIndex !== -1 && prologueIndex !== -1;

const expectedCssBody = anchorsLocated ? originalLines.slice(styleOpenIndex + 1, styleCloseIndex).join('\n') : null;
const expectedScriptBody = anchorsLocated ? originalLines.slice(prologueIndex + 1, scriptCloseIndex).join('\n') : null;

const expectedCssContent = expectedCssBody === null ? null : `${expectedCssBody}\n`;
const expectedScriptContent = expectedScriptBody === null ? null : `${expectedScriptBody}\n`;

const cssPath = join(ROOT, 'styles', 'hud.css');
const actualCssContent = readFileSync(cssPath, 'utf8');

let concatenatedScript = '';
const scriptFileContents = SCRIPT_FILES.map((fileName) => {
  const raw = readFileSync(join(ROOT, 'js', fileName), 'utf8');
  concatenatedScript += stripDirectivePrologue(raw);
  return raw;
});

process.stdout.write(`sha256 original source (${original.label})            = ${sha256(original.content)}\n`);
process.stdout.write(`sha256 expected css body + LF                     = ${expectedCssContent === null ? '<unavailable>' : sha256(expectedCssContent)}\n`);
process.stdout.write(`sha256 actual styles/hud.css                      = ${sha256(actualCssContent)}\n`);
process.stdout.write(`sha256 expected script body + LF                  = ${expectedScriptContent === null ? '<unavailable>' : sha256(expectedScriptContent)}\n`);
process.stdout.write(`sha256 actual concatenated js 01..06              = ${sha256(concatenatedScript)}\n`);

if (anchorsLocated) {
  record(
    'css body parity (styles/hud.css vs original)',
    expectedCssContent === actualCssContent,
    `expected sha256 ${sha256(expectedCssContent)} got ${sha256(actualCssContent)}`
  );
  record(
    'script body parity (js 01..06 concatenated vs original)',
    expectedScriptContent === concatenatedScript,
    `expected sha256 ${sha256(expectedScriptContent)} got ${sha256(concatenatedScript)}`
  );
} else {
  record('css body parity (styles/hud.css vs original)', false, 'skipped: original anchors not located');
  record('script body parity (js 01..06 concatenated vs original)', false, 'skipped: original anchors not located');
}

record('styles/hud.css contains no HTML tags', !HTML_TAG_PATTERN.test(actualCssContent), 'no tag-like sequences');
record('styles/hud.css braces balanced', hasBalancedBraces(actualCssContent), 'open and close brace depth returns to zero');
record('styles/hud.css retains @media rule', /@media\b/.test(actualCssContent), `@media occurrences ${countOccurrences(actualCssContent, /@media/g)}`);

const initSkystrikeCount = countOccurrences(concatenatedScript, /initSkystrike/g);
record('concatenated script has exactly two initSkystrike occurrences', initSkystrikeCount === 2, `found ${initSkystrikeCount}`);

const registrationLine = expectedScriptBody === null ? findLastNonEmptyLine(concatenatedScript.split('\n')) : findLastNonEmptyLine(expectedScriptBody.split('\n'));
const registrationIsLoadListener = registrationLine !== null && LOAD_LISTENER_PATTERN.test(registrationLine);
record('expected script body ends with load-listener registration line', registrationIsLoadListener, registrationLine === null ? 'no non-empty line' : `last line "${registrationLine.trim()}"`);

const concatenatedEndsWithRegistration = registrationLine !== null && concatenatedScript.endsWith(`${registrationLine}\n`);
record('concatenated script ends with load-listener registration line', concatenatedEndsWithRegistration, registrationLine === null ? 'no registration line available' : `expects trailing "${registrationLine.trim()}"`);

const emptyScriptFiles = SCRIPT_FILES.filter((fileName, index) => scriptFileContents[index].trim() === '');
record('no js file is empty', emptyScriptFiles.length === 0, emptyScriptFiles.length === 0 ? `${SCRIPT_FILES.length} files non-empty` : `empty files ${emptyScriptFiles.join(', ')}`);

const syntaxFailures = [];
for (const fileName of SCRIPT_FILES) {
  try {
    execFileSync(process.execPath, ['--check', join(ROOT, 'js', fileName)], { stdio: 'pipe' });
  } catch (error) {
    const reported = String(error.stderr || '').split('\n').map((line) => line.trim()).filter(Boolean);
    syntaxFailures.push(`${fileName}: ${reported[0] || 'syntax error'}`);
  }
}
record(
  'every js file parses standalone as a classic script',
  syntaxFailures.length === 0,
  syntaxFailures.length === 0 ? `${SCRIPT_FILES.length} files parsed by node --check` : syntaxFailures.join('; ')
);

const expectedTotalLines = expectedScriptBody === null ? -1 : expectedScriptBody.split('\n').length + SCRIPT_FILES.length;
const actualTotalLines = scriptFileContents.reduce((total, content) => total + content.split('\n').length - 1, 0);
record(
  'split preserves the total script line count',
  expectedTotalLines === actualTotalLines,
  `expected ${expectedTotalLines} lines across ${SCRIPT_FILES.length} files, got ${actualTotalLines}`
);

const declarationOwners = collectTopLevelDeclarations(SCRIPT_FILES);
const duplicateDeclarations = [...declarationOwners.entries()].filter(([, owners]) => owners.length > 1);
const declarationCount = [...declarationOwners.values()].reduce((total, owners) => total + owners.length, 0);
record(
  'top-level declaration names unique across all six files',
  duplicateDeclarations.length === 0,
  duplicateDeclarations.length === 0
    ? `${declarationCount} declarations, ${declarationOwners.size} unique names`
    : `duplicates ${duplicateDeclarations.map(([name, owners]) => `${name} in ${owners.join(' + ')}`).join('; ')}`
);

const indexHtml = readFileSync(join(ROOT, 'index.html'), 'utf8');
const elementIds = [...new Set([...concatenatedScript.matchAll(GET_ELEMENT_BY_ID_PATTERN)].map((match) => match[1]))];
const missingIds = elementIds.filter((id) => !new RegExp(`id\\s*=\\s*["']${escapeRegExp(id)}["']`).test(indexHtml));
record(
  'every getElementById id exists in index.html',
  missingIds.length === 0,
  missingIds.length === 0 ? `${elementIds.length} ids all present` : `missing ${missingIds.join(', ')}`
);

record('index.html has no <style> block', !/<style\b/i.test(indexHtml), '<style> occurrences: none');
const scriptTagBodies = extractScriptTagBodies(indexHtml);
const inlineBodies = scriptTagBodies.filter((body) => body.trim() !== '');
record('index.html has no inline script body', inlineBodies.length === 0, `${scriptTagBodies.length} script tags, ${inlineBodies.length} with a body`);

const scriptOpenTags = indexHtml.match(new RegExp(SCRIPT_OPEN_TAG_PATTERN.source, 'gi')) || [];
const forbiddenAttributes = scriptOpenTags.filter((tag) => /\btype\s*=\s*["']module["']/i.test(tag) || /\bdefer\b/i.test(tag) || /\basync\b/i.test(tag));
record('index.html script tags have no type=module, defer or async', forbiddenAttributes.length === 0, `${scriptOpenTags.length} script tags checked`);

const expectedSources = SCRIPT_FILES.map((fileName) => `js/${fileName}`);
const actualSources = extractScriptSources(indexHtml);
const sourcesInOrder = actualSources.length === expectedSources.length && actualSources.every((source, index) => source === expectedSources[index]);
record('six script tags present in required order', sourcesInOrder, `found [${actualSources.join(', ')}]`);

const lastScriptCloseIndex = indexHtml.toLowerCase().lastIndexOf('</script>');
const trailingAfterLastScript = lastScriptCloseIndex === -1 ? '' : indexHtml.slice(lastScriptCloseIndex + '</script>'.length);
const scriptTagsAtEndOfBody = /^\s*<\/body>\s*<\/html>\s*$/i.test(trailingAfterLastScript);
record('six script tags are last elements before </body>', scriptTagsAtEndOfBody, `trailing text "${trailingAfterLastScript.replace(/\s+/g, ' ').trim()}"`);

process.stdout.write(`SUMMARY: ${checkCount - failureCount}/${checkCount} checks passed\n`);
process.exit(failureCount === 0 ? 0 : 1);
