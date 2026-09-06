// Ring: canvas ring background, artifact-ball physics/slotting, right-click
// context menu, and the 3D orb portal.
//
// Ported from Robonuggets/agentic-os/dashboard.html:
//   - RS ring-state constants ................ dashboard.html:961-968
//   - ring rail draw (rail()) ................. dashboard.html:1792-1813
//   - per-frame ball physics (frame()) ........ dashboard.html:1866-1992
//   - assignSlots() / syncArtifactBalls() ..... dashboard.html:3132-3185
//   - artifact icon/category tables ........... dashboard.html:3108-3125
//   - ball right-click context menu ........... dashboard.html:1616-1667
//   - orb-core click -> Second Brain .......... dashboard.html:1361, 1692-1699, 3311-3320
//   - Second Brain reachability probe ......... dashboard.html:3960-3966
//   - 3D orb portal (three.js particles) ...... dashboard.html:3483-3736 (<script type="module">)
//
// Deliberately NOT ported (see owner.css's own header comment for the
// project-wide exclusion list this task inherits): the 32-col widget grid /
// edit mode / drag-resize (Task 9 owns that), the info ball + hover "chip
// burst" (tied to the kit's spotlight tour, out of scope here), the GLYPH
// demo spawn-balls (inbox/routine/skill/mail placeholders - those source
// features don't exist in this project, only real artifacts do), the
// iframe Second Brain "singularity" portal transition and #brainWrap iframe
// embed (owner.css already excludes #brainWrap/#portal/#sgFx), the OS Tweak
// dial panel, the orb spin-reward quote card, and - per this project's
// global constraint - the Skool classroom fallback link the kit opened at
// dashboard.html:3318 when no Second Brain answered. That branch is gone
// entirely here: no Second Brain means the orb opens the note viewer, full
// stop (see the design spec, "Section 3: The note viewer" / the orb line).
//
// mountRing(root) is the only export. Nothing else in this project reaches
// into ring.js's internals; it owns its own canvas/DOM and polls
// /api/artifacts on its own timer.

import { api, toast } from "/static/js/api.js";
import { mountChatToggle } from "./chat-toggle.js";

const POLL_MS = 15000;
const BRAIN_URL = "http://localhost:5210";
const THREE_URL = "/static/vendor/three.module.min.js";

/* ---- Jay's baked ring settings (dashboard.html:961-968, values unchanged) ---- */
const RS = {
  ring: 316, size: 48, gap: 0,
  grav: 12, restDeg: -96, fric: .992, bounce: .5, settle: .79,
  passes: 2, fling: 1.15, maxFling: 4.5,
  ballFill: 1, ballRing: .18, glyphIn: 27,
};

/* ---- artifact icon glyphs + category ember colors (dashboard.html:3108-3125, ported as-is) ---- */
const CATCOL = {
  writing: { hot: "199,127,224", soft: "228,196,242" },
  frontend: { hot: "255,130,40", soft: "255,220,160" },
  infographic: { hot: "127,196,232", soft: "205,231,245" },
  other: { hot: "232,226,210", soft: "246,243,235" },
};
const ART_GLYPH = {
  deck: '<rect x="8" y="12" width="32" height="22" rx="3"/><path d="M24 34v6M16 40h16"/>',
  report: '<rect x="12" y="7" width="24" height="34" rx="3"/><path d="M18 17h12M18 24h12M18 31h7"/>',
  dash: '<rect x="7" y="10" width="34" height="28" rx="3"/><path d="M7 20h34M20 20v18"/>',
  mail: '<rect x="9" y="12" width="30" height="24" rx="3"/><path d="M9 15l15 12 15-12"/>',
  video: '<rect x="7" y="12" width="34" height="24" rx="4"/><path d="M20 19l11 5-11 5z"/>',
  chart: '<path d="M10 38V20M20 38V12M30 38V26M40 38V16"/><path d="M6 42h36"/>',
  visual: '<circle cx="24" cy="24" r="14"/><circle cx="24" cy="24" r="5"/><path d="M24 10v6M24 32v6"/>',
  bolt: '<path d="M27 6L14 28h9l-3 14 14-22h-9z"/>',
  doc: '<path d="M14 6h14l8 8v28H14z"/><path d="M28 6v8h8"/><path d="M19 24h10M19 31h10"/>',
};

const sr = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
const wrap = (a) => { while (a > Math.PI) a -= 2 * Math.PI; while (a < -Math.PI) a += 2 * Math.PI; return a; };

/* ---- sidecar SVG is agent-writable content (src/artifacts.js's meta.svg,
   sourced from a JSON sidecar an agent run can write into
   <vault>/Dashboard/artifacts/), not trusted input - <script>/<foreignObject>
   won't execute via innerHTML but SVG event attributes and javascript: URLs
   will, so strip those constructs before assigning to innerHTML. An empty
   result falls back to the built-in glyph table (see syncArtifactBalls()). ---- */
