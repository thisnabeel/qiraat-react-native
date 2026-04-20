import { flattenPageWordsInOrder } from "./pageWordOrder";

/**
 * Contiguous runs of the same effective ayah (preview entry if present, else `word.ayah`)
 * get segment indices 0,1,2,… in reading order — used to pick badge colors per range.
 */
export function rangeSegmentIndexByWordId(page, verserAyahPreview) {
  const flat = flattenPageWordsInOrder(page);
  const preview = verserAyahPreview || {};
  const map = {};
  let segIndex = 0;
  let prevKey = undefined;
  for (const w of flat) {
    const id = String(w.id);
    const fromPreview = Object.prototype.hasOwnProperty.call(preview, id);
    const raw = fromPreview ? preview[id] : w?.ayah;
    const key =
      raw != null && String(raw).trim() !== ""
        ? String(raw).trim()
        : "__nil__";
    if (prevKey !== undefined && key !== prevKey) segIndex++;
    map[id] = segIndex;
    prevKey = key;
  }
  return map;
}

/** 11 is coprime to 20 so consecutive segment indices map to well-separated slots. */
const PALETTE_SHUFFLE = 11;

/** Light mushaf: saturated pastels (readable with dark text). */
export const VERSE_RANGE_BADGE_BG_LIGHT = [
  "#FF8A80",
  "#69F0AE",
  "#82B1FF",
  "#FFD740",
  "#EA80FC",
  "#A7FFEB",
  "#8C9EFF",
  "#FFAB40",
  "#B388FF",
  "#CCFF90",
  "#80D8FF",
  "#FF5252",
  "#64FFDA",
  "#536DFE",
  "#FFFF8D",
  "#FF80AB",
  "#18FFFF",
  "#448AFF",
  "#FF6E40",
  "#E040FB",
];

/** Dark mushaf: deeper fills (readable with white text). */
export const VERSE_RANGE_BADGE_BG_DARK = [
  "#C62828",
  "#2E7D32",
  "#1565C0",
  "#F9A825",
  "#6A1B9A",
  "#00695C",
  "#283593",
  "#EF6C00",
  "#4527A0",
  "#558B2F",
  "#0277BD",
  "#B71C1C",
  "#00838F",
  "#1A237E",
  "#F57F17",
  "#AD1457",
  "#37474F",
  "#0D47A1",
  "#D84315",
  "#4A148C",
];

export function verserBadgeBackgroundColor(segmentIndex, isDarkMode) {
  const s = Math.abs(Number(segmentIndex) || 0);
  const idx = ((s % 20) * PALETTE_SHUFFLE) % 20;
  return isDarkMode
    ? VERSE_RANGE_BADGE_BG_DARK[idx]
    : VERSE_RANGE_BADGE_BG_LIGHT[idx];
}

/** Badge fill + label color for Verser (nil stays neutral gray). */
export function verserBadgeSurface(rangeSegmentIndex, isDarkMode, ayahPresent) {
  if (!ayahPresent) {
    return {
      backgroundColor: isDarkMode ? "#757575" : "#9e9e9e",
      color: "#ffffff",
    };
  }
  return {
    backgroundColor: verserBadgeBackgroundColor(rangeSegmentIndex, isDarkMode),
    color: isDarkMode ? "#ffffff" : "#1a1a1a",
  };
}
