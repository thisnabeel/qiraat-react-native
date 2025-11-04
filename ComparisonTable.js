import React from "react";
import { View, Text, StyleSheet } from "react-native";

const ComparisonTable = ({ originalText, inputText }) => {
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
    const units1 = groupUnits(text1);
    const units2 = groupUnits(text2);
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

    // Create segments
    const segments = [];
    let currentSegment = { text: "", isDifferent: false };

    for (let i = 0; i < maxLength; i++) {
      const unit1 = units1[i];
      const isDifferent = differences.has(i);

      if (!unit1) break;

      if (isDifferent !== currentSegment.isDifferent && currentSegment.text) {
        segments.push({ ...currentSegment });
        currentSegment = { text: "", isDifferent };
      }

      currentSegment.text += unit1.full;
      currentSegment.isDifferent = isDifferent;
    }

    if (currentSegment.text) {
      segments.push(currentSegment);
    }

    return segments.map((segment, index) => (
      <Text
        key={index}
        style={[
          styles.comparisonChar,
          segment.isDifferent && styles.differentChar,
        ]}
      >
        {segment.text}
      </Text>
    ));
  };

  return (
    <View style={styles.comparisonTable}>
      <View style={styles.comparisonRow}>
        <View style={styles.comparisonColumn}>
          <Text style={styles.comparisonLabel}>Hafs 'an 'Asim</Text>
          <Text style={styles.comparisonText}>
            {renderHighlightedText(originalText, inputText)}
          </Text>
        </View>

        <View style={styles.arrowContainer}>
          <Text style={styles.arrow}>→</Text>
        </View>

        <View style={styles.comparisonColumn}>
          <Text style={styles.comparisonLabel}></Text>
          <Text style={styles.comparisonText}>
            {renderHighlightedText(inputText, originalText)}
          </Text>
        </View>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  comparisonTable: {
    marginTop: 16,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    backgroundColor: "#f9f9f9",
  },
  comparisonRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  comparisonColumn: {
    flex: 1,
  },
  comparisonLabel: {
    fontSize: 12,
    fontWeight: "600",
    color: "#666",
    marginBottom: 4,
  },
  comparisonText: {
    fontSize: 16,
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
    writingDirection: "rtl",
    textAlign: "right",
  },
  comparisonChar: {
    fontSize: 16,
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
    writingDirection: "rtl",
  },
  differentChar: {
    backgroundColor: "#ffb366",
    borderRadius: 2,
    paddingHorizontal: 1,
    paddingVertical: 0,
    lineHeight: undefined,
  },
  arrowContainer: {
    paddingHorizontal: 8,
  },
  arrow: {
    fontSize: 18,
    color: "#666",
    fontWeight: "bold",
  },
});

export default ComparisonTable;
