# Decision: no Git, no admin/sudo, no WinGet/Homebrew in the installer

Shop OS Chat's installer (`shop-os-installer`) requires Git (to clone two
plugin marketplaces), WinGet or Homebrew (to install Node.js), and — on a
machine without WinGet already present — occasionally an admin relaunch.
None of that is available or comfortable on every small-business owner's
computer, and the design spec (Section 5) commits to removing all of it.

## What replaced what

| Removed | Replacement | Where |
|---|---|---|
| `git clone`/`git fetch` for marketplaces | GitHub codeload tarball over `fetch`, extracted by a hand-rolled USTAR reader | `installer/tar.js`, `installer/marketplaces.js` |
| WinGet/Homebrew/MSI for Node.js (first contact, no Node exists yet) | Native shell tools: PowerShell's `Expand-Archive` for the Windows Node `.zip`, `tar` (bundled since Windows 10 1803, and on every macOS) for the `.tar.gz` builds | `installer/run-setup.ps1`, `installer/run-setup.sh` |
| Re-resolving Node once the dashboard is already running under Node | The same system-or-download logic, in-process, with injectable `fetch`/`spawnSync` for tests | `installer/node-runtime.js` |
| Admin relaunch for WinGet | Not needed — nothing left requires elevation | n/a |

## Two Node-acquisition paths, on purpose

`run-setup.ps1`/`run-setup.sh` cannot call `installer/node-runtime.js` — it's
Node code, and nothing can run it until *some* Node already exists. So the
very first bootstrap does its own minimal version of the same "system Node
≥20, else download" check in native shell, using tools the OS already ships.
`node-runtime.js`'s more careful, fully-tested version is for every use
*after* that point: the running dashboard process, and anything that invokes
`bin/shop-os-dashboard-setup.js` through a context that already guarantees a
Node (`npx`, for instance). The duplication is small and deliberate, not
missed refactoring — see Task 9 in the implementation plan for the full
reasoning.

## Why hand-rolled tar/zip readers instead of a dependency (in-process use)

Once Node is running, `installer/marketplaces.js` and `installer/node-runtime.js`
still can't reach for an npm package to extract an archive — a runtime
dependency isn't available yet to fetch a dependency with. The formats
themselves are small and stable (USTAR, ZIP local/central headers);
`shop-os-license-server`'s `buildZipWithExecutable` already hand-rolls a ZIP
*writer* for the same class of reason, this is the same tradeoff in reverse.
The shell-level bootstrap above doesn't have this problem at all — it uses
the OS's own `tar`/`Expand-Archive` directly, no hand-rolled code needed.
