# REDESIGN.md - make it look like YOURS

This OS has been reskinned end-to-end more than once - a buttoned-up corporate look for one build, something completely different for another - without touching a single feature. Same bones, wildly different skin, every time. This guide is how.

## The owner page is synced from the kit - read this first

`public/owner.html`, `public/widgets.html`, `public/assets.html` and `public/vendor/thinking-orbs.js` are **generated** from the RoboNuggets kit (the `agentic-os` folder; its location is not baked into the repo) by `tools/sync-kit.mjs`. Do not hand-edit them: `test/kit-parity.test.js` fails when the committed files differ from a fresh sync. To change the look or behavior, change it in the kit and re-sync:

```bash
node tools/sync-kit.mjs <kit-folder>          # or set KIT_DIR; required, there is no default path
node tools/sync-kit.mjs --check <kit-folder>  # exit 1 if the committed files are out of sync
KIT_DIR=<kit-folder> node --test test/kit-parity.test.js  # parity, "only the named rules differ", "kit has not moved on"
node --test test/kit-lock.test.js             # always on, no kit needed: tools/sync-kit.lock.json pins sha256 of the raw kit inputs,
                                              # the generated pages and the rule set; a hand edit or an un-synced rule change fails
```

The script applies only the named, anchored rules in `RULES` (fonts to `public/css/kit-fonts.css`, three.js importmap to the vendored build, `API` base to same-origin, title and heading to the shop name + Blueprint OS, `/static/` asset paths, plus small mechanical rules: no personal address in the inbox link, open documents in the viewer instead of a server-side shell open, SHOP APPS rows read from `Dashboard/apps.json` via `/api/apps` (default: Second Brain only; the Second Brain fallback is the product's `/brain`), the widget library's agent prompts describing the installed package and vault instead of the kit folder, `public/js/product-extras.js` loaded last for the product's Users link, status dot, Update control and Log out icon on the kit toolbar, and the removal of the kit's bottom chat bar). Chat bar removal (rule group (e), owner's request; the deployed owner page has no in-page chat): `chatbar-css`, `chatlog-css` (the bar, transcript panel, popover and dark-mode chat CSS), `chatbar-html` (#chatLog, #chatBar), `acctpop-html` (#acctpop), `chatbar-js` (window.CHATCFG and the /api/chat client) and `acctpop-js` (the popover script) cut the whole bar, each as one anchored between-rule that leaves a one-line comment marker; `restorebar-bottom` moves the edit-mode "restore widgets" chip from 76px to 24px now that nothing sits at the bottom. The kit's layout math already used the full window height (`ROWS` from `H`), so the bottom edge is usable with no further change, and the kit has no other reference to the removed ids, so nothing is left to throw. This replaced the older `acct-popover-html`, `acct-popover-js` and `edit-mode-chatbar-passthrough` rules (the popover and the bar they patched are gone). Log out lives in `public/js/product-extras.js` (icon after the status dot, owner only: staff are redirected to /employee and never load this page). Product-only pages around it: `/users` (people, Business Assets folder setting, phone QR), `/notes`, and a license page served instead of the kit pages when the license check fails. It fails loudly if a kit change moves an anchor; update the rule then. The kit's server API is implemented for the page by `src/routes/kit-compat-routes.js`.

Everything below describes the kit's own reskin contract; read `public/owner.html` as "the kit's `dashboard.html`" and make the edit upstream.

## The Second Brain page (`/brain`) is synced from its own kit

`public/brain.html` and `public/brain/_core.js`, `_core.css`, `_flows2.js`, `_icons.js` are **generated** from the RoboNuggets `second-brain` kit (a modified Rubric Second Brain, CC BY 4.0; its `public/` folder; location not baked into the repo) by `tools/sync-brain.mjs`. It is a separate module with its own rule list and its own lock, so it never conflicts with `tools/sync-kit.mjs`. Do not hand-edit the generated files; change the kit and re-sync:

```bash
node tools/sync-brain.mjs <kit-folder>          # or set BRAIN_KIT_DIR; required, there is no default path
node tools/sync-brain.mjs --check <kit-folder>  # exit 1 if the committed files are out of sync
BRAIN_KIT_DIR=<kit-folder> node --test test/brain-parity.test.js  # fresh sync == committed; only the named rules differ; kit not moved on
node --test test/brain-lock.test.js             # always on, no kit needed: tools/sync-brain.lock.json pins sha256 of the raw kit inputs,
                                                # the generated files and the rule set
```

The kit folder is the second-brain root (it holds `public/index.html`). The kit files use CRLF; the sync normalizes text to LF first (the lock hashes the raw bytes). Only the kit's `public/` page files are used. The rules (`RULES` in the tool, each anchored to exact kit text, the sync fails loudly when an anchor moves or a replaced span exceeds its byte cap): Google Fonts to `public/css/brain-fonts.css` (Outfit and Source Serif 4 italic, local woff2); the d3 and marked CDN scripts to `/static/vendor/d3.min.js` and `marked.min.js`, plus `/static/js/brain-safe.js` (the viewer sanitizer); relative asset paths to `/static/brain/`; one rule per kit API literal, `/api/...` to `/api/brain/...` (graph, expand x2, tweak x3, file, bake, rescan, graph reload, search; `open` is inside the open rule); the title and HUD subtitle to the shop name (`__SHOP_NAME__`, `__BRAIN_TAGLINE_JS__`, filled by `src/routes/pages.js`); the brand word to BLUEPRINT OS; the DASHBOARD button to `/owner`; Open to the notes viewer URL instead of a server-side shell open; Copy path without the kit author's drive prefix; the viewer's markdown output through `brainSafeHtml`; no runtime icon-CDN fetch; and the kit author's own icon set in `_icons.js` emptied (the baked brand paths stay).

The kit's `server.js` and `scan.js` are not used (and `brain.js`, its recall CLI, is out of scope). The product implements the same JSON in `src/routes/brain-routes.js` on `src/brain/` (`scan.js` the walker/graph builder with caps, `store.js` the cache + tweaks + bake, `files.js` the confined file reader, `skills.js` the Skills ring source, `defaults.js` the Blueprint OS departments). The map's departments follow the vault folders; to adjust them, add `Dashboard/brain/departments.json` (`departments`, `pathRules`, `default`, same shape as the kit's config; invalid rows are dropped). Tweaks (Remove/Edit) are stored in `Dashboard/brain/tweaks.json`, Bake in `Dashboard/brain/bake.json`.

## Where the look lives

1. **CSS tokens** - the `:root` block at the very top of the page's `<style>`:
   ```css
   :root { --accent:#1c6ea4; --cream:#e8e2d2; --mute:#8d8775; --warm:#b9b19c;
           --bg:#141310; --panel:#0d0c09; }
   ```
   Accent, text, muted text, background, panel. Swap these six values and 90% of the OS follows.
2. **The JS THEME block** - right above `const ICS` in the script. Canvas drawings (clock hands, pixel sprites, sparks) cannot read CSS variables, so they take their colors here:
   ```js
   const THEME = { accent:'#1c6ea4', cream:'#e8e2d2', mute:'#8d8775', warm:'#b9b19c' };
   ```
   Keep it in sync with the CSS tokens.
3. **Stragglers** - a handful of inline SVG strings keep hardcoded colors (the hex logo in the title, the sun/moon icons, a few rgba fades). Search the page for `#1c6ea4` after a reskin to catch them.
4. **Fonts** - the font link in `<head>` (served locally from `public/css/kit-fonts.css` here) plus the `font:` shorthands. Changing the display font changes the personality faster than any color.

## The redesign prompt (paste to your agent)

> Redesign my Agentic OS (`dashboard.html`) into a completely new visual direction while changing ZERO functionality.
>
> First, secretly consider three candidate directions that have nothing in common with the current look or with each other - different palette temperature, different type personality, different texture (flat / glass / paper / terminal). Pick the strongest, then commit fully.
>
> Rules: work through the :root tokens and the JS THEME block first, then the fonts, then any stragglers. Do not touch layout logic, APIs, widget behavior, or ids. Every widget must stay readable at its current size - check contrast on the muted text especially. When done, open the page, check the console for errors, screenshot it, and look at the screenshot before declaring victory. Then tell me the name of the direction you chose in one line.

Ask for "three options as screenshots first" if you want to pick the direction yourself.

## Principles that survived our reskins

- **Direction beats decoration.** One committed direction (terminal, editorial, botanical, brutalist) reads instantly; a palette swap alone reads as the same OS in a different shirt.
- **The accent is a budget.** One accent color, spent on the few things that matter (the next routine, the running skill, the selected thing). Spend it everywhere and the board goes noisy.
- **Muted text carries the design.** Most of the OS is labels. If `--mute` fails contrast on `--bg`, everything feels broken no matter how pretty the accent is.
- **Type first, then color.** The display font sets the personality; colors season it.
- **Keep the bones.** The layout grid, widget chrome and ring interactions took many iterations to feel right. Reskin, don't re-architect - your future self keeps getting upstream improvements that way.

## Staff chat shortcut (host icon and shareable link)

Staff open the dashboard from their own computers over the shop network, so the owner gets two things. (1) The installer's dashboard step writes a second desktop icon next to the owner one: `createDesktopShortcut` / `createDesktopApp` take an optional name and extra args, and the staff icon is "Blueprint OS Staff Chat" with `--open /employee` (Windows: Arguments `"<dashboardBin>" "<vault>" --open /employee`; Mac: its own bundle id `ai.blueprintit.shop-os-dashboard.staff-chat`). `--open` is validated by `src/lib/open-path.js` and carried through `decideStartup`, so a second launch attaches to the running instance and opens `/employee` there. A failure to make the staff icon is a warning in the same `problems` list as the owner icon. The CI assert script requires both icons. (2) `GET /api/users/staff-shortcut?format=url|webloc|bookmark` (owner only, license-exempt like the rest of `/api/users`) downloads a file pointing at `http://<best LAN address>:<port>/employee`; the address list comes from the same function as `/api/status`'s `lan`, so the page and the file agree. The section lives in `public/js/staff-chat.js`, mounted by `public/js/users-extras.js`. The owner opening `/employee` sees the staff page too (a preview); `src/routes/pages.js` is unchanged.
