/**
 * Parse `surah:ayah` (e.g. `2:255`) and return the same surah with ayah + 1.
 * Returns null if the label does not match `digits:digits`.
 */
export function incrementSurahAyah(label) {
  const s = String(label ?? "").trim();
  const m = s.match(/^(\d+):(\d+)$/);
  if (!m) return null;
  const surah = parseInt(m[1], 10);
  const ayah = parseInt(m[2], 10);
  if (!Number.isFinite(surah) || !Number.isFinite(ayah)) return null;
  return `${surah}:${ayah + 1}`;
}
