// Port of the kit server's mdToHtml (agentic-os/server.js): the chat bar posts the
// finished reply to /api/chat/render and gets back clean HTML. Everything is
// HTML-escaped first, so the output is safe to assign to innerHTML.
const esc = (s) => String(s).replace(/[&<>"]/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;" }[c]));

export function mdToHtml(src) {
  const inline = (s) => esc(s)
    .replace(/`([^`]+)`/g, "<code>$1</code>")
    .replace(/\*\*([^*]+)\*\*/g, "<strong>$1</strong>")
    .replace(/\[([^\]]+)\]\((https?:[^)]+)\)/g, '<a href="$2">$1</a>');
  const out = [];
  const lines = String(src).split(/\r?\n/);
  let list = null, fence = null;
  const closeList = () => { if (list) { out.push("</" + list + ">"); list = null; } };
  for (let i = 0; i < lines.length; i++) {
    const ln = lines[i];
    if (fence !== null) {
      if (/^```/.test(ln)) { out.push('<pre class="code">' + esc(fence.join("\n")) + "</pre>"); fence = null; }
      else fence.push(ln);
      continue;
    }
    if (/^```/.test(ln)) { closeList(); fence = []; continue; }
    if (/^\|.*\|\s*$/.test(ln)) {
      closeList();
      const rows = [];
      while (i < lines.length && /^\|.*\|\s*$/.test(lines[i])) {
        if (!/^\|[\s:|-]+\|\s*$/.test(lines[i])) rows.push(lines[i].replace(/^\||\|\s*$/g, "").split("|").map((c) => inline(c.trim())));
        i++;
      }
      i--;
      out.push("<table>" + rows.map((r, ri) => "<tr>" + r.map((c) => ri === 0 ? "<th>" + c + "</th>" : "<td>" + c + "</td>").join("") + "</tr>").join("") + "</table>");
      continue;
    }
    const h = ln.match(/^(#{1,4})\s+(.*)/);
    if (h) { closeList(); out.push(`<h${h[1].length + 1}>` + inline(h[2]) + `</h${h[1].length + 1}>`); continue; }
    const b = ln.match(/^\s*[-*]\s+(.*)/);
    if (b) { if (list !== "ul") { closeList(); out.push("<ul>"); list = "ul"; } out.push("<li>" + inline(b[1]) + "</li>"); continue; }
    const n = ln.match(/^\s*\d+[.)]\s+(.*)/);
    if (n) { if (list !== "ol") { closeList(); out.push("<ol>"); list = "ol"; } out.push("<li>" + inline(n[1]) + "</li>"); continue; }
    closeList();
    if (ln.trim()) out.push("<p>" + inline(ln) + "</p>");
  }
  if (fence) out.push('<pre class="code">' + esc(fence.join("\n")) + "</pre>");
  closeList();
  return out.join("\n");
}
