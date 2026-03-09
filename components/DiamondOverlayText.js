import React, { useState, useCallback } from "react";
import { View, StyleSheet } from "react-native";
import Svg, { Path } from "react-native-svg";

// Your SVG: viewBox="-4 -4 35 49", path gives diamond ~23×39 content, aspect 35:49
const VIEWBOX_WIDTH = 35;
const VIEWBOX_HEIGHT = 49;

/**
 * Diamond sizing per render spot. Adjust these to tune appearance.
 * - overlayText: Comparison table (Tweaked) + InlineComparison (mushaf lines).
 *   Size = clamp(min, max, layoutMinDim * scale); fallback when no layout.
 * - topDisplay: Main editor block (large display).
 * - placementModal: Drag-to-place canvas modal.
 */
export const DIAMOND_SIZING = {
  overlayText: {
    scale: 0.08,
    min: 6,
    max: 20,
    fallbackHeight: 12,
  },
  topDisplay: {
    scale: 0.08,
    min: 6,
    max: 20,
    fallbackHeight: 12,
  },
  placementModal: {
    height: 16,
  },
};

function clampSize(size, min, max) {
  return Math.round(Math.max(min, Math.min(max, size)));
}

/**
 * Renders the exact diamond shape from your SVG.
 * Height drives size; width = height * (35/49) to preserve aspect ratio.
 */
export function DiamondShapeSvg({ height, width, style }) {
  const h = height || 16;
  const w = width != null ? width : (h * VIEWBOX_WIDTH) / VIEWBOX_HEIGHT;
  return (
    <Svg width={w} height={h} viewBox="-4 -4 35 49" style={style}>
      <Path
        d="M13.5 1 L25 20.5 L13.5 40 L2 20.5 Z"
        fill="none"
        stroke="black"
        strokeWidth={4}
        strokeLinejoin="round"
      />
    </Svg>
  );
}

/**
 * Wraps content and draws diamond overlays at saved positions.
 * Uses the exact SVG diamond shape (skinny rhombus, transparent + stroke).
 */
const DiamondOverlayText = ({ children, diamond, containerStyle }) => {
  const [layout, setLayout] = useState(null);
  const onLayout = useCallback((e) => {
    const { width, height } = e.nativeEvent.layout;
    if (width > 0 && height > 0) setLayout({ width, height });
  }, []);

  if (!diamond || !diamond.indices || diamond.indices.length === 0) {
    return children;
  }

  const indices = diamond.indices;
  const placementByLetter = diamond.placementByLetter || {};
  const { scale, min, max, fallbackHeight } = DIAMOND_SIZING.overlayText;
  const minDim = layout ? Math.min(layout.width, layout.height) : 0;
  const diamondH = minDim > 0 ? clampSize(minDim * scale, min, max) : fallbackHeight;
  const diamondW = (diamondH * VIEWBOX_WIDTH) / VIEWBOX_HEIGHT;
  const halfW = diamondW / 2;
  const halfH = diamondH / 2;

  return (
    <View style={[styles.wrapper, containerStyle]} onLayout={onLayout} pointerEvents="box-none">
      {children}
      {indices.map((letterIdx) => {
        const placement = placementByLetter[letterIdx];
        if (!placement) return null;
        return (
          <View
            key={`diamond-${letterIdx}`}
            style={[
              styles.diamondContainer,
              {
                left: `${placement.xPercent}%`,
                top: `${placement.yPercent}%`,
                width: diamondW,
                height: diamondH,
                marginLeft: -halfW,
                marginTop: -halfH,
                right: undefined,
                bottom: undefined,
              },
            ]}
            pointerEvents="none"
          >
            <DiamondShapeSvg height={diamondH} />
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
  diamondContainer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
});

export default DiamondOverlayText;
