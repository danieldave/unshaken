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
/** "yes" | "maybe" | "no" for the saved profile. */
function fit(it) {
  const p = S.profile, e = it.elig || {};
  if (!p) return null;
  if (!Object.keys(e).length) return "yes";
  let maybe = false;
  const unknownCountry = p.country === "OTHER";
  if (e.levels) { if (p.level === "none" || !e.levels.includes(p.level)) return "no"; }
  if (e.exclude) {
    const ex = Array.isArray(e.exclude) ? e.exclude.includes(p.country) : inRegion(p.country, e.exclude);
    if (ex) return "no";
  }
  if (e.countries) { if (unknownCountry) maybe = true; else if (!e.countries.includes(p.country)) return "no"; }
  if (e.region) { if (unknownCountry) maybe = true; else if (!inRegion(p.country, e.region)) return "no"; }
  if (e.gender === "female") { if (p.gender === "male") return "no"; if (p.gender !== "female") maybe = true; }
  if (e.fields && !e.fields.includes(p.field)) return "no";
  if (e.student && p.student !== "yes") return "no";
  if (e.minWork && Number(p.work) < e.minWork) return "no";
  if (e.partnerCheck) maybe = true;
  return maybe ? "maybe" : "yes";
}
const openItems = () => S.items.filter(i => i.rolling || i.opens || left(i.due).total);
const fitCount = () => openItems().filter(i => fit(i) === "yes").length;

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
      ? `<span class="kick">${t("s_fit_k")}</span><div class="ring">${fitCount()}</div><h2>${t("s_fit_h", { n: fitCount() })}</h2>
         <div class="cta"><a class="btn go" href="#board" data-cat="fit">${t("s_fit_see")}</a><button class="btn" data-quiz>${t("q_edit")}</button></div>`
      : `<span class="kick">${t("s_fit_k")}</span><h2 style="font-size:34px">${t("s_fit_q")}</h2><p class="sub" style="margin:0">${t("q_sub")}</p>
         <div class="cta"><button class="btn go" data-quiz>${t("s_fit_cta")}</button></div>` },
  { glow: "var(--gold)", live: true, html: () => { const s = soon(); if (!s) return `<span class="kick">${t("s_close")}</span><a class="btn" href="#board">${t("s_all")}</a>`;
    const x = it$(s), l = left(s.due), f = fit(s);
    return `<span class="kick" style="color:var(--gold)">${t("s_close")} · ${t("cat_" + s.cat)}</span>
    <h2 style="font-size:28px">${esc(x.title)}</h2><p class="sub" style="margin:0">${esc(x.get)}</p>
    <div class="clock">${[[l.d, "days"], [l.h, "hrs"], [l.m, "min"], [l.s, "sec"]].map(([v, u]) => `<div><b>${pad(v)}</b><small>${u}</small></div>`).join("")}</div>
    ${f ? `<span class="fit ${f}">${t("fit_" + f)}</span>` : ""}
    <div class="cta"><a class="btn gold" href="${esc(s.link)}" target="_blank" rel="noopener">${t("s_open")}</a><button class="btn" data-sprint="${s.id}">${t("s_sprint")}</button></div>`; } },
  { glow: "var(--mint)", html: () => `<span class="kick">${t("s_earn_k")}</span><h2 style="font-size:30px">${t("s_earn_h")}</h2>
    <div class="tiles"><div class="tile"><strong>CrowdGen</strong><span class="sub">200 countries</span></div><div class="tile"><strong>Mindrift</strong><span class="sub">Nigeria ✓</span></div></div>
    <p class="sub" style="margin:0">${t("s_earn_sub")}</p><div class="cta"><a class="btn" href="#board" data-cat="Earn">${t("s_earn_cta")}</a></div>` },
  { glow: "var(--coral)", html: () => `<span class="kick" style="color:var(--coral)">${t("s_scam_k")}</span><h2 style="font-size:30px">${t("s_scam_h")}</h2>
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
    <p><strong>${t("who")}:</strong> ${esc(it.who)}</p>
    ${raw.rolling ? "" : `<p><strong>${t("deadline")}:</strong> ${esc(it.dueText)}</p>`}
    ${f ? `<span class="fit ${f}">${t("fit_" + f)}</span>` : ""}
    ${raw.flag ? `<div class="note">${t("confirm")} ${esc(raw.flag)}</div>` : ""}
    <details><summary>${t("steps", { n: it.steps.length })}</summary><ol>${it.steps.map(s => `<li>${esc(s)}</li>`).join("")}</ol></details>
    <div class="acts"><a class="btn go sm" href="${esc(raw.link)}" target="_blank" rel="noopener">${t("official")}</a>
      <button class="btn sm" data-save="${raw.id}">${S.saved.has(raw.id) ? t("saved") : t("save")}</button>
      <button class="btn sm" data-share="${raw.id}">${t("share")}</button>
      <button class="btn sm" data-img="item:${raw.id}">${t("status_img")}</button>
      ${raw.rolling ? "" : `<button class="btn sm" data-sprint="${raw.id}">${inSprint ? t("in_sprint") : t("start_sprint")}</button>`}</div>
  </article>`;
}
function vBoard() {
  const cats = ["All", ...(S.profile ? ["fit"] : []), "Go", "Earn", "Learn", "Grow", "Saved"];
  if (!cats.includes(S.cat)) S.cat = "All";
  const rank = it => (fit(it) === "no" ? 1e16 : 0) + (it.rolling ? 9e15 : (left(it.due).total || 8e15));
  const list = S.items.filter(it => S.cat === "All" || (S.cat === "Saved" ? S.saved.has(it.id) : S.cat === "fit" ? fit(it) !== "no" : it.cat === S.cat)).sort((a, b) => rank(a) - rank(b));
  const q = (S.q || "").toLowerCase().trim();
  const shown = q ? list.filter(it => { const x = it$(it); return [x.title, x.get, x.who, it.cat].join(" ").toLowerCase().includes(q); }) : list;
  return `<h2 style="margin-top:18px">${t("board_title", { n: openItems().length })}</h2>
    <p class="sub" style="margin:6px 0 0">${t("board_sub")}</p>
    <div class="panel" style="margin-top:14px;padding:14px"><div class="row"><strong>${S.profile ? t("qualify_n", { n: fitCount() }) : t("q_title")}</strong>
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
  return `<div class="panel"><h2>${t("sprint_title")}</h2><p class="sub" style="margin:0">${t("sprint_sub")}</p></div>
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
  if (kind === "scam") return { accent: "coral", kicker: t("s_scam_k"), title: t("s_scam_h"), lines: [t("s_scam_1"), t("s_scam_2"), t("s_scam_3")], footer: t("s_scam_cta"), link };
  if (kind === "verdict") { const r = S.lastVerdict || {}; return { accent: r.verdict === "red" ? "coral" : "gold", kicker: t("s_scam_k"), title: r.summary || "", lines: [...(r.flags || []).slice(0, 4)], footer: t("s_scam_cta"), link }; }
  const raw = S.items.find(i => i.id === kind.split(":")[1]), it = it$(raw), l = raw.rolling ? null : left(raw.due);
  return { accent: raw.rolling ? "mint" : "gold", kicker: `${t("cat_" + raw.cat)} · ${raw.rolling ? t("always_open") : dueLabel(raw)[0]}`, title: it.title, big: l && l.total ? `${l.d}d ${pad(l.h)}h` : null, bigSub: raw.rolling ? null : it.dueText, lines: [it.get, it.who], footer: t("free_apply"), link };
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
  if ("shareapp" in d) { const link = shareLink() || location.href; try { if (navigator.share) { await navigator.share({ title: "Unshaken", text: t("share_app_sub"), url: link }); S.shares++; store.set("u_shares", S.shares); } else { await copy(link, null); toast(t("copied")); } } catch {} }
  if ("install" in d && installEvt) { installEvt.prompt(); installEvt = null; }
  if (d.save || d.sprint || d.share) buzz();
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
