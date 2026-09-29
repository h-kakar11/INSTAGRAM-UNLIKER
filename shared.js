// Shared by the popup and the content script.

const LIKES_URL = 'https://www.instagram.com/your_activity/interactions/likes/';

// Settings come from user input / storage, so always clamp them into safe ranges.
// The 1-second delay floor keeps the extension from ever firing actions back-to-back.
function normalizeSettings(raw = {}) {
  const num = (v, fallback) => (v === '' || v == null || !Number.isFinite(Number(v)) ? fallback : Number(v));
  const clamp = (v, lo, hi) => Math.min(hi, Math.max(lo, v));
  const batchSize = clamp(Math.round(num(raw.batchSize, 20)), 1, 100);
  const minDelay = clamp(num(raw.minDelay, 3), 1, 600);
  const maxDelay = clamp(num(raw.maxDelay, 8), minDelay, 600);
  const maxPerRun = Math.max(0, Math.round(num(raw.maxPerRun, 0))); // 0 = no limit
  return { batchSize, minDelay, maxDelay, maxPerRun };
}
