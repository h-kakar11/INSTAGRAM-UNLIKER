# Instagram Like Remover

A Chrome/Edge extension (Manifest V3) that removes your Instagram likes by driving Instagram's own
**Your activity → Likes** screen: *Select → tick posts → Unlike → confirm → repeat*.

- No passwords, API keys or tokens. You log in to Instagram yourself, as usual.
- Everything runs locally in your browser. No server and no dependencies.
- It only runs on `https://www.instagram.com/*` and only asks for the `storage` permission.
- It never bypasses CAPTCHAs, login challenges or rate limits. If Instagram shows one, the run
  pauses and tells you to deal with it yourself.

## Install (Chrome or Edge)

1. Open the extensions page:
   - Chrome: go to `chrome://extensions`
   - Edge: go to `edge://extensions`
2. Turn on **Developer mode** (top-right toggle in Chrome, left sidebar in Edge).
3. Click **Load unpacked** and choose this folder (the one containing `manifest.json`).
4. Optional: pin the extension (puzzle-piece icon → pin **Instagram Like Remover**).
5. If Instagram was already open, **reload that tab** so the extension can attach to it.

## Use

1. Log in at <https://www.instagram.com> as you normally would.
2. Open **Your activity → Likes**: <https://www.instagram.com/your_activity/interactions/likes/>
   (the popup's **Open my Likes page** button takes you there).
3. Click the extension icon. Adjust the settings if you like, then press **Start**.

| Setting | Default | Meaning |
|---|---|---|
| Batch size | 20 | Posts ticked and unliked together in one "Unlike" action (1–100) |
| Delay between actions | 3–8 s | Random wait before each "Unlike" and between batches (minimum 1 s). Ticking checkboxes uses a short 0.25–0.7 s gap. |
| Max likes per run | none | Stop after removing this many in one run |

- **Pause** stops at the next safe point and leaves selection mode. **Resume** continues the same
  run with the same counter.
- **Stop** ends the run. The next **Start** begins a new run; the *total* counter keeps counting.
- You can close the popup at any time. The run lives in the Instagram tab and its state is saved,
  so reopening the popup shows live progress. The toolbar badge also shows it: a count while
  running, `||` when paused, `!` when it needs your attention, `✓` when finished.
- If you press Pause/Stop after the extension has already pressed Unlike, it first waits for
  Instagram to finish that batch, so the count stays exact. Earlier than that, it stops right away
  and clears the half-built selection.

### Using your PC while it runs

The run keeps going when you switch to other tabs or apps. After every Unlike, Instagram reloads the
first page of your likes (18 posts) by itself, even in a background tab, so a background run keeps
going. One limitation comes from Chrome: **hidden tabs don't render, so scrolling can't load *more*
posts there.** In a background tab a batch is therefore capped at what's loaded (for example 18
instead of 20). If nothing at all is loaded, the run waits (and says so in the popup) until the tab
is visible again. For fully hands-off runs, you can also drag the Instagram tab into **its own
window** and leave it visible (small, or on another monitor, but not minimised or fully covered).

## Safety behaviour

The extension pauses with an explanation when any of the following happens. Apart from pressing
**Cancel** to leave its own selection or confirmation, it then clicks nothing else, and it never
clicks anything while an Instagram warning or an unknown dialog is open:

- the "Select" button, the checkboxes, the "N selected" counter, the Unlike button or the
  confirmation dialog can't be found, or don't respond as expected;
- Instagram's own "N selected" count differs from what the extension ticked;
- Instagram shows **Try Again Later**, **Action Blocked**, "we limit how often…", "confirm it's you",
  "unusual activity", a CAPTCHA, a login page or a challenge/checkpoint page, or an error dialog;
- **any dialog it doesn't recognise** is open (it never clicks underneath one);
- unliked posts don't disappear after confirming, or reappear afterwards;
- the tab leaves the Likes page, reloads, is redirected, or is closed (you can Resume later);
- the extension itself is reloaded (the old copy in the page goes inert immediately).

Idempotency: every ticked post is verified by its thumbnail's file name. Posts already unliked in
the current run are remembered, so they are never ticked again. A batch is recorded *before* its
Unlike is pressed. If the run is cut off mid-batch (reload, closed tab, a warning), the next Resume
(or Start) first asks you to reload the page if needed, then checks the freshly loaded list:
- if the batch's posts are gone, it counts them and never touches them again;
- if they are still listed, the unlike didn't happen, so they are still liked and are simply retried;
- if it can't tell, it doesn't count them and doesn't touch them again in this run.

If Instagram keeps listing posts the run already unliked, it pauses instead of clicking them twice.
Reload and press Resume; if they are still listed, press **Stop** and then **Start**, which begins a
fresh run that may retry them.

### Limitations

- Instagram must be in **English**. The extension matches the visible labels "Select", "Cancel",
  "Unlike" and "N selected". In another language it simply pauses with a message.
- The selectors were taken from Instagram's web UI in September 2026. If Instagram redesigns the
  page, the extension pauses instead of guessing. The selectors are documented at the top of
  `content.js`.
- The whole flow (Select → tick → Unlike → the "Unlike this post?" confirmation → removal) was
  verified once on the live page in September 2026. For robustness, the extension also handles a
  confirmation without ARIA roles, and Instagram unliking without asking.

## Test without touching your account

`test/e2e.mjs` loads this extension into a throwaway headless Chrome/Edge profile and drives it via
its real popup against `test/mock-likes.html`, a copy of the Likes page's DOM served as
`www.instagram.com` (every request is intercepted, so nothing reaches Instagram). It covers
Start/Pause/Resume/Stop, loading more posts, the per-run limit, hidden tabs, reloads (including one
in the middle of a batch), closed tabs, never unliking a post twice, and pausing safely on missing
buttons, missing checkboxes, missing dialogs, rate-limit dialogs and challenge pages.

```bash
node test/e2e.mjs
```

It needs Node 18+ and Chrome or Edge 126+. Set `CHROME=/path/to/browser` to pick a specific browser.

## Files

| File | Role |
|---|---|
| `manifest.json` | MV3 manifest: `storage` permission, content script on `www.instagram.com` |
| `content.js` | The automation: finds UI elements, ticks, unlikes, verifies, pauses safely |
| `popup.html` / `popup.js` | Controls, settings, live status and progress |
| `background.js` | Toolbar badge; marks a run paused if its tab closes, reloads or navigates away, or the browser restarts |
| `shared.js` | Settings defaults/validation and the Likes URL (used by popup and content script) |
| `test/` | Mock Likes page and the end-to-end test (not needed to use the extension) |
