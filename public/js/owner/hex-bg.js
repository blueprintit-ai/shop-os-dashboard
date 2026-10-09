// Faint hexagon-grid backdrop, ported from the reference kit's drawHex()
// (Robonuggets/agentic-os/dashboard.html ~1020). One static canvas, painted
// once on load and again (debounced) on resize or theme change -- no animation
// loop, no pointer handling, no custom cursor -- so it costs nothing at
// runtime and cannot affect the orb.
export function mountHexBackground() {
  let cv = document.getElementById("hexCv");
  if (!cv) {
    cv = document.createElement("canvas");
    cv.id = "hexCv";
    cv.setAttribute("aria-hidden", "true");
    document.body.prepend(cv);
  }
  const ctx = cv.getContext("2d");

  function draw() {
    const W = innerWidth, H = innerHeight;
    const DPR = Math.min(devicePixelRatio || 1, 2);
    cv.width = W * DPR; cv.height = H * DPR;
    cv.style.width = W + "px"; cv.style.height = H + "px";
    ctx.setTransform(DPR, 0, 0, DPR, 0, 0);
    ctx.clearRect(0, 0, W, H);
    const ink = document.documentElement.classList.contains("light") ? "12,30,47" : "232,226,210";
    const hexSize = 20, hSpacing = hexSize * Math.sqrt(3), vSpacing = hexSize * 1.5;
    const cx0 = W / 2, cy0 = H / 2, maxDist = Math.hypot(cx0, cy0);
    ctx.lineWidth = 0.6;
    for (let row = -1; row < H / vSpacing + 2; row++) {
      for (let col = -1; col < W / hSpacing + 2; col++) {
        const hx = col * hSpacing + (row % 2 ? hSpacing / 2 : 0), hy = row * vSpacing;
        const fade = Math.max(0, 1 - (Math.hypot(hx - cx0, hy - cy0) / maxDist) * 0.6);
        const alpha = 0.064 * fade * fade;
        if (alpha < 0.005) continue;
        ctx.beginPath();
        for (let i = 0; i < 6; i++) {
          const a = (Math.PI / 3) * i - Math.PI / 6;
          const x = hx + hexSize * Math.cos(a), y = hy + hexSize * Math.sin(a);
          i === 0 ? ctx.moveTo(x, y) : ctx.lineTo(x, y);
        }
        ctx.closePath();
        ctx.strokeStyle = `rgba(${ink},${alpha})`;
        ctx.stroke();
      }
    }
  }

  draw();
  let t = null;
  window.addEventListener("resize", () => { clearTimeout(t); t = setTimeout(draw, 150); });
}
