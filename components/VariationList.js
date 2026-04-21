import React, { useMemo, useRef, useEffect, useCallback } from "react";
import {
  View,
  Text,
  SectionList,
  TouchableOpacity,
  StyleSheet,
} from "react-native";
import surahNamesByNumber from "../surah_numbers.json";

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

function parseSurahNumberFromAyah(ayah) {
  if (typeof ayah !== "string" || ayah.length === 0) return undefined;
  const match = ayah.match(/^(\d+)\s*[:\-]/);
  if (!match) return undefined;
  const n = Number(match[1]);
  return Number.isNaN(n) ? undefined : n;
}

export default function VariationList({
  variations,
  comparisonNarrators = [],
  currentPage,
  lastSelectedVariationHighlight,
  activeVariationWordId = null,
  isExpanded = false,
  mushafId,
  getQuranFontFamily,
  onSelectVariation,
}) {
  const sectionListRef = useRef(null);
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
      const surahFromApi =
        v.surah_number != null && v.surah_number !== ""
          ? Number(v.surah_number)
          : undefined;
      const surahFromAyah = parseSurahNumberFromAyah(v.word?.ayah);
      if (!byWord.has(wk)) {
        byWord.set(wk, {
          word: v.word,
          wordId: v.word?.id ?? v.word_id,
          hafsText: v.word?.content ?? "",
          byNarrator: {},
          surahNumber:
            surahFromApi != null && !Number.isNaN(surahFromApi)
              ? surahFromApi
              : surahFromAyah != null && !Number.isNaN(surahFromAyah)
                ? surahFromAyah
              : undefined,
        });
      }
      const row = byWord.get(wk);
      if (v.word?.content) row.hafsText = v.word.content;
      if (
        (row.surahNumber == null || Number.isNaN(row.surahNumber)) &&
        surahFromApi != null &&
        !Number.isNaN(surahFromApi)
      ) {
        row.surahNumber = surahFromApi;
      } else if (
        (row.surahNumber == null || Number.isNaN(row.surahNumber)) &&
        surahFromAyah != null &&
        !Number.isNaN(surahFromAyah)
      ) {
        row.surahNumber = surahFromAyah;
      }
      row.byNarrator[nk] = v;
    }

    const sorted = Array.from(byWord.values()).sort(
      (a, b) => rowSortKey(a.word) - rowSortKey(b.word)
    );

    let carriedSurah = 1;
    for (const row of sorted) {
      const api = row.surahNumber;
      const h = Number(row.word?.line?.surah_header_position ?? 0);
      if (api != null && !Number.isNaN(api)) {
        carriedSurah = api;
      } else if (h > 0) {
        carriedSurah = h;
      }
      row.surahNumber = carriedSurah;
    }
    return sorted;
  }, [variations, narratorIds]);

  const sections = useMemo(() => {
    if (!tableRows?.length) return [];
    const out = [];
    for (const row of tableRows) {
      const n = row.surahNumber ?? 1;
      const title = surahNamesByNumber[String(n)] ?? `سورة ${n}`;
      const prev = out[out.length - 1];
      if (prev && prev.surahNumber === n) {
        prev.data.push(row);
      } else {
        out.push({ surahNumber: n, title, data: [row] });
      }
    }
    return out;
  }, [tableRows]);

  const findScrollTarget = useCallback(() => {
    if (!sections.length) return null;
    if (activeVariationWordId != null) {
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const rows = sections[sectionIndex].data || [];
        const itemIndex = rows.findIndex(
          (row) =>
            row?.wordId != null &&
            String(row.wordId) === String(activeVariationWordId)
        );
        if (itemIndex >= 0) return { sectionIndex, itemIndex };
      }
    }

    const targetWordId = lastSelectedVariationHighlight?.wordId;
    const targetPageNum = lastSelectedVariationHighlight?.pageNum;

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const rows = sections[sectionIndex].data || [];
      for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
        const row = rows[itemIndex];
        const rowWordId = row?.wordId;
        const rowPageNum = row?.word?.line?.page?.position ?? 0;
        if (
          targetWordId != null &&
          rowWordId != null &&
          String(rowWordId) === String(targetWordId) &&
          (targetPageNum == null || Number(rowPageNum) === Number(targetPageNum))
        ) {
          return { sectionIndex, itemIndex };
        }
      }
    }

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const rows = sections[sectionIndex].data || [];
      const itemIndex = rows.findIndex(
        (row) => Number(row?.word?.line?.page?.position ?? 0) === Number(currentPage)
      );
      if (itemIndex >= 0) return { sectionIndex, itemIndex };
    }

    return { sectionIndex: 0, itemIndex: 0 };
  }, [sections, activeVariationWordId, lastSelectedVariationHighlight, currentPage]);

  useEffect(() => {
    if (!isExpanded) return;
    const target = findScrollTarget();
    if (!target) return;

    const timer = setTimeout(() => {
      sectionListRef.current?.scrollToLocation({
        sectionIndex: target.sectionIndex,
        itemIndex: target.itemIndex,
        viewPosition: 0.4,
        animated: false,
      });
    }, 40);

    return () => clearTimeout(timer);
  }, [isExpanded, findScrollTarget]);

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

      <SectionList
        ref={sectionListRef}
        style={styles.tableBody}
        contentContainerStyle={styles.tableBodyContent}
        sections={sections}
        keyExtractor={(row) => String(row.wordId)}
        stickySectionHeadersEnabled
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={({ sectionIndex = 0, index = 0 }) => {
          setTimeout(() => {
            sectionListRef.current?.scrollToLocation({
              sectionIndex,
              itemIndex: index,
              viewPosition: 0.4,
              animated: false,
            });
          }, 60);
        }}
        renderSectionHeader={({ section: { title } }) => (
          <View style={styles.surahSectionHeader}>
            <Text
              style={[styles.surahSectionTitle, { fontFamily: getQuranFontFamily(mushafId) }]}
              numberOfLines={1}
            >
              {title}
            </Text>
          </View>
        )}
        renderItem={({ item: row }) => {
          const wordId = row.wordId;
          const pageNum = row.word?.line?.page?.position ?? 0;
          const isActiveRow =
            wordId != null &&
            ((activeVariationWordId != null &&
              String(wordId) === String(activeVariationWordId)) ||
              (lastSelectedVariationHighlight &&
                currentPage === lastSelectedVariationHighlight.pageNum &&
                String(wordId) === String(lastSelectedVariationHighlight.wordId)));

          const onPressRow = () => {
            const v = pickVariationForHighlight(row);
            if (v) onSelectVariation?.(v, { pageNum, wordId });
          };

          return (
            <TouchableOpacity
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
        }}
      />
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
  surahSectionHeader: {
    backgroundColor: "#3a3b45",
    paddingVertical: 8,
    paddingHorizontal: 12,
    marginBottom: 4,
    borderRadius: 8,
  },
  surahSectionTitle: {
    fontSize: 17,
    color: "#e8eaef",
    textAlign: "center",
    includeFontPadding: false,
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
