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

/** Page index from API `word.line.page.position` (1-based mushaf page). */
function pagePositionFromWord(word) {
  const pos = word?.line?.page?.position;
  const n = Number(pos);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function rowSortKey(word) {
  if (!word) return 0;
  const page = pagePositionFromWord(word);
  const linePos = word.line?.position ?? word.line?.id ?? 0;
  const wpos = word.position ?? 0;
  return page * 1e9 + Number(linePos) * 1e6 + Number(wpos);
}

/** Match `tableBodyContent.paddingTop` + surah header + row blocks in `styles`. */
const LIST_PAD_TOP = 6;
const EST_SECTION_HEADER_H = 44;
const EST_DATA_ROW_H = 56;

/** scrollToLocation fallback: lower viewPosition = scroll farther into the list. */
const SCROLL_TARGET_VIEW_POSITION = 0.05;
/** Pixels to subtract from measured row offset so the active row sits below the top edge. */
const SCROLL_Y_NUDGE = 72;

/** VirtualizedSectionList flat index: header, rows…, footer per section. */
const EST_SECTION_FOOTER_H = 1;

function layoutForFlatIndex(sections, flatIndex) {
  let offset = LIST_PAD_TOP;
  let flat = 0;
  for (let s = 0; s < sections.length; s++) {
    if (flat === flatIndex) {
      return { length: EST_SECTION_HEADER_H, offset, index: flatIndex };
    }
    offset += EST_SECTION_HEADER_H;
    flat++;
    const rows = sections[s].data || [];
    for (let i = 0; i < rows.length; i++) {
      if (flat === flatIndex) {
        return { length: EST_DATA_ROW_H, offset, index: flatIndex };
      }
      offset += EST_DATA_ROW_H;
      flat++;
    }
    if (flat === flatIndex) {
      return { length: EST_SECTION_FOOTER_H, offset, index: flatIndex };
    }
    offset += EST_SECTION_FOOTER_H;
    flat++;
  }
  const last = Math.max(0, flat - 1);
  return { length: EST_DATA_ROW_H, offset: Math.max(0, offset - EST_DATA_ROW_H), index: last };
}

/** Map flat list index → `scrollToLocation` params (itemIndex counts header as 0). */
function scrollLocationParamsForFlatIndex(sections, flatIndex) {
  let flat = 0;
  for (let s = 0; s < sections.length; s++) {
    if (flat === flatIndex) {
      return { sectionIndex: s, itemIndex: 0 };
    }
    flat++;
    const n = sections[s].data?.length ?? 0;
    for (let i = 0; i < n; i++) {
      if (flat === flatIndex) {
        return { sectionIndex: s, itemIndex: i + 1 };
      }
      flat++;
    }
    if (flat === flatIndex) {
      return { sectionIndex: s, itemIndex: n + 1 };
    }
    flat++;
  }
  return { sectionIndex: 0, itemIndex: 0 };
}

/** Flat index for `sections[sectionIndex].data[dataIndex]` inside VirtualizedSectionList. */
function flatIndexForSectionDataRow(sections, sectionIndex, dataIndex) {
  let flat = 0;
  for (let s = 0; s < sectionIndex; s++) {
    flat += 1 + (sections[s].data?.length ?? 0) + 1;
  }
  return flat + 1 + dataIndex;
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
  /** Mushaf-focused word id — first try to scroll this row when the sheet opens. */
  scrollFocusWordId = null,
  /** Incremented when expand animation completes (re-assert scroll after full expand layout). */
  expandScrollToken = 0,
  /** When true, sheet is fully expanded — use longer scroll retries (layout often resets scroll). */
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

    const findRowByWordId = (wid) => {
      if (wid == null) return null;
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const rows = sections[sectionIndex].data || [];
        const itemIndex = rows.findIndex(
          (row) => row?.wordId != null && String(row.wordId) === String(wid)
        );
        if (itemIndex >= 0) return { sectionIndex, itemIndex };
      }
      return null;
    };

    const byFocus = findRowByWordId(scrollFocusWordId);
    if (byFocus) return byFocus;

    if (activeVariationWordId != null) {
      const byActive = findRowByWordId(activeVariationWordId);
      if (byActive) return byActive;
    }

    const targetWordId = lastSelectedVariationHighlight?.wordId;
    const targetPageNum = lastSelectedVariationHighlight?.pageNum;

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const rows = sections[sectionIndex].data || [];
      for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
        const row = rows[itemIndex];
        const rowWordId = row?.wordId;
        const rowPageNum = pagePositionFromWord(row.word);
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

    const rowsOnCurrentPage = [];
    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const rows = sections[sectionIndex].data || [];
      for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
        const row = rows[itemIndex];
        if (pagePositionFromWord(row.word) === Number(currentPage)) {
          rowsOnCurrentPage.push({
            sectionIndex,
            itemIndex,
            key: rowSortKey(row.word),
          });
        }
      }
    }

    if (rowsOnCurrentPage.length === 1) {
      const { sectionIndex, itemIndex } = rowsOnCurrentPage[0];
      return { sectionIndex, itemIndex };
    }

    if (rowsOnCurrentPage.length > 1) {
      let anchorKey = null;
      if (lastSelectedVariationHighlight?.wordId != null) {
        const hit = findRowByWordId(lastSelectedVariationHighlight.wordId);
        if (hit) {
          const row = sections[hit.sectionIndex]?.data?.[hit.itemIndex];
          anchorKey = rowSortKey(row?.word);
        }
      }

      if (anchorKey != null) {
        let best = rowsOnCurrentPage[0];
        let bestDist = Math.abs(best.key - anchorKey);
        for (let i = 1; i < rowsOnCurrentPage.length; i++) {
          const cand = rowsOnCurrentPage[i];
          const d = Math.abs(cand.key - anchorKey);
          if (d < bestDist) {
            best = cand;
            bestDist = d;
          }
        }
        return { sectionIndex: best.sectionIndex, itemIndex: best.itemIndex };
      }

      rowsOnCurrentPage.sort((a, b) => a.key - b.key);
      const first = rowsOnCurrentPage[0];
      return { sectionIndex: first.sectionIndex, itemIndex: first.itemIndex };
    }

    for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
      const rows = sections[sectionIndex].data || [];
      const itemIndex = rows.findIndex(
        (row) => pagePositionFromWord(row.word) === Number(currentPage)
      );
      if (itemIndex >= 0) return { sectionIndex, itemIndex };
    }

    // No row matched this page exactly (e.g. mushaf page indexing differs from API). Scroll to
    // the variation whose word page is closest to currentPage instead of defaulting to surah 1.
    const pageNum = Number(currentPage);
    if (Number.isFinite(pageNum) && pageNum > 0) {
      let best = null;
      let bestDist = Infinity;
      let bestKey = Infinity;
      for (let sectionIndex = 0; sectionIndex < sections.length; sectionIndex++) {
        const rows = sections[sectionIndex].data || [];
        for (let itemIndex = 0; itemIndex < rows.length; itemIndex++) {
          const row = rows[itemIndex];
          const p = pagePositionFromWord(row.word);
          if (p < 1) continue;
          const k = rowSortKey(row.word);
          const dist = Math.abs(p - pageNum);
          if (dist < bestDist || (dist === bestDist && k < bestKey)) {
            bestDist = dist;
            bestKey = k;
            best = { sectionIndex, itemIndex };
          }
        }
      }
      if (best) return best;
    }

    return { sectionIndex: 0, itemIndex: 0 };
  }, [
    sections,
    scrollFocusWordId,
    activeVariationWordId,
    lastSelectedVariationHighlight,
    currentPage,
  ]);

  const getItemLayout = useCallback(
    (_data, flatIndex) => layoutForFlatIndex(sections, flatIndex),
    [sections]
  );

  // Pre-scroll while minimized; after expand the list often resets to y=0 until layout settles, so
  // when isExpanded we retry longer. Prefer ScrollView.scrollTo(y) from getItemLayout — more reliable
  // than scrollToLocation when the sheet height jumps.
  useEffect(() => {
    const target = findScrollTarget();
    if (!target) return;

    const runScroll = () => {
      const list = sectionListRef.current;
      if (!list) return;

      const flatIdx = flatIndexForSectionDataRow(
        sections,
        target.sectionIndex,
        target.itemIndex
      );
      const { offset } = layoutForFlatIndex(sections, flatIdx);
      const y = Math.max(0, offset - SCROLL_Y_NUDGE);

      const scrollResponder = list.getScrollResponder?.();
      if (scrollResponder && typeof scrollResponder.scrollTo === "function") {
        scrollResponder.scrollTo({ x: 0, y, animated: false });
        return;
      }

      if (list.scrollToLocation) {
        list.scrollToLocation({
          sectionIndex: target.sectionIndex,
          itemIndex: target.itemIndex + 1,
          viewOffset: 0,
          viewPosition: SCROLL_TARGET_VIEW_POSITION,
          animated: false,
        });
      }
    };

    const delays = isExpanded ? [0, 40, 120, 260, 420, 560, 720] : [0, 40, 120, 260];
    const ids = delays.map((ms) => setTimeout(runScroll, ms));
    return () => ids.forEach(clearTimeout);
  }, [findScrollTarget, expandScrollToken, sections, currentPage, isExpanded]);

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
        getItemLayout={getItemLayout}
        stickySectionHeadersEnabled={false}
        removeClippedSubviews={false}
        showsVerticalScrollIndicator
        keyboardShouldPersistTaps="handled"
        onScrollToIndexFailed={({ index: flatIndex }) => {
          setTimeout(() => {
            const list = sectionListRef.current;
            if (!list) return;
            const { offset } = layoutForFlatIndex(sections, flatIndex);
            const y = Math.max(0, offset - SCROLL_Y_NUDGE);
            const sr = list.getScrollResponder?.();
            if (sr?.scrollTo) {
              sr.scrollTo({ x: 0, y, animated: false });
              return;
            }
            const p = scrollLocationParamsForFlatIndex(sections, flatIndex);
            list.scrollToLocation?.({
              sectionIndex: p.sectionIndex,
              itemIndex: p.itemIndex,
              viewOffset: 0,
              viewPosition: SCROLL_TARGET_VIEW_POSITION,
              animated: false,
            });
          }, 64);
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
          const pageNum = pagePositionFromWord(row.word);
          const isActiveRow =
            wordId != null &&
            ((scrollFocusWordId != null &&
              Number(pageNum) === Number(currentPage) &&
              String(wordId) === String(scrollFocusWordId)) ||
              (activeVariationWordId != null &&
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
