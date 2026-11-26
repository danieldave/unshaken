/* ODS command palette — ⌘K / Ctrl+K (and "/") to jump anywhere.
   Usage: <script src="/ds/cmdk.js"></script> then
   ODS.cmdk([{ group:'Tools', icon:'🏝️', title:'Code Island', hint:'Coding adventure', href:'/code-island/', keywords:'learn game' }, ...])
   Items may use run: () => {} instead of href. */
(function () {
  var items = [], el, input, list, active = 0, shown = [];
  function esc(s) { return String(s == null ? '' : s).replace(/[&<>"']/g, function (c) { return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]; }); }
  function build() {
    el = document.createElement('div'); el.className = 'o-cmdk'; el.setAttribute('role', 'dialog'); el.setAttribute('aria-modal', 'true'); el.setAttribute('aria-label', 'Jump to');
    el.innerHTML = '<div class="o-cmdk-box"><input class="o-cmdk-in" placeholder="Jump to anything…" aria-label="Search" autocomplete="off" spellcheck="false"><div class="o-cmdk-list" role="listbox"></div><div class="o-cmdk-ft"><span><span class="o-kbd">↑</span> <span class="o-kbd">↓</span> move</span><span><span class="o-kbd">↵</span> open</span><span><span class="o-kbd">esc</span> close</span></div></div>';
    document.body.appendChild(el); input = el.querySelector('input'); list = el.querySelector('.o-cmdk-list');
    el.addEventListener('mousedown', function (e) { if (e.target === el) close(); });
    input.addEventListener('input', draw);
    input.addEventListener('keydown', function (e) {
      if (e.key === 'ArrowDown') { e.preventDefault(); move(1); } else if (e.key === 'ArrowUp') { e.preventDefault(); move(-1); }
      else if (e.key === 'Enter') { e.preventDefault(); go(shown[active]); } else if (e.key === 'Escape') close();
    });
  }
  function score(it, q) {
    if (!q) return 1; var hay = (it.title + ' ' + (it.hint || '') + ' ' + (it.group || '') + ' ' + (it.keywords || '')).toLowerCase();
    var t = it.title.toLowerCase(); if (t.indexOf(q) === 0) return 3; if (t.indexOf(q) >= 0) return 2;
    return q.split(/\s+/).every(function (w) { return hay.indexOf(w) >= 0; }) ? 1 : 0;
  }
  function draw() {
    var q = input.value.trim().toLowerCase();
    shown = items.map(function (it) { return [score(it, q), it]; }).filter(function (x) { return x[0] > 0; }).sort(function (a, b) { return b[0] - a[0]; }).map(function (x) { return x[1]; });
    if (!q) shown = items.slice();
    active = 0; var g = '', h = '';
    shown.forEach(function (it, i) {
      if (!q && it.group !== g) { g = it.group; h += '<div class="o-cmdk-g">' + esc(g) + '</div>'; }
      h += '<div class="o-cmdk-it" role="option" data-i="' + i + '"><span class="o-ic">' + esc(it.icon || '→') + '</span><span><span>' + esc(it.title) + '</span>' + (it.hint ? '<small>' + esc(it.hint) + '</small>' : '') + '</span></div>';
    });
    list.innerHTML = h || '<div class="o-cmdk-empty">No matches. Try another word.</div>';
    [].forEach.call(list.querySelectorAll('.o-cmdk-it'), function (n) {
      n.addEventListener('mousemove', function () { active = +n.dataset.i; mark(); });
      n.addEventListener('click', function () { go(shown[+n.dataset.i]); });
    });
    mark();
  }
  function mark() { [].forEach.call(list.querySelectorAll('.o-cmdk-it'), function (n) { var on = +n.dataset.i === active; n.classList.toggle('on', on); if (on) n.scrollIntoView({ block: 'nearest' }); }); }
  function move(d) { if (!shown.length) return; active = (active + d + shown.length) % shown.length; mark(); }
  function go(it) { if (!it) return; close(); if (it.run) it.run(); else if (it.href) { if (/^https?:/.test(it.href)) window.open(it.href, '_blank', 'noopener'); else location.href = it.href; } }
  function open() { if (!el) build(); el.classList.add('on'); input.value = ''; draw(); setTimeout(function () { input.focus(); }, 10); }
  function close() { if (el) el.classList.remove('on'); }
  document.addEventListener('keydown', function (e) {
    var typing = /input|textarea|select/i.test((e.target && e.target.tagName) || '') || (e.target && e.target.isContentEditable);
    if ((e.key === 'k' || e.key === 'K') && (e.metaKey || e.ctrlKey)) { e.preventDefault(); el && el.classList.contains('on') ? close() : open(); }
    else if (e.key === '/' && !typing) { e.preventDefault(); open(); }
  });
  window.ODS = window.ODS || {};
  window.ODS.cmdk = function (list) { items = list || []; return { open: open, close: close }; };
  window.ODS.openCmdk = open;
})();
