// Instagram Like Remover — content script.
//
// Loaded on every www.instagram.com page but stays idle until the popup sends "start". It then
// drives Instagram's own "Your activity → Likes" screen the way a person would:
//
//   Select → tick up to N posts → Unlike → confirm → wait until they disappear → repeat
//
// SELECTORS. Taken from the live Likes page (Sep 2026). The screen is rendered by Instagram's
// "Bloks" framework, whose class names (wbloks_1, wbloks_94…) are generated and meaningless, so
// nothing here uses classes. Instead:
//   leaf <span>"Select"</span> / "Cancel"          enter / leave selection mode
//   [role=button][aria-label="Video, 1 of 18, by @user, …"] > img   a post tile
//   [data-testid="bulk_action_checkbox"]           one per post, only while selecting
//     └ [role=button][aria-label="Toggle checkbox"]  the click target; its CSS-masked icon is
//                                                   circle__outline (unticked) / circle-check__filled (ticked)
//   leaf "N selected"                              Instagram's own selection counter
//   [role=button][aria-label="Unlike"]             selection-bar button; pointer-events:none while disabled
//   [role=dialog][aria-modal=true] "Unlike this post?" <button>Unlike</button> <button>Cancel</button>
//                                                   the confirmation; afterwards Instagram leaves selection
//                                                   mode and re-fetches the first page of likes (18 posts)
//   [aria-label="Loading..."]                      spinner at the end of the list while more pages exist
//   thumbnail <img src=".../123_456_789_n.jpg">    file name = stable per-post key. Bloks re-creates
//                                                   DOM nodes on every re-render, so nodes are never kept.
//
// SAFETY. Every click target is looked up fresh, checked, and its effect verified before the next
// step. Anything unexpected throws Problem, which pauses the run with an explanation and leaves
// selection mode. Instagram warnings (rate limits, "Try again later", challenges, CAPTCHAs, any
// dialog we don't recognise) pause the run and are left untouched for the user to handle.
'use strict';

const LIKES_PATH = new URL(LIKES_URL).pathname.replace(/\/$/, '');
const BOX = '[data-testid="bulk_action_checkbox"]';
const BOX_FALLBACK = '[aria-label="Toggle checkbox"]';
const THUMB = '[role="button"][aria-label*="@"] img'; // post tile thumbnails ("…, by @user, …")
const SPINNER = '[aria-label="Loading..."]';
const DIALOG = '[role="dialog"], [role="alertdialog"], [aria-modal="true"]';
const NON_EMPTY = '[data-testid="liked_container_non_empty_state"]';

