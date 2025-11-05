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

    // Identify which units are different, ignoring dots in text2 for alignment
    const differences = new Set();
    
    // Compare units, skipping dots in text2
    let text2Index = 0;
    for (let i = 0; i < units1.length; i++) {
      const unit1 = units1[i];
      
      // Skip dots in text2 when comparing
      while (text2Index < units2.length && 
             (units2[text2Index].base === "." || units2[text2Index].base === "٫")) {
        text2Index++; // Dots are never marked as different, they're just visual markers
      }
      
      if (text2Index >= units2.length) {
        // text2 is shorter, mark remaining units in text1 as different
        for (let j = i; j < units1.length; j++) {
          // This handles cases where text1 is longer
        }
        break;
      }
      
      const unit2 = units2[text2Index];
      
      // Compare the units (dots are already skipped)
      if (!unit1 || !unit2 || unit1.full !== unit2.full) {
        differences.add(text2Index); // Mark the letter unit as different, not the dot
      }
      
      text2Index++;
    }
    
    // Also handle extra units in text2 (if text2 is longer)
    while (text2Index < units2.length) {
      const unit2 = units2[text2Index];
      // Skip dots - they're never marked as different
      if (unit2.base !== "." && unit2.base !== "٫") {
        differences.add(text2Index);
      }
      text2Index++;
    }

    // Render each unit from text2, checking if it's followed by a dot
    const elements = [];
    for (let i = 0; i < units2.length; i++) {
      const unit2 = units2[i];
      const nextUnit = units2[i + 1];
      const isDifferent = differences.has(i);
      const isDot = unit2.base === "." || unit2.base === "٫";
      const isFollowedByDot = nextUnit && (nextUnit.base === "." || nextUnit.base === "٫");
      
      // Check if this is an Arabic letter (not a diacritic, not a dot, not other punctuation)
      const isArabicLetter = !isDiacritic(unit2.base) && !isDot && 
        unit2.base.charCodeAt(0) >= 0x0600 && 
        (unit2.base.charCodeAt(0) <= 0x06FF || 
         (unit2.base.charCodeAt(0) >= 0x0750 && unit2.base.charCodeAt(0) <= 0x077F) ||
         (unit2.base.charCodeAt(0) >= 0x08A0 && unit2.base.charCodeAt(0) <= 0x08FF) ||
         (unit2.base.charCodeAt(0) >= 0xFB50 && unit2.base.charCodeAt(0) <= 0xFDFF) ||
         (unit2.base.charCodeAt(0) >= 0xFE70 && unit2.base.charCodeAt(0) <= 0xFEFF));
      
      if (isArabicLetter && isFollowedByDot) {
        // Render letter with red dot underneath
        elements.push(
          <View key={i} style={styles.letterWithDotInline}>
            <Text style={[styles.word, isDifferent ? styles.differentChar : null]}>
              {unit2.full}
            </Text>
            <View style={styles.redDotContainerInline}>
              <View style={styles.redDotInline} />
            </View>
          </View>
        );
        // Skip the next dot unit
        i++;
      } else if (isDot) {
        // Skip standalone dots - they're never highlighted, they're just visual markers
        // The dot is already rendered as a red dot underneath the preceding letter
        continue;
      } else {
        // Regular unit
        elements.push(
          <Text key={i} style={[styles.word, isDifferent ? styles.differentChar : null]}>
            {unit2.full}
          </Text>
        );
      }
    }

    // Render as a View with Text and View elements
    return (
      <View style={styles.inlineContainer}>
        {elements}
      </View>
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
    flexDirection: "row-reverse",
    alignItems: "center",
    flexWrap: "wrap",
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
  letterWithDotInline: {
    alignItems: "center",
    justifyContent: "flex-start",
    marginHorizontal: 0.5,
    position: "relative",
  },
  redDotContainerInline: {
    position: "absolute",
    bottom: -4,
    left: 0,
    right: 0,
    alignItems: "center",
    justifyContent: "center",
  },
  redDotInline: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff0000",
  },
});

export default InlineComparison;
