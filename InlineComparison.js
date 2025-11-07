import React, { useState, useRef } from "react";
import { View, Text, StyleSheet } from "react-native";

const InlineComparison = ({ originalText, inputText }) => {
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

  const renderHighlightedText = (text1, text2) => {
    // text1 = inputText (what we're displaying), text2 = originalText (for comparison)
    // This matches ComparisonTable's "Tweaked" section which shows inputText compared to originalText
    const units1 = groupUnits(text1); // inputText (what we're showing)
    const units2 = groupUnits(text2); // originalText (for comparison)

    // Identify which units are different - match ComparisonTable logic EXACTLY
    const maxLength = Math.max(units1.length, units2.length);
    const differences = new Set();

    // Simple unit-by-unit comparison - match ComparisonTable exactly
    for (let i = 0; i < maxLength; i++) {
      const unit1 = units1[i];
      const unit2 = units2[i];

      if (!unit1 || !unit2 || unit1.full !== unit2.full) {
        differences.add(i);
      }
    }

    // Build continuous text segments - match ComparisonTable logic exactly
    // But also handle red dots for letters followed by dots
    const segments = [];
    let currentSegment = { text: "", isDifferent: false, hasDots: [] };
    
    // Render units1 (inputText) - this matches ComparisonTable which renders text1
    for (let i = 0; i < units1.length; i++) {
      const unit1 = units1[i];
      const nextUnit = units1[i + 1];
      const isDifferent = differences.has(i);
      const isDot = unit1.base === "." || unit1.base === "٫";
      const isFollowedByDot = nextUnit && (nextUnit.base === "." || nextUnit.base === "٫");
      
      // Check if this is an Arabic letter
      const isArabicLetter = !isDiacritic(unit1.base) && !isDot && 
        unit1.base.charCodeAt(0) >= 0x0600 && 
        (unit1.base.charCodeAt(0) <= 0x06FF || 
         (unit1.base.charCodeAt(0) >= 0x0750 && unit1.base.charCodeAt(0) <= 0x077F) ||
         (unit1.base.charCodeAt(0) >= 0x08A0 && unit1.base.charCodeAt(0) <= 0x08FF) ||
         (unit1.base.charCodeAt(0) >= 0xFB50 && unit1.base.charCodeAt(0) <= 0xFDFF) ||
         (unit1.base.charCodeAt(0) >= 0xFE70 && unit1.base.charCodeAt(0) <= 0xFEFF));
      
      // Skip dot units (they're handled visually as red dots)
      if (isDot) {
        continue;
      }
      
      // Check if highlight state changed - match ComparisonTable logic
      if (isDifferent !== currentSegment.isDifferent && currentSegment.text) {
        segments.push({ ...currentSegment });
        currentSegment = { text: "", isDifferent, hasDots: [] };
      }
      
      // Add this unit to current segment - match ComparisonTable
      currentSegment.text += unit1.full;
      currentSegment.isDifferent = isDifferent;
      
      // If this letter is followed by a dot, mark its position for red dot placement
      if (isArabicLetter && isFollowedByDot) {
        // Mark the character position where the dot should appear
        currentSegment.hasDots.push(currentSegment.text.length - unit1.full.length);
        // Skip the dot unit
        i++;
      }
    }
    
    // Add remaining segment
    if (currentSegment.text) {
      segments.push(currentSegment);
    }

    // Build text with inline markers for dots - use a hybrid approach
    // Render continuous text but mark letter positions for dots
    const allDotPositions = [];
    let currentTextOffset = 0;
    
    // Calculate character positions accounting for actual text content
    segments.forEach((segment) => {
      if (segment.hasDots.length > 0) {
        // For each dot position in this segment, calculate the actual character position
        segment.hasDots.forEach((charIndexInSegment) => {
          // Count actual characters up to this point in the segment
          const textUpToDot = segment.text.substring(0, charIndexInSegment + 1);
          allDotPositions.push({
            charCount: currentTextOffset + textUpToDot.length,
            segmentIndex: segments.indexOf(segment),
          });
        });
      }
      currentTextOffset += segment.text.length;
    });

    // Render all text segments as nested Text components (like ComparisonTable)
    // This keeps Arabic text continuous
    const textElements = segments.map((segment, index) => (
      <Text
        key={index}
        style={[styles.word, segment.isDifferent ? styles.differentChar : null]}
      >
        {segment.text}
      </Text>
    ));

    // Calculate dot positions based on character positions
    // For RTL text, we need to position from right
    const calculateDotPosition = (charIndex, totalLength) => {
      if (!textLayout || totalLength === 0) {
        // Fallback approximation: average character width for fontSize 22 is ~14px
        return (totalLength - charIndex - 1) * 14;
      }
      // Calculate position from right (RTL)
      const charWidth = textLayout.width / totalLength;
      return (totalLength - charIndex - 1) * charWidth;
    };

    const totalTextLength = segments.reduce((sum, seg) => sum + seg.text.length, 0);

    return (
      <View style={styles.inlineContainer}>
        <View style={styles.textWithDotsWrapper}>
          <Text
            ref={textRef}
            style={styles.word}
            onLayout={(event) => {
              const { width, height } = event.nativeEvent.layout;
              setTextLayout({ width, height });
            }}
          >
            {textElements}
          </Text>
          {allDotPositions.map((dotInfo, dotIndex) => {
            const dotRight = calculateDotPosition(dotInfo.charCount - 1, totalTextLength);
            return (
              <View
                key={`dot-${dotIndex}`}
                style={[
                  styles.redDotContainerInline,
                  { right: dotRight },
                ]}
              >
                <View style={styles.redDotInline} />
              </View>
            );
          })}
        </View>
      </View>
    );
  };

  return (
    <View style={styles.inlineContainer}>
      {renderHighlightedText(inputText, originalText)}
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
  textWithDotsWrapper: {
    position: "relative",
  },
  redDotContainerInline: {
    position: "absolute",
    bottom: -4,
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
