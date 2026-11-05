(async () => {
  'use strict';
  const { api, evalFor, load, update } = MS;
  const $ = (id) => document.getElementById(id);
  let settings = MS.norm(null);
  let host = null;                       // top-level host of the active tab; null = a page we cannot touch

  try {
    const [tab] = await api.tabs.query({ active: true, currentWindow: true });
    const info = tab && (await api.tabs.sendMessage(tab.id, { t: 'popup-info' }, { frameId: 0 }));
    if (info && info.host) host = info.host;
  } catch (_) { host = null; }            // no content script there (about:, add-on pages, PDF viewer, ...)

  const fmt = (ms) => { const s = Math.max(0, Math.ceil(ms / 1000)); return Math.floor(s / 60) + ':' + String(s % 60).padStart(2, '0'); };
  const btn = (label, cls, fn) => { const b = document.createElement('button'); b.textContent = label; if (cls) b.className = cls; b.addEventListener('click', fn); return b; };
  const pause = (minutes) => update((s) => { s.rules[host] = { until: minutes ? Date.now() + minutes * 60000 : 0 }; });
  const resume = () => update((s) => { delete s.rules[host]; });
  let tick = 0;

  function render() {
    clearInterval(tick);
    const st = host ? evalFor(settings, host) : { active: settings.enabled, enabled: settings.enabled, until: null };
    $('global').checked = settings.enabled;
    const dot = $('dot'), actions = $('actions');
    actions.textContent = '';
    dot.className = 'dot';

    if (!settings.enabled) {
      $('status').textContent = 'Off everywhere';
      dot.classList.add('off');
      $('host').textContent = host || 'This page';
      $('note').textContent = 'Uploads go out exactly as they are. Flip the switch above to turn scrubbing back on.';
    } else if (!host) {
      $('status').textContent = 'Cleaning uploads';
      dot.classList.add('idle');
      $('host').textContent = 'This page';
      $('note').textContent = 'Browser pages and add-on pages can’t be scrubbed or paused. Reload the tab if you just installed the extension.';
    } else if (st.until !== null) {
      $('status').textContent = 'Paused on ' + host;
      dot.classList.add('paused');
      $('host').textContent = host;
      const left = st.until === 0 ? null : st.until - Date.now();
      $('note').textContent = left === null
        ? 'Off for this site until you turn it back on. Uploads here are not cleaned.'
        : 'Paused. Uploads here are not cleaned. Back on automatically in ' + fmt(left) + '.';
      actions.append(btn('Turn back on', 'primary', resume));
      if (left !== null) tick = setInterval(() => { if (Date.now() >= st.until) { clearInterval(tick); load().then((s) => { settings = s; render(); }); } else $('note').textContent = 'Paused. Uploads here are not cleaned. Back on automatically in ' + fmt(st.until - Date.now()) + '.'; }, 1000);
    } else {
      $('status').textContent = 'Cleaning uploads';
      $('host').textContent = host;
      $('note').textContent = 'Files you upload here are cleaned of metadata first. Blocked an upload you do want to send? Pause it for a bit.';
      actions.append(btn('Pause 10 min', 'primary', () => pause(10)), btn('Pause 1 hour', '', () => pause(60)), btn('Turn off for this site', 'danger', () => pause(0)));
    }

    const showConvert = !!host && settings.enabled;
    $('convertRow').hidden = !showConvert;
    if (showConvert) $('convert').checked = settings.convert[host] === true;
  }

  $('global').addEventListener('change', (e) => update((s) => { s.enabled = e.target.checked; }));
  $('convert').addEventListener('change', (e) => update((s) => { s.convert[host] = e.target.checked; }));
  api.storage.onChanged.addListener((ch, area) => { if (area === 'local' && ch.settings) { settings = MS.norm(ch.settings.newValue); render(); } });

  try { settings = await update(() => {}); } catch (_) { settings = await load(); }   // load + prune expired rules
  render();
})();
