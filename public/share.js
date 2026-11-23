/* Unshaken status images: 1080×1920 cards made for WhatsApp/Instagram status. */
window.UnshakenShare = (() => {
  const C = { bg: "#07110D", ink: "#F3F7F4", soft: "#CFE0D6", mute: "#A9BDB2", mint: "#2BD38A", gold: "#F5B83D", coral: "#FF8A6B", deep: "#0B7A4B" };
  const W = 1080, H = 1920, PADX = 96;

  function wrap(ctx, text, maxW) {
    const words = String(text).split(/\s+/), lines = []; let line = "";
    for (const w of words) { const test = line ? line + " " + w : w; if (ctx.measureText(test).width > maxW && line) { lines.push(line); line = w; } else line = test; }
    if (line) lines.push(line); return lines;
  }
  function logo(ctx, x, y, r) {
    ctx.fillStyle = C.ink; ctx.beginPath(); ctx.arc(x, y, r, 0, Math.PI * 2); ctx.fill();
    ctx.strokeStyle = C.bg; ctx.lineWidth = r * 0.12; ctx.beginPath(); ctx.arc(x, y, r * 0.78, 0, Math.PI * 2); ctx.stroke();
    ctx.strokeStyle = C.deep; ctx.lineWidth = r * 0.16; ctx.lineCap = "round"; ctx.beginPath(); ctx.moveTo(x - r * 0.6, y + r * 0.12); ctx.lineTo(x + r * 0.6, y + r * 0.12); ctx.stroke();
    ctx.fillStyle = C.gold; ctx.beginPath(); ctx.arc(x, y - r * 0.27, r * 0.18, 0, Math.PI * 2); ctx.fill();
  }
  const font = (w, px, fam) => `${w} ${px}px ${fam === "d" ? "'Space Grotesk'" : "Inter"}, system-ui, sans-serif`;

  /** card = { accent, kicker, title, big?, bigSub?, lines:[], footer, link } */
  async function render(card) {
    try { await Promise.all([document.fonts.load(font(700, 80, "d")), document.fonts.load(font(500, 40))]); } catch {}
    const cv = document.createElement("canvas"); cv.width = W; cv.height = H; const ctx = cv.getContext("2d");
    const accent = C[card.accent] || C.mint;
    ctx.fillStyle = C.bg; ctx.fillRect(0, 0, W, H);
    const g = ctx.createRadialGradient(W / 2, 0, 40, W / 2, 0, 1300); g.addColorStop(0, accent + "55"); g.addColorStop(1, C.bg + "00");
    ctx.fillStyle = g; ctx.fillRect(0, 0, W, H);

    logo(ctx, PADX + 44, 200, 44);
    ctx.fillStyle = C.ink; ctx.font = font(700, 54, "d"); ctx.textBaseline = "middle"; ctx.fillText("Unshaken", PADX + 112, 200);
    ctx.textBaseline = "alphabetic";

    let y = 420;
    ctx.fillStyle = accent; ctx.font = font(700, 40); ctx.fillText(String(card.kicker || "").toUpperCase(), PADX, y); y += 70;

    ctx.fillStyle = C.ink; ctx.font = font(700, card.title.length > 70 ? 76 : 92, "d");
    const tl = wrap(ctx, card.title, W - PADX * 2).slice(0, 6), lh = card.title.length > 70 ? 88 : 104;
    for (const l of tl) { y += lh; ctx.fillText(l, PADX, y); }
    y += 70;

    if (card.big) {
      ctx.fillStyle = accent; ctx.font = font(700, 150, "d"); y += 130; ctx.fillText(card.big, PADX, y);
      if (card.bigSub) { ctx.fillStyle = C.mute; ctx.font = font(500, 40); y += 70; ctx.fillText(card.bigSub, PADX, y); }
      y += 50;
    }
    ctx.font = font(500, 44);
    const LIMIT = H - 420;
    for (const para of card.lines || []) {
      if (!para) continue;
      let ls = wrap(ctx, para, W - PADX * 2 - 50);
      const room = Math.floor((LIMIT - y) / 62);
      if (room < 1) break;
      if (ls.length > room) { ls = ls.slice(0, room); ls[room - 1] = ls[room - 1].replace(/\s*\S*$/, "") + "…"; }
      ctx.fillStyle = accent; ctx.beginPath(); ctx.arc(PADX + 12, y + 44 - 14, 10, 0, Math.PI * 2); ctx.fill();
      ctx.fillStyle = C.soft;
      for (const l of ls) { y += 62; ctx.fillText(l, PADX + 50, y); }
      y += 30;
    }

    // footer band
    ctx.fillStyle = "rgba(243,247,244,0.07)"; roundRect(ctx, PADX, H - 360, W - PADX * 2, 230, 36); ctx.fill();
    ctx.strokeStyle = accent; ctx.lineWidth = 4; roundRect(ctx, PADX, H - 360, W - PADX * 2, 230, 36); ctx.stroke();
    ctx.fillStyle = C.ink; ctx.font = font(700, 46, "d"); ctx.fillText(card.footer || "Free to apply. Checked by Unshaken.", PADX + 44, H - 270);
    ctx.fillStyle = C.mute; ctx.font = font(500, 36); ctx.fillText(card.link || "No sign-up · No subscription", PADX + 44, H - 200);
    return new Promise(ok => cv.toBlob(ok, "image/png"));
  }
  function roundRect(ctx, x, y, w, h, r) { ctx.beginPath(); ctx.moveTo(x + r, y); ctx.arcTo(x + w, y, x + w, y + h, r); ctx.arcTo(x + w, y + h, x, y + h, r); ctx.arcTo(x, y + h, x, y, r); ctx.arcTo(x, y, x + w, y, r); ctx.closePath(); }

  /** Try the phone's share sheet with the image; else return an object URL to show/save. */
  async function share(card, text) {
    const blob = await render(card);
    const file = new File([blob], "unshaken-status.png", { type: "image/png" });
    if (navigator.canShare && navigator.canShare({ files: [file] })) {
      try { await navigator.share({ files: [file], text }); return { shared: true }; } catch (e) { if (e && e.name === "AbortError") return { shared: false, cancelled: true }; }
    }
    return { shared: false, url: URL.createObjectURL(blob) };
  }
  return { render, share };
})();
