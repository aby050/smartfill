const { SECTIONS, DEFAULT_SETTINGS, ROLE_OVERRIDE_KEYS, ALL_FIELDS, COMMON_ANSWERS, PASSENGER_FIELDS } = globalThis.SF_SCHEMA;
const STORE = globalThis.SF_STORE;
const SYNC = globalThis.SF_SYNC;

let profile = {};
let settings = { ...DEFAULT_SETTINGS };
let roles = [];
let resumes = [];
let answers = [];
let passengers = [];
let saveTimer = null;

const $ = id => document.getElementById(id);

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function buildSections() {
  const host = $('sections');
  host.innerHTML = '';
  for (const sec of SECTIONS) {
    const card = el('section', 'card');
    const h = el('h2', null, sec.title);
    if (sec.sensitive) h.append(el('span', 'badge', 'never sent to Claude'));
    card.append(h);
    const grid = el('div', 'grid');
    for (const f of sec.fields) {
      if (f.derived) continue;              // computed at fill time
      const wrap = el('div', 'field' + (f.type === 'textarea' ? ' full' : ''));
      wrap.append(el('label', null, f.label));
      let input;
      if (f.type === 'textarea') {
        input = el('textarea');
      } else if (f.type === 'bool') {
        input = el('select');
        for (const [v, t] of [['', '—'], ['Yes', 'Yes'], ['No', 'No']]) {
          const o = el('option', null, t); o.value = v; input.append(o);
        }
      } else {
        input = el('input');
        input.type = f.type === 'date' ? 'date' : f.type === 'email' ? 'email' : 'text';
      }
      input.id = 'f_' + f.key;
      input.value = profile[f.key] || '';
      input.addEventListener('input', () => { profile[f.key] = input.value; queueSave(); });
      wrap.append(input);
      if (f.hint) wrap.append(el('p', 'hint', f.hint));
      grid.append(wrap);
    }
    card.append(grid);
    host.append(card);
  }
}

function buildCustom() {
  const host = $('customList');
  host.innerHTML = '';
  profile.customFields = profile.customFields || [];
  profile.customFields.forEach((c, i) => {
    const row = el('div', 'customRow');
    const k = el('input'); k.type = 'text'; k.placeholder = 'Field label, e.g. "Employee ID"'; k.value = c.key || '';
    const v = el('input'); v.type = 'text'; v.placeholder = 'Value'; v.value = c.value || '';
    const del = el('button', 'ghost', '×');
    k.oninput = () => { c.key = k.value; queueSave(); };
    v.oninput = () => { c.value = v.value; queueSave(); };
    del.onclick = () => { profile.customFields.splice(i, 1); buildCustom(); queueSave(); };
    row.append(k, v, del);
    host.append(row);
  });
}



/* ---------- passengers ---------- */

function buildPax() {
  const host = $('paxList');
  host.innerHTML = '';
  if (!passengers.length) {
    host.append(el('p', 'hint', 'None yet. Add one per traveller, in the order they should appear on the form.'));
    return;
  }
  passengers.forEach((p, i) => {
    const box = el('div', 'roleBox');

    const head = el('div', 'row');
    head.append(el('span', 'grow', `Passenger ${i + 1}`));
    const up = el('button', 'ghost', '↑');
    up.disabled = i === 0;
    up.onclick = () => { passengers.splice(i - 1, 0, passengers.splice(i, 1)[0]); queueSave(); buildPax(); };
    const del = el('button', 'ghost', '×');
    del.onclick = () => { passengers.splice(i, 1); queueSave(); buildPax(); };
    head.append(up, del);
    box.append(head);

    const grid = el('div', 'grid');
    for (const f of PASSENGER_FIELDS) {
      const w = el('div', 'field');
      const lab = el('label', null, f.label);
      if (f.sensitive) lab.append(el('span', 'badge', 'never sent to Claude'));
      w.append(lab);
      const inp = el('input');
      inp.type = 'text';
      inp.placeholder = { gender: 'Male / Female', berth: 'Lower / Upper / Side Lower',
        food: 'Veg / Non-veg / No food', nationality: 'India',
        idType: 'Aadhaar / Passport', age: 'e.g. 28' }[f.key] || '';
      inp.value = p[f.key] || '';
      inp.oninput = () => { p[f.key] = inp.value; queueSave(); };
      w.append(inp);
      grid.append(w);
    }
    box.append(grid);
    host.append(box);
  });
}

