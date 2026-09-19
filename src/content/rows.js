/* Multi-row forms: the "add another passenger / traveller" pattern.

   One block of fields repeats per person. The tricky part is not filling a row,
   it is knowing where one row ends and the next begins — these forms rarely mark
   rows up as a list. The anchor here is the name field: every row has exactly one,
   so N name fields means N rows, and a row is the smallest ancestor of a name
   field that also contains its own age field. */
(function () {
  const { passengerKeyFor } = globalThis.SF_SCHEMA;
  const { matchOption } = globalThis.SF_RULES;
  const { fill } = globalThis.SF_FILLER;

  const NAME_RE = /(passenger|traveller|traveler).?name|\bname\b/i;
  const AGE_RE = /\bage\b|\byrs\b/i;
  const ADD_RE = /^(\+\s*)?add\s*(one\s*)?(more\s*)?(another\s*)?(passenger|traveller|traveler|person|adult|guest)/i;
  const wait = ms => new Promise(r => setTimeout(r, ms));

  const humanize = v => String(v || '')
    .replace(/[_\-.\[\]]+/g, ' ')
    .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
    .replace(/\s+/g, ' ').trim();

  function textFor(el) {
    const bits = [];
    if (el.tagName.toLowerCase() === 'p-dropdown') {
      const fl = el.closest('.ui-float-label, .form-group');
      if (fl) bits.push((fl.querySelector('label') || {}).innerText || '');
      bits.push(el.getAttribute('aria-label') || '', humanize(el.id));
      return bits.join(' ').replace(/\s+/g, ' ').trim();
    }
    if (el.id) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
      document.querySelectorAll(`label[for="${esc}"]`).forEach(l => bits.push(l.innerText || ''));
    }
    const lab = el.closest('label');
    if (lab) bits.push(lab.innerText || '');
    bits.push(el.getAttribute('aria-label') || '', el.placeholder || '');
    bits.push(humanize(el.getAttribute('formcontrolname') || el.getAttribute('ng-reflect-name') || ''));
    bits.push(humanize(el.name), humanize(el.id));
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  const shown = el => {
    if (!el || el.disabled) return false;
    const r = el.getBoundingClientRect();
    return r.width > 0 && r.height > 0;
  };

  const isNameField = el => NAME_RE.test(textFor(el))
    && !/company|father|mother|user|account|bank/i.test(textFor(el));

  const nameCount = box =>
    [...box.querySelectorAll('input')].filter(el => shown(el) && isNameField(el)).length;

  /** The largest ancestor of `nameEl` that still contains exactly one name field.
      Stopping at the first ancestor with an age field truncates the row on real
      forms — berth and food preferences often sit in a later wrapper. */
  function rowFor(nameEl) {
    let best = nameEl.parentElement;
    let box = nameEl.parentElement;
    for (let i = 0; i < 10 && box && box !== document.body; i++, box = box.parentElement) {
      if (nameCount(box) === 1) best = box; else break;
    }
    return best;
  }

  function findRows() {
    const names = [...document.querySelectorAll('input[type=text], input:not([type]), input[type=search]')]
      .filter(el => shown(el) && isNameField(el));

    const rows = [];
    for (const n of names) {
      const box = rowFor(n);
      if (rows.some(r => r.box === box)) continue;
      rows.push({ box, nameEl: n });
    }
    return rows;
  }

  function addButton() {
    const cands = [...document.querySelectorAll('button, a, span[role=button], div[role=button], input[type=button]')];
    return cands.find(b => shown(b) && ADD_RE.test((b.innerText || b.value || '').replace(/\s+/g, ' ').trim())) || null;
  }

  /** Fill one row's controls from one passenger record. */
  async function fillRow(row, person) {
    const out = [];
    const controls = [...row.box.querySelectorAll('input, select, textarea, p-dropdown')]
      .filter(el => shown(el) && !(el.closest('p-dropdown') && el.tagName.toLowerCase() !== 'p-dropdown'));
    const used = new Set();

    for (const el of controls) {
      const type = (el.type || '').toLowerCase();
      if (type === 'hidden' || type === 'submit' || type === 'button' || type === 'file') continue;

      const hay = textFor(el);
      const key = passengerKeyFor(hay);
      if (!key || used.has(key)) continue;
      const value = person[key];
      if (!value || !String(value).trim()) continue;

      const field = {
        el,
        kind: el.tagName.toLowerCase() === 'p-dropdown' ? 'uidropdown'
          : el.tagName === 'SELECT' ? 'select'
          : el.tagName === 'TEXTAREA' ? 'textarea' : (type || 'text'),
        options: el.tagName === 'SELECT'
          ? [...el.options].filter(o => o.value !== '').map(o => ({ value: o.value, text: o.text.trim() }))
          : null,
        attrs: { maxlength: el.maxLength > 0 ? el.maxLength : null, placeholder: el.placeholder || '' },
        haystack: hay.toLowerCase(),
        label: hay.slice(0, 60)
      };

      const r = await fill(field, String(value));
      used.add(key);
      out.push({ key, ok: r.ok, applied: r.applied, reason: r.reason, el });
    }
    return out;
  }

  /**
   * Fill every passenger, adding rows as needed.
   * Returns [{ index, name, filled, missing }] — one entry per passenger.
   */
  async function fillPassengers(passengers, opts = {}) {
    const people = (passengers || []).filter(p => p && String(p.name || '').trim());
    if (!people.length) return { ok: false, reason: 'no passengers saved' };

    let rows = findRows();
    if (!rows.length) return { ok: false, reason: 'no passenger rows on this page' };

    const report = [];
    for (let i = 0; i < people.length; i++) {
      if (i >= rows.length) {
        const btn = addButton();
        if (!btn) {
          report.push({ index: i + 1, name: people[i].name, filled: [], missing: true,
            reason: 'no "add passenger" button found' });
          continue;
        }
        btn.click();
        // These forms render the new row asynchronously; poll rather than guess.
        for (let t = 0; t < 12 && findRows().length <= rows.length; t++) await wait(60);
        rows = findRows();
        if (i >= rows.length) {
          report.push({ index: i + 1, name: people[i].name, filled: [], missing: true,
            reason: 'the form did not add another row' });
          continue;
        }
      }
      const filled = await fillRow(rows[i], people[i]);
      report.push({ index: i + 1, name: people[i].name, filled, missing: false });
    }
    return { ok: true, rows: rows.length, report };
  }

  globalThis.SF_ROWS = { fillPassengers, findRows, addButton, fillRow };
})();
