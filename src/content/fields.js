/* Scans the page for fillable controls and describes each one well enough
   that either the rule engine or Claude can decide what belongs in it. */
(function () {
  const SKIP_TYPES = new Set(['hidden', 'submit', 'button', 'reset', 'image', 'file']);
  const CREDENTIAL_RE = /(password|passwd|pwd|\bcvv\b|\bcvc\b|card.?number|security.?code|otp|one.?time|verification.?code|captcha)/i;

  /* Consents, declarations and undertakings. These are legal statements the
     applicant makes about themselves — a machine must never answer one on their
     behalf, however obvious the answer looks. Detected here, never sent to Claude,
     never filled; the panel lists them so they are not silently missed. */
  const CONSENT_RE = new RegExp([
    '\\bconsent\\b', 'i consent', 'consent to', 'do you consent', '\\(required\\)', '\\(optional\\)',
    'i agree', 'i hereby', 'i confirm', 'i understand', 'i declare', 'i certify',
    'acknowledge and agree', 'agree to the', 'accept the',
    'privacy policy', 'terms (and|&) conditions', 'terms of (use|service)',
    'declaration', 'undertaking', 'by submitting',
    'authori[sz]e (us|the company|coupang)', 'permission to (contact|collect|share)',
    'reference check', 'background (check|verification)', 'opt.?in'
  ].join('|'), 'i');

  const NOT_CONSENT_RE = /(authori[sz]ed to work|work authori[sz]ation|right to work|require a visa|need sponsorship)/i;

  let seq = 0;

  function visible(el) {
    if (!el.isConnected) return false;
    if (el.disabled || el.readOnly) return false;
    if (el.classList && el.classList.contains('ui-state-disabled')) return false;
    const st = getComputedStyle(el);
    if (st.visibility === 'hidden' || st.display === 'none' || st.opacity === '0') return false;
    const r = el.getBoundingClientRect();
    // radios/checkboxes are often visually replaced by a styled span
    if (r.width === 0 && r.height === 0) return el.type === 'radio' || el.type === 'checkbox';
    return true;
  }

  function textOf(node) {
    if (!node) return '';
    return (node.innerText || node.textContent || '').replace(/\s+/g, ' ').trim().slice(0, 200);
  }

  function humanize(s) {
    return String(s || '')
      .replace(/[_\-.\[\]]+/g, ' ')
      .replace(/([a-z0-9])([A-Z])/g, '$1 $2')
      .replace(/\s+/g, ' ')
      .trim();
  }

  function labelFor(el) {
    const out = [];
    const id = el.id;
    if (id) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(id) : id.replace(/"/g, '\\"');
      for (const l of document.querySelectorAll(`label[for="${esc}"]`)) out.push(textOf(l));
    }
    const wrap = el.closest('label');
    if (wrap) out.push(textOf(wrap));

    const al = el.getAttribute('aria-label');
    if (al) out.push(al.trim());

    const lb = el.getAttribute('aria-labelledby');
    if (lb) for (const ref of lb.split(/\s+/)) out.push(textOf(document.getElementById(ref)));

    const db = el.getAttribute('aria-describedby');
    if (db) for (const ref of db.split(/\s+/)) out.push(textOf(document.getElementById(ref)));

    if (!out.filter(Boolean).length) {
      // Fall back to nearby text: previous sibling, or the container's first text.
      let prev = el.previousElementSibling;
      let hops = 0;
      while (prev && hops++ < 3) {
        const t = textOf(prev);
        if (t && t.length < 120) { out.push(t); break; }
        prev = prev.previousElementSibling;
      }
      const box = el.closest('div,td,li,section,p');
      if (box && box !== el) {
        const t = textOf(box);
        if (t && t.length < 160) out.push(t);
      }
    }
    return [...new Set(out.filter(Boolean))];
  }

  const WEAK_LABEL_RE = /^(select( one| an option)?|choose|your answer|type (here|your)|enter|search|please select|--)/i;
  const weakLabel = t => !t || t.length < 4 || WEAK_LABEL_RE.test(t.trim());

  /** Controls under `node` that a person would see as separate questions. */
  function questionCount(node) {
    const seen = new Set();
    for (const c of node.querySelectorAll('input, select, textarea, [role=combobox]')) {
      if (c.type === 'hidden' || c.type === 'file') continue;
      seen.add(c.type === 'radio' ? 'r:' + (c.name || c.id) : c);
    }
    return seen.size;
  }

  /* Plenty of design systems render the question as a bare <div> above the control
     — no <label>, no aria-labelledby. Climb until the container holds exactly this
     one question, then take the first real line of text in it. */
  function contextQuestion(el) {
    let n = el.closest('[role="radiogroup"]') || el;
    for (let i = 0; i < 6; i++) {
      n = n.parentElement;
      if (!n || n === document.body) return '';
      if (questionCount(n) > 1) return '';
      const lines = (n.innerText || '').split('\n').map(l => l.replace(/\s+/g, ' ').trim()).filter(Boolean);
      const q = lines.find(l => l.length >= 8 && !weakLabel(l));
      if (q) return q.replace(/\s*\*\s*$/, '').slice(0, 200);
    }
    return '';
  }

  function groupLabel(el) {
    const fs = el.closest('fieldset');
    if (fs) {
      const lg = fs.querySelector('legend');
      if (lg) return textOf(lg);
    }
    const grp = el.closest('[role="radiogroup"],[role="group"]');
    if (grp) {
      const al = grp.getAttribute('aria-label');
      if (al) return al.trim();
    }
    return '';
  }

  function optionsOf(el) {
    if (el.tagName === 'SELECT') {
      return [...el.options]
        .filter(o => o.value !== '' || o.text.trim() !== '')
        .slice(0, 300)
        .map(o => ({ value: o.value, text: o.text.replace(/\s+/g, ' ').trim() }));
    }
    if (el.type === 'radio' && el.name) {
      const peers = [...el.form ? el.form.elements : document.querySelectorAll(`input[type=radio][name="${el.name}"]`)]
        .filter(x => x.type === 'radio' && x.name === el.name);
      return peers.slice(0, 60).map(p => ({ value: p.value, text: (labelFor(p)[0] || p.value || '').slice(0, 80) }));
    }
    return null;
  }

  function kindOf(el) {
    // PrimeNG renders a dropdown as a custom element with an overlay panel and no
    // <select> anywhere, so it needs its own kind and its own fill path.
    const tag = el.tagName.toLowerCase();
    if (tag === 'p-dropdown') return 'uidropdown';
    if (tag === 'p-calendar') return 'uicalendar';
    if (el.tagName === 'SELECT') return el.multiple ? 'multiselect' : 'select';
    if (el.tagName === 'TEXTAREA') return 'textarea';
    if (el.isContentEditable) return 'richtext';
    const t = (el.type || 'text').toLowerCase();
    // MUI / Headless / Deel-style autocompletes: a text input with role=combobox whose
    // options live in a popup listbox, not in the DOM until it is opened.
    if (el.tagName === 'INPUT' && el.getAttribute('role') === 'combobox' &&
      !/(^|\s)(ui|p)-autocomplete-input(\s|$)/.test(el.className)) return 'combobox';
    if (t === 'checkbox') return 'checkbox';
    if (t === 'radio') return 'radio';
    return t; // text, email, tel, url, number, date, month, search, password
  }

  function collect(root = document) {
    const els = [...root.querySelectorAll(
      'input, select, textarea, [contenteditable="true"], [role="textbox"], p-dropdown, p-calendar')];
    const seenRadioGroups = new Set();
    const out = [];

    for (const el of els) {
      if (el.tagName === 'INPUT' && SKIP_TYPES.has((el.type || '').toLowerCase())) continue;
      if (el.closest('.sf-panel')) continue;
      if (!visible(el)) continue;

      const kind = kindOf(el);
      if (kind === 'password') continue;
      // The inner input of a PrimeNG widget is collected via its wrapper instead.
      if (el.closest('p-dropdown') && kind !== 'uidropdown') continue;

      // One descriptor per radio group.
      if (kind === 'radio') {
        const gk = (el.form ? el.form.name || '' : '') + '|' + el.name;
        if (seenRadioGroups.has(gk)) continue;
        seenRadioGroups.add(gk);
      }

      let labels = labelFor(el);
      let group = groupLabel(el);
      // Radio options are labelled "1 - 3 years"; the question sits above the group.
      if (kind === 'radio' && !group) group = contextQuestion(el);
      else if (kind !== 'radio' && labels.every(weakLabel)) {
        const q = contextQuestion(el);
        if (q) labels = [q, ...labels];
      }
      const attrs = {
        name: el.name || '',
        id: el.id || '',
        placeholder: el.placeholder || '',
        autocomplete: (el.getAttribute('autocomplete') || '').toLowerCase(),
        type: (el.getAttribute('type') || '').toLowerCase(),
        maxlength: el.maxLength > 0 ? el.maxLength : null,
        required: el.required || el.getAttribute('aria-required') === 'true',
        pattern: el.getAttribute('pattern') || '',
        dataFields: Object.entries(el.dataset || {}).filter(([k]) => k !== 'sfId').map(([k, v]) => `${k}=${v}`).slice(0, 5).join(' ')
      };

      const haystack = [
        group,
        ...labels,
        attrs.placeholder,
        humanize(attrs.name),
        humanize(attrs.id),
        humanize(attrs.dataFields),
        attrs.autocomplete
      ].filter(Boolean).join(' \n ').toLowerCase();

      if (CREDENTIAL_RE.test(haystack)) continue;

      const isConsent = CONSENT_RE.test(haystack) && !NOT_CONSENT_RE.test(haystack);

      const sfid = 'sf' + (++seq);
      el.setAttribute('data-sf-id', sfid);

      out.push({
        sfid,
        el,
        kind,
        label: group ? `${group} — ${labels[0] || ''}`.trim().replace(/ —\s*$/, '') : (labels[0] || humanize(attrs.name) || humanize(attrs.id)),
        labels,
        group,
        attrs,
        haystack,
        options: optionsOf(el),
        isConsent,
        hasValue: !!currentValue(el)
      });
    }
    return out;
  }

  function currentValue(el) {
    const tag = el.tagName.toLowerCase();
    if (tag === 'p-dropdown') {
      const lab = el.querySelector('.ui-dropdown-label, .p-dropdown-label');
      if (!lab) return '';
      if (lab.classList.contains('ui-dropdown-label-empty')) return '';
      const t = (lab.innerText || '').trim();
      // PrimeNG shows the placeholder in the same span as a real selection.
      return /^(select|choose|all classes|--)/i.test(t) ? '' : t;
    }
    if (tag === 'p-calendar') {
      const i = el.querySelector('input');
      return i ? (i.value || '').trim() : '';
    }
    if (el.isContentEditable) return el.textContent.trim();
    if (el.type === 'checkbox') return el.checked ? 'on' : '';
    if (el.type === 'radio') {
      const peers = document.querySelectorAll(`input[type=radio][name="${el.name}"]`);
      for (const p of peers) if (p.checked) return p.value;
      return '';
    }
    return (el.value || '').trim();
  }

  /** Strip DOM refs so the descriptor can cross the message boundary. */
  function serialize(f) {
    return {
      sfid: f.sfid,
      kind: f.kind,
      label: f.label,
      context: f.labels.slice(0, 3).join(' | '),
      group: f.group,
      name: f.attrs.name,
      id: f.attrs.id,
      placeholder: f.attrs.placeholder,
      autocomplete: f.attrs.autocomplete,
      maxlength: f.attrs.maxlength,
      required: f.attrs.required,
      options: f.options ? f.options.map(o => o.text || o.value).slice(0, 60) : null
    };
  }

  globalThis.SF_FIELDS = { collect, serialize, currentValue, humanize };
})();