/* ---------- standing answers ---------- */

function buildAnswers() {
  const host = $('answerList');
  host.innerHTML = '';
  if (!answers.length) {
    host.append(el('p', 'hint', 'Nothing saved yet. "Add the usual application questions" seeds the common ones with blank answers for you to fill in.'));
    return;
  }
  answers.forEach((a, i) => {
    const row = el('div', 'customRow');

    const left = el('div', 'grow');
    const q = el('input');
    q.type = 'text';
    q.placeholder = 'Words the question contains, e.g. "require a visa"';
    q.value = a.match || '';
    q.oninput = () => { a.match = q.value; queueSave(); };
    left.append(q);
    if (a.hint) left.append(el('div', 'hint', a.hint));
    if (a.consent) left.append(el('span', 'badge', 'consent — only you can set this'));
    row.append(left);

    const v = el('input');
    v.type = 'text';
    v.placeholder = 'Your answer';
    v.value = a.value || '';
    v.style.maxWidth = '170px';
    v.oninput = () => { a.value = v.value; queueSave(); };
    row.append(v);

    const del = el('button', 'ghost', '×');
    del.onclick = () => { answers.splice(i, 1); queueSave(); buildAnswers(); };
    row.append(del);

    host.append(row);
  });
}

let learned = [];
async function buildLearned() {
  const host = $('learnedList');
  host.innerHTML = '';
  if (!learned.length) {
    host.append(el('p', 'hint', 'Nothing learned yet. Fill a form by hand and what you type will show up here.'));
    return;
  }
  learned.forEach((a, i) => {
    const row = el('div', 'customRow');
    const left = el('div', 'grow');
    const q = el('input'); q.type = 'text'; q.value = a.match || '';
    q.oninput = () => { a.match = q.value; saveLearned(); };
    left.append(q);
    if (a.host) left.append(el('div', 'hint', 'first seen on ' + a.host));
    row.append(left);
    const v = el('input'); v.type = 'text'; v.value = a.value || ''; v.style.maxWidth = '170px';
    v.oninput = () => { a.value = v.value; saveLearned(); };
    row.append(v);
    const del = el('button', 'ghost', '\u00d7');
    del.onclick = () => { learned.splice(i, 1); saveLearned(); buildLearned(); };
    row.append(del);
    host.append(row);
  });
}
function saveLearned() { return chrome.storage.local.set({ learned }); }

function seedAnswers() {
  const have = new Set(answers.map(a => (a.match || '').toLowerCase().trim()));
  let added = 0;
  for (const c of COMMON_ANSWERS) {
    if (have.has(c.match)) continue;
    answers.push({ ...c });
    added++;
  }
  queueSave();
  buildAnswers();
  $('saveState').textContent = added ? `Added ${added} question${added === 1 ? '' : 's'} — fill in the answers` : 'Already there';
}

/* ---------- account sync ---------- */

async function pushSync() {
  const r = await SYNC.push({ profile, settings, roles, answers, passengers });
  const s = $('syncState');
  if (r.ok) {
    await chrome.storage.local.set({ syncedAt: r.updatedAt });
    s.className = 'hint ok';
    s.textContent = `Synced to your Google account just now — ${(r.bytes / 1024).toFixed(1)} KB of the 100 KB allowance. Resume files stay on this machine.`;
  } else {
    s.className = 'hint err';
    s.textContent = 'Not synced — ' + r.error;
  }
}