function sanitizeArtifactSvg(svg) {
  if (!svg) return svg;
  if (/<script|<foreignObject/i.test(svg)) return "";
  if (/\son\w+\s*=/i.test(svg)) return "";
  if (/href\s*=\s*["']?\s*javascript:/i.test(svg)) return "";
  return svg;
}

/* created-stamp formatter (dashboard.html:1606-1614, ported as-is) */
function fmtCreated(iso) {
  const d = new Date(iso);
  if (isNaN(d)) return "";
  let h = d.getHours() % 12 || 12;
  const ap = d.getHours() >= 12 ? "pm" : "am";
  return d.toLocaleString("en-AU", { month: "short" }) + d.getDate() + " - " + h + ":" + String(d.getMinutes()).padStart(2, "0") + ap;
}

export function mountRing(root) {
  // Idempotent: a repeat mountRing(root) call (the brief's own devtools
  // verification recipe) tears down the previous instance's timers/rAF/
  // listeners first instead of stacking a second ring on top.
  root.__ringTeardown?.();

  const LIGHT = document.documentElement.classList.contains("light");
  root.innerHTML = `<canvas id="ringCv"></canvas><div id="orbBox"></div><div id="tip" hidden><div class="t1"></div><div class="t2"></div></div>`;
  const ringCv = root.querySelector("#ringCv");
  const orbBox = root.querySelector("#orbBox");
  const tip = root.querySelector("#tip");
  const ringGx = ringCv.getContext("2d");

  const teardown = { timers: [], raf: null, listeners: [], stopped: { value: false } };
  const on = (target, type, fn, opts) => { target.addEventListener(type, fn, opts); teardown.listeners.push([target, type, fn, opts]); };
  root.__ringTeardown = () => {
    teardown.timers.forEach(clearInterval);
    if (teardown.raf) cancelAnimationFrame(teardown.raf);
    teardown.stopped.value = true; // stops the three.js orb's own rAF loop, if one was built
    teardown.listeners.forEach(([t, ty, fn, opts]) => t.removeEventListener(ty, fn, opts));
    root.__ringTeardown = null;
  };

  /* ---- geometry: ring is desktop-only (see design spec) and viewport-centered -
     mountRing(root) takes no layout/position argument (see the file header),
     so the orb sits at the middle of the viewport rather than reading the
     32-col grid's saved orb.c/orb.r (that integration is out of this task's
     contract). A modest clamp keeps it from overflowing small windows. ---- */
  const ringScale = () => Math.max(.5, Math.min(1, Math.min(innerWidth, innerHeight) / 900));
  const orbCX = () => innerWidth / 2;
  const orbCY = () => innerHeight / 2;
  const RINGpx = () => RS.ring * ringScale();
  const ballSize = () => RS.size * ringScale();
  const REST = () => (RS.restDeg * Math.PI) / 180;

  /* ================= balls ================= */
  let balls = [];
  let ballSeq = 0;
  let ringAsleep = false, ringCalm = 0;
  function wakeRing() { ringAsleep = false; ringCalm = 0; }

  function makeBall() {
    const el = document.createElement("div");
    el.className = "oi";
    const seed = ballSeq++;
    el.innerHTML = `<canvas></canvas><svg viewBox="0 0 48 48" style="inset:${RS.glyphIn}%"></svg>`;
    root.appendChild(el);
    const b = {
      el, born: Date.now(),
      a: REST() + (Math.random() - .5) * .3, w: (Math.random() - .5) * 2, drag: false,
      micv: el.querySelector("canvas"),
      embers: Array.from({ length: 8 }, (_, j) => ({
        x: sr(seed * 31 + j) * 2 - 1, y: sr(seed * 31 + j + 40),
        v: .09 + sr(seed * 31 + j + 80) * .1,
        sway: sr(seed * 31 + j + 120) * 6.28, sz: .9 + sr(seed * 31 + j + 160) * 1.2,
      })),
    };
    balls.push(b);
    return b;
  }

  function syncBallSizes() {
    const D = ballSize();
    balls.forEach((b) => {
      b.el.style.width = D + "px"; b.el.style.height = D + "px";
      b.micv.width = D * 2; b.micv.height = D * 2;
      b.micv.style.width = D + "px"; b.micv.style.height = D + "px";
    });
  }

  /* ---- SLOTS: newest-first, packed counterclockwise from 3 o'clock, aging
     over the top/down the left/around the bottom (dashboard.html:3161-3185).
     The kit reserves slot 0 for its "info ball"; this project has no info
     ball, so the newest artifact itself takes 3 o'clock. ---- */
  function assignSlots() {
    const D = ballSize();
    const sepRad = 2 * Math.asin(Math.min(.9, (D / 2 + RS.gap) / RINGpx()));
    const cap = Math.max(3, Math.floor((2 * Math.PI) / sepRad));
    balls.forEach((b, i) => {
      if (i < cap) {
        b.hidden = false;
        b.el.style.display = "";
        b.slotA = wrap(-i * sepRad);
        b.a = wrap(b.slotA + (Math.random() - .5) * .05);
        b.w = 0;
      } else {
        b.hidden = true;
        b.el.style.display = "none";
        b.slotA = undefined;
      }
    });
  }

  /* ---- ARTIFACTS: every HTML in Dashboard/artifacts becomes a ball
     (dashboard.html:3126-3159, ported unchanged in shape - the kit always
     fully rebuilds the ball list on each poll rather than diffing). ---- */
  function syncArtifactBalls(list) {
    balls.forEach((b) => b.el.remove());
    balls.length = 0;
    list.forEach((a) => {
      const b = makeBall();
      b.artifact = a;
      b.cc = CATCOL[a.category] || CATCOL.other;
      b.el.querySelector("svg").innerHTML = sanitizeArtifactSvg(a.svg) || ART_GLYPH[a.icon] || ART_GLYPH.doc;
      const now = new Date(), cr = new Date(a.created || a.modified);
      const days = Math.max(0, Math.round(
        (Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) -
         Date.UTC(cr.getFullYear(), cr.getMonth(), cr.getDate())) / 864e5
      ));
      b.ageFrac = Math.max(.04, 1 - days / 30);
      b.w = 0;
    });
    assignSlots();
    syncBallSizes();
    wakeRing();
    // Task 13: broadcast the fresh list so search.js always has the current
    // artifacts without a second fetch of its own (see boot.js).
    window.dispatchEvent(new CustomEvent("artifacts:list", { detail: list }));
  }

  async function pullArtifacts() {
    try {
      const res = await api("GET", "/api/artifacts");
      if (!res.ok) return;
      const data = await res.json();
      syncArtifactBalls(data.artifacts || []);
    } catch { /* server unreachable this tick - keep showing the last-known ring */ }
  }

  /* ================= ring rail (static; redrawn on mount + resize only) ================= */
  function drawRail() {
    const DPR = Math.min(devicePixelRatio || 1, 2);
    ringCv.width = innerWidth * DPR; ringCv.height = innerHeight * DPR;
    ringCv.style.width = innerWidth + "px"; ringCv.style.height = innerHeight + "px";
    ringGx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ringGx.clearRect(0, 0, innerWidth, innerHeight);
    const D = ballSize();
    const BW = D + RS.gap * 2 + 12 * ringScale();
    const cx = orbCX(), cy = orbCY(), r = RINGpx();
    const RC = LIGHT
      ? { base: "rgba(12,30,47,.10)", inner: "rgba(12,30,47,.16)", outer: "rgba(255,255,255,.55)" }
      : { base: "rgba(0,0,0,.35)", inner: "rgba(0,0,0,.45)", outer: "rgba(232,226,210,.10)" };
    ringGx.strokeStyle = RC.base; ringGx.lineWidth = BW;
    ringGx.beginPath(); ringGx.arc(cx, cy, r, 0, Math.PI * 2); ringGx.stroke();
    ringGx.strokeStyle = RC.inner; ringGx.lineWidth = BW * .42;
    ringGx.beginPath(); ringGx.arc(cx, cy, r - BW * .22, 0, Math.PI * 2); ringGx.stroke();
    ringGx.strokeStyle = RC.outer; ringGx.lineWidth = BW * .3;
    ringGx.beginPath(); ringGx.arc(cx, cy, r + BW * .18, 0, Math.PI * 2); ringGx.stroke();
  }

  /* ================= physics + per-ball canvas draw (dashboard.html:1866-1992) ================= */
  function tickPhysics(dt) {
    const N = balls.length;
    const rest = REST();
    const D = ballSize();
    const sep = 2 * Math.asin(Math.min(.9, (D / 2 + RS.gap) / RINGpx()));
    if (!ringAsleep) {
      balls.forEach((b) => {
        if (b.drag || b.hidden) return;
        b.w += RS.grav * Math.sin((b.slotA !== undefined ? b.slotA : rest) - b.a) * dt;
        b.w *= RS.fric;
        const nearPile = Math.abs(wrap(b.a - (b.slotA !== undefined ? b.slotA : rest))) < sep * 2;
        if (nearPile) {
          if (Math.abs(b.w) < .015) b.w *= RS.settle;
          else if (Math.abs(b.w) < .5) b.w *= .958;
        }
        b.a = wrap(b.a + b.w * dt);
      });
      for (let pass = 0; pass < RS.passes; pass++) {
        for (let i = 0; i < N; i++) for (let j = i + 1; j < N; j++) {
          const A = balls[i], B = balls[j];
          if (A.hidden || B.hidden) continue;
          const d = wrap(B.a - A.a);
          if (Math.abs(d) < sep) {
            const push = ((sep - Math.abs(d)) / 2) * Math.sign(d || 1);
            if (!A.drag) A.a = wrap(A.a - push);
            if (!B.drag) B.a = wrap(B.a + push);
            const rel = B.w - A.w;
            if ((d > 0 && rel < 0) || (d < 0 && rel > 0)) {
              const imp = (rel * (1 + RS.bounce)) / 2;
              if (!A.drag) A.w += imp;
              if (!B.drag) B.w -= imp;
            }
          }
        }
      }
      let maxMove = 0;
      balls.forEach((b) => {
        if (b.hidden) return;
        if (b.pa !== undefined) maxMove = Math.max(maxMove, Math.abs(wrap(b.a - b.pa)));
        b.pa = b.a;
      });
      if (!balls.some((b) => b.drag) && maxMove < .0022) ringCalm++;
      else ringCalm = 0;
      if (ringCalm > 36) {
        ringAsleep = true;
        balls.forEach((b) => { if (!b.hidden) b.w = 0; });
      }
    } else {
      balls.forEach((b) => {
        if (b.slotA === undefined || b.drag || b.hidden) return;
        const d = wrap(b.slotA - b.a);
        b.a = Math.abs(d) < .001 ? b.slotA : wrap(b.a + d * Math.min(1, dt * 6));
      });
    }
  }

  function drawBalls(t) {
    const D = ballSize();
    balls.forEach((b) => {
      if (b.hidden) return;
      const x = orbCX() + Math.cos(b.a) * RINGpx();
      const y = orbCY() + Math.sin(b.a) * RINGpx();
      b.el.style.transform = `translate(${x - D / 2}px,${y - D / 2}px)`;
      const mg = b.micv.getContext("2d");
      mg.setTransform(2, 0, 0, 2, 0, 0);
      mg.clearRect(0, 0, D, D);
      const c = D / 2, R = D / 2 - 2;
      mg.fillStyle = LIGHT ? `rgba(255,253,247,${RS.ballFill})` : `rgba(19,19,17,${RS.ballFill})`;
      mg.beginPath(); mg.arc(c, c, R, 0, Math.PI * 2); mg.fill();
      const rim = LIGHT ? "12,30,47" : "232,226,210";
      mg.strokeStyle = `rgba(${rim},${LIGHT ? Math.max(.45, RS.ballRing) : RS.ballRing})`;
      mg.lineWidth = 1.4;
      mg.beginPath(); mg.arc(c, c, R, 0, Math.PI * 2); mg.stroke();
      if (b.ageFrac !== undefined) {
        mg.strokeStyle = LIGHT ? "rgba(12,30,47,.55)" : "rgba(232,226,210,.55)";
        mg.lineWidth = 1.8;
        mg.beginPath(); mg.arc(c, c, R, -Math.PI / 2, -Math.PI / 2 + Math.PI * 2 * b.ageFrac); mg.stroke();
      }
      const cc = b.cc || CATCOL.other;
      b.embers.forEach((e) => {
        e.y -= e.v * .016;
        if (e.y < -.02) { e.y = 1.02; e.x = sr(e.sway * 91 + Math.floor(t)) * 2 - 1; }
        const ex = c + (e.x * .8 + Math.sin(t * .7 + e.sway) * .12) * R * .82;
        const ey = c + (e.y * 2 - 1) * R * .66;
        const fade = Math.max(0, Math.min(1, Math.min(e.y * 4, (1 - e.y) * 2.6)));
        const s = e.sz * (D / 95) * 2.1 * (.7 + e.y * .4);
        mg.fillStyle = `rgba(${cc.hot},${.92 * fade})`;
        mg.fillRect(ex - s / 2, ey - s / 2, s, s);
      });
    });
  }

  let lastFrameT = performance.now();
  function frame(now) {
    const dt = Math.min(.04, (now - lastFrameT) / 1000);
    lastFrameT = now;
    tickPhysics(dt);
    drawBalls(now / 1000);
    teardown.raf = requestAnimationFrame(frame);
  }

  /* ================= pointer: drag/fling + hover tooltip (dashboard.html:1669-1729, trimmed:
     no artifact-detail popup modal exists in this project's markup, so a plain click opens
     the artifact directly - the context menu's OPEN action does the same thing) ================= */
  let bDrag = null, bMoved = false, lastAng = 0, lastT = 0;
  on(document, "pointerdown", (e) => {
    const el = e.target.closest(".oi");
    if (!el || e.button === 2) return;
    bDrag = balls.find((b) => b.el === el);
    if (!bDrag) return;
    wakeRing();
    bMoved = false;
    bDrag.sx = e.clientX; bDrag.sy = e.clientY;
    lastAng = bDrag.a; lastT = performance.now();
    e.preventDefault();
  });
  on(document, "pointermove", (e) => {
    if (bDrag) {
      if (!bMoved && Math.hypot(e.clientX - bDrag.sx, e.clientY - bDrag.sy) < 5) return;
      bMoved = true;
      bDrag.drag = true; bDrag.el.classList.add("drag");
      const na = Math.atan2(e.clientY - orbCY(), e.clientX - orbCX());
      const now = performance.now(), dt2 = Math.max(8, now - lastT) / 1000;
      bDrag.w = (wrap(na - lastAng) / dt2) * .5 + bDrag.w * .5;
      lastAng = na; lastT = now;
      bDrag.a = na;
      return;
    }
    const el = e.target.closest(".oi");
    if (el) {
      const b = balls.find((x) => x.el === el);
      if (b?.artifact) {
        tip.querySelector(".t1").textContent = b.artifact.title;
        tip.querySelector(".t2").textContent = fmtCreated(b.artifact.created || b.artifact.modified);
        tip.style.left = Math.min(e.clientX + 16, innerWidth - 250) + "px";
        tip.style.top = Math.min(e.clientY + 16, innerHeight - 70) + "px";
        tip.hidden = false; tip.classList.add("show");
      }
    } else {
      tip.classList.remove("show"); tip.hidden = true;
    }
  });
  on(document, "pointerup", () => {
    if (!bDrag) return;
    if (!bMoved && bDrag.artifact) window.open(bDrag.artifact.url, "_blank");
    else bDrag.w = Math.max(-RS.maxFling, Math.min(RS.maxFling, bDrag.w * RS.fling));
    bDrag.drag = false; bDrag.el.classList.remove("drag");
    bDrag = null;
  });

  /* ================= ball context menu: right-click -> OPEN / REMOVE
     (dashboard.html:1616-1667). REMOVE now calls the real Task 3 route. ================= */
  const menu = document.createElement("div");
  menu.id = "ballMenu";
  Object.assign(menu.style, {
    position: "fixed", zIndex: "120", display: "none", minWidth: "132px",
    background: "var(--panel)",
    border: "1px solid color-mix(in srgb, var(--cream) 25%, transparent)",
    borderRadius: "8px", padding: "5px",
    boxShadow: "0 14px 40px rgba(0,0,0,.55)",
    font: "500 12px system-ui, sans-serif", letterSpacing: "1px",
  });
  menu.innerHTML = '<div class="bm" data-act="open">OPEN</div><div class="bm" data-act="remove">REMOVE</div>';
  const menuStyle = document.createElement("style");
  menuStyle.textContent = `#ballMenu .bm { padding:7px 12px; border-radius:5px; color:var(--cream); cursor:pointer; }
    #ballMenu .bm:hover { background:color-mix(in srgb, var(--accent) 15%, transparent); color:var(--accent); }
    #ballMenu .bm[data-act="remove"]:hover { background:rgba(255,60,30,.18); }`;
  root.appendChild(menuStyle);
  root.appendChild(menu);
  let menuTarget = null;
  const hideMenu = () => { menu.style.display = "none"; menuTarget = null; };
  on(document, "contextmenu", (e) => {
    const el = e.target.closest(".oi");
    if (!el) { hideMenu(); return; }
    e.preventDefault();
    const b = balls.find((x) => x.el === el);
    if (!b || !b.artifact) { hideMenu(); return; }
    menuTarget = b;
    menu.style.display = "block";
    menu.style.left = Math.min(e.clientX, innerWidth - 150) + "px";
    menu.style.top = Math.min(e.clientY, innerHeight - 90) + "px";
  });
  on(document, "pointerdown", (e) => { if (!e.target.closest("#ballMenu")) hideMenu(); }, true);
  on(document, "keydown", (e) => { if (e.key === "Escape") hideMenu(); });
  on(menu, "click", async (e) => {
    const act = e.target.closest(".bm")?.dataset.act;
    if (!act || !menuTarget) return;
    const b = menuTarget; hideMenu();
    if (act === "open") window.open(b.artifact.url, "_blank");
    if (act === "remove") {
      let result = {};
      try { result = await (await api("POST", "/api/artifacts/remove", { file: b.artifact.file })).json(); }
      catch { result = { error: "server unreachable" }; }
      if (result.ok) {
        b.el.remove();
        balls.splice(balls.indexOf(b), 1);
        assignSlots(); wakeRing();
        toast(`removed "${b.artifact.title}" (kept in artifacts/_trash)`);
      } else {
        toast("remove failed: " + (result.error || "server unreachable"));
      }
    }
  });

  /* ================= orb portal =================
     The orb sits behind everything (#orbBox has pointer-events:none in
     owner.css, same as the kit), so - exactly like the kit's own hover-tip
     cursor swap at dashboard.html:1692-1699 and its click handler at
     dashboard.html:1361 - "clicking the orb" is detected on the document by
     distance from center, not by a listener on #orbBox itself. */
  let portalBusy = false;
  function inOrbCore(e) {
    if (e.target.closest(".oi") || e.target.closest(".w") || e.target.closest("#ballMenu")) return false;
    return Math.hypot(e.clientX - orbCX(), e.clientY - orbCY()) < RINGpx() * .55;
  }
  function openNoteViewer() {
    // Task 13's boot.js is expected to define window.showNotesTab (the same
    // pattern public/employee.html already uses); before that exists, fall
    // back to the tab-panel convention owner.html already ships
    // (#chat-root/#notes-root[data-tab-panel]) so this still works stand-alone.
    if (typeof window.showNotesTab === "function") { window.showNotesTab(); return; }
    document.querySelectorAll("[data-tab-panel]").forEach((p) => { p.hidden = p.dataset.tabPanel !== "notes"; });
  }
  function probeSecondBrain() {
    // dashboard.html:3960-3966's own probe: a no-cors fetch resolves if
    // *anything* answers on the port and rejects on connection refused -
    // that's all "is a Second Brain running" needs to know.
    return new Promise((resolve) => {
      const ctrl = new AbortController();
      const timer = setTimeout(() => { ctrl.abort(); resolve(false); }, 1200);
      fetch(BRAIN_URL, { mode: "no-cors", signal: ctrl.signal })
        .then(() => { clearTimeout(timer); resolve(true); })
        .catch(() => { clearTimeout(timer); resolve(false); });
    });
  }
  let orbDown = null;
  on(document, "pointerdown", (e) => { orbDown = inOrbCore(e) ? { x: e.clientX, y: e.clientY } : null; });
  on(document, "pointerup", async (e) => {
    if (!orbDown) return;
    const moved = Math.hypot(e.clientX - orbDown.x, e.clientY - orbDown.y) > 6;
    orbDown = null;
    if (moved || !inOrbCore(e) || portalBusy) return;
    portalBusy = true;
    try {
      const up = await probeSecondBrain();
      if (up) window.open(BRAIN_URL, "_blank");
      else openNoteViewer();
    } finally { portalBusy = false; }
  });

  function placeOrb() {
    const OB = Math.round(RINGpx() * 2.1);
    orbBox.style.width = OB + "px"; orbBox.style.height = OB + "px";
    orbBox.style.left = orbCX() - OB / 2 + "px"; orbBox.style.top = orbCY() - OB / 2 + "px";
    resizeThreeOrb?.(OB);
  }

  /* ---- 3D orb: three.js particle sphere (dashboard.html:3483-3736), vendored
     locally per this task's brief (no CDN/importmap - this LAN server has no
     guaranteed internet access at the shop). If the module fails to load for
     any reason, the ring keeps working: the orb-core click zone above still
     opens the Second Brain / note viewer, and orbBox gets a plain visible
     fallback affordance instead of an empty invisible circle. ---- */
  let resizeThreeOrb = null;
  async function mountOrb() {
    try {
      const THREE = await import(THREE_URL);
      resizeThreeOrb = buildThreeOrb(THREE, orbBox, LIGHT, teardown.stopped);
    } catch (err) {
      console.warn("ring.js: three.js orb unavailable, falling back to a plain portal circle", err);
      orbBox.classList.add("orb-fallback");
      orbBox.innerHTML = "";
      const btn = document.createElement("button");
      btn.type = "button";
      btn.textContent = "OPEN";
      btn.title = "Open notes";
      Object.assign(btn.style, {
        position: "absolute", inset: "0", margin: "auto", width: "84px", height: "84px",
        borderRadius: "50%", border: "2px solid var(--accent)", background: "var(--panel)",
        color: "var(--accent)", font: "700 11px system-ui, sans-serif", letterSpacing: "2px",
        cursor: "pointer", pointerEvents: "auto",
      });
      // No click handler of its own: pointer-events:auto just lets this element
      // receive (and bubble) the click so the shared document-level orb-core
      // detector below still fires exactly once - a second, independent handler
      // here would double-trigger probeSecondBrain()/window.open() on the same click.
      orbBox.appendChild(btn);
    }
  }

  /* ================= wire it up ================= */
  drawRail();
  placeOrb();
  mountOrb();
  pullArtifacts();
  const pollId = setInterval(pullArtifacts, POLL_MS);
  teardown.timers.push(pollId);
  on(window, "resize", () => { drawRail(); placeOrb(); wakeRing(); });
  // Task 13: skills-deck.js dispatches this right after a run finishes, so a
  // fresh report shows up on the ring immediately instead of waiting up to
  // POLL_MS for the next scheduled poll.
  on(window, "artifacts:refresh", pullArtifacts);
  teardown.raf = requestAnimationFrame(frame);

  // Task 13: the chat-bar toggle -- opens/closes Plan 1's #chat-root without
  // reimplementing any part of the chat engine (see chat-toggle.js).
  mountChatToggle(root);
}

/* ---- 3D orb particle build, split out for readability. Ported from
   dashboard.html:3494-3716; dropped: zoom/localStorage, the tweak-panel hue
   dials, drag-to-spin momentum, the singularity collapse effect and the
   spin-reward quote card (none of those hooks exist in this project). Kept:
   the swirling particle "arms" in the Second Brain's own domain palette, the
   icosahedron shell, the wireframe cage, and the small core cube mark -
   the visual identity that makes this read as a portal rather than a plain
   button. Auto-rotates; no drag-to-spin (out of scope for this task). ---- */
function buildThreeOrb(THREE, box, LIGHT, stopped) {
  const sr2 = (i) => { const v = Math.sin(i * 127.1 + 311.7) * 43758.5453; return v - Math.floor(v); };
  const renderer = new THREE.WebGLRenderer({ alpha: true });
  renderer.setPixelRatio(Math.min(devicePixelRatio || 1, 1.5));
  renderer.setClearColor(0x000000, 0);
  box.appendChild(renderer.domElement);
  const scene = new THREE.Scene();
  const camera = new THREE.PerspectiveCamera(45, 1, .1, 500);
  camera.position.z = 95;
  const group = new THREE.Group();
  group.rotation.set(-.2, .3, 0);
  scene.add(group);
  renderer.setSize(box.offsetWidth || 300, box.offsetWidth || 300);

  const VERT = `
    attribute float aSize, aSeed; attribute vec3 aColor;
    uniform float uTime, uPix;
    varying vec3 vColor; varying float vTw; varying float vSeed;
    float h3(vec3 p){ return fract(sin(dot(p, vec3(127.1,311.7,74.7)))*43758.5453); }
    float n3(vec3 p){ vec3 i=floor(p), f=fract(p); f=f*f*(3.-2.*f);
      float a=h3(i),b=h3(i+vec3(1,0,0)),c=h3(i+vec3(0,1,0)),d=h3(i+vec3(1,1,0));
      float e=h3(i+vec3(0,0,1)),g=h3(i+vec3(1,0,1)),k=h3(i+vec3(0,1,1)),l=h3(i+vec3(1,1,1));
      return mix(mix(mix(a,b,f.x),mix(c,d,f.x),f.y),mix(mix(e,g,f.x),mix(k,l,f.x),f.y),f.z); }
    void main(){
      vColor = aColor; vSeed = aSeed;
      vec3 p = position;
      float n = n3(p*.22 + vec3(uTime*.28));
      float n2 = n3(p*.5 - vec3(uTime*.2) + 31.);
      p += normalize(p+.001)*(n-.5)*.9 + (vec3(n2)-.5)*.4;
      vTw = .72 + .28*sin(uTime*(1.5+aSeed*3.)+aSeed*40.);
      vec4 mv = modelViewMatrix*vec4(p,1.);
      gl_PointSize = aSize*uPix*(120./-mv.z)*(.9+.2*vTw);
      gl_Position = projectionMatrix*mv;
    }`;
  const FRAG = `
    varying vec3 vColor; varying float vTw; varying float vSeed;
    uniform float uHue, uSpread, uSharp;
    vec3 hueRot(vec3 c, float ang){
      const vec3 k = vec3(0.57735);
      float cs = cos(ang), sn = sin(ang);
      return c*cs + cross(k, c)*sn + k*dot(k, c)*(1.0-cs);
    }
    void main(){
      float edge = mix(.06, .46, uSharp);
      float tw = mix(vTw, max(vTw, .95), uSharp);
      float a = smoothstep(.5, edge, length(gl_PointCoord-.5))*tw;
      if (a < .02) discard;
      float ang = uHue + (vSeed - 0.5) * uSpread * 4.0;
      gl_FragColor = vec4(hueRot(vColor, ang), a);
    }`;
  function pts(count, place, sizeFn, colFn, sharp) {
    const pos = new Float32Array(count * 3), col = new Float32Array(count * 3);
    const siz = new Float32Array(count), sed = new Float32Array(count);
    for (let i = 0; i < count; i++) { pos.set(place(i), i * 3); siz[i] = sizeFn(i); sed[i] = sr2(i * 3.7); col.set(colFn(i), i * 3); }
    const geo = new THREE.BufferGeometry();
    geo.setAttribute("position", new THREE.BufferAttribute(pos, 3));
    geo.setAttribute("aColor", new THREE.BufferAttribute(col, 3));
    geo.setAttribute("aSize", new THREE.BufferAttribute(siz, 1));
    geo.setAttribute("aSeed", new THREE.BufferAttribute(sed, 1));
    return new THREE.Points(geo, new THREE.ShaderMaterial({
      uniforms: { uTime: { value: 0 }, uPix: { value: renderer.getPixelRatio() }, uHue: { value: 0 }, uSpread: { value: 0 }, uSharp: { value: sharp || 0 } },
      vertexShader: VERT, fragmentShader: FRAG, transparent: true, depthWrite: false,
      blending: LIGHT ? THREE.NormalBlending : THREE.AdditiveBlending,
    }));
  }
  const BRAIN_PAL = LIGHT ? [
    [0.55, 0.35, 0.85], [0.82, 0.18, 0.22], [0.11, 0.43, 0.64], [0.15, 0.62, 0.70], [0.85, 0.65, 0.15], [0.18, 0.56, 0.80], [0.90, 0.34, 0.25],
  ] : [
    [0.784, 0.639, 0.910], [0.780, 0.498, 0.878], [0.498, 0.769, 0.910], [0.388, 0.780, 0.812], [0.918, 0.808, 0.369],
  ].map((c) => { const m = Math.max(c[0], c[1], c[2]); return [c[0] / m, c[1] / m, c[2] / m]; });
  const CORE_ORANGE = [0.109, 0.431, 0.643];
  function armColor(x, y, z, rr, rMax, seed) {
    const t = rr / rMax;
    const CORE = LIGHT ? CORE_ORANGE : null;
    if (t < 0.14) return LIGHT ? CORE : [1, 0.88, 0.68];
    if (t < 0.38) {
      const k = (t - 0.14) / 0.24;
      return LIGHT ? CORE : [1, 0.88 - 0.46 * k, 0.68 - 0.58 * k];
    }
    let a = Math.atan2(y, x) + Math.PI;
    a += rr * 0.44;
    const c = BRAIN_PAL[Math.floor((a / 6.2832) * BRAIN_PAL.length) % BRAIN_PAL.length];
    const b = 0.80 + seed * 0.20;
    if (t < 0.52) {
      const k = (t - 0.38) / 0.14;
      return [CORE_ORANGE[0] * (1 - k) + c[0] * b * k, CORE_ORANGE[1] * (1 - k) + c[1] * b * k, CORE_ORANGE[2] * (1 - k) + c[2] * b * k];
    }
    return [c[0] * b, c[1] * b, c[2] * b];
  }
  const ARM_R = LIGHT ? 5.81 : 4.4, ARM_N = LIGHT ? 3000 : 2000;
  group.add(pts(ARM_N, (i) => {
    const th = Math.acos(2 * sr2(i) - 1), ph = 6.2832 * sr2(i + 999), rr = ARM_R * Math.pow(sr2(i + 500), .55);
    return [rr * Math.sin(th) * Math.cos(ph), rr * Math.sin(th) * Math.sin(ph), rr * Math.cos(th)];
  }, (i) => (LIGHT ? 1.1 + 1.5 * sr2(i + 77) : 2.0 + 3.0 * sr2(i + 77)),
     (i) => {
       const th = Math.acos(2 * sr2(i) - 1), ph = 6.2832 * sr2(i + 999), rr = ARM_R * Math.pow(sr2(i + 500), .55);
       return armColor(rr * Math.sin(th) * Math.cos(ph), rr * Math.sin(th) * Math.sin(ph), rr * Math.cos(th), rr, ARM_R, sr2(i + 200));
     }, LIGHT ? 1 : 0));
  const ico = new THREE.IcosahedronGeometry(11.5, 1).toNonIndexed();
  const fp = ico.attributes.position.array, nf = fp.length / 9;
  group.add(pts(2200, (i) => {
    const f = Math.floor(sr2(i) * nf) * 9;
    let u = sr2(i + 3), v = sr2(i + 7); if (u + v > 1) { u = 1 - u; v = 1 - v; }
    const w2 = 1 - u - v, j = (k, o) => fp[f + k * 3 + o];
    const s = .98 + sr2(i + 11) * .06;
    return [(u * j(0, 0) + v * j(1, 0) + w2 * j(2, 0)) * s, (u * j(0, 1) + v * j(1, 1) + w2 * j(2, 1)) * s, (u * j(0, 2) + v * j(1, 2) + w2 * j(2, 2)) * s];
  }, (i) => .8 + 1.15 * sr2(i + 13),
     (i) => {
       const k = .78 + sr2(i + 808) * .22;
       const out = sr2(i + 404) > .80 ? [0.11, 0.43, 0.64] : [1 * k, .93 * k, .84 * k];
       if (!LIGHT) return out;
       const l = out[0] * 0.299 + out[1] * 0.587 + out[2] * 0.114;
       const g = Math.min(.6, .12 + .5 * (1 - l));
       return [g * .9, g, g * 1.12];
     }));
  const CUBE_S = 0.26, EDGE_T = 0.045;
  const cube = new THREE.Group();
  const edgeMat = new THREE.MeshBasicMaterial({ color: LIGHT ? 0x2a3f55 : 0x1c6ea4, transparent: true, opacity: .95 });
  const H = CUBE_S / 2;
  [[[0, -H, -H], [CUBE_S + EDGE_T, EDGE_T, EDGE_T]], [[0, H, -H], [CUBE_S + EDGE_T, EDGE_T, EDGE_T]],
   [[0, -H, H], [CUBE_S + EDGE_T, EDGE_T, EDGE_T]], [[0, H, H], [CUBE_S + EDGE_T, EDGE_T, EDGE_T]],
   [[-H, 0, -H], [EDGE_T, CUBE_S + EDGE_T, EDGE_T]], [[H, 0, -H], [EDGE_T, CUBE_S + EDGE_T, EDGE_T]],
   [[-H, 0, H], [EDGE_T, CUBE_S + EDGE_T, EDGE_T]], [[H, 0, H], [EDGE_T, CUBE_S + EDGE_T, EDGE_T]],
   [[-H, -H, 0], [EDGE_T, EDGE_T, CUBE_S + EDGE_T]], [[H, -H, 0], [EDGE_T, EDGE_T, CUBE_S + EDGE_T]],
   [[-H, H, 0], [EDGE_T, EDGE_T, CUBE_S + EDGE_T]], [[H, H, 0], [EDGE_T, EDGE_T, CUBE_S + EDGE_T]],
  ].forEach(([pos, dim]) => {
    const m = new THREE.Mesh(new THREE.BoxGeometry(...dim), edgeMat);
    m.position.set(...pos);
    cube.add(m);
  });
  cube.rotation.set(.615, .785, 0);
  group.add(cube);
  const meshMat = new THREE.LineBasicMaterial({ color: LIGHT ? 0x0c1e2f : 0xe8e2d2, transparent: true, opacity: LIGHT ? .10 : .13 });
  group.add(new THREE.LineSegments(new THREE.WireframeGeometry(new THREE.IcosahedronGeometry(11.5, 1)), meshMat));
  const RH = 19, DEP = 5.5;
  const hexAt = (z) => Array.from({ length: 6 }, (_, i) => { const a = Math.PI / 2 + i * Math.PI / 3; return new THREE.Vector3(Math.cos(a) * RH, Math.sin(a) * RH, z); });
  const t6 = hexAt(DEP), b6 = hexAt(-DEP), seg = [];
  for (let i = 0; i < 6; i++) { const j = (i + 1) % 6; seg.push(t6[i], t6[j], b6[i], b6[j], t6[i], b6[i]); }
  const cageMat = new THREE.LineBasicMaterial({ color: LIGHT ? 0x0c1e2f : 0xe8e2d2, transparent: true, opacity: LIGHT ? .18 : .26 });
  const cage = new THREE.LineSegments(new THREE.BufferGeometry().setFromPoints(seg), cageMat);
  group.add(cage);

  let last2 = performance.now();
  (function loop(now) {
    if (stopped.value) return; // ring was torn down (a repeat mountRing() call) - stop rendering a detached canvas
    const dt = Math.min(.05, (now - last2) / 1000); last2 = now;
    const t = now / 1000;
    group.rotation.y += dt * .06;
    cage.rotation.z += dt * .12;
    group.scale.setScalar(1 + .018 * Math.sin(t * 1.3));
    group.traverse((o) => { if (o.material?.uniforms) o.material.uniforms.uTime.value = t; });
    renderer.render(scene, camera);
    requestAnimationFrame(loop);
  })(last2);

  return (size) => renderer.setSize(size, size);
}
