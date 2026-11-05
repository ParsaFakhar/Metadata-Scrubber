/* Metadata Scrubber — bridge (extension ISOLATED world, every frame, document_start).
 *
 * The scrubber itself runs in the page's MAIN world (it has to hook the page's own fetch/XHR/inputs)
 * and cannot reach extension APIs. This script is the other half:
 *   - reads the pause state from storage and pushes it into the MAIN world,
 *   - draws the toasts (so the page can neither see nor fake them) and handles their buttons,
 *   - relays toasts from iframes to the top frame, and reports status to the toolbar icon.
 * MAIN <-> bridge talk over two CustomEvents whose names contain a random nonce that is handed over
 * once, through an attribute that is removed again before any page script can run. */
(() => {
  'use strict';
  const { api, evalFor, load, update } = MS;
  const W = window;
  const root = document.documentElement;
  if (!root) return;

  const isTop = (() => { try { return W.top === W; } catch (_) { return false; } })();
  const ownHost = (location.hostname || '').toLowerCase();
  let siteHost = ownHost;                 // the TOP-level host: pause rules are per top-level site
  let settings = MS.norm(null);
  let timer = 0;

  /* ---------------------------------------------------------------- MAIN channel */
  const rnd = new Uint8Array(16);
  crypto.getRandomValues(rnd);
  const nonce = Array.from(rnd, (b) => b.toString(16).padStart(2, '0')).join('');
  const EV_IN = '__ms_' + nonce + '_in';
  const EV_OUT = '__ms_' + nonce + '_out';
  root.setAttribute('data-ms-hs', JSON.stringify({ n: nonce }));
  setTimeout(() => { try { root.removeAttribute('data-ms-hs'); } catch (_) {} }, 0);

  const toMain = (msg) => { try { W.dispatchEvent(new CustomEvent(EV_IN, { detail: JSON.stringify(msg) })); } catch (_) {} };

  W.addEventListener(EV_OUT, (e) => {
    let m;
    try { m = JSON.parse(e.detail); } catch (_) { return; }
    if (!m || typeof m !== 'object') return;
    if (m.type === 'toast') onMainToast(m);
    else if (m.type === 'convert' && typeof m.on === 'boolean') update((s) => { s.convert[siteHost] = m.on; }).catch(() => {});
  });

  /* ---------------------------------------------------------------- state */
  function pushState() {
    const st = evalFor(settings, siteHost);
    toMain({ type: 'state', active: st.active, convert: st.convert });
    if (isTop) api.runtime.sendMessage({ t: 'status', active: st.active, enabled: st.enabled, until: st.until }).catch(() => {});
    clearTimeout(timer);
    const r = settings.rules[siteHost];
    if (r && r.until > Date.now()) timer = setTimeout(onExpire, Math.min(r.until - Date.now() + 30, 2147483000));
  }
  async function onExpire() {
    if (isTop) { try { settings = await update(() => {}); } catch (_) {} }   // update() prunes expired rules
    pushState();
  }
  api.storage.onChanged.addListener((ch, area) => {
    if (area !== 'local' || !ch.settings) return;
    settings = MS.norm(ch.settings.newValue);
    pushState();
  });

  async function resolveTopHost() {
    if (isTop) { api.runtime.sendMessage({ t: 'hello', host: ownHost }).catch(() => {}); return ownHost; }
    for (let i = 0; i < 3; i++) {
      try { const r = await api.runtime.sendMessage({ t: 'top-host' }); if (r && r.host) return r.host; } catch (_) {}
      await new Promise((res) => setTimeout(res, 250));
    }
    return ownHost;
  }
  (async () => {
    siteHost = await resolveTopHost();
    try { settings = await load(); } catch (_) {}
    pushState();
  })();

  /* ---------------------------------------------------------------- toasts from the scrubber */
  const clip = (v, n) => String(v == null ? '' : v).slice(0, n);
  function onMainToast(m) {
    const t = {
      msg: clip(m.msg, 160), detail: clip(m.detail, 260),
      kind: m.kind === 'err' || m.kind === 'warn' ? m.kind : 'ok',
      actions: (Array.isArray(m.actions) ? m.actions : []).slice(0, 2).map((a) => ({
        id: clip(a && a.id, 40), label: clip(a && a.label, 40),
        pause: Math.min(Math.max(Number(a && a.pause) || 0, 0), 60), replay: !!(a && a.replay),
      })),
    };
    if (isTop) showToast(t, 0);
    else api.runtime.sendMessage({ t: 'toast', toast: t }).catch(() => {});
  }

  async function runAction(a, frameId) {
    if (a.pause) settings = await update((s) => { s.rules[siteHost] = { until: Date.now() + a.pause * 60000 }; });
    if (frameId === 0) { pushState(); toMain({ type: 'action', id: a.id }); }        // state first, THEN the replay
    else api.runtime.sendMessage({ t: 'toast-click', frameId, actionId: a.id }).catch(() => {});
    if (a.pause) {
      showToast({
        kind: 'ok', msg: a.replay ? 'Uploading without scrubbing' : 'Scrubbing paused',
        detail: `Off on ${siteHost} for ${a.pause} min.` + (a.replay ? '' : ' Try the upload again.'),
        actions: [{ label: 'Turn back on', local: 'resume' }],
      }, 0);
    }
  }
  async function resume() {
    settings = await update((s) => { delete s.rules[siteHost]; });
    pushState();
  }

  async function toggleSite() {
    const st = evalFor(settings, siteHost);
    if (!st.enabled) { showToast({ kind: 'warn', msg: 'Scrubbing is off everywhere', detail: 'Turn it back on from the toolbar button.', actions: [] }, 0); return; }
    if (st.until !== null) {
      await resume();
      showToast({ kind: 'ok', msg: 'Scrubbing is back on', detail: siteHost, actions: [] }, 0);
    } else {
      settings = await update((s) => { s.rules[siteHost] = { until: Date.now() + 10 * 60000 }; });
      pushState();
      showToast({ kind: 'warn', msg: 'Scrubbing paused for 10 min', detail: siteHost, actions: [{ label: 'Turn back on', local: 'resume' }] }, 0);
    }
  }

  api.runtime.onMessage.addListener((m) => {
    if (!m || typeof m !== 'object') return undefined;
    switch (m.t) {
      case 'toast': if (isTop && m.toast) showToast(m.toast, Number(m.frameId) || 0); break;
      case 'action': (async () => { try { settings = await load(); } catch (_) {} pushState(); toMain({ type: 'action', id: clip(m.actionId, 40) }); })(); break;
      case 'popup-info': return Promise.resolve({ host: siteHost });
      case 'toggle-site': if (isTop) toggleSite(); break;
    }
    return undefined;
  });

  /* ---------------------------------------------------------------- toast UI (top frame only) */
  if (!isTop) return;

  const FONT = '-apple-system, BlinkMacSystemFont, "SF Pro Text", system-ui, sans-serif';
  const ACCENT = '#5b4df0';
  const KIND = { ok: '#2fb457', warn: '#f59f0b', err: '#ef4444' };
  const GLYPH = { ok: '✓', warn: '!', err: '!' };
  const css = (el, o) => { Object.assign(el.style, o); return el; };
  const h = (tag, o, text) => { const el = document.createElement(tag); if (o) css(el, o); if (text != null) el.textContent = text; return el; };
  const theme = () => {
    const d = !!(W.matchMedia && W.matchMedia('(prefers-color-scheme: dark)').matches);
    return {
      bg: d ? 'rgba(38,38,42,.90)' : 'rgba(255,255,255,.90)', fg: d ? '#f5f5f7' : '#1d1d1f',
      sub: d ? 'rgba(245,245,247,.68)' : 'rgba(29,29,31,.66)', border: d ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.09)',
      btn: d ? 'rgba(255,255,255,.12)' : 'rgba(0,0,0,.06)', btnHover: d ? 'rgba(255,255,255,.20)' : 'rgba(0,0,0,.11)',
    };
  };

  let hostEl = null, box = null;
  function ensureBox() {
    if (box && hostEl.isConnected) return box;
    hostEl = h('div');
    hostEl.style.cssText = 'all:initial;position:fixed;right:18px;bottom:18px;z-index:2147483647;pointer-events:none;';
    const shadow = hostEl.attachShadow({ mode: 'closed' });
    box = h('div', { display: 'flex', flexDirection: 'column', gap: '8px', alignItems: 'flex-end', width: 'max-content', maxWidth: 'min(380px, calc(100vw - 36px))', fontFamily: FONT });
    shadow.appendChild(box);
    (document.body || root).appendChild(hostEl);
    return box;
  }

  function showToast(t, frameId) {
    try {
      const c = theme();
      const wrap = ensureBox();
      while (wrap.childElementCount >= 3) wrap.firstElementChild.remove();

      const card = h('div', {
        display: 'flex', gap: '11px', alignItems: 'flex-start', boxSizing: 'border-box', width: '100%', padding: '12px 10px 12px 12px',
        borderRadius: '14px', background: c.bg, color: c.fg, border: '1px solid ' + c.border, font: '13px/1.4 ' + FONT,
        boxShadow: '0 10px 32px rgba(0,0,0,.24), 0 1px 3px rgba(0,0,0,.14)', backdropFilter: 'blur(22px) saturate(1.7)',
        webkitBackdropFilter: 'blur(22px) saturate(1.7)', pointerEvents: 'auto', opacity: '0', transform: 'translateY(8px)',
        transition: 'opacity .18s ease, transform .18s ease',
      });
      card.setAttribute('role', t.kind === 'err' ? 'alert' : 'status');
      card.appendChild(h('div', {
        flex: 'none', width: '22px', height: '22px', borderRadius: '50%', background: KIND[t.kind] || KIND.ok, color: '#fff',
        display: 'flex', alignItems: 'center', justifyContent: 'center', font: '700 13px/1 ' + FONT, marginTop: '1px',
      }, GLYPH[t.kind] || GLYPH.ok));

      const body = h('div', { flex: '1', minWidth: '0' });
      body.appendChild(h('div', { fontWeight: '600', fontSize: '13px' }, t.msg));
      if (t.detail) body.appendChild(h('div', { marginTop: '2px', fontSize: '12px', color: c.sub, wordBreak: 'break-word' }, t.detail));

      let timeout = 0;
      const close = () => { clearTimeout(timeout); css(card, { opacity: '0', transform: 'translateY(8px)' }); setTimeout(() => card.remove(), 200); };
      const mkBtn = (label, primary, onClick) => {
        const b = h('button', {
          all: 'unset', cursor: 'pointer', boxSizing: 'border-box', padding: '5px 11px', borderRadius: '8px', fontSize: '12px', fontWeight: '600',
          fontFamily: FONT, color: primary ? '#fff' : c.fg, background: primary ? ACCENT : c.btn,
        }, label);
        b.setAttribute('role', 'button');
        b.addEventListener('mouseenter', () => { b.style.background = primary ? '#4a3fd8' : c.btnHover; });
        b.addEventListener('mouseleave', () => { b.style.background = primary ? ACCENT : c.btn; });
        b.addEventListener('click', (ev) => { ev.stopPropagation(); onClick(); });
        return b;
      };
      const acts = Array.isArray(t.actions) ? t.actions : [];
      if (acts.length) {
        const row = h('div', { display: 'flex', gap: '8px', marginTop: '10px', flexWrap: 'wrap' });
        acts.forEach((a, i) => row.appendChild(mkBtn(a.label, i === 0, () => {
          close();
          if (a.local === 'resume') resume(); else runAction(a, frameId).catch(() => {});
        })));
        row.appendChild(mkBtn('Dismiss', false, close));
        body.appendChild(row);
      }
      card.appendChild(body);

      const x = h('button', { all: 'unset', cursor: 'pointer', flex: 'none', width: '20px', height: '20px', borderRadius: '6px', textAlign: 'center', lineHeight: '20px', fontSize: '15px', color: c.sub, fontFamily: FONT }, '×');
      x.setAttribute('role', 'button'); x.setAttribute('aria-label', 'Dismiss');
      x.addEventListener('mouseenter', () => { x.style.background = c.btn; });
      x.addEventListener('mouseleave', () => { x.style.background = 'transparent'; });
      x.addEventListener('click', close);
      card.appendChild(x);

      const life = acts.length ? 16000 : t.kind === 'ok' ? 3600 : t.kind === 'warn' ? 7000 : 14000;
      const arm = (ms) => { clearTimeout(timeout); timeout = setTimeout(close, ms); };
      card.addEventListener('mouseenter', () => clearTimeout(timeout));
      card.addEventListener('mouseleave', () => arm(3000));
      wrap.appendChild(card);
      requestAnimationFrame(() => css(card, { opacity: '1', transform: 'translateY(0)' }));
      arm(life);
    } catch (_) { /* DOM not ready: a missed toast must never break the page */ }
  }
})();
