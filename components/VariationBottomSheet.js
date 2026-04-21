import React, { useRef, useEffect, useMemo, useState } from "react";
import {
  Animated,
  PanResponder,
  View,
  StyleSheet,
  Dimensions,
  Easing,
} from "react-native";
import VariationList from "./VariationList";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

const MIN_HEIGHT = 118;
const MAX_HEIGHT = SCREEN_HEIGHT - 70;

// We use translateY with native driver for smooth 60fps. Sheet has fixed height MAX_HEIGHT;
// translateY = 0 => fully expanded, translateY = MAX_HEIGHT - MIN_HEIGHT => minimized.
const TRANSLATE_MINIMIZED = MAX_HEIGHT - MIN_HEIGHT;

export { TRANSLATE_MINIMIZED };

export default function VariationBottomSheet({
  isVisible,
  showHandle = true,
  variations,
  currentPage,
  lastSelectedVariationHighlight,
  activeVariationWordId = null,
  mushafId,
  getQuranFontFamily,
  comparisonNarrators,
  onSelectVariation,
  onExpandedChange,
  registerTranslateY,
  backgroundColor = "#313237",
}) {
  const translateYAnim = useRef(new Animated.Value(TRANSLATE_MINIMIZED)).current;
  const [isExpanded, setIsExpanded] = useState(false);

  useEffect(() => {
    if (registerTranslateY) {
      registerTranslateY(translateYAnim);
      return () => registerTranslateY(null);
    }
  }, [registerTranslateY, translateYAnim]);
  const currentHeightRef = useRef(MIN_HEIGHT);
  const heightAtStartRef = useRef(MIN_HEIGHT);

  const snapTo = (targetHeight) => {
    const toValue = targetHeight === MAX_HEIGHT ? 0 : TRANSLATE_MINIMIZED;
    const expanded = targetHeight === MAX_HEIGHT;
    setIsExpanded(expanded);
    if (onExpandedChange) {
      onExpandedChange(expanded);
    }
    Animated.timing(translateYAnim, {
      toValue,
      duration: 240,
      easing: Easing.out(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) {
        currentHeightRef.current = targetHeight;
      }
    });
  };

  useEffect(() => {
    if (isVisible) {
      translateYAnim.setValue(TRANSLATE_MINIMIZED);
      currentHeightRef.current = MIN_HEIGHT;
      setIsExpanded(false);
    }
  }, [isVisible]);

  const panResponder = useMemo(
    () =>
      PanResponder.create({
      onStartShouldSetPanResponder: () => !!showHandle,
      onMoveShouldSetPanResponder: () => false,
      onPanResponderGrant: () => {
        heightAtStartRef.current = currentHeightRef.current;
      },
      onPanResponderMove: (_, gestureState) => {
        const newHeight = heightAtStartRef.current - gestureState.dy;
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
        translateYAnim.setValue(MAX_HEIGHT - clampedHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        const newHeight = heightAtStartRef.current - gestureState.dy;
        const range = MAX_HEIGHT - MIN_HEIGHT;
        const snapDownThreshold = MIN_HEIGHT + range * 0.1;   // bottom 10% → minimize
        const snapUpThreshold = MAX_HEIGHT - range * 0.1;      // top 10% → stay expanded
        const draggingUp = gestureState.dy < 0;
        let target;
        if (draggingUp) {
          // Bottom-to-top: only snap down if still in bottom 10%; else snap all the way up
          target = newHeight <= snapDownThreshold ? MIN_HEIGHT : MAX_HEIGHT;
        } else {
          // Top-to-bottom (unchanged): only snap up if in top 10%; else snap down
          target = newHeight >= snapUpThreshold ? MAX_HEIGHT : MIN_HEIGHT;
        }
        snapTo(target);
      },
    }),
    [showHandle]
  );

  if (!isVisible) return null;

  return (
    <Animated.View
      style={[
        styles.container,
        {
          height: MAX_HEIGHT,
          backgroundColor,
          transform: [{ translateY: translateYAnim }],
        },
      ]}
    >
      {showHandle && (
        <View style={styles.handleArea} {...panResponder.panHandlers}>
          <View style={styles.handle} />
        </View>
      )}
      <View style={styles.listFill}>
        <VariationList
          variations={variations}
          comparisonNarrators={comparisonNarrators}
          currentPage={currentPage}
          lastSelectedVariationHighlight={lastSelectedVariationHighlight}
          activeVariationWordId={activeVariationWordId}
          isExpanded={isExpanded}
          mushafId={mushafId}
          getQuranFontFamily={getQuranFontFamily}
          onSelectVariation={(variation, meta) => {
            onSelectVariation?.(variation, meta);
            snapTo(MIN_HEIGHT);
          }}
        />
      </View>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 0,
    elevation: 5,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: -4 },
    shadowOpacity: 0.25,
    shadowRadius: 8,
    elevation: 10,
  },
  handleArea: {
    paddingTop: 8,
    paddingBottom: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  handle: {
    width: 90,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
  listFill: {
    flex: 1,
    minHeight: 0,
  },
});

