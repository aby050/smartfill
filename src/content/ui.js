/* The review panel. Lives in a shadow root so no page stylesheet can touch it. */
(function () {
  const STYLE = `
  :host { all: initial; }
  .wrap { position: fixed; right: 16px; bottom: 16px; width: 340px; max-height: 72vh;
    display: flex; flex-direction: column; z-index: 2147483647;
    font: 13px/1.45 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    color: #16181d; background: #fff; border: 1px solid rgba(0,0,0,.12);
    border-radius: 12px; box-shadow: 0 12px 40px rgba(0,0,0,.18); overflow: hidden; }
  @media (prefers-color-scheme: dark) {
    .wrap { color: #e8e9ec; background: #1b1d22; border-color: rgba(255,255,255,.14); }
    .row { border-color: rgba(255,255,255,.08) !important; }
    input, textarea { background: #24262c !important; color: #e8e9ec !important; border-color: rgba(255,255,255,.16) !important; }
    .head, .foot { background: #1b1d22 !important; }
    .sub { color: #9aa0ab !important; }
  }
  .head { display: flex; align-items: center; gap: 8px; padding: 10px 12px;
    border-bottom: 1px solid rgba(128,128,128,.22); background: #fff; }
  .title { font-weight: 600; font-size: 13px; flex: 1; }
  .sub { color: #6b7280; font-size: 11px; font-weight: 400; }
  .x { cursor: pointer; border: 0; background: transparent; font-size: 16px; line-height: 1;
    color: inherit; opacity: .55; padding: 2px 4px; }
  .x:hover { opacity: 1; }
  .list { overflow-y: auto; flex: 1; }
  .row { padding: 8px 12px; border-bottom: 1px solid rgba(128,128,128,.14); cursor: pointer; }
  .row:hover { background: rgba(128,128,128,.08); }
  .rowtop { display: flex; align-items: baseline; gap: 6px; }
  .lbl { flex: 1; font-weight: 500; overflow: hidden; text-overflow: ellipsis; white-space: nowrap; }
  .tag { font-size: 10px; padding: 1px 5px; border-radius: 999px; font-weight: 600; letter-spacing: .02em; }
  .tag.ai { background: rgba(120,110,230,.16); color: #6a5fd6; }
  .tag.rule { background: rgba(34,160,110,.16); color: #1b8a5f; }
  .tag.skip { background: rgba(150,150,150,.18); color: #7a7f88; }
  .tag.fail { background: rgba(220,70,70,.16); color: #c0392b; }
  .val { margin-top: 3px; font-size: 12px; color: #4b5563; word-break: break-word;
    display: -webkit-box; -webkit-line-clamp: 2; -webkit-box-orient: vertical; overflow: hidden; }
  @media (prefers-color-scheme: dark) { .val { color: #a8aeb9; } }
  .edit { margin-top: 6px; width: 100%; box-sizing: border-box; padding: 5px 7px; font: inherit;
    border: 1px solid rgba(128,128,128,.35); border-radius: 6px; background: #fff; color: inherit; }
  .foot { display: flex; gap: 8px; padding: 10px 12px; border-top: 1px solid rgba(128,128,128,.22); background:#fff; }
  button.b { flex: 1; padding: 7px 10px; border-radius: 8px; border: 1px solid rgba(128,128,128,.3);
    background: transparent; color: inherit; font: inherit; font-weight: 500; cursor: pointer; }
  button.b:hover { background: rgba(128,128,128,.12); }
  button.b.pri { background: #5b54d6; border-color: #5b54d6; color: #fff; }
  button.b.pri:hover { background: #4a43c9; }
  .empty { padding: 22px 14px; text-align: center; color: #6b7280; }
  .spin { display:inline-block; width:10px; height:10px; border:2px solid rgba(128,128,128,.35);
    border-top-color:#5b54d6; border-radius:50%; animation: sp .7s linear infinite; }
  @keyframes sp { to { transform: rotate(360deg); } }
  a.lnk { color: #5b54d6; cursor: pointer; text-decoration: underline; }
  .rolebar { display: flex; align-items: center; gap: 6px; padding: 7px 12px;
    border-bottom: 1px solid rgba(128,128,128,.18); background: rgba(91,84,214,.06); }
  .rolebar span { font-size: 11px; color: #6b7280; white-space: nowrap; }
  @media (prefers-color-scheme: dark) { .rolebar span { color: #9aa0ab; } .rolebar { background: rgba(139,132,255,.10); } }
  .rolebar select { flex: 1; font: inherit; font-size: 12px; padding: 3px 5px; color: inherit;
    background: transparent; border: 1px solid rgba(128,128,128,.32); border-radius: 6px; }
  .tag.file { background: rgba(40,140,200,.16); color: #1a7ba8; }
  .tag.role { background: rgba(91,84,214,.16); color: #5b54d6; }
  .tag.consent { background: rgba(220,150,40,.2); color: #a8700f; }
  .tag.saved { background: rgba(34,160,110,.16); color: #1b8a5f; }
  .tag.passenger { background: rgba(40,140,200,.16); color: #1a7ba8; }
  .fit { padding: 10px 12px; border-bottom: 1px solid rgba(128,128,128,.18); }
  .fitbtn { width: 100%; padding: 7px; border-radius: 8px; border: 1px dashed rgba(128,128,128,.45);
    background: transparent; color: inherit; font: inherit; font-size: 12px; cursor: pointer; }
  .fitbtn:hover { background: rgba(128,128,128,.1); }
  .fithead { display: flex; align-items: center; gap: 10px; }
  .score { font-size: 26px; font-weight: 700; line-height: 1; min-width: 52px; }
  .score small { font-size: 11px; font-weight: 500; opacity: .6; }
  .verdict { font-size: 12px; flex: 1; }
  .bar { height: 5px; border-radius: 999px; background: rgba(128,128,128,.22); margin: 8px 0 6px; overflow: hidden; }
  .bar i { display: block; height: 100%; border-radius: 999px; transition: width .5s ease; }
  .fitdet { font-size: 12px; margin-top: 4px; }
  .fitdet h4 { margin: 8px 0 3px; font-size: 11px; text-transform: uppercase;
    letter-spacing: .04em; color: #6b7280; font-weight: 600; }
  .fitdet ul { margin: 0; padding-left: 16px; }
  .fitdet li { margin-bottom: 2px; }
  .chips { display: flex; flex-wrap: wrap; gap: 4px; }
  .chip { font-size: 10px; padding: 2px 6px; border-radius: 999px;
    background: rgba(220,150,40,.16); color: #a8700f; }
  @media (prefers-color-scheme: dark) { .fitdet h4 { color: #9aa0ab; } .chip { color: #d9a94a; } }
  .fitfoot { display: flex; gap: 10px; margin-top: 8px; font-size: 11px; color: #6b7280; }
  `;

  let host, root, api = {};

  /* ---- floating launcher ----
     Appears by itself once a page turns out to have a fillable form, so filling
     is one click on the page instead of a trip through the toolbar menu. */

  const FAB_STYLE = `
  :host { all: initial; }
  .fab { position: fixed; right: 18px; bottom: 18px; z-index: 2147483646;
    display: flex; align-items: center; gap: 0;
    font: 500 13px/1 -apple-system, BlinkMacSystemFont, "Segoe UI", system-ui, sans-serif;
    background: #5b54d6; color: #fff; border-radius: 999px;
    box-shadow: 0 6px 20px rgba(40,34,120,.34);
    animation: pop .22s cubic-bezier(.2,.9,.3,1.2); }
  @keyframes pop { from { opacity: 0; transform: translateY(8px) scale(.94); } }
  .go { display: flex; align-items: center; gap: 7px; padding: 11px 14px;
    cursor: pointer; border: 0; background: transparent; color: inherit; font: inherit;
    border-radius: 999px 0 0 999px; }
  .go:hover { background: rgba(255,255,255,.12); }
  .mark { width: 15px; height: 15px; flex: none; }
  .n { background: rgba(255,255,255,.2); border-radius: 999px; padding: 2px 7px; font-size: 11px; }
  .close { padding: 11px 12px 11px 6px; cursor: pointer; border: 0; background: transparent;
    color: rgba(255,255,255,.75); font-size: 15px; line-height: 1;
    border-radius: 0 999px 999px 0; }
  .close:hover { color: #fff; background: rgba(255,255,255,.12); }
  .busy .go { opacity: .75; cursor: default; }
  .spin { width: 13px; height: 13px; border: 2px solid rgba(255,255,255,.35);
    border-top-color: #fff; border-radius: 50%; animation: sp .7s linear infinite; flex: none; }
  @keyframes sp { to { transform: rotate(360deg); } }
  `;

  const TICK = '<svg class="mark" viewBox="0 0 24 24" fill="none" aria-hidden="true">'
    + '<rect x="3" y="4" width="18" height="4.5" rx="1.2" fill="currentColor"/>'
    + '<path d="M5 15.5l3.6 3.4L20 9.6" stroke="currentColor" stroke-width="2.6" '
    + 'stroke-linecap="round" stroke-linejoin="round"/></svg>';

  let fabHost = null;

  function hideLauncher() {
    if (fabHost) { fabHost.remove(); fabHost = null; }
  }

  /** opts: { count, onFill, onDismiss } */
  function showLauncher(opts) {
    hideLauncher();
    fabHost = document.createElement('div');
    fabHost.className = 'sf-panel';
    fabHost.style.cssText = 'all:initial;position:fixed;z-index:2147483646;';
    const r = fabHost.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = FAB_STYLE;
    r.appendChild(st);

    const bar = document.createElement('div');
    bar.className = 'fab';

    const go = document.createElement('button');
    go.className = 'go';
    go.innerHTML = TICK;
    const label = document.createElement('span');
    label.textContent = 'Fill this form';
    go.append(label);
    if (opts.count) {
      const n = document.createElement('span');
      n.className = 'n';
      n.textContent = String(opts.count);
      go.append(n);
    }
    go.onclick = async () => {
      if (bar.classList.contains('busy')) return;
      bar.classList.add('busy');
      go.querySelector('.mark').outerHTML = '<span class="spin"></span>';
      label.textContent = 'Filling…';
      try { await opts.onFill(); } finally { hideLauncher(); }
    };

    const x = document.createElement('button');
    x.className = 'close';
    x.textContent = '\u00d7';
    x.title = 'Not on this site';
    x.onclick = () => { hideLauncher(); opts.onDismiss && opts.onDismiss(); };

    bar.append(go, x);
    r.appendChild(bar);
    document.documentElement.appendChild(fabHost);
  }


  function ensure() {
    hideLauncher();                 // the panel takes over the same corner
    if (host && host.isConnected) return;
    host = document.createElement('div');
    host.className = 'sf-panel';
    host.style.cssText = 'all:initial;position:fixed;z-index:2147483647;';
    root = host.attachShadow({ mode: 'open' });
    const st = document.createElement('style');
    st.textContent = STYLE;
    root.appendChild(st);
    const wrap = document.createElement('div');
    wrap.className = 'wrap';
    root.appendChild(wrap);
    document.documentElement.appendChild(host);
  }

  function el(tag, cls, text) {
    const n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  function status(text, busy) {
    ensure();
    const wrap = root.querySelector('.wrap');
    wrap.innerHTML = '';
    const head = el('div', 'head');
    head.append(el('div', 'title', 'Smartfill'));
    const x = el('button', 'x', '×');
    x.onclick = close;
    head.append(x);
    wrap.append(head);
    const e = el('div', 'empty');
    if (busy) { e.append(el('span', 'spin'), document.createTextNode(' ')); }
    e.append(document.createTextNode(text));
    wrap.append(e);
  }

  function close() {
    if (host) host.remove();
    document.querySelectorAll('.sf-hl-filled,.sf-hl-ai,.sf-hl-review,.sf-hl-focus')
      .forEach(n => n.classList.remove('sf-hl-filled', 'sf-hl-ai', 'sf-hl-review', 'sf-hl-focus'));
  }

  /** results: [{field, key, value, via, ok, reason, needsReview}] */
  function showResults(results, handlers) {
    ensure();
    api = handlers || {};
    const wrap = root.querySelector('.wrap');
    wrap.innerHTML = '';

    const filled = results.filter(r => r.ok);
    const head = el('div', 'head');
    const t = el('div', 'title', 'Smartfill');
    t.append(el('span', 'sub', `  ${filled.length} of ${results.length} filled`));
    head.append(t);
    const x = el('button', 'x', '×'); x.onclick = close; head.append(x);
    wrap.append(head);

    if (handlers && handlers.roles && handlers.roles.length) {
      const bar = el('div', 'rolebar');
      bar.append(el('span', null, 'Role'));
      const sel = el('select');
      const none = el('option', null, '— base profile —'); none.value = '';
      sel.append(none);
      for (const r of handlers.roles) {
        const o = el('option', null, r.name); o.value = r.id;
        if (handlers.role && handlers.role.id === r.id) o.selected = true;
        sel.append(o);
      }
      sel.onchange = () => handlers.onRole && handlers.onRole(sel.value);
      bar.append(sel);
      bar.append(el('span', null, viaWord(handlers.roleVia)));
      wrap.append(bar);
    }

    if (handlers && handlers.canScore && handlers.onScore) wrap.append(buildFit(handlers));

    const list = el('div', 'list');
    if (!results.length) list.append(el('div', 'empty', 'No fillable fields found on this page.'));

    for (const r of results) {
      const row = el('div', 'row');
      const top = el('div', 'rowtop');
      top.append(el('div', 'lbl', r.field.label || r.field.name || '(unlabelled)'));
      const kind = r.via === 'consent' ? 'consent' : r.via === 'passenger' && r.ok ? 'passenger'
        : r.via === 'saved' && r.ok ? 'saved'
        : !r.ok ? 'fail' : r.isFile ? 'file' : r.via === 'ai' ? 'ai' : r.via === 'role' ? 'role' : r.via === 'skipped' ? 'skip' : 'rule';
      const tagText = r.via === 'consent' ? 'consent — your call'
        : !r.ok ? (r.reason || 'failed')
        : r.isFile ? 'attached'
        : r.via === 'passenger' ? 'passenger row'
        : r.via === 'saved' ? 'your saved answer'
        : r.via === 'ai' ? 'AI' : r.via === 'role' ? 'role' : r.via === 'skipped' ? 'skipped' : 'matched';
      top.append(el('span', 'tag ' + kind, tagText));
      row.append(top);
      row.append(el('div', 'val', r.value ? String(r.value) : '—'));

      row.onclick = (ev) => {
        if (ev.target.classList.contains('edit')) return;
        if (r.isFile) { highlight(r.field.el); return; }
        if (row.querySelector('.edit')) { row.querySelector('.edit').focus(); return; }
        highlight(r.field.el);
        const inp = el(String(r.value || '').length > 60 ? 'textarea' : 'input', 'edit');
        inp.value = r.value || '';
        if (inp.tagName === 'TEXTAREA') inp.rows = 4;
        inp.onclick = e => e.stopPropagation();
        inp.onkeydown = e => {
          if (e.key === 'Enter' && inp.tagName === 'INPUT') { e.preventDefault(); commit(); }
          if (e.key === 'Escape') { inp.remove(); }
        };
        inp.onblur = commit;
        function commit() {
          const v = inp.value;
          inp.remove();
          if (v !== r.value && api.onEdit) api.onEdit(r, v);
          r.value = v;
          row.querySelector('.val').textContent = v || '—';
        }
        row.append(inp);
        inp.focus();
      };
      list.append(row);
    }
    wrap.append(list);

    const foot = el('div', 'foot');
    const undo = el('button', 'b', 'Undo all');
    undo.onclick = () => { api.onUndo && api.onUndo(); close(); };
    const again = el('button', 'b pri', 'Ask Claude again');
    again.onclick = () => api.onRetryAI && api.onRetryAI();
    foot.append(undo, again);
    wrap.append(foot);
  }

  /* ---- job fit ---- */

  function scoreColour(n) {
    if (n >= 75) return '#1b8a5f';
    if (n >= 50) return '#c98a16';
    return '#c0392b';
  }

  function buildFit(handlers) {
    const box = el('div', 'fit');
    const btn = el('button', 'fitbtn', handlers.resumeUsed
      ? `Score this job against ${handlers.resumeUsed.filename}`
      : 'Score this job against my profile');
    btn.onclick = () => run(false);
    box.append(btn);

    async function run(force) {
      box.innerHTML = '';
      const wait = el('div', 'fithead');
      wait.append(el('span', 'spin'), el('span', 'verdict', force ? 'Rescoring…' : 'Reading the posting…'));
      box.append(wait);

      let fit;
      try { fit = await handlers.onScore(force); } catch (e) { fit = { ok: false, error: String(e.message || e) }; }

      box.innerHTML = '';
      if (!fit || !fit.ok) {
        const again = el('button', 'fitbtn', 'Scoring failed — ' + ((fit && fit.error) || 'unknown') + '. Try again');
        again.onclick = () => run(true);
        box.append(again);
        return;
      }
      render(fit);
    }

    function render(fit) {
      const n = Math.max(0, Math.min(100, Number(fit.score) || 0));
      const colour = scoreColour(n);

      const head = el('div', 'fithead');
      const sc = el('div', 'score', String(n));
      sc.style.color = colour;
      sc.append(el('small', null, '/100'));
      head.append(sc, el('div', 'verdict', fit.verdict || ''));
      box.append(head);

      const bar = el('div', 'bar');
      const f = el('i');
      f.style.width = n + '%';
      f.style.background = colour;
      bar.append(f);
      box.append(bar);

      const det = el('div', 'fitdet');
      det.hidden = true;
      addList(det, 'Where you match', fit.strengths);
      addList(det, 'Gaps', fit.gaps);
      if ((fit.missing_keywords || []).length) {
        det.append(el('h4', null, 'Words the posting uses that your resume never does'));
        const chips = el('div', 'chips');
        for (const k of fit.missing_keywords.slice(0, 14)) chips.append(el('span', 'chip', k));
        det.append(chips);
      }
      addList(det, 'Worth changing before you send it', fit.resume_tweaks);
      box.append(det);

      const foot = el('div', 'fitfoot');
      const toggle = el('a', 'lnk', 'Details');
      toggle.onclick = () => { det.hidden = !det.hidden; toggle.textContent = det.hidden ? 'Details' : 'Hide'; };
      const again = el('a', 'lnk', 'Rescore');
      again.onclick = () => run(true);
      foot.append(toggle, again);
      if (fit.cached) foot.append(el('span', null, 'cached'));
      box.append(foot);
    }

    function addList(host, title, items) {
      if (!items || !items.length) return;
      host.append(el('h4', null, title));
      const ul = el('ul');
      for (const it of items.slice(0, 5)) ul.append(el('li', null, it));
      host.append(ul);
    }

    return box;
  }

  function viaWord(via) {
    return { keywords: 'matched by keyword', ai: 'chosen by Claude', pinned: 'pinned',
      default: 'default', you: 'your pick', none: '' }[via] || '';
  }

  function highlight(node) {
    if (!node) return;
    document.querySelectorAll('.sf-hl-focus').forEach(n => n.classList.remove('sf-hl-focus'));
    node.classList.add('sf-hl-focus');
    node.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  function mark(field, via, ok) {
    const c = !ok ? 'sf-hl-review' : via === 'ai' ? 'sf-hl-ai' : 'sf-hl-filled';
    field.el && field.el.classList.add(c);
  }

  function toast(msg) { status(msg, false); setTimeout(close, 2600); }

  globalThis.SF_UI = { status, showResults, close, mark, toast, highlight, showLauncher, hideLauncher };
})();