// Text Instagram shows when it blocks, limits or challenges an account (checked on the whole page)…
const BLOCKED = [
  /try again later/i, /action blocked/i, /we restrict certain activity/i, /we limit how often/i,
  /temporarily (blocked|restricted|locked)/i, /too many (requests|attempts)/i, /please wait a few minutes/i,
  /confirm (that )?it['’]?s you/i, /verify (it['’]?s you|your identity)/i, /help us confirm/i,
  /suspicious (login|activity)/i, /unusual activity/i, /automated behaviou?r/i, /security check/i, /captcha/i,
];
// …and generic failures (only checked inside dialogs/alerts, where they can't be post content).
const FAILED = [/something went wrong/i, /couldn['’]?t (unlike|complete|load|refresh)/i, /an error occurred/i, /problem with (this|your) request/i];

const LIST_MISSING = 'The Likes list did not load: no "Select" button found. Instagram\'s layout may have changed ' +
  '(the extension also expects Instagram to be in English).';
const STALE = 'Instagram still lists posts this run already unliked (or tried to), so that unlike may not have gone ' +
  'through. Paused so nothing is clicked twice. Reload the page and press Resume; if they are still listed after ' +
  'that, press Stop and then Start to retry them.';

class Halt extends Error {}    // Pause/Stop pressed, or the extension was reloaded: end quietly
class Problem extends Error {} // the page isn't what we expect: pause and tell the user why

let state = {};     // this tab's copy of storage "state" while it runs (the content script is its only writer then)
let want = 'idle';  // what the popup asked for: 'running' | 'paused' | 'stopped'
let looping = false;
let wake = null;    // cuts the current interruptible delay short so Pause/Stop feel immediate

// ─── Messages from the popup (and the background's liveness check) ──────────────────────────

chrome.runtime.onMessage.addListener((msg, _sender, reply) => {
  command(msg).then(reply, (e) => reply({ ok: false, error: e.message }));
  return true; // reply asynchronously
});

async function command(msg) {
  switch (msg.cmd) {
    case 'hello':
      return { ok: true, onLikes: onLikesPage(), looping };

    case 'start': {
      if (looping) return { ok: true };
      if (!onLikesPage()) return { ok: false, error: 'Open Your activity → Likes in this tab first.' };
      looping = true; // claim the loop before any await, so a double-click can't start two
      try {
        const { state: prev = {} } = await chrome.storage.local.get('state');
        const resume = msg.resume && prev.status === 'paused';
        // A new run still settles an unverified batch first (see settlePending), so a Stop + Start can
        // never re-tick posts that Instagram may already have unliked.
        state = resume ? { ...prev }
          : { removed: 0, total: prev.total || 0, pending: prev.pending, pendingSince: prev.pendingSince, pendingAt: prev.pendingAt };
        if (!resume) await chrome.storage.local.set({ doneKeys: [] });
      } catch (e) {
        looping = false;
        throw e;
      }
      state.tabId = msg.tabId;
      want = 'running';
      run(); // not awaited: the popup gets its answer now and follows progress via storage
      return { ok: true };
    }

    case 'pause':
    case 'stop': {
      if (!looping) return { ok: false, error: 'Nothing is running in this tab.' };
      want = msg.cmd === 'stop' ? 'stopped' : 'paused';
      wake?.();
      await say(want === 'stopped' ? 'Stopping after the current step…' : 'Pausing after the current step…');
      return { ok: true };
    }
  }
  return { ok: false, error: `Unknown command: ${msg.cmd}` };
}

// ─── The run ────────────────────────────────────────────────────────────────────────────────

async function run() {
  let end = null;
  try {
    await save({ status: 'running', message: 'Starting…', error: false });
    end = { status: 'done', message: await loop(), error: false };
  } catch (e) {
    if (!(e instanceof Halt)) {
      // If Instagram is showing a challenge or warning, that is the real reason (and what the user must act on).
      const message = securityProblem() || (e instanceof Problem ? e.message : `Unexpected error: ${e.message}`);
      end = { status: 'paused', error: true, message };
    }
  }
  if (!alive()) return; // extension reloaded: this orphaned copy must not touch anything
  await cleanup();
  // Decided after cleanup, so a Stop pressed while a pause was still tidying up isn't lost.
  // (A Problem keeps its explanation; the user can press Stop again once it's shown.)
  if (want === 'stopped' && !end) end = { status: 'stopped', message: 'Stopped.', error: false };
  end ??= { status: 'paused', message: 'Paused. Press Resume to continue.', error: false };
  looping = false;
  want = 'idle';
  await save(end);
}

async function loop() {
  if (state.pending?.length) await settlePending();
  for (let first = true; ; first = false) {
    checkpoint();
    const settings = normalizeSettings((await chrome.storage.local.get('settings')).settings);
    const left = settings.maxPerRun ? settings.maxPerRun - state.removed : Infinity;
    if (left <= 0) return `Reached this run's limit of ${settings.maxPerRun}.`;
    if (!first) await wait(settings, 'Next batch in');
    const removed = await unlikeBatch(Math.min(settings.batchSize, left), settings);
    if (!removed) return 'No more liked posts found. All done!';
  }
}

// The previous batch was sent to Instagram but never verified (the page reloaded, the tab closed,
// Instagram showed a warning…). Unlike is one bulk action, so the batch either applied or it didn't,
// and only a freshly loaded list can say which:
//   - a post of the batch is still listed → it didn't apply; those posts are still liked, so they
//     may be picked again (that's a retry, not a second unlike);
//   - none is listed, although the first one would be within the loaded posts → it applied: count it;
//   - otherwise it can't be verified: don't count it, and never tick those posts again this run.
async function settlePending() {
  const { pending, pendingSince = Infinity, pendingAt = 0 } = state;
  // Only a page loaded after the batch was sent shows its outcome (not this page, not an older tab).
  if (performance.timeOrigin <= pendingSince) {
    throw new Problem('The last batch was interrupted before Instagram confirmed it. Reload the page (so the list ' +
      'is fresh), then press Resume.');
  }
  await say('Checking the batch that was interrupted…');
  let view = await waitForList();
  if (view === 'empty') {
    await delay(5000, false); // make sure it's really empty, not still loading
    checkpoint();
    view = pageState();
  }
  const listed = pending.filter((key) => present([key]));
  const applied = !listed.length && (view === 'empty' || document.querySelectorAll(THUMB).length > pendingAt);
  if (!listed.length) await remember(pending);
  const gone = applied ? pending.length : 0;
  await save({ pending: null, pendingSince: null, removed: state.removed + gone, total: (state.total || 0) + gone });
}

// ─── One batch ──────────────────────────────────────────────────────────────────────────────

async function unlikeBatch(limit, settings) {
  await say('Looking for liked posts…');
  if ((await waitForList()) === 'empty') {
    await delay(5000, false); // make sure it's really empty, not still loading
    checkpoint();
    if (pageState() === 'empty') return 0;
  }

  await enterSelectionMode();
  const skip = new Set((await chrome.storage.local.get('doneKeys')).doneKeys || []);
  const keys = await selectPosts(limit, skip);
  if (!keys.length) {
    await leaveSelectionMode(); // the list has ended
    return 0;
  }

  // Cross-check against Instagram's own counter before doing anything irreversible.
  const counted = selectedCount();
  if (counted !== keys.length) {
    throw new Problem(`Instagram shows ${counted ?? 'no'} selected, but the extension ticked ${keys.length}. Paused to be safe.`);
  }
  await wait(settings, `Unliking ${plural(keys.length, 'post')} in`);

  // Record the batch *before* the irreversible click: whatever interrupts us from here on (reload,
  // closed tab, a warning), a later Resume knows these posts may already be unliked. See settlePending.
  const pendingAt = posts().findIndex((p) => p.key === keys[0]);
  await save({ pending: keys, pendingSince: Date.now(), pendingAt });
  let unlike;
  try {
    checkpoint();
    if (selectedCount() !== keys.length) throw new Problem('The selection changed while waiting. Paused to be safe.');
    unlike = unlikeBarButton();
    if (!unlike) throw new Problem('Could not find an enabled "Unlike" button in the selection bar.');
  } catch (e) {
    await save({ pending: null, pendingSince: null }); // nothing was clicked
    throw e;
  }

  // ── Point of no return. Nothing below is ever re-clicked, and Pause/Stop are only honoured
  //    after Instagram has finished this batch, so the progress count stays exact.
  unlike.click();
  await say(`Confirming unlike of ${plural(keys.length, 'post')}…`);
  const confirm = await waitFor(() => confirmButton() || (present(keys) === 0 && 'gone'), 10000,
    'Pressed "Unlike" but no confirmation dialog appeared.', false);
  if (confirm !== 'gone') confirm.click(); // 'gone' = Instagram unliked without asking
  await say('Waiting for Instagram to remove them…');
  // 'loading' (a hidden tab showing only a spinner) doesn't prove anything: wait for the real list.
  const listShown = () => !['loading', null].includes(pageState());
  await waitFor(() => present(keys) === 0 && !confirmButton() && listShown(), 30000,
    'Instagram did not remove the posts after confirming. It may be limiting activity: wait a while, ' +
    'reload the page, then press Resume.', false);
  await delay(1500, false);
  guard(); // a warning that popped up meanwhile leaves the batch unverified (still pending)
  if (present(keys)) {
    throw new Problem('The unliked posts reappeared, so Instagram may have rejected the action. ' +
      'Wait a while, reload the page, then press Resume.');
  }

  await remember(keys);
  await save({ pending: null, pendingSince: null, removed: state.removed + keys.length,
    total: (state.total || 0) + keys.length, message: `Unliked ${plural(keys.length, 'post')}.` });
  return keys.length;
}

// Wait until the Likes list is showing (or known to be empty). A hidden tab whose list is still
// waiting for its first posts can only continue once it's visible (hidden tabs don't render).
async function waitForList() {
  for (;;) {
    const view = await waitFor(pageState, 20000, LIST_MISSING);
    if (view !== 'loading') return view;
    await waitUntilVisible(() => pageState() !== 'loading'); // Instagram's own refresh may still fill it
  }
}

async function enterSelectionMode() {
  for (let attempt = 0; attempt < 2; attempt++) {
    if (!inSelectionMode()) {
      const select = await waitFor(selectButton, 15000,
        'Could not find Instagram\'s "Select" button. Instagram\'s layout may have changed.');
      select.click();
      await waitFor(inSelectionMode, 10000, 'Pressed "Select" but Instagram did not enter selection mode.');
      // Give the checkboxes a moment to render next to the counter (selectPosts pauses if they never do).
      await waitFor(() => document.querySelector(boxSelector()) || !document.querySelector(THUMB), 5000);
      await delay(rand(400, 900), false);
    }
    // Start from an empty selection, so what we confirm is exactly what we ticked.
    const n = selectedCount();
    if (n === 0) return;
    if (n === null) throw new Problem('Could not read Instagram\'s "N selected" counter. Instagram\'s layout may have changed.');
    await leaveSelectionMode();
  }
  throw new Problem('Instagram kept an old selection that could not be cleared. Reload the page, then press Resume.');
}

async function leaveSelectionMode() {
  const cancel = inSelectionMode() && cancelButton();
  if (!cancel) return;
  cancel.click();
  await waitFor(() => !inSelectionMode(), 5000, null, false);
}

// Tick up to `limit` posts that this run hasn't handled yet, loading more posts when needed.
async function selectPosts(limit, skip) {
  const picked = [];
  while (picked.length < limit) {
    checkpoint();
    const listed = posts();
    const next = listed.find((p) => p.key && !skip.has(p.key) && !picked.includes(p.key));
    if (!next) {
      if (!picked.length) {
        // Nothing usable is loaded. Say why now, rather than scrolling on and blaming Instagram later.
        if (!listed.length && document.querySelector(THUMB)) {
          throw new Problem('Instagram shows posts but no selection checkboxes. Its layout may have changed.');
        }
        if (listed.length && listed.every((p) => !p.key)) {
          throw new Problem('Could not identify the posts (their thumbnails have no image address).');
        }
        if (listed.some((p) => skip.has(p.key)) && listed.every((p) => !p.key || skip.has(p.key))) throw new Problem(STALE);
      }
      if (await loadMore(picked.length > 0)) continue;
      break;
    }
    const before = ticked(next.box);
    if (before === null) throw new Problem('Can\'t tell whether posts are ticked: Instagram\'s checkbox looks different now.');
    if (before) throw new Problem('A post was already ticked before the extension touched it. Paused to be safe.');

    toggleOf(next.box).click();
    // The tile is re-rendered on every toggle, so look it up again by key.
    const ok = await waitFor(() => ticked(findPost(next.key)?.box), 5000);
    if (!ok) {
      if (picked.length) break; // e.g. Instagram's own selection limit: go ahead with what we have
      throw new Problem('Clicked a checkbox but it did not tick. Instagram\'s layout may have changed.');
    }
    picked.push(next.key);
    await say(`Selecting posts: ${picked.length}/${limit}`);
    await delay(rand(250, 700), false);
  }
  return picked;
}

// Scroll the list to the bottom so Instagram loads its next page. Returns true if new posts
// appeared, false if the list has ended (no spinner left) or if the tab is hidden and we already
// have some posts ticked.
async function loadMore(havePartialBatch) {
  const seen = new Set(posts().map((p) => p.key));
  const grew = () => posts().some((p) => p.key && !seen.has(p.key));
  for (let attempt = 0; attempt < 3; attempt++) {
    const anchor = document.querySelector(boxSelector()) || document.querySelector(SPINNER);
    if (!anchor) return false;
    const scroller = scrollParent(anchor);
    if (!scroller.querySelector(SPINNER)) return false;
    if (document.hidden) {
      // Hidden tabs don't render, so Instagram's infinite scroll never fires there. But after every
      // Unlike, Instagram re-fetches the first page of likes itself (seen on the live page, even in a
      // hidden tab), so unliking a smaller batch keeps things moving. Only wait with nothing ticked.
      if (havePartialBatch) return false;
      await waitUntilVisible(grew);
      return true; // look again, now that the tab is visible or posts arrived
    }
    await say('Loading more posts…');
    scroller.scrollTop = scroller.scrollHeight;
    scroller.dispatchEvent(new Event('scroll'));
    if (await waitFor(grew, 8000)) return true;
  }
  throw new Problem('Instagram keeps showing its loading spinner but no more posts arrive. It may be limiting ' +
    'activity: wait a while, reload the page, then press Resume.');
}

// Wait while the tab is hidden, unless `ready()` becomes true first.
async function waitUntilVisible(ready) {
  await say('Waiting for the Instagram tab to be visible: Instagram only loads more posts in a visible tab. ' +
    'Switch to it, or keep it in its own (not minimised) window.');
  while (document.hidden && !ready()) {
    checkpoint();
    await delay(1000);
  }
}

// Best effort after a run ends: close our own confirmation dialog and leave selection mode, so the
// page is back to normal. Instagram's warnings and unknown dialogs are left alone for the user.
async function cleanup() {
  try {
    if (securityProblem() || strangeDialog()) return;
    const dialog = confirmButton()?.closest(DIALOG);
    if (dialog) {
      leaves('Cancel', dialog)[0]?.click();
      await delay(500, false);
    }
    await leaveSelectionMode();
  } catch {
    // nothing more we can safely do
  }
}

async function remember(keys) {
  const { doneKeys = [] } = await chrome.storage.local.get('doneKeys');
  await chrome.storage.local.set({ doneKeys: doneKeys.concat(keys).slice(-5000) });
}

// ─── Reading the page ───────────────────────────────────────────────────────────────────────

const alive = () => Boolean(chrome.runtime?.id); // false once the extension is reloaded/removed
const onLikesPage = () => location.pathname.replace(/\/$/, '') === LIKES_PATH;
const shown = (el) => el.getClientRects().length > 0;
const usable = (el) => shown(el) && getComputedStyle(el).pointerEvents !== 'none' &&
  el.getAttribute('aria-disabled') !== 'true' && !el.disabled;
const boxSelector = () => (document.querySelector(BOX) ? BOX : BOX_FALLBACK);
const toggleOf = (box) => (box.matches('[role="button"]') ? box : box.querySelector('[role="button"]') || box);
const findPost = (key) => posts().find((p) => p.key === key);
const present = (keys) => [...document.images].filter((img) => keys.includes(imageKey(img))).length;
const inSelectionMode = () => Boolean(document.querySelector(boxSelector())) || selectedCount() !== null;
const selectButton = () => leaves('Select').find((el) => !el.closest(DIALOG));
const cancelButton = () => leaves('Cancel').find((el) => !el.closest(DIALOG));
const isUnlike = (el) => /^unlike$/i.test((el.getAttribute('aria-label') || el.textContent).trim());
const openDialogs = () => [...document.querySelectorAll(DIALOG)].filter(shown);
// A dialog that isn't our own "Unlike" confirmation: cleanup() leaves it for the user.
const strangeDialog = () => openDialogs().some((d) => !unlikeControls(d).length);

// Visible leaf elements whose text matches (Bloks renders labels as bare <span>s).
function leaves(match, root = document) {
  const test = typeof match === 'string' ? (t) => t === match : (t) => match.test(t);
  return [...root.querySelectorAll('span, div, button, h1, h2, h3')]
    .filter((el) => !el.firstElementChild && test(el.textContent.trim()) && shown(el));
}

function selectedCount() {
  const counter = leaves(/^\d+ selected$/i)[0];
  return counter ? parseInt(counter.textContent, 10) : null;
}

// 'selecting' | 'list' | 'loading' (hidden tab, no posts yet) | 'empty' | null (still loading / not recognised)
function pageState() {
  if (inSelectionMode()) return 'selecting';
  if (selectButton()) return 'list';
  if (document.querySelector(SPINNER)) return document.hidden ? 'loading' : null;
  if (document.querySelector('[role="tablist"]') && !document.querySelector(NON_EMPTY) && !document.querySelector(THUMB)) {
    return 'empty';
  }
  return null;
}

// Posts currently in selection mode: their checkbox and a stable key.
function posts() {
  const sel = boxSelector();
  return [...document.querySelectorAll(sel)].flatMap((box) => {
    // The post tile is the nearest ancestor holding the thumbnail, and it must hold only this checkbox.
    let tile = box.parentElement;
    while (tile && tile !== document.body && !tile.querySelector('img')) tile = tile.parentElement;
    if (!tile || tile === document.body || tile.querySelectorAll(sel).length !== 1) return [];
    return [{ box, key: imageKey(tile.querySelector('img')) }];
  });
}

// CDN file names look like 828413505_2077015799580744_5915718933499274858_n.jpg: unique per post.
function imageKey(img) {
  const src = img?.getAttribute('src');
  if (!src || src.startsWith('data:')) return null;
  try {
    return new URL(src, location.href).pathname.split('/').pop() || null;
  } catch {
    return null;
  }
}

// true = ticked, false = unticked, null = can't tell (UI changed → caller pauses).
function ticked(box) {
  if (!box) return null;
  const aria = box.matches('[aria-checked]') ? box : box.querySelector('[aria-checked]');
  if (aria) return aria.getAttribute('aria-checked') === 'true';
  const html = box.outerHTML; // the tick is a CSS-masked icon referenced in an inline style
  if (/circle-check|check__filled|checkmark/i.test(html)) return true;
  if (/circle__outline|circle_outline/i.test(html)) return false;
  return null;
}

// Usable controls labelled "Unlike", innermost only. Clicking the innermost usable element is what
// a real mouse click does (the event then bubbles to its ancestors).
function unlikeControls(root) {
  const all = [...root.querySelectorAll('button, [role="button"]')].filter((el) => isUnlike(el) && usable(el));
  return all.filter((el) => !all.some((other) => other !== el && el.contains(other)));
}

// The bottom bar holding "N selected" and the Unlike button.
function selectionBar() {
  const counter = leaves(/^\d+ selected$/i)[0];
  for (let el = counter?.parentElement; el && el !== document.body; el = el.parentElement) {
    if ([...el.querySelectorAll('button, [role="button"]')].some(isUnlike)) return el;
  }
  return null;
}

function unlikeBarButton() {
  const bar = selectionBar();
  return bar ? unlikeControls(bar)[0] || null : null;
}

// The "Unlike" button of the confirmation dialog: preferably inside a real dialog, otherwise the
// only usable "Unlike" control outside the selection bar.
function confirmButton() {
  for (const dialog of document.querySelectorAll(DIALOG)) {
    const [button] = unlikeControls(dialog);
    if (button) return button;
  }
  const bar = selectionBar();
  const others = unlikeControls(document).filter((el) => !bar?.contains(el));
  return others.length === 1 ? others[0] : null;
}

// The list's own scroll container (Instagram scrolls the grid inside a div, not the window).
function scrollParent(el) {
  let fallback = null;
  for (let p = el.parentElement; p; p = p.parentElement) {
    const { overflowY } = getComputedStyle(p);
    if (overflowY !== 'auto' && overflowY !== 'scroll') continue;
    if (p.scrollHeight > p.clientHeight) return p;
    fallback ??= p;
  }
  return fallback || document.scrollingElement;
}

// Login walls, challenges, CAPTCHAs, rate limits and error dialogs. Returns a message or null.
function securityProblem() {
  if (/^\/(challenge|checkpoint|accounts\/(login|suspended|disabled)|auth_platform)\b/.test(location.pathname)) {
    return 'Instagram wants you to log in or verify your account. Handle that yourself in the tab, then open ' +
      'Your activity → Likes again and press Resume.';
  }
  if (document.querySelector('iframe[src*="captcha" i], iframe[src*="arkoselabs" i], iframe[title*="captcha" i]')) {
    return 'Instagram is showing a CAPTCHA. Solve it yourself in the tab, then press Resume.';
  }
  const overlay = [...document.querySelectorAll(`${DIALOG}, [role="alert"], [aria-live]`)].map((e) => e.innerText).join('\n');
  const body = document.body?.innerText || '';
  const hit = BLOCKED.find((re) => re.test(body)) || FAILED.find((re) => re.test(overlay));
  if (!hit) return null;
  const line = `${overlay}\n${body}`.split('\n').find((l) => hit.test(l)).trim().slice(0, 140);
  return `Instagram says: "${line}". Paused. Deal with it in the tab (if you're being rate-limited, wait ` +
    'a few hours), then press Resume.';
}

// Throws if the run should stop here: Pause/Stop pressed, extension gone, or the page is wrong.
// Checkpoints are never inside the Unlike → confirm → verify window, so no dialog is expected at
// one; any open dialog (an unknown one, or a stale confirmation) means: stop, never click under it.
function checkpoint() {
  if (!alive() || want !== 'running') throw new Halt();
  guard();
  if (openDialogs().length) {
    throw new Problem('Instagram is showing a dialog the extension didn\'t expect. Read it and close it yourself, ' +
      'then press Resume.');
  }
}

// The checks that also apply after the Unlike click (where our own confirmation dialog is expected).
function guard() {
  const problem = securityProblem();
  if (problem) throw new Problem(problem);
  if (!onLikesPage()) throw new Problem('The tab left the Likes page. Go back to Your activity → Likes and press Resume.');
}

// ─── Timing & state ─────────────────────────────────────────────────────────────────────────

// Poll `fn` until it returns something truthy. On timeout: throw Problem(failMessage), or return
// null when there's no message. `interruptible` = Pause/Stop may end the wait (false inside the
// point-of-no-return section, where only real problems abort).
async function waitFor(fn, ms, failMessage, interruptible = true) {
  const end = Date.now() + ms;
  for (;;) {
    if (!alive()) throw new Halt();
    if (interruptible) checkpoint();
    else guard();
    const value = fn();
    if (value) return value;
    if (Date.now() >= end) {
      if (failMessage) throw new Problem(failMessage);
      return null;
    }
    await delay(300, interruptible);
  }
}

// Every timer starts from a fresh MessageChannel task. Chrome's "intensive throttling" of hidden
// tabs (one wake-up per minute) only applies to chained timers, so this keeps delays close to the
// configured values while you use other tabs. Only interruptible delays can be cut short by
// Pause/Stop; the others always run their full length.
function delay(ms, interruptible = true) {
  return new Promise((resolve) => {
    const channel = new MessageChannel();
    const finish = () => {
      if (interruptible) wake = null;
      resolve();
    };
    channel.port1.onmessage = () => {
      const timer = setTimeout(finish, ms);
      if (interruptible) wake = () => { clearTimeout(timer); finish(); };
    };
    channel.port2.postMessage(null);
  });
}

async function wait(settings, label) {
  const ms = Math.round(rand(settings.minDelay, settings.maxDelay) * 1000);
  await say(`${label} ${Math.round(ms / 1000)}s…`);
  await delay(ms);
  checkpoint();
}

const rand = (lo, hi) => lo + Math.random() * (hi - lo);
const plural = (n, word) => `${n} ${word}${n === 1 ? '' : 's'}`;
const say = (message) => save({ message });

async function save(patch) {
  state = { ...state, ...patch, updatedAt: Date.now() };
  if (alive()) await chrome.storage.local.set({ state });
}
