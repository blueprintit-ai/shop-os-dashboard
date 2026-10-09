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

The script applies only the named, anchored rules in `RULES` (fonts to `public/css/kit-fonts.css`, three.js importmap to the vendored build, `API` base to same-origin, title and heading to the shop name + Blueprint OS, the account popover to the product's own account rows, `/static/` asset paths, plus small mechanical rules: no personal address in the inbox link, open documents in the viewer instead of a server-side shell open, SHOP APPS rows read from `Dashboard/apps.json` via `/api/apps` (default: Second Brain only; the Second Brain fallback is the product's `/notes`), the widget library's agent prompts describing the installed package and vault instead of the kit folder, and `public/js/product-extras.js` loaded last for the product's Users link, status dot and Update control on the kit toolbar). Product-only pages around it: `/users` (people, Business Assets folder setting, phone QR), `/notes`, and a license page served instead of the kit pages when the license check fails. It fails loudly if a kit change moves an anchor; update the rule then. The kit's server API is implemented for the page by `src/routes/kit-compat-routes.js`.

Everything below describes the kit's own reskin contract; read `public/owner.html` as "the kit's `dashboard.html`" and make the edit upstream.

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
