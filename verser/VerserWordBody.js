import React from "react";
import { View, Text, StyleSheet } from "react-native";
import { verserBadgeSurface } from "./rangeColors";

const styles = StyleSheet.create({
  /** Out-of-flow anchor: height = word only; badge hangs below without growing the line. */
  wordWrap: {
    position: "relative",
    alignItems: "center",
  },
  badgeSlot: {
    position: "absolute",
    top: "76%",
    left: 0,
    right: 0,
    alignItems: "center",
    zIndex: 4,
  },
  badge: {
    marginTop: 0,
    paddingHorizontal: 3,
    paddingVertical: 1,
    borderRadius: 3,
    maxWidth: 80,
  },
  badgeText: {
    fontSize: 6,
    fontWeight: "600",
    textAlign: "center",
  },
});

/**
 * Wraps mushaf word content; when `active`, shows a tiny centered `word.ayah` badge (or "nil" on gray).
 * `ayahPreview` when set overrides `word.ayah` for client-side preview (same shape as API: surah:ayah).
 * `rangeSegmentIndex` selects a contrasting badge color per contiguous ayah run (cycles 20 hues).
 */
export function VerserWordBody({
  active,
  isDarkMode,
  word,
  ayahPreview,
  rangeSegmentIndex,
  children,
}) {
  if (!active) return children;

  const ayahRaw = ayahPreview !== undefined ? ayahPreview : word?.ayah;
  const ayahPresent =
    ayahRaw != null && String(ayahRaw).trim() !== "";
  const badgeText = ayahPresent ? String(ayahRaw).trim() : "nil";

  const surface = verserBadgeSurface(rangeSegmentIndex, isDarkMode, ayahPresent);

  return (
    <View style={styles.wordWrap}>
      {children}
      <View
        style={styles.badgeSlot}
        pointerEvents="none"
        accessibilityElementsHidden
        importantForAccessibility="no-hide-descendants"
      >
        <View style={[styles.badge, { backgroundColor: surface.backgroundColor }]}>
          <Text
            allowFontScaling={false}
            style={[styles.badgeText, { color: surface.color }]}
          >
            {badgeText}
          </Text>
        </View>
      </View>
    </View>
  );
}
