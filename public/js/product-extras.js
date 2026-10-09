/* Blueprint OS additions to the kit toolbar: Users link, status dot, Update and Log out. The kit page itself is generated
   (tools/sync-kit.mjs) and only loads this file; owners only. Buttons reuse the kit's own `.tbar button` styling. */
(() => {
  const svg = (inner) => `<svg viewBox="0 0 24 24" aria-hidden="true">${inner}</svg>`;
  const USERS = svg('<circle cx="9" cy="8" r="3.5"/><path d="M2.5 20c0-3.6 2.9-6 6.5-6s6.5 2.4 6.5 6"/><path d="M16 4.7a3.5 3.5 0 0 1 0 6.6M18.5 14.4c1.9.8 3 2.8 3 5.6"/>');
  const UPDATE = svg('<circle cx="12" cy="12" r="9"/><path d="M12 16V8M8.5 11.5L12 8l3.5 3.5"/>');
  const LOGOUT = svg('<path d="M9 4.5H5.5a1.5 1.5 0 0 0-1.5 1.5v12a1.5 1.5 0 0 0 1.5 1.5H9"/><path d="M15.5 8l4 4-4 4M19.5 12H9.5"/>');
  const COLORS = { ok: '#2aa88a', warn: '#e0a33a', bad: '#c2461f' };
  const say = (m) => (typeof window.toast === 'function' ? window.toast(m) : undefined);
  let state = 'warn', problems = ['checking status'], update = null, who = '';

  function judge(s) {
    const bad = [], warn = [];
    if (!s.license?.ok) bad.push('license: ' + (s.license?.error || 'not valid'));
    if (!s.vault?.reachable) bad.push('vault not reachable');
    if (s.claude && !s.claude.present) bad.push('Claude Code not found');
    else if (s.claude?.signedIn === 'no') bad.push('Claude is signed out');
    else if (s.claude?.signedIn === 'unknown') warn.push('Claude sign-in not confirmed yet (turns green after the first chat reply in Blueprint OS Chat)');
    update = s.update?.updateAvailable ? s.update : null;
    if (update) warn.push('update available' + (update.latest ? ' (' + update.latest + ')' : ''));
    state = bad.length ? 'bad' : warn.length ? 'warn' : 'ok';
    problems = bad.concat(warn);
  }

  function mk(id, title, inner, onclick) {
    const b = document.createElement('button');
    b.id = id; b.title = title; b.setAttribute('aria-label', title); b.dataset.productExtras = '1';
    b.innerHTML = inner; b.addEventListener('click', onclick);
    return b;
  }
  const dot = () => svg('<circle cx="12" cy="12" r="6" fill="' + COLORS[state] + '" stroke="none"/>');
  const statusTitle = () => 'Status: ' + (problems.length ? problems.join(' · ') : 'all good');

  // The owner page has no account menu any more (it lived in the chat bar): this is the way out.
  async function logOut() {
    try { await fetch('/api/logout', { method: 'POST' }); } catch (_) {}
    location.href = '/login';
  }

  async function applyUpdate() {
    if (!confirm('Update Blueprint OS now? The dashboard restarts and comes back in a minute.')) return;
    say('updating Blueprint OS...');
    try {
      const r = await fetch('/api/update', { method: 'POST' });
      const j = await r.json().catch(() => ({}));
      if (!r.ok) return say('could not update: ' + (j.error || 'HTTP ' + r.status));
      say('updated - restarting');
      for (let i = 0; i < 60; i++) {   // wait for the restart, then reload into the new version
        await new Promise((res) => setTimeout(res, 2000));
        try { if ((await fetch('/api/ping')).ok && i > 1) return location.reload(); } catch (_) {}
      }
    } catch (e) { say('could not update: ' + e.message); }
  }

  function attach() {
    document.querySelectorAll('.tbar').forEach((bar) => {
      bar.querySelectorAll('[data-product-extras]').forEach((e) => e.remove());
      const after = bar.querySelector('#themeBtn');
      const els = [
        mk('usersBtn', 'Users', USERS, () => { location.href = '/users'; }),
        mk('statusBtn', statusTitle(), dot(), () => say(statusTitle())),
      ];
      els[1].dataset.state = state;
      if (update) els.push(mk('updateBtn', 'Update available - click to update', UPDATE, applyUpdate));
      els.push(mk('logoutBtn', 'Log out' + (who ? ' (' + who + ')' : ''), LOGOUT, logOut));
      let anchor = after;
      for (const e of els) { if (anchor) anchor.after(e); else bar.append(e); anchor = e; }
    });
  }

  let queued = false;
  const schedule = () => { if (queued) return; queued = true; setTimeout(() => { queued = false; attach(); }, 0); };
  // The kit rebuilds its title widget (and toolbar) when the layout changes: put the extras back.
  const missing = () => [...document.querySelectorAll('.tbar')].some((b) => !b.querySelector('[data-product-extras]'));

  async function refresh() {
    try { const r = await fetch('/api/status'); if (r.ok) judge(await r.json()); } catch (_) { state = 'bad'; problems = ['status unavailable']; }
    attach();
  }

  // The kit sizes its hex background, orb ring and grid canvases (and the widget cell size) once, from the window
  // size at load (`const W = innerWidth, H = innerHeight`). If the browser window grows afterwards (Brave on
  // Windows often loads into a smaller window, then maximises) the canvases stop short and a flat band shows
  // where they end. The kit does the same on the Mac app; here we reload once the window size has settled, so
  // the page is laid out for the size it is really shown at. The reload is held back while a widget drags or a
  // popover or search is open. Edit mode survives the reload.
  const EDIT_KEY = 'bp-resize-edit';
  function restoreAfterResize() {
    let d = null;
    try { d = sessionStorage.getItem(EDIT_KEY); sessionStorage.removeItem(EDIT_KEY); } catch (_) {}
    if (d === '1' && !document.body.classList.contains('edit')) document.getElementById('editBtn')?.click();
  }
  function reloadOnResize() {
    restoreAfterResize();
    const base = { w: innerWidth, h: innerHeight };
    let timer = null;
    const blocked = () => document.querySelector('#profilePop.show, #runpop.show, #appop.show')
      || document.body.classList.contains('dragging') || document.body.classList.contains('searchopen');
    const settle = () => {
      timer = null;
      if (Math.abs(innerWidth - base.w) <= 8 && Math.abs(innerHeight - base.h) <= 8) return;
      if (blocked()) { timer = setTimeout(settle, 500); return; }
      try { sessionStorage.setItem(EDIT_KEY, document.body.classList.contains('edit') ? '1' : '0'); } catch (_) {}
      location.reload();
    };
    addEventListener('resize', () => { if (timer) clearTimeout(timer); timer = setTimeout(settle, 500); });
  }

  // The dot reads /api/status, which changes when a problem is fixed: re-check every 20 s while anything is amber or red.
  function watchStatus() {
    setInterval(() => { if (state !== 'ok') refresh(); }, 20 * 1000);
  }

  async function init() {
    reloadOnResize();
    let me = null;
    try { me = await (await fetch('/api/me')).json(); } catch (_) { return; }
    if (me?.user?.role !== 'owner') return;   // staff are sent to /employee and never load this page
    who = me.user.username || me.user.displayName || '';
    new MutationObserver(() => { if (missing()) schedule(); }).observe(document.body, { childList: true, subtree: true });
    attach();
    await refresh();
    setInterval(refresh, 5 * 60 * 1000);
    watchStatus();
  }
  init();
})();
