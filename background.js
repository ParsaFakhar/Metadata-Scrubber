/* Metadata Scrubber — background (non-persistent event page).
 * Jobs: remember each tab's top-level host (so iframes know which site's pause rule applies),
 * relay toasts from iframes to the top frame and button clicks back, paint the toolbar icon, and
 * handle the keyboard shortcut. All real state lives in storage.local (see common.js). */
const { api } = MS;

const ICON = (on) => ({ 16: `icons/action-${on ? 'on' : 'off'}-16.png`, 32: `icons/action-${on ? 'on' : 'off'}-32.png`, 48: `icons/action-${on ? 'on' : 'off'}-48.png` });

async function topMap() { return (await api.storage.session.get('top')).top || {}; }
async function setTop(tabId, host) { const m = await topMap(); m[tabId] = host; await api.storage.session.set({ top: m }); }

async function paint(tabId, st) {
  const on = !!st.active;
  let title = 'Metadata Scrubber — cleaning uploads';
  let text = '';
  if (!st.enabled) { text = 'OFF'; title = 'Metadata Scrubber — off everywhere'; }
  else if (!on && st.until === 0) { text = 'OFF'; title = 'Metadata Scrubber — off for this site'; }
  else if (!on) { text = 'OFF'; title = 'Metadata Scrubber — paused on this site'; }
  try {
    await api.action.setIcon({ tabId, path: ICON(on) });
    await api.action.setBadgeText({ tabId, text });
    await api.action.setTitle({ tabId, title });
  } catch (_) { /* tab closed meanwhile */ }
}

api.action.setBadgeBackgroundColor({ color: '#e8590c' });
if (api.action.setBadgeTextColor) api.action.setBadgeTextColor({ color: '#ffffff' });

api.runtime.onMessage.addListener((m, sender) => {
  const tabId = sender && sender.tab ? sender.tab.id : null;
  if (tabId == null || !m || typeof m !== 'object') return undefined;     // only content scripts talk to us
  switch (m.t) {
    case 'hello':
      if (sender.frameId === 0) return setTop(tabId, String(m.host || '').toLowerCase()).then(() => ({ ok: true }));
      return undefined;
    case 'top-host':
      return topMap().then((map) => ({ host: map[tabId] || '' }));
    case 'status':
      if (sender.frameId === 0) paint(tabId, m);
      return undefined;
    case 'toast':
      api.tabs.sendMessage(tabId, { t: 'toast', toast: m.toast, frameId: sender.frameId }, { frameId: 0 }).catch(() => {});
      return undefined;
    case 'toast-click':
      if (Number.isInteger(m.frameId)) api.tabs.sendMessage(tabId, { t: 'action', actionId: m.actionId }, { frameId: m.frameId }).catch(() => {});
      return undefined;
  }
  return undefined;
});

api.tabs.onRemoved.addListener(async (tabId) => {
  const m = await topMap();
  if (tabId in m) { delete m[tabId]; await api.storage.session.set({ top: m }); }
});

api.commands.onCommand.addListener(async (name) => {
  if (name !== 'toggle-site') return;
  const [tab] = await api.tabs.query({ active: true, currentWindow: true });
  if (tab) api.tabs.sendMessage(tab.id, { t: 'toggle-site' }, { frameId: 0 }).catch(() => {});
});
