// Background service worker. The run itself lives in the Instagram tab (content.js); this only
// mirrors its state onto the toolbar badge and marks runs as paused when their tab goes away.

const COLORS = { running: '#16a34a', paused: '#d97706', done: '#2563eb', error: '#dc2626' };

function paint(state) {
  const { status, error, removed = 0 } = state || {};
  let text = '';
  if (status === 'running') text = removed < 10000 ? String(removed) : `${Math.floor(removed / 1000)}k`;
  else if (status === 'paused') text = error ? '!' : '||';
  else if (status === 'done') text = '✓';
  chrome.action.setBadgeText({ text });
  if (text) chrome.action.setBadgeBackgroundColor({ color: error ? COLORS.error : COLORS[status] });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area === 'local' && changes.state) paint(changes.state.newValue);
});
chrome.storage.local.get('state').then(({ state }) => paint(state));

// A run can't survive its tab closing, reloading or the browser/extension restarting: record it as paused.
async function interrupt(message, tabId, error = false) {
  const { state } = await chrome.storage.local.get('state');
  if (state?.status !== 'running' || (tabId !== undefined && state.tabId !== tabId)) return;
  await chrome.storage.local.set({ state: { ...state, status: 'paused', message, error, updatedAt: Date.now() } });
}

chrome.tabs.onRemoved.addListener((tabId) =>
  interrupt('The Instagram tab was closed. Open Your activity → Likes again and press Resume.', tabId));

// When the run's tab finishes loading a page (reload, redirect, navigation) or gets discarded, ask it
// whether its loop is still alive. Same-page navigation inside Instagram keeps the loop, so it answers yes.
chrome.tabs.onUpdated.addListener(async (tabId, info) => {
  if (info.status !== 'complete' && !info.discarded) return;
  const { state } = await chrome.storage.local.get('state');
  if (state?.status !== 'running' || state.tabId !== tabId) return;
  const reply = await chrome.tabs.sendMessage(tabId, { cmd: 'hello' }).catch(() => null);
  if (!reply?.looping) {
    interrupt('The Instagram tab reloaded or left the page, which stopped the run. If Instagram asked you to log in ' +
      'or verify your account, do that first. Then open Your activity → Likes and press Resume.', tabId, true);
  }
});
chrome.runtime.onStartup.addListener(() =>
  interrupt('The browser restarted. Open Your activity → Likes and press Resume.'));
chrome.runtime.onInstalled.addListener(() =>
  interrupt('The extension was reloaded or updated. Reload the Instagram tab, then press Resume.'));
