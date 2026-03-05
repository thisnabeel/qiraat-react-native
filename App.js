import React, { useState, useEffect, useRef, useMemo, useCallback } from "react";
import { useFonts } from "expo-font";
import {
  StyleSheet,
  View,
  Text,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal,
  Dimensions,
  SafeAreaView,
  Animated,
  Easing,
} from "react-native";
import { SafeAreaProvider, SafeAreaView as SafeAreaViewEdged } from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import PagerView from "react-native-pager-view";
import { Slider } from "@miblanchard/react-native-slider";
import ComparisonTable from "./ComparisonTable";
import InlineComparison from "./InlineComparison";
import segmentsData from "./segments.json";
import QiraatSettingsModal from "./components/QiraatSettingsModal";
import ShubahWordAudioButton from "./components/ShubahWordAudioButton";
import VariationBottomSheet from "./components/VariationBottomSheet";
import { getWordSegmentForText } from "./components/shubahTimestamps";
import { Search, Sidebar, Bookmark } from "react-native-feather";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://qiraat-api-v2-production.up.railway.app";
// const API_BASE = "http://localhost:3000";
const NARRATORS_URL = `${API_BASE}/api/narrators`;
const VARIATIONS_URL = `${API_BASE}/api/variations`;

// Font by mushaf: 2 = 13 Liner IndoPak (AswaatOne), 3 = 15 Liner Uthmani (Uthmani)
const getQuranFontFamily = (mushafId) => (mushafId === 3 ? "DigitalKhattV2" : "AswaatOne");
const QURAN_FONT_FAMILY = "DigitalKhattV2"; // default for styles; use getQuranFontFamily(mushafId) for page content

// Manual font size and line height per mushaf (set to null to use style defaults)
const MUSHAF_2_FONT_SIZE = null;   // 13 Liner IndoPak — set number to override (e.g. 22)
const MUSHAF_2_LINE_HEIGHT = null; // 13 Liner IndoPak — set number to override (e.g. 44)
const MUSHAF_3_FONT_SIZE = 20;   // 15 Liner Uthmani — set number to override (e.g. 24)
const MUSHAF_3_LINE_HEIGHT = 40; // 15 Liner Uthmani — set number to override (e.g. 46)
const getMushafFontSize = (mushafId) => (mushafId === 2 ? MUSHAF_2_FONT_SIZE : MUSHAF_3_FONT_SIZE);
const getMushafLineHeight = (mushafId) => (mushafId === 2 ? MUSHAF_2_LINE_HEIGHT : MUSHAF_3_LINE_HEIGHT);

// Recite tab: extra padding below the Hafs|Shubah bar (above safe area). Reduce if the last line of mushaf gets cut off; increase if the bar feels too tight.
const RECITE_BOTTOM_BAR_PADDING_BOTTOM = -18;

const HELPER_FONT_FAMILY = "AswaatHelpers";

// Helper function to render highlighted text (extracted from ComparisonTable logic)
const renderHighlightedText = (text1, text2, wordStyle, differentCharStyle) => {
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
      style={[wordStyle, segment.isDifferent && differentCharStyle]}
    >
      {segment.text}
    </Text>
  ));
};

const Line = ({
  words,
  onWordPress,
  selectedWordId,
  savedVariations,
  selectedNarrators,
  allVariations = {},
  isFirstLineOfJuz = false,
  isDarkMode = false,
  mushafId = 3,
}) => {
  const wordRefs = useRef({});
  const lineStyle = [styles.line];
  const wordStyle = [styles.word];
  let inlineTextStyle = undefined;

  // Border between lines: only for mushaf 2 (13 Liner IndoPak); none for mushaf 3 (15 Liner Uthmani)
  if (mushafId === 2) {
    lineStyle.push(styles.lineWithBorder);
    if (isDarkMode) lineStyle.push(styles.lineWithBorderDark);
  }

  if (isDarkMode) {
    lineStyle.push(styles.lineDark);
    wordStyle.push(styles.wordDark);
  }

  if (isFirstLineOfJuz) {
    if (isDarkMode) {
      lineStyle.push(styles.firstLineOfJuzDark);
      wordStyle.push(styles.firstLineOfJuzDarkText);
      inlineTextStyle = styles.firstLineOfJuzDarkText;
    } else {
      lineStyle.push(styles.firstLineOfJuz);
      wordStyle.push(styles.firstLineOfJuzText);
      inlineTextStyle = styles.firstLineOfJuzText;
    }
  }

  wordStyle.push({ fontFamily: getQuranFontFamily(mushafId) });

  const fontSize = getMushafFontSize(mushafId);
  const lineHeight = getMushafLineHeight(mushafId);
  if (fontSize != null) wordStyle.push({ fontSize });
  if (lineHeight != null) {
    wordStyle.push({ lineHeight });
    lineStyle.push({ minHeight: lineHeight });
  }

  return (
    <View style={lineStyle}>
      {words.map((word, index) => {
        let contentToRender = <Text style={wordStyle}>{word.content}</Text>;

        // Find a saved variation for this word from selected narrators
        // Only show variation if it's both in allVariations AND in savedVariations
        // This ensures deleted variations don't show even if they're temporarily in allVariations
        const matchingVariation = Object.entries(allVariations).find(
          ([variationKey, variation]) => {
            const [wordIdFromKey, narratorIdFromKey] = variationKey.split("-");
            const isWordMatch = wordIdFromKey === word.id.toString();
            const isSaved = savedVariations.includes(variationKey);
            const isNarratorSelected = selectedNarrators.includes(
              parseInt(narratorIdFromKey)
            );

            // Must be saved AND narrator selected to show variation
            // If deleted, it won't be in savedVariations, so original text will show
            return isWordMatch && isSaved && isNarratorSelected;
          }
        );

        if (matchingVariation && matchingVariation[1]) {
          const variationContent = matchingVariation[1];
          contentToRender = (
            <InlineComparison
              originalText={word.content}
              inputText={variationContent}
              fontFamily={getQuranFontFamily(mushafId)}
              textStyle={inlineTextStyle}
            />
          );
        }

        return (
          <Pressable
            key={`${word.id}-${index}`}
            ref={(ref) => (wordRefs.current[word.id] = ref)}
            onLongPress={() => {
              // Measure the word's absolute position
              const ref = wordRefs.current[word.id];
              if (ref && ref.measure) {
                ref.measure((x, y, width, height, pageX, pageY) => {
                  word.layout = { x: pageX, y: pageY, width, height };
                  // Attach simple line context so audio matching can use nearby words
                  const wordWithContext = {
                    ...word,
                    lineWords: words,
                  };
                  onWordPress(wordWithContext);
                });
              }
            }}
            delayLongPress={500}
            cancelable={true}
            style={({ pressed }) => [
              styles.wordPressable,
              pressed && styles.wordPressed,
              selectedWordId === word.id && styles.wordSelected,
            ]}
          >
            {contentToRender}
          </Pressable>
        );
      })}
    </View>
  );
};

const PageView = ({
  page,
  onWordPress,
  selectedWordId,
  loading,
  savedVariations,
  selectedNarrators,
  allVariations,
  highlightFirstLine = false,
  isDarkMode = false,
  mushafId = 3,
}) => {

  if (loading) {
    const containerStyle = isDarkMode
      ? [styles.container, styles.containerDark]
      : styles.container;
    const pageContentStyle = isDarkMode
      ? [styles.pageContent, styles.pageContentDark]
      : styles.pageContent;

    return (
      <View style={containerStyle}>
        <View style={pageContentStyle}>
          <ActivityIndicator size="large" color={isDarkMode ? "#fff" : "#000"} />
          <Text
            style={[
              styles.loadingText,
              isDarkMode && styles.loadingTextDark,
            ]}
          >
            Loading page...
          </Text>
        </View>
      </View>
    );
  }

  if (!page || !page.lines) {
    const containerStyle = isDarkMode
      ? [styles.container, styles.containerDark]
      : styles.container;
    const pageContentStyle = isDarkMode
      ? [styles.pageContent, styles.pageContentDark]
      : styles.pageContent;

    return (
      <View style={containerStyle}>
        <View style={pageContentStyle}>
          <Text
            style={[
              styles.errorText,
              isDarkMode && styles.errorTextDark,
            ]}
          >
            No page data available
          </Text>
        </View>
      </View>
    );
  }

  const containerStyle = isDarkMode
    ? [styles.container, styles.containerDark]
    : styles.container;
  const pageContentStyle = isDarkMode
    ? [styles.pageContent, styles.pageContentDark]
    : styles.pageContent;

  return (
    <View style={containerStyle}>
      <View style={pageContentStyle}>
        {page.lines.map((line, lineIndex) => (
          <Line
            key={line.id}
            words={line.words}
            onWordPress={onWordPress}
            selectedWordId={selectedWordId}
            savedVariations={savedVariations}
            selectedNarrators={selectedNarrators}
            allVariations={allVariations}
            isFirstLineOfJuz={highlightFirstLine && lineIndex === 0}
            isDarkMode={isDarkMode}
            mushafId={mushafId}
          />
        ))}
      </View>
    </View>
  );
};

// Component to render Arabic text with red dots underneath letters followed by dots
// Uses text measurement for accurate dot positioning
const ArabicTextWithDots = ({ text }) => {
  const textRef = useRef(null);
  const [textLayout, setTextLayout] = useState(null);
  
  const diacritics = ["َ", "ِ", "ُ", "ْ", "ً", "ٍ", "ٌ", "ّ", "ٰ", "ٖ", "ٗ", "٘", "ٙ", "ٚ", "ٛ", "ٜ", "ٝ", "ٞ", "ٟ"];
  
  const isDiacritic = (char) => diacritics.includes(char);
  
  // Arabic Unicode ranges for letters (excluding diacritics)
  const isArabicLetter = (char) => {
    if (isDiacritic(char)) return false;
    const code = char.charCodeAt(0);
    return (
      (code >= 0x0600 && code <= 0x06FF) || // Arabic block
      (code >= 0x0750 && code <= 0x077F) || // Arabic Supplement
      (code >= 0x08A0 && code <= 0x08FF) || // Arabic Extended-A
      (code >= 0xFB50 && code <= 0xFDFF) || // Arabic Presentation Forms-A
      (code >= 0xFE70 && code <= 0xFEFF)    // Arabic Presentation Forms-B
    );
  };

  // Remove dots from text and track letter positions for dots
  const chars = text.split("");
  let displayText = "";
  const lettersWithDots = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextChar = chars[i + 1];
    
    if (char === "." || char === "٫") {
      // Skip dot characters - they're handled visually
      continue;
    }
    
    // Check if this letter is followed by a dot
    if (isArabicLetter(char) && (nextChar === "." || nextChar === "٫")) {
      // Track this letter position for dot placement
      lettersWithDots.push(displayText.length);
      displayText += char;
      
      // Skip the dot character
      i++;
    } else {
      displayText += char;
    }
  }

  // Calculate dot positions based on measured text width
  const calculateDotPosition = (letterIndex, totalLength) => {
    if (!textLayout || totalLength === 0) {
      // Fallback: average character width for fontSize 16 is ~12px
      return (totalLength - letterIndex - 1) * 12;
    }
    // Calculate position from right (RTL)
    const charWidth = textLayout.width / totalLength;
    return (totalLength - letterIndex - 1) * charWidth;
  };

  // Render as one continuous text block with absolutely positioned dots
  return (
    <View style={styles.renderedTextWrapper}>
      <Text
        ref={textRef}
        style={styles.renderedText}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setTextLayout({ width, height });
        }}
      >
        {displayText}
      </Text>
      {lettersWithDots.map((letterIndex, dotIndex) => {
        const dotRight = calculateDotPosition(letterIndex, displayText.length);
        return (
          <View
            key={`dot-${dotIndex}`}
            style={[
              styles.redDotAbsolute,
              { right: dotRight },
            ]}
          >
            <View style={styles.redDot} />
          </View>
        );
      })}
    </View>
  );
};

