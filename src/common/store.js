/* Resume binary storage. chrome.storage.local is the wrong home for a few MB of
   PDFs, so files live in IndexedDB on the extension origin. Only the options page
   and the service worker can reach it directly — content scripts go via a message,
   because their IndexedDB belongs to the page, not to us.

   No import/export syntax: this file is loaded as a classic script by the options
   page and as a side-effect module import by the worker. */
(function () {
  const DB = 'smartfill';
  const STORE = 'resumes';
  const VERSION = 1;
  const MAX_BYTES = 8 * 1024 * 1024;

  let dbp = null;

  function open() {
    if (dbp) return dbp;
    dbp = new Promise((res, rej) => {
      const req = indexedDB.open(DB, VERSION);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE, { keyPath: 'id' });
      };
      req.onsuccess = () => res(req.result);
      req.onerror = () => rej(req.error);
    });
    return dbp;
  }

  async function tx(mode, fn) {
    const db = await open();
    return new Promise((res, rej) => {
      const t = db.transaction(STORE, mode);
      const out = fn(t.objectStore(STORE));
      t.oncomplete = () => res(out && out.result !== undefined ? out.result : out);
      t.onerror = () => rej(t.error);
      t.onabort = () => rej(t.error);
    });
  }

  const newId = () => 'r_' + Date.now().toString(36) + Math.random().toString(36).slice(2, 7);

  /** Store a File. Returns the record without its blob. */
  async function put(file) {
    if (file.size > MAX_BYTES) {
      throw new Error(`${file.name} is ${(file.size / 1048576).toFixed(1)} MB — the limit is 8 MB.`);
    }
    const rec = {
      id: newId(),
      filename: file.name,
      mime: file.type || guessMime(file.name),
      size: file.size,
      addedAt: Date.now(),
      blob: file
    };
    await tx('readwrite', s => s.put(rec));
    return meta(rec);
  }

  /** Restore a record from a backup, keeping its original id so that
      role.resumeId and settings.defaultResumeId still point at it. */
  async function putRaw(rec) {
    await tx('readwrite', s => s.put(rec));
    return meta(rec);
  }

  function base64ToBlob(b64, mime) {
    const bin = atob(b64);
    const buf = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) buf[i] = bin.charCodeAt(i);
    return new Blob([buf], { type: mime });
  }

  async function get(id) {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).get(id);
      r.onsuccess = () => res(r.result || null);
      r.onerror = () => rej(r.error);
    });
  }

  async function list() {
    const db = await open();
    return new Promise((res, rej) => {
      const r = db.transaction(STORE, 'readonly').objectStore(STORE).getAll();
      r.onsuccess = () => res((r.result || []).map(meta).sort((a, b) => b.addedAt - a.addedAt));
      r.onerror = () => rej(r.error);
    });
  }

  async function remove(id) { await tx('readwrite', s => s.delete(id)); }

  const meta = r => ({ id: r.id, filename: r.filename, mime: r.mime, size: r.size, addedAt: r.addedAt });

  function guessMime(name) {
    const ext = (name.split('.').pop() || '').toLowerCase();
    return {
      pdf: 'application/pdf',
      doc: 'application/msword',
      docx: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document',
      txt: 'text/plain', rtf: 'application/rtf',
      png: 'image/png', jpg: 'image/jpeg', jpeg: 'image/jpeg'
    }[ext] || 'application/octet-stream';
  }

  /** Blob -> base64, because extension messaging can't carry an ArrayBuffer. */
  function toBase64(blob) {
    return new Promise((res, rej) => {
      const fr = new FileReader();
      fr.onload = () => res(String(fr.result).split(',', 2)[1] || '');
      fr.onerror = () => rej(fr.error);
      fr.readAsDataURL(blob);
    });
  }

  globalThis.SF_STORE = { put, putRaw, get, list, remove, toBase64, base64ToBlob, guessMime, MAX_BYTES };
})();
