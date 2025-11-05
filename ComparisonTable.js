import React, { useState, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";

const ComparisonTable = ({ originalText, inputText }) => {
  const textRef = useRef(null);
  const [textLayout, setTextLayout] = useState(null);
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

  // Check if character is an Arabic letter
  const isArabicLetter = (char) => {
    if (isDiacritic(char)) return false;
    const code = char.charCodeAt(0);
    return (
      (code >= 0x0600 && code <= 0x06FF) ||
      (code >= 0x0750 && code <= 0x077F) ||
      (code >= 0x08A0 && code <= 0x08FF) ||
      (code >= 0xFB50 && code <= 0xFDFF) ||
      (code >= 0xFE70 && code <= 0xFEFF)
    );
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

    // Create segments with dot markers
    const segments = [];
    let currentSegment = { text: "", isDifferent: false, hasDots: [] };

    for (let i = 0; i < units1.length; i++) {
      const unit1 = units1[i];
      const nextUnit = units1[i + 1];
      const isDifferent = differences.has(i);
      const isDot = unit1.base === "." || unit1.base === "٫";
      const isFollowedByDot = nextUnit && (nextUnit.base === "." || nextUnit.base === "٫");

      // Skip dot units
      if (isDot) {
        continue;
      }

      // Check if highlight state changed
      if (isDifferent !== currentSegment.isDifferent && currentSegment.text) {
        segments.push({ ...currentSegment });
        currentSegment = { text: "", isDifferent, hasDots: [] };
      }

      // Add unit to segment
      const charIndexInSegment = currentSegment.text.length;
      currentSegment.text += unit1.full;
      currentSegment.isDifferent = isDifferent;

      // Mark letter position for dot if followed by dot
      if (isArabicLetter(unit1.base) && isFollowedByDot) {
        currentSegment.hasDots.push(charIndexInSegment);
        // Skip the dot unit
        i++;
      }
    }

    if (currentSegment.text) {
      segments.push(currentSegment);
    }

    // Render segments with dots positioned absolutely
    const textElements = segments.map((segment, index) => (
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

    // Calculate dot positions
    const allDotPositions = [];
    let textOffset = 0;
    segments.forEach((segment) => {
      if (segment.hasDots.length > 0) {
        segment.hasDots.forEach((charIndex) => {
          allDotPositions.push({
            charCount: textOffset + charIndex + 1,
          });
        });
      }
      textOffset += segment.text.length;
    });

    const totalTextLength = segments.reduce((sum, seg) => sum + seg.text.length, 0);

    const calculateDotPosition = (charIndex, totalLength) => {
      if (!textLayout || totalLength === 0) {
        // Fallback: average character width for fontSize 16 is ~12px
        return (totalLength - charIndex) * 12;
      }
      const charWidth = textLayout.width / totalLength;
      return (totalLength - charIndex) * charWidth;
    };

    return (
      <View style={styles.comparisonTextWrapper}>
        <Text
          ref={textRef}
          style={styles.comparisonText}
          onLayout={(event) => {
            const { width, height } = event.nativeEvent.layout;
            setTextLayout({ width, height });
          }}
        >
          {textElements}
        </Text>
        {allDotPositions.map((dotInfo, dotIndex) => {
          const dotRight = calculateDotPosition(dotInfo.charCount, totalTextLength);
          return (
            <View
              key={`dot-${dotIndex}`}
              style={[
                styles.redDotContainerComparison,
                { right: dotRight },
              ]}
            >
              <View style={styles.redDotComparison} />
            </View>
          );
        })}
      </View>
    );
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
          <Text style={styles.comparisonLabel}>Tweaked</Text>
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
  comparisonTextWrapper: {
    position: "relative",
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
  redDotContainerComparison: {
    position: "absolute",
    bottom: -4,
    alignItems: "center",
    justifyContent: "center",
  },
  redDotComparison: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff0000",
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
