/* Sync via the signed-in Google account.

   chrome.storage.sync rides Chrome's own account sync — no OAuth, no server, no
   client ID to register. Sign into Chrome on a new machine, install the extension,
   and the profile is already there.

   Its limits shape everything below: 100 KB total, 8 KB per item, 512 items. The
   payload is therefore chunked into ~7 KB pieces. Resume binaries are megabytes and
   can never fit — they stay local and travel by export/import.

   The API key is deliberately NOT synced. Unless you've set a Chrome sync
   passphrase, synced values are readable by Google; a long-lived API key does not
   belong there. */
(function () {
  const CHUNK = 7000;
  const KEY_META = 'sf_meta';
  const KEY_CHUNK = 'sf_c';
  const MAX_TOTAL = 90000;      // leave headroom under the 100 KB ceiling

  function area() {
    return (typeof chrome !== 'undefined' && chrome.storage && chrome.storage.sync) || null;
  }

  async function push(payload) {
    const sync = area();
    if (!sync) return { ok: false, error: 'sync unavailable' };

    const body = JSON.stringify({
      profile: payload.profile || {},
      roles: payload.roles || [],
      answers: payload.answers || [],
      passengers: payload.passengers || [],
      settings: payload.settings || {}
    });

    if (body.length > MAX_TOTAL) {
      return { ok: false, error: `too large to sync (${(body.length / 1024).toFixed(0)} KB of a 100 KB account limit) — trim a cover letter or summary` };
    }

    const chunks = [];
    for (let i = 0; i < body.length; i += CHUNK) chunks.push(body.slice(i, i + CHUNK));

    const write = { [KEY_META]: { updatedAt: Date.now(), count: chunks.length, device: deviceName() } };
    chunks.forEach((c, i) => { write[KEY_CHUNK + i] = c; });

    try {
      // Drop chunks left by a previously larger payload.
      const existing = await sync.get(null);
      const stale = Object.keys(existing).filter(k => k.startsWith(KEY_CHUNK) &&
        Number(k.slice(KEY_CHUNK.length)) >= chunks.length);
      if (stale.length) await sync.remove(stale);

      await sync.set(write);
      return { ok: true, updatedAt: write[KEY_META].updatedAt, bytes: body.length };
    } catch (e) {
      const msg = String(e && e.message || e);
      return { ok: false, error: /QUOTA/i.test(msg) ? 'account sync storage is full' : msg };
    }
  }

  async function pull() {
    const sync = area();
    if (!sync) return null;
    try {
      const all = await sync.get(null);
      const meta = all[KEY_META];
      if (!meta || !meta.count) return null;
      let body = '';
      for (let i = 0; i < meta.count; i++) {
        const part = all[KEY_CHUNK + i];
        if (part == null) return null;            // incomplete write; ignore it
        body += part;
      }
      const data = JSON.parse(body);
      return { ...data, updatedAt: meta.updatedAt, device: meta.device };
    } catch {
      return null;
    }
  }

  /** Copy account data down to this machine if it is newer. */
  async function pullIfNewer() {
    const remote = await pull();
    if (!remote) return { pulled: false };
    const local = await chrome.storage.local.get(['syncedAt', 'profile']);
    const localAt = local.syncedAt || 0;
    const empty = !local.profile || !Object.keys(local.profile).length;
    if (!empty && remote.updatedAt <= localAt) return { pulled: false, upToDate: true };

    await chrome.storage.local.set({
      profile: remote.profile,
      roles: remote.roles,
      answers: remote.answers || [],
      passengers: remote.passengers || [],
      settings: remote.settings,
      syncedAt: remote.updatedAt
    });
    return { pulled: true, updatedAt: remote.updatedAt, device: remote.device, wasEmpty: empty };
  }

  async function clear() {
    const sync = area();
    if (sync) await sync.clear();
  }

  function deviceName() {
    const p = (navigator.userAgentData && navigator.userAgentData.platform) || navigator.platform || '';
    return String(p).slice(0, 24) || 'a device';
  }

  globalThis.SF_SYNC = { push, pull, pullIfNewer, clear, MAX_TOTAL };
})();
