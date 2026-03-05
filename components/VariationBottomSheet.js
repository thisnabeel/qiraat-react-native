import React, { useRef, useEffect } from "react";
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

const MIN_HEIGHT = 143;
const MAX_HEIGHT = SCREEN_HEIGHT - 70;

// We use translateY with native driver for smooth 60fps. Sheet has fixed height MAX_HEIGHT;
// translateY = 0 => fully expanded, translateY = MAX_HEIGHT - MIN_HEIGHT => minimized.
const TRANSLATE_MINIMIZED = MAX_HEIGHT - MIN_HEIGHT;

export { TRANSLATE_MINIMIZED };

export default function VariationBottomSheet({
  isVisible,
  variations,
  currentPage,
  lastSelectedVariationHighlight,
  mushafId,
  getQuranFontFamily,
  onSelectVariation,
  onExpandedChange,
  registerTranslateY,
  backgroundColor = "#252529",
}) {
  const translateYAnim = useRef(new Animated.Value(TRANSLATE_MINIMIZED)).current;

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
    }
  }, [isVisible]);

  const panResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => false,
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 3,
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
        const midpoint = (MIN_HEIGHT + MAX_HEIGHT) / 2;
        const target = newHeight > midpoint ? MAX_HEIGHT : MIN_HEIGHT;
        snapTo(target);
      },
    })
  ).current;

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
      <View style={styles.handleArea} {...panResponder.panHandlers}>
        <View style={styles.handle} />
      </View>
      <VariationList
        variations={variations}
        currentPage={currentPage}
        lastSelectedVariationHighlight={lastSelectedVariationHighlight}
        mushafId={mushafId}
        getQuranFontFamily={getQuranFontFamily}
        onSelectVariation={(variation, meta) => {
          onSelectVariation?.(variation, meta);
          snapTo(MIN_HEIGHT);
        }}
      />
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1,
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
    paddingVertical: 8,
    alignItems: "center",
  },
  handle: {
    width: 60,
    height: 4,
    borderRadius: 2,
    backgroundColor: "rgba(255,255,255,0.3)",
  },
});

