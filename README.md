# Instagram Unliker

A Chrome/Edge extension that removes your own Instagram likes in batches, using Instagram's own **Your activity → Likes** page.

It clicks the same buttons you would: **Select**, tick the posts, **Unlike**, then confirm. It does this at a slow, randomized pace and stops the moment anything looks wrong.

- No password, API key or login automation. You log in yourself, on the browser.
- No servers or tracking. Everything runs in your browser.
- Only one permission (`storage`), and it only runs on `www.instagram.com`.
- No dependencies and no build step.

> **Use at your own risk.** This automates actions on your own account through Instagram's web interface. Instagram may rate-limit or challenge accounts that do many actions quickly. The extension pauses when that happens, but it cannot promise your account won't be flagged. Start small.

---

## Installation

The extension isn't in the Chrome Web Store, so you load it manually. This takes about a minute.

1. Download this repository: **Code → Download ZIP**, then unzip it. Or clone it:
   ```bash
   git clone https://github.com/<your-username>/instagram-unliker.git
   ```
2. Open Chrome and go to `chrome://extensions`. In Edge, go to `edge://extensions`.
3. Turn on **Developer mode** (the toggle in the top-right corner; in Edge it's on the left).
4. Click **Load unpacked** and select the `instagram-unliker` folder, the one that contains `manifest.json`.
5. Optional: click the puzzle-piece icon in the toolbar and **pin** Instagram Unliker so its icon is always visible.
6. If you already had Instagram open, **reload that tab** so the extension can attach to it.

**Updating:** replace the files with the new version, go back to `chrome://extensions` and click the reload icon on the extension's card. Then reload your Instagram tab.

---

## How to use it

1. Log in to [instagram.com](https://www.instagram.com) as usual.
2. Open your Likes page: <https://www.instagram.com/your_activity/interactions/likes/>. You can also click **Open my Likes page** in the extension popup.
3. Click the extension icon to open the popup.
4. Check the settings (see below). For your first run, set **Max likes per run** to something small like `20`.
5. Press **Start**.

You can close the popup; the run keeps going in the Instagram tab. Open the popup again at any time to see progress or to pause or stop.

### Controls

| Button | What it does |
|---|---|
| **Start** | Starts a new run. The "removed this run" counter resets to 0. |
| **Pause** | Stops safely at the next safe point. If a batch is already being confirmed, it finishes that batch first so nothing is left half-done. |
| **Resume** | Shown instead of Start while paused. Continues the same run with the same counter and limit. |
| **Stop** | Ends the run. The next press of Start begins a fresh run. |

### Toolbar badge

The extension icon shows the status even when the popup is closed:

| Badge | Meaning |
|---|---|
| a number | Running; the number is how many likes this run has removed |
| `‖` | Paused |
| `!` | Paused because something needs your attention; open the popup to see why |
| `✓` | Finished: no liked posts left, or the run limit was reached |

---

## Settings

All settings are saved automatically. Out-of-range values are corrected to the nearest allowed value.

### Batch size
**Default: 20. Range: 1–100.**

How many posts are ticked before each **Unlike** click. Instagram removes the whole batch in one action, so a batch of 20 is one unlike action covering 20 posts.

- Larger batches finish faster, but each action does more.
- Smaller batches are gentler.
- If the Instagram tab is in the background, a batch holds at most the posts already loaded on the page (usually 18). See [Background tabs](#background-tabs).

### Delay (min – max seconds)
**Default: 3–8 seconds. Min delay range: 1–600. Max delay: from the min delay up to 600.**

Before each Unlike, the extension waits a **random** time between these two values, so the rhythm isn't robotic. A few short, random pauses are also added between individual ticks.

If you're removing a lot, or Instagram has warned you before, raise these. For example, 10–30 seconds.

### Max likes per run
**Default: 0 (no limit). Range: 0 or more.**

This is a safety cap. When the run has removed this many likes, it stops by itself and shows `✓`.

- `0` means no limit: it keeps going until your Likes page is empty.
- Batches are shortened to fit the cap. With a batch size of 20 and a max of 50, it removes 20, then 20, then 10, and stops.
- The cap counts **this run only**. Pressing **Start** again begins a new run with a fresh count. **Resume** continues the same count.

Use it to spread removals over several sessions, for example 100 a day, or to test with a small number first.

### Counters

- **Removed this run:** likes removed since you last pressed Start.
- **Removed in total:** likes removed across all runs on this browser.

---

## Background tabs

You can switch to other tabs while it runs. Chrome slows down background tabs, and Instagram doesn't load more posts when you scroll in a hidden tab. So in the background:

- Each batch holds only the posts already loaded, usually 18.
- After each Unlike, Instagram reloads the first page of your likes by itself, so the run normally keeps going.
- If no posts are loaded at all, it waits until you switch back to the tab, then continues.

For the fastest runs, keep the Instagram tab visible.

---

## Safety behaviour

The extension is designed to **stop rather than guess**. It pauses and explains why in the popup when:

- Instagram shows a rate-limit warning ("Try again later", "We restrict certain activity…").
- Instagram asks you to log in, verify your account, or solve a CAPTCHA or other challenge.
- An unexpected dialog or pop-up appears.
- The page doesn't look the way it expects, for example because Instagram changed its layout, the page is in another language, or you navigated away.
- The Instagram tab is reloaded, closed, or goes to a different page.

It **never** tries to get past a CAPTCHA, login prompt, challenge or rate limit. After a problem, the only thing it may click is **Cancel** on its own "Unlike this post?" dialog. It won't touch anything else.

**What to do when it pauses:**
1. Read the message in the popup.
2. Deal with whatever Instagram is showing, for example verify your account or wait a while after a rate limit.
3. Reload the Likes page.
4. Press **Resume**.

If you were rate-limited, wait at least several hours, then use a smaller batch size and longer delays.

### Never unlikes the same post twice

- Each post is identified by its image, and the extension remembers which posts it has already handled, so it won't tick the same post again.
- Before clicking Unlike, it saves which posts are in that batch. If the page reloads or the tab closes mid-batch, the next Resume or Start first asks you to reload the page. It then checks what Instagram actually did:
  - If those posts are gone, the batch is counted.
  - If they're still there, it is retried.
  - If it can't tell, it doesn't count them and doesn't re-tick them.
- Every tick is checked against Instagram's own "N selected" counter before Unlike is pressed. If the numbers don't match, it pauses instead of continuing.

---

## Requirements and limitations

- **Chrome or Edge** (any recent version that supports Manifest V3 extensions).
- **Instagram must be in English.** The extension finds buttons by their labels ("Select", "Unlike", "Cancel", "N selected"). In another language it simply pauses with a message. You can change the language under Instagram → Settings → Language.
- **Desktop web only**, on `www.instagram.com`.
- **Instagram changes its site often.** If the layout changes, the extension will most likely pause with a "layout may have changed" message rather than do anything wrong. Please open an issue if that happens.
- It only removes likes on **posts and reels** shown on the Likes page. Comment likes and story likes aren't affected.
- Instagram may take a while to update like counts everywhere after a removal.

---

## Privacy

- No data leaves your browser. There are no analytics, servers or network requests of the extension's own.
- It stores only its settings, progress counters, and a list of image identifiers for posts it has already handled, in Chrome's local extension storage (`chrome.storage.local`).
- Removing the extension deletes all of that.

### Permissions

| Permission | Why |
|---|---|
| `storage` | To save settings and progress so closing the popup doesn't stop the run |
| Runs on `https://www.instagram.com/*` | To click the buttons on your Likes page. It runs on no other site. |

---

## Troubleshooting

| Problem | Fix |
|---|---|
| Popup says to open your Likes page | Open <https://www.instagram.com/your_activity/interactions/likes/> in that browser, then reload the tab. |
| Start does nothing / "couldn't reach the page" | Reload the Instagram tab. This is needed after installing or updating the extension. |
| "Layout may have changed" | Make sure Instagram is in English and you're on the Likes page. If it keeps happening, Instagram probably changed its layout; please open an issue. |
| "Reload the page, then press Resume" | A batch was interrupted. Reload the Likes page so the extension can check what Instagram did, then press Resume. |
| Paused with `!` after a warning | Instagram rate-limited you. Wait a few hours, then use smaller batches and longer delays. |
| Slow in the background | Expected; see [Background tabs](#background-tabs). Keep the tab visible for full speed. |

---

## Running the tests

The repository includes an automated test suite. It runs the real extension in a hidden copy of Chrome against a **fake** Likes page (`test/mock-likes.html`). It never contacts Instagram and never touches your account.

It needs **Node.js 18+** and **Chrome or Edge**.

```bash
node test/e2e.mjs
```

A full run takes about 12 minutes. To run only some of the scenarios, set `ONLY` to a pattern that matches their names:

```bash
ONLY="reload|ratelimit" node test/e2e.mjs
```

To use a specific browser:

```bash
CHROME="/path/to/chrome" node test/e2e.mjs
```

On Windows PowerShell, set the variable first:

```powershell
$env:ONLY = "ratelimit"; node test/e2e.mjs
```

The scenarios cover:
- Start, Pause, Resume and Stop, and the settings limits.
- Scrolling to load more posts, and the max-per-run cap.
- Rate limits, challenges and CAPTCHAs, and missing or changed buttons.
- Page reloads and tab closes mid-batch, and background tabs.

---

## Project files

| File | Purpose |
|---|---|
| `manifest.json` | Extension manifest (Manifest V3) |
| `content.js` | The automation that runs on the Instagram Likes page |
| `shared.js` | Default settings and their allowed ranges |
| `background.js` | Toolbar badge; notices when the Instagram tab closes or reloads |
| `popup.html` / `popup.js` | The popup: controls, settings, progress |
| `test/mock-likes.html` | Fake Likes page used by the tests |
| `test/e2e.mjs` | Automated end-to-end tests |

---

## Disclaimer

This project is not affiliated with, endorsed by, or connected to Instagram or Meta. "Instagram" is a trademark of Meta Platforms, Inc. Use this tool responsibly and in line with Instagram's Terms of Use. You are responsible for actions taken on your account.

## License

MIT 
