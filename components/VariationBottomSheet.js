import React, { useRef, useEffect } from "react";
import { Animated, PanResponder, View, StyleSheet, Dimensions } from "react-native";
import VariationList from "./VariationList";

const { height: SCREEN_HEIGHT } = Dimensions.get("window");

const MIN_HEIGHT = 143;
const MAX_HEIGHT = SCREEN_HEIGHT - 70;

export default function VariationBottomSheet({
  isVisible,
  variations,
  currentPage,
  lastSelectedVariationHighlight,
  mushafId,
  getQuranFontFamily,
  onSelectVariation,
  onExpandedChange,
  backgroundColor = "#252529",
}) {
  const heightAnim = useRef(new Animated.Value(MIN_HEIGHT)).current;
  const currentHeightRef = useRef(MIN_HEIGHT);

  const snapTo = (targetHeight) => {
    currentHeightRef.current = targetHeight;
    if (onExpandedChange) {
      onExpandedChange(targetHeight === MAX_HEIGHT);
    }
    Animated.spring(heightAnim, {
      toValue: targetHeight,
      useNativeDriver: false,
      tension: 180,
      friction: 22,
    }).start();
  };

  useEffect(() => {
    if (isVisible) {
      snapTo(MIN_HEIGHT);
    } else {
      // Reset height when hidden so it re-opens from compact state
      heightAnim.setValue(MIN_HEIGHT);
    }
  }, [isVisible]);

  const panResponder = useRef(
    PanResponder.create({
      onMoveShouldSetPanResponder: (_, gestureState) =>
        Math.abs(gestureState.dy) > 4,
      onPanResponderMove: (_, gestureState) => {
        const newHeight = currentHeightRef.current - gestureState.dy;
        const clampedHeight = Math.max(MIN_HEIGHT, Math.min(MAX_HEIGHT, newHeight));
        heightAnim.setValue(clampedHeight);
      },
      onPanResponderRelease: (_, gestureState) => {
        const newHeight = currentHeightRef.current - gestureState.dy;
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
          height: heightAnim,
          backgroundColor,
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

