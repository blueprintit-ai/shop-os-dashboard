// Assembly script for /owner: the one place every Task 9-12 module (grid,
// ring, orb, search, tour) plus this task's own skills-deck/assets-widget
// finally get wired together. Tasks 9-12 each verified their own module by
// invoking it directly from the devtools console precisely because this
// file didn't exist yet.
//
// Corrections versus the brief's own illustrative sketch (every prior
// front-end task in this plan made similar corrections -- see each file's
// own header comment for the deviations local to it):
//
// 1. The chat-bar toggle is wired inside ring.js's own mountRing() (Task 13
//    also modifies ring.js for this), not here -- there is nothing left for
//    boot.js to do for chat beyond letting mountRing(root) run.
// 2. "artifacts:list" is dispatched by ring.js's syncArtifactBalls() (see
//    ring.js), which is reached from its own poll function -- the real name
//    of that function is pullArtifacts(), not the brief's pollArtifacts().
//    boot.js does not need to know that name; it only listens for the event.
// 3. window.showNotesTab is defined here, matching the contract ring.js's
//    own file header already documents ("Task 13's boot.js is expected to
//    define window.showNotesTab, the same pattern public/employee.html
//    already uses") -- the brief's sketch omitted this entirely, which would
//    have left the orb's "no Second Brain" fallback with no tab to switch to
//    beyond its own querySelectorAll fallback (still present in ring.js as a
//    belt-and-suspenders default if this ever failed to load first).
import { getLayout } from "./layout-client.js";
import { mountGrid } from "./widgets.js";
import { kindRenderers } from "./data-widgets.js";
import { mountSkillsDeck } from "./skills-deck.js";
import { mountAssetsFavorites } from "./assets-widget.js";
import { renderStatusWidget } from "./status-widget.js";
import { mountRing } from "./ring.js";
import { mountSearch } from "./search.js";
import { mountTour } from "./tour.js";
import { openNotesPanel } from "./chat-toggle.js";

const layout = await getLayout();
const allKinds = { ...kindRenderers, skills: mountSkillsDeck, assets: mountAssetsFavorites, status: renderStatusWidget };

mountRing(document.getElementById("ring-root"));
mountGrid(document.getElementById("widgets-root"), layout, allKinds);

// ring.js dispatches "artifacts:list" (detail: the artifact array) right
// after each poll updates the ball positions -- search.js reads it lazily
// through this closure instead of doing a second /api/artifacts fetch.
let lastArtifacts = [];
window.addEventListener("artifacts:list", (e) => { lastArtifacts = e.detail; });
mountSearch(document.body, () => lastArtifacts);

mountTour(layout);

document.getElementById("editBtn")?.addEventListener("click", () => document.body.classList.toggle("edit"));

// Same contract as public/employee.html's own window.showNotesTab: give the
// orb's note-viewer fallback (ring.js, when no Second Brain answers)
// somewhere to land.
//
// Post-review fix (finding 7): the previous version only flipped
// [data-tab-panel] visibility on #chat-root/#notes-root, unlike
// chat-toggle.js's CHAT button which also hides #ring-root/#widgets-root
// (both are position:fixed and would otherwise stay drawn on top of the
// note viewer) -- and it had no exit path back to the ring at all. This now
// routes through chat-toggle.js's own 3-state panel manager (ring/chat/
// notes) so opening notes hides the ring+widgets the same way opening chat
// does, and the same CHAT/CLOSE button that is already on screen becomes
// the way back to the ring view.
window.showNotesTab = () => {
  openNotesPanel();
};
