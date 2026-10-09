/* SHOP APPS rows come from /api/apps (Dashboard/apps.json in the vault), not from rows baked into the page. */
const openApp = u => { if (/^(https?:\/\/|\/(?![\/\\]))/i.test(u)) window.open(u, '_blank', 'noopener'); };
async function renderAppRows() {
  const box = document.getElementById('appRows'); if (!box) return;
  let apps = [];
  try { apps = (await api('/api/apps')).apps || []; } catch (_) { return; }
  const eh = s => String(s).replace(/[&<>"]/g, c => ({ '&':'&amp;', '<':'&lt;', '>':'&gt;', '"':'&quot;' }[c]));
  box.innerHTML = apps.map(a => `<div class="row2" id="${eh(a.id)}" data-url="${eh(a.url)}">${pixCanvas(eh(a.icon))}
        <span><b>${eh(a.name)}</b><small${a.id === 'sbRow' ? ' id="sbSub"' : ''}>${eh(a.sub || '')}</small></span>
        <span class="age">→</span></div>`).join('');
  paintPix(box);
  box.querySelectorAll('.row2').forEach(r => {
    r.dataset.wired = '1';
    r.addEventListener('click', () => {
      if (r.id !== 'sbRow') return openApp(r.dataset.url);
      /* the Second Brain row re-checks live; with nothing on :5210 it opens the dashboard's own notes */
      Promise.resolve(window.probeSecondBrain ? window.probeSecondBrain() : false)
        .then(up => openApp(up ? 'http://localhost:5210' : r.dataset.url));
    });
  });
  if (window.SB_UP) {
    const sb = document.getElementById('sbRow'), sub = document.getElementById('sbSub');
    if (sb) sb.dataset.url = 'http://localhost:5210';
    if (sub) sub.textContent = 'Your whole workspace as a living map';
  }
}
