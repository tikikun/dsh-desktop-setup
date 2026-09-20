#!/usr/bin/env node
/**
 * Apply the two patches @huanlin/dsh-plugin-better-sidebar-plugin-office@0.2.0
 * needs to load and to preview files inside DSH Desktop. Idempotent: re-running
 * it on a patched install reports "already applied" and changes nothing, and a
 * patch that cannot be applied is reported before anything is written.
 *
 * Patch A — `exports` accepts `require` conditions
 *   DSH's loader (cordis-plugin-loader `Entry.import`) imports a plugin row with
 *   a bare dynamic `import()` and, when that fails, falls back to
 *   `createRequire(<profile>/package.json).resolve(name)`. That fallback uses
 *   `require` conditions, so an `exports` map that only declares `import`
 *   throws ERR_PACKAGE_PATH_NOT_EXPORTED — the fallback swallows its own error
 *   and the original ERR_MODULE_NOT_FOUND surfaces in the UI as:
 *     "The plugin code could not be loaded. Its files may be damaged, missing a
 *      dependency, or incompatible with this Harness version."
 *   Adding a `default` condition (what dsh-better-sidebar and dshmarket do)
 *   makes the package resolvable through that fallback.
 *
 * Patch B — the media URL must carry an absolute path
 *   The viewer fetches `/sidebar/file?sessionId=…&path=…`. That route resolves
 *   its argument with `requireAbsolute` and answers
 *   `400 {"ok":false,"error":{"code":"fs-error","message":"\"<p>\" is not an absolute path"}}`
 *   for anything else. Files opened from the chat (a file mention, or Preview on
 *   a presented-file card) arrive as a `dsh-resource://file/session/…` address
 *   whose path is workspace-RELATIVE — DSH's `fileAddressFor` strips the
 *   workspace root and better-sidebar's native editor tab hands that string
 *   straight to the viewer. The explorer and the produced-files chip row
 *   absolutize first, which is why the same file renders from the file tree and
 *   shows "HTTP 400" from the chat. The patch resolves a workspace-relative
 *   `path` against `scope.cwd` (the tab scope the host already supplies) and
 *   leaves POSIX/drive/UNC paths untouched.
 *
 * Usage
 *   node apply-office-plugin-fixes.mjs                # patch (macOS/Windows default paths)
 *   node apply-office-plugin-fixes.mjs --check        # report only, exit 1 when unpatched
 *   node apply-office-plugin-fixes.mjs --dry-run      # show what would change
 *   node apply-office-plugin-fixes.mjs --harness-home "…/harness" --profile web
 *   node apply-office-plugin-fixes.mjs --plugin-dir "…/@huanlin/dsh-plugin-better-sidebar-plugin-office"
 *
 * Exit codes: 0 = patched (now or already), 1 = needs attention, 2 = bad usage.
 */

import { execFileSync } from 'node:child_process'
import { copyFileSync, existsSync, readFileSync, writeFileSync } from 'node:fs'
import { homedir, platform } from 'node:os'
import { join, resolve } from 'node:path'

const PLUGIN_NAME = '@huanlin/dsh-plugin-better-sidebar-plugin-office'
const DEFAULT_EXPORT = './lib/index.js'
/** Identifies Patch B in the bundle. */
const PATCH_B_MARK = 'absoluteOfficePath'
/** The doc line that belongs to fileUrl() and must sit directly above it. */
const FILE_URL_COMMENT = '\t\t/** Shared URL builder for the /sidebar/file route (media vs download). */\n'

const argv = process.argv.slice(2)
const flags = new Set(argv.filter((value) => value.startsWith('--')))
const option = (name) => {
  const index = argv.indexOf(name)
  return index === -1 ? undefined : argv[index + 1]
}
const CHECK_ONLY = flags.has('--check')
const DRY_RUN = flags.has('--dry-run')
const profile = option('--profile') ?? 'web'

if (flags.has('--help') || flags.has('-h')) {
  process.stdout.write(`${readFileSync(new URL(import.meta.url), 'utf8').split(' */')[0]} */\n`)
  process.exit(0)
}

/** Candidate Harness homes: macOS, Windows, Linux, then macOS again. */
function defaultHarnessHomes() {
  const home = homedir()
  const candidates = []
  if (platform() === 'darwin') candidates.push(join(home, 'Library/Application Support/dsh-desktop/harness'))
  if (platform() === 'win32' && process.env.APPDATA) candidates.push(join(process.env.APPDATA, 'dsh-desktop', 'harness'))
  candidates.push(join(home, '.config/dsh-desktop/harness'), join(home, 'Library/Application Support/dsh-desktop/harness'))
  return candidates
}

