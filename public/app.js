/* Unshaken app — works on the full website (with /api) and in a static preview (falls back gracefully). */
{
const $ = s => document.querySelector(s);
const esc = s => String(s ?? "").replace(/[&<>"']/g, c => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
const store = {
  get(k, d) { try { const v = localStorage.getItem(k); return v === null ? d : JSON.parse(v); } catch { return d; } },
  set(k, v) { try { localStorage.setItem(k, JSON.stringify(v)); } catch {} }
};
const pad = n => String(n).padStart(2, "0");
const DAY = 864e5;
const toast = msg => { const t = document.createElement("div"); t.className = "toast"; t.textContent = msg; document.body.append(t); setTimeout(() => t.remove(), 2200); };

/* ---------- state ---------- */
const S = {
  lang: store.get("u_lang", (navigator.language || "en").startsWith("fr") ? "fr" : "en"),
  items: [], rates: null, regions: {}, updated: "",
  tr: {},                                   // translated listing text for current language
  profile: store.get("u_profile", null),
  saved: new Set(store.get("u_saved", [])),
  sprints: store.get("u_sprints", []),
  cat: store.get("u_cat", "All"),
  captain: store.get("u_captain", null),
  shares: store.get("u_shares", 0),
  device: store.get("u_device", null),
  env: { api: false, ai: false, db: false }, sample: null
};
if (!S.device) { S.device = Array.from(crypto.getRandomValues(new Uint8Array(12)), b => b.toString(16).padStart(2, "0")).join(""); store.set("u_device", S.device); }

/* ---------- i18n ---------- */
const L = window.UNSHAKEN_I18N, LANGS = window.UNSHAKEN_LANGS;
const t = (k, vars = {}) => String((L[S.lang] && L[S.lang][k]) ?? L.en[k] ?? k).replace(/\{(\w+)\}/g, (_, v) => vars[v] ?? "");
const it$ = it => ({ ...it, ...(S.tr[it.id] || {}) });   // listing with translated text if available

/* ---------- data helpers ---------- */
const COUNTRIES = [["NG","Nigeria"],["GH","Ghana"],["KE","Kenya"],["ZA","South Africa"],["EG","Egypt"],["ET","Ethiopia"],["UG","Uganda"],["TZ","Tanzania"],["RW","Rwanda"],["CM","Cameroon"],["SN","Senegal"],["CI","Côte d'Ivoire"],["ZM","Zambia"],["ZW","Zimbabwe"],["MA","Morocco"],["LR","Liberia"],["SL","Sierra Leone"],["BJ","Benin"],["TG","Togo"],["MW","Malawi"],["IN","India"],["PK","Pakistan"],["BD","Bangladesh"],["PH","Philippines"],["ID","Indonesia"],["VN","Vietnam"],["BR","Brazil"],["MX","Mexico"],["CO","Colombia"],["PE","Peru"],["US","United States"],["GB","United Kingdom"],["CA","Canada"],["DE","Germany"],["FR","France"],["NL","Netherlands"],["IT","Italy"],["ES","Spain"],["CN","China"],["UA","Ukraine"],["TR","Türkiye"],["AE","UAE"],["OTHER","Other"]];
const inRegion = (c, r) => (S.regions[r] || []).includes(c);
function left(iso) { const s = Math.max(0, Math.floor((new Date(iso) - Date.now()) / 1000)); return { d: Math.floor(s / 86400), h: Math.floor(s % 86400 / 3600), m: Math.floor(s % 3600 / 60), s: s % 60, total: s }; }
function dueLabel(it) {
  if (it.rolling) return [t("always_open"), "open"];
  const l = left(it.due);
  if (it.opens) return l.total ? [t("opens_in", { n: l.d }), "open"] : [t("open_now"), "open"];
  if (!l.total) return [t("check_status"), "shut"];
  return [l.d < 1 ? t("under24") : t("days_left", { n: l.d }), ""];
}
/** Eligibility with reasons. s: "yes" | "maybe" | "near" | "no". near = only fixable gaps. */
const FIXABLE = new Set(["work"]);
function fitInfo(it) {
  const p = S.profile, e = it.elig || {};
  if (!p) return null;
  const why = [], maybe = [];
  const unknownCountry = p.country === "OTHER";
  if (e.levels && (p.level === "none" || !e.levels.includes(p.level))) why.push("level");
  if (e.exclude && (Array.isArray(e.exclude) ? e.exclude.includes(p.country) : inRegion(p.country, e.exclude))) why.push("country");
  if (e.countries) { if (unknownCountry) maybe.push("country_check"); else if (!e.countries.includes(p.country)) why.push("country"); }
  if (e.region) { if (unknownCountry) maybe.push("country_check"); else if (!inRegion(p.country, e.region)) why.push("region"); }
  if (e.gender === "female") { if (p.gender === "male") why.push("gender"); else if (p.gender !== "female") maybe.push("gender_check"); }
  if (e.fields && !e.fields.includes(p.field)) why.push("field");
  if (e.student && p.student !== "yes") why.push("student");
  if (e.minWork && Number(p.work) < e.minWork) why.push("work");
  if (e.partnerCheck) maybe.push("partner");
  if (why.length) return { s: why.every(k => FIXABLE.has(k)) ? "near" : "no", why, need: e.minWork };
  return { s: maybe.length ? "maybe" : "yes", why: maybe };
}
const fit = it => fitInfo(it)?.s ?? null;
const openItems = () => S.items.filter(i => i.rolling || i.opens || left(i.due).total);
const fitCount = () => openItems().filter(i => fit(i) === "yes").length;
const nearCount = () => openItems().filter(i => fit(i) === "near").length;

/* ---------- naira value of an award ---------- */
const compactN = n => n >= 1e6 ? "₦" + (n / 1e6).toFixed(n >= 1e7 ? 1 : 2).replace(/\.0+$/, "") + "m" : "₦" + Math.round(n).toLocaleString("en-US");
function naira(raw) {
  const a = raw.amount, r = a && S.rates?.[a.cur.toLowerCase()];
  if (!a || !r) return "";
  const lo = a.value * r.ngn, hi = a.max ? a.max * r.ngn : 0;
  return `≈ ${compactN(lo)}${hi ? " – " + compactN(hi) : ""}${a.per === "month" ? " " + t("per_month") : ""}`;
}

/* ---------- API + AI (with preview fallbacks) ---------- */
async function api(path, body) {
  const r = await fetch("/api/" + path, body === undefined ? {} : { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify(body) });
  const j = await r.json().catch(() => ({}));
  if (!r.ok) { const e = new Error(j.error || r.status); e.status = r.status; throw e; }
  return j;
}
async function previewAI(prompt, images) {          // only used in the Claude preview
  if (!S.sample) return null;
  try { return await S.sample.json(prompt, images ? { images } : {}); } catch { return null; }
}

/* ---------- views ---------- */
const VIEWS = ["drop", "board", "check", "sprint", "more", "coach", "wall", "captain"];
const TABS = ["drop", "board", "check", "sprint", "more"];
const ICON = {
  drop: '<path d="M12 3c3 4 6 7 6 11a6 6 0 0 1-12 0c0-4 3-7 6-11z"/>',
  board: '<rect x="3" y="4" width="18" height="16" rx="3"/><path d="M3 10h18M9 10v10"/>',
  check: '<path d="M12 2l8 4v6c0 5-3.5 8.5-8 10-4.5-1.5-8-5-8-10V6z"/><path d="M8.5 12l2.5 2.5 4.5-5"/>',
  sprint: '<circle cx="12" cy="13" r="8"/><path d="M12 9v4l3 2M9 2h6"/>',
  more: '<circle cx="5" cy="12" r="1.5"/><circle cx="12" cy="12" r="1.5"/><circle cx="19" cy="12" r="1.5"/>',
  coach: '<path d="M4 20h4L19 9l-4-4L4 16z"/><path d="M13 7l4 4"/>',
  wall: '<path d="M8 21h8M12 17v4M7 4h10v5a5 5 0 0 1-10 0z"/><path d="M17 5h3v2a3 3 0 0 1-3 3M7 5H4v2a3 3 0 0 0 3 3"/>',
  captain: '<path d="M16 21v-2a4 4 0 0 0-8 0v2"/><circle cx="12" cy="7" r="4"/><path d="M22 21v-2a4 4 0 0 0-3-3.9M2 21v-2a4 4 0 0 1 3-3.9"/>',
  install: '<path d="M12 3v12M7 10l5 5 5-5M5 21h14"/>',
  bell: '<path d="M6 8a6 6 0 0 1 12 0c0 7 3 9 3 9H3s3-2 3-9"/><path d="M10.3 21a1.9 1.9 0 0 0 3.4 0"/>',
  pen: '<path d="M4 20h4L19 9l-4-4L4 16z"/>',
  share: '<circle cx="18" cy="5" r="3"/><circle cx="6" cy="12" r="3"/><circle cx="18" cy="19" r="3"/><path d="M8.6 13.5l6.8 4M15.4 6.5l-6.8 4"/>'
};
const svg = k => `<svg viewBox="0 0 24 24" aria-hidden="true">${ICON[k]}</svg>`;
let view = "drop";
const dueToday = () => { const d = new Date().toISOString().slice(0, 10); return S.sprints.reduce((n, sp) => n + sp.tasks.filter(x => !x.done && x.day <= d).length, 0); };
function renderNav() {
  const active = TABS.includes(view) ? view : "more", badge = dueToday();
  $("#nav").innerHTML = TABS.map(v => `<a href="#${v}" ${v === active ? 'aria-current="page"' : ""}>${svg(v)}<span>${esc(t("nav_" + v))}</span>${v === "sprint" && badge ? `<span class="dot">${badge}</span>` : ""}</a>`).join("");
}
const buzz = () => { try { navigator.vibrate && navigator.vibrate(8); } catch {} };
function route() {
  const h = location.hash.slice(1);
  view = VIEWS.includes(h) ? h : "drop";
  stopSpeak(); renderNav(); renderView();
  scrollTo?.(0, 0);
}
function renderView() {
  const fn = { drop: vDrop, board: vBoard, check: vCheck, sprint: vSprint, more: vMore, coach: vCoach, wall: vWall, captain: vCaptain }[view];
  $("#main").innerHTML = fn();
  after[view]?.();
  document.querySelectorAll("[data-t]").forEach(el => { el.textContent = t(el.dataset.t); });
  $("#listen").textContent = speaking ? t("stop") : t("listen");
}
const after = {};
after.board = () => { const q = $("#q"); if (!q) return; q.oninput = () => { S.q = q.value; const pos = q.selectionStart; renderView(); const n = $("#q"); n.focus(); n.setSelectionRange(pos, pos); }; };

/* ===== Today's Drop ===== */
let idx = 0, start = Date.now();
const DUR = 8000;
const soon = () => S.items.filter(i => !i.rolling && !i.opens && left(i.due).total).sort((a, b) => new Date(a.due) - new Date(b.due))[0];
const fmtN = n => "₦" + Math.round(n).toLocaleString("en-US");
const fmtD = s => new Date(s + "T12:00:00Z").toLocaleDateString(S.lang === "fr" ? "fr-FR" : "en-GB", { day: "numeric", month: "short" });
const STORIES = [
  { glow: "var(--mint)", html: () => { const u = S.rates.usd, g = S.rates.gbp; return `<span class="kick">${t("s_dollar")}</span>
    <div><div class="big">${fmtN(u.ngn)}</div><div class="sub">${t("s_per")} ${esc(u.source)}, ${fmtD(u.date)}</div></div>
    <div class="tiles"><div class="tile"><span class="sub">£1</span><strong>${fmtN(g.ngn)}</strong><span class="sub">${esc(g.source)}, ${fmtD(g.date)}</span></div>
    <div class="tile"><span class="sub">${t("s_5")}</span><strong style="color:var(--gold)">${fmtN(u.ngn * 5)}</strong><span class="sub">${t("s_rate")}</span></div></div>
    <p class="lead" style="margin:0">${t("s_lead")}</p>
    <div class="cta"><a class="btn" href="#board">${t("s_all")}</a><button class="btn" data-img="rates">${t("status_img")}</button></div>`; } },
  { glow: "var(--mint)", html: () => S.profile
      ? `<span class="kick">${t("s_fit_k")}</span><div class="ring">${fitCount()}</div><h2>${t("s_fit_h", { n: fitCount() })}</h2>${nearCount() ? `<p class="lead" style="margin:0;color:var(--gold)">${t("near_n", { n: nearCount() })}</p>` : ""}
         <div class="cta"><a class="btn go" href="#board" data-cat="fit">${t("s_fit_see")}</a><button class="btn" data-quiz>${t("q_edit")}</button></div>`
      : `<span class="kick">${t("s_fit_k")}</span><h2 style="font-size:34px">${t("s_fit_q")}</h2><p class="sub" style="margin:0">${t("q_sub")}</p>
         <div class="cta"><button class="btn go" data-quiz>${t("s_fit_cta")}</button></div>` },
  { glow: "var(--gold)", live: true, html: () => { const s = soon(); if (!s) return `<span class="kick">${t("s_close")}</span><a class="btn" href="#board">${t("s_all")}</a>`;
    const x = it$(s), l = left(s.due), f = fit(s);
    return `<span class="kick" style="color:var(--gold)">${t("s_close")} · ${t("cat_" + s.cat)}</span>
    <h2 style="font-size:28px">${esc(x.title)}</h2><p class="sub" style="margin:0">${esc(x.get)}</p>
    <div class="clock">${[[l.d, "days"], [l.h, "hrs"], [l.m, "min"], [l.s, "sec"]].map(([v, u]) => `<div><b>${pad(v)}</b><small>${u}</small></div>`).join("")}</div>
    ${naira(s) ? `<strong style="color:var(--mint)">${naira(s)}</strong>` : ""}${fitBlock(s)}
    <div class="cta"><a class="btn gold" href="${esc(s.link)}" target="_blank" rel="noopener">${t("s_open")}</a><button class="btn" data-sprint="${s.id}">${t("s_sprint")}</button></div>`; } },
  { glow: "var(--mint)", html: () => `<span class="kick">${t("s_earn_k")}</span><h2 style="font-size:30px">${t("s_earn_h")}</h2>
    <div class="tiles"><div class="tile"><strong>CrowdGen</strong><span class="sub">200 countries</span></div><div class="tile"><strong>Mindrift</strong><span class="sub">Nigeria ✓</span></div></div>
    <p class="sub" style="margin:0">${t("s_earn_sub")}</p><div class="cta"><a class="btn" href="#board" data-cat="Earn">${t("s_earn_cta")}</a></div>` },
  { glow: "var(--coral)", html: () => S.radar?.total >= 5 && S.radar.topFlags?.length ? `<span class="kick" style="color:var(--coral)">${t("s_scam_k")} · ${t("radar_live")}</span>
    <h2 style="font-size:25px">${t("radar_top", { flag: S.radar.topFlags[0].flag })}</h2>
    <div class="stat"><div><b>${S.radar.total}</b><span class="sub">${t("radar_checked")}</span></div><div><b style="color:var(--coral)">${S.radar.byVerdict.red}</b><span class="sub">🔴</span></div><div><b style="color:var(--gold)">${S.radar.byVerdict.orange}</b><span class="sub">🟠</span></div></div>
    <div class="warn">${S.radar.topFlags.slice(0, 3).map(f => `<span>${esc(f.flag)} · ${f.count}</span>`).join("")}</div>
    <div class="cta"><a class="btn" href="#check">${t("s_scam_cta")}</a><button class="btn gold" data-img="radar">${t("warn_group")}</button></div>` : `<span class="kick" style="color:var(--coral)">${t("s_scam_k")}</span><h2 style="font-size:30px">${t("s_scam_h")}</h2>
    <div class="warn"><span>${t("s_scam_1")}</span><span>${t("s_scam_2")}</span><span>${t("s_scam_3")}</span></div>
    <div class="cta"><a class="btn" href="#check">${t("s_scam_cta")}</a><button class="btn gold" data-img="scam">${t("warn_group")}</button></div>` }
];
function vDrop() {
  return `<div class="story"><div class="glow" id="glow"></div><div class="bars">${STORIES.map(() => "<span><b></b></span>").join("")}</div>
    <button class="tap l" id="prev" aria-label="Previous"></button><button class="tap r" id="next" aria-label="Next"></button>
    <div class="sbody" id="sbody" aria-live="polite"></div></div>`;
}
function paintStory() {
  const st = STORIES[idx], body = $("#sbody"); if (!body) return;
  body.innerHTML = st.html();
  $("#glow").style.background = `radial-gradient(120% 55% at 50% 0%, color-mix(in srgb, ${st.glow} 26%, transparent), transparent 65%)`;
}
const goStory = n => { idx = Math.max(0, Math.min(STORIES.length - 1, n)); start = Date.now(); paintStory(); };
after.drop = () => { paintStory(); $("#prev").onclick = () => goStory(idx - 1); $("#next").onclick = () => goStory(idx + 1); };

/* ===== Board ===== */
function card(raw) {
  const it = it$(raw), [lab, cls] = dueLabel(raw), f = fit(raw), inSprint = S.sprints.some(s => s.id === raw.id);
  return `<article class="card">
    <div class="row"><span class="tag">${t("cat_" + raw.cat)}</span><span class="due ${cls}">${lab}</span></div>
    <h3>${esc(it.title)}</h3><p>${esc(it.get)}</p>
    ${naira(raw) ? `<div class="naira"><strong>${naira(raw)}</strong><span class="sub">${t("at_rate")} · ${fmtD(S.rates[raw.amount.cur.toLowerCase()].date)}</span></div>` : ""}
    <p><strong>${t("who")}:</strong> ${esc(it.who)}</p>
    ${raw.rolling ? "" : `<p><strong>${t("deadline")}:</strong> ${esc(it.dueText)}</p>`}
    ${fitBlock(raw)}
    ${raw.flag ? `<div class="note">${t("confirm")} ${esc(raw.flag)}</div>` : ""}
    <details><summary>${t("steps", { n: it.steps.length })}</summary><ol>${it.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details>
    <div class="acts"><a class="btn go sm" href="${esc(raw.link)}" target="_blank" rel="noopener">${t("official")}</a>
      <button class="btn sm" data-save="${raw.id}">${S.saved.has(raw.id) ? t("saved") : t("save")}</button>
      <button class="btn sm" data-share="${raw.id}">${t("share")}</button>
      <button class="btn sm" data-img="item:${raw.id}">${t("status_img")}</button>
      ${raw.cat === "Go" ? `<button class="btn sm" data-writer="${raw.id}">${t("writer_btn")}</button>` : ""}
      ${raw.rolling ? "" : `<button class="btn sm" data-sprint="${raw.id}">${inSprint ? t("in_sprint") : t("start_sprint")}</button>`}</div>
  </article>`;
}
function fitBlock(raw) {
  const fi = fitInfo(raw); if (!fi) return "";
  if (fi.s === "near") return `<div class="near"><strong>${t("near_t")}</strong><span>${t("fix_work", { n: fi.need })}</span></div>`;
  const reason = fi.why[0] ? `<span class="sub"> · ${t("why_" + fi.why[0])}</span>` : "";
  return `<span class="fit ${fi.s}">${t("fit_" + fi.s)}${fi.s !== "yes" ? reason : ""}</span>`;
}
function vBoard() {
  const cats = ["All", ...(S.profile ? ["fit"] : []), "Go", "Earn", "Learn", "Grow", "Saved"];
  if (!cats.includes(S.cat)) S.cat = "All";
  const rank = it => (fit(it) === "no" ? 1e16 : fit(it) === "near" ? 5e15 : 0) + (it.rolling ? 9e15 : (left(it.due).total || 8e15));
  const list = S.items.filter(it => S.cat === "All" || (S.cat === "Saved" ? S.saved.has(it.id) : S.cat === "fit" ? fit(it) !== "no" : it.cat === S.cat)).sort((a, b) => rank(a) - rank(b));
  const q = (S.q || "").toLowerCase().trim();
  const shown = q ? list.filter(it => { const x = it$(it); return [x.title, x.get, x.who, it.cat].join(" ").toLowerCase().includes(q); }) : list;
  return `<h2 style="margin-top:18px">${t("board_title", { n: openItems().length })}</h2>
    <p class="sub" style="margin:6px 0 0">${t("board_sub")}</p>
    <div class="panel" style="margin-top:14px;padding:14px"><div class="row"><strong>${S.profile ? t("qualify_n", { n: fitCount() }) + (nearCount() ? ` · ${t("near_n", { n: nearCount() })}` : "") : t("q_title")}</strong>
      <button class="btn sm" data-quiz>${S.profile ? t("q_edit") : t("s_fit_cta")}</button></div></div>
    <div class="search"><svg viewBox="0 0 24 24" aria-hidden="true"><circle cx="11" cy="11" r="7"/><path d="M21 21l-5-5"/></svg><input type="text" id="q" placeholder="${esc(t("search_ph"))}" value="${esc(S.q || "")}" aria-label="${esc(t("search_ph"))}"></div>
    <div class="chips">${cats.map(c => `<button aria-pressed="${c === S.cat}" data-c="${c}">${t("cat_" + (c === "All" || c === "Saved" ? c.toLowerCase() : c))}</button>`).join("")}</div>
    <div id="list">${shown.length ? shown.map(card).join("") : `<p class="empty">${t(S.cat === "Saved" ? "saved_empty" : "fit_none")}</p>`}</div>`;
}

/* ===== Check a deal + Scam Radar ===== */
const RULES = [
  [/\b(fee|pay to|registration (fee|money)|activation|processing fee)\b/i, "Asks you to pay before you earn", "red"],
  [/\b(update|upgrade|unlock|recharge|top.?up|deposit)\b/i, "Wants money to 'update', 'upgrade' or unlock withdrawals", "red"],
  [/\b(refer|invite \d+|bring \d+ friends|downline)\b/i, "Earnings depend on recruiting others", "red"],
  [/\b(otp|bvn|pin|password|login details)\b/i, "Asks for codes, PINs or login details", "red"],
  [/\b(usdt|trc20|crypto|bitcoin|btc|wallet address)\b/i, "Pays only in crypto, which is hard to trace or reverse", "orange"],
  [/\b(guaranteed|100%|risk.?free)\b/i, "Promises guaranteed income", "orange"],
  [/\$\s?\d+\s*(daily|a day|per day)|daily (pay|income)/i, "Fixed daily dollar pay for simple tasks", "orange"],
  [/\b(only for (females|ladies|women|girls)|females only)\b/i, "Odd eligibility with no clear reason (could also be unsafe)", "orange"],
  [/\b(agent|dm me|inbox me)\b/i, "Runs through a chat 'agent', not an official site", "orange"],
  [/\b(stream|watch videos|like videos)\b.*\b(earn|\$)/i, "Pays for watching, liking or streaming, a common task-scam hook", "orange"]
];
function ruleCheck(txt) {
  const hits = RULES.filter(([r]) => r.test(txt)), red = hits.some(h => h[2] === "red");
  const verdict = red || hits.length >= 3 ? "red" : hits.length ? "orange" : "green";
  return { verdict, summary: { red: "Too many warning signs. Do not pay anything.", orange: "Hold. Some warning signs; verify before you go further.", green: "No common warning signs found in this text. Still check the official site." }[verdict],
    flags: hits.map(h => h[1]), next: ["Find the company's own website and check the offer is listed there", "Never pay a fee, 'update' or deposit to receive money you earned", "Search the exact name plus the word scam before you sign up"] };
}
function vCheck() {
  return `<div class="panel"><h2>${t("check_title")}</h2><p class="sub" style="margin:0">${t("check_sub")}</p>
    <div class="field"><label for="deal">${t("check_label")}</label><textarea id="deal" maxlength="4000" placeholder="Stream for 2hrs daily, earn $2 a day paid in USDT. Only for females. $10 update to unlock withdrawal."></textarea></div>
    <div class="field"><label for="shot">${t("check_shot")}</label><input type="file" id="shot" accept="image/*"></div>
    <div class="acts"><button class="btn go" id="run">${t("check_btn")}</button><button class="btn" id="example">${t("check_example")}</button></div>
    <div id="out" aria-live="polite"></div></div>
    <div class="panel" id="radar" hidden></div>`;
}
const fileToDataURL = (f, max) => new Promise((ok, no) => { if (!f) return ok(null); if (f.size > max) return no(new Error("big")); const r = new FileReader(); r.onload = () => ok(r.result); r.onerror = no; r.readAsDataURL(f); });
function renderVerdict(r, src) {
  const icon = { green: "🟢", orange: "🟠", red: "🔴" }[r.verdict] || "🟠";
  $("#out").innerHTML = `<div class="verdict v-${esc(r.verdict)}"><h3 style="font-size:21px">${icon} ${esc(r.summary)}</h3>
    ${r.seen ? `<strong style="color:var(--gold)">${t("check_seen", { n: r.seen })}</strong>` : ""}
    ${r.flags?.length ? `<strong>${t("warn_signs")}</strong><ul>${r.flags.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}
    <strong>${t("what_do")}</strong><ul>${(r.next || []).map(f => `<li>${esc(f)}</li>`).join("")}</ul><span class="sub">${esc(src)}</span>
    ${r.verdict !== "green" ? `<button class="btn gold" data-img="verdict">${t("warn_group")}</button>` : ""}</div>`;
  S.lastVerdict = r;
}
after.check = () => {
  $("#example").onclick = () => { $("#deal").value = "Product Tube is the name. If she can stream for 2hrs daily, video streaming. $2 daily, for 7 days is $14. Withdrawal paid in USDT-TRC20. Only for females sha. $10 update needed."; };
  $("#run").onclick = async () => {
    const txt = $("#deal").value.trim().slice(0, 4000), file = $("#shot").files[0];
    if (!txt && !file) return;
    const base = ruleCheck(txt); renderVerdict(base, t("src_wait"));
    $("#run").disabled = true;
    try {
      if (S.env.api) {
        const image = await fileToDataURL(file, 1.5e6).catch(() => null);
        const r = await api("check", { text: txt, image, lang: S.lang });
        renderVerdict(r, r.source === "ai" ? t("src_ai") : t("src_quick"));
      } else {
        const r = await previewAI(`You protect people from online money scams. Reply as JSON only: {"verdict":"green"|"orange"|"red","summary":"one plain sentence","flags":["..."],"next":["..."]}. red for fees/deposits/"updates" to unlock earnings, recruitment pay or impersonation; orange for unverifiable; green only for a known legitimate programme. Never tell them to pay. Max 5 flags, 3 actions. Write in language code ${S.lang}.\n\nOFFER:\n${txt || "(see screenshot)"}`, file ? [file] : null);
        renderVerdict(r && r.verdict ? r : base, r && r.verdict ? t("src_ai") : t("src_quick"));
      }
    } catch { renderVerdict(base, t("src_quick")); }
    $("#run").disabled = false;
  };
  if (S.env.db) api("radar").then(r => {
    if (!r.enabled || !r.total) return;
    const el = $("#radar"); if (!el) return; el.hidden = false;
    el.innerHTML = `<h3 style="font-size:20px">${t("radar_title")}</h3><p class="sub" style="margin:0">${t("radar_line", { t: r.total, r: r.byVerdict.red, o: r.byVerdict.orange, g: r.byVerdict.green })}</p>
      ${r.topFlags.map(f => `<div class="score"><div class="row"><span>${esc(f.flag)}</span><span>${f.count}</span></div><div class="meter"><b style="width:${Math.round(f.count / r.topFlags[0].count * 100)}%;background:var(--coral)"></b></div></div>`).join("")}`;
  }).catch(() => {});
};

/* ===== Application Sprint ===== */
function makeSprint(raw) {
  const it = it$(raw), end = new Date(raw.due).getTime() - DAY, today = new Date(); today.setHours(0, 0, 0, 0);
  const prep = ["Read the official page fully and list every requirement", "Request your transcript and certificates", "Ask two referees (send them a short, polite request)", "Write the first draft of your essay or statement", "Score your draft in Essay Coach and fix the top 3 issues"];
  const tasks = [...prep, ...it.steps, "Final check of every document, then submit early and screenshot the confirmation"];
  const span = Math.max(0, Math.floor((end - today) / DAY));
  return { id: raw.id, created: Date.now(), tasks: tasks.map((txt, i) => ({ txt, day: new Date(today.getTime() + Math.round(span * i / Math.max(1, tasks.length - 1)) * DAY).toISOString().slice(0, 10), done: false })) };
}
function vSprint() {
  const list = S.sprints.map(sp => ({ sp, raw: S.items.find(i => i.id === sp.id) })).filter(x => x.raw);
  const todayISO = new Date().toISOString().slice(0, 10);
  return `<div class="panel"><h2>${t("sprint_title")}</h2><p class="sub" style="margin:0">${t("sprint_sub")}</p>${alertsCard()}</div>
    ${list.length ? list.map(({ sp, raw }) => { const it = it$(raw), d = sp.tasks.filter(x => x.done).length, [lab] = dueLabel(raw);
      return `<article class="card"><div class="row"><span class="tag">${t("cat_" + raw.cat)}</span><span class="due">${lab}</span></div>
      <h3>${esc(it.title)}</h3><div class="score"><div class="row"><span class="sub">${t("sprint_progress", { d, t: sp.tasks.length })}</span></div><div class="meter"><b style="width:${Math.round(d / sp.tasks.length * 100)}%"></b></div></div>
      <div>${sp.tasks.map((x, i) => { const cls = x.done ? "done" : x.day <= todayISO ? "today" : "";
        return `<label class="task ${cls}"><input type="checkbox" data-task="${raw.id}:${i}" ${x.done ? "checked" : ""}><span style="flex:1">${esc(x.txt)}</span><span class="when">${x.day === todayISO ? t("today") : x.day < todayISO && !x.done ? t("overdue") : fmtD(x.day)}</span></label>`; }).join("")}</div>
      <div class="acts"><button class="btn sm" data-remind="${raw.id}">${t("remind")}</button>${S.env.api ? `<button class="btn sm" data-ics="${raw.id}">${t("calendar")}</button>` : ""}<button class="btn sm" data-unsprint="${raw.id}">${t("remove")}</button></div></article>`; }).join("")
    : `<p class="empty">${t("sprint_empty")}</p><div class="acts"><a class="btn go" href="#board">${t("s_all")}</a></div>`}`;
}
function ics(raw, sp) {
  const it = it$(raw), stamp = new Date().toISOString().replace(/[-:]/g, "").slice(0, 15) + "Z";
  const ev = sp.tasks.map((x, i) => { const d = x.day.replace(/-/g, ""); return `BEGIN:VEVENT\r\nUID:${raw.id}-${i}-${S.device}@unshaken\r\nDTSTAMP:${stamp}\r\nDTSTART;VALUE=DATE:${d}\r\nSUMMARY:${(it.title.slice(0, 40) + ": " + x.txt).replace(/[,;\n]/g, " ")}\r\nDESCRIPTION:${raw.link}\r\nEND:VEVENT`; }).join("\r\n");
  return `BEGIN:VCALENDAR\r\nVERSION:2.0\r\nPRODID:-//Unshaken//Sprint//EN\r\n${ev}\r\nEND:VCALENDAR`;
}

/* ===== Essay Coach ===== */
function vCoach() {
  return `<div class="panel"><h2>${t("coach_title")}</h2><p class="sub" style="margin:0">${t("coach_sub")}</p>
    <div class="field"><label for="ctarget">${t("coach_target")}</label><input type="text" id="ctarget" maxlength="160" placeholder="e.g. Swedish Institute Scholarship, MSc Public Health" value="${esc(store.get("u_ctarget", ""))}"></div>
    <div class="field"><label for="csop">${t("coach_paste")}</label><textarea id="csop" maxlength="9000" style="min-height:240px">${esc(store.get("u_csop", ""))}</textarea></div>
    <button class="btn go" id="crun">${t("coach_btn")}</button><div id="cout" aria-live="polite"></div></div>`;
}
function renderCoach(r) {
  if (!r || !Array.isArray(r.scores)) { $("#cout").innerHTML = `<p class="sub">${t("error")}</p>`; return; }
  $("#cout").innerHTML = `<div class="card" style="margin:0"><div class="row"><h3>${esc(r.overall)}/100</h3></div>
    ${r.scores.map(s => `<div class="score"><div class="row"><span>${esc(s.name)}</span><span>${esc(s.score)}/10</span></div><div class="meter"><b style="width:${Math.max(0, Math.min(10, Number(s.score) || 0)) * 10}%"></b></div><span class="sub">${esc(s.note)}</span></div>`).join("")}
    ${r.top_fixes?.length ? `<strong>${t("coach_fixes")}</strong><ol class="steps">${r.top_fixes.map(f => `<li>${esc(f)}</li>`).join("")}</ol>` : ""}
    ${r.rewrites?.length ? `<strong>${t("coach_rewrites")}</strong>${r.rewrites.map(w => `<div class="rw"><s>${esc(w.before)}</s><span>${esc(w.after)}</span></div>`).join("")}` : ""}
    ${r.keep?.length ? `<strong>${t("coach_keep")}</strong><ul class="steps">${r.keep.map(f => `<li>${esc(f)}</li>`).join("")}</ul>` : ""}</div>`;
}
after.coach = () => {
  $("#crun").onclick = async () => {
    const sop = $("#csop").value.trim(), target = $("#ctarget").value.trim();
    store.set("u_csop", sop); store.set("u_ctarget", target);
    if (sop.length < 300) { $("#cout").innerHTML = `<p class="sub">${t("coach_min")}</p>`; return; }
    $("#cout").innerHTML = `<p class="sub">${t("loading")}</p>`; $("#crun").disabled = true;
    try {
      if (S.env.api && S.env.ai) renderCoach(await api("coach", { sop, target, lang: S.lang }));
      else if (S.sample) renderCoach(await previewAI(`You are a strict, kind scholarship selection coach. Score this statement for "${target || "a funded scholarship"}". Reply JSON only: {"overall":0-100,"scores":[{"name":"Clear goal","score":0-10,"note":""},{"name":"Evidence & results","score":0-10,"note":""},{"name":"Fit with this programme","score":0-10,"note":""},{"name":"Leadership & impact","score":0-10,"note":""},{"name":"Plan after study","score":0-10,"note":""},{"name":"Structure & language","score":0-10,"note":""}],"top_fixes":[],"rewrites":[{"before":"","after":""}],"keep":[]}. Never invent achievements. Max 5 fixes, 4 rewrites, 3 keeps. Write notes in language code ${S.lang}.\n\n${sop}`));
      else $("#cout").innerHTML = `<p class="sub">${t("coach_off")}</p>`;
    } catch (e) { $("#cout").innerHTML = `<p class="sub">${esc(e.message || t("error"))}</p>`; }
    $("#crun").disabled = false;
  };
};

/* ===== Winners (Proof Wall) ===== */
function vWall() {
  return `<div class="panel"><h2>${t("wall_title")}</h2><p class="sub" style="margin:0">${t("wall_sub")}</p><div id="wlist"><p class="sub">${t("loading")}</p></div></div>
    <div class="panel"><h3 style="font-size:21px">${t("wall_form")}</h3>
    ${S.env.db ? `<form id="wform" class="panel" style="margin:0;padding:0;border:0;background:none">
      <div class="field"><label for="wf">${t("f_first")}</label><input type="text" id="wf" maxlength="40" required></div>
      <div class="field"><label for="wc">${t("f_country")}</label><input type="text" id="wc" maxlength="60" required></div>
      <div class="field"><label for="wp">${t("f_programme")}</label><input type="text" id="wp" maxlength="120" required></div>
      <div class="field"><label for="wy">${t("f_year")}</label><input type="number" id="wy" min="2020" max="2035" value="${new Date().getFullYear()}"></div>
      <div class="field"><label for="wct">${t("f_contact")}</label><input type="text" id="wct" maxlength="120"></div>
      <div class="field"><label for="wfile">${t("f_file")}</label><input type="file" id="wfile" accept="image/jpeg,image/png,image/webp,application/pdf" required></div>
      <label class="check"><input type="checkbox" id="wok" required> ${t("f_consent")}</label>
      <button class="btn go" type="submit">${t("submit")}</button><div id="wmsg" aria-live="polite"></div></form>` : `<p class="sub" style="margin:0">${t("wall_off")}</p>`}</div>`;
}
after.wall = async () => {
  const box = $("#wlist");
  if (!S.env.db) { box.innerHTML = `<p class="empty">${t("wall_empty")}</p>`; }
  else try {
    const r = await api("proof");
    box.innerHTML = r.items?.length ? r.items.map(w => `<div class="winner"><i>${esc(w.first_name[0])}</i><div><strong>${esc(w.first_name)}, ${esc(w.country)}</strong><div class="sub">${esc(w.programme)}${w.year ? " · " + esc(w.year) : ""}</div></div></div>`).join("") : `<p class="empty">${t("wall_empty")}</p>`;
  } catch { box.innerHTML = `<p class="empty">${t("wall_empty")}</p>`; }
  const f = $("#wform"); if (!f) return;
  f.onsubmit = async e => {
    e.preventDefault(); const msg = $("#wmsg");
    try {
      const file = await fileToDataURL($("#wfile").files[0], 3e6);
      await api("proof", { first_name: $("#wf").value, country: $("#wc").value, programme: $("#wp").value, year: $("#wy").value, contact: $("#wct").value, file, consent: $("#wok").checked });
      f.reset(); msg.innerHTML = `<p style="color:var(--mint);margin:0">${t("wall_thanks")}</p>`;
    } catch (err) { msg.innerHTML = `<p style="color:var(--coral);margin:0">${esc(err.message === "big" ? "Max 3 MB" : err.message || t("error"))}</p>`; }
  };
};

/* ===== Captains & OG Ladder ===== */
const LEVELS = [["Starter", 0], ["Connector", 10], ["Captain", 50], ["Gold OG", 200]];
function shareLink() { const base = location.origin && location.origin !== "null" ? location.origin + location.pathname : ""; return S.captain && S.env.db ? `${base}?c=${S.captain.code}` : base; }
function vCaptain() {
  const lvl = [...LEVELS].reverse().find(([, m]) => S.shares >= m)[0];
  return `<div class="panel"><h2>${t("cap_title")}</h2><p class="sub" style="margin:0">${t("cap_sub")}</p>
    <div class="stat"><div><b>${S.shares}</b><span class="sub">${t("cap_shares")}</span></div><div><b>${esc(lvl)}</b><span class="sub">${t("cap_level")}</span></div><div><b>${fitCount() || "–"}</b><span class="sub">${t("cat_fit")}</span></div></div></div>
    <div class="panel" id="capbox">${!S.env.db ? `<p class="sub" style="margin:0">${t("cap_off")}</p>` : S.captain ? `<p class="sub">${t("loading")}</p>` :
      `<form id="capform" style="display:grid;gap:12px"><div class="field"><label for="cn">${t("cap_name")}</label><input type="text" id="cn" maxlength="40"></div>
       <div class="field"><label for="cg">${t("cap_group")}</label><input type="text" id="cg" maxlength="80"></div>
       <button class="btn go" type="submit">${t("cap_btn")}</button></form>`}</div>`;
}
after.captain = async () => {
  const f = $("#capform");
  if (f) f.onsubmit = async e => { e.preventDefault(); try { const r = await api("captain", { display_name: $("#cn").value, group_name: $("#cg").value }); S.captain = r; store.set("u_captain", r); renderView(); } catch { toast(t("error")); } };
  if (S.captain && S.env.db) try {
    const r = await fetch(`/api/captain?code=${encodeURIComponent(S.captain.code)}&secret=${encodeURIComponent(S.captain.secret)}`).then(x => x.json());
    $("#capbox").innerHTML = `<div class="row"><h3 style="font-size:22px">${esc(r.display_name || "Captain")} · ${esc(r.code)}</h3><span class="due open">${esc(r.level)}</span></div>
      <div class="stat"><div><b>${r.visits}</b><span class="sub">${t("cap_visits")}</span></div><div><b>${r.shares}</b><span class="sub">${t("cap_shares")}</span></div><div><b>${esc(r.level)}</b><span class="sub">${t("cap_level")}</span></div></div>
      ${r.next ? `<div class="score"><span class="sub">${t("cap_next", { n: r.next.need, level: r.next.name })}</span><div class="meter"><b style="width:${Math.round(r.visits / (r.visits + r.next.need) * 100)}%;background:var(--gold)"></b></div></div>` : ""}
      <div class="field"><label>${t("cap_link")}</label><input type="text" readonly value="${esc(shareLink())}"></div>
      <button class="btn go" data-copylink>${t("share")}</button><p class="sub" style="margin:0">${t("cap_keep")} <strong>${esc(S.captain.code)}</strong></p>`;
  } catch { $("#capbox").innerHTML = `<p class="sub">${t("error")}</p>`; }
};

/* ===== Deadline alerts (web push, no account) ===== */
const alertItems = () => [...new Set([...S.saved, ...S.sprints.map(x => x.id)])];
const b64ToU8 = b => { const p = "=".repeat((4 - b.length % 4) % 4), s = atob((b + p).replace(/-/g, "+").replace(/_/g, "/")); return Uint8Array.from(s, c => c.charCodeAt(0)); };
const pushReady = () => S.env.api && S.push?.enabled && "serviceWorker" in navigator && "PushManager" in window;
async function alertsOn() {
  if (!pushReady()) return toast(t("alerts_unavailable"));
  try {
    const perm = await Notification.requestPermission();
    if (perm !== "granted") return toast(t("alerts_denied"));
    const reg = await navigator.serviceWorker.ready;
    const sub = (await reg.pushManager.getSubscription()) || await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: b64ToU8(S.push.publicKey) });
    await api("push", { subscription: sub.toJSON(), items: alertItems(), lang: S.lang });
    store.set("u_alerts", true); S.alerts = true; buzz(); toast(t("alerts_on_t")); renderView();
  } catch { toast(t("error")); }
}
async function alertsOff() {
  try { const reg = await navigator.serviceWorker.ready, sub = await reg.pushManager.getSubscription(); if (sub) { await api("push", { action: "off", endpoint: sub.endpoint }).catch(() => {}); await sub.unsubscribe(); } } catch {}
  store.set("u_alerts", false); S.alerts = false; renderView();
}
let syncTimer = null;
function syncAlerts() {
  if (!S.alerts || !pushReady()) return;
  clearTimeout(syncTimer);
  syncTimer = setTimeout(async () => { try { const sub = await (await navigator.serviceWorker.ready).pushManager.getSubscription(); if (sub) api("push", { subscription: sub.toJSON(), items: alertItems(), lang: S.lang }).catch(() => {}); } catch {} }, 800);
}
function alertsCard() {
  if (!S.env.api) return "";
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  if (!S.push?.enabled) return "";
  if (iOS && !standalone()) return `<div class="panel" style="margin:0">${svg("bell")}<strong>${t("alerts_t")}</strong><p class="sub" style="margin:0">${t("alerts_ios")}</p></div>`;
  return `<div class="panel" style="margin:0"><div class="row"><span style="display:flex;gap:12px;align-items:center">${svg("bell")}<strong>${t("alerts_t")}</strong></span>
    <button class="btn sm ${S.alerts ? "" : "go"}" data-alerts="${S.alerts ? "off" : "on"}">${S.alerts ? t("alerts_off") : t("alerts_on")}</button></div>
    <p class="sub" style="margin:0">${S.alerts ? t("alerts_status", { n: alertItems().length }) : t("alerts_sub")}</p></div>`;
}

/* ===== Message writer ===== */
const TEMPLATES = {
  referee: (it, f) => ({ subject: `Reference request: ${it.title}`, body: `Dear ${f.to || "[Referee's name]"},

I hope you are well. I am applying for the ${it.title}${it.dueText ? `, which closes on ${it.dueText}` : ""}, and I would be very grateful if you could write a reference for me.

You know my work from ${f.details || "[course/job you did with them, and when]"}. If it helps, I can send my CV, the programme link and three short points you could mention.

The reference is needed by ${it.dueText || "[deadline]"}. I'll gladly send a reminder a week before.

Thank you for considering this.

Kind regards,
${f.name || "[Your name]"}` }),
  professor: (it, f) => ({ subject: `Prospective student: interest in your research`, body: `Dear ${f.to || "Professor [Surname]"},

My name is ${f.name || "[Your name]"}. I am preparing an application for the ${it.title} and I am very interested in your work on ${f.details || "[their specific research topic or paper]"}.

My background is in [your degree and one result or project]. I would like to build on this by [what you want to study and why it fits their group].

Would you be open to supervising a student with this focus, or could you tell me if there is a better person to contact?

I have attached my CV. Thank you for your time.

Kind regards,
${f.name || "[Your name]"}` }),
  followup: (it, f) => ({ subject: `Following up: ${it.title}`, body: `Dear ${f.to || "[Name]"},

I hope you are well. I am following up on my message from last week about the ${it.title}${it.dueText ? ` (deadline ${it.dueText})` : ""}.

${f.details || "[One useful update, e.g. 'I have now received my transcript' or 'I have attached a short summary of my project']"}

I understand you are busy, and I appreciate any reply when you have a moment.

Kind regards,
${f.name || "[Your name]"}` })
};
function openWriter(id) {
  const raw = S.items.find(i => i.id === id), it = it$(raw), saved = store.get("u_writer", {});
  $("#modal").innerHTML = `<form class="sheet" id="wr" role="dialog" aria-modal="true" aria-labelledby="wrt">
    <div class="row"><h2 id="wrt" style="font-size:26px">${t("writer_t")}</h2><button type="button" class="pill" data-close aria-label="Close">✕</button></div>
    <p class="sub" style="margin:0">${esc(it.title)}</p>
    <div class="chips" style="margin:0">${["referee", "professor", "followup"].map((k, i) => `<button type="button" class="chipr" data-wt="${k}" aria-pressed="${i === 0}">${t("w_" + k)}</button>`).join("")}</div>
    <div class="field"><label for="wn">${t("w_name")}</label><input type="text" id="wn" maxlength="60" value="${esc(saved.name || "")}"></div>
    <div class="field"><label for="wto">${t("w_to")}</label><input type="text" id="wto" maxlength="80"></div>
    <div class="field"><label for="wd">${t("w_details")}</label><input type="text" id="wd" maxlength="300" placeholder="${esc(t("w_details_ph"))}"></div>
    <div class="field"><label for="wsub">${t("w_subject")}</label><input type="text" id="wsub"></div>
    <div class="field"><label for="wbody">${t("w_body")}</label><textarea id="wbody" style="min-height:260px"></textarea></div>
    <div class="acts"><button type="button" class="btn go" id="wcopy">${t("w_copy")}</button><button type="button" class="btn" id="wai">${t("w_ai")}</button></div>
    <p class="sub" style="margin:0" id="wmsg2"></p></form>`;
  $("#modal").hidden = false;
  let type = "referee";
  const fill = () => { const f = { name: $("#wn").value.trim(), to: $("#wto").value.trim(), details: $("#wd").value.trim() }; const m = TEMPLATES[type](it, f); $("#wsub").value = m.subject; $("#wbody").value = m.body; store.set("u_writer", { name: f.name }); };
  fill();
  $("#wr").addEventListener("input", e => { if (["wn", "wto", "wd"].includes(e.target.id)) fill(); });
  $("#wr").addEventListener("click", e => { const k = e.target.dataset.wt; if (!k) return; type = k; document.querySelectorAll("[data-wt]").forEach(x => x.setAttribute("aria-pressed", x.dataset.wt === k)); fill(); });
  $("#wcopy").onclick = e => copy(`Subject: ${$("#wsub").value}\n\n${$("#wbody").value}`, e.target);
  $("#wai").onclick = async e => {
    const btn = e.target, body = { type, programme: it.title, name: $("#wn").value, to: $("#wto").value, details: $("#wd").value, lang: S.lang };
    btn.disabled = true; $("#wmsg2").textContent = t("loading");
    try {
      let r = null;
      if (S.env.api && S.env.ai) r = await api("write", body);
      else if (S.sample) r = await previewAI(`Write ${type === "referee" ? "a polite reference-letter request" : type === "professor" ? "a short first email to a potential supervisor" : "a courteous follow-up email"} for the programme "${it.title}". Sender: ${body.name || "[Your name]"}. Recipient: ${body.to || "[Name]"}. Facts: ${body.details || "(none)"}. Under 170 words, use only given facts, [placeholders] for missing ones. JSON only: {"subject":"","body":""}. Language code ${S.lang}.`);
      if (r?.body) { $("#wsub").value = r.subject || $("#wsub").value; $("#wbody").value = r.body; $("#wmsg2").textContent = t("w_ai_done"); }
      else $("#wmsg2").textContent = t("coach_off");
    } catch { $("#wmsg2").textContent = t("error"); }
    btn.disabled = false;
  };
}

/* ===== More ===== */
let installEvt = null;
addEventListener("beforeinstallprompt", e => { e.preventDefault(); installEvt = e; if (view === "more") renderView(); });
const standalone = () => matchMedia?.("(display-mode: standalone)").matches || navigator.standalone;
function vMore() {
  const iOS = /iphone|ipad|ipod/i.test(navigator.userAgent);
  const item = (href, k, title, sub, attr = "") => `<${href ? `a href="${href}"` : `button type="button" ${attr}`}>${svg(k)}<span><strong>${esc(title)}</strong><span>${esc(sub)}</span></span></${href ? "a" : "button"}>`;
  return `<h2 style="margin-top:18px">${t("more_title")}</h2>
    ${S.streak > 1 ? `<p class="sub" style="margin:6px 0 0">${t("streak_long", { n: S.streak })}</p>` : ""}
    <div class="menu">
      ${alertsCard()}
      ${item("#coach", "coach", t("nav_coach"), t("more_coach"))}
      ${item("#wall", "wall", t("nav_wall"), t("more_wall"))}
      ${item("#captain", "captain", t("nav_captain"), t("more_captain"))}
      ${item("", "share", t("share_app"), t("share_app_sub"), "data-shareapp")}
      ${standalone() ? "" : installEvt ? item("", "install", t("install"), t("install_sub"), "data-install") : S.env.api ? `<div class="panel" style="margin:0">${svg("install")}<p class="sub" style="margin:0">${iOS ? t("install_ios") : t("install_android")}</p></div>` : ""}
    </div>`;
}
function statusCard(kind) {
  const link = (shareLink() || "").replace(/^https?:\/\//, "") || t("nosignup");
  if (kind === "rates") { const u = S.rates.usd; return { accent: "mint", kicker: t("s_dollar"), title: `$1 = ${fmtN(u.ngn)}`, big: fmtN(u.ngn * 5), bigSub: t("s_5") + " · " + fmtD(u.date), lines: [t("s_lead")], footer: t("nosignup"), link }; }
  if (kind === "radar" && S.radar) return { accent: "coral", kicker: t("s_scam_k") + " · " + t("radar_live"), title: t("radar_top", { flag: S.radar.topFlags[0].flag }), big: String(S.radar.total), bigSub: t("radar_checked"), lines: S.radar.topFlags.slice(0, 3).map(f => `${f.flag} (${f.count})`), footer: t("s_scam_cta"), link };
  if (kind === "scam") return { accent: "coral", kicker: t("s_scam_k"), title: t("s_scam_h"), lines: [t("s_scam_1"), t("s_scam_2"), t("s_scam_3")], footer: t("s_scam_cta"), link };
  if (kind === "verdict") { const r = S.lastVerdict || {}; return { accent: r.verdict === "red" ? "coral" : "gold", kicker: t("s_scam_k"), title: r.summary || "", lines: [...(r.flags || []).slice(0, 4)], footer: t("s_scam_cta"), link }; }
  const raw = S.items.find(i => i.id === kind.split(":")[1]), it = it$(raw), l = raw.rolling ? null : left(raw.due);
  return { accent: raw.rolling ? "mint" : "gold", kicker: `${t("cat_" + raw.cat)} · ${raw.rolling ? t("always_open") : dueLabel(raw)[0]}`, title: it.title, big: l && l.total ? `${l.d}d ${pad(l.h)}h` : null, bigSub: raw.rolling ? null : it.dueText, lines: [naira(raw), it.get, it.who].filter(Boolean), footer: t("free_apply"), link };
}
async function shareImage(kind, btn) {
  buzz(); const old = btn.textContent; btn.textContent = t("loading"); btn.disabled = true;
  try {
    const r = await window.UnshakenShare.share(statusCard(kind), shareLink());
    if (r.shared) { S.shares++; store.set("u_shares", S.shares); toast(t("copied")); }
    else if (r.url) {
      $("#modal").innerHTML = `<div class="sheet" role="dialog" aria-modal="true"><div class="row"><h3 style="font-size:20px">${t("status_img")}</h3><button class="pill" data-close aria-label="Close">✕</button></div>
        <img class="preview-img" src="${r.url}" alt="${esc(t("status_img"))}"><p class="sub" style="margin:0">${t("status_hold")}</p>
        ${S.env.api ? `<a class="btn go" href="${r.url}" download="unshaken-status.png">${t("save_img")}</a>` : ""}</div>`;
      $("#modal").hidden = false;
    }
  } catch { toast(t("error")); }
  btn.textContent = old; btn.disabled = false;
}

/* ---------- welcome (first visit) ---------- */
function welcome() {
  $("#modal").innerHTML = `<div class="sheet" role="dialog" aria-modal="true" aria-labelledby="wt">
    <h2 id="wt" style="font-size:30px">${t("welcome_t")}</h2>
    <div class="menu" style="margin:0">
      <div class="panel" style="margin:0">${svg("board")}<strong>${t("welcome_1")}</strong></div>
      <div class="panel" style="margin:0">${svg("check")}<strong>${t("welcome_2")}</strong></div>
      <div class="panel" style="margin:0">${svg("sprint")}<strong>${t("welcome_3")}</strong></div>
    </div>
    <button class="btn go" data-quiz>${t("welcome_go")}</button><button class="btn" data-close>${t("welcome_skip")}</button></div>`;
  $("#modal").hidden = false; store.set("u_seen", 1);
}

/* ---------- quiz sheet ---------- */
function openQuiz() {
  const p = S.profile || {}, radio = (name, opts) => `<div class="opts" role="radiogroup">${opts.map(([v, k]) => `<label><input type="radio" name="${name}" value="${v}" ${p[name] === v ? "checked" : ""} required> ${t(k)}</label>`).join("")}</div>`;
  $("#modal").innerHTML = `<form class="sheet" id="quiz" role="dialog" aria-modal="true" aria-labelledby="qt">
    <div class="row"><h2 id="qt">${t("q_title")}</h2><button type="button" class="pill" data-close aria-label="Close">✕</button></div><p class="sub" style="margin:0">${t("q_sub")}</p>
    <div class="field"><label for="qc">1. ${t("q_country")}</label><select id="qc" class="full" required>${COUNTRIES.map(([c, n]) => `<option value="${c}" ${p.country === c ? "selected" : ""}>${n}</option>`).join("")}</select></div>
    <div class="field"><span style="font-weight:600">2. ${t("q_level")}</span>${radio("level", [["bachelor", "lvl_bachelor"], ["master", "lvl_master"], ["phd", "lvl_phd"], ["none", "lvl_none"]])}</div>
    <div class="field"><span style="font-weight:600">3. ${t("q_work")}</span>${radio("work", [["0", "work_0"], ["0.5", "work_05"], ["1.5", "work_15"], ["3", "work_3"]])}</div>
    <div class="field"><span style="font-weight:600">4. ${t("q_gender")}</span>${radio("gender", [["female", "g_female"], ["male", "g_male"], ["skip", "g_skip"]])}</div>
    <div class="field"><span style="font-weight:600">5. ${t("q_field")}</span>${radio("field", [["stem", "f_stem"], ["business", "f_business"], ["social", "f_social"], ["health", "f_health"], ["other", "f_other"]])}</div>
    <div class="field"><span style="font-weight:600">6. ${t("q_student")}</span>${radio("student", [["yes", "yes"], ["no", "no"]])}</div>
    <button class="btn go" type="submit">${t("q_save")}</button></form>`;
  if (!p.country) $("#qc").value = "NG";
  $("#modal").hidden = false; $("#qc").focus();
  $("#quiz").onsubmit = e => {
    e.preventDefault(); const fd = new FormData(e.target);
    S.profile = { country: $("#qc").value, level: fd.get("level"), work: fd.get("work"), gender: fd.get("gender"), field: fd.get("field"), student: fd.get("student") };
    store.set("u_profile", S.profile); closeModal(); S.cat = "fit"; store.set("u_cat", "fit");
    toast(t("qualify_n", { n: fitCount() })); location.hash = "#board"; if (view === "board") renderView();
  };
}
const closeModal = () => { $("#modal").hidden = true; $("#modal").innerHTML = ""; };
$("#modal").addEventListener("click", e => { if (e.target.id === "modal" || e.target.closest("[data-close]")) closeModal(); });
addEventListener("keydown", e => { if (e.key === "Escape" && !$("#modal").hidden) closeModal(); });

/* ---------- global clicks ---------- */
async function copy(txt, btn) {
  try { await navigator.clipboard.writeText(txt); if (btn) btn.textContent = t("copied"); return true; } catch { if (btn) btn.textContent = t("copy_blocked"); return false; }
}
document.addEventListener("click", async e => {
  const el = e.target.closest("button,a"); if (!el) return;
  const d = el.dataset;
  if ("quiz" in d) { e.preventDefault(); openQuiz(); }
  if (d.img) { e.preventDefault(); shareImage(d.img, el); }
  if (d.writer) openWriter(d.writer);
  if (d.alerts) d.alerts === "on" ? alertsOn() : alertsOff();
  if ("shareapp" in d) { const link = shareLink() || location.href; try { if (navigator.share) { await navigator.share({ title: "Unshaken", text: t("share_app_sub"), url: link }); S.shares++; store.set("u_shares", S.shares); } else { await copy(link, null); toast(t("copied")); } } catch {} }
  if ("install" in d && installEvt) { installEvt.prompt(); installEvt = null; }
  if (d.save || d.sprint || d.share) buzz();
  if (d.save || d.sprint || d.unsprint) syncAlerts();
  if (d.cat) { S.cat = d.cat; store.set("u_cat", d.cat); }
  if (d.c) { S.cat = d.c; store.set("u_cat", d.c); renderView(); }
  if (d.save) { S.saved.has(d.save) ? S.saved.delete(d.save) : S.saved.add(d.save); store.set("u_saved", [...S.saved]); el.textContent = S.saved.has(d.save) ? t("saved") : t("save"); }
  if (d.share) {
    const raw = S.items.find(i => i.id === d.share), it = it$(raw), link = shareLink();
    const ok = await copy(`${it.title}\n${it.get}\n${t("deadline")}: ${raw.rolling ? t("always_open") : it.dueText}\n${t("official")}: ${raw.link}\n✓ Unshaken${link ? "\n" + link : ""}`, el);
    if (ok) { S.shares++; store.set("u_shares", S.shares); if (S.captain && S.env.db) api("captain", { action: "event", code: S.captain.code, kind: "share", device: S.device + ":" + Date.now() }).catch(() => {}); }
  }
  if (d.copylink) copy(shareLink(), el);
  if (d.sprint) {
    const raw = S.items.find(i => i.id === d.sprint);
    if (!S.sprints.some(s => s.id === raw.id)) { S.sprints.push(makeSprint(raw)); store.set("u_sprints", S.sprints); }
    location.hash = "#sprint"; if (view === "sprint") renderView();
  }
  if (d.unsprint) { S.sprints = S.sprints.filter(s => s.id !== d.unsprint); store.set("u_sprints", S.sprints); renderView(); }
  if (d.remind) {
    const sp = S.sprints.find(s => s.id === d.remind), raw = S.items.find(i => i.id === d.remind), it = it$(raw);
    const next = sp.tasks.find(x => !x.done);
    copy(`⏰ ${it.title}\n${t("deadline")}: ${it.dueText}\n${t("today")}: ${next ? next.txt : "✓"}\n${raw.link}`, el);
  }
  if (d.ics) {
    const sp = S.sprints.find(s => s.id === d.ics), raw = S.items.find(i => i.id === d.ics);
    const a = document.createElement("a"); a.href = URL.createObjectURL(new Blob([ics(raw, sp)], { type: "text/calendar" })); a.download = `unshaken-${raw.id}.ics`; a.click();
  }
});
document.addEventListener("change", e => {
  const d = e.target.dataset;
  if (d.task) { buzz(); const [id, i] = d.task.split(":"), sp = S.sprints.find(s => s.id === id); sp.tasks[+i].done = e.target.checked; store.set("u_sprints", S.sprints); renderNav(); renderView(); }
});

/* ---------- language ---------- */
async function setLang(code) {
  S.lang = code; store.set("u_lang", code); document.documentElement.lang = code === "pcm" ? "en" : code;
  $("#betatag").hidden = code === "en"; S.tr = {};
  if (code !== "en") {
    const key = `u_tr_${code}_${S.updated}`, cached = store.get(key, null);
    if (cached) S.tr = cached;
    else {
      const items = S.items.map(i => ({ id: i.id, title: i.title, get: i.get, who: i.who, dueText: i.dueText || "", steps: i.steps }));
      try {
        if (S.env.api && S.env.ai) S.tr = (await api("translate", { lang: code, items })).items || {};
        else if (S.sample) { const name = LANGS.find(l => l.code === code).name; const r = await previewAI(`Translate these listings into ${name}. Keep programme/organisation names, currencies, numbers, dates and URLs unchanged. JSON only: {"items":{"<id>":{"title":"","get":"","who":"","dueText":"","steps":[""]}}}\n${JSON.stringify(items)}`); S.tr = r?.items || {}; }
        if (Object.keys(S.tr).length) store.set(key, S.tr);
      } catch {}
    }
  }
  renderNav(); renderView();
}

/* ---------- listen mode ---------- */
let speaking = false;
function stopSpeak() { try { speechSynthesis.cancel(); } catch {} speaking = false; const b = $("#listen"); if (b) { b.setAttribute("aria-pressed", "false"); b.textContent = t("listen"); } }
function speak() {
  if (!("speechSynthesis" in window)) { toast("Listen isn't supported on this browser"); return; }
  const src = view === "drop" ? $("#sbody") : $("#main");
  const text = (src?.innerText || src?.textContent || "").replace(/\s+/g, " ").slice(0, 3000); if (!text) return;
  const want = LANGS.find(l => l.code === S.lang).voice, voices = speechSynthesis.getVoices();
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find(x => x.lang.toLowerCase().startsWith(want.toLowerCase())) || voices.find(x => x.lang.startsWith(want.slice(0, 2)));
  if (v) u.voice = v; else if (S.lang !== "en") toast("No voice for this language on your phone; reading in the closest voice.");
  u.lang = v ? v.lang : want; u.rate = 0.95;
  u.onend = stopSpeak; speechSynthesis.speak(u); speaking = true;
  $("#listen").setAttribute("aria-pressed", "true"); $("#listen").textContent = t("stop");
}
$("#listen").onclick = () => speaking ? stopSpeak() : speak();

/* ---------- ticking ---------- */
function tick() {
  const d = new Date(), mid = new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1), r = Math.floor((mid - d) / 1000);
  $("#reset").textContent = `${t("newdrop")} ${pad(Math.floor(r / 3600))}:${pad(Math.floor(r % 3600 / 60))}:${pad(r % 60)}`;
  if (view !== "drop" || !$("#sbody") || !$("#modal").hidden) return;
  if (Date.now() - start >= DUR && idx < STORIES.length - 1 && !speaking) goStory(idx + 1);
  document.querySelectorAll(".bars b").forEach((b, i) => { b.style.width = (i < idx ? 100 : i > idx ? 0 : Math.min(100, (Date.now() - start) / DUR * 100)) + "%"; });
  if (STORIES[idx].live) paintStory();
}

/* ---------- boot ---------- */
async function boot() {
  $("#lang").innerHTML = LANGS.map(l => `<option value="${l.code}">${l.name}${l.code === "en" ? "" : " (beta)"}</option>`).join("");
  if (!LANGS.some(l => l.code === S.lang)) S.lang = "en";
  $("#lang").value = S.lang; $("#lang").onchange = e => setLang(e.target.value);
  try {
    const d = await fetch("data/listings.json").then(r => r.json());
    S.items = d.items; S.rates = d.rates; S.regions = d.regions || {}; S.updated = d.updated;
  } catch { $("#main").innerHTML = `<p class="empty">${t("error")}</p>`; return; }
  try { const h = await fetch("/api/health").then(r => r.ok ? r.json() : null); if (h && h.ok) S.env = { api: true, ai: !!h.ai, db: !!h.db }; } catch {}
  // Listings the owner approved in the admin queue (only status=approved ever comes back from this endpoint)
  if (S.env.db) {
    try {
      const live = await fetch("/api/listings").then(r => r.ok ? r.json() : null);
      const have = new Set(S.items.map(i => i.id)), links = new Set(S.items.map(i => String(i.link).replace(/\/+$/, "")));
      for (const it of live?.items || []) if (!have.has(it.id) && !links.has(String(it.link).replace(/\/+$/, ""))) S.items.push(it);
    } catch {}
  }
  S.alerts = store.get("u_alerts", false);
  if (S.env.api) { api("push").then(p => { S.push = p; }).catch(() => {}); if (S.env.db) api("radar").then(r => { if (r.enabled) S.radar = r; }).catch(() => {}); }
  if (!S.env.api && window.claude?.use) claude.use("sample").then(x => { S.sample = x; }).catch(() => {});
  // referral visit (once per device per code)
  const ref = new URLSearchParams(location.search).get("c");
  if (ref && S.env.db && !store.get("u_ref_" + ref, false)) { api("captain", { action: "event", code: ref, kind: "visit", device: S.device }).then(() => store.set("u_ref_" + ref, true)).catch(() => {}); }
  // daily streak (consecutive days with a visit)
  const today = new Date().toISOString().slice(0, 10), days = store.get("u_days", []);
  if (days[days.length - 1] !== today) { days.push(today); store.set("u_days", days.slice(-60)); }
  let n = 0; for (let i = days.length - 1, d = new Date(today); i >= 0; i--, d = new Date(d.getTime() - DAY)) { if (days[i] === d.toISOString().slice(0, 10)) n++; else break; }
  S.streak = n; if (n > 1) { $("#streak").hidden = false; $("#streak").textContent = t("streak", { n }); }
  if ("serviceWorker" in navigator && S.env.api && location.protocol === "https:") navigator.serviceWorker.register("/sw.js").catch(() => {});
  addEventListener("hashchange", route);
  route();
  if (!store.get("u_seen", 0) && !location.hash) welcome();
  if (S.lang !== "en") setLang(S.lang);
  setInterval(tick, 500); tick();
}
boot();
}
