import raw from "./surah_numbers.json";

/** @param {unknown} value */
export function normalizeSurahEntry(value) {
  if (value == null) return { ar: "", en: "" };
  if (typeof value === "string") return { ar: value, en: "" };
  if (typeof value === "object") {
    const o = /** @type {{ ar?: string; arabic?: string; en?: string; en_alias?: string; english?: string }} */ (
      value
    );
    const ar = o.ar ?? o.arabic ?? "";
    const en = o.en ?? o.en_alias ?? o.english ?? "";
    return { ar: String(ar).trim(), en: String(en).trim() };
  }
  return { ar: "", en: "" };
}

/** Arabic surah title for display (falls back to سورة n). */
export function surahArabicName(n) {
  const { ar } = normalizeSurahEntry(raw[String(n)]);
  return ar || `سورة ${n}`;
}

/** English transliteration / alias for search (may be empty for legacy JSON). */
export function surahEnglishAlias(n) {
  return normalizeSurahEntry(raw[String(n)]).en;
}