/** Resolve the installed plugin directory, or exit with the paths that were tried. */
function resolvePluginDir() {
  const explicit = option('--plugin-dir')
  if (explicit !== undefined) return resolve(explicit)
  const homes = option('--harness-home') ? [resolve(option('--harness-home'))] : defaultHarnessHomes()
  const tried = homes.map((home) => join(home, 'profiles', profile, 'node_modules', ...PLUGIN_NAME.split('/')))
  for (const candidate of tried) if (existsSync(join(candidate, 'package.json'))) return candidate
  process.stderr.write(
    `error: cannot find ${PLUGIN_NAME} in a DSH Desktop profile. Looked at:\n  ${tried.join('\n  ')}\n` +
      `Install it first (see README), or pass --plugin-dir / --harness-home.\n`,
  )
  process.exit(1)
}

/** Copy one file aside once, so a re-run never overwrites the pristine copy. */
function backupOnce(path, version) {
  const backup = `${path}.dsh-orig-${version}`
  if (!existsSync(backup)) copyFileSync(path, backup)
  return backup
}

/**
 * Insert the resolver above fileUrl() and route `path` through it.
 * @param source - bundle text.
 * @returns patched text, or undefined when the anchor is missing.
 */
function patchClient(source) {
  const helper =
    `\t\t/**\n` +
    `\t\t* Resolve a Workspace-relative path against the session cwd. A resource-address\n` +
    `\t\t* tab carries the path RELATIVE to the workspace root (dsh-resource://file/session/...),\n` +
    `\t\t* while the host's /sidebar/file route requires an absolute path (requireAbsolute\n` +
    `\t\t* answers 400 "\\"<path>\\" is not an absolute path" otherwise). Absolute paths\n` +
    `\t\t* (POSIX, drive, UNC) pass through untouched.\n` +
    `\t\t*/\n` +
    `\t\tfunction absoluteOfficePath(cwd, path) {\n` +
    `\t\t\tif (typeof path !== "string" || path === "") return path;\n` +
    `\t\t\tif (path.startsWith("/") || /^[A-Za-z]:[/\\\\]/.test(path) || path.startsWith("\\\\\\\\")) return path;\n` +
    `\t\t\tif (cwd === void 0 || cwd === "") return path;\n` +
    `\t\t\treturn cwd.replace(/[/\\\\]+$/, "") + "/" + path.replace(/^[/\\\\]+/, "");\n` +
    `\t\t}\n`
  const anchor =
    /(\t*)function fileUrl\(scope, path, download\) \{\n(\t*)const params = new URLSearchParams\(\{\n(\t*)sessionId: scope\.sessionId,\n(\t*)path\n/
  const match = anchor.exec(source)
  if (match === null) return undefined
  const [fnIndent, constIndent, propIndent] = [match[1], match[2], match[3]]
  const before = source.slice(0, match.index)
  const head = before.endsWith(FILE_URL_COMMENT) ? before.slice(0, -FILE_URL_COMMENT.length) : before
  const body =
    `${fnIndent}function fileUrl(scope, path, download) {\n` +
    `${constIndent}const params = new URLSearchParams({\n` +
    `${propIndent}sessionId: scope.sessionId,\n` +
    `${propIndent}path: absoluteOfficePath(scope.cwd, path)\n`
  return head + helper + FILE_URL_COMMENT + body + source.slice(match.index + match[0].length)
}

const pluginDir = resolvePluginDir()
const manifestPath = join(pluginDir, 'package.json')
const clientPath = join(pluginDir, 'lib', 'client.js')
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'))
const version = manifest.version ?? 'unknown'

process.stdout.write(
  `plugin : ${PLUGIN_NAME}@${version}\npath   : ${pluginDir}\nmode   : ${
    CHECK_ONLY ? 'check only' : DRY_RUN ? 'dry run' : 'apply'
  }\n\n`,
)

/* ------------------------------------------------------- plan: Patch A + B */

const changes = []
const problems = []
let writeManifest
let writeClient

/* Patch A — exports["."].default */
const mainExport = typeof manifest.exports === 'object' ? manifest.exports?.['.'] : undefined
if (typeof mainExport === 'object' && mainExport?.default === DEFAULT_EXPORT) {
  process.stdout.write(`[A] exports["."].default = "${DEFAULT_EXPORT}"   already applied\n`)
} else if (typeof mainExport !== 'object') {
  problems.push(`[A] ${PLUGIN_NAME}@${version} has no exports["."] object — the release changed shape; re-derive the patch`)
} else {
  const importTarget = mainExport.import ?? mainExport.default
  if (typeof importTarget !== 'string' || !existsSync(join(pluginDir, importTarget))) {
    problems.push(`[A] exports["."] declares no usable import target (${String(importTarget)})`)
  } else {
    changes.push(`[A] exports["."].default: (absent) -> "${DEFAULT_EXPORT}"`)
    writeManifest = async () => {
      backupOnce(manifestPath, version)
      writeFileSync(
        manifestPath,
        `${JSON.stringify({ ...manifest, exports: { ...manifest.exports, '.': { ...mainExport, default: DEFAULT_EXPORT } } }, undefined, 2)}\n`,
      )
    }
  }
}

/* Patch B — absolute path in the media URL */
if (!existsSync(clientPath)) {
  problems.push(`[B] ${clientPath} is missing`)
} else {
  const client = readFileSync(clientPath, 'utf8')
  if (client.includes(PATCH_B_MARK)) {
    process.stdout.write(`[B] media URL resolves workspace-relative paths   already applied\n`)
  } else {
    const patched = patchClient(client)
    if (patched === undefined) {
      problems.push(`[B] cannot find the fileUrl() builder in lib/client.js — the bundle changed; re-derive the patch`)
    } else {
      changes.push(`[B] fileUrl(): resolve a workspace-relative path against scope.cwd`)
      writeClient = async () => {
        backupOnce(clientPath, version)
        writeFileSync(clientPath, patched)
      }
    }
  }
}

/* ----------------------------------------------------------- report / apply */

for (const change of changes) {
  process.stdout.write(`${CHECK_ONLY ? 'missing  ' : DRY_RUN ? 'would do ' : 'changed  '} ${change}\n`)
}
for (const problem of problems) process.stdout.write(`cannot patch ${problem}\n`)

if (problems.length > 0) {
  process.stdout.write(`\nnothing was written. Resolve the "cannot patch" lines above, then re-run.\n`)
  process.exit(1)
}

if (changes.length === 0) {
  process.stdout.write(`\nboth patches are in place — nothing to do.\n`)
  process.exit(0)
}

if (CHECK_ONLY) {
  process.stdout.write(`\n--check: ${changes.length} patch(es) missing; re-run without --check to apply them.\n`)
  process.exit(1)
}

if (DRY_RUN) {
  process.stdout.write(`\n--dry-run: nothing written.\n`)
  process.exit(0)
}

await writeManifest?.()
await writeClient?.()

/* Verify the invariants on the files as they now sit on disk. */
if (JSON.parse(readFileSync(manifestPath, 'utf8')).exports?.['.']?.default !== DEFAULT_EXPORT) {
  problems.push('[A] exports["."].default is still missing after writing')
}
const verifiedClient = readFileSync(clientPath, 'utf8')
if (!verifiedClient.includes(PATCH_B_MARK) || !verifiedClient.includes('path: absoluteOfficePath(scope.cwd, path)')) {
  problems.push('[B] lib/client.js does not call absoluteOfficePath')
}
if (problems.length === 0) {
  try {
    execFileSync(process.execPath, ['--check', clientPath], { stdio: 'pipe' })
  } catch (error) {
    problems.push(`[B] lib/client.js does not parse after patching: ${String(error.stderr ?? error.message)}`)
  }
}

if (problems.length > 0) {
  process.stdout.write(`\nverification FAILED:\n  ${problems.join('\n  ')}\n`)
  process.exit(1)
}

process.stdout.write(
  `\nverification passed: exports.default present, client.js patched and parses.\n\n` +
    `next steps\n` +
    `  1. Quit and reopen DSH Desktop (the window is served the client bundle from the Harness process).\n` +
    `  2. Open a .pptx from the sidebar file tree — should render.\n` +
    `  3. Open the same file from a chat file mention or a presented-file Preview card — should render; this is the path Patch B fixes.\n` +
    `  4. Nothing renders yet? Read the Harness log (see README) and grep for "plugin failures".\n`,
)