import React from "react";
import {
  Modal,
  View,
  Text,
  StyleSheet,
  Pressable,
  TouchableOpacity,
  Switch,
} from "react-native";

const MUSHAF_OPTIONS = [
  { id: 2, label: "13 Liner IndoPak" },
  { id: 3, label: "15 Liner Uthmani" },
];

export default function QiraatSettingsModal({
  visible,
  onClose,
  isDarkMode,
  onToggleDarkMode,
  mushafId = 3,
  onMushafChange,
}) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <Pressable style={styles.overlay} onPress={onClose}>
        <Pressable style={styles.content} onPress={() => {}}>
          <View style={styles.header}>
            <Text style={styles.title}>Settings</Text>
            <TouchableOpacity onPress={onClose} style={styles.closeButton}>
              <Text style={styles.closeText}>✕</Text>
            </TouchableOpacity>
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Mushaf</Text>
            {MUSHAF_OPTIONS.map((opt) => (
              <Pressable
                key={opt.id}
                style={[styles.mushafRow, mushafId === opt.id && styles.mushafRowSelected]}
                onPress={() => onMushafChange?.(opt.id)}
              >
                <Text style={styles.mushafRowLabel}>{opt.label}</Text>
                {mushafId === opt.id && <Text style={styles.mushafRowCheck}>✓</Text>}
              </Pressable>
            ))}
          </View>

          <View style={styles.section}>
            <Text style={styles.sectionTitle}>Appearance</Text>

            <View style={styles.row}>
              <View style={styles.rowTextContainer}>
                <Text style={styles.rowTitle}>Dark mode</Text>
                <Text style={styles.rowSubtitle}>
                  Invert mushaf page colors for low-light reading.
                </Text>
              </View>
              <Switch
                value={!!isDarkMode}
                onValueChange={onToggleDarkMode}
              />
            </View>
          </View>
        </Pressable>
      </Pressable>
    </Modal>
  );
}

const styles = StyleSheet.create({
  overlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  content: {
    width: "85%",
    maxWidth: 400,
    backgroundColor: "#ffffff",
    borderRadius: 16,
    padding: 24,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  header: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 16,
  },
  title: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  closeButton: {
    padding: 4,
  },
  closeText: {
    fontSize: 22,
    color: "#666666",
  },
  description: {
    fontSize: 14,
    color: "#444444",
    lineHeight: 20,
  },
  section: {
    marginTop: 8,
  },
  sectionTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#888888",
    textTransform: "uppercase",
    letterSpacing: 0.8,
    marginBottom: 8,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 8,
  },
  rowTextContainer: {
    flex: 1,
    paddingRight: 12,
  },
  rowTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111111",
  },
  mushafRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 8,
    marginBottom: 4,
  },
  mushafRowSelected: {
    backgroundColor: "rgba(0, 0, 0, 0.06)",
  },
  mushafRowLabel: {
    fontSize: 16,
    fontWeight: "500",
    color: "#111111",
  },
  mushafRowCheck: {
    fontSize: 18,
    fontWeight: "600",
    color: "#027778",
  },
  rowSubtitle: {
    marginTop: 2,
    fontSize: 13,
    color: "#666666",
  },
});