const NarratorPopup = ({
  visible,
  onClose,
  narrators,
  selectedNarrator,
  onSelectNarrator,
  inputValue,
  onInputChange,
  position,
  selectedWord,
  savedVariations,
  allVariations = {},
  onSaveVariation,
  onDeleteVariation,
  mushafId = 3,
  currentSurahNumber,
  isShubahHighlight = false,
}) => {
  const quranFont = getQuranFontFamily(mushafId);
  const [keyboardMode, setKeyboardMode] = useState("harakat"); // "harakat" or "letters"
  const [insertMode, setInsertMode] = useState("replace"); // "insertLeft", "replace", or "insertRight"
  const inputRef = useRef(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0); // Index of currently highlighted letter
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [isShaddaSelected, setIsShaddaSelected] = useState(false);
  const [isImalahSelected, setIsImalahSelected] = useState(false);
  const [longPressButton, setLongPressButton] = useState(null); // { char, tanweenChar, buttonIndex, position }
  const [longPressPosition, setLongPressPosition] = useState(null); // { x, y }
  const [dragStartY, setDragStartY] = useState(null);
  const [isHoveringTanween, setIsHoveringTanween] = useState(false);
  const [isHoveringShaddaTanween, setIsHoveringShaddaTanween] = useState(false);
  const [isHoveringSukoon, setIsHoveringSukoon] = useState(false);
  const [isHoveringStandingAlif, setIsHoveringStandingAlif] = useState(false);
  const [isHoveringDaggerAlifOnly, setIsHoveringDaggerAlifOnly] = useState(false);
  const [isHoveringDiamond, setIsHoveringDiamond] = useState(false);
  const [isHoveringImalahDot, setIsHoveringImalahDot] = useState(false);
  const [isHoveringHelperDiamondDot, setIsHoveringHelperDiamondDot] = useState(false);
  const [isHoveringSubscriptAlef, setIsHoveringSubscriptAlef] = useState(false);
  const [isHoveringMaddAlif, setIsHoveringMaddAlif] = useState(false);
  const [isHoveringMaddWaw, setIsHoveringMaddWaw] = useState(false);
  const [isHoveringMaddYa, setIsHoveringMaddYa] = useState(false);
  const [isHoveringMaddCombined, setIsHoveringMaddCombined] = useState(false);
  const [isHoveringInvertedDammah, setIsHoveringInvertedDammah] = useState(false);
  const [isHoveringExtenderHamzaDammah, setIsHoveringExtenderHamzaDammah] = useState(false);
  const [isHoveringExtenderHamzaKasrah, setIsHoveringExtenderHamzaKasrah] = useState(false);
  const [isHoveringExtenderHamzaFathah, setIsHoveringExtenderHamzaFathah] = useState(false);
  const [isHoveringMaddRoundedZero, setIsHoveringMaddRoundedZero] = useState(false);
  const buttonRefs = useRef({});
  const tanweenRefs = useRef({});
  const shaddaTanweenRefs = useRef({});
  const sukoonRefs = useRef({});
  const standingAlifRefs = useRef({});
  const daggerAlifOnlyRefs = useRef({});
  const diamondRefs = useRef({});
  const imalahDotRefs = useRef({});
  const maddAlifRefs = useRef({});
  const maddWawRefs = useRef({});
  const maddYaRefs = useRef({});
  const maddCombinedRefs = useRef({});
  const helperDiamondDotRefs = useRef({});
  const subscriptAlefRefs = useRef({});
  const invertedDammahRefs = useRef({});
  const extenderHamzaDammahRefs = useRef({});
  const extenderHamzaKasrahRefs = useRef({});
  const extenderHamzaFathahRefs = useRef({});
  const maddRoundedZeroRefs = useRef({});
  
  // Helper to get tanween version of a harakat
  const getTanweenVersion = (harakatChar) => {
    const tanweenMap = {
      "\u064E": "\u064B", // Fatha → Fathatan
      "\u064F": "\u064C", // Damma → Dammatan
      "\u0650": "\u064D", // Kasra → Kasratan
    };
    return tanweenMap[harakatChar] || null;
  };

  // Get letter positions in the text (accounting for diacritics)
  // Groups base letters with their following diacritics
  const getLetterPositions = (text) => {
    const positions = [];
    let letterIndex = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      // Check if it's a base letter (not a diacritic or diamond marker)
      if (!/[\u064B-\u065F\u0670\u06E4\u25C6]/.test(char)) {
        // Find the end position (after the base letter and any following diacritics)
        let end = i + 1;
        while (end < text.length) {
          const nextChar = text[end];
          if (/[\u064B-\u065F\u0670\u06E4\u25C6]/.test(nextChar)) {
            end++;
          } else {
            break;
          }
        }
        positions.push({
          index: letterIndex,
          start: i,
          end: end,
        });
        letterIndex++;
        i = end - 1; // Skip to after the diacritics
      }
    }
    return positions;
  };

  // Initialize history when popup opens or input changes externally
  useEffect(() => {
    if (visible && selectedNarrator) {
      // Reset history when popup opens
      const initialHistory = [inputValue];
      historyRef.current = initialHistory;
      historyIndexRef.current = 0;
      setHistory(initialHistory);
      setHistoryIndex(0);
      
      // Reset letter index to first letter or 0
      const letterPositions = getLetterPositions(inputValue);
      if (letterPositions.length > 0) {
        setCurrentLetterIndex(0);
      } else {
        setCurrentLetterIndex(0);
      }
    }
  }, [visible, selectedNarrator]);

  // Update letter index when input value changes - ensure it stays valid
  useEffect(() => {
    if (!inputValue || inputValue.length === 0) {
      if (currentLetterIndex !== 0) {
        setCurrentLetterIndex(0);
      }
      setIsShaddaSelected(false); // Deselect shadda when input changes
      setIsImalahSelected(false); // Deselect imalah when input changes
      return;
    }
    
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      if (currentLetterIndex !== 0) {
        setCurrentLetterIndex(0);
      }
      setIsShaddaSelected(false); // Deselect shadda when no letters
      setIsImalahSelected(false); // Deselect imalah when no letters
    } else {
      // Ensure index is within bounds
      const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
      if (validIndex !== currentLetterIndex) {
        setCurrentLetterIndex(validIndex);
        setIsShaddaSelected(false); // Deselect shadda when index changes
        setIsImalahSelected(false); // Deselect imalah when index changes
      }
    }
  }, [inputValue]); // Only depend on inputValue, not currentLetterIndex to avoid loops

  if (!visible || !position) return null;

  // Calculate intelligent positioning
  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;
  const popupHeight = 500; // Increased to accommodate keyboard
  const popupWidth = Math.min(screenWidth * 0.9, 400);

  // Always center the popup on screen
  const topPosition = (screenHeight - popupHeight) / 2;
  const leftPosition = (screenWidth - popupWidth) / 2;

  // Check if this variation is saved
  const variationKey =
    selectedWord && selectedNarrator
      ? `${selectedWord.id}-${selectedNarrator.id}`
      : null;
  const isSaved = variationKey ? savedVariations.includes(variationKey) : false;
  const savedValue = variationKey && allVariations[variationKey] ? allVariations[variationKey] : null;
  // Get the original word content to compare against when no variation is saved
  const originalWordContent = selectedWord ? selectedWord.content : "";
  // Has unsaved changes if: 
  // - (saved but input differs from saved value) OR 
  // - (not saved but input differs from original word content)
  const hasUnsavedChanges = (savedValue !== null && inputValue !== savedValue) || 
                            (savedValue === null && inputValue !== originalWordContent);
  // Green when: (saved and no changes) OR (not saved but matches original - no changes from default)
  const isSavedState = (isSaved && !hasUnsavedChanges) || (!isSaved && inputValue === originalWordContent);

  // Harakat (diacritics) - most common ones
  const harakat = [
    { char: "\u064E", name: "Fatha" },      // َ
    { char: "\u0650", name: "Kasra" },     // ِ
    { char: "\u064F", name: "Damma" },     // ُ
    { char: "\u0652", name: "Sukun" },     // ْ
    { char: "\u0651", name: "Shadda" },    // ّ
    { char: "\u0658", name: "ImalahDot" }, // ٘ (helper imalah dot)
    { char: "\u064B", name: "Fathatan" },   // ً
    { char: "\u064D", name: "Kasratan" },  // ٍ
    { char: "\u064C", name: "Dammatan" },  // ٌ
  ];

  // Arabic letters
  const arabicLetters = [
    "\u0640", // Tatweel (extended character/extender stem)
    "\u0627", "\u0628", "\u062A", "\u062B", "\u062C", "\u062D", "\u062E",
    "\u062F", "\u0630", "\u0631", "\u0632", "\u0633", "\u0634", "\u0635",
    "\u0636", "\u0637", "\u0638", "\u0639", "\u063A", "\u0641", "\u0642",
    "\u0643", "\u0644", "\u0645", "\u0646", "\u0647", "\u0648", "\u064A",
    "\u0623", "\u0625", "\u0622", "\u0624", "\u0626", "\u0621", // Hamza letters: أ إ آ ؤ ئ ء
    "\u0649", // ى - Yaa without dots and without hamza (alif maksura)
  ];

  // Helper: Get character at current letter index
  const getCharAtCurrentLetter = () => {
    if (inputValue.length === 0) return null;
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) {
      const pos = letterPositions[currentLetterIndex].start;
      if (pos >= 0 && pos < inputValue.length) {
        return inputValue[pos];
      }
    }
    return null;
  };

  // Helper: Remove all diacritics from a string
  const removeDiacritics = (str) => {
    if (!str) return '';
    // Remove combining diacritics (U+064B to U+065F, U+0670, U+06E4) and diamond marker (U+25C6)
    // Note: U+0640 (Tatweel) is treated as a base letter, not a diacritic
    return str.replace(/[\u064B-\u065F\u0670\u06E4\u25C6]/g, '');
  };

  // Helper: Get base letter (without diacritics) at current letter index
  const getBaseLetterAtCurrentLetter = () => {
    if (inputValue.length === 0) return null;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) {
      const pos = letterPositions[currentLetterIndex].start;
      const char = inputValue[pos];
      
      if (!char) return null;
      
      // Remove diacritics to get base letter
      const base = removeDiacritics(char);
      
      // Check if it's an Arabic letter (excluding diacritics)
      const arabicLetterRegex = /[\u0621-\u063A\u0640\u0641-\u064A\u0671-\u06D3]/;
      if (base && arabicLetterRegex.test(base)) {
        return base;
      }
    }
    return null;
  };

  // Generate harakat variations for a letter
  const getHarakatVariations = (baseLetter) => {
    if (!baseLetter) return [];
    // Tanween is now handled via long-press popup, so we don't include it in the main buttons
    const tanweenChars = ["\u064B", "\u064D", "\u064C"]; // Fathatan, Kasratan, Dammatan
    return harakat
      .filter((h) => !tanweenChars.includes(h.char))
      .map((h) => baseLetter + h.char);
  };

  // Add to history
  const addToHistory = (value) => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(value);
    // Limit history to 50 items
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      historyIndexRef.current = newHistory.length - 1;
    }
    historyRef.current = newHistory;
    setHistory(newHistory);
    setHistoryIndex(historyIndexRef.current);
  };

  // Handle undo
  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const previousValue = historyRef.current[historyIndexRef.current];
      setHistoryIndex(historyIndexRef.current);
      onInputChange(previousValue);
      // Reset cursor to end
      setTimeout(() => {
        if (inputRef.current) {
          const cursorPos = previousValue.length;
          inputRef.current.setNativeProps({
            selection: { start: cursorPos, end: cursorPos },
          });
          setSelection({ start: cursorPos, end: cursorPos });
        }
      }, 0);
    }
  };

  // Handle diamond press - replace all diacritics with only diamond marker
  const handleDiamondPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Use a special marker character for diamond (we'll render it as SVG in display)
    // Using U+25C6 (◆) as marker, but we'll render it specially
    const diamondMarker = "\u25C6"; // Black diamond, we'll style it red in rendering
    
    // Replace all diacritics with only the diamond marker
    const newDiacritics = diamondMarker;
    
    // Replace the letter with base letter + diamond marker
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd alif press - add alif after letter with fathah
  const handleMaddAlifPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const alifChar = "\u0627"; // Alif
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    
    // Insert alif after the letter (after diacritics)
    const newValue = 
      inputValue.slice(0, letterEnd) + 
      alifChar + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd waw press - add waw after letter with fathah
  const handleMaddWawPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const wawChar = "\u0648"; // Waw
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    
    // Insert waw after the letter (after diacritics)
    const newValue = 
      inputValue.slice(0, letterEnd) + 
      wawChar + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle inverted dammah press - replace dammah with U+0657 (inverted dammah)
  const handleInvertedDammahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const dammaChar = "\u064F"; // Dammah
    const invertedDammahChar = "\u0657"; // Inverted dammah (U+0657)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Replace dammah with inverted dammah, or add inverted dammah if dammah not present
    let newDiacritics = existingDiacritics;
    if (newDiacritics.includes(dammaChar)) {
      // Replace dammah with inverted dammah
      newDiacritics = newDiacritics.replace(dammaChar, invertedDammahChar);
    } else if (!newDiacritics.includes(invertedDammahChar)) {
      // Add inverted dammah if not already present and no dammah to replace
      newDiacritics = newDiacritics + invertedDammahChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Dammah press (U+0640 + U+0654 + U+064F)
  const handleExtenderHamzaDammahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const dammaChar = "\u064F"; // Dammah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and dammah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(dammaChar)) {
      newDiacritics = newDiacritics + dammaChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Kasrah press (U+0640 + U+0654 + U+0650)
  const handleExtenderHamzaKasrahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const kasraChar = "\u0650"; // Kasrah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and kasrah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(kasraChar)) {
      newDiacritics = newDiacritics + kasraChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Fathah press (U+0640 + U+0654 + U+064E)
  const handleExtenderHamzaFathahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const fathaChar = "\u064E"; // Fathah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and fathah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = newDiacritics + fathaChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd rounded zero press (U+06E4)
  const handleMaddRoundedZeroPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E4\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const maddRoundedZeroChar = "\u06E4"; // Arabic Small High Rounded Zero (U+06E4)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add madd rounded zero if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(maddRoundedZeroChar)) {
      newDiacritics = newDiacritics + maddRoundedZeroChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd combined press - add U+0653 only
  const handleMaddCombinedPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const maddahChar = "\u0653"; // Maddah above (U+0653)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add maddah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(maddahChar)) {
      newDiacritics = newDiacritics + maddahChar;
    }
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd ya press - add ya after letter with fathah
  const handleMaddYaPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const yaChar = "\u064A"; // Ya
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    
    // Insert ya after the letter (after diacritics)
    const newValue = 
      inputValue.slice(0, letterEnd) + 
      yaChar + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle dagger alif press (without fathah) - replace all diacritics with only dagger alif
  const handleDaggerAlifOnlyPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
    
    // Replace all diacritics with only the dagger alif
    const newDiacritics = daggerAlifChar;
    
    // Replace the letter with base letter + only dagger alif
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Helper function to replace diacritics with a helper font character
  const handleHelperDotPress = (helperChar) => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Get existing harakat (kasrah in this case)
    const kasraChar = "\u0650"; // Kasrah
    // Replace diacritics with kasrah + helper character
    const newDiacritics = kasraChar + helperChar;
    
    // Replace the letter with base letter + kasrah + helper character
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle imalah dot press - adds only imalah dot from helper font (no other diacritics)
  const handleImalahDotPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0658 for imalah dot - only add the helper character, no kasrah
    const imalahDotChar = "\u0658"; // ARABIC SMALL HIGH NOON
    const newDiacritics = imalahDotChar;
    
    // Replace the letter with base letter + only imalah dot
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle helper diamond dot press - adds only diamond dot from helper font (no other diacritics)
  const handleHelperDiamondDotPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0659 for helper diamond dot - only add the helper character, no kasrah
    const helperDiamondDotChar = "\u0659"; // ARABIC PLACE OF SAJDAH
    const newDiacritics = helperDiamondDotChar;
    
    // Replace the letter with base letter + only helper diamond dot
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle subscript alef press - adds only subscript alef from helper font (no other diacritics)
  const handleSubscriptAlefPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0656 for subscript alef - only add the helper character, no kasrah
    const subscriptAlefChar = "\u0656"; // ARABIC SUBSCRIPT ALEF
    const newDiacritics = subscriptAlefChar;
    
    // Replace the letter with base letter + only subscript alef
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle dagger alif press - insert dagger alif as diacritic after fathah
  const handleStandingAlifPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
    const fathaChar = "\u064E"; // Fathah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present, then add dagger alif after it
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      // If no fathah, add it first
      newDiacritics = fathaChar + newDiacritics;
    }
    
    // Add dagger alif if not already present
    if (!newDiacritics.includes(daggerAlifChar)) {
      // Insert dagger alif after fathah
      const fathaIndex = newDiacritics.indexOf(fathaChar);
      if (fathaIndex !== -1) {
        newDiacritics = newDiacritics.slice(0, fathaIndex + 1) + daggerAlifChar + newDiacritics.slice(fathaIndex + 1);
      } else {
        newDiacritics = newDiacritics + daggerAlifChar;
      }
    }
    
    // Replace the letter with base letter + new diacritics
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle harakat variation press - replace only the harakat, keep the base letter
  const handleHarakatPress = (variation) => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    // Extract the harakat from the variation (everything after the base letter)
    const harakatFromVariation = variation.slice(baseLetter.length);
    const shaddaChar = "\u0651";
    const fathaChar = "\u064E";
    const kasraChar = "\u0650";
    const dammaChar = "\u064F";
    const imalahChar = "\u0658";
    
    // Check if this is a shadda or imalah button press
    const isShadda = harakatFromVariation === shaddaChar;
    const isImalah = harakatFromVariation === imalahChar;
    
    // Check if this is a vowel (fatha, kasra, damma)
    const isVowel = harakatFromVariation === fathaChar || 
                     harakatFromVariation === kasraChar || 
                     harakatFromVariation === dammaChar;
    
    // If shadda and imalah are both selected and a vowel is pressed, combine all three
    if (isShaddaSelected && isImalahSelected && isVowel) {
      const combinedHarakat = shaddaChar + harakatFromVariation + imalahChar;
      
      const letterPos = letterPositions[currentLetterIndex];
      let letterStart = letterPos.start;
      
      // Find the end position (after the base letter and any existing diacritics)
      let letterEnd = letterStart + 1;
      while (letterEnd < inputValue.length) {
        const char = inputValue[letterEnd];
        if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
          letterEnd++;
        } else {
          break;
        }
      }
      
      // Replace only the harakat part, keep the base letter
      const newValue =
        inputValue.slice(0, letterStart) +
        baseLetter +
        combinedHarakat +
        inputValue.slice(letterEnd);
      
      // Add to history before updating
      addToHistory(newValue);
      onInputChange(newValue);
      
      // Deselect both
      setIsShaddaSelected(false);
      setIsImalahSelected(false);
      
      // After updating, ensure currentLetterIndex is still valid
      setTimeout(() => {
        const newLetterPositions = getLetterPositions(newValue);
        if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
          const newPos = newLetterPositions[currentLetterIndex].start;
          setSelection({ start: newPos, end: newPos });
        }
      }, 0);
      return;
    }
    
    // If only shadda is selected and a vowel is pressed, combine them
    if (isShaddaSelected && isVowel) {
      const combinedHarakat = shaddaChar + harakatFromVariation;
      
      const letterPos = letterPositions[currentLetterIndex];
      let letterStart = letterPos.start;
      
      // Find the end position (after the base letter and any existing diacritics)
      let letterEnd = letterStart + 1;
      while (letterEnd < inputValue.length) {
        const char = inputValue[letterEnd];
        if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
          letterEnd++;
        } else {
          break;
        }
      }
      
      // Replace only the harakat part, keep the base letter
      const newValue =
        inputValue.slice(0, letterStart) +
        baseLetter +
        combinedHarakat +
        inputValue.slice(letterEnd);
      
      // Add to history before updating
      addToHistory(newValue);
      onInputChange(newValue);
      
      // Deselect shadda
      setIsShaddaSelected(false);
      setIsImalahSelected(false);
      
      // After updating, ensure currentLetterIndex is still valid
      setTimeout(() => {
        const newLetterPositions = getLetterPositions(newValue);
        if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
          const newPos = newLetterPositions[currentLetterIndex].start;
          setSelection({ start: newPos, end: newPos });
        }
      }, 0);
      return;
    }
    
    // If shadda button is pressed, toggle selection
    if (isShadda) {
      // If imalah is already selected and shadda is off, turn shadda on as a combo
      if (isImalahSelected && !isShaddaSelected) {
        setIsShaddaSelected(true);
        return;
      }
      // If both are on, turning shadda off leaves imalah selected
      if (isImalahSelected && isShaddaSelected) {
        setIsShaddaSelected(false);
        return;
      }
      const next = !isShaddaSelected;
      setIsShaddaSelected(next);
      return; // Don't apply shadda yet, just toggle selection
    }
    
    // If imalah button is pressed, toggle selection
    if (isImalah) {
      // If shadda is already selected and imalah is off, turn imalah on as a combo
      if (isShaddaSelected && !isImalahSelected) {
        setIsImalahSelected(true);
        return;
      }
      // If both are on, turning imalah off leaves shadda selected
      if (isShaddaSelected && isImalahSelected) {
        setIsImalahSelected(false);
        return;
      }
      const next = !isImalahSelected;
      setIsImalahSelected(next);
      return; // Don't apply imalah yet, just toggle selection
    }
    
    // If shadda is selected and another button is pressed (not a vowel), deselect shadda
    if (isShaddaSelected && !isVowel) {
      setIsShaddaSelected(false);
    }
    
    // If imalah is selected and a vowel is pressed, combine them
    if (isImalahSelected && isVowel) {
      const combinedHarakat = harakatFromVariation + imalahChar;

      const letterPos = letterPositions[currentLetterIndex];
      let letterStart = letterPos.start;

      // Find the end position (after the base letter and any existing diacritics)
      let letterEnd = letterStart + 1;
      while (letterEnd < inputValue.length) {
        const char = inputValue[letterEnd];
        if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
          letterEnd++;
        } else {
          break;
        }
      }

      // Replace only the harakat part, keep the base letter
      const newValue =
        inputValue.slice(0, letterStart) +
        baseLetter +
        combinedHarakat +
        inputValue.slice(letterEnd);

      // Add to history before updating
      addToHistory(newValue);
      onInputChange(newValue);

      // Deselect imalah
      setIsImalahSelected(false);

      // After updating, ensure currentLetterIndex is still valid
      setTimeout(() => {
        const newLetterPositions = getLetterPositions(newValue);
        if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
          const newPos = newLetterPositions[currentLetterIndex].start;
          setSelection({ start: newPos, end: newPos });
        }
      }, 0);
      return;
    }

    // If imalah is selected and another button is pressed (not a vowel), deselect imalah
    if (isImalahSelected && !isVowel) {
      setIsImalahSelected(false);
    }
    
    const letterPos = letterPositions[currentLetterIndex];
    let letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Extract the new harakat from the variation (everything after the base letter)
    const newHarakat = variation.slice(baseLetter.length);
    
    // Replace only the harakat part, keep the base letter
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newHarakat +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // After updating, ensure currentLetterIndex is still valid
    // The letter positions might have changed slightly, but the index should remain the same
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        // Index is still valid, keep it
        setCurrentLetterIndex(currentLetterIndex);
      } else if (newLetterPositions.length > 0) {
        // Index is out of bounds, adjust it
        const newIndex = Math.min(currentLetterIndex, newLetterPositions.length - 1);
        setCurrentLetterIndex(Math.max(0, newIndex));
      }
    }, 0);
  };

  // Handle letter press (for letters mode)
  const handleLetterPress = (letter) => {
    if (inputValue.length === 0) {
      // If empty, just insert the letter
      const newValue = letter;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      // No letters, just append
      const newValue = inputValue + letter;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
    const currentPos = letterPositions[validIndex];
    let newValue = "";
    let newLetterIndex = validIndex;

    if (insertMode === "insertLeft") {
      // Insert before current letter
      newValue = inputValue.slice(0, currentPos.start) + letter + inputValue.slice(currentPos.start);
      newLetterIndex = validIndex; // Stay on the same index (which is now the newly inserted letter)
    } else if (insertMode === "replace") {
      // Replace current letter but keep its harakat (diacritics)
      const currentLetterWithDiacritics = inputValue.slice(currentPos.start, currentPos.end);
      // Extract diacritics from the current letter (everything after the base letter)
      const currentBaseLetter = inputValue[currentPos.start];
      const currentDiacritics = currentLetterWithDiacritics.slice(1); // Everything after the base letter
      // Replace with new letter + old diacritics
      newValue = inputValue.slice(0, currentPos.start) + letter + currentDiacritics + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex; // Stay on the same index
    } else if (insertMode === "insertRight") {
      // Insert after current letter (after its diacritics)
      newValue = inputValue.slice(0, currentPos.end) + letter + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex + 1; // Move to the newly inserted letter
    }

    addToHistory(newValue);
    onInputChange(newValue);
    setCurrentLetterIndex(newLetterIndex);

    // Update selection
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (newLetterIndex >= 0 && newLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[newLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extend stem + hamza press (U+0640 + U+0654)
  const handleExtendStemHamzaPress = () => {
    const tatweelChar = "\u0640"; // Tatweel (extended character)
    const hamzaChar = "\u0654"; // Hamza above
    const combinedChars = tatweelChar + hamzaChar;
    
    if (inputValue.length === 0) {
      // If empty, just insert the combined characters
      const newValue = combinedChars;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      // No letters, just append
      const newValue = inputValue + combinedChars;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
    const currentPos = letterPositions[validIndex];
    let newValue = "";
    let newLetterIndex = validIndex;

    if (insertMode === "insertLeft") {
      // Insert before current letter
      newValue = inputValue.slice(0, currentPos.start) + combinedChars + inputValue.slice(currentPos.start);
      newLetterIndex = validIndex;
    } else if (insertMode === "replace") {
      // Replace current letter but keep its harakat (diacritics)
      const currentLetterWithDiacritics = inputValue.slice(currentPos.start, currentPos.end);
      const currentDiacritics = currentLetterWithDiacritics.slice(1);
      newValue = inputValue.slice(0, currentPos.start) + combinedChars + currentDiacritics + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex;
    } else if (insertMode === "insertRight") {
      // Insert after current letter (after its diacritics)
      newValue = inputValue.slice(0, currentPos.end) + combinedChars + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex + 1;
    }

    addToHistory(newValue);
    onInputChange(newValue);
    setCurrentLetterIndex(newLetterIndex);

    // Update selection
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (newLetterIndex >= 0 && newLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[newLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Get current keyboard buttons based on mode and current letter
  const getKeyboardButtons = () => {
    if (keyboardMode === "harakat") {
      const letterPositions = getLetterPositions(inputValue);
      // Ensure currentLetterIndex is valid
      if (letterPositions.length === 0) {
        return [];
      }
      const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
      
      // If index was invalid, update it
      if (validIndex !== currentLetterIndex) {
        setCurrentLetterIndex(validIndex);
      }
      
      // Get the base letter at the current (validated) index
      if (validIndex >= 0 && validIndex < letterPositions.length) {
        const pos = letterPositions[validIndex].start;
        const char = inputValue[pos];
        if (char) {
          const base = removeDiacritics(char);
          const arabicLetterRegex = /[\u0621-\u063A\u0640\u0641-\u064A\u0671-\u06D3]/;
          if (base && arabicLetterRegex.test(base)) {
            return getHarakatVariations(base);
          }
        }
      }
      return [];
    } else {
      return arabicLetters;
    }
  };

  // Handle arrow key press - move through letters (RTL: left = forward, right = backward)
  const handleArrowPress = (direction) => {
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      setCurrentLetterIndex(0);
      setIsShaddaSelected(false); // Deselect shadda when moving
      setIsImalahSelected(false); // Deselect imalah when moving
      return;
    }

    let newIndex = currentLetterIndex;
    // In RTL: left arrow moves forward (to next letter, visually right), right arrow moves backward (to previous letter, visually left)
    if (direction === "left" && newIndex < letterPositions.length - 1) {
      newIndex++; // Move forward in RTL (visually right)
    } else if (direction === "right" && newIndex > 0) {
      newIndex--; // Move backward in RTL (visually left)
    }
    
    // If moving to a different letter, deselect shadda / imalah
    if (newIndex !== currentLetterIndex) {
      setIsShaddaSelected(false);
      setIsImalahSelected(false);
    }
    
    setCurrentLetterIndex(newIndex);
    
    // Update selection to match the letter position
    if (letterPositions[newIndex]) {
      const pos = letterPositions[newIndex].start;
      setSelection({ start: pos, end: pos });
    }
  };

  // Check if arrows can move
  const canMoveLeft = () => {
    const letterPositions = getLetterPositions(inputValue);
    return letterPositions.length > 0 && currentLetterIndex < letterPositions.length - 1;
  };

  const canMoveRight = () => {
    return currentLetterIndex > 0;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Pressable
          style={[
            styles.popupContainer,
            {
              position: "absolute",
              top: topPosition,
              left: leftPosition,
              width: popupWidth,
              height: popupHeight,
            },
          ]}
        >
          {/* Content */}
          <ScrollView 
            style={styles.popupContent}
            contentContainerStyle={styles.popupContentContainer}
            showsVerticalScrollIndicator={true}
            scrollEnabled={!longPressButton}
          >
            {selectedNarrator ? (
              <>
                <View style={styles.popupHeader}>
                  <TouchableOpacity
                    onPress={() => onSelectNarrator(null)}
                    style={styles.backButton}
                  >
                    <Text style={styles.backArrow}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.popupTitle}>
                    {selectedNarrator.title}
                  </Text>
                  <TouchableOpacity
                    onPress={() => onSaveVariation(variationKey)}
                    style={[
                      styles.saveButton,
                      isSavedState && styles.saveButtonSaved,
                      hasUnsavedChanges && styles.saveButtonNotSaved,
                    ]}
                  >
                    <Text
                      style={[
                        styles.saveButtonText,
                        isSavedState && styles.saveButtonTextSaved,
                        hasUnsavedChanges && styles.saveButtonTextNotSaved,
                      ]}
                    >
                      {hasUnsavedChanges ? "⚠️ Not Saved" : "Saved"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Input field with delete button when saved */}
                <View style={styles.inputRow}>
                  {isSaved && (
                    <TouchableOpacity
                      onPress={onDeleteVariation}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteIcon}>×</Text>
                    </TouchableOpacity>
                  )}
                  <View style={[styles.inputContainer, isSaved && { marginLeft: 8 }]}>
                    {/* Large display block with letter-by-letter highlighting */}
                    <View style={styles.largeDisplayBlock}>
                      {inputValue && inputValue.length > 0 ? (
                        <View style={{ position: 'relative', width: '100%' }}>
                        <Text 
                          style={[
                            styles.displayText,
                            Platform.OS === 'ios' && { 
                              fontFamily: quranFont,
                              fontWeight: 'normal',
                              fontStyle: 'normal',
                            }
                          ]}
                        >
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            // Ensure currentLetterIndex is valid for highlighting
                            let validIndex = 0;
                            if (letterPositions.length > 0) {
                              validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
                              // Update state if index was invalid (but only once to avoid loops)
                              if (validIndex !== currentLetterIndex && currentLetterIndex >= 0) {
                                setTimeout(() => {
                                  if (currentLetterIndex !== validIndex) {
                                    setCurrentLetterIndex(validIndex);
                                  }
                                }, 0);
                              }
                            }
                            
                            const segments = [];
                            let lastIndex = 0;
                            
                            letterPositions.forEach((pos, idx) => {
                              const isHighlighted = idx === validIndex;
                              
                              // Add text before this letter (shouldn't happen if grouping is correct, but safety check)
                              if (pos.start > lastIndex) {
                                const beforeText = inputValue.slice(lastIndex, pos.start);
                                segments.push(beforeText);
                              }
                              
                              // Get the letter with all its diacritics
                              const letterWithDiacritics = inputValue.slice(pos.start, pos.end);
                                
                                // Remove diamond marker from display text (we'll render it separately)
                                const letterForDisplay = letterWithDiacritics.replace(/\u25C6/g, '');
                              
                              if (isHighlighted) {
                                segments.push(
                                  <Text
                                    key={`letter-${idx}`}
                                    style={[
                                      styles.displayTextHighlighted,
                                      Platform.OS === 'ios' && { 
                                        fontFamily: quranFont,
                                        fontWeight: 'normal',
                                        fontStyle: 'normal',
                                      }
                                    ]}
                                  >
                                    {letterForDisplay}
                                  </Text>
                                );
                              } else {
                                  segments.push(letterForDisplay);
                              }
                              
                              lastIndex = pos.end;
                            });
                            
                            // Add any remaining text after the last letter
                            if (lastIndex < inputValue.length) {
                              segments.push(inputValue.slice(lastIndex));
                            }
                            
                            return segments;
                          })()}
                        </Text>
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            const diamondPositions = [];
                            letterPositions.forEach((pos, idx) => {
                              const letterWithDiacritics = inputValue.slice(pos.start, pos.end);
                              if (letterWithDiacritics.includes("\u25C6")) {
                                diamondPositions.push(idx);
                              }
                            });
                            return diamondPositions.map((letterIdx, diamondIdx) => (
                              <View
                                key={`diamond-${diamondIdx}`}
                                style={[
                                  {
                                    position: 'absolute',
                                    bottom: -6,
                                    // Approximate positioning from right for RTL
                                    right: `${Math.max(0, (letterPositions.length - letterIdx - 1) * 6)}%`,
                                  },
                                ]}
                              >
                                <View style={styles.diamondShape} />
                              </View>
                            ));
                          })()}
                        </View>
                      ) : (
                        <Text style={styles.displayPlaceholder}>Enter text...</Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Custom Arabic Keyboard */}
                <View style={styles.customKeyboard}>
                  {/* Control row: Toggle, Arrows, Delete, Undo */}
                  <View style={styles.keyboardControlRow}>
                    <TouchableOpacity
                      style={styles.keyboardToggle}
                      onPress={() => setKeyboardMode(keyboardMode === "harakat" ? "letters" : "harakat")}
                    >
                      <Text style={styles.keyboardToggleText}>
                        {keyboardMode === "harakat" ? "حروف" : "حركات"}
                      </Text>
                    </TouchableOpacity>
                    
                    <View style={styles.keyboardArrowsRow}>
                      <TouchableOpacity
                        style={[
                          styles.keyboardArrowKey,
                          !canMoveLeft() && styles.keyboardArrowKeyDisabled,
                        ]}
                        onPress={() => handleArrowPress("left")}
                        disabled={!canMoveLeft()}
                      >
                        <Text style={[
                          styles.keyboardKeyText,
                          !canMoveLeft() && styles.keyboardKeyTextDisabled,
                        ]}>←</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.keyboardArrowKey,
                          !canMoveRight() && styles.keyboardArrowKeyDisabled,
                        ]}
                        onPress={() => handleArrowPress("right")}
                        disabled={!canMoveRight()}
                      >
                        <Text style={[
                          styles.keyboardKeyText,
                          !canMoveRight() && styles.keyboardKeyTextDisabled,
                        ]}>→</Text>
                      </TouchableOpacity>
                    </View>

                    <TouchableOpacity
                      style={styles.keyboardDeleteKey}
                      onPress={() => {
                        if (inputValue.length > 0 && selection.start > 0) {
                          const newValue =
                            inputValue.slice(0, selection.start - 1) +
                            inputValue.slice(selection.start);
                          addToHistory(newValue);
                          onInputChange(newValue);
                          const newPos = selection.start - 1;
                          setSelection({ start: newPos, end: newPos });
                          setTimeout(() => {
                            if (inputRef.current) {
                              inputRef.current.setNativeProps({
                                selection: { start: newPos, end: newPos },
                              });
                            }
                          }, 0);
                        }
                      }}
                    >
                      <Text style={styles.keyboardKeyText}>⌫</Text>
                    </TouchableOpacity>

                    <TouchableOpacity
                      style={[
                        styles.keyboardUndoKey,
                        historyIndex <= 0 && styles.keyboardUndoKeyDisabled,
                      ]}
                      onPress={handleUndo}
                      disabled={historyIndex <= 0}
                    >
                      <Text style={[
                        styles.keyboardKeyText,
                        historyIndex <= 0 && styles.keyboardKeyTextDisabled,
                      ]}>
                        ↶
                      </Text>
                      {historyIndex > 0 && (
                        <Text style={styles.keyboardUndoCount}>
                          {historyIndex}
                        </Text>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Insert mode buttons (only in letters mode) */}
                  {keyboardMode === "letters" && (
                    <View style={styles.keyboardInsertModeRow}>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "insertRight" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("insertRight")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "insertRight" && styles.keyboardInsertModeTextActive,
                        ]}>[</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "replace" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("replace")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "replace" && styles.keyboardInsertModeTextActive,
                        ]}>O</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "insertLeft" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("insertLeft")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "insertLeft" && styles.keyboardInsertModeTextActive,
                        ]}>]</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Harakat or Letters buttons */}
                  <View style={styles.keyboardGrid}>
                    {(() => {
                      const buttons = getKeyboardButtons();
                      const buttonCount = buttons.length;
                      const isSmallButtonSet = keyboardMode === "harakat" && buttonCount === 5;
                      const shaddaChar = "\u0651";
                      const imalahChar = "\u0658";
                      return buttons.length > 0 ? (
                        <>
                          {buttons.map((char, index) => {
                          // Check if this is the shadda button and if it's selected
                          const baseLetter = getBaseLetterAtCurrentLetter();
                          const isShaddaButton = baseLetter && char === baseLetter + shaddaChar;
                          const isShaddaSelectedForThisButton = isShaddaButton && isShaddaSelected;
                          // Check if this is the imalah button and if it's selected
                          const isImalahButton = baseLetter && char === baseLetter + imalahChar;
                          const isImalahSelectedForThisButton = isImalahButton && isImalahSelected;
                          const isShaddaImalahComboSelectedForThisButton =
                            isShaddaButton && isShaddaSelected && isImalahSelected;
                          
                          // Get the original letter at current position (with its current harakat)
                          const letterPositions = getLetterPositions(inputValue);
                          const originalLetter = (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) 
                            ? inputValue.slice(letterPositions[currentLetterIndex].start, letterPositions[currentLetterIndex].end)
                            : null;
                          
                          // Extract harakat from the button char (everything after base letter)
                          const harakatChar = baseLetter ? char.slice(baseLetter.length) : "";
                          const tanweenChar = getTanweenVersion(harakatChar);
                          const hasTanween = tanweenChar !== null;
                          const isLongPressed = longPressButton && longPressButton.buttonIndex === index;
                          // For harakat mode, check if this is the sukoon button (letter + sukoon)
                          const sukoonChar = "\u0652"; // Sukoon
                          const isSukoonButton = keyboardMode === "harakat" && baseLetter && char === baseLetter + sukoonChar;
                          const plainLetter = isSukoonButton ? baseLetter : null;
                          // Check if this is a fathah button (for dagger alif)
                          const fathaChar = "\u064E"; // Fathah
                          const isFathahButton = keyboardMode === "harakat" && baseLetter && harakatChar === fathaChar;
                          const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
                          // Check if this is a kasrah button (for diamond)
                          const kasraChar = "\u0650"; // Kasrah
                          const isKasrahButton = keyboardMode === "harakat" && baseLetter && harakatChar === kasraChar;
                          // Check if this is a dammah button (for inverted dammah)
                          const dammaChar = "\u064F"; // Dammah
                          const isDammahButton = keyboardMode === "harakat" && baseLetter && harakatChar === dammaChar;
                          const diamondMarker = "\u25C6"; // Diamond marker (◆)
                          
                          return (
                            <View 
                              key={index} 
                              style={{ position: 'relative', zIndex: isLongPressed ? 100 : 1 }}
                              onStartShouldSetResponder={() => isLongPressed}
                              onMoveShouldSetResponder={() => isLongPressed}
                              onResponderMove={(e) => {
                                if (isLongPressed && e?.nativeEvent) {
                                  // Store event values before setTimeout
                                  const touchX = e.nativeEvent.pageX;
                                  const touchY = e.nativeEvent.pageY;
                                  
                                  if (hasTanween && tanweenChar && keyboardMode === "harakat") {
                                    // Check if touch is over tanween button, shadda+tanween button, or standing alif button
                                    setTimeout(() => {
                                      tanweenRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverTanween = 
                                          touchX >= pageX && 
                                          touchX <= pageX + width &&
                                          touchY >= pageY && 
                                          touchY <= pageY + height;
                                        setIsHoveringTanween(isOverTanween);
                                      });
                                      shaddaTanweenRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverShaddaTanween = 
                                          touchX >= pageX && 
                                          touchX <= pageX + width &&
                                          touchY >= pageY && 
                                          touchY <= pageY + height;
                                        setIsHoveringShaddaTanween(isOverShaddaTanween);
                                      });
                                      if (isFathahButton) {
                                        standingAlifRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverStandingAlif = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringStandingAlif(isOverStandingAlif);
                                        });
                                        daggerAlifOnlyRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverDaggerAlifOnly = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringDaggerAlifOnly(isOverDaggerAlifOnly);
                                        });
                                        // Check madd buttons
                                        maddAlifRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddAlif = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddAlif(isOverMaddAlif);
                                        });
                                        maddWawRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddWaw = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddWaw(isOverMaddWaw);
                                        });
                                        maddYaRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddYa = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddYa(isOverMaddYa);
                                        });
                                        maddCombinedRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddCombined = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddCombined(isOverMaddCombined);
                                        });
                                        maddRoundedZeroRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddRoundedZero = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddRoundedZero(isOverMaddRoundedZero);
                                        });
                                        // Check extender hamza + fathah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaFathahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaFathah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaFathah(isOverExtenderHamzaFathah);
                                          });
                                        }
                                      }
                                      if (isDammahButton) {
                                        invertedDammahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverInvertedDammah = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringInvertedDammah(isOverInvertedDammah);
                                        });
                                        // Check extender hamza + dammah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaDammahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaDammah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaDammah(isOverExtenderHamzaDammah);
                                          });
                                        }
                                      }
                                      if (isKasrahButton) {
                                        imalahDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverImalahDot = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringImalahDot(isOverImalahDot);
                                        });
                                        helperDiamondDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverHelperDiamondDot = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringHelperDiamondDot(isOverHelperDiamondDot);
                                        });
                                        subscriptAlefRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverSubscriptAlef = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringSubscriptAlef(isOverSubscriptAlef);
                                        });
                                        // Check extender hamza + kasrah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaKasrahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaKasrah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaKasrah(isOverExtenderHamzaKasrah);
                                          });
                                        }
                                      }
                                    }, 0);
                                  } else if (isSukoonButton && keyboardMode === "harakat" && plainLetter) {
                                    // Check if touch is over plain letter button (for sukoon button)
                                    setTimeout(() => {
                                      sukoonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverSukoon = 
                                          touchX >= pageX && 
                                          touchX <= pageX + width &&
                                          touchY >= pageY && 
                                          touchY <= pageY + height;
                                        setIsHoveringSukoon(isOverSukoon);
                                      });
                                    }, 0);
                                  }
                                }
                              }}
                              onResponderRelease={(e) => {
                                if (isLongPressed) {
                                  if (keyboardMode === "harakat") {
                                    // Check if released over tanween button, shadda+tanween button, standing alif, or plain letter
                                    if (isHoveringTanween && tanweenChar) {
                                      handleHarakatPress(baseLetter + tanweenChar);
                                    } else if (isHoveringShaddaTanween && tanweenChar) {
                                      const shaddaChar = "\u0651";
                                      handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                    } else if (isHoveringStandingAlif && isFathahButton) {
                                      // Released over dagger alif with fathah button (for fathah button)
                                      handleStandingAlifPress();
                                    } else if (isHoveringDaggerAlifOnly && isFathahButton) {
                                      // Released over dagger alif only button (for fathah button)
                                      handleDaggerAlifOnlyPress();
                                    } else if (isHoveringMaddAlif && isFathahButton) {
                                      // Released over madd alif button
                                      handleMaddAlifPress();
                                    } else if (isHoveringMaddWaw && isFathahButton) {
                                      // Released over madd waw button
                                      handleMaddWawPress();
                                    } else if (isHoveringMaddYa && isFathahButton) {
                                      // Released over madd ya button
                                      handleMaddYaPress();
                                    } else if (isHoveringMaddCombined && isFathahButton) {
                                      // Released over madd combined button
                                      handleMaddCombinedPress();
                                    } else if (isHoveringExtenderHamzaFathah && isFathahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + fathah button
                                      handleExtenderHamzaFathahPress();
                                    } else if (isHoveringMaddRoundedZero && isFathahButton) {
                                      // Released over madd rounded zero button
                                      handleMaddRoundedZeroPress();
                                    } else if (isHoveringInvertedDammah && isDammahButton) {
                                      // Released over inverted dammah button
                                      handleInvertedDammahPress();
                                    } else if (isHoveringExtenderHamzaDammah && isDammahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + dammah button
                                      handleExtenderHamzaDammahPress();
                                    } else if (isHoveringImalahDot && isKasrahButton) {
                                      // Released over imalah dot button (for kasrah button)
                                      handleImalahDotPress();
                                    } else if (isHoveringHelperDiamondDot && isKasrahButton) {
                                      // Released over helper diamond dot button (for kasrah button)
                                      handleHelperDiamondDotPress();
                                    } else if (isHoveringSubscriptAlef && isKasrahButton) {
                                      // Released over subscript alef button (for kasrah button)
                                      handleSubscriptAlefPress();
                                    } else if (isHoveringExtenderHamzaKasrah && isKasrahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + kasrah button
                                      handleExtenderHamzaKasrahPress();
                                    } else if (isHoveringSukoon && isSukoonButton && plainLetter) {
                                      // Released over plain letter button (for sukoon button)
                                      handleHarakatPress(plainLetter);
                                    }
                                  }
                                  setLongPressButton(null);
                                  setDragStartY(null);
                                  setIsHoveringTanween(false);
                                  setIsHoveringShaddaTanween(false);
                                  setIsHoveringSukoon(false);
                                  setIsHoveringStandingAlif(false);
                                  setIsHoveringDaggerAlifOnly(false);
                                  setIsHoveringMaddAlif(false);
                                  setIsHoveringMaddWaw(false);
                                  setIsHoveringMaddYa(false);
                                  setIsHoveringMaddCombined(false);
                                  setIsHoveringMaddRoundedZero(false);
                                  setIsHoveringInvertedDammah(false);
                                  setIsHoveringExtenderHamzaDammah(false);
                                  setIsHoveringExtenderHamzaFathah(false);
                                  setIsHoveringImalahDot(false);
                                  setIsHoveringHelperDiamondDot(false);
                                  setIsHoveringSubscriptAlef(false);
                                  setIsHoveringExtenderHamzaKasrah(false);
                                }
                              }}
                            >
                              <Pressable
                                ref={(ref) => {
                                  if (ref) buttonRefs.current[index] = ref;
                                }}
                                style={[
                                  styles.keyboardKey,
                                  isSmallButtonSet && styles.keyboardKeyLarge,
                                  isShaddaImalahComboSelectedForThisButton
                                    ? styles.keyboardKeyShaddaImalahSelected
                                    : (isShaddaSelectedForThisButton || isImalahSelectedForThisButton) && styles.keyboardKeyShaddaSelected,
                                  isLongPressed && styles.keyboardKeyLongPressed,
                                ]}
                                onPress={() => {
                                  if (!isLongPressed) {
                                    keyboardMode === "harakat" 
                                      ? handleHarakatPress(char)
                                      : handleLetterPress(char);
                                  }
                                }}
                                onLongPress={() => {
                                  if (hasTanween && keyboardMode === "harakat") {
                                    // Measure button position
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      const tanweenCharFull = baseLetter + tanweenChar;
                                      setLongPressButton({
                                        char: char,
                                        tanweenChar: tanweenCharFull,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  } else if (isKasrahButton && keyboardMode === "harakat") {
                                    // For kasrah button, show diamond option
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      setLongPressButton({
                                        char: char,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  } else if (isSukoonButton && keyboardMode === "harakat" && plainLetter) {
                                    // For harakat mode, show plain letter option when long-pressing sukoon button
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      setLongPressButton({
                                        char: char,
                                        plainLetter: plainLetter,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  }
                                }}
                                delayLongPress={300}
                                onPressOut={() => {
                                  // Don't handle release here, let the wrapper View handle it
                                }}
                              >
                                <Text style={[
                                  styles.keyboardKeyText,
                                  isSmallButtonSet && styles.keyboardKeyTextLarge,
                                  isShaddaImalahComboSelectedForThisButton
                                    ? styles.keyboardKeyTextShaddaImalahSelected
                                    : (isShaddaSelectedForThisButton || isImalahSelectedForThisButton) && styles.keyboardKeyTextShaddaSelected,
                                ]}>{char}</Text>
                              </Pressable>
                              
                              {/* Tanween popup - only shows when long-pressed in harakat mode */}
                              {isLongPressed && tanweenChar && keyboardMode === "harakat" && (
                                <>
                                  {isFathahButton ? (
                                    <View style={[
                                      styles.kasrahDropdownGrid,
                                      {
                                        top: (isSmallButtonSet ? 50 : 36) + 8,
                                      }
                                    ]}>
                                      {/* Row 1: Tanween, Shadda+Tanween, Dagger Alif with fathah */}
                                      <View style={{ flexDirection: "row", marginBottom: 4 }}>
                                        {/* Tanween button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) tanweenRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                      isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                    ]}
                                    onPress={() => {
                                      handleHarakatPress(baseLetter + tanweenChar);
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringTanween(false);
                                      setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                    }}
                                  >
                                    <Text style={[
                                      styles.keyboardKeyText,
                                      isSmallButtonSet && styles.keyboardKeyTextLarge,
                                    ]}>{baseLetter + tanweenChar}</Text>
                                  </Pressable>
                                  
                                        {/* Shadda+Tanween button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) shaddaTanweenRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                          isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                        ]}
                                        onPress={() => {
                                          const shaddaChar = "\u0651";
                                          handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          isSmallButtonSet && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                      </Pressable>
                                      
                                        {/* Dagger Alif with fathah button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) standingAlifRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                          styles.dropdownGridButton,
                                          isHoveringStandingAlif && styles.keyboardKeyTanweenHovered,
                                        ]}
                                        onPress={() => {
                                          handleStandingAlifPress();
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                          setIsHoveringMaddAlif(false);
                                          setIsHoveringMaddWaw(false);
                                          setIsHoveringMaddYa(false);
                                          setIsHoveringMaddCombined(false);
                                          setIsHoveringMaddRoundedZero(false);
                                          setIsHoveringInvertedDammah(false);
                                          setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          isSmallButtonSet && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + fathaChar + daggerAlifChar}</Text>
                                      </Pressable>
                                      </View>
                                      
                                      {/* Row 2: Dagger Alif only, Madd Alif, Madd Combined */}
                                      <View style={{ flexDirection: "row" }}>
                                        {/* Dagger Alif only button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) daggerAlifOnlyRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                          isHoveringDaggerAlifOnly && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                        ]}
                                        onPress={() => {
                                          handleDaggerAlifOnlyPress();
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          isSmallButtonSet && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + daggerAlifChar}</Text>
                                      </Pressable>
                                        
                                        {/* Madd Alif button */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddAlifRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddAlif && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                          ]}
                                          onPress={() => {
                                            handleMaddAlifPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            isSmallButtonSet && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + fathaChar + "\u0627"}</Text>
                                        </Pressable>
                                        
                                        {/* Madd Combined button */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddCombinedRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddCombined && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                          ]}
                                          onPress={() => {
                                            handleMaddCombinedPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            isSmallButtonSet && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + "\u0653"}</Text>
                                        </Pressable>
                                        
                                        {/* Madd Rounded Zero button (U+06E4) */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddRoundedZeroRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddRoundedZero && styles.keyboardKeyTanweenHovered,
                                          ]}
                                          onPress={() => {
                                            handleMaddRoundedZeroPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            isSmallButtonSet && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + "\u06E4"}</Text>
                                        </Pressable>
                                      </View>
                                      
                                      {/* Extender Hamza + Fathah button (only for extender) */}
                                      {baseLetter === "\u0640" && (
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) extenderHamzaFathahRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringExtenderHamzaFathah && styles.keyboardKeyTanweenHovered,
                                            { marginTop: 4 },
                                          ]}
                                          onPress={() => {
                                            handleExtenderHamzaFathahPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            isSmallButtonSet && styles.keyboardKeyTextLarge,
                                          ]}>{"\u0640\u0654\u064E"}</Text>
                                        </Pressable>
                                      )}
                                    </View>
                                  ) : (
                                    <>
                                      {/* For non-fathah buttons with tanween - use grid layout */}
                                      {isKasrahButton ? (
                                        <View style={[
                                          styles.kasrahDropdownGrid,
                                          {
                                            top: (isSmallButtonSet ? 50 : 36) + 8,
                                          }
                                        ]}>
                                          {/* Tanween button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) tanweenRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                              isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleHarakatPress(baseLetter + tanweenChar);
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringTanween(false);
                                              setIsHoveringShaddaTanween(false);
                                              setIsHoveringStandingAlif(false);
                                              setIsHoveringDaggerAlifOnly(false);
                                            }}
                                          >
                                            <Text style={[
                                              styles.keyboardKeyText,
                                              isSmallButtonSet && styles.keyboardKeyTextLarge,
                                            ]}>{baseLetter + tanweenChar}</Text>
                                          </Pressable>
                                          
                                          {/* Shadda+Tanween button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) shaddaTanweenRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                              isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              const shaddaChar = "\u0651";
                                              handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringTanween(false);
                                              setIsHoveringShaddaTanween(false);
                                              setIsHoveringStandingAlif(false);
                                              setIsHoveringDaggerAlifOnly(false);
                                            }}
                                          >
                                            <Text style={[
                                              styles.keyboardKeyText,
                                              isSmallButtonSet && styles.keyboardKeyTextLarge,
                                            ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                          </Pressable>

                                          {/* Imalah dot button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) imalahDotRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringImalahDot && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleImalahDotPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringImalahDot(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                isSmallButtonSet && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0658"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Helper diamond dot button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) helperDiamondDotRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringHelperDiamondDot && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleHelperDiamondDotPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringHelperDiamondDot(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                isSmallButtonSet && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0659"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Subscript Alef button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) subscriptAlefRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringSubscriptAlef && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleSubscriptAlefPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringSubscriptAlef(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                isSmallButtonSet && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0656"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Extender Hamza + Kasrah button (only for extender) */}
                                          {isKasrahButton && baseLetter === "\u0640" && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) extenderHamzaKasrahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringExtenderHamzaKasrah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleExtenderHamzaKasrahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringImalahDot(false);
                                                setIsHoveringHelperDiamondDot(false);
                                                setIsHoveringSubscriptAlef(false);
                                                setIsHoveringExtenderHamzaKasrah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{"\u0640\u0654\u0650"}</Text>
                                            </Pressable>
                                          )}
                                        </View>
                                      ) : (
                                        <View style={[
                                          styles.kasrahDropdownGrid,
                                          {
                                            top: (isSmallButtonSet ? 50 : 36) + 8,
                                          }
                                        ]}>
                                          {/* Tanween button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) tanweenRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                          isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                        ]}
                                        onPress={() => {
                                          handleHarakatPress(baseLetter + tanweenChar);
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                              setIsHoveringMaddAlif(false);
                                              setIsHoveringMaddWaw(false);
                                              setIsHoveringMaddYa(false);
                                              setIsHoveringMaddCombined(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          isSmallButtonSet && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + tanweenChar}</Text>
                                      </Pressable>
                                      
                                          {/* Shadda+Tanween button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) shaddaTanweenRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                      isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      const shaddaChar = "\u0651";
                                      handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringTanween(false);
                                      setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                              setIsHoveringMaddAlif(false);
                                              setIsHoveringMaddWaw(false);
                                              setIsHoveringMaddYa(false);
                                              setIsHoveringMaddCombined(false);
                                    }}
                                  >
                                    <Text style={[
                                      styles.keyboardKeyText,
                                      isSmallButtonSet && styles.keyboardKeyTextLarge,
                                    ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                  </Pressable>
                                          
                                          {/* Inverted Dammah button (only for dammah) */}
                                          {isDammahButton && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) invertedDammahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringInvertedDammah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleInvertedDammahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringInvertedDammah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter + "\u0657"}</Text>
                                            </Pressable>
                                          )}
                                          {/* Extender Hamza + Dammah button (only for extender and dammah) */}
                                          {isDammahButton && baseLetter === "\u0640" && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) extenderHamzaDammahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringExtenderHamzaDammah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleExtenderHamzaDammahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringInvertedDammah(false);
                                                setIsHoveringExtenderHamzaDammah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                isSmallButtonSet && styles.keyboardKeyTextLarge,
                                              ]}>{"\u0640\u0654\u064F"}</Text>
                                            </Pressable>
                                          )}
                                        </View>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                              
                              {/* Plain letter popup - only shows when long-pressing sukoon button in harakat mode */}
                              {isLongPressed && isSukoonButton && plainLetter && keyboardMode === "harakat" && (
                                <Pressable
                                  ref={(ref) => {
                                    if (ref) sukoonRefs.current[index] = ref;
                                  }}
                                  style={[
                                    styles.keyboardKeyTanween,
                                    {
                                      top: (isSmallButtonSet ? 50 : 36) + 8,
                                      left: 0,
                                    },
                                    isHoveringSukoon && styles.keyboardKeyTanweenHovered,
                                  ]}
                                  onPress={() => {
                                    handleHarakatPress(plainLetter);
                                    setLongPressButton(null);
                                    setDragStartY(null);
                                    setIsHoveringSukoon(false);
                                  }}
                                >
                                  <Text style={[
                                    styles.keyboardKeyText,
                                    isSmallButtonSet && styles.keyboardKeyTextLarge,
                                  ]}>{plainLetter}</Text>
                                </Pressable>
                              )}
                              
                              {/* Kasrah button dropdown (no tanween) - shows helper dot buttons in a grid */}
                              {isLongPressed && isKasrahButton && keyboardMode === "harakat" && !hasTanween && (
                                <View style={[
                                  styles.kasrahDropdownGrid,
                                  {
                                    top: (isSmallButtonSet ? 50 : 36) + 8,
                                  }
                                ]}>
                                  {/* Imalah dot button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) imalahDotRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringImalahDot && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleImalahDotPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringImalahDot(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        isSmallButtonSet && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        isSmallButtonSet && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0658"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Helper diamond dot button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) helperDiamondDotRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringHelperDiamondDot && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleHelperDiamondDotPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringHelperDiamondDot(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        isSmallButtonSet && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        isSmallButtonSet && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0659"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Subscript Alef button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) subscriptAlefRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringSubscriptAlef && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleSubscriptAlefPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringSubscriptAlef(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        isSmallButtonSet && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        isSmallButtonSet && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0656"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Extender Hamza + Kasrah button (only for extender) */}
                                  {baseLetter === "\u0640" && (
                                    <Pressable
                                      ref={(ref) => {
                                        if (ref) extenderHamzaKasrahRefs.current[index] = ref;
                                      }}
                                      style={[
                                        styles.keyboardKeyTanween,
                                        styles.dropdownGridButton,
                                        isHoveringExtenderHamzaKasrah && styles.keyboardKeyTanweenHovered,
                                      ]}
                                      onPress={() => {
                                        handleExtenderHamzaKasrahPress();
                                        setLongPressButton(null);
                                        setDragStartY(null);
                                        setIsHoveringImalahDot(false);
                                        setIsHoveringHelperDiamondDot(false);
                                        setIsHoveringSubscriptAlef(false);
                                        setIsHoveringExtenderHamzaKasrah(false);
                                      }}
                                    >
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        isSmallButtonSet && styles.keyboardKeyTextLarge,
                                      ]}>{"\u0640\u0654\u0650"}</Text>
                                    </Pressable>
                                  )}
                                </View>
                              )}
                            </View>
                          );
                        })}
                        </>
                      ) : null;
                    })()}
                    {getKeyboardButtons().length === 0 && (
                      <View style={styles.keyboardEmptyState}>
                        <Text style={styles.keyboardEmptyText}>
                          {keyboardMode === "harakat" 
                            ? "Place cursor on a letter to see harakat variations"
                            : "Select letters mode to type"}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Comparison table */}
                <ComparisonTable
                  originalText={selectedWord?.content || ""}
                  inputText={inputValue}
                  fontFamily={quranFont}
                />
              </>
            ) : (
              <>
                {/* Narrators list */}
                <View style={styles.popupHeader}>
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeIcon}>✕</Text>
                  </TouchableOpacity>
                  <View style={styles.popupHeaderTitleRow}>
                    <Text style={styles.popupTitle}>Select Narrator</Text>
                    {isShubahHighlight &&
                      currentSurahNumber &&
                      selectedWord && (
                        <ShubahWordAudioButton
                          word={selectedWord}
                          surahNumber={currentSurahNumber}
                        />
                      )}
                  </View>
                </View>
                <ScrollView style={styles.narratorList}>
                  {narrators.map((narrator) => (
                    <TouchableOpacity
                      key={narrator.id}
                      onPress={() => onSelectNarrator(narrator)}
                      style={styles.narratorItem}
                    >
                      <Text style={styles.narratorText}>{narrator.title}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </ScrollView>
        </Pressable>
      </View>
    </Modal>
  );
};

export default function App() {
  const [page, setPage] = useState(null);
  const [nextPage, setNextPage] = useState(null);
  const [previousPage, setPreviousPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fontsLoaded, fontError] = useFonts({
    NaskhNastaleeqIndoPakQWBW: require("./Naskh-Nastaleeq-IndoPak-QWBW.ttf"),
    MeQuran: require("./assets/me_quran_volt_newmet.ttf"),
    AswaatOne: require("./assets/aswaat-one.otf"),
    AswaatHelpers: require("./aswaat-helpers-one-Regular.ttf"),
    DigitalKhatt: require("./digitalkhatt.otf"),
    DigitalKhattV1: require("./DigitalKhattQuranicV1.otf"),
    DigitalKhattV2: require("./DigitalKhattV2.otf"),
  });
  
  // Debug font loading
  useEffect(() => {
    if (fontError) {
      console.error("Font loading error:", fontError);
      if (typeof fontError === 'object') {
        try {
          console.error("Font error details:", JSON.stringify(fontError, null, 2));
        } catch (e) {
          console.error("Font error (stringified):", String(fontError));
        }
      }
    }
    if (fontsLoaded) {
      console.log("✅ Fonts loaded successfully");
      console.log("📝 Using font family:", QURAN_FONT_FAMILY);
      console.log("📖 Mushaf: choose in Settings (2 = 13 Liner IndoPak, 3 = 15 Liner Uthmani)");
      console.log("📱 Platform:", Platform.OS);
      
      // Test if font is available on iOS
      if (Platform.OS === 'ios') {
        console.log("🍎 iOS: Testing font rendering with Unicode characters");
        console.log("🍎 Test characters - Diamond dot (U+0659):", "\u0659");
        console.log("🍎 Test characters - Imalah dot (U+0658):", "\u0658");
        console.log("🍎 Test text with dots: جَعَل\u0659\u0658");
        console.log("🍎 Font family being used:", QURAN_FONT_FAMILY);
        console.log("🍎 Font file path: assets/aswaat-fontlab.ttf");
        console.log("🍎 ⚠️ If characters don't render, the font file's internal name might not match 'AswaatOne'");
        console.log("🍎 ⚠️ Try rebuilding the app: npx expo run:ios --clear");
        console.log("🍎 💡 Possible font names to try: 'Aswaat', 'AswaatOne', 'Aswaat FontLab', or the file's PostScript name");
      }
      

    }
  }, [fontsLoaded, fontError]);
  const [popupVisible, setPopupVisible] = useState(false);
  const [narrators, setNarrators] = useState([]);
  const [selectedNarrator, setSelectedNarrator] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedWord, setSelectedWord] = useState(null);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [wordPosition, setWordPosition] = useState(null);
  const [currentPage, setCurrentPage] = useState(5);
  const [pageInput, setPageInput] = useState("5");
  const [showPageSlider, setShowPageSlider] = useState(false);
  const [sliderValue, setSliderValue] = useState(5); // Temporary value for slider (doesn't trigger page load)
  const TOTAL_PAGES = 604; // Total pages in the Quran
  const juzSegments = useMemo(
    () =>
      segmentsData
        .filter((s) => s.fields.category === "juz")
        .sort((a, b) => b.fields.first_page - a.fields.first_page), // RTL: highest page first
    []
  );
  const surahSegments = useMemo(
    () =>
      segmentsData
        .filter((s) => s.fields.category === "surah")
        .sort((a, b) => b.fields.first_page - a.fields.first_page), // RTL: highest page first
    []
  );
  const [currentJuzIndex, setCurrentJuzIndex] = useState(0);
  const [currentSurahIndex, setCurrentSurahIndex] = useState(0);
  const juzScrollViewRef = useRef(null);
  const surahScrollViewRef = useRef(null);
  const juzCarouselWidthRef = useRef(0);
  const surahCarouselWidthRef = useRef(0);
  const CAROUSEL_ITEM_WIDTH = 84; // width 76 + marginRight 8
  const [selectedNarrators, setSelectedNarrators] = useState([]);
  const [savedVariations, setSavedVariations] = useState([]);
  const [allVariations, setAllVariations] = useState({});
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerFullyOpen, setIsDrawerFullyOpen] = useState(false);
  const [isQiraatSettingsVisible, setIsQiraatSettingsVisible] = useState(false);
  const [isMushafDarkMode, setIsMushafDarkMode] = useState(false);
  // Initialize mushafId from storage on web (sync) so first paint matches; native loads in useEffect
  const [mushafId, setMushafId] = useState(() => {
    if (typeof Platform !== "undefined" && Platform.OS === "web" && typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("mushafId");
        if (saved) {
          const id = parseInt(saved, 10);
          if (id === 2 || id === 3) return id;
        }
      } catch (e) {}
    }
    // Default to Mushaf 2 (13 Liner IndoPak) so the initial
    // render matches the app settings unless a saved preference
    // overrides it from storage.
    return 2;
  });
  const VARIATIONS_SIDEBAR_WIDTH = 320;
  const [isVariationsSidebarOpen, setIsVariationsSidebarOpen] = useState(false);
  const [isVariationBottomSheetVisible, setIsVariationBottomSheetVisible] = useState(false);
  const [isVariationBottomSheetExpanded, setIsVariationBottomSheetExpanded] = useState(false);
  const variationBarAnim = useRef(new Animated.Value(0)).current; // 0 = visible, 1 = hidden
  const [allMushafVariations, setAllMushafVariations] = useState([]);
  const [lastSelectedVariationHighlight, setLastSelectedVariationHighlight] = useState(null);
  const variationsSidebarAnim = useRef(new Animated.Value(VARIATIONS_SIDEBAR_WIDTH)).current;
  const variationsSidebarBackdropAnim = useRef(new Animated.Value(0)).current;
  const variationsSidebarScrollRef = useRef(null);
  const variationsSidebarScrollOffsetRef = useRef(0);
  const VARIATIONS_SIDEBAR_ROW_HEIGHT = 72;
  const [currentTab, setCurrentTab] = useState("Recite");
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [parentNarrators, setParentNarrators] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [pageCache, setPageCache] = useState({}); // Cache for pre-fetched pages (for React re-renders)
  const [variationCache, setVariationCache] = useState({}); // Cache for variations per page (for React re-renders)
  const pageCacheRef = useRef({}); // Ref cache for synchronous access
  const variationCacheRef = useRef({}); // Ref cache for variations
  const DRAWER_WIDTH = 260;
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  const currentTabRef = useRef(currentTab);
  const isDrawerVisibleRef = useRef(isDrawerVisible);
  const currentPageRef = useRef(currentPage);
  const isNavigatingRef = useRef(false);
  const handlePreviousPageRef = useRef();
  const handleNextPageRef = useRef();
  const fetchingPagesRef = useRef(new Set()); // Track which pages are being fetched
  const isDraggingDrawerRef = useRef(false);
  const drawerStartValueRef = useRef(-DRAWER_WIDTH);
  const isAnimatingDrawerRef = useRef(false);
  const pagerRef = useRef(null);

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    isDrawerVisibleRef.current = isDrawerVisible;
  }, [isDrawerVisible]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Load saved mushaf preference (2 = 13 Liner IndoPak, 3 = 15 Liner Uthmani)
  useEffect(() => {
    const load = async () => {
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          const saved = localStorage.getItem("mushafId");
          if (saved) {
            const id = parseInt(saved, 10);
            if (id === 2 || id === 3) setMushafId(id);
          }
        } else {
          const saved = await AsyncStorage.getItem("mushafId");
          if (saved) {
            const id = parseInt(saved, 10);
            if (id === 2 || id === 3) setMushafId(id);
          }
        }
      } catch (err) {
        console.error("Error loading mushafId:", err);
      }
    };
    load();
  }, []);

  // When mushaf changes: persist, clear page cache, and clear current page so we don't show wrong content with new font
  useEffect(() => {
    const save = async () => {
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          localStorage.setItem("mushafId", String(mushafId));
        } else {
          await AsyncStorage.setItem("mushafId", String(mushafId));
        }
      } catch (err) {
        console.error("Error saving mushafId:", err);
      }
    };
    save();
    pageCacheRef.current = {};
    setPageCache({});
    variationCacheRef.current = {};
    setVariationCache({});
    setPage(null); // clear current page so UI shows loading until correct mushaf page is fetched
    setLoading(true);
  }, [mushafId]);

  // Cleanup effect: ensure drawer is in valid state when tab changes or component unmounts
  useEffect(() => {
    if (currentTab !== "Recite") {
      if (isDrawerVisible) closeDrawer();
      if (isVariationsSidebarOpen) closeVariationsSidebar();
    }
  }, [currentTab]);

  // Aggressive check to ensure drawer is ALWAYS in valid state - NEVER allow intermediate states
  useEffect(() => {
    const checkInterval = setInterval(() => {
      // Don't check during animations or dragging
      if (isAnimatingDrawerRef.current || isDraggingDrawerRef.current) {
        return;
      }
      
      if (isDrawerVisible && currentTab === "Recite") {
        const currentValue = drawerAnim._value;
        // If drawer is visible but NOT fully open (value != 0), close it immediately
        if (currentValue !== 0 && currentValue > -DRAWER_WIDTH) {
          // Drawer is in invalid state - force close immediately
          console.warn("Drawer in invalid state, forcing close:", currentValue);
          drawerAnim.setValue(-DRAWER_WIDTH);
          backdropAnim.setValue(0);
          setIsDrawerVisible(false);
          setIsDrawerFullyOpen(false);
        } else if (currentValue === 0) {
          // Drawer is fully open
          setIsDrawerFullyOpen(true);
        }
      } else if (!isDrawerVisible && currentTab === "Recite") {
        // If drawer should be invisible, ensure it's fully closed
        const currentValue = drawerAnim._value;
        if (currentValue > -DRAWER_WIDTH) {
          drawerAnim.setValue(-DRAWER_WIDTH);
          backdropAnim.setValue(0);
        }
        setIsDrawerFullyOpen(false);
      }
    }, 100); // Check every 100ms - very aggressive

    return () => clearInterval(checkInterval);
  }, [isDrawerVisible, currentTab]);

  // Additional safeguard: monitor drawer animation value
  useEffect(() => {
    const listener = drawerAnim.addListener(({ value }) => {
      // Don't interfere during animations or dragging
      if (isAnimatingDrawerRef.current || isDraggingDrawerRef.current) {
        return;
      }
      
      // If drawer is supposed to be visible but not fully open, fix it
      if (isDrawerVisible && value !== 0 && value > -DRAWER_WIDTH) {
        // Force to valid state immediately
        if (value > -DRAWER_WIDTH * 0.5) {
          // More than halfway, snap to open
          drawerAnim.setValue(0);
          backdropAnim.setValue(1);
          setIsDrawerFullyOpen(true);
        } else {
          // Less than halfway, snap to closed
          drawerAnim.setValue(-DRAWER_WIDTH);
          backdropAnim.setValue(0);
          setIsDrawerVisible(false);
          setIsDrawerFullyOpen(false);
        }
      }
    });

    return () => {
      drawerAnim.removeListener(listener);
    };
  }, [isDrawerVisible]);

  // Helper function to ensure drawer is in a valid state (fully open or fully closed)
  const ensureDrawerValidState = () => {
    const currentValue = drawerAnim._value;
    const threshold = DRAWER_WIDTH * 0.3; // 30% threshold
    
    // If drawer is in an intermediate state, snap it to nearest valid state
    if (currentValue > -threshold && currentValue < 0) {
      // More than 30% open, snap to fully open
      Animated.spring(drawerAnim, {
        toValue: 0,
        useNativeDriver: true,
        damping: 20,
        stiffness: 300,
      }).start(() => {
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    } else if (currentValue <= -threshold && currentValue > -DRAWER_WIDTH) {
      // Less than 30% open, snap to fully closed
      closeDrawer();
    }
  };

  // Swipe gesture for opening drawer from left edge (only on Recite tab)
  // This gesture follows the finger like iOS Notes app - optimized for responsiveness
  const drawerSwipeGesture = useRef(
    Gesture.Pan()
      .activeOffsetX([-5, 100]) // Very low threshold for rightward movement, allow left for closing
      .failOffsetY([-20, 20]) // Fail if too much vertical movement
      .minDistance(3) // Very low minimum distance for instant activation
      .onBegin((event) => {
        const startX = event.x;
        const isDrawerOpen = isDrawerVisibleRef.current;
        
        // Check if we should activate this gesture
        if (currentTabRef.current !== "Recite") {
          return;
        }
        
        // If drawer is closed, only activate from left edge (within 20px)
        if (!isDrawerOpen && startX > 20) {
          return; // Don't activate - let page swipe handle it
        }
        
        // Start dragging
        isDraggingDrawerRef.current = true;
        drawerStartValueRef.current = drawerAnim._value;
        
        if (!isDrawerOpen) {
          setIsDrawerVisible(true);
        }
      })
      .onUpdate((event) => {
        if (!isDraggingDrawerRef.current) return;
        
        // Update drawer position in real-time following finger
        const newValue = Math.max(
          -DRAWER_WIDTH,
          Math.min(0, drawerStartValueRef.current + event.translationX)
        );
        drawerAnim.setValue(newValue);
      })
      .onEnd((event) => {
        const wasDragging = isDraggingDrawerRef.current;
        isDraggingDrawerRef.current = false;
        
        if (!wasDragging) {
          // Force close if not dragging
          closeDrawer();
          return;
        }
        
        const currentValue = drawerAnim._value;
        const swipeThreshold = DRAWER_WIDTH * 0.4; // 40% of drawer width
        const velocity = event.velocityX;
        const startX = event.x - event.translationX;
        const wasDrawerOpen = drawerStartValueRef.current > -DRAWER_WIDTH * 0.5;
        
        // If drawer was closed and didn't start from left edge, close it
        if (!wasDrawerOpen && startX > 20) {
          closeDrawer();
          return;
        }
        
        // Determine if we should open or close based on:
        // 1. Current position (more than 40% open = stay open)
        // 2. Swipe velocity (fast right swipe = open, fast left swipe = close)
        const shouldOpen = 
          (currentValue > -swipeThreshold && velocity > -300) || 
          (velocity > 500 && event.translationX > 0);
        
        if (shouldOpen) {
          // Animate to fully open - MUST reach 0
          Animated.spring(drawerAnim, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }).start((finished) => {
            if (finished) {
              // Ensure it's exactly 0
              drawerAnim.setValue(0);
              setIsDrawerFullyOpen(true);
              // Only fade in backdrop when drawer is fully open
              Animated.timing(backdropAnim, {
                toValue: 1,
                duration: 200,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }).start();
            }
          });
        } else {
          // Animate to closed - MUST reach -DRAWER_WIDTH
          closeDrawer();
        }
      })
      .onFinalize(() => {
        isDraggingDrawerRef.current = false;
        // Immediately ensure valid state
        setTimeout(() => {
          const currentValue = drawerAnim._value;
          if (currentValue !== 0 && currentValue !== -DRAWER_WIDTH) {
            // Invalid state - force to nearest valid state
            if (currentValue > -DRAWER_WIDTH * 0.5) {
              drawerAnim.setValue(0);
              backdropAnim.setValue(1);
            } else {
              drawerAnim.setValue(-DRAWER_WIDTH);
              backdropAnim.setValue(0);
              setIsDrawerVisible(false);
              setIsDrawerFullyOpen(false);
            }
          }
        }, 50);
      })
  ).current;

  const openDrawer = () => {
    isAnimatingDrawerRef.current = true;
    setIsDrawerVisible(true);
    // First open the drawer, then fade in the backdrop when fully open
    Animated.timing(drawerAnim, {
      toValue: 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start((finished) => {
      if (finished) {
        // Ensure it's exactly 0
        drawerAnim.setValue(0);
        setIsDrawerFullyOpen(true);
        // Only fade in backdrop when drawer is fully open
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start(() => {
          isAnimatingDrawerRef.current = false;
        });
      } else {
        isAnimatingDrawerRef.current = false;
      }
    });
  };

  const closeDrawer = () => {
    isDraggingDrawerRef.current = false; // Stop any dragging
    isAnimatingDrawerRef.current = true;
    Animated.parallel([
      Animated.timing(drawerAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(backdropAnim, {
        toValue: 0,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start((finished) => {
      if (finished) {
        // Ensure it's exactly closed
        drawerAnim.setValue(-DRAWER_WIDTH);
        backdropAnim.setValue(0);
        setIsDrawerVisible(false);
        setIsDrawerFullyOpen(false);
      }
      isAnimatingDrawerRef.current = false;
    });
  };

  // Variations sidebar (right-sliding) - lists all narration changes for mushaf traversal
  // Fetched once in background when narrators are selected; no refetch on sidebar open
  const fetchAllVariations = useCallback(async () => {
    const narratorIds = selectedNarrators
      .filter((id) => typeof id === "number" || /^\d+$/.test(String(id)))
      .map((id) => parseInt(id, 10));
    if (narratorIds.length === 0) {
      setAllMushafVariations([]);
      return;
    }
    const params = new URLSearchParams({ mushaf_id: mushafId, narrator_ids: narratorIds.join(",") });
    const url = `${VARIATIONS_URL}?${params.toString()}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAllMushafVariations(data);
      } else {
        setAllMushafVariations([]);
      }
    } catch (err) {
      console.error("Error fetching all variations:", err);
      setAllMushafVariations([]);
    }
  }, [selectedNarrators, mushafId]);

  // Fetch all variations discreetly in background when narrator selection changes
  useEffect(() => {
    if (selectedNarrators.length > 0) {
      fetchAllVariations();
    } else {
      setAllMushafVariations([]);
    }
  }, [selectedNarrators, fetchAllVariations]);

  const openVariationsSidebar = useCallback(() => {
    setIsVariationsSidebarOpen(true);
    Animated.parallel([
      Animated.timing(variationsSidebarAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(variationsSidebarBackdropAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [variationsSidebarAnim, variationsSidebarBackdropAnim]);

  // When variations sidebar opens, scroll to selected item (if still on that page) or restore scroll position
  useEffect(() => {
    if (!isVariationsSidebarOpen || allMushafVariations.length === 0) return;
    const timer = setTimeout(() => {
      const scrollRef = variationsSidebarScrollRef.current;
      if (!scrollRef || !scrollRef.scrollTo) return;
      const shouldScrollToSelected =
        lastSelectedVariationHighlight &&
        currentPage === lastSelectedVariationHighlight.pageNum;
      if (shouldScrollToSelected) {
        const idx = allMushafVariations.findIndex(
          (v) => v.word?.id === lastSelectedVariationHighlight.wordId
        );
        if (idx >= 0) {
          const y = Math.max(0, idx * VARIATIONS_SIDEBAR_ROW_HEIGHT - 60);
          scrollRef.scrollTo({ y, animated: false });
        }
      } else {
        scrollRef.scrollTo({
          y: variationsSidebarScrollOffsetRef.current,
          animated: false,
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isVariationsSidebarOpen, allMushafVariations.length, lastSelectedVariationHighlight, currentPage]);

  const closeVariationsSidebar = useCallback(() => {
    Animated.parallel([
      Animated.timing(variationsSidebarAnim, {
        toValue: VARIATIONS_SIDEBAR_WIDTH,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(variationsSidebarBackdropAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start((finished) => {
      if (finished) {
        variationsSidebarAnim.setValue(VARIATIONS_SIDEBAR_WIDTH);
        variationsSidebarBackdropAnim.setValue(0);
        setIsVariationsSidebarOpen(false);
      }
    });
  }, [variationsSidebarAnim, variationsSidebarBackdropAnim]);

  const syncPagerToPage = (pageNum, animated = true) => {
    if (!pagerRef.current) return;
    const clampedPage = Math.min(Math.max(pageNum, 1), TOTAL_PAGES);
    // RTL: index 0 is last page, index TOTAL_PAGES - 1 is first page
    const index = TOTAL_PAGES - clampedPage;
    try {
      if (animated && typeof pagerRef.current.setPage === "function") {
        pagerRef.current.setPage(index);
      } else if (typeof pagerRef.current.setPageWithoutAnimation === "function") {
        pagerRef.current.setPageWithoutAnimation(index);
      } else if (typeof pagerRef.current.setPage === "function") {
        pagerRef.current.setPage(index);
      }
    } catch (e) {
      // Ignore pager sync errors
    }
  };

  // Function to fetch a single page and cache it
  const fetchAndCachePage = async (pageNum, showLoading = false) => {
    // Skip if already fetching
    if (fetchingPagesRef.current.has(pageNum)) {
      return null;
    }
    
    // Check ref cache first (synchronous access)
    if (pageCacheRef.current[pageNum]) {
      return pageCacheRef.current[pageNum];
    }

    fetchingPagesRef.current.add(pageNum);
    
    try {
      const response = await fetch(`${API_BASE}/api/mushafs/${mushafId}/pages/${pageNum}`);
      if (!response.ok) {
        throw new Error(`HTTP error! status: ${response.status}`);
      }
      const data = await response.json();
      
      // Cache the page in both ref and state
      pageCacheRef.current[pageNum] = data;
      setPageCache((prev) => ({
        ...prev,
        [pageNum]: data,
      }));

      // If this is the current page, update it immediately
      if (pageNum === currentPage) {
        setPage(data);
        if (showLoading) {
          setLoading(false);
        }
      }
      
      return data;
    } catch (err) {
      // Only log errors for current page or if it's a CORS error on web
      const isCorsError = err.message.includes('Failed to fetch') || err.message.includes('CORS');
      const isCurrentPage = pageNum === currentPage;
      
      if (isCurrentPage || (isCorsError && Platform.OS === 'web')) {
        const errorMessage = isCorsError && Platform.OS === 'web'
          ? 'CORS error: API server does not allow requests from this origin. This is normal for web development. The app works on iOS/Android.'
          : err.message;
        
        if (isCurrentPage) {
          console.error(`Error fetching page ${pageNum}:`, err);
          setError(errorMessage);
          if (showLoading) {
            setLoading(false);
          }
        } else if (isCorsError && Platform.OS === 'web') {
          // Silently handle CORS errors for pre-fetched pages on web
          // This is expected behavior when API doesn't allow CORS
        }
      }
      return null;
    } finally {
      fetchingPagesRef.current.delete(pageNum);
    }
  };

  // Function to fetch variations for a page
  const fetchVariationsForPage = async (pageData, pageNum, isBackground = false) => {
    if (!pageData || !pageData.lines) return;

    try {
      const wordIds = pageData.lines.flatMap((line) =>
        line.words.map((word) => word.id)
      );

      if (wordIds.length > 0) {
        const response = await fetch(
          `${VARIATIONS_URL}?word_ids=${wordIds.join(",")}`
        );
        if (response.ok) {
          const variations = await response.json();

          // Convert variations to the format expected by the UI
          const variationsMap = {};
          const savedKeys = [];

          variations.forEach((variation) => {
            const key = `${variation.word_id}-${variation.narrator_id}`;
            variationsMap[key] = variation.content;
            savedKeys.push(key);
          });

          // Cache variations for this page in both ref and state
          const cacheData = { variationsMap, savedKeys };
          variationCacheRef.current[pageNum] = cacheData;
          setVariationCache((prev) => ({
            ...prev,
            [pageNum]: cacheData,
          }));

          // Only update current variations if this is the current page
          if (pageNum === currentPage) {
            setAllVariations(variationsMap);
            setSavedVariations(savedKeys);
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching variations for page ${pageNum}:`, err);
    }
  };

  // Pre-fetch pages around current page
  const preFetchPages = (centerPage) => {
    const pagesToFetch = [];
    for (let i = Math.max(1, centerPage - 5); i <= centerPage + 5; i++) {
      if (!pageCacheRef.current[i] && !fetchingPagesRef.current.has(i)) {
        pagesToFetch.push(i);
      }
    }

    // Fetch all pages in parallel
    pagesToFetch.forEach((pageNum) => {
      fetchAndCachePage(pageNum, false);
    });
  };

  // Main effect: handle page changes with caching
  useEffect(() => {
    // Check if page is in ref cache (synchronous check)
    const cachedPage = pageCacheRef.current[currentPage];
    if (cachedPage) {
      // Page is cached, show it immediately
      setPage(cachedPage);
      setLoading(false);
      
      // Check if we have cached variations
      const cachedVariations = variationCacheRef.current[currentPage];
      if (cachedVariations) {
        setAllVariations(cachedVariations.variationsMap);
        setSavedVariations(cachedVariations.savedKeys);
      } else if (selectedNarrators.length > 0) {
        // If narrators are selected, do background refresh of variations
        fetchVariationsForPage(cachedPage, currentPage, true);
      }
    } else {
      // Page not in cache, fetch it with loading indicator
      setLoading(true);
      fetchAndCachePage(currentPage, true).then((data) => {
        // After fetching, get variations if narrators are selected
        if (selectedNarrators.length > 0 && data) {
          fetchVariationsForPage(data, currentPage, false);
        }
      });
    }

    // Load next and previous pages for train effect
    const nextPageNum = currentPage + 1;
    const prevPageNum = currentPage - 1;
    
    // Load next page
    const cachedNext = pageCacheRef.current[nextPageNum];
    if (cachedNext) {
      setNextPage(cachedNext);
    } else {
      fetchAndCachePage(nextPageNum, false).then((data) => {
        if (data) setNextPage(data);
      });
    }
    
    // Load previous page
    if (prevPageNum >= 1) {
      const cachedPrev = pageCacheRef.current[prevPageNum];
      if (cachedPrev) {
        setPreviousPage(cachedPrev);
      } else {
        fetchAndCachePage(prevPageNum, false).then((data) => {
          if (data) setPreviousPage(data);
        });
      }
    } else {
      setPreviousPage(null);
    }

    // Pre-fetch surrounding pages
    preFetchPages(currentPage);
  }, [currentPage, mushafId]);

  // Background refresh variations when narrators change (if on a cached page)
  useEffect(() => {
    const cachedPage = pageCacheRef.current[currentPage];
    if (cachedPage && selectedNarrators.length > 0) {
      // Always refresh variations when narrators change (they might have new selections)
      fetchVariationsForPage(cachedPage, currentPage, true);
    }
  }, [selectedNarrators, currentPage]);

  // Variations on current page for first selected narrator (for bottom traversal bar)
  const firstSelectedNarratorId = selectedNarrators.find((id) => id !== "hafs-an-asim") ?? null;
  const firstNarratorTitle = useMemo(() => {
    if (!firstSelectedNarratorId) return "";
    for (const parent of parentNarrators) {
      const child = parent.children.find((c) => c.id === firstSelectedNarratorId);
      if (child) return child.title ?? "";
    }
    return "";
  }, [firstSelectedNarratorId, parentNarrators]);
  const isShubahHighlight = useMemo(() => {
    if (!firstNarratorTitle) return false;
    return /shu'?bah/i.test(firstNarratorTitle);
  }, [firstNarratorTitle]);
  const currentSurahNumber =
    surahSegments[currentSurahIndex]?.fields?.category_position ?? null;
  const shubahBottomPlayRef = useRef(null);
  const shubahHasTimestamp = useMemo(() => {
    if (!isShubahHighlight || !currentSurahNumber || !selectedWord) return false;
    const lineWords = Array.isArray(selectedWord.lineWords)
      ? selectedWord.lineWords
      : [];
    const wordText = selectedWord.content;
    if (!wordText) return false;
    const idx =
      lineWords.findIndex((w) => w.id === selectedWord.id) >= 0
        ? lineWords.findIndex((w) => w.id === selectedWord.id)
        : selectedWord.position ?? null;
    const contextSequence =
      idx !== null && idx >= 0
        ? [
            lineWords[idx - 1]?.content,
            wordText,
            lineWords[idx + 1]?.content,
          ].filter(Boolean)
        : [wordText].filter(Boolean);
    try {
      const segment = getWordSegmentForText(currentSurahNumber, wordText, {
        contextSequence,
      });
      return (
        !!segment &&
        typeof segment.start === "number" &&
        typeof segment.end === "number"
      );
    } catch (e) {
      return false;
    }
  }, [isShubahHighlight, currentSurahNumber, selectedWord]);

  // Animate bottom variation bar in/out when sheet expands or collapses
  useEffect(() => {
    Animated.timing(variationBarAnim, {
      toValue: isVariationBottomSheetExpanded ? 1 : 0,
      duration: 220,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start();
  }, [isVariationBottomSheetExpanded, variationBarAnim]);

  // Ensure variations bottom sheet defaults open whenever a non-Hafs narrator is selected
  useEffect(() => {
    if (firstSelectedNarratorId && allMushafVariations.length > 0) {
      setIsVariationBottomSheetVisible(true);
    } else {
      setIsVariationBottomSheetVisible(false);
    }
  }, [firstSelectedNarratorId, allMushafVariations.length]);
  // All variations for first narrator (full mushaf) - used for traversal
  const narratorVariations = useMemo(() => {
    if (!firstSelectedNarratorId || allMushafVariations.length === 0) return [];
    const narratorId =
      typeof firstSelectedNarratorId === "number"
        ? firstSelectedNarratorId
        : parseInt(firstSelectedNarratorId, 10);
    const validId = !isNaN(narratorId) ? narratorId : firstSelectedNarratorId;
    return allMushafVariations.filter(
      (v) =>
        v.narrator_id === validId ||
        v.narrator?.id === validId ||
        String(v.narrator_id) === String(firstSelectedNarratorId) ||
        String(v.narrator?.id) === String(firstSelectedNarratorId)
    );
  }, [allMushafVariations, firstSelectedNarratorId]);

  // Current variation index derived from Narration Changes active state (lastSelectedVariationHighlight)
  const currentVariationIndex = useMemo(() => {
    if (narratorVariations.length === 0) return 0;
    if (lastSelectedVariationHighlight) {
      const idx = narratorVariations.findIndex(
        (v) =>
          v.word?.id === lastSelectedVariationHighlight.wordId &&
          (v.word?.line?.page?.position ?? 0) === lastSelectedVariationHighlight.pageNum
      );
      if (idx >= 0) return idx;
    }
    // Fallback: try selectedWordId + currentPage
    if (selectedWordId) {
      const idx = narratorVariations.findIndex(
        (v) =>
          v.word?.id === selectedWordId &&
          (v.word?.line?.page?.position ?? 0) === currentPage
      );
      if (idx >= 0) return idx;
    }
    // Fallback: first variation on current page
    const idx = narratorVariations.findIndex(
      (v) => (v.word?.line?.page?.position ?? 0) === currentPage
    );
    return idx >= 0 ? idx : 0;
  }, [narratorVariations, lastSelectedVariationHighlight, selectedWordId, currentPage]);

  const currentPageVariations = useMemo(
    () =>
      narratorVariations.filter(
        (v) => (v.word?.line?.page?.position ?? 0) === currentPage
      ),
    [narratorVariations, currentPage]
  );

  // When page changes (e.g. via swipe) or variations load, sync active state to first variation on current page
  useEffect(() => {
    if (currentPageVariations.length === 0) return;
    const first = currentPageVariations[0];
    if (
      !lastSelectedVariationHighlight ||
      lastSelectedVariationHighlight.pageNum !== currentPage
    ) {
      setLastSelectedVariationHighlight({
        wordId: first?.word?.id,
        pageNum: currentPage,
      });
      if (first?.word?.id) {
        setSelectedWordId(first.word.id);
        setSelectedWord({ id: first.word.id, content: first.word.content });
      }
    }
  }, [currentPage, currentPageVariations.length]);

  // Sync Juz and Surah indices with current page (array is sorted descending for RTL)
  useEffect(() => {
    // Find current Juz (array is sorted descending: highest page first)
    // Find the Juz where first_page <= currentPage <= last_page
    let juzIndex = juzSegments.length - 1; // Default to last (lowest page)
    for (let i = 0; i < juzSegments.length; i++) {
      const juz = juzSegments[i];
      if (currentPage >= juz.fields.first_page && currentPage <= juz.fields.last_page) {
        juzIndex = i;
        break;
      }
      // If currentPage is less than this Juz's first_page, continue to next (lower page number)
      // If we reach the end without a match, use the last index (lowest page)
    }
    setCurrentJuzIndex(juzIndex);

    // Find current Surah (array is sorted descending: highest page first)
    let surahIndex = surahSegments.length - 1; // Default to last (lowest page)
    for (let i = 0; i < surahSegments.length; i++) {
      const surah = surahSegments[i];
      if (currentPage >= surah.fields.first_page && currentPage <= surah.fields.last_page) {
        surahIndex = i;
        break;
      }
      // If currentPage is less than this Surah's first_page, continue to next (lower page number)
      // If we reach the end without a match, use the last index (lowest page)
    }
    setCurrentSurahIndex(surahIndex);
  }, [currentPage, juzSegments, surahSegments]);

  // Scroll carousels to center the selected item
  const scrollCarouselsToCenter = useCallback(() => {
    if (!showPageSlider) return;
    const itemWidth = CAROUSEL_ITEM_WIDTH;
    // Juz carousel
    const juzWidth = juzCarouselWidthRef.current || Dimensions.get('window').width * 0.7;
    if (juzScrollViewRef.current && currentJuzIndex < juzSegments.length) {
      const scrollX = Math.max(0, (currentJuzIndex * itemWidth) - (juzWidth / 2) + (itemWidth / 2));
      juzScrollViewRef.current.scrollTo({ x: scrollX, animated: true });
    }
    // Surah carousel
    const surahWidth = surahCarouselWidthRef.current || Dimensions.get('window').width * 0.7;
    if (surahScrollViewRef.current && currentSurahIndex < surahSegments.length) {
      const scrollX = Math.max(0, (currentSurahIndex * itemWidth) - (surahWidth / 2) + (itemWidth / 2));
      surahScrollViewRef.current.scrollTo({ x: scrollX, animated: true });
    }
  }, [showPageSlider, currentJuzIndex, currentSurahIndex, juzSegments.length, surahSegments.length]);

  // Scroll carousels when modal opens or selection changes
  useEffect(() => {
    if (showPageSlider) {
      setSliderValue(currentPage);
      const timer = setTimeout(scrollCarouselsToCenter, 150);
      return () => clearTimeout(timer);
    }
  }, [showPageSlider, currentPage, currentJuzIndex, currentSurahIndex, scrollCarouselsToCenter]);

  // Expose a reusable refresher for variations (used after save/delete)
  const refreshVariations = async () => {
    try {
      if (page && page.lines) {
        const wordIds = page.lines.flatMap((line) =>
          line.words.map((word) => word.id)
        );
        if (wordIds.length > 0) {
          const response = await fetch(
            `${VARIATIONS_URL}?word_ids=${wordIds.join(",")}`
          );
          if (response.ok) {
            const variations = await response.json();
            const variationsMap = {};
            const savedKeys = [];
            variations.forEach((variation) => {
              const key = `${variation.word_id}-${variation.narrator_id}`;
              variationsMap[key] = variation.content;
              savedKeys.push(key);
            });
            setAllVariations(variationsMap);
            setSavedVariations(savedKeys);
            
            // Update cache for current page in both ref and state
            const cacheData = { variationsMap, savedKeys };
            variationCacheRef.current[currentPage] = cacheData;
            setVariationCache((prev) => ({
              ...prev,
              [currentPage]: cacheData,
            }));
          }
        }
      }
    } catch (err) {
      console.error("Error refreshing variations:", err);
    }
  };

  useEffect(() => {
    const fetchNarrators = async () => {
      try {
        const response = await fetch(NARRATORS_URL);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Create synthetic "Hafs 'an 'Asim" narrator (frontend-only)
        const hafsNarrator = {
          id: "hafs-an-asim", // Special ID for frontend-only narrator
          title: "Hafs",
          highlight_color: "#00d4ff",
          region: { title: "Kufa" },
        };
        
        // Transform nested API data into parent-child structure
        // Group children by their parent narrator
        const parentMap = new Map();
        
        data.forEach((childNarrator) => {
          if (childNarrator.narrator_id && childNarrator.narrator) {
            const parentId = childNarrator.narrator.id;
            if (!parentMap.has(parentId)) {
              parentMap.set(parentId, {
                id: parentId,
                title: childNarrator.narrator.title,
                highlight_color: childNarrator.narrator.highlight_color,
                region: childNarrator.narrator.region,
                children: [],
              });
            }
            parentMap.get(parentId).children.push({
              id: childNarrator.id,
              title: childNarrator.title,
              highlight_color: childNarrator.highlight_color,
              region: childNarrator.region,
            });
          }
        });
        
        // Convert map to array and sort
        const parents = Array.from(parentMap.values()).sort((a, b) => 
          a.title.localeCompare(b.title)
        );
        
        // Find Aasim and add Hafs as the first child
        const asimIndex = parents.findIndex(p => {
          const titleLower = p.title.toLowerCase();
          return titleLower.includes("asim") || 
                 titleLower.includes("aasim") ||
                 titleLower.includes("asem") ||
                 titleLower === "aasim";
        });
        
        if (asimIndex !== -1) {
          // Add Hafs as the first child of Aasim
          parents[asimIndex].children.unshift({
            id: "hafs-an-asim",
            title: "Hafs",
            highlight_color: "#00d4ff",
            region: { title: "Kufa" },
            isHafs: true, // Mark as Hafs for special handling
          });
        }
        
        setParentNarrators(parents);
        
        // Expand all parents by default
        const allParentIds = parents.map(p => p.id);
        setExpandedParents(new Set(allParentIds));
        
        // Flatten all narrators (children only - those with narrator_id and narrator)
        // Filter out parent narrators (those without narrator_id or narrator)
        const allChildNarrators = data
          .filter((child) => child.narrator_id && child.narrator) // Only include child narrators
          .map((child) => ({
            id: child.id,
            title: child.title,
            highlight_color: child.highlight_color,
            region: child.region,
          }));
        
        setNarrators([hafsNarrator, ...allChildNarrators]);

        // Load saved narrator selections (AsyncStorage on native, localStorage on web)
        let savedNarrators = [];
        try {
          if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            const saved = localStorage.getItem("selectedNarrators");
            if (saved) savedNarrators = JSON.parse(saved);
          } else {
            const saved = await AsyncStorage.getItem("selectedNarrators");
            if (saved) savedNarrators = JSON.parse(saved);
          }
        } catch (err) {
          console.error("Error loading saved narrators:", err);
        }
        
        // Always ensure Hafs is selected
        if (savedNarrators.length === 0) {
          setSelectedNarrators([hafsNarrator.id]);
          // Save the default selection
          try {
            if (Platform.OS === "web" && typeof localStorage !== "undefined") {
              localStorage.setItem("selectedNarrators", JSON.stringify([hafsNarrator.id]));
            } else {
              await AsyncStorage.setItem("selectedNarrators", JSON.stringify([hafsNarrator.id]));
            }
          } catch (err) {
            console.error("Error saving default narrator:", err);
          }
        } else {
          // Ensure Hafs is always in the selection
          const hasHafs = savedNarrators.includes(hafsNarrator.id);
          if (!hasHafs) {
            const updatedSelection = [hafsNarrator.id, ...savedNarrators];
            setSelectedNarrators(updatedSelection);
            // Save the updated selection
            try {
              if (Platform.OS === "web" && typeof localStorage !== "undefined") {
                localStorage.setItem("selectedNarrators", JSON.stringify(updatedSelection));
              } else {
                await AsyncStorage.setItem("selectedNarrators", JSON.stringify(updatedSelection));
              }
            } catch (err) {
              console.error("Error saving updated narrator selection:", err);
          }
        } else {
          setSelectedNarrators(savedNarrators);
          }
        }
      } catch (err) {
        console.error("Error fetching narrators:", err);
      }
    };

    fetchNarrators();
  }, []);

  // Save narrator selections whenever they change
  useEffect(() => {
    const persist = async () => {
      // Always ensure Hafs is in the selection before saving
      const selectionToSave = selectedNarrators.includes("hafs-an-asim")
        ? selectedNarrators
        : ["hafs-an-asim", ...selectedNarrators];
      
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          localStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectionToSave)
          );
        } else {
          await AsyncStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectionToSave)
          );
        }
      } catch (err) {
        console.error("Error saving selected narrators:", err);
      }
    };
    persist();
  }, [selectedNarrators]);

  const handleWordPress = (word) => {
    try {
      // Temporary debug logging for Shu'bah word audio work
      console.log("🔍 Held word info:", {
        id: word?.id,
        content: word?.content,
        rawWord: word,
        currentPage,
      });
    } catch (e) {
      // Ignore logging errors
    }

    setSelectedWord(word);
    setSelectedWordId(word.id);
    if (word.layout) {
      setWordPosition(word.layout);
    }
    setPopupVisible(true);
    setSelectedNarrator(null);
    setInputValue(word.content);
    // Sync Narration Changes active state when user taps a word that has a variation
    const hasVariation = narratorVariations.some(
      (v) => v.word?.id === word.id && (v.word?.line?.page?.position ?? 0) === currentPage
    );
    if (hasVariation) {
      setLastSelectedVariationHighlight({ wordId: word.id, pageNum: currentPage });
    }
  };

  const handleSelectNarrator = (narrator) => {
    setSelectedNarrator(narrator);

    if (narrator && selectedWord) {
      // Check if there's an existing variation for this word and narrator
      const variationKey = `${selectedWord.id}-${narrator.id}`;
      const existingVariation = allVariations[variationKey];

      if (existingVariation) {
        // Populate input with existing variation content
        setInputValue(existingVariation);
      } else {
        // Default to original word content
        setInputValue(selectedWord.content);
      }
    }
  };

  const handleClosePopup = () => {
    setPopupVisible(false);
    setSelectedNarrator(null);
    setInputValue("");
    setSelectedWordId(null);
    setWordPosition(null);
  };

  const handlePageChange = (newPage) => {
    const pageNum = parseInt(newPage);
    if (pageNum > 0) {
      setCurrentPage(pageNum);
      setPageInput(newPage);
      syncPagerToPage(pageNum);
      // Loading state is handled by useEffect based on cache
    }
  };

  const handlePreviousPage = () => {
    const page = currentPageRef.current;
    if (page > 1) {
      const newPage = page - 1;
      console.log("handlePreviousPage: going from", page, "to", newPage);
      setCurrentPage(newPage);
      setPageInput(newPage.toString());
      syncPagerToPage(newPage);
      // Loading state is handled by useEffect based on cache
    }
  };

  const handleNextPage = () => {
    const page = currentPageRef.current;
    const newPage = page + 1;
    console.log("handleNextPage: going from", page, "to", newPage);
    setCurrentPage(newPage);
    setPageInput(newPage.toString());
    syncPagerToPage(newPage);
    // Loading state is handled by useEffect based on cache
  };

  // Update handler refs whenever handlers are recreated
  useEffect(() => {
    handlePreviousPageRef.current = handlePreviousPage;
    handleNextPageRef.current = handleNextPage;
  });

  const handlePageInputChange = (text) => {
    setPageInput(text);
  };

  // Helper function to find which parent a child narrator belongs to
  const findParentForChild = (childId) => {
    // Hafs belongs to Aasim
    if (childId === "hafs-an-asim") {
      return parentNarrators.find(p => {
        const titleLower = p.title.toLowerCase();
        return titleLower.includes("asim") || 
               titleLower.includes("aasim") ||
               titleLower.includes("asem");
      });
    }
    
    // Find parent by checking all parent narrators' children
    for (const parent of parentNarrators) {
      if (parent.children.some(child => child.id === childId)) {
        return parent;
      }
    }
    return null;
  };

  const handleToggleNarrator = (narratorId) => {
    // Prevent toggling Hafs off - it's always selected
    if (narratorId === "hafs-an-asim") {
      return; // Do nothing - Hafs is always selected
    }
    
    setSelectedNarrators((prev) => {
      // Ensure Hafs is always in the selection
      const hasHafs = prev.includes("hafs-an-asim");
      const withoutHafs = prev.filter((id) => id !== "hafs-an-asim");
      
      // Find the parent of the clicked narrator
      const clickedParent = findParentForChild(narratorId);
      if (!clickedParent) {
        return prev; // If we can't find the parent, don't change selection
      }
      
      // Find which parent the currently selected children belong to (excluding Hafs)
      let currentParentId = null;
      if (withoutHafs.length > 0) {
        const firstSelectedChild = withoutHafs[0];
        const firstSelectedParent = findParentForChild(firstSelectedChild);
        if (firstSelectedParent) {
          currentParentId = firstSelectedParent.id;
        }
      }
      
        // If clicking any other narrator
      if (withoutHafs.includes(narratorId)) {
        // Deselecting narrator - only allow if it's from the same parent
        if (currentParentId === clickedParent.id) {
          const newSelection = withoutHafs.filter((id) => id !== narratorId);
          // Always include Hafs
          return ["hafs-an-asim", ...newSelection];
        }
        return prev; // Can't deselect if it's the only one from that parent
        } else {
        // Selecting narrator
        // If clicking a child from a different parent, clear all other selections
        if (currentParentId && currentParentId !== clickedParent.id) {
          // Clear all selections from other parents, keep only Hafs and the new selection
          return ["hafs-an-asim", narratorId];
        } else {
          // Same parent - add to selection
          return ["hafs-an-asim", ...withoutHafs, narratorId];
        }
      }
    });
  };

  const handleToggleParent = (parentId) => {
    setExpandedParents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(parentId)) {
        newSet.delete(parentId);
      } else {
        newSet.add(parentId);
      }
      return newSet;
    });
  };

  const handleResetToHafs = () => {
    // Reset to only Hafs (which is always selected)
    setSelectedNarrators(["hafs-an-asim"]);
  };

  const handleSaveVariation = async (variationKey) => {
    if (!variationKey || !selectedWord || !selectedNarrator) return;

    const isCurrentlySaved = savedVariations.includes(variationKey);

    try {
      if (isCurrentlySaved) {
        // Delete variation on API then unsave locally
        try {
          await fetch(
            `${VARIATIONS_URL}/by_keys?word_id=${selectedWord.id}&narrator_id=${selectedNarrator.id}`,
            { method: "DELETE" }
          );
        } catch (e) {
          console.error(
            "API delete variation failed (continuing to update UI):",
            e
          );
        }

        setSavedVariations((prev) =>
          prev.filter((key) => key !== variationKey)
        );
        setAllVariations((prev) => {
          const newVariations = { ...prev };
          delete newVariations[variationKey];
          return newVariations;
        });
      } else {
        // Save variation to API
        const response = await fetch(VARIATIONS_URL, {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            variation: {
              content: inputValue,
              word_id: selectedWord.id,
              narrator_id: selectedNarrator.id,
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        const savedVariation = await response.json();

        // Update local state
        setAllVariations((prev) => ({
          ...prev,
          [variationKey]: inputValue,
        }));

        setSavedVariations((prev) => [...prev, variationKey]);

        // Ensure sessions are synced
        await refreshVariations();
      }
    } catch (error) {
      console.error("Error saving variation:", error);
      // You might want to show an error message to the user here
    }
  };

  const handleDeleteVariation = async () => {
    if (!selectedWord || !selectedNarrator) return;
    const variationKey = `${selectedWord.id}-${selectedNarrator.id}`;
    
    // Optimistically update local state first
    setAllVariations((prev) => {
      const newVariations = { ...prev };
      delete newVariations[variationKey];
      return newVariations;
    });
    setSavedVariations((prev) => prev.filter((k) => k !== variationKey));
    setInputValue(selectedWord.content);
    
    try {
      // Then delete from API
      const response = await fetch(
        `${VARIATIONS_URL}/by_keys?word_id=${selectedWord.id}&narrator_id=${selectedNarrator.id}`,
        { method: "DELETE" }
      );
      
      if (response.ok || response.status === 204) {
        // Deletion successful - refresh to sync with server
        // Use a small delay to ensure server has processed the deletion
        setTimeout(async () => {
          await refreshVariations();
        }, 100);
      } else {
        // If deletion failed, re-fetch to restore correct state from server
        console.error("Failed to delete variation on server, status:", response.status);
        await refreshVariations();
      }
    } catch (e) {
      console.error("Error deleting variation:", e);
      // On network error, refresh to get server state after a delay
      // This gives the server time to process if it's a temporary issue
      setTimeout(async () => {
        await refreshVariations();
      }, 500);
    }
  };

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <Text style={styles.errorHint}>
          Make sure the Rails server is running at http://localhost:3000
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Loading font...</Text>
      </View>
    );
  }

  // Bottom inset for home indicator so bar can extend to screen bottom without overlap
  const bottomBarInset = Platform.OS === "ios" ? 34 : 0;

  return (
    <SafeAreaProvider>
      <GestureHandlerRootView style={{ flex: 1 }}>
        <StatusBar barStyle={isMushafDarkMode ? "light-content" : "dark-content"} />
        <SafeAreaViewEdged
          edges={["top"]}
          style={[
            styles.safeArea,
            isMushafDarkMode && styles.safeAreaDark,
          ]}
        >
        {currentTab !== "Recite" && (
          <View style={styles.navBar}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={openDrawer}
              style={styles.navButton}
            >
              <Text style={styles.navIcon}>☰</Text>
            </TouchableOpacity>
            <Text style={styles.navTitle}>{currentTab}</Text>
            <View style={styles.navRightSpacer} />
          </View>
        )}

        <View
          style={[
            styles.mainContainer,
            isMushafDarkMode && styles.mainContainerDark,
          ]}
        >
          {currentTab === "Recite" && (
            <>
              {/* Top bar with selected narrators */}
              <View style={styles.mushafTopBar}>
                <TouchableOpacity
                  onPress={isDrawerFullyOpen ? closeDrawer : openDrawer}
                  style={styles.mushafMenuButton}
                >
                  <Text style={styles.mushafMenuIcon}>☰</Text>
                </TouchableOpacity>
                
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  contentContainerStyle={styles.mushafNarratorPills}
                >
                  {selectedNarrators
                    .filter(id => id !== "hafs-an-asim") // Exclude Hafs from pills
                    .map((narratorId) => {
                      // Find narrator details
                      let narrator = null;
                      for (const parent of parentNarrators) {
                        const child = parent.children.find(c => c.id === narratorId);
                        if (child) {
                          narrator = child;
                          break;
                        }
                      }
                      // Also check in the flat narrators list
                      if (!narrator) {
                        narrator = narrators.find(n => n.id === narratorId);
                      }
                      
                      if (!narrator) return null;
                      
                      const highlightColor = narrator.highlight_color || "#00d4ff";
                      
                      return (
                        <View
                          key={narratorId}
                          style={[
                            styles.mushafNarratorPill,
                            { borderColor: highlightColor },
                          ]}
                        >
                          <Text
                            style={[
                              styles.mushafNarratorPillText,
                              { color: highlightColor },
                            ]}
                          >
                            {narrator.title}
                          </Text>
                        </View>
                      );
                    })}
                </ScrollView>
                
                <View style={styles.mushafRightIcons}>
                  <Text style={styles.mushafPageIndicator}>Pg. {currentPage}</Text>
                  <TouchableOpacity 
                    style={styles.mushafIconButton}
                    onPress={() => setShowPageSlider(true)}
                  >
                    <Search stroke="#ffffff" width={20} height={20} />
                  </TouchableOpacity>
                  {selectedNarrators.some((id) => id !== "hafs-an-asim") && (
                    <TouchableOpacity 
                      style={styles.mushafIconButton}
                      onPress={isVariationsSidebarOpen ? closeVariationsSidebar : openVariationsSidebar}
                    >
                      <Sidebar stroke="#ffffff" width={20} height={20} />
                    </TouchableOpacity>
                  )}
                  <TouchableOpacity 
                    style={styles.mushafIconButton}
                    onPress={() => {}}
                  >
                    <Bookmark stroke="#ffffff" width={20} height={20} />
                  </TouchableOpacity>
                </View>
              </View>
              
              <View style={styles.contentContainer}>
                <PagerView
                  ref={pagerRef}
                  style={{ flex: 1 }}
                  // RTL: initial index is inverted so higher page numbers appear on the left
                  initialPage={Math.max(0, TOTAL_PAGES - currentPage)}
                  onPageSelected={(e) => {
                    const position = e.nativeEvent.position ?? 0;
                    // RTL: pager index is inverted into page number
                    const newPageNum = TOTAL_PAGES - position;
                    if (newPageNum !== currentPageRef.current) {
                      setCurrentPage(newPageNum);
                      setPageInput(String(newPageNum));
                    }
                  }}
                >
                  {Array.from({ length: TOTAL_PAGES }).map((_, idx) => {
                    // RTL: index 0 shows last page, index TOTAL_PAGES - 1 shows first page
                    const pageNum = TOTAL_PAGES - idx;
                    const cachedPage = pageCacheRef.current[pageNum];
                    const isCurrent = pageNum === currentPage;
                    const pageData = cachedPage;
                    const isLoading = isCurrent && (!pageData || loading);

                    return (
                      <View key={String(pageNum)} style={styles.pageViewContainer}>
                        <PageView
                          page={pageData}
                          onWordPress={isCurrent ? handleWordPress : () => {}}
                          selectedWordId={isCurrent ? selectedWordId : null}
                          loading={isLoading}
                          savedVariations={isCurrent ? savedVariations : []}
                          selectedNarrators={selectedNarrators}
                          allVariations={isCurrent ? allVariations : {}}
                          highlightFirstLine={juzSegments.some(
                            (j) => j.fields.first_page === pageNum
                          )}
                          isDarkMode={isMushafDarkMode}
                          mushafId={mushafId}
                        />
                      </View>
                    );
                  })}
                </PagerView>
              </View>

              {/* Variations bottom sheet - sits under the traversal bar */}
              <VariationBottomSheet
                isVisible={currentTab === "Recite" && isVariationBottomSheetVisible}
                variations={allMushafVariations}
                currentPage={currentPage}
                lastSelectedVariationHighlight={lastSelectedVariationHighlight}
                mushafId={mushafId}
                getQuranFontFamily={getQuranFontFamily}
                onExpandedChange={setIsVariationBottomSheetExpanded}
                onSelectVariation={(variation, { pageNum, wordId }) => {
                  setLastSelectedVariationHighlight(
                    wordId != null ? { wordId, pageNum } : null
                  );
                  setCurrentPage(pageNum);
                  setPageInput(String(pageNum));
                  handlePageChange(String(pageNum));
                  setSelectedWordId(wordId ?? null);
                  setSelectedWord(
                    variation.word
                      ? { id: variation.word.id, content: variation.word.content }
                      : null
                  );
                }}
              />

              {/* Bottom bar: variation traversal when narrator selected, else prompt to select */}
              {firstSelectedNarratorId ? (
                <Animated.View
                  style={[
                    styles.variationTraversalBar,
                    {
                      paddingBottom: RECITE_BOTTOM_BAR_PADDING_BOTTOM + bottomBarInset,
                      opacity: variationBarAnim.interpolate({
                        inputRange: [0, 1],
                        outputRange: [1, 0],
                      }),
                      transform: [
                        {
                          translateY: variationBarAnim.interpolate({
                            inputRange: [0, 1],
                            outputRange: [0, 60],
                          }),
                        },
                      ],
                    },
                  ]}
                  onStartShouldSetResponder={() => true}
                  onResponderRelease={() => {
                    if (allMushafVariations.length > 0) {
                      setIsVariationBottomSheetVisible(true);
                    }
                  }}
                >
                  {/* Left arrow - next variation */}
                  <TouchableOpacity
                    style={[
                      styles.variationTraversalArrowButton,
                      narratorVariations.length === 0 && styles.variationTraversalArrowButtonDisabled,
                    ]}
                    disabled={narratorVariations.length === 0}
                    onPress={() => {
                      if (narratorVariations.length === 0) return;
                      const next =
                        (currentVariationIndex + 1) % narratorVariations.length;
                      const v = narratorVariations[next];
                      const pageNum = v.word?.line?.page?.position ?? currentPage;
                      setLastSelectedVariationHighlight(
                        v?.word?.id ? { wordId: v.word.id, pageNum } : null
                      );
                      setCurrentPage(pageNum);
                      setPageInput(String(pageNum));
                      handlePageChange(String(pageNum));
                      if (v?.word?.id) {
                        setSelectedWordId(v.word.id);
                        setSelectedWord({ id: v.word.id, content: v.word.content });
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.variationTraversalArrowButtonText,
                        narratorVariations.length === 0 && styles.variationTraversalArrowDisabled,
                      ]}
                    >
                      ‹
                    </Text>
                  </TouchableOpacity>

                  {/* Centered segmented control: Hafs | Shubah */}
                  <View style={styles.variationTraversalSegmentedControl}>
                    <View style={styles.variationTraversalSegment}>
                      <Text style={styles.variationTraversalSegmentLabel}>Hafs</Text>
                      <Text
                        style={[styles.variationTraversalSegmentText, { fontFamily: getQuranFontFamily(mushafId) }]}
                        numberOfLines={1}
                      >
                        {narratorVariations[currentVariationIndex]?.word?.content ??
                          (narratorVariations.length === 0 ? "—" : "")}
                      </Text>
                    </View>
                    <Text style={styles.variationTraversalSegmentDivider}>›</Text>
                    <TouchableOpacity
                      activeOpacity={0.85}
                      onPress={() => {
                        if (
                          isShubahHighlight &&
                          currentSurahNumber &&
                          selectedWord &&
                          shubahBottomPlayRef.current?.play
                        ) {
                          shubahBottomPlayRef.current.play();
                        }
                      }}
                      style={[
                        styles.variationTraversalSegment,
                        styles.variationTraversalSegmentActive,
                        styles.variationTraversalSegmentPlayable,
                      ]}
                    >
                      <Text style={styles.variationTraversalSegmentLabel}>
                        {firstNarratorTitle || narratorVariations[0]?.narrator?.title || "Narrator"}
                      </Text>
                      <View style={styles.variationTraversalNarratorRow}>
                        <Text
                          style={[
                            styles.variationTraversalSegmentText,
                            styles.variationTraversalSegmentTextActive,
                            { fontFamily: getQuranFontFamily(mushafId) },
                          ]}
                          numberOfLines={1}
                        >
                          {narratorVariations[currentVariationIndex]?.content ??
                            (narratorVariations.length === 0
                              ? "No variations on this page"
                              : "")}
                        </Text>
                        {isShubahHighlight &&
                          currentSurahNumber &&
                          selectedWord && (
                            <View style={styles.variationTraversalPlayWrapper}>
                              <ShubahWordAudioButton
                                ref={shubahBottomPlayRef}
                                word={selectedWord}
                                surahNumber={currentSurahNumber}
                                showIcon={false}
                              />
                            </View>
                          )}
                      </View>
                      {shubahHasTimestamp && (
                        <View style={styles.variationTraversalPlayIndicator}>
                          <Text style={styles.variationTraversalPlayIndicatorIcon}>
                            ▶
                          </Text>
                        </View>
                      )}
                    </TouchableOpacity>
                  </View>

                  {/* Right arrow - previous variation */}
                  <TouchableOpacity
                    style={[
                      styles.variationTraversalArrowButton,
                      narratorVariations.length === 0 && styles.variationTraversalArrowButtonDisabled,
                    ]}
                    disabled={narratorVariations.length === 0}
                    onPress={() => {
                      if (narratorVariations.length === 0) return;
                      const prev =
                        (currentVariationIndex - 1 + narratorVariations.length) %
                        narratorVariations.length;
                      const v = narratorVariations[prev];
                      const pageNum = v.word?.line?.page?.position ?? currentPage;
                      setLastSelectedVariationHighlight(
                        v?.word?.id ? { wordId: v.word.id, pageNum } : null
                      );
                      setCurrentPage(pageNum);
                      setPageInput(String(pageNum));
                      handlePageChange(String(pageNum));
                      if (v?.word?.id) {
                        setSelectedWordId(v.word.id);
                        setSelectedWord({ id: v.word.id, content: v.word.content });
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.variationTraversalArrowButtonText,
                        narratorVariations.length === 0 && styles.variationTraversalArrowDisabled,
                      ]}
                    >
                      ›
                    </Text>
                  </TouchableOpacity>
                </Animated.View>
              ) : (
                <TouchableOpacity
                  style={[styles.noRiwayahBanner, { marginBottom: bottomBarInset }]}
                  onPress={openDrawer}
                  activeOpacity={0.8}
                >
                  <View style={styles.noRiwayahBannerIcon}>
                    <Text style={styles.noRiwayahBannerIconText}>+</Text>
                  </View>
                  <View style={styles.noRiwayahBannerText}>
                    <Text style={styles.noRiwayahBannerTitle}>No Riwaayah Selected</Text>
                    <Text style={styles.noRiwayahBannerSubtitle}>
                      Open menu to compare recitations
                    </Text>
                  </View>
                </TouchableOpacity>
              )}
            </>
          )}

          {currentTab === "Learn" && (
            <View style={styles.learnContainer}>
              {!selectedVideo ? (
                <ScrollView
                  contentContainerStyle={styles.learnScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 5 }).map((_, sectionIdx) => (
                    <View
                      key={`section-${sectionIdx}`}
                      style={styles.learnSection}
                    >
                      <Text style={styles.learnSectionTitle}>{`Course ${
                        sectionIdx + 1
                      }`}</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.learnRow}
                      >
                        {Array.from({ length: 10 }).map((__, videoIdx) => {
                          const title = `Lesson ${videoIdx + 1}`;
                          return (
                            <TouchableOpacity
                              key={`video-${sectionIdx}-${videoIdx}`}
                              style={styles.videoCard}
                              onPress={() => setSelectedVideo({ title })}
                            >
                              <View style={styles.videoThumb}>
                                <View style={styles.playTriangle} />
                              </View>
                              <Text style={styles.videoTitle} numberOfLines={2}>
                                {title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.learnDetailContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.learnDetailHeader}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => setSelectedVideo(null)}
                    >
                      <Text style={styles.backArrow}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.learnDetailTitle}>
                      {selectedVideo.title}
                    </Text>
                    <View style={{ width: 28 }} />
                  </View>

                  <View style={styles.learnVideoWrapper}>
                    <View style={styles.learnVideoSquare}>
                      <View style={styles.playTriangleLarge} />
                    </View>
                  </View>

                  <View style={styles.learnActionRow}>
                    <TouchableOpacity style={styles.learnActionBtn}>
                      <Text style={styles.learnActionIcon}>♡</Text>
                      <Text style={styles.learnActionLabel}>Favorite</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.learnActionBtn}>
                      <Text style={styles.learnActionIcon}>?</Text>
                      <Text style={styles.learnActionLabel}>Question</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.learnDescription}>
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
                    do eiusmod tempor incididunt ut labore et dolore magna
                    aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                    ullamco laboris nisi ut aliquip ex ea commodo consequat.
                    Duis aute irure dolor in reprehenderit in voluptate velit
                    esse cillum dolore eu fugiat nulla pariatur.
                  </Text>
                </ScrollView>
              )}
            </View>
          )}

          {currentTab === "Listen" && (
            <View style={styles.listenPlaceholder}>
              <Text style={styles.listenText}>Listening coming soon</Text>
            </View>
          )}
        </View>
        </SafeAreaViewEdged>

      {isDrawerVisible && (
        <SafeAreaView style={styles.drawerOverlay}>
          <Animated.View
            style={[styles.drawer, { transform: [{ translateX: drawerAnim }] }]}
          >
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeaderTop}>
                <TouchableOpacity
                  style={styles.drawerHeaderIcon}
                  onPress={() => setIsQiraatSettingsVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Open Qiraat settings"
                >
                  <Text style={styles.drawerHeaderIconText}>⚙️</Text>
                </TouchableOpacity>
                <View style={styles.drawerHeaderTextContainer}>
                  <Text style={styles.drawerTitle}>القراءات</Text>
                </View>
              </View>
              {(() => {
                // Check if there are any narrators selected besides Hafs
                const hasOtherNarrators = selectedNarrators.some(id => id !== "hafs-an-asim");
                const isDisabled = !hasOtherNarrators;
                
                return (
                  <TouchableOpacity
                    style={[
                      styles.resetButton,
                      isDisabled && styles.resetButtonDisabled,
                    ]}
                    onPress={isDisabled ? undefined : handleResetToHafs}
                    activeOpacity={isDisabled ? 1 : 0.7}
                    disabled={isDisabled}
                  >
                    <Text style={[
                      styles.resetButtonIcon,
                      isDisabled && styles.resetButtonIconDisabled,
                    ]}>↻</Text>
                    <Text style={[
                      styles.resetButtonText,
                      isDisabled && styles.resetButtonTextDisabled,
                    ]}>Reset to Hafs</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
            <ScrollView
              contentContainerStyle={styles.drawerNarratorsContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Parent narrators with children */}
              {parentNarrators.map((parent) => {
                const isExpanded = expandedParents.has(parent.id);
                return (
                  <View key={parent.id} style={styles.parentCard}>
                  <TouchableOpacity
                      style={styles.parentCardHeader}
                      onPress={() => handleToggleParent(parent.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.parentCardInfo}>
                        <Text style={styles.parentCardTitle}>{parent.title}</Text>
                        <View style={styles.parentCardLocation}>
                          <Text style={styles.locationIcon}>📍</Text>
                          <Text style={styles.parentCardLocationText}>
                            {parent.region?.title || ""}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.chevronIcon}>
                        {isExpanded ? "▼" : "▶"}
                      </Text>
                    </TouchableOpacity>
                    {isExpanded && (
                      <View style={styles.childrenContainer}>
                        <View style={styles.childrenVerticalLine} />
                        <View style={styles.childrenContent}>
                          {parent.children.map((child) => {
                            const isHafs = child.id === "hafs-an-asim";
                            const isSelected = selectedNarrators.includes(child.id);
                            const ChildComponent = isHafs ? View : TouchableOpacity;
                            return (
                              <ChildComponent
                                key={child.id}
                    style={[
                                  styles.childCard,
                                  isHafs && styles.childCardDisabled,
                                ]}
                                onPress={isHafs ? undefined : () => handleToggleNarrator(child.id)}
                                activeOpacity={isHafs ? 1 : 0.7}
                              >
                                <View style={styles.childCardContent}>
                                  <View style={styles.childCardInfo}>
                                    <Text style={styles.childCardTitle}>
                                      {child.title}
                                    </Text>
                                    <View style={styles.childCardLocation}>
                                      <Text style={styles.locationIcon}>📍</Text>
                                      <Text style={styles.childCardLocationText}>
                                        {child.region?.title || ""}
                                      </Text>
                                    </View>
                                  </View>
                      <View
                        style={[
                          styles.drawerCheckbox,
                                      isHafs && styles.drawerCheckboxDisabled,
                                      isSelected && !isHafs && styles.drawerCheckboxSelected,
                                      isSelected && isHafs && styles.drawerCheckboxDisabledSelected,
                        ]}
                      >
                                    {isSelected && (
                                      <Text style={styles.drawerCheckmark}>✓</Text>
                                    )}
                      </View>
                                </View>
                                {isSelected && !isHafs && child.highlight_color && (
                                  <View
                        style={[
                                      styles.childCardBar,
                                      { backgroundColor: child.highlight_color },
                                    ]}
                                  />
                                )}
                              </ChildComponent>
                            );
                          })}
                    </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </Animated.View>
          <Pressable style={styles.drawerBackdrop} onPress={closeDrawer}>
            <Animated.View
              style={[styles.drawerBackdropFill, { opacity: backdropAnim }]}
            />
          </Pressable>
          
          {/* Bottom Navigation Bar - Outside drawer, spans full width */}
          <View style={styles.drawerBottomNav}>
            <TouchableOpacity
              style={styles.drawerNavButton}
              onPress={() => {
                setCurrentTab("Recite");
                closeDrawer();
              }}
            >
              <Text style={[styles.drawerNavIcon, currentTab === "Recite" && styles.drawerNavIconActive]}>
                📖
              </Text>
              <Text style={[styles.drawerNavLabel, currentTab === "Recite" && styles.drawerNavLabelActive]}>
                Mushaf
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.drawerNavButton}
              onPress={() => {
                setCurrentTab("Listen");
                closeDrawer();
              }}
            >
              <Text style={[styles.drawerNavIcon, currentTab === "Listen" && styles.drawerNavIconActive]}>
                🎧
              </Text>
              <Text style={[styles.drawerNavLabel, currentTab === "Listen" && styles.drawerNavLabelActive]}>
                Recitation
              </Text>
            </TouchableOpacity>
            
            <TouchableOpacity
              style={styles.drawerNavButton}
              onPress={() => {
                setCurrentTab("Learn");
                closeDrawer();
              }}
            >
              <Text style={[styles.drawerNavIcon, currentTab === "Learn" && styles.drawerNavIconActive]}>
                📺
              </Text>
              <Text style={[styles.drawerNavLabel, currentTab === "Learn" && styles.drawerNavLabelActive]}>
                Education
              </Text>
            </TouchableOpacity>
          </View>
        </SafeAreaView>
      )}

      {/* Variations sidebar - right-sliding, lists all narration changes for mushaf traversal */}
      {isVariationsSidebarOpen && (
        <SafeAreaView style={styles.variationsSidebarOverlay} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeVariationsSidebar}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.variationsSidebarBackdrop,
                { opacity: variationsSidebarBackdropAnim },
              ]}
            />
          </Pressable>
          <Animated.View
            style={[
              styles.variationsSidebarPanel,
              { transform: [{ translateX: variationsSidebarAnim }] },
            ]}
          >
            <View style={styles.variationsSidebarHeader}>
              <Text style={styles.variationsSidebarTitle}>Narration Changes</Text>
              <TouchableOpacity onPress={closeVariationsSidebar} style={styles.variationsSidebarClose}>
                <Text style={styles.variationsSidebarCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            {allMushafVariations.length === 0 ? (
              <View style={styles.variationsSidebarEmpty}>
                <Text style={styles.variationsSidebarEmptyText}>
                  {selectedNarrators.length === 0
                    ? "Select narrators from the menu to see differences"
                    : "No variations found for selected narrators"}
                </Text>
              </View>
            ) : (
              <ScrollView
                ref={variationsSidebarScrollRef}
                style={styles.variationsSidebarList}
                contentContainerStyle={styles.variationsSidebarListContent}
                showsVerticalScrollIndicator={true}
                onScroll={(e) => {
                  variationsSidebarScrollOffsetRef.current =
                    e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={100}
              >
                {allMushafVariations.map((variation) => {
                  const pageNum = variation.word?.line?.page?.position ?? 0;
                  const narratorTitle = variation.narrator?.title ?? "";
                  const originalText = variation.word?.content ?? "";
                  const variationText = variation.content ?? "";
                  const wordId = variation.word?.id;
                  const isActiveItem =
                    lastSelectedVariationHighlight &&
                    currentPage === lastSelectedVariationHighlight.pageNum &&
                    wordId === lastSelectedVariationHighlight.wordId;
                  return (
                    <TouchableOpacity
                      key={`${variation.word_id}-${variation.narrator_id}`}
                      style={[styles.variationsSidebarItem, isActiveItem && styles.variationsSidebarItemActive]}
                      onPress={() => {
                        setLastSelectedVariationHighlight(
                          wordId != null ? { wordId, pageNum } : null
                        );
                        setCurrentPage(pageNum);
                        setPageInput(String(pageNum));
                        handlePageChange(String(pageNum));
                        setSelectedWordId(wordId ?? null);
                        setSelectedWord(
                          variation.word
                            ? { id: variation.word.id, content: variation.word.content }
                            : null
                        );
                        closeVariationsSidebar();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.variationsSidebarItemPage}>Page {pageNum}</Text>
                      <View style={styles.variationsSidebarItemRow}>
                        <View style={styles.variationsSidebarItemBlock}>
                          <Text style={styles.variationsSidebarItemLabel}>Hafs</Text>
                          <View style={styles.variationsSidebarChipUnselected}>
                            <Text
                              style={[styles.variationsSidebarChipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                              numberOfLines={1}
                            >
                              {originalText}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.variationsSidebarItemArrow}>›</Text>
                        <View style={styles.variationsSidebarItemBlock}>
                          <Text style={styles.variationsSidebarItemLabel}>{narratorTitle}</Text>
                          <View style={styles.variationsSidebarChipSelected}>
                            <Text
                              style={[styles.variationsSidebarChipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                              numberOfLines={1}
                            >
                              {variationText}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>
        </SafeAreaView>
      )}

      <NarratorPopup
        visible={popupVisible}
        onClose={handleClosePopup}
        narrators={narrators.filter((narrator) => narrator.id !== "hafs-an-asim")}
        selectedNarrator={selectedNarrator}
        onSelectNarrator={handleSelectNarrator}
        inputValue={inputValue}
        onInputChange={setInputValue}
        position={wordPosition}
        selectedWord={selectedWord}
        savedVariations={savedVariations}
        allVariations={allVariations}
        onSaveVariation={handleSaveVariation}
        onDeleteVariation={handleDeleteVariation}
        mushafId={mushafId}
        currentSurahNumber={
          surahSegments[currentSurahIndex]?.fields?.category_position ?? null
        }
        isShubahHighlight={isShubahHighlight}
      />

      <QiraatSettingsModal
        visible={isQiraatSettingsVisible}
        onClose={() => setIsQiraatSettingsVisible(false)}
        isDarkMode={isMushafDarkMode}
        onToggleDarkMode={setIsMushafDarkMode}
        mushafId={mushafId}
        onMushafChange={setMushafId}
      />

      {/* Page Slider Modal */}
      <Modal
        visible={showPageSlider}
        transparent={true}
        animationType="fade"
        onRequestClose={() => setShowPageSlider(false)}
      >
        <Pressable style={styles.pageSliderModalOverlay} onPress={() => setShowPageSlider(false)}>
          <Pressable style={styles.pageSliderModalContent} onPress={() => {}}>
            <View style={styles.pageSliderHeader}>
              <Text style={styles.pageSliderTitle}>Go to Page</Text>
              <TouchableOpacity
                onPress={() => setShowPageSlider(false)}
                style={styles.pageSliderCloseButton}
              >
                <Text style={styles.pageSliderCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {/* Juz Carousel */}
            <View
              style={styles.carouselContainer}
              onLayout={(e) => {
                juzCarouselWidthRef.current = e.nativeEvent.layout.width;
                if (showPageSlider) scrollCarouselsToCenter();
              }}
            >
              <Text style={styles.carouselLabel}>Juz</Text>
              <ScrollView
                ref={juzScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselContent}
                style={styles.carouselScrollView}
              >
                {juzSegments.map((juz, index) => (
                  <TouchableOpacity
                    key={juz.pk}
                    style={[
                      styles.carouselItem,
                      index === currentJuzIndex && styles.carouselItemActive,
                    ]}
                    onPress={() => {
                      const pageNum = juz.fields.first_page;
                      setCurrentPage(pageNum);
                      setSliderValue(pageNum);
                      setPageInput(pageNum.toString());
                      handlePageChange(pageNum.toString());
                    }}
                  >
                    <Text
                      style={[
                        styles.carouselItemText,
                        index === currentJuzIndex && styles.carouselItemTextActive,
                      ]}
                    >
                      {juz.fields.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Surah Carousel */}
            <View
              style={styles.carouselContainer}
              onLayout={(e) => {
                surahCarouselWidthRef.current = e.nativeEvent.layout.width;
                if (showPageSlider) scrollCarouselsToCenter();
              }}
            >
              <Text style={styles.carouselLabel}>Surah</Text>
              <ScrollView
                ref={surahScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                contentContainerStyle={styles.carouselContent}
                style={styles.carouselScrollView}
              >
                {surahSegments.map((surah, index) => (
                  <TouchableOpacity
                    key={surah.pk}
                    style={[
                      styles.carouselItem,
                      index === currentSurahIndex && styles.carouselItemActive,
                    ]}
                    onPress={() => {
                      const pageNum = surah.fields.first_page;
                      setCurrentPage(pageNum);
                      setSliderValue(pageNum);
                      setPageInput(pageNum.toString());
                      handlePageChange(pageNum.toString());
                    }}
                  >
                    <Text
                      style={[
                        styles.carouselItemText,
                        index === currentSurahIndex && styles.carouselItemTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {surah.fields.title}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>
            
            <View style={styles.pageSliderContainer}>
              <TextInput
                style={styles.pageSliderPageNumberInput}
                value={sliderValue.toString()}
                onChangeText={(text) => {
                  const num = parseInt(text);
                  if (!isNaN(num) && num >= 1 && num <= TOTAL_PAGES) {
                    setSliderValue(num);
                  }
                }}
                onSubmitEditing={(e) => {
                  const num = parseInt(e.nativeEvent.text);
                  if (!isNaN(num) && num >= 1 && num <= TOTAL_PAGES) {
                    setCurrentPage(num);
                    setSliderValue(num);
                    setPageInput(num.toString());
                    handlePageChange(num.toString());
                  }
                }}
                keyboardType="numeric"
                selectTextOnFocus
                textAlign="center"
              />
              <View style={styles.pageSliderWrapper}>
                <Slider
                  value={TOTAL_PAGES - sliderValue + 1}
                  minimumValue={1}
                  maximumValue={TOTAL_PAGES}
                  step={1}
                  onValueChange={(value) => {
                    const pageNum = Array.isArray(value) ? value[0] : value;
                    // Convert slider value to actual page (inverted for RTL)
                    // Slider left (min) = page 604, Slider right (max) = page 1
                    const actualPage = TOTAL_PAGES - Math.round(pageNum) + 1;
                    setSliderValue(actualPage); // Only update display, don't trigger page load
                  }}
                  onSlidingComplete={(value) => {
                    const pageNum = Array.isArray(value) ? value[0] : value;
                    // Convert slider value to actual page (inverted for RTL)
                    const actualPage = TOTAL_PAGES - Math.round(pageNum) + 1;
                    setCurrentPage(actualPage);
                    setSliderValue(actualPage);
                    setPageInput(actualPage.toString());
                    handlePageChange(actualPage.toString());
                  }}
                  minimumTrackTintColor="#e0e0e0"
                  maximumTrackTintColor="#027778"
                  thumbTintColor="#027778"
                  thumbStyle={styles.pageSliderThumb}
                  trackStyle={styles.pageSliderTrack}
                  containerStyle={styles.pageSliderContainerStyle}
                  thumbTouchSize={{ width: 50, height: 50 }}
                />
              </View>
              <View style={styles.pageSliderLabels}>
                <Text style={styles.pageSliderLabel}>{TOTAL_PAGES}</Text>
                <Text style={styles.pageSliderLabel}>1</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </GestureHandlerRootView>
    </SafeAreaProvider>
  );
}

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: "#d32f2f",
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  errorHint: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  mainContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  mainContainerDark: {
    backgroundColor: "#000",
  },
  safeAreaDark: {
    backgroundColor: "#000",
  },
  navBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 0 : StatusBar.currentHeight || 0,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9ecef",
    backgroundColor: "#ffffff",
  },
  navButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navIcon: {
    fontSize: 22,
    color: "#1a1a1a",
  },
  navTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  navRightSpacer: {
    width: 28,
  },
  mushafTopBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#282828",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#00d4ff",
    minHeight: 50,
  },
  mushafMenuButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 12,
  },
  mushafMenuIcon: {
    fontSize: 22,
    color: "#ffffff",
  },
  mushafNarratorPills: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    paddingRight: 12,
  },
  mushafNarratorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    marginRight: 8,
    backgroundColor: "transparent",
  },
  mushafNarratorPillText: {
    fontSize: 14,
    fontWeight: "500",
  },
  mushafRightIcons: {
    flexDirection: "row",
    alignItems: "center",
  },
  mushafPageIndicator: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.3,
    marginRight: 12,
  },
  mushafIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mushafIcon: {
    fontSize: 20,
    color: "#ffffff",
  },
  contentContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  variationTraversalBar: {
    flexDirection: "row",
    backgroundColor: "#2a2a2a",
    paddingVertical: 12, // bottom is overridden by RECITE_BOTTOM_BAR_PADDING_BOTTOM + bottomBarInset (see top of file)
    paddingHorizontal: 16,
    paddingTop: 0,
    alignItems: "center",
    justifyContent: "space-between",
    // borderTopWidth: StyleSheet.hairlineWidth,
    // borderTopColor: "#444",
    position: "relative",
    zIndex: 10,
  },
  variationTraversalHandleContainer: {
    display: "none",
  },
  variationTraversalHandle: {
    width: 0,
    height: 0,
  },
  variationTraversalArrowButton: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "#56565E",
    alignItems: "center",
    justifyContent: "center",
  },
  variationTraversalArrowButtonDisabled: {
    backgroundColor: "#555",
    opacity: 0.6,
  },
  variationTraversalArrowButtonText: {
    fontSize: 24,
    fontWeight: "600",
    color: "#fff",
  },
  variationTraversalSegmentedControl: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 12,
    backgroundColor: "#e8e8e8",
    borderRadius: 24,
    paddingVertical: 8,
    paddingHorizontal: 4,
    gap: 4,
  },
  variationTraversalSegment: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 6,
    paddingHorizontal: 12,
    borderRadius: 18,
    minWidth: 0,
  },
  variationTraversalSegmentActive: {
    backgroundColor: "#3a3a3a",
    borderWidth: 1.5,
    borderColor: "#f5a623",
  },
  variationTraversalSegmentLabel: {
    fontSize: 10,
    color: "#888",
    textTransform: "uppercase",
    letterSpacing: 0.5,
    marginBottom: 2,
  },
  variationTraversalSegmentText: {
    fontSize: 32,
    color: "#1a1a1a",
    textAlign: "center",
  },
  variationTraversalSegmentTextActive: {
    color: "#fff",
  },
  variationTraversalSegmentDivider: {
    fontSize: 16,
    color: "#999",
    paddingHorizontal: 4,
  },
  variationTraversalArrowDisabled: {
    opacity: 0.5,
  },
  noRiwayahBanner: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#252529",
    marginHorizontal: 16,
    marginVertical: 12,
    paddingVertical: 14,
    paddingHorizontal: 20,
    borderRadius: 12,
  },
  noRiwayahBannerIcon: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  noRiwayahBannerIconText: {
    fontSize: 22,
    fontWeight: "300",
    color: "#fff",
  },
  noRiwayahBannerText: {
    alignItems: "flex-start",
  },
  noRiwayahBannerTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 2,
  },
  noRiwayahBannerSubtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
  },
  pageViewContainer: {
    flex: 1,
    width: "100%",
  },
  pageBehind: {
    opacity: 0.95,
    zIndex: 0,
  },
  pageCurrent: {
    zIndex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: 15,
  },
  pageContent: {
    width: "100%",
    maxWidth: 600,
    backgroundColor: "#fff",
    paddingTop: 8,
    paddingBottom: 32,
    paddingHorizontal: 2,
  },
  containerDark: {
    backgroundColor: "#252529",
  },
  pageContentDark: {
    backgroundColor: "#252529",
  },
  line: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 40,
  },
  lineWithBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#000",
  },
  lineWithBorderDark: {
    borderBottomColor: "#444",
  },
  lineDark: {
    borderBottomColor: "#444",
  },
  firstLineOfJuz: {
    backgroundColor: "#000",
    borderBottomColor: "#333",
    marginHorizontal: -2,
    paddingHorizontal: 2,
  },
  firstLineOfJuzDark: {
    backgroundColor: "#fff",
    borderBottomColor: "#ccc",
    marginHorizontal: -2,
    paddingHorizontal: 2,
  },
  firstLineOfJuzText: {
    color: "#fff",
  },
  firstLineOfJuzDarkText: {
    color: "#000",
  },
  wordPressable: {
    paddingHorizontal: 2,
  },
  wordPressed: {
    opacity: 0.5,
  },
  wordSelected: {
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  differentChar: {
    backgroundColor: "#ffb366",
    borderRadius: 2,
    paddingHorizontal: 1,
    paddingVertical: 0,
    lineHeight: undefined,
  },
  inlineComparison: {
    flexDirection: "row",
  },
  word: {
    fontSize: 24,
    color: "#1a1a1a",
    fontFamily: QURAN_FONT_FAMILY,
    fontWeight: "500",
    writingDirection: "rtl",
    lineHeight: 46,
  },
  wordDark: {
    color: "#ffffff",
  },
  modalContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  popupContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    alignItems: "center",
    maxHeight: "90%",
    maxWidth: "90%",
  },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#fff",
    marginTop: -12,
  },
  popupContent: {
    width: "100%",
    flex: 1,
  },
  popupContentContainer: {
    padding: 20,
    flexGrow: 1,
  },
  drawerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "row",
    backgroundColor: "transparent",
  },
  drawerBackdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  drawerBackdropFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  drawer: {
    width: 260,
    flex: 1,
    backgroundColor: "#282828",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#3a3a3a",
    paddingTop: Platform.OS === "ios" ? 50 : (StatusBar.currentHeight || 0) + 20,
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  drawerHeader: {
    marginBottom: 20,
  },
  drawerHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  drawerHeaderIcon: {
    marginRight: 12,
  },
  drawerHeaderIconText: {
    fontSize: 20,
  },
  drawerHeaderTextContainer: {
    flex: 1,
  },
  drawerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  drawerSubtitle: {
    fontSize: 14,
    color: "#aaaaaa",
    lineHeight: 20,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3a3a3a",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  resetButtonDisabled: {
    backgroundColor: "#2a2a2a",
    opacity: 0.5,
  },
  resetButtonIcon: {
    fontSize: 16,
    color: "#ffffff",
    marginRight: 8,
  },
  resetButtonIconDisabled: {
    color: "#888888",
  },
  resetButtonText: {
    fontSize: 14,
    color: "#ffffff",
    fontWeight: "500",
  },
  resetButtonTextDisabled: {
    color: "#888888",
  },
  drawerNarratorsContent: {
    paddingBottom: 40,
  },
  parentCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  parentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#027778",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  parentCardInfo: {
    flex: 1,
  },
  parentCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  parentCardLocation: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  parentCardLocationText: {
    fontSize: 14,
    color: "#ffffff",
    opacity: 0.9,
  },
  chevronIcon: {
    fontSize: 14,
    color: "#ffffff",
    marginLeft: 12,
  },
  childrenContainer: {
    marginTop: 8,
    flexDirection: "row",
    position: "relative",
  },
  childrenVerticalLine: {
    width: 2,
    backgroundColor: "#555",
    marginLeft: 16,
    marginRight: 12,
  },
  childrenContent: {
    flex: 1,
  },
  childCard: {
    backgroundColor: "#3a3a3a",
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
    position: "relative",
  },
  childCardDisabled: {
    opacity: 0.7,
  },
  childCardContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  childCardInfo: {
    flex: 1,
  },
  childCardTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ffffff",
    marginBottom: 4,
  },
  childCardTitleDisabled: {
    color: "#666666",
    opacity: 0.5,
  },
  childCardLocation: {
    flexDirection: "row",
    alignItems: "center",
  },
  childCardLocationText: {
    fontSize: 13,
    color: "#aaaaaa",
  },
  childCardLocationTextDisabled: {
    color: "#666666",
    opacity: 0.5,
  },
  childCardBar: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  drawerBottomNav: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    width: "100%",
    flexDirection: "row",
    backgroundColor: "#282828",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 12,
    paddingBottom: Platform.OS === "ios" ? 35 : 12,
    paddingHorizontal: 8,
    justifyContent: "space-around",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -2 },
    shadowOpacity: 0.1,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 10,
  },
  drawerNavButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  drawerNavIcon: {
    fontSize: 24,
    marginBottom: 4,
    color: "#ffffff",
  },
  drawerNavIconActive: {
    color: "#00d4ff",
  },
  drawerNavLabel: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "500",
  },
  drawerNavLabelActive: {
    color: "#00d4ff",
    fontWeight: "600",
  },
  drawerNarratorItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    marginBottom: 10,
    backgroundColor: "#1f1f1f",
  },
  drawerNarratorItemSelected: {
    borderColor: "#00d4ff",
    backgroundColor: "#1a3a42",
  },
  drawerNarratorRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  drawerCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "transparent",
  },
  drawerCheckboxDisabled: {
    borderColor: "#666",
    backgroundColor: "#555",
    opacity: 0.6,
  },
  drawerCheckboxSelected: {
    borderColor: "#00d4ff",
    backgroundColor: "#00d4ff",
  },
  drawerCheckboxDisabledSelected: {
    borderColor: "#666",
    backgroundColor: "#666",
    opacity: 0.6,
  },
  drawerCheckmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  drawerNarratorText: {
    flex: 1,
    fontSize: 16,
    color: "#ffffff",
    fontWeight: "500",
  },
  drawerNarratorTextSelected: {
    color: "#00d4ff",
  },
  learnContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  learnScrollContent: {
    paddingVertical: 12,
  },
  learnSection: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9ecef",
  },
  learnSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  learnRow: {
    paddingHorizontal: 12,
  },
  videoCard: {
    width: 140,
    marginHorizontal: 4,
  },
  videoThumb: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: "#dfe3e6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderLeftWidth: 18,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffffff",
    marginLeft: 6,
  },
  videoTitle: {
    fontSize: 12,
    color: "#1a1a1a",
  },
  listenPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  listenText: {
    fontSize: 16,
    color: "#666",
  },
  // Learn detail view styles
  learnDetailContent: {
    paddingBottom: 24,
  },
  learnDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  learnDetailTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  learnVideoWrapper: {
    paddingHorizontal: 16,
  },
  learnVideoSquare: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: "#dfe3e6",
    alignItems: "center",
    justifyContent: "center",
  },
  playTriangleLarge: {
    width: 0,
    height: 0,
    borderTopWidth: 18,
    borderBottomWidth: 18,
    borderLeftWidth: 28,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffffff",
    marginLeft: 8,
  },
  learnActionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
  },
  learnActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#f6f7f8",
    flex: 1,
    justifyContent: "center",
  },
  learnActionIcon: {
    fontSize: 16,
    color: "#1a1a1a",
    marginRight: 6,
  },
  learnActionLabel: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  learnDescription: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 14,
    color: "#444",
    lineHeight: 20,
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  variationTraversalNarratorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  variationTraversalPlayWrapper: {
    marginLeft: 4,
  },
  variationTraversalSegmentPlayable: {
    position: "relative",
  },
  variationTraversalPlayIndicator: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#027778",
    alignItems: "center",
    justifyContent: "center",
  },
  variationTraversalPlayIndicatorIcon: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "600",
  },
  popupHeaderTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    color: "#007AFF",
  },
  closeButton: {
    marginRight: 12,
    padding: 4,
  },
  closeIcon: {
    fontSize: 20,
    color: "#666",
    fontWeight: "bold",
  },
  popupTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  saveButtonSaved: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  saveButtonNotSaved: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  saveButtonText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "600",
  },
  saveButtonTextSaved: {
    color: "#ffffff",
  },
  saveButtonTextNotSaved: {
    color: "#ffffff",
  },
  narratorList: {
    maxHeight: 300,
  },
  narratorItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  narratorText: {
    fontSize: 16,
    color: "#1a1a1a",
  },
  inputContainer: {
    position: "relative",
    flex: 1,
  },
  customKeyboard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  keyboardControlRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 10,
    gap: 8,
  },
  keyboardToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  keyboardToggleText: {
    fontSize: 13,
    color: "#374151",
    fontWeight: "600",
  },
  keyboardArrowsRow: {
    flexDirection: "row",
    gap: 6,
    flex: 1,
    justifyContent: "center",
  },
  keyboardArrowKey: {
    width: 44,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardArrowKeyDisabled: {
    backgroundColor: "#f3f4f6",
    borderColor: "#e5e7eb",
    opacity: 0.5,
  },
  keyboardDeleteKey: {
    width: 44,
    height: 36,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardUndoKey: {
    width: 44,
    height: 36,
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#93c5fd",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  keyboardUndoKeyDisabled: {
    backgroundColor: "#f3f4f6",
    borderColor: "#d1d5db",
    opacity: 0.5,
  },
  keyboardUndoCount: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    textAlign: "center",
    lineHeight: 16,
    paddingHorizontal: 3,
    overflow: "hidden",
  },
  keyboardKeyTextDisabled: {
    color: "#9ca3af",
  },
  keyboardInsertModeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  keyboardInsertModeButton: {
    minWidth: 50,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  keyboardInsertModeButtonActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#2563eb",
  },
  keyboardInsertModeText: {
    fontSize: 16,
    color: "#1f2937",
    fontWeight: "600",
  },
  keyboardInsertModeTextActive: {
    color: "#ffffff",
  },
  keyboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "center",
  },
  keyboardKey: {
    width: 36,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardKeyLarge: {
    width: 50,
    height: 60,
  },
  keyboardKeyText: {
    fontSize: 18,
    color: "#1f2937",
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyTextLarge: {
    fontSize: 32,
  },
  keyboardKeyPreviewText: {
    fontSize: 10,
    color: "#9ca3af",
    marginTop: 2,
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyPreviewTextLarge: {
    fontSize: 12,
  },
  keyboardKeyTextTanween: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyTextTanweenLarge: {
    fontSize: 16,
  },
  keyboardKeyShaddaSelected: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  keyboardKeyTextShaddaSelected: {
    color: "#ffffff",
  },
  keyboardKeyShaddaImalahSelected: {
    backgroundColor: "#3b82f6",
    borderColor: "#3b82f6",
  },
  keyboardKeyTextShaddaImalahSelected: {
    color: "#ffffff",
  },
  keyboardKeyLongPressed: {
    backgroundColor: "#e5e7eb",
  },
  keyboardKeyTanween: {
    width: 66,
    height: 70,
    paddingTop: -10,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#3b82f6",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  keyboardKeyDiamond: {
    backgroundColor: "#fef2f2",
    borderColor: "#dc2626",
    borderWidth: 3,
  },
  diamondContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: "100%",
    height: "100%",
  },
  diamondBelow: {
    position: "absolute",
    bottom: -10,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  diamondShape: {
    width: 10,
    height: 10,
    backgroundColor: "#dc2626",
    transform: [{ rotate: "45deg" }],
    borderWidth: 0,
  },
  keyboardKeyHelperDot: {
    backgroundColor: "#f0fdf4",
    borderColor: "#16a34a",
    borderWidth: 3,
  },
  helperDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: "100%",
    height: "100%",
    flexDirection: "row",
  },
  helperDotText: {
    fontSize: 18,
    color: "#1f2937",
    marginLeft: 2,
  },
  helperDotTextLarge: {
    fontSize: 24,
  },
  keyboardKeyTanweenHovered: {
    backgroundColor: "#dbeafe",
    borderColor: "#2563eb",
    borderWidth: 3,
  },
  kasrahDropdownGrid: {
    position: "absolute",
    left: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    width: 142, // 2 columns * 66px width + 10px gap
    gap: 10,
    zIndex: 1000,
  },
  keyboardEmptyState: {
    width: "100%",
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  keyboardEmptyText: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 20,
    fontSize: 6,
    backgroundColor: "#f9f9f9",
    color: "#1a1a1a",
    fontFamily: QURAN_FONT_FAMILY,
    writingDirection: "rtl",
    textAlign: "right",
    minHeight: 44,
  },
  largeDisplayBlock: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 0,
    paddingVertical: 0,
    backgroundColor: "#ffffff",
    minHeight: 62,
    justifyContent: "center",
    alignItems: "center",
  },
  displayText: {
    fontSize: 32,
    fontFamily: QURAN_FONT_FAMILY,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: "#1a1a1a",
    lineHeight: 60,
    includeFontPadding: false,
    textAlign: "center",
    writingDirection: "rtl",
    paddingVertical: 4,
  },
  displayTextHighlighted: {
    backgroundColor: "#10b981",
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    color: "#ffffff",
    fontFamily: QURAN_FONT_FAMILY,
  },
  displayPlaceholder: {
    fontSize: 24,
    color: "#999",
    fontFamily: QURAN_FONT_FAMILY,
    textAlign: "right",
  },
  renderedTextContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingTop: 14,
    paddingBottom: 14,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    pointerEvents: "none",
  },
  renderedTextWrapper: {
    position: "relative",
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    width: "100%",
  },
  renderedText: {
    fontSize: 16,
    fontFamily: QURAN_FONT_FAMILY,
    writingDirection: "rtl",
    textAlign: "right",
    color: "#1a1a1a",
    lineHeight: 24,
    includeFontPadding: true,
  },
  redDotAbsolute: {
    position: "absolute",
    bottom: -4,
    alignItems: "center",
    justifyContent: "center",
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff0000",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  deleteButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#fff3f3",
  },
  deleteIcon: {
    fontSize: 16,
    color: "#d32f2f",
  },
  variationsSidebarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  variationsSidebarBackdrop: {
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  variationsSidebarPanel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 320,
    backgroundColor: "#2a2a2a",
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  variationsSidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: Platform.OS === "ios" ? 56 : (StatusBar.currentHeight || 0) + 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3a",
    backgroundColor: "#2a2a2a",
  },
  variationsSidebarTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  variationsSidebarClose: {
    padding: 8,
    marginRight: -8,
  },
  variationsSidebarCloseText: {
    fontSize: 20,
    color: "#aaaaaa",
    fontWeight: "600",
  },
  variationsSidebarEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  variationsSidebarEmptyText: {
    fontSize: 14,
    color: "#aaaaaa",
    textAlign: "center",
    lineHeight: 22,
  },
  variationsSidebarList: {
    flex: 1,
    backgroundColor: "#2a2a2a",
  },
  variationsSidebarListContent: {
    paddingBottom: 40,
    paddingHorizontal: 12,
  },
  variationsSidebarItem: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3a",
    backgroundColor: "#2a2a2a",
  },
  variationsSidebarItemActive: {
    backgroundColor: "#353535",
  },
  variationsSidebarItemPage: {
    fontSize: 11,
    color: "#888",
    marginBottom: 8,
  },
  variationsSidebarItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  variationsSidebarItemBlock: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  variationsSidebarItemLabel: {
    fontSize: 11,
    color: "#999",
    marginBottom: 4,
  },
  variationsSidebarChipUnselected: {
    backgroundColor: "#555",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  variationsSidebarChipSelected: {
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#c9a227",
  },
  variationsSidebarChipText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  variationsSidebarItemArrow: {
    fontSize: 18,
    color: "#888",
    marginHorizontal: 8,
    flexShrink: 0,
  },
  pageSliderModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  pageSliderModalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "85%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pageSliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  pageSliderTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  pageSliderCloseButton: {
    padding: 4,
  },
  pageSliderCloseText: {
    fontSize: 24,
    color: "#666",
    fontWeight: "300",
  },
  pageSliderContainer: {
    alignItems: "stretch",
  },
  pageSliderPageNumber: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#027778",
    textAlign: "center",
    marginBottom: 20,
  },
  pageSliderPageNumberInput: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#027778",
    textAlign: "center",
    marginBottom: 20,
    borderWidth: 2,
    borderColor: "#027778",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#f9f9f9",
  },
  pageSliderWrapper: {
    marginHorizontal: 10,
    marginBottom: 12,
  },
  pageSliderContainerStyle: {
    flex: 1,
  },
  pageSliderThumb: {
    width: 24,
    height: 24,
    backgroundColor: "#027778",
    shadowColor: "#027778",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  pageSliderTrack: {
    height: 4,
    borderRadius: 2,
  },
  pageSliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 10,
  },
  pageSliderLabel: {
    fontSize: 14,
    color: "#666",
  },
  carouselContainer: {
    marginBottom: 20,
  },
  carouselLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  carouselScrollView: {
    maxHeight: 50,
  },
  carouselContent: {
    paddingRight: 10,
  },
  carouselItem: {
    width: 76,
    paddingHorizontal: 16,
    paddingVertical: 10,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
  },
  carouselItemActive: {
    backgroundColor: "#027778",
    borderColor: "#027778",
  },
  carouselItemText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
  },
  carouselItemTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
});
