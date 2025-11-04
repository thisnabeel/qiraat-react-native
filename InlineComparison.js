import React from "react";
import { View, Text, StyleSheet } from "react-native";

const InlineComparison = ({ originalText, inputText }) => {
  const diacritics = ["َ", "ِ", "ُ", "ْ"];

  const isDiacritic = (char) => diacritics.includes(char);

  // Group characters into units: base letter + its diacritics
  const groupUnits = (text) => {
    const chars = text.split("");
    const units = [];
    let i = 0;

    while (i < chars.length) {
      const unit = { base: chars[i], diacritics: [], index: i, length: 1 };
      i++;

      // Collect any following diacritics
      while (i < chars.length && isDiacritic(chars[i])) {
        unit.diacritics.push(chars[i]);
        unit.length++;
        i++;
      }

      unit.full = unit.base + unit.diacritics.join("");
      units.push(unit);
    }

    return units;
  };

  const renderHighlightedText = (text1, text2) => {
    const units1 = groupUnits(text1); // original
    const units2 = groupUnits(text2); // modified
    const maxLength = Math.max(units1.length, units2.length);

    // Identify which units are different
    const differences = new Set();

    for (let i = 0; i < maxLength; i++) {
      const unit1 = units1[i];
      const unit2 = units2[i];

      if (!unit1 || !unit2 || unit1.full !== unit2.full) {
        differences.add(i);
      }
    }

    // Create segments with inline styling - show modified text (text2)
    const segments = [];
    let currentSegment = { text: "", isDifferent: false };

    for (let i = 0; i < maxLength; i++) {
      const unit2 = units2[i]; // Use modified text
      const isDifferent = differences.has(i);

      if (!unit2) break;

      if (isDifferent !== currentSegment.isDifferent && currentSegment.text) {
        segments.push({ ...currentSegment });
        currentSegment = { text: "", isDifferent };
      }

      currentSegment.text += unit2.full;
      currentSegment.isDifferent = isDifferent;
    }

    if (currentSegment.text) {
      segments.push(currentSegment);
    }

    // Render as a single Text component with nested Text elements for highlighting
    return (
      <Text style={styles.word}>
        {segments.map((segment, index) => (
          <Text
            key={index}
            style={segment.isDifferent ? styles.differentChar : null}
          >
            {segment.text}
          </Text>
        ))}
      </Text>
    );
  };

  return (
    <View style={styles.inlineContainer}>
      {renderHighlightedText(originalText, inputText)}
    </View>
  );
};

const styles = StyleSheet.create({
  inlineContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  word: {
    fontSize: 22,
    color: "#1a1a1a",
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
    fontWeight: "500",
    writingDirection: "rtl",
    letterSpacing: 0.3,
  },
  differentChar: {
    backgroundColor: "#ffb366",
    borderRadius: 2,
  },
});

export default InlineComparison;