async function initSync() {
  const cb = $('syncEnabled');
  cb.checked = settings.syncEnabled !== false;
  cb.onchange = async () => {
    settings.syncEnabled = cb.checked;
    queueSave();
    if (!cb.checked) { await SYNC.clear(); $('syncState').className = 'hint'; $('syncState').textContent = 'Sync off. This machine keeps its own copy; nothing is written to your Google account.'; }
  };

  $('syncNow').onclick = pushSync;

  $('syncPull').onclick = async () => {
    const r = await SYNC.pullIfNewer();
    if (!r.pulled) {
      $('syncState').className = 'hint';
      $('syncState').textContent = r.upToDate ? 'This machine is already up to date.' : 'Nothing found in your Google account yet.';
      return;
    }
    const got = await chrome.storage.local.get(['profile', 'settings', 'roles', 'answers', 'passengers', 'learned']);
    profile = got.profile || {}; settings = { ...DEFAULT_SETTINGS, ...(got.settings || {}) };
    roles = got.roles || []; answers = got.answers || []; passengers = got.passengers || [];
    buildSections(); buildCustom(); bindSettings(); buildAnswers(); buildPax(); await refreshResumes();
    $('syncState').className = 'hint ok';
    $('syncState').textContent = `Pulled the copy saved from ${r.device} on ${new Date(r.updatedAt).toLocaleString()}.`;
  };

  const remote = await SYNC.pull();
  const s = $('syncState');
  if (settings.syncEnabled === false) {
    s.textContent = 'Sync off. This machine keeps its own copy.';
  } else if (remote) {
    s.textContent = `Last written from ${remote.device} on ${new Date(remote.updatedAt).toLocaleString()}.`;
  } else {
    s.textContent = 'Nothing in your Google account yet — it uploads the next time you edit anything.';
  }

  // Another machine pushed while this page is open.
  chrome.storage.onChanged.addListener((changes, areaName) => {
    if (areaName !== 'sync' || !changes.sf_meta) return;
    s.className = 'hint';
    s.textContent = 'Another machine just saved a newer copy — press "Pull from my account" to take it.';
  });
}

/* ---------- resumes ---------- */

const fmtSize = b => b < 1024 ? b + ' B' : b < 1048576 ? (b / 1024).toFixed(0) + ' KB' : (b / 1048576).toFixed(1) + ' MB';

async function refreshResumes() {
  resumes = await STORE.list();
  buildResumes();
  buildRoles();      // the resume dropdowns live inside the role rows
}

function buildResumes() {
  const host = $('resumeList');
  host.innerHTML = '';
  if (!resumes.length) {
    host.append(el('p', 'hint', 'No resumes yet. PDF, DOC, DOCX, RTF or TXT, up to 8 MB each.'));
    return;
  }
  for (const r of resumes) {
    const row = el('div', 'customRow');
    const name = el('div', 'grow');
    name.append(el('strong', null, r.filename));
    const usedBy = roles.filter(x => x.resumeId === r.id).map(x => x.name).filter(Boolean);
    name.append(el('div', 'hint',
      `${fmtSize(r.size)} · added ${new Date(r.addedAt).toLocaleDateString()}` +
      (usedBy.length ? ` · used by ${usedBy.join(', ')}` : '') +
      (settings.defaultResumeId === r.id ? ' · default' : '')));
    row.append(name);

    const def = el('button', 'ghost', settings.defaultResumeId === r.id ? 'Default' : 'Make default');
    def.onclick = () => { settings.defaultResumeId = r.id; queueSave(); buildResumes(); };

    const dl = el('button', 'ghost', 'Download');
    dl.onclick = async () => {
      const rec = await STORE.get(r.id);
      const a = document.createElement('a');
      a.href = URL.createObjectURL(rec.blob);
      a.download = rec.filename;
      a.click();
      URL.revokeObjectURL(a.href);
    };

    const del = el('button', 'danger', 'Delete');
    del.onclick = async () => {
      if (!confirm(`Delete ${r.filename}?`)) return;
      await STORE.remove(r.id);
      for (const role of roles) if (role.resumeId === r.id) role.resumeId = '';
      if (settings.defaultResumeId === r.id) delete settings.defaultResumeId;
      queueSave();
      await refreshResumes();
    };

    row.append(def, dl, del);
    host.append(row);
  }
}

