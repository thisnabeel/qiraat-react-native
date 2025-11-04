import React from "react";
import {
  View,
  Text,
  ScrollView,
  TouchableOpacity,
  StyleSheet,
} from "react-native";

const NarratorNav = ({
  narrators,
  selectedNarrators,
  onToggleNarrator,
  onOpenMenu,
}) => {
  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <TouchableOpacity
          accessibilityRole="button"
          onPress={onOpenMenu}
          style={styles.menuButton}
        >
          <Text style={styles.menuIcon}>☰</Text>
        </TouchableOpacity>
        <ScrollView
          horizontal
          showsHorizontalScrollIndicator={false}
          contentContainerStyle={styles.scrollContent}
        >
          {narrators.map((narrator) => {
            const isSelected = selectedNarrators.includes(narrator.id);
            return (
              <TouchableOpacity
                key={narrator.id}
                style={[
                  styles.narratorItem,
                  isSelected && styles.narratorItemSelected,
                ]}
                onPress={() => onToggleNarrator(narrator.id)}
              >
                <View style={styles.checkboxContainer}>
                  <View
                    style={[
                      styles.checkbox,
                      isSelected && styles.checkboxSelected,
                    ]}
                  >
                    {isSelected && <Text style={styles.checkmark}>✓</Text>}
                  </View>
                  <Text
                    style={[
                      styles.narratorText,
                      isSelected && styles.narratorTextSelected,
                    ]}
                  >
                    {narrator.title}
                  </Text>
                </View>
              </TouchableOpacity>
            );
          })}
        </ScrollView>
      </View>
    </View>
  );
};

const styles = StyleSheet.create({
  container: {
    backgroundColor: "#f8f9fa",
    borderBottomWidth: 1,
    borderBottomColor: "#e9ecef",
    paddingVertical: 12,
  },
  row: {
    flexDirection: "row",
    alignItems: "center",
  },
  scrollContent: {
    paddingHorizontal: 16,
    alignItems: "center",
  },
  menuButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    marginLeft: 4,
    marginRight: 4,
  },
  menuIcon: {
    fontSize: 22,
    color: "#1a1a1a",
  },
  narratorItem: {
    marginRight: 12,
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    backgroundColor: "#fff",
    borderWidth: 1,
    borderColor: "#dee2e6",
    minWidth: 120,
  },
  narratorItemSelected: {
    backgroundColor: "#007AFF",
    borderColor: "#007AFF",
  },
  checkboxContainer: {
    flexDirection: "row",
    alignItems: "center",
  },
  checkbox: {
    width: 18,
    height: 18,
    borderRadius: 3,
    borderWidth: 2,
    borderColor: "#6c757d",
    marginRight: 8,
    alignItems: "center",
    justifyContent: "center",
  },
  checkboxSelected: {
    backgroundColor: "#fff",
    borderColor: "#fff",
  },
  checkmark: {
    color: "#007AFF",
    fontSize: 12,
    fontWeight: "bold",
  },
  narratorText: {
    fontSize: 14,
    color: "#495057",
    fontWeight: "500",
    textAlign: "center",
  },
  narratorTextSelected: {
    color: "#fff",
  },
});

export default NarratorNav;
