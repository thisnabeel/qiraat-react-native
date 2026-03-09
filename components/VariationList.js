import React from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";
import { Swipeable } from "react-native-gesture-handler";

export default function VariationList({
  variations,
  currentPage,
  lastSelectedVariationHighlight,
  mushafId,
  getQuranFontFamily,
  onSelectVariation,
  onDeleteVariation,
}) {
  if (!variations || variations.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No variations found for selected narrators</Text>
      </View>
    );
  }

  const renderRightActions = (progress, dragX, variation) => (
    <View style={styles.deleteActions}>
      <TouchableOpacity
        style={styles.deleteButton}
        onPress={() => {
          onDeleteVariation?.(variation);
        }}
        activeOpacity={0.8}
      >
        <Text style={styles.deleteButtonText}>Delete</Text>
      </TouchableOpacity>
    </View>
  );

  return (
    <ScrollView
      style={styles.list}
      contentContainerStyle={styles.listContent}
      showsVerticalScrollIndicator={true}
    >
      {variations.map((variation) => {
        const pageNum = variation.word?.line?.page?.position ?? 0;
        const narratorTitle = variation.narrator?.title ?? "";
        const originalText = variation.word?.content ?? "";
        const variationText = variation.content ?? "";
        const wordId = variation.word?.id;
        const isActiveItem =
          lastSelectedVariationHighlight &&
          currentPage === lastSelectedVariationHighlight.pageNum &&
          wordId === lastSelectedVariationHighlight.wordId;

        const content = (
          <TouchableOpacity
            style={[styles.item, isActiveItem && styles.itemActive]}
            onPress={() => {
              onSelectVariation?.(variation, { pageNum, wordId });
            }}
            activeOpacity={0.7}
          >
            <Text style={styles.itemPage}>Page {pageNum}</Text>
            <View style={styles.itemRow}>
              <View style={styles.itemBlock}>
                <Text style={styles.itemLabel}>Hafs</Text>
                <View style={styles.chipUnselected}>
                  <Text
                    style={[styles.chipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                    numberOfLines={1}
                  >
                    {originalText}
                  </Text>
                </View>
              </View>
              <Text style={styles.itemArrow}>›</Text>
              <View style={styles.itemBlock}>
                <Text style={styles.itemLabel}>{narratorTitle}</Text>
                <View style={styles.chipSelected}>
                  <Text
                    style={[styles.chipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                    numberOfLines={1}
                  >
                    {variationText}
                  </Text>
                </View>
              </View>
            </View>
          </TouchableOpacity>
        );

        return onDeleteVariation ? (
          <Swipeable
            key={`${variation.word_id}-${variation.narrator_id}`}
            renderRightActions={(progress, dragX) => renderRightActions(progress, dragX, variation)}
            friction={2}
          >
            {content}
          </Swipeable>
        ) : (
          <View key={`${variation.word_id}-${variation.narrator_id}`}>{content}</View>
        );
      })}
    </ScrollView>
  );
}

const styles = StyleSheet.create({
  empty: {
    paddingVertical: 24,
    paddingHorizontal: 16,
    alignItems: "center",
    justifyContent: "center",
  },
  emptyText: {
    fontSize: 14,
    color: "#9ca3af",
    textAlign: "center",
  },
  list: {
    flex: 1,
  },
  listContent: {
    paddingBottom: 16,
  },
  item: {
    paddingVertical: 10,
    paddingHorizontal: 14,
    borderRadius: 10,
    marginBottom: 6,
    backgroundColor: "#1f2933",
  },
  itemActive: {
    borderWidth: 2,
    borderColor: "#f5a623",
    backgroundColor: "#111827",
  },
  itemPage: {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 4,
  },
  itemRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  itemBlock: {
    flex: 1,
  },
  itemLabel: {
    fontSize: 12,
    color: "#9ca3af",
    marginBottom: 4,
  },
  itemArrow: {
    fontSize: 18,
    color: "#9ca3af",
    paddingHorizontal: 8,
  },
  chipUnselected: {
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "#111827",
  },
  chipSelected: {
    borderRadius: 16,
    paddingVertical: 4,
    paddingHorizontal: 10,
    backgroundColor: "#111827",
    borderWidth: 2,
    borderColor: "#f5a623",
  },
  chipText: {
    fontSize: 18,
    color: "#ffffff",
  },
  deleteActions: {
    justifyContent: "center",
    alignItems: "flex-end",
    width: 80,
  },
  deleteButton: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#dc2626",
    width: 80,
    borderTopRightRadius: 10,
    borderBottomRightRadius: 10,
  },
  deleteButtonText: {
    color: "#fff",
    fontSize: 14,
    fontWeight: "600",
  },
});