function bindResumeUpload() {
  $('addResume').onclick = () => $('resumeFile').click();
  $('resumeFile').onchange = async e => {
    for (const f of e.target.files) {
      try {
        const rec = await STORE.put(f);
        if (!settings.defaultResumeId) { settings.defaultResumeId = rec.id; queueSave(); }
      } catch (err) {
        alert(err.message);
      }
    }
    e.target.value = '';
    await refreshResumes();
  };
}

/* ---------- role profiles ---------- */

const newRoleId = () => 'role_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 6);

function labelOf(key) {
  const f = ALL_FIELDS.find(x => x.key === key);
  return f ? f.label : key;
}

function buildRoles() {
  const host = $('roleList');
  host.innerHTML = '';
  if (!roles.length) {
    host.append(el('p', 'hint', 'No roles yet. Add one per version of yourself you apply as.'));
    return;
  }
  roles.forEach((role, i) => {
    const box = el('div', 'roleBox');

    const head = el('div', 'row');
    const name = el('input');
    name.type = 'text'; name.placeholder = 'Role name, e.g. Product Manager'; name.value = role.name || '';
    name.oninput = () => { role.name = name.value; queueSave(); };
    head.append(name);

    const res = el('select');
    const none = el('option', null, '— no resume —'); none.value = ''; res.append(none);
    for (const r of resumes) {
      const o = el('option', null, r.filename); o.value = r.id;
      if (role.resumeId === r.id) o.selected = true;
      res.append(o);
    }
    res.onchange = () => { role.resumeId = res.value; queueSave(); buildResumes(); };
    head.append(res);

    const del = el('button', 'ghost', '×');
    del.onclick = () => { roles.splice(i, 1); queueSave(); buildRoles(); buildResumes(); };
    head.append(del);
    box.append(head);

    const kwWrap = el('div', 'field');
    kwWrap.append(el('label', null, 'Match this role when the job page mentions'));
    const kw = el('input');
    kw.type = 'text';
    kw.placeholder = 'product manager, product owner, PM, roadmap';
    kw.value = (role.keywords || []).join(', ');
    kw.oninput = () => { role.keywords = kw.value.split(',').map(x => x.trim()).filter(Boolean); queueSave(); };
    kwWrap.append(kw);
    box.append(kwWrap);

    const flags = el('div', 'row');
    const pin = el('label', 'check');
    const pinCb = el('input'); pinCb.type = 'checkbox'; pinCb.checked = !!role.pinned;
    pinCb.onchange = () => {
      roles.forEach(r => { r.pinned = false; });
      role.pinned = pinCb.checked;
      queueSave(); buildRoles();
    };
    pin.append(pinCb, document.createTextNode('Always use this role (ignore page detection)'));

    const dflt = el('label', 'check');
    const dfCb = el('input'); dfCb.type = 'checkbox'; dfCb.checked = !!role.isDefault;
    dfCb.onchange = () => {
      roles.forEach(r => { r.isDefault = false; });
      role.isDefault = dfCb.checked;
      queueSave(); buildRoles();
    };
    dflt.append(dfCb, document.createTextNode('Fall back to this role'));
    flags.append(pin, dflt);
    box.append(flags);

    const det = el('details');
    det.append(el('summary', null, 'Field overrides for this role'));
    const grid = el('div', 'grid');
    role.overrides = role.overrides || {};
    for (const key of ROLE_OVERRIDE_KEYS) {
      const long = key === 'summary' || key === 'coverLetter' || key === 'skills';
      const w = el('div', 'field' + (long ? ' full' : ''));
      w.append(el('label', null, labelOf(key)));
      const inp = el(long ? 'textarea' : 'input');
      if (!long) inp.type = 'text';
      inp.placeholder = profile[key] ? `Base: ${String(profile[key]).slice(0, 60)}` : 'Leave blank to use the base profile';
      inp.value = role.overrides[key] || '';
      inp.oninput = () => { role.overrides[key] = inp.value; queueSave(); };
      w.append(inp);
      grid.append(w);
    }
    det.append(grid);
    box.append(det);

    host.append(box);
  });
}

