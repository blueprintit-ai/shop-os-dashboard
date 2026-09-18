# NOTICE

Shop OS Dashboard (this package) includes, starting with Plan 2, a modified version of **Rubric Agentic OS**.

- Original work: Rubric Agentic OS
- Original author: Jay E | RoboNuggets, https://skool.com/robonuggets
- License: Creative Commons Attribution 4.0 International (CC BY 4.0)
  https://creativecommons.org/licenses/by/4.0/ (full text in LICENSE)
- Modified by: Blueprint IT (https://blueprintit.ai), 2026

## Changes made

This copy has been changed from the original. Changes include, but are not
limited to:

- Rebuilding the ring-and-widgets owner dashboard as a dedicated `/owner`
  page (`public/owner.html`, `public/css/owner.css`, `public/js/owner/*`)
  inside this project's own module structure instead of the kit's single
  inline-script file, and rebranding the title widget and theme colors to
  Blueprint IT / Shop OS.
- Google Calendar and email-triage widgets removed entirely — not carried
  over, not disabled behind a flag.
- Layout and theme moved server-side: widget positions and the light/dark
  choice are saved per user via `PUT /api/layout` (`src/layout.js`) and
  rendered into the page server-side (no `localStorage`, no flash-of-wrong-theme
  on load), replacing the kit's client-only `localStorage` persistence.
- The skills runner (`src/runs.js`) rebuilt on the Claude Agent SDK's
  `query()` instead of spawning a shell command — see
  `docs/decisions/headless-skill-runner.md`.
- Artifact visibility scoping added: each generated artifact carries an
  owner/staff visibility flag (`src/artifacts.js`), and staff only ever see
  an artifact when both the file is marked `staff`-visible and their own
  account has the `artifactsShared` switch on.
- Added a Business Assets browser (`assets.html`, `/api/assets*`), a Claude
  Code chat bar and run history, and moved the assets folder configuration
  from the kit's `os-config.json` to this project's own `src/settings.js`,
  owner-configurable at runtime via `/api/settings` instead of a static
  config file.

`REDESIGN.md` is carried over from the original kit's reskin-contract
document, updated for this project's own file names and palette. The full
CC BY 4.0 license text is preserved in LICENSE.

## Attribution in the product

The running dashboard credits the original author on the final card of the
info tour (the "i" icon in the title widget). Do not remove that card or this
file; both are required to stay in compliance with CC BY 4.0.

## No endorsement

RoboNuggets and Jay E do not endorse Blueprint IT or Shop OS. Use of the
original work under CC BY 4.0 does not imply any affiliation.

## Other vendored code

`vendor/thinking-orbs.js` is MIT-licensed, (c) Jakub Antalik, used unmodified — see the file's own header.
