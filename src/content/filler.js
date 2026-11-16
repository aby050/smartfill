/* Writes values into controls in a way React/Vue/Angular actually notice.
   Setting .value directly bypasses React's synthetic-event tracking, so the
   native setter is called and an input event is dispatched by hand. */
(function () {
  const { matchOption, norm } = globalThis.SF_RULES;

  const wait = ms => new Promise(r => setTimeout(r, ms));

  /* ---- PrimeNG ----
     Sites built on PrimeNG (IRCTC among them) ship no <select> elements at all:
     a dropdown is a <p-dropdown> holding a label span and a hidden input, and its
     options only exist in an overlay panel that appears after a click. Writing
     .value does nothing. These have to be driven the way a person drives them —
     open the panel, find the option, click it. */

  const PANEL_DD = '.ui-dropdown-panel, .p-dropdown-panel';
  const ITEM_DD = 'li.ui-dropdown-item, li.p-dropdown-item, li[role=option]';
  const PANEL_AC = '.ui-autocomplete-panel, .p-autocomplete-panel';

  async function untilVisible(selector, ms = 1400) {
    const deadline = Date.now() + ms;
    while (Date.now() < deadline) {
      for (const el of document.querySelectorAll(selector)) {
        const r = el.getBoundingClientRect();
        if (r.width > 0 && r.height > 0) return el;
      }
      await wait(50);
    }
    return null;
  }

  function currentLabel(root) {
    const l = root.querySelector('.ui-dropdown-label, .p-dropdown-label');
    return l ? (l.innerText || '').trim() : '';
  }

  async function fillPrimeDropdown(root, value) {
    const trigger = root.querySelector('.ui-dropdown-trigger, .p-dropdown-trigger')
      || root.querySelector('.ui-dropdown-label-container') || root;
    trigger.click();

    const panel = await untilVisible(PANEL_DD);
    if (!panel) return { ok: false, reason: 'dropdown did not open' };

    const items = [...panel.querySelectorAll(ITEM_DD)];
    const options = items.map((li, i) => ({ value: String(i), text: (li.innerText || '').replace(/\s+/g, ' ').trim() }));
    const hit = matchOption(value, options);

    if (!hit) {
      // Leave the page as we found it rather than stranding an open overlay.
      document.body.click();
      return { ok: false, reason: 'no matching option' };
    }
    items[Number(hit.value)].click();
    await wait(80);
    const after = currentLabel(root);
    return { ok: !!after && norm(after) !== norm(''), applied: after || hit.text };
  }

  async function fillPrimeAutocomplete(input, value) {
    input.focus();
    input.click();
    nativeSet(input, '');
    fire(input, ['input']);
    await wait(120);

    // Setting the whole string at once fires one debounced lookup that these
    // widgets frequently drop. Typing it out is what actually opens the panel.
    for (const ch of String(value)) {
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: ch }));
      nativeSet(input, input.value + ch);
      fire(input, ['input']);
      input.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: ch }));
      await wait(70);
    }

    const panel = await untilVisible(PANEL_AC, 2500);
    if (!panel) {
      return { ok: !!input.value, applied: input.value, reason: input.value ? null : 'no suggestions' };
    }
    const items = [...panel.querySelectorAll('li')].filter(li => (li.innerText || '').trim());
    if (!items.length) return { ok: false, reason: 'no suggestions' };

    const options = items.map((li, i) => ({ value: String(i), text: (li.innerText || '').replace(/\s+/g, ' ').trim() }));
    const hit = matchOption(value, options) || options[0];   // first suggestion is the site's own best guess
    items[Number(hit.value)].click();
    await wait(80);
    return { ok: !!input.value, applied: input.value || hit.text };
  }

  /* ---- ARIA combobox (MUI Autocomplete, Deel, many React design systems) ----
     The input is role=combobox and its options only exist in a popup listbox once it
     is opened. Open it the way a person does, read the real options, click the match;
     on a long list, type to filter first. */
  const textOf = li => (li.innerText || li.getAttribute('data-text') || '').replace(/\s+/g, ' ').trim();

  function listboxOptions(input) {
    const id = input.getAttribute('aria-controls');
    const lb = (id && (input.getRootNode().getElementById(id) || document.getElementById(id))) ||
      [...globalThis.SF_DOM.deepAll('[role=listbox]')].find(l => l.getBoundingClientRect().height > 0);
    // Oracle JET renders its popup as role=grid with one role=row per choice.
    return lb ? [...lb.querySelectorAll('[role=option], [role=row]')].filter(o => textOf(o)) : [];
  }

  async function openCombobox(input) {
    input.focus();
    for (const type of ['mousedown', 'mouseup', 'click']) {
      input.dispatchEvent(new MouseEvent(type, { bubbles: true, cancelable: true, view: window }));
    }
    for (let i = 0; i < 24; i++) {
      if (listboxOptions(input).length) return true;
      await wait(60);
    }
    // Some widgets only open from the keyboard.
    input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'ArrowDown' }));
    for (let i = 0; i < 12; i++) {
      if (listboxOptions(input).length) return true;
      await wait(60);
    }
    return false;
  }

  async function fillCombobox(input, value) {
    if (!(await openCombobox(input))) return { ok: false, reason: 'dropdown did not open' };

    const read = () => listboxOptions(input).map((li, i) => ({ value: String(i), text: textOf(li) }));
    let opts = read();
    let hit = matchOption(value, opts);

    // Long or searchable list and no direct hit: type it out to narrow the list.
    if (!hit && String(value).length > 1) {
      nativeSet(input, '');
      for (const ch of String(value)) {
        nativeSet(input, input.value + ch);
        fire(input, ['input']);
        await wait(40);
      }
      await wait(350);
      opts = read();
      hit = matchOption(value, opts) || (opts.length === 1 ? opts[0] : null);
    }

    if (!hit) {
      // Oracle's Pin code / City boxes accept what you type when the lookup has no
      // row for it, so keep the typed text and let the page commit it. Closed lists
      // (certifications, ethnicity) are never kept this way.
      const free = /(postal|pin ?code|zip|city|town)/i.test([input.id, input.name, input.getAttribute('aria-label')].join(' '));
      if (free && input.value) {
        fire(input, ['change']);
        input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Enter' }));
        input.blur();
        await wait(120);
        return { ok: true, applied: input.value };
      }
      input.dispatchEvent(new KeyboardEvent('keydown', { bubbles: true, key: 'Escape' }));
      document.body.click();
      return { ok: false, reason: 'no matching option' };
    }
    listboxOptions(input)[Number(hit.value)].click();
    await wait(120);
    return { ok: true, applied: hit.text };
  }

  const MONTHS = ['january', 'february', 'march', 'april', 'may', 'june',
    'july', 'august', 'september', 'october', 'november', 'december'];

  /* A p-calendar keeps its own model and throws away a written value on the next
     render, so the picker has to be navigated and clicked. */
  async function fillPrimeCalendar(root, iso) {
    const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(String(iso).trim());
    if (!m) return { ok: false, reason: 'date must be YYYY-MM-DD' };
    const wantY = +m[1], wantM = +m[2] - 1, wantD = +m[3];

    const input = root.querySelector('input');
    if (!input) return { ok: false, reason: 'no date input' };
    input.focus();
    input.click();

    let panel = await untilVisible('.ui-datepicker, .p-datepicker');
    if (!panel) return { ok: false, reason: 'calendar did not open' };

    for (let guard = 0; guard < 24; guard++) {
      const title = panel.querySelector('.ui-datepicker-title, .p-datepicker-title');
      if (!title) break;
      const mName = (title.querySelector('[class*=datepicker-month]') || {}).innerText || '';
      const yName = (title.querySelector('[class*=datepicker-year]') || {}).innerText || '';
      const curM = MONTHS.indexOf(mName.trim().toLowerCase());
      const curY = parseInt(yName, 10);
      if (curM === wantM && curY === wantY) break;
      const forward = (curY < wantY) || (curY === wantY && curM < wantM);
      const nav = panel.querySelector(forward ? '[class*=datepicker-next]' : '[class*=datepicker-prev]');
      if (!nav) return { ok: false, reason: 'cannot change month' };
      nav.click();
      await wait(180);
      panel = document.querySelector('.ui-datepicker, .p-datepicker') || panel;
    }

    const cells = [...panel.querySelectorAll('[class*=datepicker-calendar] td')]
      .filter(td => !td.className.includes('other-month'));
    const cell = cells.find(td => (td.innerText || '').trim() === String(wantD));
    if (!cell) return { ok: false, reason: 'day not shown' };
    if (cell.className.includes('ui-state-disabled') || cell.className.includes('p-disabled')) {
      return { ok: false, reason: 'that date is not selectable' };
    }
    (cell.querySelector('a') || cell.querySelector('span') || cell).click();
    await wait(200);
    return { ok: !!input.value, applied: input.value };
  }

  const isPrimeAutocomplete = el =>
    el.classList && (el.classList.contains('ui-autocomplete-input') || el.classList.contains('p-autocomplete-input'));


  /* The rules engine hands dates out in the field's own display format; the
     picker needs them back as YYYY-MM-DD. */
  function toIso(v) {
    const t = String(v).trim();
    let m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(t);
    if (m) return t;
    m = /^(\d{1,2})[\/.-](\d{1,2})[\/.-](\d{4})$/.exec(t);
    if (m) return `${m[3]}-${String(m[2]).padStart(2, '0')}-${String(m[1]).padStart(2, '0')}`;
    const d = new Date(t);
    return isNaN(d) ? t : d.toISOString().slice(0, 10);
  }

  function nativeSet(el, value) {
    const proto = el.tagName === 'TEXTAREA' ? HTMLTextAreaElement.prototype
      : el.tagName === 'SELECT' ? HTMLSelectElement.prototype
        : HTMLInputElement.prototype;
    const desc = Object.getOwnPropertyDescriptor(proto, 'value');
    if (desc && desc.set) desc.set.call(el, value);
    else el.value = value;
  }

  function fire(el, types) {
    for (const t of types) {
      el.dispatchEvent(new Event(t, { bubbles: true, composed: true }));
    }
  }

  function focusRing(el) {
    try { el.focus({ preventScroll: true }); } catch { /* detached */ }
  }

  /** Returns a result, or a Promise of one for widgets that must be clicked open. */
  function fill(field, value) {
    const el = field.el;
    if (!el || !el.isConnected) return { ok: false, reason: 'gone' };

    try {
      focusRing(el);

      if (field.kind === 'combobox') return fillCombobox(el, value);
      if (field.kind === 'pills') {
        const opt = matchOption(value, field.options);
        if (!opt) return { ok: false, reason: 'no matching option' };
        const btn = [...el.querySelectorAll('[role=radio]')].find(b => textOf(b) === opt.text);
        if (!btn) return { ok: false, reason: 'no matching option' };
        if (btn.getAttribute('aria-checked') !== 'true') btn.click();
        return { ok: true, applied: opt.text };
      }
      if (field.kind === 'uidropdown') return fillPrimeDropdown(el, value);
      if (field.kind === 'uicalendar') return fillPrimeCalendar(el, toIso(value));
      if (isPrimeAutocomplete(el)) return fillPrimeAutocomplete(el, value);

      if (field.kind === 'checkbox') {
        const want = /^(true|yes|on|1|checked)$/i.test(String(value));
        if (el.checked !== want) { el.click(); }
        return { ok: true, applied: want ? 'checked' : 'unchecked' };
      }

      if (field.kind === 'radio') {
        const opt = matchOption(value, field.options);
        if (!opt) return { ok: false, reason: 'no matching option' };
        const target = [...el.getRootNode().querySelectorAll(`input[type=radio][name="${el.name}"]`)]
          .find(r => r.value === opt.value);
        if (!target) return { ok: false, reason: 'no matching option' };
        target.click();
        return { ok: true, applied: opt.text || opt.value };
      }

      if (field.kind === 'select' || field.kind === 'multiselect') {
        const opt = matchOption(value, field.options);
        if (!opt) return { ok: false, reason: 'no matching option' };
        nativeSet(el, opt.value);
        fire(el, ['input', 'change']);
        return { ok: true, applied: opt.text || opt.value };
      }

      if (field.kind === 'richtext') {
        el.focus();
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, String(value));
        fire(el, ['input', 'change', 'blur']);
        return { ok: true, applied: value };
      }

      // Plain text-ish inputs and textareas.
      nativeSet(el, '');
      fire(el, ['input']);
      nativeSet(el, String(value));
      fire(el, ['input', 'change']);
      el.dispatchEvent(new KeyboardEvent('keyup', { bubbles: true, key: 'Unidentified' }));
      el.blur();
      fire(el, ['blur']);

      if (el.value !== String(value)) {
        return { ok: el.value !== '', applied: el.value, reason: el.value ? 'coerced by page' : 'rejected by page' };
      }
      return { ok: true, applied: value };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  globalThis.SF_FILLER = { fill };
})();
