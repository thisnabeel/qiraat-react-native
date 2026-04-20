import React from "react";
import { TouchableOpacity, Text } from "react-native";

export function VerserToolbarButton({ active, onPress, style, textStyle }) {
  return (
    <TouchableOpacity
      style={style}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={active ? "Verser on" : "Verser off"}
    >
      <Text style={textStyle}>{active ? "Verser ✓" : "Verser"}</Text>
    </TouchableOpacity>
  );
}
