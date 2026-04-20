/**
 * Flatten page words in mushaf reading order: lines top→bottom by `line.position`,
 * words left→right in stored order by `word.position` when present, else array order.
 */
export function flattenPageWordsInOrder(page) {
  if (!page?.lines?.length) return [];
  const lines = [...page.lines].sort(
    (a, b) => Number(a.position) - Number(b.position)
  );
  const out = [];
  for (const line of lines) {
    const words = Array.isArray(line.words) ? [...line.words] : [];
    const hasPos = words.some((w) => w && w.position != null);
    if (hasPos) {
      words.sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
    }
    for (const w of words) {
      if (w && w.id != null) out.push(w);
    }
  }
  return out;
}

/** Like `flattenPageWordsInOrder` but each entry includes the line index (for `surah_header_position`). */
export function flattenPageWordLinePairs(page) {
  if (!page?.lines?.length) return [];
  const lines = [...page.lines].sort(
    (a, b) => Number(a.position) - Number(b.position)
  );
  const pairs = [];
  for (let li = 0; li < lines.length; li++) {
    const line = lines[li];
    const words = Array.isArray(line.words) ? [...line.words] : [];
    const hasPos = words.some((w) => w && w.position != null);
    if (hasPos) {
      words.sort((a, b) => Number(a?.position ?? 0) - Number(b?.position ?? 0));
    }
    for (const w of words) {
      if (w && w.id != null) pairs.push({ word: w, lineIndex: li });
    }
  }
  return pairs;
}

/** Inclusive range of word ids between two anchors on the same page (reading order). */
export function wordIdsInInclusiveRange(page, idA, idB) {
  const flat = flattenPageWordsInOrder(page);
  const i = flat.findIndex((w) => String(w.id) === String(idA));
  const j = flat.findIndex((w) => String(w.id) === String(idB));
  if (i < 0 || j < 0) return [];
  const lo = Math.min(i, j);
  const hi = Math.max(i, j);
  return flat.slice(lo, hi + 1).map((w) => w.id);
}

/**
 * After preview exists on the page: word ids from the first word after the last previewed
 * index through the clicked word (reading order). Empty if the click is before that slot.
 */
export function wordIdsFromNextPreviewThroughClick(page, previewMap, clickedWordId) {
  const flat = flattenPageWordsInOrder(page);
  const clickIdx = flat.findIndex((w) => String(w.id) === String(clickedWordId));
  if (clickIdx < 0) return [];

  let lastPreviewIdx = -1;
  for (let i = 0; i < flat.length; i++) {
    const id = String(flat[i].id);
    if (Object.prototype.hasOwnProperty.call(previewMap, id)) {
      lastPreviewIdx = Math.max(lastPreviewIdx, i);
    }
  }
  const startIdx = lastPreviewIdx + 1;
  if (clickIdx < startIdx) return [];
  return flat.slice(startIdx, clickIdx + 1).map((w) => w.id);
}