function bindSettings() {
  for (const id of ['useAI', 'aiForFreeText', 'autofillOnLoad', 'confirmSensitive', 'attachResume', 'aiPickRole', 'showLauncher', 'autoScore', 'autoApply', 'learnFromTyping']) {
    const n = $(id);
    n.checked = !!settings[id];
    n.onchange = () => { settings[id] = n.checked; queueSave(); };
  }
  for (const id of ['applyMin', 'skipBelow', 'autoApplyMin']) {
    const n = $(id);
    n.value = settings[id] != null ? settings[id] : DEFAULT_SETTINGS[id];
    n.onchange = () => { settings[id] = Math.max(0, Math.min(100, Number(n.value) || 0)); queueSave(); };
  }
  $('model').value = settings.model || DEFAULT_SETTINGS.model;
  $('model').onchange = () => { settings.model = $('model').value; queueSave(); };
  $('launcherOffHosts').value = (settings.launcherOffHosts || []).join(', ');
  $('launcherOffHosts').oninput = () => {
    settings.launcherOffHosts = $('launcherOffHosts').value.split(',').map(s => s.trim()).filter(Boolean);
    queueSave();
  };
  $('blockedHosts').value = (settings.blockedHosts || []).join(', ');
  $('blockedHosts').oninput = () => {
    settings.blockedHosts = $('blockedHosts').value.split(',').map(s => s.trim()).filter(Boolean);
    queueSave();
  };
}

function queueSave() {
  $('saveState').textContent = 'Saving…';
  clearTimeout(saveTimer);
  saveTimer = setTimeout(async () => {
    await chrome.storage.local.set({ profile, settings, roles, answers, passengers });
    $('saveState').textContent = 'Saved ' + new Date().toLocaleTimeString();
    if (settings.syncEnabled !== false) pushSync();
  }, 300);
}

/* --- API key --- */
function bindKey() {
  const key = $('apiKey');
  chrome.storage.local.get('apiKey').then(({ apiKey }) => {
    key.value = apiKey || '';
    reflectKey(!!apiKey);
  });
  key.oninput = () => {
    const v = key.value.trim();
    chrome.storage.local.set({ apiKey: v });
    reflectKey(!!v);
  };

  $('aiCard').addEventListener('toggle', () => { $('aiCard').dataset.touched = '1'; });

  $('toggleKey').onclick = () => {
    const showing = key.type === 'text';
    key.type = showing ? 'password' : 'text';
    $('toggleKey').textContent = showing ? 'Show' : 'Hide';
  };

  $('testKey').onclick = async () => {
    const s = $('keyStatus');
    s.className = 'hint'; s.textContent = 'Testing…';
    const r = await chrome.runtime.sendMessage({ type: 'SF_TEST_KEY', apiKey: key.value.trim(), model: $('model').value });
    s.className = 'hint ' + (r.ok ? 'ok' : 'err');
    s.textContent = r.ok ? 'Key works.' : 'Failed — ' + r.error;
  };
}

/** The "needs a key" chips go green once one is saved. */
function reflectKey(has) {
  for (const n of document.querySelectorAll('.need')) {
    n.textContent = has ? 'active' : 'needs a key';
    n.classList.toggle('on', has);
  }
  const card = $('aiCard');
  if (card && !has && !card.dataset.touched) card.open = false;
}

