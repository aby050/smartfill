/* Resume attachment. A file input's `files` list is read-only, but assigning a
   DataTransfer's FileList is permitted in Chrome — that is what makes an
   automated attach possible at all. Dropzones with no input get a synthetic
   drag-and-drop instead. */
(function () {
  const RESUME_RE = /(resume|resum|cv\b|curriculum.?vitae|upload.?(your)?.?(resume|cv)|attach.?(resume|cv))/i;
  const COVER_RE = /(cover.?letter|motivation.?letter)/i;
  const PHOTO_RE = /(photo|photograph|headshot|profile.?picture|avatar|selfie)/i;
  const OTHER_DOC_RE = /(portfolio|transcript|certificate|payslip|id.?proof|aadha?ar|passport|marksheet)/i;
  const DROP_RE = /(drag.{0,12}drop|drop.{0,12}here|browse.{0,10}file|choose.{0,10}file|upload)/i;

  let seq = 0;

  function nearbyText(el) {
    const bits = [];
    if (el.id) {
      const esc = (window.CSS && CSS.escape) ? CSS.escape(el.id) : el.id;
      el.getRootNode().querySelectorAll(`label[for="${esc}"]`).forEach(l => bits.push(l.innerText || ''));
    }
    const lab = el.closest('label');
    if (lab) bits.push(lab.innerText || '');
    bits.push(el.getAttribute('aria-label') || '', el.name || '', el.id || '', el.className || '');
    // The visible prompt is usually on an ancestor, not the input itself.
    let box = el.parentElement;
    for (let i = 0; i < 4 && box; i++, box = box.parentElement) {
      const t = (box.innerText || '').replace(/\s+/g, ' ').trim();
      if (t && t.length < 300) { bits.push(t); break; }
    }
    const fs = el.closest('fieldset');
    if (fs && fs.querySelector('legend')) bits.push(fs.querySelector('legend').innerText || '');
    return bits.join(' ').replace(/\s+/g, ' ').trim();
  }

  function classify(text) {
    if (COVER_RE.test(text)) return 'cover';
    if (PHOTO_RE.test(text)) return 'photo';
    if (RESUME_RE.test(text)) return 'resume';
    if (OTHER_DOC_RE.test(text)) return 'other';
    return 'unknown';
  }

  /** File inputs, including the invisible ones behind a styled dropzone. */
  function collectFileInputs() {
    const out = [];
    for (const el of globalThis.SF_DOM.deepAll('input[type=file]')) {
      if (el.disabled) continue;
      if (globalThis.SF_DOM.inOurUi(el)) continue;
      const text = nearbyText(el);
      const sfid = 'sff' + (++seq);
      el.setAttribute('data-sf-file', sfid);
      out.push({
        sfid, el, kind: 'file',
        text,
        label: firstLine(text),
        purpose: classify(text),
        accept: el.getAttribute('accept') || '',
        multiple: el.multiple,
        already: el.files && el.files.length ? el.files[0].name : '',
        hidden: !isVisible(el)
      });
    }
    return out;
  }

  /** Dropzones that never expose an <input type=file> (rarer, but Workday-ish). */
  function collectDropzones(known) {
    if (known.length) return [];               // an input is always the better target
    const out = [];
    const cands = globalThis.SF_DOM.deepAll('[class*=drop], [class*=drag], [class*=upload], [data-testid*=upload]');
    for (const el of cands) {
      if (globalThis.SF_DOM.inOurUi(el) || !isVisible(el)) continue;
      const t = (el.innerText || '').replace(/\s+/g, ' ').trim();
      if (!t || t.length > 240) continue;
      if (!DROP_RE.test(t) || !RESUME_RE.test(t)) continue;
      if (out.some(o => o.el.contains(el))) continue;   // keep the outermost only
      const sfid = 'sfd' + (++seq);
      out.push({ sfid, el, kind: 'dropzone', text: t, label: firstLine(t), purpose: 'resume', accept: '', hidden: false });
    }
    return out.slice(0, 2);
  }

  function firstLine(t) {
    return String(t || '').split(/[.\n]/)[0].trim().slice(0, 70) || 'File upload';
  }

  function isVisible(el) {
    const st = getComputedStyle(el);
    if (st.display === 'none' || st.visibility === 'hidden') return false;
    const r = el.getBoundingClientRect();
    return r.width > 1 && r.height > 1;
  }

  function base64ToFile(b64, filename, mime) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new File([buf], filename, { type: mime, lastModified: Date.now() });
  }

  /** Does the input's `accept` list admit this file? */
  function accepts(acceptAttr, file) {
    if (!acceptAttr) return true;
    const ext = '.' + (file.name.split('.').pop() || '').toLowerCase();
    return acceptAttr.split(',').map(s => s.trim().toLowerCase()).filter(Boolean).some(tok => {
      if (tok === '*/*' || tok === '*') return true;
      if (tok.startsWith('.')) return tok === ext;
      if (tok.endsWith('/*')) return file.type.startsWith(tok.slice(0, -1));
      return file.type === tok;
    });
  }

  function attach(target, file) {
    try {
      if (!accepts(target.accept, file)) {
        return { ok: false, reason: `page only accepts ${target.accept}` };
      }
      const dt = new DataTransfer();
      dt.items.add(file);

      if (target.kind === 'dropzone') {
        const opts = { bubbles: true, cancelable: true, composed: true, dataTransfer: dt };
        target.el.dispatchEvent(new DragEvent('dragenter', opts));
        target.el.dispatchEvent(new DragEvent('dragover', opts));
        target.el.dispatchEvent(new DragEvent('drop', opts));
        return { ok: true, applied: file.name, note: 'dropped' };
      }

      const el = target.el;
      el.files = dt.files;
      if (!el.files || el.files.length === 0) return { ok: false, reason: 'page rejected the file' };
      el.dispatchEvent(new Event('input', { bubbles: true, composed: true }));
      el.dispatchEvent(new Event('change', { bubbles: true, composed: true }));
      // Some uploaders only listen for a drop on the wrapper, even with an input present.
      const zone = el.closest('[class*=drop],[class*=drag],[class*=upload]');
      if (zone && zone !== el) {
        zone.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, composed: true, dataTransfer: dt }));
      }
      return { ok: true, applied: file.name };
    } catch (e) {
      return { ok: false, reason: String(e && e.message || e) };
    }
  }

  function clear(target) {
    try {
      if (target.kind !== 'file') return;
      target.el.value = '';
      target.el.dispatchEvent(new Event('change', { bubbles: true }));
    } catch { /* nothing to undo */ }
  }

  function serialize(t) {
    return { sfid: t.sfid, label: t.label, purpose: t.purpose, accept: t.accept, context: t.text.slice(0, 200) };
  }

  globalThis.SF_FILES = { collectFileInputs, collectDropzones, attach, clear, base64ToFile, serialize, accepts, classify };
})();
