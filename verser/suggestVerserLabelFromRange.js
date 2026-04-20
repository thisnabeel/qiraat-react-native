import ayahCirclePuaMap from "../ayah_circle_pua.json";
import { flattenPageWordLinePairs } from "./pageWordOrder";

const PUA_MIN = 0xf500;
const PUA_MAX = 0xf73c;
/** Ayah-end markers often sit on the next word(s) after the selected text — scan this far past range end. */
const MARKER_LOOKAHEAD_WORDS = 56;

/** Last ayah-circle PUA in the string that exists in the mushaf map (verse number for label). */
function verseFromAyahCircleContent(content) {
  if (typeof content !== "string") return null;
  let last = null;
  for (let i = 0; i < content.length; ) {
    const cp = content.codePointAt(i);
    const ch = String.fromCodePoint(cp);
    i += ch.length;
    if (cp >= PUA_MIN && cp <= PUA_MAX) {
      const key = `U+${cp.toString(16).toUpperCase()}`;
      if (Object.prototype.hasOwnProperty.call(ayahCirclePuaMap, key)) {
        last = ayahCirclePuaMap[key];
      }
    }
  }
  return last;
}

function inferSurahFromPriorAyahFields(pairs, upToIdx) {
  for (let j = upToIdx; j >= 0; j--) {
    const ay =
      pairs[j].word?.ayah != null ? String(pairs[j].word.ayah).trim() : "";
    const m = ay.match(/^(\d+):\d+$/);
    if (m) return parseInt(m[1], 10);
  }
  return null;
}

function effectiveSurahAtPairIndex(pairs, lineEffectiveSurah, i) {
  const lineIndex = pairs[i].lineIndex;
  const headerSurah = lineEffectiveSurah[lineIndex];
  if (headerSurah != null && headerSurah > 0) return headerSurah;
  return inferSurahFromPriorAyahFields(pairs, i);
}

/**
 * Last `surah_header_position` strictly greater than zero when scanning lines top → bottom
 * (same convention as mushaf reading order). Ignores `-1` (basmala row marker).
 */
export function lastPositiveSurahHeaderCarryFromPage(page) {
  if (!page?.lines?.length) return null;
  const lines = [...page.lines].sort(
    (a, b) => Number(a.position) - Number(b.position)
  );
  let last = null;
  for (const line of lines) {
    const sh = Number(line?.surah_header_position ?? 0);
    if (sh > 0) last = sh;
  }
  return last;
}

/**
 * Walks earlier mushaf page numbers (cached only) until a page yields a positive surah header carry.
 * @param {Record<number, object>} pageByPosition map of page `position` → page JSON
 */
export function surahCarryFromPrecedingCachedPages(
  pageByPosition,
  startPageNum,
  maxHops = 60
) {
  if (
    pageByPosition == null ||
    typeof startPageNum !== "number" ||
    startPageNum <= 1
  ) {
    return null;
  }
  for (let p = startPageNum - 1; p >= 1; p--) {
    if (startPageNum - p > maxHops) break;
    const prev = pageByPosition[p];
    const s = lastPositiveSurahHeaderCarryFromPage(prev);
    if (s != null && s > 0) return s;
  }
  return null;
}

/** Per-line effective surah: optional carry-in from previous pages, then forward header carry. */
function buildLineEffectiveSurah(lines, incomingSurah) {
  const lineEffectiveSurah = new Array(lines.length).fill(null);
  let carry =
    incomingSurah != null && incomingSurah > 0 ? incomingSurah : null;
  for (let li = 0; li < lines.length; li++) {
    const sh = Number(lines[li]?.surah_header_position ?? 0);
    if (sh > 0) carry = sh;
    lineEffectiveSurah[li] = carry;
  }
  return lineEffectiveSurah;
}

