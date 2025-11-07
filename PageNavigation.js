import React from "react";
import {
  View,
  Text,
  TouchableOpacity,
  TextInput,
  StyleSheet,
  Platform,
} from "react-native";

const PageNavigation = ({
  currentPage,
  pageInput,
  onPageInputChange,
  onPageChange,
  onPreviousPage,
  onNextPage,
  onOpenMenu,
  isMenuOpen,
}) => {
  return (
    <View style={styles.navigationContainer}>
      {/* Hamburger menu button / Close button */}
      <TouchableOpacity
        style={styles.menuButton}
        onPress={onOpenMenu}
      >
        <Text style={styles.menuIcon}>{isMenuOpen ? "✕" : "☰"}</Text>
      </TouchableOpacity>

      <TouchableOpacity
        style={styles.navButton}
        onPress={onNextPage}
      >
        <Text style={styles.navButtonText}>←</Text>
      </TouchableOpacity>

      <TextInput
        style={styles.pageInput}
        value={pageInput}
        onChangeText={onPageInputChange}
        onSubmitEditing={() => onPageChange(pageInput)}
        keyboardType="numeric"
        textAlign="center"
        selectTextOnFocus
      />

      <TouchableOpacity
        style={styles.navButton}
        onPress={onPreviousPage}
        disabled={currentPage <= 1}
      >
        <Text
          style={[
            styles.navButtonText,
            currentPage <= 1 && styles.navButtonDisabled,
          ]}
        >
          →
        </Text>
      </TouchableOpacity>
    </View>
  );
};

const styles = StyleSheet.create({
  navigationContainer: {
    position: "absolute",
    bottom: 0,
    left: 0,
    right: 0,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#fff",
    borderTopWidth: 1,
    borderTopColor: "#ddd",
    paddingHorizontal: 20,
    paddingVertical: 15,
    paddingBottom: Platform.OS === "ios" ? 35 : 15, // Account for home indicator
  },
  menuButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
    marginRight: 10,
  },
  menuIcon: {
    fontSize: 20,
    color: "#fff",
    fontWeight: "bold",
  },
  navButton: {
    width: 50,
    height: 50,
    borderRadius: 25,
    backgroundColor: "#007AFF",
    alignItems: "center",
    justifyContent: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.2,
    shadowRadius: 4,
    elevation: 3,
  },
  navButtonText: {
    fontSize: 24,
    color: "#fff",
    fontWeight: "bold",
  },
  navButtonDisabled: {
    opacity: 0.3,
  },
  pageInput: {
    flex: 1,
    marginHorizontal: 20,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 12,
    fontSize: 18,
    backgroundColor: "#f9f9f9",
    fontWeight: "600",
    textAlign: "center",
  },
});

export default PageNavigation;
