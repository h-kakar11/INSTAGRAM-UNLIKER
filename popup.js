// Popup: shows the run state (stored by the content script in chrome.storage) and sends
// Start/Pause/Stop to the Instagram tab. Closing the popup never affects a run: the run lives in
// the Instagram tab and its state lives in storage, so reopening the popup picks it straight up.

const $ = (id) => document.getElementById(id);
const FIELDS = ['batchSize', 'minDelay', 'maxDelay', 'maxPerRun'];
const LABELS = { idle: 'Ready', running: 'Running', paused: 'Paused', stopped: 'Stopped', done: 'Finished' };

let state = {};
let settings = normalizeSettings();
let target = null; // { tabId, onLikes, looping }: the Instagram tab we control
let searched = false; // becomes true once findTarget() has run

const setState = (patch) => chrome.storage.local.set({ state: { ...state, ...patch, updatedAt: Date.now() } });

async function hello(tabId) {
  try {
    const reply = await chrome.tabs.sendMessage(tabId, { cmd: 'hello' });
    return reply?.ok ? { tabId, ...reply } : null;
  } catch {
    return null; // no content script there: not Instagram, or opened before the extension was installed
  }
}

// Which tab to control: the one that owns the current run (if it's running, or still on the Likes
// page), else the active tab, else any open Instagram tab that is on the Likes page.
async function findTarget() {
  if (state.tabId && (state.status === 'running' || state.status === 'paused')) {
    const owner = await hello(state.tabId);
    if (owner?.looping || owner?.onLikes) return owner;
  }
  const [active] = await chrome.tabs.query({ active: true, currentWindow: true });
  const current = active && (await hello(active.id));
  if (current?.onLikes) return current;
  const others = await Promise.all((await chrome.tabs.query({})).filter((t) => t.id !== active?.id).map((t) => hello(t.id)));
  return others.find((t) => t?.onLikes) || current || null;
}

function render() {
  const status = state.status || 'idle';
  document.body.dataset.status = state.error ? 'error' : status;
  $('status').textContent = state.error ? 'Needs attention' : LABELS[status] || status;
  $('message').textContent = state.message || 'Open your Likes page on instagram.com, then press Start.';
  $('removed').textContent = state.removed || 0;
  $('limit').textContent = settings.maxPerRun ? ` / ${settings.maxPerRun}` : '';
  $('total').textContent = state.total || 0;

  const running = status === 'running';
  const paused = status === 'paused';
  $('start').textContent = paused ? 'Resume' : 'Start';
  $('start').disabled = running || !target?.onLikes;
  $('pause').disabled = !running;
  $('stop').disabled = !running && !paused;

  $('hint').hidden = !searched || Boolean(target?.onLikes) || running;
  $('hintText').textContent = target
    ? 'This Instagram tab is not on your Likes page (Your activity → Likes).'
    : 'No Instagram tab found. Log in to instagram.com and open your Likes page. If Instagram was already ' +
      'open before you installed the extension, reload that tab.';
}

function showSettings() {
  for (const f of FIELDS) $(f).value = f === 'maxPerRun' && !settings[f] ? '' : settings[f];
}

async function send(msg) {
  const reply = target && (await chrome.tabs.sendMessage(target.tabId, msg).catch(() => null));
  if (reply?.ok) return;
  if (msg.cmd === 'start') {
    $('message').textContent = reply?.error || 'Could not reach the Instagram tab. Reload it and try again.';
    return;
  }
  // No tab is running it (closed, reloaded, or already paused), so just record the new status.
  await setState({ status: msg.cmd === 'stop' ? 'stopped' : 'paused', error: false,
    message: msg.cmd === 'stop' ? 'Stopped.' : 'Paused. Press Resume on the Likes page to continue.' });
}

$('start').addEventListener('click', () =>
  send({ cmd: 'start', resume: state.status === 'paused', tabId: target.tabId }));
$('pause').addEventListener('click', () => send({ cmd: 'pause' }));
$('stop').addEventListener('click', () => send({ cmd: 'stop' }));

$('open').addEventListener('click', async () => {
  if (target) await chrome.tabs.update(target.tabId, { url: LIKES_URL, active: true });
  else await chrome.tabs.create({ url: LIKES_URL });
  window.close();
});

for (const f of FIELDS) {
  $(f).addEventListener('change', async () => {
    settings = normalizeSettings(Object.fromEntries(FIELDS.map((k) => [k, $(k).value])));
    showSettings();
    await chrome.storage.local.set({ settings });
    render();
  });
}

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local' || !changes.state) return;
  state = changes.state.newValue || {};
  render();
});

(async () => {
  const stored = await chrome.storage.local.get(['state', 'settings', 'refreshUntil']);
  state = stored.state || {};
  settings = normalizeSettings(stored.settings);
  showSettings();
  render();
  target = await findTarget();
  searched = true;
  // Storage says "running" but no tab is actually running it (tab closed/reloaded unnoticed). Not while the
  // page is being refreshed on purpose: the run continues by itself once it is back (see background.js).
  const refreshing = stored.refreshUntil > Date.now();
  if (state.status === 'running' && !refreshing && !(target?.tabId === state.tabId && target.looping)) {
    await setState({ status: 'paused', error: false,
      message: 'The run was interrupted (the Instagram tab was closed or reloaded). Open your Likes page and press Resume.' });
  }
  render();
})();
