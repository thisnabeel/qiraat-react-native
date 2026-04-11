import React, { useMemo } from "react";
import { View, Text, ScrollView, TouchableOpacity, StyleSheet } from "react-native";

const ARROW_COL_WIDTH = 40;

function narratorKey(v) {
  return String(v.narrator_id ?? v.narrator?.id ?? "");
}

function wordKey(v) {
  const id = v.word?.id ?? v.word_id;
  return id != null ? String(id) : null;
}

function rowSortKey(word) {
  if (!word) return 0;
  const page = word.line?.page?.position ?? 0;
  const linePos = word.line?.position ?? word.line?.id ?? 0;
  const wpos = word.position ?? 0;
  return page * 1e9 + Number(linePos) * 1e6 + Number(wpos);
}

export default function VariationList({
  variations,
  comparisonNarrators = [],
  currentPage,
  lastSelectedVariationHighlight,
  mushafId,
  getQuranFontFamily,
  onSelectVariation,
}) {
  const narratorIds = useMemo(
    () => comparisonNarrators.map((n) => n.id).filter((id) => id != null),
    [comparisonNarrators]
  );

  const tableRows = useMemo(() => {
    if (!variations?.length || narratorIds.length === 0) return [];
    const idSet = new Set(narratorIds.map((id) => String(id)));
    const byWord = new Map();

    for (const v of variations) {
      const nk = narratorKey(v);
      if (!idSet.has(nk)) continue;
      const wk = wordKey(v);
      if (!wk) continue;
      if (!byWord.has(wk)) {
        byWord.set(wk, {
          word: v.word,
          wordId: v.word?.id ?? v.word_id,
          hafsText: v.word?.content ?? "",
          byNarrator: {},
        });
      }
      const row = byWord.get(wk);
      if (v.word?.content) row.hafsText = v.word.content;
      row.byNarrator[nk] = v;
    }

    return Array.from(byWord.values()).sort((a, b) => rowSortKey(a.word) - rowSortKey(b.word));
  }, [variations, narratorIds]);

  if (!variations || variations.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No variations found for selected narrators</Text>
      </View>
    );
  }

  if (narratorIds.length === 0 || tableRows.length === 0) {
    return (
      <View style={styles.empty}>
        <Text style={styles.emptyText}>No variations found for selected narrators</Text>
      </View>
    );
  }

  const pickVariationForHighlight = (row) => {
    for (const id of narratorIds) {
      const v = row.byNarrator[String(id)];
      if (v) return v;
    }
    return null;
  };

  const renderHeaderCell = (label, align) => (
    <View style={[styles.headerCell, align === "left" ? styles.cellLeft : styles.cellRight]}>
      <Text
        style={[
          styles.tableHeaderLabel,
          align === "left" ? styles.tableHeaderLabelLeft : styles.tableHeaderLabelRight,
        ]}
        numberOfLines={2}
      >
        {label}
      </Text>
    </View>
  );

  const renderArrowSpacer = () => <View style={styles.arrowColumn} />;

  return (
    <View style={styles.tableRoot}>
      <View style={styles.tableHeader}>
        <View style={styles.tableHeaderInner}>
          {renderHeaderCell("Hafs", "left")}
          {renderArrowSpacer()}
          {comparisonNarrators.map((n, index) => (
            <React.Fragment key={String(n.id)}>
              {renderHeaderCell(n.title ?? "Narrator", "right")}
              {index < comparisonNarrators.length - 1 ? renderArrowSpacer() : null}
            </React.Fragment>
          ))}
        </View>
      </View>

      <ScrollView
        style={styles.tableBody}
        contentContainerStyle={styles.tableBodyContent}
        showsVerticalScrollIndicator={true}
        keyboardShouldPersistTaps="handled"
      >
        {tableRows.map((row) => {
          const wordId = row.wordId;
          const pageNum = row.word?.line?.page?.position ?? 0;
          const isActiveRow =
            lastSelectedVariationHighlight &&
            currentPage === lastSelectedVariationHighlight.pageNum &&
            wordId != null &&
            String(wordId) === String(lastSelectedVariationHighlight.wordId);

          const onPressRow = () => {
            const v = pickVariationForHighlight(row);
            if (v) onSelectVariation?.(v, { pageNum, wordId });
          };

          return (
            <TouchableOpacity
              key={String(row.wordId)}
              style={[styles.dataRowOuter, isActiveRow && styles.dataRowOuterActive]}
              onPress={onPressRow}
              activeOpacity={0.7}
              accessibilityRole="button"
              accessibilityLabel="Open this variation on the mushaf"
            >
              <View style={styles.dataRow}>
                <View style={[styles.cell, styles.cellLeft]}>
                  <View style={styles.chipUnselected}>
                    <Text
                      style={[styles.chipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                      numberOfLines={1}
                    >
                      {row.hafsText || "—"}
                    </Text>
                  </View>
                </View>

                <View style={styles.arrowColumn}>
                  <Text style={styles.itemArrow}>↔</Text>
                </View>

                {comparisonNarrators.map((n, index) => {
                  const v = row.byNarrator[String(n.id)];
                  const isLast = index === comparisonNarrators.length - 1;
                  const highlightColor = n.highlightColor ?? "#f5a623";

                  const cell = v ? (
                    <View style={[styles.chipSelected, { borderColor: highlightColor }]}>
                      <Text
                        style={[styles.chipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                        numberOfLines={1}
                      >
                        {v.content ?? "—"}
                      </Text>
                    </View>
                  ) : (
                    <View style={styles.chipPlaceholder}>
                      <Text style={styles.chipPlaceholderText}>—</Text>
                    </View>
                  );

                  return (
                    <React.Fragment key={String(n.id)}>
                      <View style={[styles.cell, styles.cellRight]}>{cell}</View>
                      {!isLast ? (
                        <View style={styles.arrowColumn}>
                          <Text style={styles.itemArrow}>↔</Text>
                        </View>
                      ) : null}
                    </React.Fragment>
                  );
                })}
              </View>
            </TouchableOpacity>
          );
        })}
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  empty: {
    flex: 1,
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
  tableRoot: {
    flex: 1,
    marginHorizontal: 8,
    borderRadius: 16,
    overflow: "hidden",
    backgroundColor: "#50515f",
  },
  tableHeader: {
    backgroundColor: "#50515f",
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "rgba(255,255,255,0.12)",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
  },
  tableHeaderInner: {
    flexDirection: "row",
    alignItems: "center",
  },
  headerCell: {
    flex: 1,
    justifyContent: "center",
    minHeight: 22,
  },
  tableHeaderLabel: {
    fontSize: 15,
    lineHeight: 20,
    fontWeight: "600",
    color: "#e1e3e9",
    includeFontPadding: false,
    width: "100%",
  },
  tableHeaderLabelLeft: {
    textAlign: "left",
  },
  tableHeaderLabelRight: {
    textAlign: "right",
  },
  arrowColumn: {
    width: ARROW_COL_WIDTH,
    alignItems: "center",
    justifyContent: "center",
  },
  tableBody: {
    flex: 1,
  },
  tableBodyContent: {
    paddingTop: 6,
    paddingBottom: 18,
    paddingHorizontal: 10,
  },
  dataRowOuter: {
    borderRadius: 8,
    marginBottom: 4,
  },
  dataRowOuterActive: {
    backgroundColor: "rgba(0,0,0,0.08)",
  },
  dataRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingVertical: 4,
  },
  cell: {
    flex: 1,
    minWidth: 0,
  },
  cellLeft: {
    alignItems: "flex-start",
  },
  cellRight: {
    alignItems: "flex-end",
  },
  itemArrow: {
    fontSize: 22,
    color: "#d9dbe2",
  },
  chipUnselected: {
    borderRadius: 14,
    minHeight: 42,
    minWidth: 72,
    maxWidth: "100%",
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "#2e3040",
    alignItems: "center",
    justifyContent: "center",
  },
  chipSelected: {
    borderRadius: 14,
    minHeight: 42,
    minWidth: 72,
    maxWidth: "100%",
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "#2e3040",
    borderWidth: 1.8,
    borderColor: "#f5a623",
    alignItems: "center",
    justifyContent: "center",
  },
  chipPlaceholder: {
    borderRadius: 14,
    minHeight: 42,
    minWidth: 72,
    paddingVertical: 7,
    paddingHorizontal: 12,
    backgroundColor: "rgba(46,48,64,0.45)",
    alignItems: "center",
    justifyContent: "center",
  },
  chipPlaceholderText: {
    fontSize: 16,
    color: "#7a7d8c",
  },
  chipText: {
    fontSize: 16,
    color: "#ffffff",
  },
});
