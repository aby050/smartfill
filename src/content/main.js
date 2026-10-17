/* Orchestration: pick a role -> scan -> rules -> Claude for the leftovers ->
   fill -> attach the role's resume -> review panel. */
(function () {
  const { collect, serialize, currentValue } = globalThis.SF_FIELDS;
  const FILES = globalThis.SF_FILES;
  const ROWS = globalThis.SF_ROWS;
  const RULES = globalThis.SF_RULES;
  const { fill } = globalThis.SF_FILLER;
  const UI = globalThis.SF_UI;
  const { SENSITIVE_KEYS, resolve, applyRole, matchRole, matchAnswer, DEFAULT_SETTINGS, verdictFor, buttonRole } = globalThis.SF_SCHEMA;

  let undoStack = [];
  let running = false;

  async function load() {
    const got = await chrome.storage.local.get(['profile', 'settings', 'roles', 'answers']);
    return {
      raw: got.profile || {},
      settings: { ...DEFAULT_SETTINGS, ...(got.settings || {}) },
      roles: got.roles || [],
      answers: (got.answers || []).filter(a => a.match && a.value),
      passengers: got.passengers || []
    };
  }

  /** The text a job page gives away about which role this is. */
  function pageSignal() {
    const bits = [document.title];
    const h = document.querySelector('h1, [role=heading][aria-level="1"], h2');
    if (h) bits.push(h.innerText || '');
    const desc = document.querySelector('meta[name=description]');
    if (desc) bits.push(desc.content || '');
    const main = document.querySelector('main, [role=main], article');
    if (main) bits.push((main.innerText || '').slice(0, 1200));
    return bits.filter(Boolean).join(' \n ').replace(/\s+/g, ' ').slice(0, 2000);
  }

  /** As much of the job description as is worth sending. */
  function jobText() {
    const main = document.querySelector('main, [role=main], article, #content, .job-description, [class*=description]');
    const body = ((main || document.body).innerText || '').replace(/\s+/g, ' ').trim();
    return body.slice(0, 6000);
  }

  const JOB_RE = /(responsibilit|qualification|requirement|what you.ll do|about the role|apply now|job description|years of experience|we.re looking for)/i;
  function looksLikeJob(text) { return JOB_RE.test(text); }

  async function chooseRole(roles, settings, signal, opts = {}) {
    if (!roles.length) return { role: null, via: 'none' };

    const forced = roles.find(r => r.pinned);
    if (forced) return { role: forced, via: 'pinned' };

    const hit = matchRole(roles, signal);
    if (hit && hit.score >= 3) return { role: hit.role, via: 'keywords' };

    if (settings.aiPickRole && settings.useAI && opts.allowAI !== false) {
      const resp = await chrome.runtime.sendMessage({
        type: 'SF_PICK_ROLE',
        payload: {
          signal: signal.slice(0, 1200),
          roles: roles.map(r => ({ id: r.id, name: r.name, keywords: r.keywords || [] }))
        }
      });
      if (resp && resp.ok && resp.roleId) {
        const r = roles.find(x => x.id === resp.roleId);
        if (r) return { role: r, via: 'ai' };
      }
    }

    if (hit) return { role: hit.role, via: 'keywords' };
    const def = roles.find(r => r.isDefault) || roles[0];
    return { role: def, via: 'default' };
  }

  function hasAnyValue(profile) {
    return Object.keys(profile).some(k => k !== '__custom' && String(profile[k] || '').trim());
  }

  async function run(opts = {}) {
    if (running) return null;
    running = true;
    try {
      const { raw, settings, roles, answers, passengers } = await load();
      if ((settings.blockedHosts || []).some(h => h && location.hostname.includes(h))) {
        UI.status('Smartfill is disabled on this site.', false);
        return null;
      }

      const signal = pageSignal();
      const picked = opts.roleId
        ? { role: roles.find(r => r.id === opts.roleId) || null, via: 'you' }
        : await chooseRole(roles, settings, signal);

      let profile = resolve(raw);
      profile = applyRole(profile, picked.role);
      profile.__custom = raw.customFields || [];

      if (!hasAnyValue(profile)) {
        UI.status('Your profile is empty. Open the extension options and add your details first.', false);
        return null;
      }

      UI.status('Reading the form…', true);
      const fields = collect();
      const targets = fields.filter(f => opts.overwrite || !f.hasValue);

      // --- pass 1: rules ---
      const results = [];
      const unresolved = [];
      for (const f of targets) {
        // A decision the user already made, replayed verbatim. Outranks everything.
        const saved = matchAnswer(answers, f.haystack);
        if (saved) {
          results.push({ field: f, key: 'saved', value: saved.value, via: 'saved' });
          continue;
        }
        // A consent with no saved answer is the applicant's to give, not ours.
        if (f.isConsent) {
          results.push({ field: f, value: '', via: 'consent', ok: false,
            reason: 'your call', needsReview: true });
          UI.mark(f, 'consent', false);
          continue;
        }
        const m = RULES.score(f, profile);
        if (m && m.score >= 0.7) {
          results.push({ field: f, key: m.key, value: RULES.shape(profile[m.key], f, m.key), via: m.via });
        } else {
          unresolved.push(f);
        }
      }

      // --- pass 2: Claude, for whatever the rules could not place ---
      let aiError = null;
      if (settings.useAI && unresolved.length) {
        UI.status(`Asking Claude about ${unresolved.length} field${unresolved.length > 1 ? 's' : ''}…`, true);
        const safeProfile = { ...profile };
        delete safeProfile.__custom;
        for (const k of SENSITIVE_KEYS) delete safeProfile[k];   // IDs never leave the machine

        const resp = await chrome.runtime.sendMessage({
          type: 'SF_MAP_FIELDS',
          payload: {
            fields: unresolved.map(serialize),
            profile: safeProfile,
            custom: profile.__custom,
            role: picked.role ? picked.role.name : null,
            page: { title: document.title, host: location.hostname, heading: signal.slice(0, 200) },
            allowFreeText: settings.aiForFreeText
          }
        });

        if (resp && resp.ok) {
          const byId = new Map(unresolved.map(f => [f.sfid, f]));
          for (const item of (resp.mappings || [])) {
            const f = byId.get(item.sfid);
            if (!f || item.value == null || item.value === '') continue;
            if (item.confidence != null && item.confidence < 0.5) continue;
            results.push({ field: f, key: item.key || 'ai', value: String(item.value), via: 'ai' });
            byId.delete(item.sfid);
          }
          for (const f of byId.values()) results.push({ field: f, value: '', via: 'skipped', ok: false, reason: 'no match' });
        } else {
          aiError = (resp && resp.error) || 'Claude call failed';
          for (const f of unresolved) results.push({ field: f, value: '', via: 'skipped', ok: false, reason: 'AI unavailable' });
        }
      } else {
        for (const f of unresolved) results.push({ field: f, value: '', via: 'skipped', ok: false, reason: 'no match' });
      }

      // --- pass 3: write ---
      undoStack = [];
      for (const r of results) {
        if (!r.value) { r.ok = false; continue; }
        if (SENSITIVE_KEYS.has(r.key) && settings.confirmSensitive) {
          r.ok = false; r.reason = 'confirm'; r.needsReview = true;
          UI.mark(r.field, r.via, false);
          continue;
        }
        undoStack.push({ kind: 'value', field: r.field, prev: currentValue(r.field.el) });
        const out = await fill(r.field, r.value);
        r.ok = out.ok;
        if (!out.ok) r.reason = out.reason;
        else if (out.applied != null) r.value = out.applied;
        UI.mark(r.field, r.via, out.ok);
      }

      // --- pass 4: repeated passenger rows ---
      if (passengers.length) {
        const found = ROWS.findRows();
        if (found.length) {
          UI.status(`Filling ${passengers.length} passenger row${passengers.length > 1 ? 's' : ''}…`, true);
          const pr = await ROWS.fillPassengers(passengers);
          if (pr.ok) {
            for (const row of pr.report) {
              const okCount = row.filled.filter(f => f.ok).length;
              results.push({
                field: { el: row.filled[0] && row.filled[0].el, label: `Passenger ${row.index}: ${row.name}` },
                key: 'passenger',
                value: row.missing ? '' : row.filled.filter(f => f.ok).map(f => f.key).join(', '),
                via: 'passenger',
                ok: !row.missing && okCount > 0,
                reason: row.missing ? row.reason : (okCount ? null : 'nothing matched in that row')
              });
              for (const f of row.filled) if (f.el) UI.mark({ el: f.el }, 'rule', f.ok);
            }
          }
        }
      }

      // --- pass 5: resume ---
      let resumeUsed = null;
      if (settings.attachResume) {
        UI.status('Attaching your resume…', true);
        const att = await attachResumes(picked.role, opts.overwrite, settings);
        resumeUsed = att.resumeUsed;
        results.push(...att.rows);
      }

      if (!results.length) {
        UI.status(fields.length ? 'Every field is already filled. Run again with overwrite to replace them.' : 'No fillable fields found here.', false);
        return { blockers: [], filled: 0 };
      }

      const jd = jobText();

      UI.showResults(results, {
        role: picked.role,
        roleVia: picked.via,
        roles,
        resumeUsed,
        canScore: !!(settings.useAI && looksLikeJob(jd)),
        onScore: force => chrome.runtime.sendMessage({
          type: 'SF_SCORE_FIT',
          payload: {
            url: location.href,
            jobTitle: document.title,
            jobText: jd,
            force: !!force,
            role: picked.role ? picked.role.name : null,
            resumeId: (resumeUsed && resumeUsed.id) ||
              (picked.role && picked.role.resumeId) || settings.defaultResumeId || null,
            profileBits: {
              currentTitle: profile.currentTitle, yearsExperience: profile.yearsExperience,
              summary: profile.summary, skills: profile.skills,
              highestDegree: profile.highestDegree, fieldOfStudy: profile.fieldOfStudy,
              currentCompany: profile.currentCompany, linkedin: profile.linkedin
            }
          }
        }),
        onUndo: undo,
        onRole: id => { UI.close(); run({ ...opts, roleId: id, overwrite: true }); },
        onEdit: async (r, v) => {
          if (r.isFile) return;
          undoStack.push({ kind: 'value', field: r.field, prev: currentValue(r.field.el) });
          const out = await fill(r.field, v);
          r.ok = out.ok;
          UI.mark(r.field, r.via, out.ok);
        },
        onRetryAI: () => { UI.close(); run({ ...opts, overwrite: true }); }
      });

      if (aiError) console.warn('[Smartfill]', aiError);

      // What still needs a human: consents, flagged IDs, failed writes, required
      // fields still empty, and a required resume that could not be attached.
      const blockers = results.filter(r => !r.ok && (r.needsReview || r.via === 'consent' ||
        (r.isFile && /no resume|could not|failed/i.test(r.reason || '')))).map(r => (r.field && r.field.label) || r.key || 'field');
      for (const f of collect()) if (f.attrs && f.attrs.required && !f.hasValue && !f.isConsent) blockers.push(f.label || 'required field');
      return { blockers, filled: results.filter(r => r.ok).length };
    } catch (e) {
      UI.status('Smartfill error: ' + (e && e.message || e), false);
      return null;
    } finally {
      running = false;
    }
  }

  /** Put the role's resume into whichever upload control wants one. */
  async function attachResumes(role, overwrite, settings) {
    const inputs = FILES.collectFileInputs();
    const zones = FILES.collectDropzones(inputs);
    const all = [...inputs, ...zones];
    if (!all.length) return { rows: [], resumeUsed: null };

    const wanted = all.filter(t => t.purpose === 'resume' ||
      (t.purpose === 'unknown' && all.length === 1 && !t.hidden));
    if (!wanted.length) {
      return {
        resumeUsed: null,
        rows: all.filter(t => t.purpose !== 'unknown')
          .map(t => ({ isFile: true, field: { el: t.el, label: t.label }, value: '',
            via: 'skipped', ok: false, reason: `${t.purpose} upload — do it yourself` }))
      };
    }

    const resumeId = (role && role.resumeId) || settings.defaultResumeId || null;
    const resp = await chrome.runtime.sendMessage({ type: 'SF_GET_RESUME', resumeId });
    if (!resp || !resp.ok) {
      return {
        resumeUsed: null,
        rows: wanted.map(t => ({ isFile: true, field: { el: t.el, label: t.label }, value: '',
          via: 'skipped', ok: false, reason: (resp && resp.error) || 'no resume saved' }))
      };
    }

    const file = FILES.base64ToFile(resp.data, resp.filename, resp.mime);
    const out = [];
    for (const t of wanted) {
      if (t.already && !overwrite) {
        out.push({ isFile: true, field: { el: t.el, label: t.label }, value: t.already,
          via: 'skipped', ok: false, reason: 'already attached' });
        continue;
      }
      const r = FILES.attach(t, file);
      undoStack.push({ kind: 'file', target: t });
      out.push({
        isFile: true,
        field: { el: t.el, label: t.label },
        value: r.ok ? resp.filename : '',
        key: 'resume',
        via: role ? 'role' : 'rule',
        ok: r.ok,
        reason: r.reason
      });
      UI.mark({ el: t.el }, 'rule', r.ok);
    }
    return { rows: out, resumeUsed: { id: resp.id, filename: resp.filename } };
  }

  /* ---- automatic fit score + auto-apply ----
     On a job page the score is fetched on its own (cached 7 days per URL+resume)
     and shown as an Apply / Maybe / Skip badge. Auto-apply is opt-in and only runs
     when the score clears autoApplyMin; it stops the moment anything needs a human
     (a consent, a flagged ID, a required field it could not fill). */

  const sleep = ms => new Promise(r => setTimeout(r, ms));
  let scoredUrl = null;
  let autoActive = false;

  async function scoreThisPage(force) {
    const { raw, settings, roles } = await load();
    const signal = pageSignal();
    const picked = await chooseRole(roles, settings, signal, { allowAI: false });
    const profile = applyRole(resolve(raw), picked.role);
    const resumeId = (picked.role && picked.role.resumeId) || settings.defaultResumeId || null;
    const fit = await chrome.runtime.sendMessage({
      type: 'SF_SCORE_FIT',
      payload: {
        url: location.href, jobTitle: document.title, jobText: jobText(), force: !!force,
        role: picked.role ? picked.role.name : null, resumeId,
        profileBits: {
          currentTitle: profile.currentTitle, yearsExperience: profile.yearsExperience,
          summary: profile.summary, skills: profile.skills, highestDegree: profile.highestDegree,
          fieldOfStudy: profile.fieldOfStudy, currentCompany: profile.currentCompany, linkedin: profile.linkedin
        }
      }
    });
    return { fit, settings };
  }

  function visibleButtons() {
    const out = [];
    for (const el of document.querySelectorAll('button, input[type=submit], input[type=button], a[role=button], [role=button]')) {
      if (el.disabled || el.getAttribute('aria-disabled') === 'true') continue;
      const r = el.getBoundingClientRect();
      if (!r.width || !r.height) continue;
      const role = buttonRole(el.innerText || el.value || el.getAttribute('aria-label'));
      if (role) out.push({ el, role });
    }
    return out;
  }

  async function logApplication(fit) {
    const { applications = [] } = await chrome.storage.local.get('applications');
    applications.push({ url: location.href.split(/[?#]/)[0], host: location.hostname, title: document.title,
      score: fit.score, at: Date.now(), mode: 'auto' });
    await chrome.storage.local.set({ applications: applications.slice(-500) });
  }

  async function autoFlow(fit, st) {
    if (autoActive || !st.autoApply || !(fit.score >= st.autoApplyMin)) return;
    autoActive = true;
    try {
      const cap = st.autoApplyMaxSteps || 8;
      const key = 'sf_auto_steps';
      let steps = Number(sessionStorage.getItem(key) || 0);
      while (steps < cap) {
        if (!collect().length && !FILES.collectFileInputs().length) return;
        const out = await run({ auto: true });
        if (!out) return;
        if (out.blockers.length) {
          sessionStorage.removeItem(key);
          UI.status(`Auto-apply paused — ${out.blockers.length} thing${out.blockers.length > 1 ? 's' : ''} need you: ${out.blockers.slice(0, 3).join(', ')}`, false);
          return;
        }
        const btns = visibleButtons();
        const pick = btns.find(b => b.role === 'submit') || btns.find(b => b.role === 'next');
        if (!pick) { sessionStorage.removeItem(key); return; }
        steps++;
        sessionStorage.setItem(key, String(steps));
        if (pick.role === 'submit') {
          await logApplication(fit);
          sessionStorage.removeItem(key);
          pick.el.click();
          UI.toast('Smartfill submitted this application (score ' + fit.score + ')');
          return;
        }
        pick.el.click();
        await sleep(1800);
      }
      UI.status('Auto-apply stopped after ' + cap + ' steps — finish this one yourself.', false);
    } finally {
      autoActive = false;
    }
  }

  async function considerScore() {
    if (scoredUrl === location.href) return;
    const { settings } = await load();
    if (!settings.useAI || !settings.autoScore) return;
    if ((settings.blockedHosts || []).some(h => h && location.hostname.includes(h))) return;
    if (!looksLikeJob(jobText())) return;
    const { apiKey } = await chrome.storage.local.get('apiKey');
    if (!apiKey) return;
    scoredUrl = location.href;
    const { fit, settings: st } = await scoreThisPage(false);
    if (!fit || !fit.ok) { scoredUrl = null; return; }
    const verdict = verdictFor(fit.score, st);
    UI.showScore({
      score: fit.score, verdict,
      text: { apply: 'Apply', maybe: 'Maybe', skip: 'Skip' }[verdict] + ' — ' + (fit.verdict || '').slice(0, 60),
      onClick: () => run()
    });
    if (verdict !== 'skip') autoFlow(fit, st).catch(() => {});
  }

  async function preview() {
    const { raw, settings, roles, answers, passengers } = await load();
    if ((settings.blockedHosts || []).some(h => h && location.hostname.includes(h))) {
      return { ok: true, blocked: true };
    }

    const signal = pageSignal();
    const picked = await chooseRole(roles, settings, signal, { allowAI: false });
    let profile = applyRole(resolve(raw), picked.role);

    const fields = collect().filter(f => !f.hasValue);
    let ready = 0, consents = 0, unknown = 0;
    for (const f of fields) {
      if (matchAnswer(answers, f.haystack)) { ready++; continue; }
      if (f.isConsent) { consents++; continue; }
      const m = RULES.score(f, profile);
      if (m && m.score >= 0.7) ready++; else unknown++;
    }

    const rows = ROWS.findRows().length;
    const savedPassengers = passengers.filter(p => p && String(p.name || '').trim()).length;
    const uploads = FILES.collectFileInputs().filter(t => t.purpose === 'resume').length;
    const hasResume = !!((picked.role && picked.role.resumeId) || settings.defaultResumeId);

    return {
      ok: true,
      total: fields.length,
      ready, consents, unknown, uploads, hasResume,
      rows, savedPassengers, canAddRows: !!ROWS.addButton(),
      role: picked.role ? picked.role.name : null,
      roleVia: picked.via,
      useAI: !!settings.useAI,
      profileEmpty: !hasAnyValue(profile),
      isJob: looksLikeJob(jobText())
    };
  }

  async function undo() {
    for (const u of undoStack.reverse()) {
      try {
        if (u.kind === 'file') FILES.clear(u.target);
        else await fill(u.field, u.prev);
      } catch { /* element gone */ }
    }
    undoStack = [];
  }

  chrome.runtime.onMessage.addListener((msg, _s, send) => {
    if (msg.type === 'SF_RUN') { run(msg.opts || {}); send({ ok: true }); }
    if (msg.type === 'SF_UNDO') { undo(); UI.close(); send({ ok: true }); }
    // Dry run for the popup: what WOULD be filled, without touching the page
    // and without spending an API call.
    if (msg.type === 'SF_PREVIEW') {
      preview().then(send).catch(e => send({ ok: false, error: String(e.message || e) }));
      return true;
    }
    if (msg.type === 'SF_SCAN') {
      const fields = collect();
      const files = FILES.collectFileInputs();
      send({ ok: true, count: fields.length, uploads: files.filter(f => f.purpose === 'resume').length });
    }
    return true;
  });

  /* ---- floating launcher ----
     Watches for a form to appear — including one a single-page app renders long
     after load — and offers to fill it in place, so the toolbar menu is optional.
     Counting is cheap and local; nothing here touches the network. */

  let watchTimer = null;
  let dismissedHere = false;
  let lastCount = -1;

  async function considerLauncher() {
    if (window.top === window && scoredUrl !== location.href) considerScore().catch(() => {});
    if (dismissedHere || running) return;
    const { settings } = await chrome.storage.local.get('settings');
    const st = { ...DEFAULT_SETTINGS, ...(settings || {}) };
    if (!st.showLauncher) return;
    if ((st.blockedHosts || []).some(h => h && location.hostname.includes(h))) return;
    if ((st.launcherOffHosts || []).some(h => h === location.hostname)) return;

    const { raw, roles, answers, passengers } = await load();
    let profile = applyRole(resolve(raw), (roles || []).find(r => r.pinned) || null);
    if (!hasAnyValue(profile)) return;

    let n = 0;
    for (const f of collect()) {
      if (f.hasValue || f.isConsent) continue;
      if (matchAnswer(answers, f.haystack)) { n++; continue; }
      const m = RULES.score(f, profile);
      if (m && m.score >= 0.7) n++;
    }
    if (passengers.length && ROWS.findRows().length) n += passengers.length;
    if (FILES.collectFileInputs().some(t => t.purpose === 'resume')) n++;

    // One or two stray matches is usually a search box, not a form worth offering.
    if (n < 2) { UI.hideLauncher(); lastCount = n; return; }
    if (n === lastCount) return;             // already showing the right number
    lastCount = n;

    UI.showLauncher({
      count: n,
      onFill: () => run(),
      onDismiss: async () => {
        dismissedHere = true;
        const { settings: cur } = await chrome.storage.local.get('settings');
        const next = { ...DEFAULT_SETTINGS, ...(cur || {}) };
        next.launcherOffHosts = [...new Set([...(next.launcherOffHosts || []), location.hostname])];
        await chrome.storage.local.set({ settings: next });
      }
    });
  }

  let lastCheck = 0;
  function scheduleLauncher(delay) {
    const since = Date.now() - lastCheck;
    if (since > 3000) {
      lastCheck = Date.now();
      considerLauncher().catch(() => {});
      return;
    }
    clearTimeout(watchTimer);
    watchTimer = setTimeout(() => {
      lastCheck = Date.now();
      considerLauncher().catch(() => {});
    }, delay);
  }

  if (window.top === window) {
    chrome.storage.local.get('settings').then(({ settings }) => {
      if (settings && settings.autofillOnLoad) {
        setTimeout(() => { if (document.querySelector('form input, form select')) run(); }, 900);
      }
    });

    scheduleLauncher(700);
    setTimeout(() => considerScore().catch(() => {}), 1200);
    // Single-page apps (and booking sites in particular) render the real form
    // well after load, so keep watching — debounced, and only when inputs change.
    const mo = new MutationObserver(muts => {
      for (const m of muts) {
        for (const node of m.addedNodes) {
          if (node.nodeType !== 1) continue;
          if (node.matches && node.matches('input, select, textarea, form')) return scheduleLauncher(600);
          if (node.querySelector && node.querySelector('input, select, textarea')) return scheduleLauncher(600);
        }
      }
    });
    mo.observe(document.documentElement, { childList: true, subtree: true });
  }

  globalThis.SF_MAIN = { run, undo };
})();
