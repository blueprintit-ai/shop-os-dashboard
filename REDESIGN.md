# REDESIGN.md - make it look like YOURS

This OS has been reskinned end-to-end more than once - a buttoned-up corporate look for one build, something completely different for another - without touching a single feature. Same bones, wildly different skin, every time. This guide is how.

## Where the look lives

1. **CSS tokens** - the `:root` block at the very top of `public/css/owner.css`:
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
3. **Stragglers** - a handful of inline SVG strings keep hardcoded colors (the hex logo in the title, the sun/moon icons, a few rgba fades). Search `public/owner.html` and `public/css/owner.css` for `#1c6ea4` after a reskin to catch them.
4. **Fonts** - the Google Fonts link in `<head>` plus the `font:` shorthands. Changing the display font changes the personality faster than any color.

## The redesign prompt (paste to your agent)

> Redesign my Agentic OS (`public/owner.html` + `public/css/owner.css`) into a completely new visual direction while changing ZERO functionality.
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
