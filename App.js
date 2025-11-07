import React, { useState, useEffect, useRef } from "react";
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
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import ComparisonTable from "./ComparisonTable";
import PageNavigation from "./PageNavigation";
import InlineComparison from "./InlineComparison";
import AsyncStorage from "@react-native-async-storage/async-storage";

const API_BASE = "https://qiraat-api-v2-production.up.railway.app/";
// const API_BASE = "http://localhost:3000";
const API_BASE_URL = `${API_BASE}/api/mushafs/1/pages`;
const NARRATORS_URL = `${API_BASE}/api/narrators`;
const VARIATIONS_URL = `${API_BASE}/api/variations`;

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
}) => {
  const wordRefs = useRef({});

  return (
    <View style={styles.line}>
      {words.map((word, index) => {
        let contentToRender = <Text style={styles.word}>{word.content}</Text>;

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
                  onWordPress(word);
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
}) => {
  if (loading) {
    return (
      <View style={styles.container}>
        <View style={styles.pageContent}>
          <ActivityIndicator size="large" color="#000" />
          <Text style={styles.loadingText}>Loading page...</Text>
        </View>
      </View>
    );
  }

  if (!page || !page.lines) {
    return (
      <View style={styles.container}>
        <View style={styles.pageContent}>
          <Text style={styles.errorText}>No page data available</Text>
        </View>
      </View>
    );
  }

  return (
    <View style={styles.container}>
      <View style={styles.pageContent}>
        {page.lines.map((line) => (
          <Line
            key={line.id}
            words={line.words}
            onWordPress={onWordPress}
            selectedWordId={selectedWordId}
            savedVariations={savedVariations}
            selectedNarrators={selectedNarrators}
            allVariations={allVariations}
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
  onSaveVariation,
  onDeleteVariation,
}) => {
  if (!visible || !position) return null;

  // Calculate intelligent positioning
  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;
  const popupHeight = 300; // Estimated popup height
  const popupWidth = Math.min(screenWidth * 0.9, 400);

  let topPosition = position.y + position.height + 10;
  let leftPosition = position.x;

  // Adjust if popup would go off bottom of screen
  if (topPosition + popupHeight > screenHeight - 100) {
    // 100px buffer for navigation
    topPosition = position.y - popupHeight - 10; // Show above the word
  }

  // Adjust if popup would go off right side of screen
  if (leftPosition + popupWidth > screenWidth) {
    leftPosition = screenWidth - popupWidth - 20; // 20px margin
  }

  // Adjust if popup would go off left side of screen
  if (leftPosition < 20) {
    leftPosition = 20; // 20px margin
  }

  // Check if this variation is saved
  const variationKey =
    selectedWord && selectedNarrator
      ? `${selectedWord.id}-${selectedNarrator.id}`
      : null;
  const isSaved = variationKey ? savedVariations.includes(variationKey) : false;

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
            },
          ]}
        >
          {/* Content */}
          <View style={styles.popupContent}>
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
                    style={styles.saveButton}
                  >
                    <Text style={styles.saveIcon}>{isSaved ? "✓" : "□"}</Text>
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
                    <TextInput
                      style={[
                        styles.input,
                        inputValue && inputValue.length > 0 && { color: "transparent" },
                      ]}
                      value={inputValue}
                      onChangeText={onInputChange}
                      placeholder="Enter text..."
                      placeholderTextColor="#999"
                      editable={true}
                      multiline={false}
                    />
                    {/* Render text with red dots underneath letters followed by dots */}
                    {inputValue && inputValue.length > 0 && (
                      <View style={styles.renderedTextContainer} pointerEvents="none">
                        <ArabicTextWithDots text={inputValue} />
                      </View>
                    )}
                  </View>
                </View>

                {/* Comparison table */}
                <ComparisonTable
                  originalText={selectedWord?.content || ""}
                  inputText={inputValue}
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
                  <Text style={styles.popupTitle}>Select Narrator</Text>
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
          </View>
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
  const [fontsLoaded] = useFonts({
    NaskhNastaleeqIndoPakQWBW: require("./Naskh-Nastaleeq-IndoPak-QWBW.ttf"),
  });
  const [popupVisible, setPopupVisible] = useState(false);
  const [narrators, setNarrators] = useState([]);
  const [selectedNarrator, setSelectedNarrator] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedWord, setSelectedWord] = useState(null);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [wordPosition, setWordPosition] = useState(null);
  const [currentPage, setCurrentPage] = useState(19);
  const [pageInput, setPageInput] = useState("19");
  const [selectedNarrators, setSelectedNarrators] = useState([]);
  const [savedVariations, setSavedVariations] = useState([]);
  const [allVariations, setAllVariations] = useState({});
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerFullyOpen, setIsDrawerFullyOpen] = useState(false);
  const [currentTab, setCurrentTab] = useState("Recite");
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
  const pageTranslateX = useRef(new Animated.Value(0)).current;
  const isDraggingPageRef = useRef(false);
  const pageStartValueRef = useRef(0);
  const pageSwipeDirectionRef = useRef(null); // 'left' or 'right'

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    isDrawerVisibleRef.current = isDrawerVisible;
  }, [isDrawerVisible]);

  useEffect(() => {
    currentPageRef.current = currentPage;
  }, [currentPage]);

  // Cleanup effect: ensure drawer is in valid state when tab changes or component unmounts
  useEffect(() => {
    if (currentTab !== "Recite" && isDrawerVisible) {
      // If we're not on Recite tab, close drawer
      closeDrawer();
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

  // Swipe gesture for page navigation (only on Recite tab)
  // This gesture follows the finger and animates page transitions
  // It has priority over word presses to ensure swipes always work
  const pageSwipeGesture = useRef(
    Gesture.Pan()
      .activeOffsetX([-10, 10]) // Lower threshold for faster activation
      .failOffsetY([-12, 12]) // Fail if too much vertical movement (allows scrolling)
      .minDistance(10) // Lower minimum distance for faster activation
      .simultaneousWithExternalGesture(false) // Don't allow other gestures to interfere
      .onBegin((event) => {
        // Don't activate if drawer is open or already navigating
        if (isDrawerVisibleRef.current || isNavigatingRef.current) {
          return;
        }
        
        // Check if starting from left edge - if so, let drawer handle it
        const startX = event.x;
        if (startX <= 40) {
          return; // Let drawer gesture handle this
        }
        
        // Start dragging page immediately - this will cancel any word press
        isDraggingPageRef.current = true;
        pageStartValueRef.current = pageTranslateX._value;
        pageSwipeDirectionRef.current = null;
      })
      .onUpdate((event) => {
        if (!isDraggingPageRef.current) return;
        
        // Determine swipe direction
        if (pageSwipeDirectionRef.current === null) {
          if (Math.abs(event.translationX) > 10) {
            pageSwipeDirectionRef.current = event.translationX > 0 ? 'right' : 'left';
          }
        }
        
        // Update page position in real-time (clamped to screen width)
        const screenWidth = Dimensions.get('window').width;
        const maxTranslate = screenWidth * 0.8; // Max 80% of screen width
        const newValue = Math.max(
          -maxTranslate,
          Math.min(maxTranslate, pageStartValueRef.current + event.translationX)
        );
        
        pageTranslateX.setValue(newValue);
      })
      .onEnd((event) => {
        if (!isDraggingPageRef.current) return;
        isDraggingPageRef.current = false;
        
        // Don't trigger if drawer is open or already navigating
        if (isDrawerVisibleRef.current || isNavigatingRef.current) {
          // Snap back to center
          Animated.spring(pageTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }).start();
          return;
        }
        
        const screenWidth = Dimensions.get('window').width;
        const currentTranslate = pageTranslateX._value;
        const velocity = event.velocityX;
        
        // Determine which page is more visible based on current position
        // If more than 50% of next/previous page is showing, snap to that page
        // Also consider velocity - fast swipes should change pages even if less visible
        const snapThreshold = screenWidth * 0.5; // 50% threshold
        const velocityThreshold = 400; // Fast swipe threshold
        
        // Check if horizontal movement is dominant
        const isHorizontalSwipe = Math.abs(event.translationX) > Math.abs(event.translationY) * 2;
        
        if (!isHorizontalSwipe) {
          // Not a horizontal swipe, snap back
          Animated.spring(pageTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }).start();
          return;
        }
        
        // Prevent rapid successive calls
        if (isNavigatingRef.current) {
          // Just snap back
          Animated.spring(pageTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }).start();
          return;
        }
        
        // Determine which page to snap to based on visibility
        // Positive translationX = swiping right (showing previous page)
        // Negative translationX = swiping left (showing next page)
        const shouldGoToNext = 
          currentTranslate < -snapThreshold || // More than 50% of next page visible
          (currentTranslate < 0 && velocity < -velocityThreshold); // Fast left swipe
        
        const shouldGoToPrevious = 
          currentTranslate > snapThreshold || // More than 50% of previous page visible
          (currentTranslate > 0 && velocity > velocityThreshold); // Fast right swipe
        
        if (shouldGoToNext || shouldGoToPrevious) {
          isNavigatingRef.current = true;
          
          // Use ref to get current page value
          const page = currentPageRef.current;
          
          // Animate to the target page
          const targetTranslate = shouldGoToNext ? -screenWidth : screenWidth;
          
          Animated.timing(pageTranslateX, {
            toValue: targetTranslate,
            duration: 200,
            easing: Easing.out(Easing.cubic),
            useNativeDriver: true,
          }).start(() => {
            // Change page
            if (shouldGoToPrevious && page > 1 && handlePreviousPageRef.current) {
              handlePreviousPageRef.current();
            } else if (shouldGoToNext && handleNextPageRef.current) {
              handleNextPageRef.current();
            }
            
            // Reset position
            pageTranslateX.setValue(0);
            
            // Reset navigation flag
            setTimeout(() => {
              isNavigatingRef.current = false;
            }, 300);
          });
        } else {
          // Snap back to current page (less than 50% of other page showing)
          Animated.spring(pageTranslateX, {
            toValue: 0,
            useNativeDriver: true,
            damping: 20,
            stiffness: 300,
          }).start();
        }
      })
      .onFinalize(() => {
        isDraggingPageRef.current = false;
        pageSwipeDirectionRef.current = null;
      })
  ).current;

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
      const response = await fetch(`${API_BASE_URL}/${pageNum}`);
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
      console.error(`Error fetching page ${pageNum}:`, err);
      if (pageNum === currentPage) {
        setError(err.message);
        if (showLoading) {
          setLoading(false);
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
  }, [currentPage]);

  // Background refresh variations when narrators change (if on a cached page)
  useEffect(() => {
    const cachedPage = pageCacheRef.current[currentPage];
    if (cachedPage && selectedNarrators.length > 0) {
      // Always refresh variations when narrators change (they might have new selections)
      fetchVariationsForPage(cachedPage, currentPage, true);
    }
  }, [selectedNarrators, currentPage]);

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
          title: "Hafs 'an 'Asim",
        };
        
        // Sort other narrators: "Shu'bah an Asim" first, then others
        const sortedData = [...data].sort((a, b) => {
          const aTitle = a.title || "";
          const bTitle = b.title || "";
          const shubahTitle = "Shu'bah an Asim";
          
          if (aTitle === shubahTitle) return -1;
          if (bTitle === shubahTitle) return 1;
          return aTitle.localeCompare(bTitle);
        });
        
        // Add Hafs at the beginning of the list
        const allNarrators = [hafsNarrator, ...sortedData];
        setNarrators(allNarrators);

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
        
        // If no narrators are saved, default to "Hafs 'an 'Asim"
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
          setSelectedNarrators(savedNarrators);
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
      // Always save, even if empty (will default to Hafs on next load if empty)
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          localStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectedNarrators)
          );
        } else {
          await AsyncStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectedNarrators)
          );
        }
      } catch (err) {
        console.error("Error saving selected narrators:", err);
      }
    };
    persist();
  }, [selectedNarrators]);

  const handleWordPress = (word) => {
    setSelectedWord(word);
    setSelectedWordId(word.id);
    if (word.layout) {
      setWordPosition(word.layout);
    }
    setPopupVisible(true);
    setSelectedNarrator(null);
    setInputValue(word.content);
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
      // Loading state is handled by useEffect based on cache
    }
  };

  const handleNextPage = () => {
    const page = currentPageRef.current;
    const newPage = page + 1;
    console.log("handleNextPage: going from", page, "to", newPage);
    setCurrentPage(newPage);
    setPageInput(newPage.toString());
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

  const handleToggleNarrator = (narratorId) => {
    setSelectedNarrators((prev) => {
      const isHafs = narratorId === "hafs-an-asim";
      
      // If clicking Hafs 'an 'Asim
      if (isHafs) {
        if (prev.includes(narratorId)) {
          // Deselecting Hafs - only allow if there are other narrators selected
          // If Hafs is the only one selected, prevent deselection (it's the default)
          if (prev.length === 1 && prev[0] === "hafs-an-asim") {
            return prev; // Don't change - keep Hafs selected
          }
          return prev.filter((id) => id !== narratorId);
        } else {
          // Selecting Hafs - deselect all others
          return [narratorId];
        }
      } else {
        // If clicking any other narrator
        if (prev.includes(narratorId)) {
          // Deselecting other narrator
          const newSelection = prev.filter((id) => id !== narratorId);
          // If nothing is selected now, default back to Hafs
          if (newSelection.length === 0) {
            return ["hafs-an-asim"];
          }
          return newSelection;
        } else {
          // Selecting other narrator - deselect Hafs first
          const withoutHafs = prev.filter((id) => id !== "hafs-an-asim");
          return [...withoutHafs, narratorId];
        }
      }
    });
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

  return (
    <GestureHandlerRootView style={{ flex: 1 }}>
      <StatusBar barStyle="dark-content" />
      <SafeAreaView style={styles.safeArea}>
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

        <View style={styles.mainContainer}>
          {currentTab === "Recite" && (
            <>
              <GestureDetector gesture={pageSwipeGesture}>
                <View style={styles.contentContainer}>
                  {/* Previous page (slides in from right when swiping right) */}
                  {previousPage && currentPage > 1 && (
                    <Animated.View
                      style={[
                        styles.pageViewContainer,
                        styles.pageBehind,
                        {
                          transform: [
                            {
                              translateX: pageTranslateX.interpolate({
                                inputRange: [-Dimensions.get('window').width, 0, Dimensions.get('window').width],
                                outputRange: [0, Dimensions.get('window').width, Dimensions.get('window').width * 2],
                              }),
                            },
                          ],
                        },
                      ]}
                      pointerEvents="none"
                    >
                      <PageView
                        page={previousPage}
                        onWordPress={() => {}}
                        selectedWordId={null}
                        loading={false}
                        savedVariations={[]}
                        selectedNarrators={selectedNarrators}
                        allVariations={{}}
                      />
                    </Animated.View>
                  )}
                  
                  {/* Next page (slides in from left when swiping left) */}
                  {nextPage && (
                    <Animated.View
                      style={[
                        styles.pageViewContainer,
                        styles.pageBehind,
                        {
                          transform: [
                            {
                              translateX: pageTranslateX.interpolate({
                                inputRange: [-Dimensions.get('window').width, 0, Dimensions.get('window').width],
                                outputRange: [-Dimensions.get('window').width * 2, -Dimensions.get('window').width, 0],
                              }),
                            },
                          ],
                        },
                      ]}
                      pointerEvents="none"
                    >
                      <PageView
                        page={nextPage}
                        onWordPress={() => {}}
                        selectedWordId={null}
                        loading={false}
                        savedVariations={[]}
                        selectedNarrators={selectedNarrators}
                        allVariations={{}}
                      />
                    </Animated.View>
                  )}
                  
                  {/* Current page */}
                  <Animated.View
                    style={[
                      styles.pageViewContainer,
                      styles.pageCurrent,
                      {
                        transform: [{ translateX: pageTranslateX }],
                      },
                    ]}
                  >
                    <PageView
                      page={page}
                      onWordPress={handleWordPress}
                      selectedWordId={selectedWordId}
                      loading={loading}
                      savedVariations={savedVariations}
                      selectedNarrators={selectedNarrators}
                      allVariations={allVariations}
                    />
                  </Animated.View>
                </View>
              </GestureDetector>

              <PageNavigation
                currentPage={currentPage}
                pageInput={pageInput}
                onPageInputChange={handlePageInputChange}
                onPageChange={handlePageChange}
                onPreviousPage={handlePreviousPage}
                onNextPage={handleNextPage}
                onOpenMenu={isDrawerFullyOpen ? closeDrawer : openDrawer}
                isMenuOpen={isDrawerFullyOpen}
              />
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
      </SafeAreaView>

      {isDrawerVisible && (
        <SafeAreaView style={styles.drawerOverlay}>
          <Animated.View
            style={[styles.drawer, { transform: [{ translateX: drawerAnim }] }]}
          >
            {/* <View style={styles.drawerHeader}>
              <Text style={styles.drawerTitle}>Narrators</Text>
              <Text style={styles.drawerSubtitle}>
                Select narrators to display their saved variations.
              </Text>
            </View> */}
            <ScrollView
              contentContainerStyle={styles.drawerNarratorsContent}
              showsVerticalScrollIndicator={false}
            >
              {narrators.map((narrator) => {
                const isSelected = selectedNarrators.includes(narrator.id);
                return (
                  <TouchableOpacity
                    key={narrator.id}
                    style={[
                      styles.drawerNarratorItem,
                      isSelected && styles.drawerNarratorItemSelected,
                    ]}
                    onPress={() => handleToggleNarrator(narrator.id)}
                    activeOpacity={0.7}
                  >
                    <View style={styles.drawerNarratorRow}>
                      <View
                        style={[
                          styles.drawerCheckbox,
                          isSelected && styles.drawerCheckboxSelected,
                        ]}
                      >
                        {isSelected && <Text style={styles.drawerCheckmark}>✓</Text>}
                      </View>
                      <Text
                        style={[
                          styles.drawerNarratorText,
                          isSelected && styles.drawerNarratorTextSelected,
                        ]}
                        numberOfLines={2}
                      >
                        {narrator.title}
                      </Text>
                    </View>
                  </TouchableOpacity>
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

      <NarratorPopup
        visible={popupVisible}
        onClose={handleClosePopup}
        narrators={narrators}
        selectedNarrator={selectedNarrator}
        onSelectNarrator={handleSelectNarrator}
        inputValue={inputValue}
        onInputChange={setInputValue}
        position={wordPosition}
        selectedWord={selectedWord}
        savedVariations={savedVariations}
        onSaveVariation={handleSaveVariation}
        onDeleteVariation={handleDeleteVariation}
      />
    </GestureHandlerRootView>
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
  contentContainer: {
    flex: 1,
    backgroundColor: "#fff",
    paddingBottom: Platform.OS === "ios" ? 100 : 80, // Space for navigation controls
    overflow: "hidden", // Prevent content from showing outside during animation
  },
  pageViewContainer: {
    flex: 1,
    width: "100%",
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
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
    paddingTop: 4,
    paddingBottom: 4,
    paddingHorizontal: 2,
  },
  line: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 40,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#000",
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
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
    fontWeight: "500",
    writingDirection: "rtl",
    lineHeight: 46,
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
    maxHeight: 300,
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
    padding: 20,
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
    marginBottom: 16,
  },
  drawerTitle: {
    fontSize: 22,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 4,
  },
  drawerSubtitle: {
    fontSize: 13,
    color: "#6c757d",
    lineHeight: 18,
  },
  drawerNarratorsContent: {
    paddingBottom: 40,
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
  drawerCheckboxSelected: {
    borderColor: "#00d4ff",
    backgroundColor: "#00d4ff",
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
    padding: 8,
  },
  saveIcon: {
    fontSize: 24,
    color: "#007AFF",
    fontWeight: "bold",
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
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 20,
    fontSize: 6,
    backgroundColor: "#f9f9f9",
    color: "#1a1a1a",
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
    writingDirection: "rtl",
    textAlign: "right",
    minHeight: 44,
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
    fontFamily: "NaskhNastaleeqIndoPakQWBW",
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
});
