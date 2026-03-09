import React, { useState, useCallback } from "react";
import { View, StyleSheet } from "react-native";

const MIN_DOT = 4;
const MAX_DOT = 12;
const DOT_SCALE = 0.06;

function clampDotSize(size) {
  return Math.round(Math.max(MIN_DOT, Math.min(MAX_DOT, size)));
}

/**
 * Wraps content (e.g. Arabic text) and draws imalah overlay circles at saved positions.
 * Dot size scales with parent dimensions (between MIN_DOT and MAX_DOT).
 */
const ImalahOverlayText = ({ children, imalah, containerStyle }) => {
  const [layout, setLayout] = useState(null);
  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setLayout({ width, height });
  }, []);

  if (!imalah || !imalah.indices || imalah.indices.length === 0) {
    return children;
  }

  const indices = imalah.indices;
  const placementByLetter = imalah.placementByLetter || {};
  const minDim = layout ? Math.min(layout.width, layout.height) : 0;
  const dotSize = minDim > 0 ? clampDotSize(minDim * DOT_SCALE) : 8;
  const half = dotSize / 2;

  return (
    <View style={[styles.wrapper, containerStyle]} onLayout={onLayout} pointerEvents="box-none">
      {children}
      {indices.map((letterIdx) => {
        const placement = placementByLetter[letterIdx];
        if (!placement) return null;
        return (
          <View
            key={`imalah-${letterIdx}`}
            style={[
              styles.circleContainer,
              {
                left: `${placement.xPercent}%`,
                top: `${placement.yPercent}%`,
                width: dotSize,
                height: dotSize,
                marginLeft: -half,
                marginTop: -half,
                right: undefined,
                bottom: undefined,
              },
            ]}
            pointerEvents="none"
          >
            <View style={[styles.circle, { width: dotSize, height: dotSize, borderRadius: half }]} />
          </View>
        );
      })}
    </View>
  );
};

const styles = StyleSheet.create({
  wrapper: {
    position: "relative",
  },
  circleContainer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  circle: {
    backgroundColor: "#000",
  },
});

export default ImalahOverlayText;
