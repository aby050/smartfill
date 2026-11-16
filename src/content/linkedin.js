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
      globalThis.SF_MAIN?.autoApply?.(x.roleId);
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
  const OPEN_LOC = /(worldwide|anywhere|apac|asia|india|delhi|noida|gurgaon|gurugram|bengaluru|bangalore|mumbai|pune|hyderabad|chennai|kolkata|ahmedabad|jaipur|indore|kochi|chandigarh|bhopal)/i;
  const TITLE = /(program(me)? manag|project manag|product manag|delivery (manag|lead)|product owner|scrum master|\btpm\b|\bpmo\b|project lead|program lead|implementation (lead|manager)|engagement manager|head of (product|delivery|program))/i;
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
  // Every job tried, with its result, so applications can be checked later (options page → LinkedIn applications).
  async function log(id, title, company, loc, result) {
    const { sf_li_log = [] } = await chrome.storage.local.get('sf_li_log');
    sf_li_log.push({ at: Date.now(), url: `https://www.linkedin.com/jobs/view/${id}/`, title, company: company.trim(), location: loc.trim(), result });
    await chrome.storage.local.set({ sf_li_log: sf_li_log.slice(-2000) });
  }

  // Product vs project/program jobs get their own role profile (and so their own resume), picked from the
  // job TITLE — the description mentions both too often to decide on. Pinned roles are deliberately ignored here.
  const KIND = [['product', /product (manag|owner|lead)|head of product/i], ['project', /(project|program(me)?|delivery|technical program) (manag|lead)|scrum master|\btpm\b|\bpmo\b|implementation (lead|manager)|engagement manager|head of (delivery|program)/i]];
  async function roleFor(title) {
    const { roles = [] } = await chrome.storage.local.get('roles');
    const kind = (KIND.find(([, re]) => re.test(title)) || [])[0];
    if (kind) {
      const byName = roles.find(r => new RegExp('\\b' + kind + '\\b', 'i').test(r.name || ''));
      if (byName) return byName;
    }
    const hit = globalThis.SF_SCHEMA?.matchRole?.(roles, title);
    return hit ? hit.role : null;
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

  // LinkedIn's 2026 layout: no data-job-id and hashed class names. A card is the role=button ancestor of its
  // 'Dismiss <title> job' button; the job id only shows up in the URL (?currentJobId=) once the card is selected.
  const cardOf = b => b.closest('[role=button]');
  const cards = () => [...document.querySelectorAll('button[aria-label^="Dismiss"]')]
    .filter(b => / job$/.test(b.getAttribute('aria-label') || '')).map(cardOf).filter(c => c && vis(c));
  const cardKey = c => c.querySelector('button[aria-label^="Dismiss"]').getAttribute('aria-label') + '|' + (c.innerText.split('\n')[1] || '');
  const jobId = () => new URLSearchParams(location.search).get('currentJobId') || (location.pathname.match(/\/jobs\/view\/(\d+)/) || [])[1] || '';
  // The detail pane = smallest ancestor of the Apply button that holds the whole description.
  const APPLY_RE = /^\s*(easy apply|apply)\b(?! ?(ed|ing|cant|ication))/i;
  const inCard = b => !!b.closest('li, [data-occludable-job-id]') && cards().some(c => c.contains(b));
  const applyEl = () => [...document.querySelectorAll('button, a')].find(b => vis(b) && !inCard(b) &&
    (APPLY_RE.test(b.getAttribute('aria-label') || '') || APPLY_RE.test((b.innerText || '').trim())));
  const detailPane = () => { let n = applyEl(); for (let i = 0; n && i < 12; i++, n = n.parentElement) if ((n.innerText || '').length > 1500) return n; return null; };
  // Never fall back to the whole page: it holds every other card's text and caused false 'country-locked' skips.
  const detailText = () => (detailPane() || { innerText: '' }).innerText;
  const isEasy = b => /^Easy Apply to /i.test(b.getAttribute('aria-label') || '') || /^\s*Easy Apply\s*$/i.test(b.innerText || '');
  // Wait until the right-hand pane shows the job just clicked (new id + an apply button), not the previous one.
  async function waitDetail(prevId) {
    await waitFor(() => jobId() && jobId() !== prevId, 8000);
    await waitFor(() => applyEl() || /no longer accepting|You applied|Applied \d/i.test(document.body.innerText.slice(0, 20000)), 8000);
    await sleep(700);
  }
  const stepSig = d => (d.innerText || '').replace(/\s+/g, ' ').slice(0, 600);
  const errorShown = d => [...d.querySelectorAll('.artdeco-inline-feedback--error, [data-test-form-element-error-messages], [role=alert], [id*=error]')].some(e => vis(e) && (e.innerText || '').trim());
  // LinkedIn keeps the last uploaded resume and pre-selects it, so a resume 'blocker' is not real there.
  const realBlockers = b => (b || []).filter(x => !/resume|cv|cover letter|upload|attach/i.test(x));
  async function fillStep(dlg, roleId) {
    for (let i = 0; i < 20; i++) { const out = await globalThis.SF_MAIN.run({ auto: true, root: dlg, roleId }); if (out) return out; await sleep(500); }
    return { blockers: [], filled: 0 };
  }
  const dlgRoot = () => [...document.querySelectorAll('dialog[data-testid=dialog], dialog[open], [role=dialog]')].find(vis);

  async function discard() {
    const d = btn(dlgRoot() || document, /^(Dismiss|Close)\s*$/i); if (d) d.click();
    const c = await waitFor(() => btn(document, /Discard/i), 3000); if (c) c.click();
    await sleep(800);
  }

  // Walk one Easy Apply dialog. -> 'applied' | reason it was skipped
  async function easyApply(roleId) {
    const pane = detailPane() || document.querySelector('main') || document;
    const open = [...pane.querySelectorAll('button, a')].find(b => vis(b) && isEasy(b));
    if (!open) {
      const site = applyEl();
      if (!site) return 'no apply button';
      await chrome.storage.local.set({ sf_li_external: { at: Date.now(), roleId } });
      site.click();
      await sleep(2500);
      const go = btn(document, /^Continue$|Continue to apply/i); if (go) go.click(); // LinkedIn's "leaving LinkedIn" prompt
      // The company tab fills and submits on its own, then says how it went.
      const rep = await (async () => { for (let t = 0; t < 60000; t += 1000) { const { sf_li_site: x } = await chrome.storage.local.get('sf_li_site'); if (x && x.at > Date.now() - 65000) { await chrome.storage.local.remove('sf_li_site'); return x.result; } await sleep(1000); } return 'needs you: company site did not answer'; })();
      return rep === 'submitted' ? 'site' : 'company site — ' + rep;
    }
    open.click();
    const dlg = await waitFor(dlgRoot);
    if (!dlg) return 'form did not open';
    let stuck = 0;
    for (let step = 0; step < 15; step++) {
      await sleep(900);
      const out = await fillStep(dlg, roleId);
      const blk = realBlockers(out.blockers);
      if (blk.length) { await discard(); return 'needs you: ' + blk.slice(0, 2).join(', '); }
      const unfollow = dlg.querySelector('input[type=checkbox][id*=follow]'); if (unfollow?.checked) unfollow.click();
      const submit = btn(dlg, /Submit application|^\s*Submit\s*$/i);
      if (submit) {
        submit.click();
        await sleep(2500);
        const done = btn(dlgRoot() || document, /^(Dismiss|Done)\s*$/i); if (done) done.click();
        return 'applied';
      }
      const next = btn(dlg, /Continue to next step|Review your application|^\s*(Next|Review|Continue)\b/i);
      if (!next) { await discard(); return 'no next button'; }
      const before = stepSig(dlg);
      next.click();
      await sleep(1500);
      // Same step still showing = LinkedIn refused it. Refill once (fields may have rendered late), then give up.
      if (stepSig(dlg) === before || errorShown(dlg)) {
        if (++stuck >= 2) { await discard(); return 'needs you: a required answer was rejected'; }
      } else stuck = 0;
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
      const card = cards().find(c => !s.seen.includes(cardKey(c)));
      if (!card) break;
      s.seen.push(cardKey(card)); save(s);
      card.scrollIntoView({ block: 'center' });
      await waitFor(() => (card.innerText || '').trim().length > 10, 4000); // virtualized cards render on scroll
      if (/\bApplied\b/.test(card.innerText)) continue;
      if (dlgRoot()) await discard(); // a leftover dialog would swallow the click
      const prevId = jobId();
      card.click();
      await waitDetail(prevId);
      const id = jobId();
      const text = detailText().slice(0, 4000);
      const clean = x => x.replace(/\s*\(Verified job\)$| with verification$/i, '').trim();
      const lines = [...new Set(card.innerText.split('\n').map(clean).filter(Boolean)
        .filter(x => !/^(Selected|Viewed|Saved|Promoted|Easy Apply|Be an early applicant|Actively reviewing|\d+ (applicants|connections?)|Your profile|.* ago$|Dismiss)/i.test(x)))];
      const head = (detailPane()?.querySelector('h1, h2')?.innerText || '').trim();
      const title = clean(lines[0] || head);
      const company = lines[1] || '';
      const loc = lines[2] || '';
      const indiaSearch = GEOS[s.k & 1] === '102713980';
      const why = !TITLE.test(title) ? 'skipped: not a PM role' : LOCKED.test(text) ? 'skipped: country-locked' : (!indiaSearch && !OPEN_LOC.test(loc)) ? 'skipped: location ' + loc.trim() : '';
      if (why) { s.skipped++; save(s); await log(id, title, company, loc, why); continue; }
      const role = await roleFor(title);
      paint(`applying${role ? ' as ' + role.name : ''}: ${title.slice(0, 40)}`);
      // One bad job must not end the whole run.
      const r = await easyApply(role?.id).catch(async e => { try { await discard(); } catch {} return 'error: ' + e.message; });
      s = state(); if (!s) return;
      if (r === 'applied' || r === 'site') {
        s.applied++; save(s); await log(id, title, company, loc, (r === 'site' ? 'sent on company site' : 'applied (Easy Apply)') + (role ? ' as ' + role.name : ''));
        const n = await bump();
        if (n >= DAILY_CAP) return stop(`Done for today: ${s.applied} applied (cap ${DAILY_CAP}).`);
        paint(`${s.applied} applied, ${s.skipped} skipped`);
        await jitter(15000, 40000); // human pace, keeps the account safe
      } else { s.skipped++; save(s); await log(id, title, company, loc, 'skipped: ' + r); paint(`${s.applied} applied, ${s.skipped} skipped (${r})`); await sleep(1500); }
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
