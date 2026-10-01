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
  const { state, refreshUntil } = await chrome.storage.local.get(['state', 'refreshUntil']);
  if (state?.status !== 'running' || state.tabId !== tabId) return;
  const reply = await chrome.tabs.sendMessage(tabId, { cmd: 'hello' }).catch(() => null);
  if (!reply?.looping) {
    if (refreshUntil > Date.now()) return resume(tabId); // a reload this extension asked for: carry on
    interrupt('The Instagram tab reloaded or left the page, which stopped the run. If Instagram asked you to log in ' +
      'or verify your account, do that first. Then open Your activity → Likes and press Resume.', tabId, true);
  }
});

// Instagram's page freezes on an endless loading screen after about an hour, so content.js asks for a hard
// reload (the same as Ctrl+Shift+R) between two batches once its page is old enough (see refreshPage there).
// It can't reload with the cache bypassed itself. `refreshUntil` marks the reload as planned, so the handler
// above resumes the run in the reloaded page instead of recording an interruption.
const REFRESH_WAIT = 2 * 60 * 1000; // how long the reloaded page may take to come back

chrome.runtime.onMessage.addListener((msg, sender, reply) => {
  if (msg?.cmd !== 'refresh' || !sender.tab) return;
  const tabId = sender.tab.id;
  chrome.storage.local.get('state')
    .then(({ state }) => {
      if (state?.status !== 'running' || state.tabId !== tabId) throw new Error('no run is active in this tab');
      return chrome.storage.local.set({ refreshUntil: Date.now() + REFRESH_WAIT });
    })
    .then(() => chrome.tabs.reload(tabId, { bypassCache: true }))
    .then(() => reply({ ok: true }), (e) => reply({ ok: false, error: e.message }));
  return true; // reply asynchronously
});

// Continue the run in the reloaded tab. Its content script may not be there yet, so keep asking until it answers.
async function resume(tabId) {
  for (let attempt = 0; attempt < 20; attempt++) {
    const { state } = await chrome.storage.local.get('state');
    if (state?.status !== 'running') return; // Pause or Stop was pressed meanwhile: leave it so
    const reply = await chrome.tabs.sendMessage(tabId, { cmd: 'start', resume: true, tabId }).catch(() => null);
    if (reply?.ok) return chrome.storage.local.remove('refreshUntil');
    if (reply) {
      return interrupt(`Instagram was refreshed, but the run could not continue: ${reply.error} If Instagram asked ` +
        'you to log in or verify your account, do that first. Then press Resume.', tabId, true);
    }
    await new Promise((done) => setTimeout(done, 500));
  }
  interrupt('Instagram was refreshed, but the extension could not reach the page to continue. ' +
    'Open Your activity → Likes and press Resume.', tabId, true);
}

chrome.runtime.onStartup.addListener(() =>
  interrupt('The browser restarted. Open Your activity → Likes and press Resume.'));
chrome.runtime.onInstalled.addListener(() =>
  interrupt('The extension was reloaded or updated. Reload the Instagram tab, then press Resume.'));
