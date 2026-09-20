# DSH Desktop + better-sidebar + Office preview — agent setup guide

Install **DSH Desktop**, add the **better-sidebar** base plugin and the
**Office preview** plugin (`@huanlin/dsh-plugin-better-sidebar-plugin-office`),
and apply the **two patches** that plugin needs before `.docx` / `.xlsx` /
`.pptx` previews work.

Written for an agent operating someone's machine: every step has a command and
an expected result, every failure mode is named, and nothing here is guesswork —
all of it was reproduced on a real install.

**Verified on**

| Component | Version |
|---|---|
| macOS | 26.6.2 (25G83), Apple Silicon |
| DSH Desktop | 0.9.0 (`dataelement/dsh-desktop`) |
| Bundled Harness | `@deepseek-ai/dsh` 0.1.5-rc.2 |
| Bundled Node / pnpm | Node 24.18.1 · pnpm 10.34.5 (store `v10`) |
| `dshmarket` (market) | 1.50.0 |
| `dsh-better-sidebar` | 0.19.1 |
| `@huanlin/dsh-plugin-better-sidebar-plugin-office` | 0.2.0 (latest; 0.1.x identical shape) |

Windows paths are given where they differ, but Windows is **untested** — the
patch tool takes `--harness-home` so it can be pointed anywhere.

---

## 0. Operating rules (read first)

1. **Never run bare `pnpm install` in a profile directory.** The desktop pins
   plugins through `pnpm.overrides` `link:` rows into
   `profiles/.generations/live/…`; a plain install drops them and the profile
   stops matching what the app projects. Use the app's Market or
   `dsh plugin --profile web add <pkg>@<version>`.
