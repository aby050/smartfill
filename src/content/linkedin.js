/* LinkedIn Find & Apply: one button searches remote PM jobs open to India (worldwide / APAC),
   skips country-locked ones, and walks each Easy Apply form with Smartfill's own filler.
   State lives in sessionStorage so the run survives LinkedIn's page reloads in this tab. */
(() => {
  if (window.top !== window) return;
  const sleep = ms => new Promise(r => setTimeout(r, ms));
  // Company-site apply: LinkedIn opened this tab a moment ago, so fill and submit it the way auto-apply does.
  if (!/(^|\.)linkedin\.com$/.test(location.hostname)) {
    chrome.storage.local.get('sf_li_external').then(async ({ sf_li_external: x }) => {
      if (!x || Date.now() - x.at > 90000) return;
      await chrome.storage.local.remove('sf_li_external');
      await sleep(3500);
      globalThis.SF_MAIN?.autoApply?.();
    });
    return;
  }
  const jitter = (a, b) => sleep(a + Math.random() * (b - a));
  const KEY = 'sf_li_run';
  const DAILY_CAP = 30;
  // f_WT=2 remote, f_TPR last week. Two searches per keyword: India (remote jobs that hire from India)
  // and Worldwide (whose results are mostly country-locked, so the card's location is checked).
  const KEYWORDS = ['technical program manager', 'project manager', 'program manager', 'product manager', 'delivery manager', 'product owner'];
  const GEOS = ['102713980', '92000000'];
  const searchUrl = k => `https://www.linkedin.com/jobs/search/?keywords=${encodeURIComponent(KEYWORDS[k >> 1])}&geoId=${GEOS[k & 1]}&f_WT=2&f_TPR=r604800&sortBy=DD`;
  const OPEN_LOC = /(worldwide|anywhere|apac|asia|india)/i;
  const TITLE = /(program manager|project manager|product manager|delivery manager|product owner|scrum master|head of (product|delivery|program))/i;
  // Remote, but only for one country/region that isn't open to someone living in India.
  const LOCKED = /(\b(us|usa|u\.s\.|uk|eu|canada|europe|emea|latam)[- ]only\b|only (open to|available to) candidates (in|based in) (the )?(us|united states|uk|canada|europe)|must (be|reside|live) (located |based )?in (the )?(us|usa|united states|uk|united kingdom|canada|europe|eu)|authori[sz]ed to work in (the )?(us|united states|uk|canada)|(pst|est|cst|us) (time ?zone|hours) (required|only)|security clearance)/i;

  const state = () => { try { return JSON.parse(sessionStorage.getItem(KEY)) || null; } catch { return null; } };
  const save = s => sessionStorage.setItem(KEY, JSON.stringify(s));
  const stop = msg => { sessionStorage.removeItem(KEY); paint(msg); };
  const vis = el => el && el.getClientRects().length > 0;
  const btn = (root, re) => [...root.querySelectorAll('button')].find(b => vis(b) && !b.disabled && re.test((b.getAttribute('aria-label') || '') + ' ' + b.innerText));
  const waitFor = async (fn, ms = 8000) => { for (let t = 0; t < ms; t += 250) { const v = fn(); if (v) return v; await sleep(250); } return null; };

  async function todayCount() {
    const d = new Date().toDateString();
    const { sf_li_daily = {} } = await chrome.storage.local.get('sf_li_daily');
    return sf_li_daily.day === d ? sf_li_daily.n : 0;
  }
  async function bump() {
    const d = new Date().toDateString(), n = (await todayCount()) + 1;
    await chrome.storage.local.set({ sf_li_daily: { day: d, n } });
    return n;
  }
  async function log(title, company) {
    const { applications = [] } = await chrome.storage.local.get('applications');
    applications.push({ url: location.href.split(/[?#]/)[0], host: location.hostname, title: `${title} — ${company}`, at: Date.now(), mode: 'linkedin' });
    await chrome.storage.local.set({ applications: applications.slice(-500) });
  }

  // --- button + status pill ---
  let host, label;
  function paint(text) {
    if (!host) {
      host = document.createElement('div');
      host.setAttribute('data-smartfill-ui', '');
      host.style.cssText = 'position:fixed;left:20px;bottom:20px;z-index:2147483646';
      const sh = host.attachShadow({ mode: 'open' });
      sh.innerHTML = `<style>button{font:600 14px system-ui;padding:11px 16px;border:0;border-radius:22px;background:#0a66c2;color:#fff;cursor:pointer;box-shadow:0 4px 14px #0004;max-width:340px;text-align:left}button.on{background:#b42318}</style><button></button>`;
      label = sh.querySelector('button');
      label.onclick = () => state()?.active ? stop('Stopped. Click to start again.') : start();
      document.documentElement.append(host);
    }
    const on = !!state()?.active;
    label.className = on ? 'on' : '';
    label.textContent = on ? `■ Stop — ${text}` : (text || '▶ Smartfill: Find & Apply remote jobs');
  }

  async function start() {
    if ((await todayCount()) >= DAILY_CAP) return paint(`Daily cap of ${DAILY_CAP} reached — try tomorrow.`);
    save({ active: true, k: 0, seen: [], applied: 0, skipped: 0 });
    location.href = searchUrl(0);
  }

  const cards = () => [...document.querySelectorAll('[data-occludable-job-id], [data-job-id]')].filter(vis);
  const detailText = () => (document.querySelector('.jobs-search__job-details--container, .jobs-details, .job-view-layout') || document.body).innerText;

  async function discard() {
    const d = btn(document, /^Dismiss|Close/i); if (d) d.click();
    const c = await waitFor(() => btn(document, /Discard/i), 3000); if (c) c.click();
    await sleep(800);
  }

  // Walk one Easy Apply dialog. -> 'applied' | reason it was skipped
  async function easyApply() {
    const pane = document.querySelector('.jobs-search__job-details--container, .jobs-details, .job-view-layout') || document;
    const open = [...pane.querySelectorAll('button')].find(b => vis(b) && /^Easy Apply to /i.test(b.getAttribute('aria-label') || ''));
    if (!open) {
      const site = [...pane.querySelectorAll('button, a')].find(b => vis(b) && /^Apply to .* on company website|^\s*Apply\s*$/i.test((b.getAttribute('aria-label') || b.innerText || '').trim()));
      if (!site) return 'no apply button';
      await chrome.storage.local.set({ sf_li_external: { at: Date.now() } });
      site.click();
      await sleep(2500);
      const go = btn(document, /^Continue$|Continue to apply/i); if (go) go.click(); // LinkedIn's "leaving LinkedIn" prompt
      await sleep(30000); // the company tab fills and submits on its own
      return 'site';
    }
    open.click();
    const dlg = await waitFor(() => [...document.querySelectorAll('[role=dialog]')].find(vis));
    if (!dlg) return 'form did not open';
    for (let step = 0; step < 12; step++) {
      await sleep(900);
      const out = await globalThis.SF_MAIN.run({ auto: true, root: dlg });
      if (out?.blockers?.length) { await discard(); return 'needs you: ' + out.blockers.slice(0, 2).join(', '); }
      const unfollow = dlg.querySelector('input[type=checkbox][id*=follow]'); if (unfollow?.checked) unfollow.click();
      const submit = btn(dlg, /Submit application/i);
      if (submit) {
        submit.click();
        await sleep(2500);
        const done = btn(document, /^Dismiss|Done/i); if (done) done.click();
        return 'applied';
      }
      const next = btn(dlg, /Continue to next step|Review your application|^\s*(Next|Review)\s*$/i);
      if (!next) { await discard(); return 'no next button'; }
      next.click();
      await sleep(1200);
      if ([...dlg.querySelectorAll('.artdeco-inline-feedback--error, [data-test-form-element-error-messages]')].some(vis)) { await discard(); return 'a required answer was rejected'; }
    }
    await discard();
    return 'too many steps';
  }

  async function loop() {
    let s = state();
    if (!s?.active) return;
    if (!/\/jobs\/search/.test(location.pathname)) { location.href = searchUrl(s.k); return; }
    await waitFor(() => cards().length, 12000);
    for (;;) {
      s = state(); if (!s?.active) return;
      const card = cards().find(c => !s.seen.includes(c.dataset.occludableJobId || c.dataset.jobId));
      if (!card) break;
      const id = card.dataset.occludableJobId || card.dataset.jobId;
      s.seen.push(id); save(s);
      card.scrollIntoView({ block: 'center' });
      if (/\bApplied\b/.test(card.innerText)) continue;
      (card.querySelector('a') || card).click();
      await sleep(2500);
      const text = detailText().slice(0, 4000);
      const title = (card.querySelector('strong, .job-card-list__title, a') || card).innerText.split('\n')[0].trim();
      const company = (card.querySelector('.artdeco-entity-lockup__subtitle, .job-card-container__primary-description') || {}).innerText || '';
      const loc = (card.querySelector('.job-card-container__metadata-wrapper') || {}).innerText || '';
      const indiaSearch = GEOS[s.k & 1] === '102713980';
      if (!TITLE.test(title) || LOCKED.test(text) || (!indiaSearch && !OPEN_LOC.test(loc))) { s.skipped++; save(s); continue; }
      paint(`applying: ${title.slice(0, 40)}`);
      const r = await easyApply();
      s = state(); if (!s) return;
      if (r === 'applied' || r === 'site') {
        s.applied++; save(s); await log(title, company.trim());
        const n = await bump();
        if (n >= DAILY_CAP) return stop(`Done for today: ${s.applied} applied (cap ${DAILY_CAP}).`);
        paint(`${s.applied} applied, ${s.skipped} skipped`);
        await jitter(15000, 40000); // human pace, keeps the account safe
      } else { s.skipped++; save(s); paint(`${s.applied} applied, ${s.skipped} skipped (${r})`); await sleep(1500); }
    }
    s = state(); if (!s?.active) return;
    const more = btn(document, /View next page|^Next$/i);
    if (more) { more.click(); await sleep(3000); return loop(); }
    if (s.k + 1 < KEYWORDS.length * 2) { s.k++; save(s); location.href = searchUrl(s.k); return; }
    stop(`Finished: ${s.applied} applied, ${s.skipped} skipped.`);
  }

  const boot = () => { paint(state()?.active ? 'resuming…' : ''); if (state()?.active) loop().catch(e => stop('Stopped: ' + e.message)); };
  if (/\/jobs/.test(location.pathname)) boot();
  else { // LinkedIn is a SPA: show the button once the user lands on Jobs
    let last = location.pathname;
    setInterval(() => { if (location.pathname !== last) { last = location.pathname; if (/\/jobs/.test(last) && !host) boot(); } }, 1000);
  }
})();
