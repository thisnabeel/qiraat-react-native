import React from "react";
import { TouchableOpacity, Text } from "react-native";

export function VerserSaveAyahButton({ disabled, onPress, style, textStyle }) {
  return (
    <TouchableOpacity
      style={[style, disabled && { opacity: 0.4 }]}
      onPress={disabled ? undefined : onPress}
      disabled={disabled}
      accessibilityRole="button"
      accessibilityLabel="Save ayah labels for this page"
    >
      <Text style={textStyle}>Save ayahs</Text>
    </TouchableOpacity>
  );
}