2. **Use the desktop's own pnpm.** All profile package operations in the app go
   through the shim at `<harness>/.desktop-bin/pnpm` → bundled pnpm 10.34.5.
   A homebrew/npm `pnpm` 11 on `PATH` fails with `ERR_PNPM_UNEXPECTED_STORE`
   (store `v11` vs the profile's `v10`) **and ignores `pnpm.overrides`**.
3. **Quit/reopen the app after installing or patching plugins.** The client
   bundle is served to the window; a reload is not always enough.
4. **Back up before editing** anything under `node_modules`. The patch tool does
   this itself (`*.dsh-orig-<version>`).
5. **Patches under `node_modules` do not survive a reinstall/update** of the
   package. Re-run `tools/apply-office-plugin-fixes.mjs` after any install,
   update, or Market action on the office plugin (it is idempotent).
6. Read failures from the **Harness log**, not the UI banner:
   `~/Library/Logs/DSH Desktop/harness.log`.

---

## 1. Install DSH Desktop

1. Download the **stable** build for the machine:
   - macOS (Apple Silicon or Intel): signed + notarized DMG/ZIP via
     <https://www.dshdesktop.com/#download>
   - Windows x64: code-signed NSIS installer (same page)
   - Pre-release builds live on <https://github.com/dataelement/dsh-desktop/releases>
     and are *not* recommended: they track newer Harness versions and community
     plugins are frequently incompatible.
2. Install and launch once. The app starts its own Harness process and opens the
   UI; no CLI or browser tab is needed.
3. Confirm the first launch created the Harness home and the `web` profile:

```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"       # macOS
# export DSH_HOME="$APPDATA/dsh-desktop/harness"                             # Windows (Git Bash)
ls "$DSH_HOME"                       # attachments cache kimi-ppt llm-deepseek profiles sessions settings.yaml storages
ls "$DSH_HOME/profiles"              # .generations  node_modules  web
tail -5 ~/Library/Logs/DSH\ Desktop/harness.log
```

Expected log tail (the `?token=` URL is the app's own authenticated UI URL):

```
[desktop] Harness announced its endpoint; probing until it answers
[desktop] Harness is ready
```

The profile manifest — the single source of truth for what loads — is
`$DSH_HOME/profiles/web/package.json`:

```jsonc
{
  "name": "dsh-profile-web",
  "dependencies": { "dshmarket": "^1.50.0", "dsh-better-sidebar": "0.19.1" },
  "dsh": {
    "profile": { "bundles": ["@deepseek-ai/dsh-base", "@deepseek-ai/dsh-web-app", "dshmarket"], "patchReload": "live" },
    "desktop": { "generationProjection": { "version": 1, "plugins": { /* pinned generations */ } } }
  },
  "pnpm": { "overrides": { /* link: rows into profiles/.generations/live/… */ } }
}
```

Any package that must load as a **bundle** has to appear in
`dsh.profile.bundles` — `dsh plugin add` does that for you, a hand-edit of
`dependencies` does not.

---

## 2. Make sure the plugin market is there

A fresh desktop profile **already bundles** `dshmarket` (the community plugin
market). It is the recommended way to install the next two plugins because it
goes through the desktop's install boundary (exact versions, generations) and
writes the disable/enable rows correctly.

- In the app: **Settings → Plugin Market** (needs dsh web ≥ 0.1.0-rc.6; the
  bundled 0.1.5-rc.2 is fine).
- If the entry is missing, check that `dshmarket` is in
  `dsh.profile.bundles`, and install it if not (step 3 commands, same shape).

The market's activity log is `$DSH_HOME/profiles/web/.dsh-market/log.ndjson`;
its state (`disabled` list, favourites, region) is
`$DSH_HOME/profiles/web/.dsh-market/state.json`.

---

## 3. Install the better-sidebar base plugin

`dsh-better-sidebar` is the sidebar/editor surface the office previewers plug
into. **Version matters — install an exact version.** The desktop's install
boundary refuses ranges and re-pins the version it wants:

```
{"level":"info","event":"install","detail":"desktop install boundary needs an exact version: dsh-better-sidebar -> dsh-better-sidebar@0.19.1"}
```

### Path A — Market (preferred)

**Settings → Plugin Market → search `better-sidebar` → Install.** Most plugins
hot-mount; if the card says a restart is needed, use the restart button beside
the pending-change banner.

### Path B — CLI (same pnpm the app uses)

```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
APP="/Applications/DSH Desktop.app/Contents/Resources/app"
export PATH="$DSH_HOME/.desktop-bin:$PATH"    # MUST be first: gives pnpm 10.34.5 + the rename-recovery runner
NODE="$DSH_HOME/.desktop-bin/node"            # bundled Node 24.18.1

pnpm --version                                # => 10.34.5    (a v11 here is the #1 cause of install failures)
pnpm store path                               # => ~/Library/pnpm/store/v10

"$NODE" "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web add dsh-better-sidebar@0.19.1
```

### Verify

```bash
node -e 'const p=require(process.env.DSH_HOME+"/profiles/web/package.json");
  console.log("bundles:", p.dsh.profile.bundles.join(", "));
  console.log("overrides:", JSON.stringify(p.pnpm?.overrides ?? {}, null, 1))'
ls "$DSH_HOME/profiles/.generations/live"     # dsh-better-sidebar+0.19.1+<hash>
```

- `bundles` must contain `dsh-better-sidebar`.
- A generation directory must exist and `pnpm.overrides` must have a
  `link:` row pointing at it. The app re-projects this on every launch
  (`[desktop] projected generations: 1 linked, 0 unlinked`).
- Reopen the app; the sidebar/editor surface shows up in the right column.

If pnpm aborts with **`ERR_PNPM_UNEXPECTED_STORE`** the wrong pnpm answered —
fix the `PATH` (rule 2), then re-run.

---

## 4. Install the Office preview plugin

```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
APP="/Applications/DSH Desktop.app/Contents/Resources/app"
export PATH="$DSH_HOME/.desktop-bin:$PATH"
NODE="$DSH_HOME/.desktop-bin/node"

"$NODE" "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" plugin --profile web add \
  @huanlin/dsh-plugin-better-sidebar-plugin-office
```

Expected output ends with the package added and the bundle registered; then:

```bash
node -e 'console.log(require(process.env.DSH_HOME+"/profiles/web/package.json").dsh.profile.bundles)'
# [ … "dshmarket", "dsh-better-sidebar", "@huanlin/dsh-plugin-better-sidebar-plugin-office" ]
```

The plugin ships a `cordis.patch.yml` that inserts one loader row
(`id: dsh-better-sidebar-plugin-office`) and a client bundle that registers the
`docx` / `xlsx` / `pptx` file viewers through
`ctx.betterSidebar.registerFileViewer`. Its host half is empty.

**Now apply the patches — the plugin does not work without them.**

---

## 5. The two patches (and why each exists)

```bash
node tools/apply-office-plugin-fixes.mjs            # apply (idempotent)
node tools/apply-office-plugin-fixes.mjs --check     # report only, exit 1 when unpatched
node tools/apply-office-plugin-fixes.mjs --dry-run   # show what would change
```

Then **quit and reopen DSH Desktop**.

### Patch A — `exports` must be resolvable under `require`

**Symptom (UI):** *"The plugin code could not be loaded. Its files may be
damaged, missing a dependency, or incompatible with this Harness version."*
plus a recovery card offering to remove the plugin.

**Symptom (log):** `~/Library/Logs/DSH Desktop/harness.log`

```
[harness-node] plugin failures: {"stage":"import","entryId":"dsh-better-sidebar-plugin-office",
 "packageName":"@huanlin/dsh-plugin-better-sidebar-plugin-office",
 "message":"Cannot find package '@huanlin/dsh-plugin-better-sidebar-plugin-office' imported from
 /Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/cordis-plugin-loader/lib/index.js"}
[harness-node] DSH entry failed: Error: dsh: plugin tree failed to load … failed to import loader entry
```

**Cause:** `cordis-plugin-loader`'s `Entry.import` first tries a bare dynamic
`import(name)` (resolution base = the app, so out-of-tree plugin packages are
never found), then falls back to
`createRequire(<profile>/package.json).resolve(name)`. That fallback resolves
under **`require` conditions**, and this package's `exports` only declares
`import`:

```jsonc
// 0.2.0, broken here
"exports": { ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js" } }
// dsh-better-sidebar and dshmarket, work
"exports": { ".": { "types": "…", "default": "./lib/index.js" } }
```

`require.resolve` throws `ERR_PACKAGE_PATH_NOT_EXPORTED`, the fallback swallows
that error, and the original `ERR_MODULE_NOT_FOUND` is what surfaces. In this
app build `ctx.loader.internal` is unavailable (no `--expose-internals`, no
`node-addon-require-builtin`), so the fallback is the **only** resolution path.

**Fix, installed copy:** add a `default` condition to `exports["."]`.

**Fix, plugin source (`package.json`), ship in 0.2.1:**

```json
"exports": {
  ".": { "types": "./lib/types/index.d.ts", "import": "./lib/index.js", "default": "./lib/index.js" },
  "./client": "./lib/client.js",
  "./cordis.patch.yml": "./cordis.patch.yml",
  "./package.json": "./package.json"
}
```

### Patch B — the media URL must carry an absolute path

**Symptom (UI):** the viewer shows `HTTP 400` for a `.pptx` (or docx/xlsx) that
renders fine when opened from the sidebar **file tree** — typically the one you
clicked in the chat (a file mention, or **Preview** on a presented-file card).

**Cause — a path-form mismatch, not a file problem:**

1. The viewer fetches `mediaUrl(scope, path)` → `/sidebar/file?sessionId=…&path=…&cwd=…`
   (the plugin's `src/client/urls.ts` mirrors better-sidebar's own builder).
2. The route (`dsh-better-sidebar/lib/index.js`) resolves the argument with
   `requireAbsolute` and answers
   `400 {"ok":false,"error":{"code":"fs-error","message":"\"<path>\" is not an absolute path"}}`.
3. Files opened from the chat are opened **by resource address**:
   `dsh-client-ui-chat`'s `openFile` → `fileAddressFor(sessionId, cwd, path)`
   (`@deepseek-ai/dsh-util-workspace-path`), which **strips the workspace root**:

   | caller passes | address | tab path given to the viewer |
   |---|---|---|
   | `Northwind-FY26/deck.pptx` | `dsh-resource://file/session/<sid>/Northwind-FY26/deck.pptx` | `Northwind-FY26/deck.pptx` |
   | `/Users/me/ws/Northwind-FY26/deck.pptx` | `dsh-resource://file/session/<sid>/Northwind-FY26/deck.pptx` | `Northwind-FY26/deck.pptx` |

4. better-sidebar's native editor tab hands the address's path straight through
   (`fileParamsOf(info) → { path: address.path }`), so the viewer receives a
   **workspace-relative** path.
5. The explorer and better-sidebar's intercepted produced-files chip row
   absolutize first (`openSidebarFile` → `resolveSidebarPath(cwd, path)`), which
   is exactly why the same file works from the tree and 400s from the chat.

Not the cause, ruled out with the route itself: file size (`mediaLimit` is
20 MiB → 400 `not a file or too large`, and every test deck here is 41 KB–2.3 MB),
file content, ZIP layout, compression, and the `pptx` extension (no extension
list gates the media route).

**Fix, installed copy:** `fileUrl()` resolves a relative `path` against
`scope.cwd` (the tab scope the host already supplies) before building the URL:

```js
function absoluteOfficePath(cwd, path) {
  if (typeof path !== "string" || path === "") return path;
  if (path.startsWith("/") || /^[A-Za-z]:[/\\]/.test(path) || path.startsWith("\\\\")) return path;
  if (cwd === void 0 || cwd === "") return path;
  return cwd.replace(/[/\\]+$/, "") + "/" + path.replace(/^[/\\]+/, "");
}
```

**Fix, plugin source (`src/client/urls.ts`), ship in 0.2.1:** add
`absoluteOfficePath` (or `resolveWorkspacePath`-equivalent) and route `path`
through it in `fileUrl()`.

**Better fix, upstream:** the address grammar better-sidebar documents says
*"the host resolves it against the root it holds for the session"*, and the
route doesn't do it while its own client helper `resolveSidebarPath` does. One
line in the `/sidebar/file` handler (resolve a session-relative `path` against
`resolveSessionPath`-style cwd before `requireAbsolute`) would fix **every**
`mediaUrl` viewer — better-sidebar's built-in image/PDF viewers have the same
latent bug. Worth filing; Patch B just stops our plugin from depending on it.

---

## 6. Verification checklist

Run in order; all four must pass.

**1. Composed tree contains the plugin row**

```bash
export DSH_HOME="$HOME/Library/Application Support/dsh-desktop/harness"
APP="/Applications/DSH Desktop.app/Contents/Resources/app"
NODE="$DSH_HOME/.desktop-bin/node"

"$NODE" "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile web --patch "/Applications/DSH Desktop.app/Contents/Resources/dsh-desktop.patch.yml" \
  --dump-config | grep -n -B2 -A3 "better-sidebar-plugin-office"
```

Expect the row `name: '@huanlin/dsh-plugin-better-sidebar-plugin-office'` plus
the better-sidebar rows. `--dump-config` mounts nothing — it is safe on a live
profile.

**2. Boot smoke test (proves Patch A)**

```bash
"$NODE" "$APP/node_modules/@deepseek-ai/dsh/lib/bin.js" \
  --profile web --patch "/Applications/DSH Desktop.app/Contents/Resources/dsh-desktop.patch.yml" \
  --port 0 --no-open
# expect: dsh web: http://127.0.0.1:<port>/?token=…
```

Keep it running for the next check; `Ctrl-C` when done. **Any** `plugin
failures` / `Cannot find package` / `failed to import loader entry` line on
stderr means Patch A is missing or was reverted.

**3. Media route matrix (proves Patch B's premise and the fix)**

```bash
PORT=<port from step 2>
SID=$(basename "$(ls -d "$DSH_HOME"/sessions/*/session-* | head -1)")   # a real sessionId, e.g. session-09d7…
CWD=/path/to/the/session/workspace                          # the dir that holds the file
FILE=$CWD/deck.pptx
Q() { python3 -c 'import urllib.parse,sys;print(urllib.parse.quote(sys.argv[1],safe=""))' "$1"; }

# absolute path  -> 200 (this is what the patched viewer sends)
curl -s -o /dev/null -w '%{http_code}\n' \
  "http://127.0.0.1:$PORT/sidebar/file?sessionId=$SID&path=$(Q "$FILE")&cwd=$(Q "$CWD")" -H 'Host: 127.0.0.1'

# workspace-relative path -> 400 "…is not an absolute path" (this is what the UNPATCHED viewer sent)
curl -s -w ' [%{http_code}]\n' \
  "http://127.0.0.1:$PORT/sidebar/file?sessionId=$SID&path=$(Q deck.pptx)&cwd=$(Q "$CWD")" -H 'Host: 127.0.0.1'
```

**4. In the UI (both open paths)**

Quit and reopen DSH Desktop, then open the same `.pptx`:

| where | expected |
|---|---|
| sidebar file tree | renders (slides, prev/next, download link) |
| chat file mention / presented-file **Preview** card | renders — **this path is the reason Patch B exists** |

If the tree renders and the chat card does not, Patch B is missing.
If neither renders, Patch A is missing (check `harness.log`).

---

## 7. Troubleshooting

| Symptom | Cause | Action |
|---|---|---|
| `ERR_PNPM_UNEXPECTED_STORE`, "pnpm now wants to use the store at …/v11" | a pnpm ≥ 11 on `PATH` answered instead of the desktop's 10.34.5, whose profile is linked to store `v10` | put `<harness>/.desktop-bin` first on `PATH` (rule 2) or install from the Market |
| Same error, and pnpm 11 also warns `The "pnpm" field in package.json is no longer read` | pnpm ≥ 11 ignores `pnpm.overrides`, so the desktop's `link:` pins are silently dropped | never install with pnpm ≥ 11 into a profile; re-run the install through the shim so the generation rows come back |
| "The plugin code could not be loaded…" + recovery card | Patch A missing (or reverted by an update) | `node tools/apply-office-plugin-fixes.mjs`, reopen the app. In the recovery card choose **keep/continue**, never "remove" |
| `plugin failures` in `harness.log` naming `dsh-better-sidebar-plugin-office` | same as above; the JSON field `message` is the real error | read the line, apply the patch |
| Viewer shows `HTTP 400` opening a file from chat but the tree renders | Patch B missing | re-run the patch tool |
| Viewer shows `HTTP 400` for one specific large deck | route limit: `mediaLimit` = 20 MiB → `not a file or too large` | expected behaviour; not a bug to fix in the plugin |
| `403 forbidden` / `path "…" is outside workspace` | the file is outside the session's workspace root | open it in a session whose workspace contains it |
| Plugin absent from `dsh.profile.bundles` | only `dependencies` was edited | install through `dsh plugin add` (it writes the bundle row) |
| App boots but the sidebar/editor surface is gone | better-sidebar failed its own load (version too old for the desktop's pin) | install the exact version the boundary asks for, read `harness.log` |
| Need to isolate a bad plugin | — | **Harness → Restart as Safe Mode…** blocks third-party plugins while keeping sessions/workspaces; the Safe Mode banner removes the culprit |
| Patch disappeared after a Market update | package files were replaced | re-run `tools/apply-office-plugin-fixes.mjs` (idempotent), then reopen the app |
| Windows: `EPERM … rename '…_tmp_…' -> '…'` during install | a handle holds the package directory | use the desktop's own pnpm (its `.desktop-bin/pnpm` shim retries and sidelines blocked renames); the app sweeps leftovers before the next start |

---

## 8. Where everything lives

| Path | What it is |
|---|---|
| `~/Library/Application Support/dsh-desktop/harness` | `DSH_HOME` (macOS). Windows: `%APPDATA%\dsh-desktop\harness` |
| `…/harness/profiles/web` | the `web` profile: `package.json` (bundles, overrides, generation projection), `cordis.yml` (composed tree, regenerated), `cordis.patch.yml` (user patch layer), `.npmrc`, `pnpm-lock.yaml` |
| `…/harness/profiles/.generations/{desired.json,live,staging,trash}` | one directory per pinned plugin version, linked into the profile by `pnpm.overrides` |
| `…/harness/.desktop-bin/{node,pnpm,pnpm-runner.mjs}` | the desktop's bundled Node + pnpm shim (rename-recovery, generation-projection isolation) |
| `…/harness/profiles/web/.dsh-market/` | `state.json` (region, disabled list), `log.ndjson` (install/toggle events), `discovery-compatibility-v1.json` (cached peer/engine facts) |
| `…/harness/sessions/<cwd-slug>/session-*/` | session transcripts (`session.v3.jsonl.zstd`) — useful for reproducing what a user clicked |
| `/Applications/DSH Desktop.app/Contents/Resources/app/node_modules/@deepseek-ai/dsh` | the Harness the app runs (`lib/bin.js` is its CLI) |
| `/Applications/DSH Desktop.app/Contents/Resources/dsh-desktop.patch.yml` | the desktop's own composed patch layer (pass with `--patch` for CLI boots) |
| `~/Library/Logs/DSH Desktop/harness.log` | Harness stdout/stderr: `plugin failures`, `projected generations`, `Harness is ready` |
| `~/Library/Application Support/dsh-desktop/Local Storage/leveldb` | renderer state (sidebar tabs, UI prefs); snappy-compressed, so `strings` finds little |

---

## 9. Re-apply after an update

```bash
node tools/apply-office-plugin-fixes.mjs --check   # exit 1 => re-apply
node tools/apply-office-plugin-fixes.mjs           # writes + verifies
```

Backups land next to the originals as `package.json.dsh-orig-<version>` and
`lib/client.js.dsh-orig-<version>`; delete them once you are happy. The tool
refuses to guess when a release changes shape (no `exports["."]` object, or no
`fileUrl()` builder) and exits 1 with the reason instead of corrupting a bundle.

---

## 10. Fix upstream so this guide can shrink

| Where | Change |
|---|---|
| `@huanlin/dsh-plugin-better-sidebar-plugin-office` | add `default` (or `require`) to `exports["."]` — Patch A becomes unnecessary |
| same plugin, `src/client/urls.ts` | resolve a workspace-relative `path` against `scope.cwd` — Patch B becomes unnecessary |
| `dsh-better-sidebar` host, `/sidebar/file` route | accept a session-relative `path` (resolve against the session cwd like its own client-side `resolveSidebarPath`); fixes its built-in image/PDF viewers for chat-opened files too |
| `@deepseek-ai/dsh` (`dsh-client-ui-deliverables` / chat `openFile`) | absolutize before building a `dsh-resource://` address, or make the address grammar explicitly host-resolved |

Until at least one of the first two lands, Patch A and Patch B stay in this repo.