/* --- backup --- */
function bindBackup() {
  $('export').onclick = async () => {
    const btn = $('export');
    btn.disabled = true;
    btn.textContent = 'Packing resumes…';
    try {
      // Resumes are blobs in IndexedDB, so they have to be inlined as base64 —
      // otherwise a restore on a new machine comes back without them.
      const files = [];
      for (const m of resumes) {
        const rec = await STORE.get(m.id);
        if (!rec) continue;
        files.push({
          id: rec.id, filename: rec.filename, mime: rec.mime,
          size: rec.size, addedAt: rec.addedAt,
          data: await STORE.toBase64(rec.blob)
        });
      }
      const payload = { version: 1, exportedAt: new Date().toISOString(), profile, settings, roles, answers, passengers, learned, resumes: files };
      const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
      const a = document.createElement('a');
      a.href = URL.createObjectURL(blob);
      a.download = `smartfill-backup-${new Date().toISOString().slice(0, 10)}.json`;
      a.click();
      URL.revokeObjectURL(a.href);
    } finally {
      btn.disabled = false;
      btn.textContent = 'Export everything (JSON)';
    }
  };
  $('import').onclick = () => $('importFile').click();
  $('importFile').onchange = async e => {
    const file = e.target.files[0];
    if (!file) return;
    try {
      const data = JSON.parse(await file.text());
      profile = data.profile || data;
      settings = { ...DEFAULT_SETTINGS, ...(data.settings || {}) };
      roles = data.roles || [];
      answers = data.answers || [];
      learned = data.learned || learned;
      await chrome.storage.local.set({ profile, settings, roles, answers, passengers, learned });

      let restored = 0;
      for (const f of (data.resumes || [])) {
        if (!f.data) continue;
        await STORE.putRaw({
          id: f.id, filename: f.filename, mime: f.mime, size: f.size,
          addedAt: f.addedAt || Date.now(),
          blob: STORE.base64ToBlob(f.data, f.mime)
        });
        restored++;
      }

      buildSections(); buildCustom(); bindSettings(); buildAnswers(); buildPax(); buildLearned();
      await refreshResumes();
      $('saveState').textContent = restored
        ? `Imported, including ${restored} resume${restored === 1 ? '' : 's'}`
        : 'Imported';
    } catch (err) {
      alert('That file could not be read as a Smartfill profile: ' + err.message);
    }
    e.target.value = '';
  };
  $('wipe').onclick = async () => {
    if (!confirm('Erase your profile, settings and API key from this browser? This cannot be undone.')) return;
    await chrome.storage.local.clear();
    if (confirm('Also erase the copy in your Google account? Cancel keeps it, so another machine can still restore.')) await SYNC.clear();
    profile = {}; settings = { ...DEFAULT_SETTINGS }; roles = []; answers = []; passengers = []; learned = [];
    for (const r of resumes) await STORE.remove(r.id);
    await refreshResumes();
    buildSections(); buildCustom(); bindSettings(); buildAnswers(); buildPax();
    $('apiKey').value = '';
    $('saveState').textContent = 'Erased';
  };
}

(async function init() {
  await SYNC.pullIfNewer();
  const got = await chrome.storage.local.get(['profile', 'settings', 'roles', 'answers', 'passengers', 'learned']);
  profile = got.profile || {};
  settings = { ...DEFAULT_SETTINGS, ...(got.settings || {}) };
  roles = got.roles || [];
  answers = got.answers || [];
  passengers = got.passengers || [];
  learned = got.learned || [];
  buildSections();
  buildLearned();
  buildAnswers();
  buildPax();
  buildCustom();
  bindSettings();
  bindKey();
  bindBackup();
  $('addCustom').onclick = () => { profile.customFields.push({ key: '', value: '' }); buildCustom(); };
  $('addPax').onclick = () => { passengers.push({}); buildPax(); queueSave(); };
  $('addAnswer').onclick = () => { answers.push({ match: '', value: '' }); buildAnswers(); };
  $('seedAnswers').onclick = seedAnswers;
  $('addRole').onclick = () => {
    roles.push({ id: newRoleId(), name: '', keywords: [], resumeId: '', overrides: {}, isDefault: roles.length === 0 });
    queueSave(); buildRoles();
  };
  bindResumeUpload();
  await refreshResumes();
  await initSync();
})();
