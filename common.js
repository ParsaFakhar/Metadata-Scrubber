/* Shared by the bridge content script, the background page and the popup.
 * Settings live in storage.local under "settings":
 *   enabled  : false = scrubbing is off everywhere
 *   debug    : true  = allow [MetadataScrubber] debug logs in page console (default false)
 *   rules    : { "<top-level host>": { until } }  until = 0 -> off until user turns it back on,
 *                                                  until = timestamp -> paused until then
 *   convert  : { "<top-level host>": true|false } WebP -> JPG/PNG switch (per site)
 *   optimize : { "<top-level host>": true|false } Size optimization for large images (per site)
 */
const MS = (() => {
  'use strict';
  const api = typeof browser !== 'undefined' ? browser : chrome;
  const dict = () => Object.create(null);

  function norm(s) {
    const o = { enabled: true, debug: false, rules: dict(), convert: dict(), optimize: dict() };
    if (!s || typeof s !== 'object') return o;
    if (s.enabled === false) o.enabled = false;
    if (s.debug === true) o.debug = true;
    if (s.rules && typeof s.rules === 'object') {
      for (const [h, r] of Object.entries(s.rules)) {
        if (r && typeof r.until === 'number') o.rules[h] = { until: r.until };
      }
    }
    if (s.convert && typeof s.convert === 'object') {
      for (const [h, v] of Object.entries(s.convert)) {
        if (typeof v === 'boolean') o.convert[h] = v;
      }
    }
    if (s.optimize && typeof s.optimize === 'object') {
      for (const [h, v] of Object.entries(s.optimize)) {
        if (typeof v === 'boolean') o.optimize[h] = v;
      }
    }
    return o;
  }

  const activeRule = (s, host, now = Date.now()) => {
    const r = s.rules[host];
    return r && (r.until === 0 || r.until > now) ? r : null;
  };

  function evalFor(s, host, now = Date.now()) {
    const r = activeRule(s, host, now);
    return {
      active: s.enabled && !r,
      enabled: s.enabled,
      debug: !!s.debug,
      until: r ? r.until : null,
      convert: s.convert[host] === true,
      optimize: s.optimize[host] === true,
    };
  }

  function prune(s, now = Date.now()) {
    for (const [h, r] of Object.entries(s.rules)) {
      if (r.until !== 0 && r.until <= now) delete s.rules[h];
    }
  }

  async function load() {
    const r = await api.storage.local.get('settings');
    return norm(r && r.settings);
  }

  async function update(fn) {
    const s = await load();
    fn(s);
    prune(s);
    await api.storage.local.set({ settings: s });
    return s;
  }

  return { api, norm, evalFor, activeRule, load, update };
})();
