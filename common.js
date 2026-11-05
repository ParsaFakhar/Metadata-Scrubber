/* Shared by the bridge content script, the background page and the popup.
 * Settings live in storage.local under "settings":
 *   enabled : false = scrubbing is off everywhere
 *   rules   : { "<top-level host>": { until } }  until = 0 -> off until the user turns it back on,
 *                                                 until = timestamp -> paused until then
 *   convert : { "<top-level host>": true|false } WebP -> JPG/PNG switch (per site)
 * An expired rule is simply ignored (and pruned the next time anything writes). */
const MS = (() => {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const dict = () => Object.create(null);          // host names like "__proto__" must stay plain keys

  function norm(s) {
    const o = { enabled: true, rules: dict(), convert: dict() };
    if (!s || typeof s !== 'object') return o;
    if (s.enabled === false) o.enabled = false;
    if (s.rules && typeof s.rules === 'object') {
      for (const [h, r] of Object.entries(s.rules)) if (r && typeof r.until === 'number') o.rules[h] = { until: r.until };
    }
    if (s.convert && typeof s.convert === 'object') {
      for (const [h, v] of Object.entries(s.convert)) if (typeof v === 'boolean') o.convert[h] = v;
    }
    return o;
  }

  const activeRule = (s, host, now = Date.now()) => {
    const r = s.rules[host];
    return r && (r.until === 0 || r.until > now) ? r : null;
  };

  function evalFor(s, host, now = Date.now()) {
    const r = activeRule(s, host, now);
    return { active: s.enabled && !r, enabled: s.enabled, until: r ? r.until : null, convert: s.convert[host] };
  }

  function prune(s, now = Date.now()) {
    for (const [h, r] of Object.entries(s.rules)) if (r.until !== 0 && r.until <= now) delete s.rules[h];
  }

  async function load() {
    const r = await api.storage.local.get('settings');
    return norm(r && r.settings);
  }

  // read-modify-write; resolves to the new settings
  async function update(fn) {
    const s = await load();
    fn(s);
    prune(s);
    await api.storage.local.set({ settings: s });
    return s;
  }

  return { api, norm, evalFor, activeRule, load, update };
})();