/**
 * Suggest `surah:ayah` for a Verser range:
 * - Surah: carried `surah_header_position` on lines, else parsed from the nearest prior `word.ayah`
 *   (continuation pages before the next surah banner).
 * - When the current page has no positive headers, surah is seeded from the **last** positive
 *   `surah_header_position` on the nearest **preceding** page present in `options.pageByPosition`
 *   (same as walking back through cached mushaf pages).
 * - Verse: last PUA ayah-circle in `ayah_circle_pua.json` found from **range start** through
 *   **range end + lookahead** (markers are often on the word after the selected run).
 * - If a word in that window already has full `surah:ayah` from the API, the last such value wins.
 * - If no full label is found but surah is known, returns `surah:` so the user only types the ayah.
 *
 * @param {object} [options]
 * @param {Record<number, object>} [options.pageByPosition] ref-like map: page position → page payload
 * @param {number} [options.pageNumber] current mushaf page position (for preceding-page carry)
 * @param {number} [options.incomingSurah] optional explicit carry (overrides preceding-page lookup)
 */
export function suggestVerserLabelFromRange(page, wordIdsInRange, options = {}) {
  if (!page?.lines?.length || !wordIdsInRange?.length) return "";
  const idSet = new Set(wordIdsInRange.map((id) => String(id)));
  const lines = [...page.lines].sort(
    (a, b) => Number(a.position) - Number(b.position)
  );

  let incoming = options.incomingSurah;
  if (
    (incoming == null || incoming <= 0) &&
    options.pageByPosition != null &&
    options.pageNumber != null
  ) {
    incoming = surahCarryFromPrecedingCachedPages(
      options.pageByPosition,
      Number(options.pageNumber)
    );
  }
  const lineEffectiveSurah = buildLineEffectiveSurah(lines, incoming);

  const pairs = flattenPageWordLinePairs(page);
  if (!pairs.length) return "";

  let lo = -1;
  let hi = -1;
  for (let i = 0; i < pairs.length; i++) {
    if (idSet.has(String(pairs[i].word.id))) {
      lo = lo < 0 ? i : Math.min(lo, i);
      hi = Math.max(hi, i);
    }
  }
  if (lo < 0 || hi < 0) return "";

  const scanEnd = Math.min(pairs.length - 1, hi + MARKER_LOOKAHEAD_WORDS);
  let suggestion = "";
  /** Last surah inferred from header / prior `word.ayah` within the selected word indices only. */
  let surahPrefixFromSelection = null;

  for (let i = lo; i <= scanEnd; i++) {
    const { word } = pairs[i];
    const ay = word?.ayah != null ? String(word.ayah).trim() : "";

    const surah = effectiveSurahAtPairIndex(pairs, lineEffectiveSurah, i);
    if (i >= lo && i <= hi && surah != null && surah > 0) {
      surahPrefixFromSelection = surah;
    }

    const v = verseFromAyahCircleContent(word.content);
    const surahForPua =
      surah != null && surah > 0
        ? surah
        : inferSurahFromPriorAyahFields(pairs, i);
    if (v != null && surahForPua != null && surahForPua > 0) {
      suggestion = `${surahForPua}:${v}`;
    }
    if (/^\d+:\d+$/.test(ay)) {
      suggestion = ay;
    }
  }

  if (suggestion) return suggestion;
  if (surahPrefixFromSelection != null && surahPrefixFromSelection > 0) {
    return `${surahPrefixFromSelection}:`;
  }
  const surahFromPriorAtHi = inferSurahFromPriorAyahFields(pairs, hi);
  if (surahFromPriorAtHi != null && surahFromPriorAtHi > 0) {
    return `${surahFromPriorAtHi}:`;
  }
  const surahFromPriorAtScanEnd = inferSurahFromPriorAyahFields(pairs, scanEnd);
  if (surahFromPriorAtScanEnd != null && surahFromPriorAtScanEnd > 0) {
    return `${surahFromPriorAtScanEnd}:`;
  }
  return "";
}
