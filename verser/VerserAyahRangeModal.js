import React, { useState, useEffect } from "react";
import {
  Modal,
  View,
  Text,
  TextInput,
  TouchableOpacity,
  Pressable,
  StyleSheet,
  Keyboard,
  Platform,
} from "react-native";

export function VerserAyahRangeModal({
  visible,
  wordCount,
  isDarkMode,
  /** Pre-filled `surah:ayah` from ayah-circle PUA + surah_header_position (optional). */
  suggestedLabel = "",
  onCancel,
  onConfirm,
}) {
  const [value, setValue] = useState("");

  useEffect(() => {
    if (visible) setValue(suggestedLabel ? String(suggestedLabel) : "");
  }, [visible, suggestedLabel]);

  const submit = () => {
    Keyboard.dismiss();
    onConfirm(value.trim());
  };

  const appendChar = (ch) => {
    if (ch === ":" && value.includes(":")) return;
    setValue((prev) => prev + ch);
  };

  const backspace = () => {
    setValue((prev) => prev.slice(0, -1));
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onCancel}
    >
      <View style={styles.backdrop}>
        <Pressable
          style={StyleSheet.absoluteFillObject}
          onPress={onCancel}
          accessibilityLabel="Dismiss"
        />
        <View style={[styles.sheet, isDarkMode && styles.sheetDark]}>
          <Text style={[styles.title, isDarkMode && styles.titleDark]}>
            Verse label (surah:ayah)
          </Text>
          <Text style={[styles.sub, isDarkMode && styles.subDark]}>
            {wordCount} word{wordCount === 1 ? "" : "s"} selected. Example: 2:255
          </Text>
          <TextInput
            style={[styles.input, isDarkMode && styles.inputDark]}
            value={value}
            readOnly
            showSoftInputOnFocus={false}
            placeholder="e.g. 2:255"
            placeholderTextColor={isDarkMode ? "#888" : "#999"}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={submit}
          />
          <View style={styles.keypad} accessibilityLabel="Verse number pad">
            {[
              ["1", "2", "3"],
              ["4", "5", "6"],
              ["7", "8", "9"],
            ].map((row, ri) => (
              <View key={String(ri)} style={styles.keypadRow}>
                {row.map((d) => (
                  <TouchableOpacity
                    key={d}
                    style={[styles.key, isDarkMode && styles.keyDark]}
                    onPress={() => appendChar(d)}
                    accessibilityLabel={`Digit ${d}`}
                    accessibilityRole="button"
                  >
                    <Text
                      style={[styles.keyLabel, isDarkMode && styles.keyLabelDark]}
                    >
                      {d}
                    </Text>
                  </TouchableOpacity>
                ))}
              </View>
            ))}
            <View style={styles.keypadRow}>
              <TouchableOpacity
                style={[styles.key, isDarkMode && styles.keyDark]}
                onPress={() => appendChar(":")}
                accessibilityLabel="Colon"
                accessibilityRole="button"
              >
                <Text
                  style={[styles.keyLabel, isDarkMode && styles.keyLabelDark]}
                >
                  :
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.key, isDarkMode && styles.keyDark]}
                onPress={() => appendChar("0")}
                accessibilityLabel="Digit 0"
                accessibilityRole="button"
              >
                <Text
                  style={[styles.keyLabel, isDarkMode && styles.keyLabelDark]}
                >
                  0
                </Text>
              </TouchableOpacity>
              <TouchableOpacity
                style={[styles.key, isDarkMode && styles.keyDark]}
                onPress={backspace}
                accessibilityLabel="Backspace"
                accessibilityRole="button"
              >
                <Text
                  style={[styles.keyLabel, isDarkMode && styles.keyLabelDark]}
                >
                  ⌫
                </Text>
              </TouchableOpacity>
            </View>
          </View>
          <View style={styles.row}>
            <TouchableOpacity style={styles.btnGhost} onPress={onCancel}>
              <Text style={[styles.btnGhostText, isDarkMode && styles.subDark]}>
                Cancel
              </Text>
            </TouchableOpacity>
            <TouchableOpacity style={styles.btnPrimary} onPress={submit}>
              <Text style={styles.btnPrimaryText}>Apply preview</Text>
            </TouchableOpacity>
          </View>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.5)",
    justifyContent: "center",
    padding: 24,
  },
  sheet: {
    borderRadius: 14,
    padding: 20,
    backgroundColor: "#fff",
    maxWidth: 400,
    alignSelf: "center",
    width: "100%",
  },
  sheetDark: {
    backgroundColor: "#2a2a2e",
  },
  title: {
    fontSize: 17,
    fontWeight: "700",
    color: "#1a1a1a",
    marginBottom: 6,
  },
  titleDark: { color: "#fff" },
  sub: {
    fontSize: 13,
    color: "#555",
    marginBottom: 14,
  },
  subDark: { color: "#bbb" },
  input: {
    borderWidth: 1,
    borderColor: "#ccc",
    borderRadius: 8,
    paddingHorizontal: 12,
    paddingVertical: Platform.OS === "ios" ? 12 : 8,
    fontSize: 16,
    color: "#1a1a1a",
    marginBottom: 10,
  },
  keypad: {
    marginBottom: 14,
    gap: 8,
  },
  keypadRow: {
    flexDirection: "row",
    gap: 8,
  },
  key: {
    flex: 1,
    minHeight: 44,
    borderRadius: 8,
    backgroundColor: "#ececec",
    alignItems: "center",
    justifyContent: "center",
  },
  keyDark: {
    backgroundColor: "#3a3a3e",
  },
  keyLabel: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  keyLabelDark: {
    color: "#fff",
  },
  inputDark: {
    borderColor: "#555",
    backgroundColor: "#1F1F22",
    color: "#fff",
  },
  row: {
    flexDirection: "row",
    justifyContent: "flex-end",
    gap: 12,
  },
  btnGhost: {
    paddingVertical: 10,
    paddingHorizontal: 14,
  },
  btnGhostText: {
    fontSize: 16,
    color: "#333",
    fontWeight: "600",
  },
  btnPrimary: {
    backgroundColor: "#00d4ff",
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
  },
  btnPrimaryText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#1a1a1a",
  },
});
