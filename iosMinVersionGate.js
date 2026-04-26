import Constants from "expo-constants";
import { Platform } from "react-native";

/**
 * Parse "1.0.57" into numeric tuple for comparison. Non-numeric segments become 0.
 * @param {string} v
 * @returns {number[]}
 */
function semverParts(v) {
  return String(v || "")
    .trim()
    .split(".")
    .map((s) => {
      const n = parseInt(String(s).replace(/\D/g, ""), 10);
      return Number.isFinite(n) ? n : 0;
    });
}

/** True if a < b (strict), using dot-separated numeric segments, padded to max length. */
export function isSemverLessThan(a, b) {
  const pa = semverParts(a);
  const pb = semverParts(b);
  const len = Math.max(pa.length, pb.length, 1);
  for (let i = 0; i < len; i++) {
    const x = pa[i] ?? 0;
    const y = pb[i] ?? 0;
    if (x < y) return true;
    if (x > y) return false;
  }
  return false;
}

/** Marketing / CFBundleShortVersionString from the native build (matches App Store version). */
export function getInstalledIosAppVersion() {
  const native = Constants.nativeApplicationVersion;
  if (native && String(native).trim()) return String(native).trim();
  const fromConfig = Constants.expoConfig?.version;
  if (fromConfig && String(fromConfig).trim()) return String(fromConfig).trim();
  return "0.0.0";
}

/**
 * @param {string} apiBase e.g. from getApiBase() — no trailing slash
 * @returns {Promise<{ blocked: boolean, minVersion?: string, installed?: string }>}
 */
export async function checkIosMinVersionFromApi(apiBase) {
  if (Platform.OS !== "ios") return { blocked: false };
  try {
    const url = `${apiBase.replace(/\/$/, "")}/api/global_config`;
    const res = await fetch(url);
    if (!res.ok) return { blocked: false };
    const data = await res.json();
    const min = data?.min_ios_version;
    if (typeof min !== "string" || !min.trim()) return { blocked: false };
    const trimmed = min.trim();
    const installed = getInstalledIosAppVersion();
    const blocked = isSemverLessThan(installed, trimmed);
    return { blocked, minVersion: trimmed, installed };
  } catch {
    return { blocked: false };
  }
}
