import React, { useState, useEffect, useLayoutEffect, useRef, useMemo, useCallback } from "react";
import { useFonts } from "expo-font";
import Constants from "expo-constants";
import {
  StyleSheet,
  View,
  Text,
  Image,
  ScrollView,
  ActivityIndicator,
  StatusBar,
  Platform,
  TouchableOpacity,
  TextInput,
  Pressable,
  Modal,
  Dimensions,
  SafeAreaView,
  Animated,
  Easing,
  PanResponder,
  Keyboard,
  Alert,
  AppState,
  Linking,
} from "react-native";
import {
  SafeAreaProvider,
  SafeAreaView as SafeAreaViewEdged,
  useSafeAreaInsets,
} from "react-native-safe-area-context";
import { Gesture, GestureDetector, GestureHandlerRootView } from "react-native-gesture-handler";
import PagerView from "./components/PagerViewAdapter";
import { Slider } from "@miblanchard/react-native-slider";
import ComparisonTable from "./ComparisonTable";
import InlineComparison from "./InlineComparison";
import { DiamondShapeSvg, DIAMOND_SIZING } from "./components/DiamondOverlayText";
import segmentsData from "./segments.json";
import { surahArabicName, surahEnglishAlias } from "./surahMeta";
import QiraatSettingsModal from "./components/QiraatSettingsModal";
import ShubahWordAudioButton from "./components/ShubahWordAudioButton";
import VariationBottomSheet, { TRANSLATE_MINIMIZED } from "./components/VariationBottomSheet";
import WebPasswordGate from "./components/WebPasswordGate";
import {
  VerserWordBody,
  VerserToolbarButton,
  VerserSaveAyahButton,
  VerserAyahRangeModal,
  useVerserMode,
  wordIdsInInclusiveRange,
  wordIdsFromNextPreviewThroughClick,
  incrementSurahAyah,
  rangeSegmentIndexByWordId,
  suggestVerserLabelFromRange,
} from "./verser";
import { getWordSegmentForText } from "./components/shubahTimestamps";
import { Search, Volume2 } from "react-native-feather";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { Audio } from "expo-av";
import {
  scheduleListenNowPlayingSync,
  clearListenNowPlaying,
  subscribeListenRemoteCommands,
} from "aswaat-now-playing";
import { checkIosMinVersionFromApi } from "./iosMinVersionGate";

/** Used when `expo.extra.iosAppStoreUrl` is missing (common in Expo Go) or not a valid App Store / https URL. */
const DEFAULT_IOS_APP_STORE_URL = "https://apps.apple.com/us/app/aswaat/id6754865252";

function resolveIosAppStoreUrl() {
  const fromExpoConfig =
    typeof Constants.expoConfig?.extra?.iosAppStoreUrl === "string"
      ? Constants.expoConfig.extra.iosAppStoreUrl.trim()
      : "";
  const fromManifest =
    typeof Constants.manifest?.extra?.iosAppStoreUrl === "string"
      ? Constants.manifest.extra.iosAppStoreUrl.trim()
      : "";
  const fromManifest2 =
    typeof Constants.manifest2?.extra?.expoClient?.extra?.iosAppStoreUrl === "string"
      ? Constants.manifest2.extra.expoClient.extra.iosAppStoreUrl.trim()
      : "";
  const candidate = fromExpoConfig || fromManifest2 || fromManifest;
  if (
    /^https:\/\/(apps\.apple\.com|itunes\.apple\.com)\b/i.test(candidate) ||
    /^itms-apps:\/\//i.test(candidate)
  ) {
    return candidate;
  }
  return DEFAULT_IOS_APP_STORE_URL;
}

/**
 * Set `true` to point all API calls at a local Rails app (overrides Railway / Vercel same-origin rules).
 * For a physical device, set `LOCAL_API_BASE` to your machine’s LAN IP (e.g. http://192.168.1.5:3000).
 */
const USE_LOCALHOST_API = false;
const LOCAL_API_BASE = "http://localhost:3000";

/** Direct Railway API (native apps and local Expo web when not using localhost override). */
const RAILWAY_API_BASE = "https://qiraat-api-v2-production.up.railway.app";

/**
 * On deployed web (e.g. Vercel), use same-origin `/api/*` so the browser does not
 * cross-origin call Railway; `vercel.json` rewrites `/api` to Railway.
 * When not overriding, local web (`localhost`) still calls Railway — ensure `api/config/initializers/cors.rb` allows that origin.
 */
const getApiBase = () => {
  if (USE_LOCALHOST_API) return LOCAL_API_BASE;
  if (Platform.OS !== "web") return RAILWAY_API_BASE;
  if (typeof window === "undefined") return RAILWAY_API_BASE;
  const { hostname, origin } = window.location;
  if (hostname === "localhost" || hostname === "127.0.0.1") return RAILWAY_API_BASE;
  return origin;
};

const getNarratorsUrl = () => `${getApiBase()}/api/narrators`;
const getVariationsUrl = () => `${getApiBase()}/api/variations`;
const getRecitersUrl = () => `${getApiBase()}/api/reciters`;
const getRecitationsUrl = (reciterSlug) =>
  `${getApiBase()}/api/reciters/${encodeURIComponent(reciterSlug)}/recitations`;
const getVerseSegmentsUrl = (recitationId) =>
  `${getApiBase()}/api/recitations/${encodeURIComponent(String(recitationId))}/verse_segments`;

/** Resolve segment + audio URL by verse when the Listen catalog is empty or lacks recitation_id. */
const buildVerseSegmentLookupUrl = (verse, { reciterSlug, narratorSlug } = {}) => {
  const p = new URLSearchParams();
  p.set("verse", verse);
  if (reciterSlug) p.set("reciter_slug", reciterSlug);
  if (narratorSlug) p.set("narrator_slug", narratorSlug);
  return `${getApiBase()}/api/recitation_verse_segments/lookup?${p.toString()}`;
};

/** Trimmed surah:ayah for comparing API `word.ayah` to `RecitationVerseSegment#verse`. */
const normalizeAyahLabelForListen = (s) => (s == null ? "" : String(s)).trim();

/** True when verse-segment lookup returns a playable clip (same check as chip playback). */
async function fetchRecitationVerseSegmentPlayable(normalizedAyah, narratorSlug) {
  const ayah = normalizeAyahLabelForListen(normalizedAyah);
  if (!ayah || !ayah.includes(":") || !narratorSlug) return false;
  try {
    const lookupUrl = buildVerseSegmentLookupUrl(ayah, { narratorSlug });
    const res = await fetch(lookupUrl);
    if (!res.ok) return false;
    const payload = await res.json();
    return !!(payload?.audio_url && payload.recitation_id != null);
  } catch {
    return false;
  }
}

/**
 * @param {{ start_time: number, end_time: number }[]} segments sorted by start_time
 * @param {number} sec
 */
function recitationSegmentAtSeconds(segments, sec) {
  if (!Array.isArray(segments) || segments.length === 0) return null;
  for (let i = 0; i < segments.length; i++) {
    const seg = segments[i];
    const st = Number(seg.start_time);
    const en = Number(seg.end_time);
    if (!Number.isFinite(st) || !Number.isFinite(en)) continue;
    const last = i === segments.length - 1;
    if (sec >= st && (sec < en || (last && sec <= en))) return seg;
  }
  return null;
}

// Font by mushaf: 2 = 13 Liner IndoPak (AswaatOne), 3 = 15 Liner Uthmani (DigitalKhattV3)
const getQuranFontFamily = (mushafId) => (mushafId === 3 ? "DigitalKhatt" : "AswaatOne");
const QURAN_FONT_FAMILY = "DigitalKhatt"; // default for styles; use getQuranFontFamily(mushafId) for page content

// Manual font size and line height per mushaf (set to null to use style defaults)
const MUSHAF_2_FONT_SIZE = null;   // 13 Liner IndoPak — set number to override (e.g. 22)
const MUSHAF_2_LINE_HEIGHT = null; // 13 Liner IndoPak — set number to override (e.g. 44)
const MUSHAF_3_FONT_SIZE = 18;   // 15 Liner Uthmani — tuned for Bayaan-like spacing
const MUSHAF_3_LINE_HEIGHT = 39; // 15 Liner Uthmani — slightly tighter than before to mimic Qul/Bayaan layout
const getMushafFontSize = (mushafId) => (mushafId === 2 ? MUSHAF_2_FONT_SIZE : MUSHAF_3_FONT_SIZE);
const getMushafLineHeight = (mushafId) => (mushafId === 2 ? MUSHAF_2_LINE_HEIGHT : MUSHAF_3_LINE_HEIGHT);

/**
 * Feature flags — flip booleans here for releases without hunting through App.js.
 * @property {boolean} mushaf2HeaderInsert — Mushaf 2: Header/Save bar, line targets, surah picker, stacked preview, save-to-API. On web only, defaults on.
 * @property {boolean} mushafLineAutoFitFont — Shrink font only until words fit row; row minHeight / Text lineHeight stay fixed; words vertically centered in the row (debug overflow).
 * @property {boolean} verser — Mushaf 2 top bar: Verser tool (no behavior until wired). On web only, defaults on.
 * @property {boolean} wordLongPressVariationEditor — Long-press a mushaf word opens the narrator / variation editor popup. On web only, defaults on.
 * @property {boolean} variationWordListenBadge — Prefetch + short tap on variation words; bottom bar volume badges when enabled with traversal playability.
 * @property {boolean} variationWordListenBadgeOnMushafWords — When false, no volume pill on mushaf text (tap-to-play still works); traversal chips keep their badges.
 */
const FEATURE_FLAGS = {
  mushaf2HeaderInsert: Platform.OS === "web",
  mushafLineAutoFitFont: true,
  verser: Platform.OS === "web",
  wordLongPressVariationEditor: Platform.OS === "web",
  variationWordListenBadge: true,
  variationWordListenBadgeOnMushafWords: false,
};

/**
 * Tuning for `FEATURE_FLAGS.mushafLineAutoFitFont` only.
 * Scale is computed as (rowWidth − widthSlackPx) / sumWordWidths × fitFudge, then clamped to [minFontScale, maxFontScale].
 */
const MUSHAF_LINE_AUTO_FIT = {
  widthSlackPx: 2,
  fitFudge: 0.985,
  minFontScale: 0.48,
  maxFontScale: 1,
  /** Ignore tiny scale updates (reduces churn). */
  scaleEpsilon: 0.006,
};

const MUSHAF_2_MAX_PAGE_LINES = 13;
/** Matches `surahPickerChip` width + `marginRight` for scroll-centering in header surah sheet */
const SURAH_HEADER_PICKER_CHIP_W = 92;
const SURAH_HEADER_PICKER_CHIP_GAP = 8;

/** Indo-Pak mushaf (2): surah-name-v2.ttf maps surah banners to U+E001, U+E002, … (U+E000 + position). */
const SURAH_HEADER_V2_FONT_FAMILY = "SurahNameV2";
/** Mushaf 2: lines with surah_header_position -1 (basmalah row) use nastaleeq.ttf for U+FDFD. */
const MUSHAF2_BISMILLAH_HEADER_FONT_FAMILY = "Nastaleeq";
const BISMILLAH_LIGATURE_U_FDFD = "\uFDFD";

const getSurahHeaderV2Glyph = (surahHeaderPosition) => {
  const n = Number(surahHeaderPosition);
  if (!Number.isFinite(n) || n <= 0) return null;
  return String.fromCodePoint(0xe000 + n);
};

// Recite tab: extra padding below the Hafs|Shubah bar (above safe area). Reduce if the last line of mushaf gets cut off; increase if the bar feels too tight.
const RECITE_BOTTOM_BAR_PADDING_BOTTOM = -28;
// Kept at 0 so the traversal bar matches the Hafs|narrator strip; off-page UI uses the same minHeight as the segmented control.
const OFF_PAGE_TRAVERSAL_BAR_BOTTOM_PAD_EXTRA = 0;

// Drawer header lines up with mushaf body text: approximate mushafTopBar height + PageView top padding (container + pageContent).
const MUSHAF_DRAWER_CONTENT_TOP_OFFSET = 56 + 10;

const HELPER_FONT_FAMILY = "AswaatHelpers";
const DEFAULT_LISTEN_RECITER_SLUG = "abdul-rashid-ali-sufi";
const LISTEN_AVATAR_FALLBACK_BY_SLUG = {
  "abdul-rashid-ali-sufi": require("./reciters/avatars/abdul-rashid-ali-sufi.png"),
};
const LISTEN_PLAYER_MARGIN = 10;

const listenReciterAvatarSource = (reciter) => {
  const u = (reciter?.avatar_url || "").trim();
  if (u) return { uri: u };
  const fb = reciter?.slug && LISTEN_AVATAR_FALLBACK_BY_SLUG[reciter.slug];
  return fb || LISTEN_AVATAR_FALLBACK_BY_SLUG[DEFAULT_LISTEN_RECITER_SLUG];
};

const listenReciterDisplayName = (reciters, slug) => {
  if (slug === "all") return "All";
  const row = reciters.find((r) => r.slug === slug);
  return row?.name || slug;
};

const listenLibraryIdForRiwayah = (riwayahId) => {
  if (riwayahId === "hafs-an-asim") return "hafs";
  if (riwayahId === "shubah-an-asim") return "shubah";
  return riwayahId;
};

/** Map mushaf `/api/narrators` child id → `RecitationNarrator#slug` for verse-segment lookup. */
const recitationNarratorSlugForMushafNarratorId = (narratorId, parentNarrators) => {
  if (narratorId == null) return null;
  if (narratorId === "hafs-an-asim" || narratorId === "hafs") return "hafs-an-asim";
  const idStr = String(narratorId);
  for (const parent of parentNarrators || []) {
    for (const child of parent.children || []) {
      if (String(child.id) !== idStr) continue;
      const t = (child.title || "").toLowerCase();
      if (t.includes("shubah") || (t.includes("shu") && t.includes("bah"))) return "shubah-an-asim";
      if (t.includes("hafs")) return "hafs-an-asim";
      return null;
    }
  }
  return null;
};

// Helper function to render highlighted text (extracted from ComparisonTable logic)
const renderHighlightedText = (text1, text2, wordStyle, differentCharStyle) => {
  const diacritics = ["َ", "ِ", "ُ", "ْ"];
  const isDiacritic = (char) => diacritics.includes(char);

  // Group characters into units: base letter + its diacritics
  const groupUnits = (text) => {
    const chars = text.split("");
    const units = [];
    let i = 0;

    while (i < chars.length) {
      const unit = { base: chars[i], diacritics: [], index: i, length: 1 };
      i++;

      // Collect any following diacritics
      while (i < chars.length && isDiacritic(chars[i])) {
        unit.diacritics.push(chars[i]);
        unit.length++;
        i++;
      }

      unit.full = unit.base + unit.diacritics.join("");
      units.push(unit);
    }

    return units;
  };

  const units1 = groupUnits(text1);
  const units2 = groupUnits(text2);
  const maxLength = Math.max(units1.length, units2.length);

  // Identify which units are different
  const differences = new Set();

  for (let i = 0; i < maxLength; i++) {
    const unit1 = units1[i];
    const unit2 = units2[i];

    if (!unit1 || !unit2 || unit1.full !== unit2.full) {
      differences.add(i);
    }
  }

  // Create segments
  const segments = [];
  let currentSegment = { text: "", isDifferent: false };

  for (let i = 0; i < maxLength; i++) {
    const unit1 = units1[i];
    const isDifferent = differences.has(i);

    if (!unit1) break;

    if (isDifferent !== currentSegment.isDifferent && currentSegment.text) {
      segments.push({ ...currentSegment });
      currentSegment = { text: "", isDifferent };
    }

    currentSegment.text += unit1.full;
    currentSegment.isDifferent = isDifferent;
  }

  if (currentSegment.text) {
    segments.push(currentSegment);
  }

  return segments.map((segment, index) => (
    <Text
      key={index}
      style={[wordStyle, segment.isDifferent && differentCharStyle]}
    >
      {segment.text}
    </Text>
  ));
};

const Line = ({
  words,
  onWordPress,
  selectedWordId,
  savedVariations,
  selectedNarrators,
  allVariations = {},
  narratorHighlightColorById = {},
  isFirstLineOfJuz = false,
  isDarkMode = false,
  mushafId = 3,
  linePosition = null,
  surahHeaderPosition = 0,
  suppressLine = false,
  // Kept for compatibility: older bundles or merges referenced this; always false now (single-line header).
  forceHeaderRender = false,
  /** When true (header insert mode), words are not long-pressable so the line tap target receives touches */
  disableWordLongPress = false,
  verserActive = false,
  verserAyahPreview = {},
  verserRangeSegmentByWordId = {},
  verserAnchorWordId = null,
  onVerserWordTap,
  /** `surah:ayah` matching current listen segment from `RecitationVerseSegment` */
  recitationListenHighlightVerse = null,
  /** Mushaf page number for this line — used with `onVariationTraversalWordTap` */
  pageNum = null,
  /** Short tap: jump bottom traversal bar to this word if it is a narration-change for the selected narrator */
  onVariationTraversalWordTap = null,
  /** When set, word ids (strings) on this page that show the listenable-variation volume badge */
  variationListenBadgeWordIds = null,
  /** Matches loading state for traversal chip clip (spinner on mushaf badge for that word) */
  chipClipLoadingBadge = null,
}) => {
  const normalizedWords = Array.isArray(words) ? words : [];
  const hasRenderableWords = normalizedWords.some((word) => {
    if (!word) return false;
    if (typeof word.content === "string") return word.content.trim().length > 0;
    return !!word.content;
  });
  const isMushaf2GlyphLine =
    mushafId === 2 && (forceHeaderRender || !hasRenderableWords);

  const wordRefs = useRef({});
  const lineRowWidthRef = useRef(0);
  const wordWidthsRef = useRef([]);
  const fitRafRef = useRef(null);
  const [lineFontScale, setLineFontScale] = useState(1);
  const wordsKey = useMemo(
    () =>
      (Array.isArray(words) ? words : [])
        .map((w) => `${w?.id}:${w?.content ?? ""}`)
        .join("|"),
    [words]
  );

  const autoFitLine =
    FEATURE_FLAGS.mushafLineAutoFitFont &&
    !suppressLine &&
    !isMushaf2GlyphLine &&
    hasRenderableWords &&
    normalizedWords.length > 0;

  useEffect(() => {
    setLineFontScale(1);
    lineRowWidthRef.current = 0;
    wordWidthsRef.current = [];
  }, [wordsKey]);

  const scheduleLineFitMeasure = useCallback(() => {
    if (!autoFitLine) return;
    if (fitRafRef.current != null) cancelAnimationFrame(fitRafRef.current);
    fitRafRef.current = requestAnimationFrame(() => {
      fitRafRef.current = null;
      const W = lineRowWidthRef.current;
      const n = normalizedWords.length;
      const widths = wordWidthsRef.current;
      const { widthSlackPx, fitFudge, minFontScale, maxFontScale, scaleEpsilon } = MUSHAF_LINE_AUTO_FIT;
      if (!W || n === 0) return;
      let sum = 0;
      for (let i = 0; i < n; i++) {
        const wi = widths[i];
        if (wi == null || wi <= 0) return;
        sum += wi;
      }
      if (sum <= W - 1) return;
      const raw = ((W - widthSlackPx) / sum) * fitFudge;
      const next = Math.min(maxFontScale, Math.max(minFontScale, raw));
      setLineFontScale((prev) => (Math.abs(prev - next) < scaleEpsilon ? prev : next));
    });
  }, [autoFitLine, normalizedWords.length]);

  // Re-measure after line content changes. Do not clear word widths on font-scale-only updates:
  // some platforms skip child onLayout after a font change, which left the ref sparse and broke fitting until remount (e.g. hot reload).
  useLayoutEffect(() => {
    if (!autoFitLine) return;
    let raf2;
    const raf1 = requestAnimationFrame(() => {
      raf2 = requestAnimationFrame(() => {
        scheduleLineFitMeasure();
      });
    });
    return () => {
      cancelAnimationFrame(raf1);
      if (raf2 != null) cancelAnimationFrame(raf2);
    };
  }, [autoFitLine, wordsKey, scheduleLineFitMeasure]);

  useEffect(
    () => () => {
      if (fitRafRef.current != null) cancelAnimationFrame(fitRafRef.current);
    },
    []
  );

  if (suppressLine) return null;

  const lineStyle = [styles.line];
  const wordStyle = [styles.word];
  let inlineTextStyle = undefined;

  // Border between lines: only for mushaf 2 (13 Liner IndoPak); none for mushaf 3 (15 Liner Uthmani)
  if (mushafId === 2) {
    lineStyle.push(styles.lineWithBorder);
    if (isDarkMode) lineStyle.push(styles.lineWithBorderDark);
  }

  if (isDarkMode) {
    lineStyle.push(styles.lineDark);
    wordStyle.push(styles.wordDark);
  }

  if (isFirstLineOfJuz) {
    if (isDarkMode) {
      lineStyle.push(styles.firstLineOfJuzDark);
      wordStyle.push(styles.firstLineOfJuzDarkText);
      inlineTextStyle = styles.firstLineOfJuzDarkText;
    } else {
      lineStyle.push(styles.firstLineOfJuz);
      wordStyle.push(styles.firstLineOfJuzText);
      inlineTextStyle = styles.firstLineOfJuzText;
    }
  }

  wordStyle.push({ fontFamily: getQuranFontFamily(mushafId) });

  const fontSize = getMushafFontSize(mushafId);
  const lineHeight = getMushafLineHeight(mushafId);
  const fitScale = autoFitLine ? lineFontScale : 1;
  const fixedLineHeight = lineHeight ?? styles.word.lineHeight;

  if (fontSize != null) wordStyle.push({ fontSize: fontSize * fitScale });
  else if (autoFitLine) wordStyle.push({ fontSize: styles.word.fontSize * fitScale });

  if (autoFitLine) {
    wordStyle.push({
      lineHeight: fixedLineHeight,
      ...(Platform.OS === "android" && {
        includeFontPadding: false,
        textAlignVertical: "center",
      }),
    });
    lineStyle.push({ minHeight: fixedLineHeight });
  } else if (lineHeight != null) {
    wordStyle.push({ lineHeight });
    lineStyle.push({ minHeight: lineHeight });
  }

  const effectiveWordLineHeight =
    getMushafLineHeight(mushafId) ?? styles.word.lineHeight;

  // 13-line Indo-Pak (mushaf 2): placeholder lines (e.g. basmalah) have no words from the API
  if (mushafId === 2 && (forceHeaderRender || !hasRenderableWords)) {
    const totalHeaderHeight = effectiveWordLineHeight;
    const headerPosNum = Number(surahHeaderPosition);
    const isBismillahLigatureRow = headerPosNum === -1;
    const headerGlyph = isBismillahLigatureRow
      ? BISMILLAH_LIGATURE_U_FDFD
      : getSurahHeaderV2Glyph(surahHeaderPosition);
    const headerFontFamily = isBismillahLigatureRow
      ? MUSHAF2_BISMILLAH_HEADER_FONT_FAMILY
      : SURAH_HEADER_V2_FONT_FAMILY;
    // Nastaleeq U+FDFD has loose vertical metrics; center optically and keep clear of row borders.
    const bismillahFontSize = Math.round(totalHeaderHeight * 0.5);
    const bismillahLineHeight = Math.round(bismillahFontSize + 30);
    const bismillahNudgeY = -Math.round(totalHeaderHeight * 0.130);
    return (
      <View
        style={[
          ...lineStyle,
          {
            height: totalHeaderHeight,
            minHeight: totalHeaderHeight,
            overflow: "hidden",
            alignItems: "center",
            justifyContent: "center",
            ...(isBismillahLigatureRow && { paddingVertical: 3 }),
          },
        ]}
      >
        {headerGlyph ? (
          <Text
            allowFontScaling={false}
            style={{
              fontFamily: headerFontFamily,
              width: "100%",
              textAlign: "center",
              color: isDarkMode ? "#ffffff" : "#1a1a1a",
              ...(Platform.OS === "ios" && { fontWeight: "normal", fontStyle: "normal" }),
              ...(isBismillahLigatureRow
                ? {
                    fontSize: bismillahFontSize,
                    lineHeight: bismillahLineHeight,
                    includeFontPadding: Platform.OS === "android" ? false : undefined,
                    ...(Platform.OS === "android" && { textAlignVertical: "center" }),
                    transform: [{ translateY: bismillahNudgeY }],
                  }
                : {
                    fontSize: totalHeaderHeight * 0.88,
                    lineHeight: totalHeaderHeight,
                    height: totalHeaderHeight,
                  }),
            }}
          >
            {headerGlyph}
          </Text>
        ) : null}
      </View>
    );
  }

  return (
    <View
      style={lineStyle}
      onLayout={(e) => {
        if (!autoFitLine) return;
        lineRowWidthRef.current = e.nativeEvent.layout.width;
        scheduleLineFitMeasure();
      }}
    >
      {normalizedWords.map((word, index) => {
        let contentToRender = <Text style={wordStyle}>{word.content}</Text>;

        // Find a saved variation for this word from selected narrators
        // Only show variation if it's both in allVariations AND in savedVariations
        // This ensures deleted variations don't show even if they're temporarily in allVariations
        const matchingVariation = Object.entries(allVariations).find(
          ([variationKey, variation]) => {
            const [wordIdFromKey, narratorIdFromKey] = variationKey.split("-");
            const isWordMatch = wordIdFromKey === word.id.toString();
            const isSaved = savedVariations.includes(variationKey);
            const isNarratorSelected = selectedNarrators.some(
              (id) => id.toString() === narratorIdFromKey
            );

            // Must be saved AND narrator selected to show variation
            // If deleted, it won't be in savedVariations, so original text will show
            return isWordMatch && isSaved && isNarratorSelected;
          }
        );

        const variation = matchingVariation ? matchingVariation[1] : null;
        const variationContent =
          variation && typeof variation === "object" ? variation.content : (variation || word.content);
        const variationImalah =
          variation && typeof variation === "object" && variation.imalah ? variation.imalah : null;
        const variationDiamond =
          variation && typeof variation === "object" && variation.diamond ? variation.diamond : null;
        const hasOverlay = !!(variationImalah?.indices?.length || variationDiamond?.indices?.length);

        const variationKeyStr = matchingVariation ? matchingVariation[0] : "";
        const narratorIdFromKey =
          variationKeyStr && variationKeyStr.includes("-")
            ? variationKeyStr.slice(variationKeyStr.indexOf("-") + 1)
            : null;
        const comparisonHighlightColor =
          narratorIdFromKey != null
            ? narratorHighlightColorById[String(narratorIdFromKey)]
            : undefined;

        if (matchingVariation && variation) {
          const comparisonStyleParts = [
            inlineTextStyle,
            autoFitLine
              ? {
                  fontSize: (getMushafFontSize(mushafId) ?? styles.word.fontSize) * lineFontScale,
                  lineHeight: getMushafLineHeight(mushafId) ?? styles.word.lineHeight,
                  ...(Platform.OS === "android" && {
                    includeFontPadding: false,
                    textAlignVertical: "center",
                  }),
                }
              : null,
          ].filter(Boolean);
          const comparisonTextStyle =
            comparisonStyleParts.length > 0 ? StyleSheet.flatten(comparisonStyleParts) : undefined;
          contentToRender = (
            <InlineComparison
              originalText={word.content}
              inputText={variationContent}
              fontFamily={getQuranFontFamily(mushafId)}
              textStyle={comparisonTextStyle}
              imalahData={variationImalah}
              diamondData={variationDiamond}
              comparisonHighlightColor={comparisonHighlightColor}
            />
          );
        }

        const verserWordBody = (
          <VerserWordBody
            active={verserActive}
            isDarkMode={isDarkMode}
            word={word}
            ayahPreview={verserAyahPreview[String(word.id)]}
            rangeSegmentIndex={verserRangeSegmentByWordId[String(word.id)]}
          >
            {contentToRender}
          </VerserWordBody>
        );

        const verserAnchorHighlight =
          verserActive &&
          verserAnchorWordId != null &&
          String(word.id) === String(verserAnchorWordId);

        const ayahForListenHighlight =
          verserAyahPreview[String(word.id)] !== undefined
            ? verserAyahPreview[String(word.id)]
            : word?.ayah;
        const recitationListenHighlight =
          !!recitationListenHighlightVerse &&
          normalizeAyahLabelForListen(ayahForListenHighlight) ===
            normalizeAyahLabelForListen(recitationListenHighlightVerse);

        const wordContainerStyle = disableWordLongPress
          ? [
              styles.wordPressable,
              selectedWordId === word.id && styles.wordSelected,
              verserAnchorHighlight && styles.verserRangeAnchor,
              recitationListenHighlight &&
                (isDarkMode ? styles.wordRecitationListenHighlightDark : styles.wordRecitationListenHighlight),
              hasOverlay && (isDarkMode ? styles.wordBlockWithOverlayDark : styles.wordBlockWithOverlay),
            ]
          : ({ pressed }) => [
              styles.wordPressable,
              pressed && styles.wordPressed,
              selectedWordId === word.id && styles.wordSelected,
              verserAnchorHighlight && styles.verserRangeAnchor,
              recitationListenHighlight &&
                (isDarkMode ? styles.wordRecitationListenHighlightDark : styles.wordRecitationListenHighlight),
              hasOverlay && (isDarkMode ? styles.wordBlockWithOverlayDark : styles.wordBlockWithOverlay),
            ];

        if (disableWordLongPress) {
          return (
            <View
              key={`${word.id}-${index}`}
              style={wordContainerStyle}
              onLayout={(ev) => {
                if (!autoFitLine) return;
                wordWidthsRef.current[index] = ev.nativeEvent.layout.width;
                scheduleLineFitMeasure();
              }}
            >
              {verserWordBody}
            </View>
          );
        }

        const fireVerserTap = () => {
          if (!verserActive || !onVerserWordTap) return;
          onVerserWordTap({
            ...word,
            lineWords: words,
          });
        };

        const fireVariationTraversalTap = () => {
          if (!onVariationTraversalWordTap || pageNum == null || !word?.id) return;
          onVariationTraversalWordTap(word, pageNum);
        };

        const showListenBadge =
          FEATURE_FLAGS.variationWordListenBadge &&
          FEATURE_FLAGS.variationWordListenBadgeOnMushafWords &&
          !!variationListenBadgeWordIds &&
          variationListenBadgeWordIds.has(String(word.id));

        const badgeClipLoading =
          chipClipLoadingBadge?.kind === "mushaf-word" &&
          String(chipClipLoadingBadge.wordId) === String(word.id);

        const handleWordShortPress = () => {
          if (verserActive && onVerserWordTap) {
            fireVerserTap();
            return;
          }
          fireVariationTraversalTap();
        };

        return (
          <Pressable
            key={`${word.id}-${index}`}
            ref={(ref) => (wordRefs.current[word.id] = ref)}
            onPress={handleWordShortPress}
            onLayout={(ev) => {
              if (!autoFitLine) return;
              wordWidthsRef.current[index] = ev.nativeEvent.layout.width;
              scheduleLineFitMeasure();
            }}
            onLongPress={
              FEATURE_FLAGS.wordLongPressVariationEditor
                ? () => {
                    // Measure the word's absolute position
                    const ref = wordRefs.current[word.id];
                    if (ref && ref.measure) {
                      ref.measure((x, y, width, height, pageX, pageY) => {
                        word.layout = { x: pageX, y: pageY, width, height };
                        // Attach simple line context so audio matching can use nearby words
                        const wordWithContext = {
                          ...word,
                          lineWords: words,
                        };
                        onWordPress(wordWithContext);
                      });
                    }
                  }
                : undefined
            }
            delayLongPress={FEATURE_FLAGS.wordLongPressVariationEditor ? 500 : undefined}
            cancelable={true}
            style={
              showListenBadge
                ? (state) => [
                    ...wordContainerStyle(state),
                    styles.wordPressableListenOverflow,
                  ]
                : wordContainerStyle
            }
          >
            {showListenBadge ? (
              <View style={styles.wordWithListenBadgeWrap}>
                {verserWordBody}
                <Pressable
                  accessibilityRole="button"
                  accessibilityLabel="Play variation audio"
                  onPress={handleWordShortPress}
                  style={styles.wordListenBadge}
                  hitSlop={{ top: 5, bottom: 5, left: 5, right: 5 }}
                >
                  <View
                    style={[
                      styles.wordListenBadgeInner,
                      isDarkMode && styles.wordListenBadgeInnerDark,
                    ]}
                  >
                    {badgeClipLoading ? (
                      <ActivityIndicator color="#ffffff" style={styles.wordListenBadgeSpinner} />
                    ) : (
                      <Volume2
                        stroke="#ffffff"
                        width={8}
                        height={8}
                        strokeWidth={1.85}
                      />
                    )}
                  </View>
                </Pressable>
              </View>
            ) : (
              verserWordBody
            )}
          </Pressable>
        );
      })}
    </View>
  );
};

function mergeSurahHeaderPreview(basePage, preview, opIndex = 0) {
  if (!basePage?.lines || !preview) return basePage;
  const { insertAtPosition, surahNumber, useBasmala } = preview;
  const sorted = [...basePage.lines].sort((a, b) => a.position - b.position);
  const shift = useBasmala ? 2 : 1;
  const left = sorted.filter((l) => l.position < insertAtPosition);
  const right = sorted
    .filter((l) => l.position >= insertAtPosition)
    .map((l) => ({ ...l, position: l.position + shift }));
  const idKey = `${opIndex}-${insertAtPosition}-${surahNumber}-${useBasmala ? 2 : 1}`;
  const inserted = useBasmala
    ? [
        {
          id: `preview-s-${idKey}`,
          position: insertAtPosition,
          surah_header_position: surahNumber,
          words: [],
        },
        {
          id: `preview-b-${idKey}`,
          position: insertAtPosition + 1,
          surah_header_position: -1,
          words: [],
        },
      ]
    : [
        {
          id: `preview-s-${idKey}`,
          position: insertAtPosition,
          surah_header_position: surahNumber,
          words: [],
        },
      ];
  return { ...basePage, lines: [...left, ...inserted, ...right] };
}

function mergeSurahHeaderPreviewChain(basePage, operations) {
  if (!basePage?.lines || !operations?.length) return basePage;
  let page = basePage;
  operations.forEach((op, i) => {
    page = mergeSurahHeaderPreview(page, op, i);
  });
  return page;
}

const PageView = ({
  page,
  onWordPress,
  selectedWordId,
  loading,
  savedVariations,
  selectedNarrators,
  allVariations,
  narratorHighlightColorById = {},
  highlightFirstLine = false,
  isDarkMode = false,
  mushafId = 3,
  headerInsertMode = false,
  onHeaderInsertLinePress,
  verserActive = false,
  verserAyahPreview = {},
  verserAnchorWordId = null,
  onVerserWordTap,
  recitationListenHighlightVerse = null,
  onVariationTraversalWordTap = null,
  variationListenBadgeWordIds = null,
  chipClipLoadingBadge = null,
}) => {

  if (loading) {
    const containerStyle = isDarkMode
      ? [styles.container, styles.containerDark]
      : styles.container;
    const pageContentStyle = isDarkMode
      ? [styles.pageContent, styles.pageContentDark]
      : styles.pageContent;

    return (
      <View style={containerStyle}>
        <View style={pageContentStyle}>
          <View style={styles.pageStateWrap}>
            <View
              style={[
                styles.pageStateCard,
                isDarkMode && styles.pageStateCardDark,
              ]}
            >
              <ActivityIndicator size="large" color={isDarkMode ? "#fff" : "#111827"} />
              <Text
                style={[
                  styles.pageStateTitle,
                  isDarkMode && styles.pageStateTitleDark,
                ]}
              >
                Loading page...
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  if (!page || !page.lines) {
    const containerStyle = isDarkMode
      ? [styles.container, styles.containerDark]
      : styles.container;
    const pageContentStyle = isDarkMode
      ? [styles.pageContent, styles.pageContentDark]
      : styles.pageContent;

    return (
      <View style={containerStyle}>
        <View style={pageContentStyle}>
          <View style={styles.pageStateWrap}>
            <View
              style={[
                styles.pageStateCard,
                isDarkMode && styles.pageStateCardDark,
              ]}
            >
              <ActivityIndicator size="large" color={isDarkMode ? "#fff" : "#111827"} />
              <Text
                style={[
                  styles.pageStateTitle,
                  isDarkMode && styles.pageStateTitleDark,
                ]}
              >
                Loading page...
              </Text>
            </View>
          </View>
        </View>
      </View>
    );
  }

  const containerStyle = isDarkMode
    ? [styles.container, styles.containerDark]
    : styles.container;
  const pageContentStyle = isDarkMode
    ? [styles.pageContent, styles.pageContentDark]
    : styles.pageContent;
  const linesWithHeaderRenderMeta = page.lines.map((line, index) => {
    const currentWords = Array.isArray(line.words) ? line.words : [];
    const currentHasText = currentWords.some((word) =>
      typeof word?.content === "string" ? word.content.trim().length > 0 : !!word?.content
    );

    const currentHeaderPos = Number(line?.surah_header_position || 0);

    const prevLine = page.lines[index - 1];
    const prevWords = Array.isArray(prevLine?.words) ? prevLine.words : [];
    const prevHasText = prevWords.some((word) =>
      typeof word?.content === "string" ? word.content.trim().length > 0 : !!word?.content
    );
    const prevHeaderPos = Number(prevLine?.surah_header_position || 0);
    // API often emits two consecutive wordless rows for one surah banner; hide the spare row.
    // Same for basmalah (-1): two consecutive empty -1 rows → hide the second.
    // Do not treat a basmala row (-1) after a surah banner as spare (surah-then-basmalah insert order).
    const isSpareHeaderCompanionLine =
      mushafId === 2 &&
      !currentHasText &&
      !prevHasText &&
      ((prevHeaderPos > 0 && currentHeaderPos !== -1) ||
        (prevHeaderPos === -1 && currentHeaderPos === -1));

    return {
      line,
      isSpareHeaderCompanionLine,
      currentHeaderPos,
    };
  });

  const lineHasRenderableWords = (line) => {
    const words = Array.isArray(line?.words) ? line.words : [];
    return words.some((word) =>
      typeof word?.content === "string" ? word.content.trim().length > 0 : !!word?.content
    );
  };
  const firstLineWithWordsIndex = linesWithHeaderRenderMeta.findIndex(({ line }) =>
    lineHasRenderableWords(line)
  );
  const juzHighlightLineIndex =
    firstLineWithWordsIndex === -1 ? 0 : firstLineWithWordsIndex;

  const verserRangeSegmentByWordId = useMemo(() => {
    if (!verserActive || !page?.lines) return {};
    return rangeSegmentIndexByWordId(page, verserAyahPreview || {});
  }, [verserActive, page, verserAyahPreview]);

  return (
    <View style={containerStyle}>
      <View style={pageContentStyle}>
        {linesWithHeaderRenderMeta.map(({ line, isSpareHeaderCompanionLine, currentHeaderPos }, lineIndex) => {
          const insertBeforeThisLine = line.position;
          const lineEl = (
            <Line
              words={line.words}
              onWordPress={onWordPress}
              selectedWordId={selectedWordId}
              savedVariations={savedVariations}
              selectedNarrators={selectedNarrators}
              allVariations={allVariations}
              narratorHighlightColorById={narratorHighlightColorById}
              isFirstLineOfJuz={highlightFirstLine && lineIndex === juzHighlightLineIndex}
              isDarkMode={isDarkMode}
              mushafId={mushafId}
              linePosition={line.position}
              surahHeaderPosition={currentHeaderPos}
              suppressLine={isSpareHeaderCompanionLine}
              disableWordLongPress={headerInsertMode && mushafId === 2}
              verserActive={verserActive}
              verserAyahPreview={verserAyahPreview}
              verserRangeSegmentByWordId={verserRangeSegmentByWordId}
              verserAnchorWordId={verserAnchorWordId}
              onVerserWordTap={onVerserWordTap}
              recitationListenHighlightVerse={recitationListenHighlightVerse}
              pageNum={page.position}
              onVariationTraversalWordTap={onVariationTraversalWordTap}
              variationListenBadgeWordIds={variationListenBadgeWordIds}
              chipClipLoadingBadge={chipClipLoadingBadge}
            />
          );
          const lineInstanceKey = `${page.position}-${line.id}`;
          if (isSpareHeaderCompanionLine) {
            return <React.Fragment key={lineInstanceKey}>{lineEl}</React.Fragment>;
          }
          if (!headerInsertMode || mushafId !== 2) {
            return <React.Fragment key={lineInstanceKey}>{lineEl}</React.Fragment>;
          }
          return (
            <Pressable
              key={lineInstanceKey}
              onPress={() => onHeaderInsertLinePress?.(insertBeforeThisLine)}
              style={({ pressed }) => [
                styles.lineHeaderInsertTarget,
                pressed && styles.lineHeaderInsertTargetPressed,
              ]}
            >
              {lineEl}
            </Pressable>
          );
        })}
      </View>
    </View>
  );
};

// Component to render Arabic text with red dots underneath letters followed by dots
// Uses text measurement for accurate dot positioning
const ArabicTextWithDots = ({ text }) => {
  const textRef = useRef(null);
  const [textLayout, setTextLayout] = useState(null);
  
  const diacritics = ["َ", "ِ", "ُ", "ْ", "ً", "ٍ", "ٌ", "ّ", "ٰ", "ٖ", "ٗ", "٘", "ٙ", "ٚ", "ٛ", "ٜ", "ٝ", "ٞ", "ٟ"];
  
  const isDiacritic = (char) => diacritics.includes(char);
  
  // Arabic Unicode ranges for letters (excluding diacritics)
  const isArabicLetter = (char) => {
    if (isDiacritic(char)) return false;
    const code = char.charCodeAt(0);
    return (
      (code >= 0x0600 && code <= 0x06FF) || // Arabic block
      (code >= 0x0750 && code <= 0x077F) || // Arabic Supplement
      (code >= 0x08A0 && code <= 0x08FF) || // Arabic Extended-A
      (code >= 0xFB50 && code <= 0xFDFF) || // Arabic Presentation Forms-A
      (code >= 0xFE70 && code <= 0xFEFF)    // Arabic Presentation Forms-B
    );
  };

  // Remove dots from text and track letter positions for dots
  const chars = text.split("");
  let displayText = "";
  const lettersWithDots = [];

  for (let i = 0; i < chars.length; i++) {
    const char = chars[i];
    const nextChar = chars[i + 1];
    
    if (char === "." || char === "٫") {
      // Skip dot characters - they're handled visually
      continue;
    }
    
    // Check if this letter is followed by a dot
    if (isArabicLetter(char) && (nextChar === "." || nextChar === "٫")) {
      // Track this letter position for dot placement
      lettersWithDots.push(displayText.length);
      displayText += char;
      
      // Skip the dot character
      i++;
    } else {
      displayText += char;
    }
  }

  // Calculate dot positions based on measured text width
  const calculateDotPosition = (letterIndex, totalLength) => {
    if (!textLayout || totalLength === 0) {
      // Fallback: average character width for fontSize 16 is ~12px
      return (totalLength - letterIndex - 1) * 12;
    }
    // Calculate position from right (RTL)
    const charWidth = textLayout.width / totalLength;
    return (totalLength - letterIndex - 1) * charWidth;
  };

  // Render as one continuous text block with absolutely positioned dots
  return (
    <View style={styles.renderedTextWrapper}>
      <Text
        ref={textRef}
        style={styles.renderedText}
        onLayout={(event) => {
          const { width, height } = event.nativeEvent.layout;
          setTextLayout({ width, height });
        }}
      >
        {displayText}
      </Text>
      {lettersWithDots.map((letterIndex, dotIndex) => {
        const dotRight = calculateDotPosition(letterIndex, displayText.length);
        return (
          <View
            key={`dot-${dotIndex}`}
            style={[
              styles.redDotAbsolute,
              { right: dotRight },
            ]}
          >
            <View style={styles.redDot} />
          </View>
        );
      })}
    </View>
  );
};

const NarratorPopup = ({
  visible,
  onClose,
  narrators,
  selectedNarrator,
  onSelectNarrator,
  inputValue,
  onInputChange,
  position,
  selectedWord,
  savedVariations,
  allVariations = {},
  variationImalah = null,
  variationDiamond = null,
  onSaveVariation,
  onDeleteVariation,
  mushafId = 3,
  currentSurahNumber,
  isShubahHighlight = false,
}) => {
  const quranFont = getQuranFontFamily(mushafId);
  const [keyboardMode, setKeyboardMode] = useState("harakat"); // "harakat" or "letters"
  const [insertMode, setInsertMode] = useState("replace"); // "insertLeft", "replace", or "insertRight"
  const inputRef = useRef(null);
  const [selection, setSelection] = useState({ start: 0, end: 0 });
  const [currentLetterIndex, setCurrentLetterIndex] = useState(0); // Index of currently highlighted letter
  const [imalahOverlayIndices, setImalahOverlayIndices] = useState(() => new Set()); // Letter indices with imalah circle overlay
  const [imalahPlacementByLetter, setImalahPlacementByLetter] = useState({}); // { [letterIndex]: { xPercent, yPercent } }
  const [imalahPlacementModalVisible, setImalahPlacementModalVisible] = useState(false);
  const [imalahPlacementLetterIndex, setImalahPlacementLetterIndex] = useState(null);
  const [imalahCanvasPosition, setImalahCanvasPosition] = useState({ xPercent: 50, yPercent: 85 });
  const imalahCanvasLayoutRef = useRef(null); // { pageX, pageY, width, height } from measureInWindow
  const imalahCanvasViewRef = useRef(null);
  const imalahCanvasSizeRef = useRef({ width: 280, height: 72 });
  const [diamondOverlayIndices, setDiamondOverlayIndices] = useState(() => new Set());
  const [diamondPlacementByLetter, setDiamondPlacementByLetter] = useState({});
  const [diamondPlacementModalVisible, setDiamondPlacementModalVisible] = useState(false);
  const [diamondPlacementLetterIndex, setDiamondPlacementLetterIndex] = useState(null);
  const [diamondCanvasPosition, setDiamondCanvasPosition] = useState({ xPercent: 50, yPercent: 85 });
  const diamondCanvasLayoutRef = useRef(null);
  const diamondCanvasViewRef = useRef(null);
  const diamondCanvasSizeRef = useRef({ width: 280, height: 72 });
  const diamondPanStartRef = useRef({ x: 0, y: 0 });
  const mainDisplayInnerSizeRef = useRef({ width: 280, height: 72 });
  const [mainDisplayInnerSize, setMainDisplayInnerSize] = useState({ width: 280, height: 72 }); // for modal canvas to match
  const imalahPanStartRef = useRef({ x: 0, y: 0 });
  const [history, setHistory] = useState([]);
  const [historyIndex, setHistoryIndex] = useState(-1);
  const historyRef = useRef([]);
  const historyIndexRef = useRef(-1);
  const [isShaddaSelected, setIsShaddaSelected] = useState(false);
  // Ref mirrors shadda "orange" mode synchronously so dropdown handlers see true before the next render.
  const isShaddaSelectedRef = useRef(false);
  const setShaddaSelected = (value) => {
    isShaddaSelectedRef.current = value;
    setIsShaddaSelected(value);
  };
  // Nested Pressable can fire the main harakat key onPress after a dropdown choice; skip that duplicate.
  const skipNextMainHarakatKeyPressRef = useRef(false);
  const scheduleClearSkipMainHarakatKeyPress = () => {
    skipNextMainHarakatKeyPressRef.current = true;
    queueMicrotask(() => {
      if (skipNextMainHarakatKeyPressRef.current) {
        skipNextMainHarakatKeyPressRef.current = false;
      }
    });
  };
  const SHADDA_CHAR = "\u0651";
  /** Dropdown / special handlers: prepend shadda when orange mode is on; clears orange. */
  const prefixDiacriticsWithOrangeShaddaIfActive = (diacriticsString) => {
    if (!isShaddaSelectedRef.current) return diacriticsString;
    scheduleClearSkipMainHarakatKeyPress();
    const stripped = diacriticsString.replace(new RegExp(SHADDA_CHAR, "g"), "");
    setShaddaSelected(false);
    return SHADDA_CHAR + stripped;
  };
  const [longPressButton, setLongPressButton] = useState(null); // { char, tanweenChar, buttonIndex, position }
  const [longPressPosition, setLongPressPosition] = useState(null); // { x, y }
  const [dragStartY, setDragStartY] = useState(null);
  const [isHoveringTanween, setIsHoveringTanween] = useState(false);
  const [isHoveringShaddaTanween, setIsHoveringShaddaTanween] = useState(false);
  const [isHoveringSukoon, setIsHoveringSukoon] = useState(false);
  const [isHoveringStandingAlif, setIsHoveringStandingAlif] = useState(false);
  const [isHoveringDaggerAlifOnly, setIsHoveringDaggerAlifOnly] = useState(false);
  const [isHoveringDiamond, setIsHoveringDiamond] = useState(false);
  const [isHoveringImalahDot, setIsHoveringImalahDot] = useState(false);
  const [isHoveringHelperDiamondDot, setIsHoveringHelperDiamondDot] = useState(false);
  const [isHoveringSubscriptAlef, setIsHoveringSubscriptAlef] = useState(false);
  const [isHoveringMaddAlif, setIsHoveringMaddAlif] = useState(false);
  const [isHoveringMaddWaw, setIsHoveringMaddWaw] = useState(false);
  const [isHoveringMaddYa, setIsHoveringMaddYa] = useState(false);
  const [isHoveringMaddCombined, setIsHoveringMaddCombined] = useState(false);
  const [isHoveringInvertedDammah, setIsHoveringInvertedDammah] = useState(false);
  const [isHoveringExtenderHamzaDammah, setIsHoveringExtenderHamzaDammah] = useState(false);
  const [isHoveringExtenderHamzaKasrah, setIsHoveringExtenderHamzaKasrah] = useState(false);
  const [isHoveringExtenderHamzaFathah, setIsHoveringExtenderHamzaFathah] = useState(false);
  const [isHoveringMaddRoundedZero, setIsHoveringMaddRoundedZero] = useState(false);
  /** Drag-to-select over tajweed permutation grid (synced ref for release; parent keeps responder while long-pressed). */
  const [hoveringTajweedPermutationIndex, setHoveringTajweedPermutationIndex] = useState(null);
  const hoveringTajweedPermutationIndexRef = useRef(null);
  const buttonRefs = useRef({});
  const tanweenRefs = useRef({});
  const shaddaTanweenRefs = useRef({});
  const sukoonRefs = useRef({});
  const standingAlifRefs = useRef({});
  const daggerAlifOnlyRefs = useRef({});
  const diamondRefs = useRef({});
  const imalahDotRefs = useRef({});
  const maddAlifRefs = useRef({});
  const maddWawRefs = useRef({});
  const maddYaRefs = useRef({});
  const maddCombinedRefs = useRef({});
  const helperDiamondDotRefs = useRef({});
  const subscriptAlefRefs = useRef({});
  const invertedDammahRefs = useRef({});
  const extenderHamzaDammahRefs = useRef({});
  const extenderHamzaKasrahRefs = useRef({});
  const extenderHamzaFathahRefs = useRef({});
  const maddRoundedZeroRefs = useRef({});
  const tajweedPermutationRefs = useRef({});
  
  // Helper to get tanween version of a harakat
  const getTanweenVersion = (harakatChar) => {
    const tanweenMap = {
      "\u064E": "\u064B", // Fatha → Fathatan
      "\u064F": "\u064C", // Damma → Dammatan
      "\u0650": "\u064D", // Kasra → Kasratan
    };
    return tanweenMap[harakatChar] || null;
  };

  // Get letter positions in the text (accounting for diacritics)
  // Groups base letters with their following diacritics
  const getLetterPositions = (text) => {
    const positions = [];
    let letterIndex = 0;
    for (let i = 0; i < text.length; i++) {
      const char = text[i];
      // Check if it's a base letter (not a diacritic or diamond marker)
      if (!/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/.test(char)) {
        // Find the end position (after the base letter and any following diacritics)
        let end = i + 1;
        while (end < text.length) {
          const nextChar = text[end];
          if (/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/.test(nextChar)) {
            end++;
          } else {
            break;
          }
        }
        positions.push({
          index: letterIndex,
          start: i,
          end: end,
        });
        letterIndex++;
        i = end - 1; // Skip to after the diacritics
      }
    }
    return positions;
  };

  // Initialize history when popup opens or input changes externally
  useEffect(() => {
    if (visible && selectedNarrator) {
      // Reset history when popup opens
      const initialHistory = [inputValue];
      historyRef.current = initialHistory;
      historyIndexRef.current = 0;
      setHistory(initialHistory);
      setHistoryIndex(0);
      setImalahOverlayIndices(variationImalah?.indices ? new Set(variationImalah.indices) : new Set());
      setImalahPlacementByLetter(variationImalah?.placementByLetter || {});
      setDiamondOverlayIndices(variationDiamond?.indices ? new Set(variationDiamond.indices) : new Set());
      setDiamondPlacementByLetter(variationDiamond?.placementByLetter || {});
      // Reset letter index to first letter or 0
      const letterPositions = getLetterPositions(inputValue);
      if (letterPositions.length > 0) {
        setCurrentLetterIndex(0);
      } else {
        setCurrentLetterIndex(0);
      }
    }
  }, [visible, selectedNarrator, variationImalah, variationDiamond]);

  // Update letter index when input value changes - ensure it stays valid
  useEffect(() => {
    if (!inputValue || inputValue.length === 0) {
      if (currentLetterIndex !== 0) {
        setCurrentLetterIndex(0);
      }
      setShaddaSelected(false); // Deselect shadda when input changes
      return;
    }
    
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      if (currentLetterIndex !== 0) {
        setCurrentLetterIndex(0);
      }
      setShaddaSelected(false); // Deselect shadda when no letters
    } else {
      // Ensure index is within bounds
      const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
      if (validIndex !== currentLetterIndex) {
        setCurrentLetterIndex(validIndex);
        setShaddaSelected(false); // Deselect shadda when index changes
      }
    }
  }, [inputValue]); // Only depend on inputValue, not currentLetterIndex to avoid loops

  const imalahCanvasPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((e) => {
          imalahPanStartRef.current = { x: e.x, y: e.y };
          const { width: w, height: h } = imalahCanvasSizeRef.current;
          if (w <= 0 || h <= 0) return;
          const x = Math.max(0, Math.min(w, e.x));
          const y = Math.max(0, Math.min(h, e.y));
          setImalahCanvasPosition({ xPercent: (x / w) * 100, yPercent: (y / h) * 100 });
        })
        .onUpdate((e) => {
          const { width: w, height: h } = imalahCanvasSizeRef.current;
          if (w <= 0 || h <= 0) return;
          const start = imalahPanStartRef.current;
          const x = Math.max(0, Math.min(w, start.x + e.translationX));
          const y = Math.max(0, Math.min(h, start.y + e.translationY));
          setImalahCanvasPosition({ xPercent: (x / w) * 100, yPercent: (y / h) * 100 });
        }),
    []
  );

  const diamondCanvasPanGesture = useMemo(
    () =>
      Gesture.Pan()
        .minDistance(0)
        .runOnJS(true)
        .onBegin((e) => {
          diamondPanStartRef.current = { x: e.x, y: e.y };
          const { width: w, height: h } = diamondCanvasSizeRef.current;
          if (w <= 0 || h <= 0) return;
          const x = Math.max(0, Math.min(w, e.x));
          const y = Math.max(0, Math.min(h, e.y));
          setDiamondCanvasPosition({ xPercent: (x / w) * 100, yPercent: (y / h) * 100 });
        })
        .onUpdate((e) => {
          const { width: w, height: h } = diamondCanvasSizeRef.current;
          if (w <= 0 || h <= 0) return;
          const start = diamondPanStartRef.current;
          const x = Math.max(0, Math.min(w, start.x + e.translationX));
          const y = Math.max(0, Math.min(h, start.y + e.translationY));
          setDiamondCanvasPosition({ xPercent: (x / w) * 100, yPercent: (y / h) * 100 });
        }),
    []
  );

  if (!visible || !position) return null;

  // Calculate intelligent positioning
  const screenHeight = Dimensions.get("window").height;
  const screenWidth = Dimensions.get("window").width;
  const popupHeight = 500; // Increased to accommodate keyboard
  const popupWidth = Math.min(screenWidth * 0.9, 400);

  // Always center the popup on screen
  const topPosition = (screenHeight - popupHeight) / 2;
  const leftPosition = (screenWidth - popupWidth) / 2;

  // Check if this variation is saved
  const variationKey =
    selectedWord && selectedNarrator
      ? `${selectedWord.id}-${selectedNarrator.id}`
      : null;
  const isSaved = variationKey ? savedVariations.includes(variationKey) : false;
  const savedValue = variationKey && allVariations[variationKey] ? allVariations[variationKey] : null;
  const savedContent = savedValue != null && typeof savedValue === "object" ? savedValue.content : savedValue;
  const originalWordContent = selectedWord ? selectedWord.content : "";
  const hasUnsavedChanges = (savedValue !== null && inputValue !== savedContent) ||
                            (savedValue === null && inputValue !== originalWordContent);
  // Green when: (saved and no changes) OR (not saved but matches original - no changes from default)
  const isSavedState = (isSaved && !hasUnsavedChanges) || (!isSaved && inputValue === originalWordContent);

  // Harakat (diacritics) - most common ones
  const harakat = [
    { char: "\u064E", name: "Fatha" },      // َ
    { char: "\u0650", name: "Kasra" },     // ِ
    { char: "\u064F", name: "Damma" },     // ُ
    { char: "\u0652", name: "Sukun" },     // ْ
    { char: "\u0651", name: "Shadda" },    // ّ
    { char: "\u06E2", name: "Small high meem (iqlāb)" },   // ۢ
    { char: "\u06E8", name: "Small high noon" },          // ۨ (tajwīd / ghunnah, often with tanween–sukoon notation)
    { char: "\u06E7", name: "Small high yeh" },           // ۧ (mini dotless yeh above letter)
    { char: "\u064B", name: "Fathatan" },   // ً
    { char: "\u064D", name: "Kasratan" },  // ٍ
    { char: "\u064C", name: "Dammatan" },  // ٌ
  ];
  /** Shown on a second harakat row (iqlāb / small noon / small high yeh) so the main row stays shorter. */
  const HARAKAT_TAJWEED_ROW_CHARS = ["\u06E2", "\u06E8", "\u06E7"];
  /** Long-press on ۢ / ۨ / ۧ: fatha, fathatan, damma, dammatan, kasra, kasratan — each combined with the small letter. */
  const TAJWEED_VOWEL_PERMUTATION_MARKS = [
    "\u064E",
    "\u064B",
    "\u064F",
    "\u064C",
    "\u0650",
    "\u064D",
  ];

  // Arabic letters
  const arabicLetters = [
    "\u0640", // Tatweel (extended character/extender stem)
    "\u0627", "\u0628", "\u062A", "\u0629", "\u062B", "\u066E", // ة taa marbuta after ت; ٮ dotless beh
    "\u062C", "\u062D", "\u062E",
    "\u062F", "\u0630", "\u0631", "\u0632", "\u0633", "\u0634", "\u0635",
    "\u0636", "\u0637", "\u0638", "\u0639", "\u063A", "\u0641", "\u0642",
    "\u0643", "\u0644", "\u0645", "\u0646", "\u0647", "\u0648", "\u064A",
    "\u0623", "\u0625", "\u0622", "\u0624", "\u0626", "\u0621", // Hamza letters: أ إ آ ؤ ئ ء
    "\u0649", // ى - Yaa without dots and without hamza (alif maksura)
  ];

  // Helper: Get character at current letter index
  const getCharAtCurrentLetter = () => {
    if (inputValue.length === 0) return null;
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) {
      const pos = letterPositions[currentLetterIndex].start;
      if (pos >= 0 && pos < inputValue.length) {
        return inputValue[pos];
      }
    }
    return null;
  };

  // Helper: Remove all diacritics from a string
  const removeDiacritics = (str) => {
    if (!str) return '';
    // Remove combining diacritics (U+064B to U+065F, U+0670, U+06E2/06E7/06E8 small letters, U+06E4) and diamond marker (U+25C6)
    // Note: U+0640 (Tatweel) is treated as a base letter, not a diacritic
    return str.replace(/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/g, '');
  };

  // Helper: Get base letter (without diacritics) at current letter index
  const getBaseLetterAtCurrentLetter = () => {
    if (inputValue.length === 0) return null;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) {
      const pos = letterPositions[currentLetterIndex].start;
      const char = inputValue[pos];
      
      if (!char) return null;
      
      // Remove diacritics to get base letter
      const base = removeDiacritics(char);
      
      // Check if it's an Arabic letter (excluding diacritics)
      const arabicLetterRegex = /[\u0621-\u063A\u0640\u0641-\u064A\u066E\u0671-\u06D3]/;
      if (base && arabicLetterRegex.test(base)) {
        return base;
      }
    }
    return null;
  };

  // Generate harakat variations for a letter
  const getHarakatVariations = (baseLetter) => {
    if (!baseLetter) return [];
    // Tanween is now handled via long-press popup, so we don't include it in the main buttons
    const tanweenChars = ["\u064B", "\u064D", "\u064C"]; // Fathatan, Kasratan, Dammatan
    return harakat
      .filter(
        (h) =>
          !tanweenChars.includes(h.char) && !HARAKAT_TAJWEED_ROW_CHARS.includes(h.char)
      )
      .map((h) => baseLetter + h.char);
  };

  // Add to history
  const addToHistory = (value) => {
    const newHistory = historyRef.current.slice(0, historyIndexRef.current + 1);
    newHistory.push(value);
    // Limit history to 50 items
    if (newHistory.length > 50) {
      newHistory.shift();
    } else {
      historyIndexRef.current = newHistory.length - 1;
    }
    historyRef.current = newHistory;
    setHistory(newHistory);
    setHistoryIndex(historyIndexRef.current);
  };

  // Handle undo
  const handleUndo = () => {
    if (historyIndexRef.current > 0) {
      historyIndexRef.current--;
      const previousValue = historyRef.current[historyIndexRef.current];
      setHistoryIndex(historyIndexRef.current);
      onInputChange(previousValue);
      // Reset cursor to end
      setTimeout(() => {
        if (inputRef.current) {
          const cursorPos = previousValue.length;
          inputRef.current.setNativeProps({
            selection: { start: cursorPos, end: cursorPos },
          });
          setSelection({ start: cursorPos, end: cursorPos });
        }
      }, 0);
    }
  };

  // Handle diamond press - replace all diacritics with only diamond marker
  const handleDiamondPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Use a special marker character for diamond (we'll render it as SVG in display)
    // Using U+25C6 (◆) as marker, but we'll render it specially
    const diamondMarker = "\u25C6"; // Black diamond, we'll style it red in rendering
    
    scheduleClearSkipMainHarakatKeyPress();
    // Replace all diacritics with only the diamond marker
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(diamondMarker);
    
    // Replace the letter with base letter + diamond marker
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd alif press - add alif after letter with fathah
  const handleMaddAlifPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const alifChar = "\u0627"; // Alif
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      alifChar +
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd waw press - add waw after letter with fathah
  const handleMaddWawPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const wawChar = "\u0648"; // Waw
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      wawChar +
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle inverted dammah press - replace dammah with U+0657 (inverted dammah)
  const handleInvertedDammahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const dammaChar = "\u064F"; // Dammah
    const invertedDammahChar = "\u0657"; // Inverted dammah (U+0657)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Replace dammah with inverted dammah, or add inverted dammah if dammah not present
    let newDiacritics = existingDiacritics;
    if (newDiacritics.includes(dammaChar)) {
      // Replace dammah with inverted dammah
      newDiacritics = newDiacritics.replace(dammaChar, invertedDammahChar);
    } else if (!newDiacritics.includes(invertedDammahChar)) {
      // Add inverted dammah if not already present and no dammah to replace
      newDiacritics = newDiacritics + invertedDammahChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Dammah press (U+0640 + U+0654 + U+064F)
  const handleExtenderHamzaDammahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const dammaChar = "\u064F"; // Dammah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and dammah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(dammaChar)) {
      newDiacritics = newDiacritics + dammaChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Kasrah press (U+0640 + U+0654 + U+0650)
  const handleExtenderHamzaKasrahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const kasraChar = "\u0650"; // Kasrah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and kasrah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(kasraChar)) {
      newDiacritics = newDiacritics + kasraChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extender Hamza + Fathah press (U+0640 + U+0654 + U+064E)
  const handleExtenderHamzaFathahPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter || baseLetter !== "\u0640") return; // Only work on extender
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const hamzaChar = "\u0654"; // Hamza above
    const fathaChar = "\u064E"; // Fathah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add hamza and fathah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(hamzaChar)) {
      newDiacritics = newDiacritics + hamzaChar;
    }
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = newDiacritics + fathaChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd rounded zero press (U+06E4)
  const handleMaddRoundedZeroPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const maddRoundedZeroChar = "\u06E4"; // Arabic Small High Rounded Zero (U+06E4)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add madd rounded zero if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(maddRoundedZeroChar)) {
      newDiacritics = newDiacritics + maddRoundedZeroChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd combined press - add U+0653 only
  const handleMaddCombinedPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const maddahChar = "\u0653"; // Maddah above (U+0653)
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Add maddah if not already present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(maddahChar)) {
      newDiacritics = newDiacritics + maddahChar;
    }
    
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    // Replace diacritics
    const newValue = 
      inputValue.slice(0, letterStart + 1) + 
      newDiacritics + 
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle madd ya press - add ya after letter with fathah
  const handleMaddYaPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const fathaChar = "\u064E"; // Fathah
    const yaChar = "\u064A"; // Ya
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      newDiacritics = fathaChar + newDiacritics;
    }
    scheduleClearSkipMainHarakatKeyPress();
    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      yaChar +
      inputValue.slice(letterEnd);
    
    onInputChange(newValue);
    
    // Update cursor position
    const newPos = letterEnd + 1;
    setTimeout(() => {
      if (inputRef.current) {
        inputRef.current.setNativeProps({ selection: { start: newPos, end: newPos } });
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle dagger alif press (without fathah) - replace all diacritics with only dagger alif
  const handleDaggerAlifOnlyPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
    
    scheduleClearSkipMainHarakatKeyPress();
    let newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(daggerAlifChar);
    
    // Replace the letter with base letter + only dagger alif
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Helper function to replace diacritics with a helper font character
  const handleHelperDotPress = (helperChar) => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Get existing harakat (kasrah in this case)
    const kasraChar = "\u0650"; // Kasrah
    scheduleClearSkipMainHarakatKeyPress();
    // Replace diacritics with kasrah + helper character
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(kasraChar + helperChar);
    
    // Replace the letter with base letter + kasrah + helper character
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Open imalah placement canvas for the currently chosen character (add to overlay set and show modal)
  const openImalahPlacement = () => {
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0 || currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    setImalahOverlayIndices((prev) => new Set(prev).add(currentLetterIndex));
    setImalahPlacementLetterIndex(currentLetterIndex);
    const saved = imalahPlacementByLetter[currentLetterIndex];
    const n = letterPositions.length;
    const defaultX = (1 - (currentLetterIndex + 0.5) / n) * 100;
    setImalahCanvasPosition(saved || { xPercent: defaultX, yPercent: 85 });
    setImalahPlacementModalVisible(true);
  };

  const closeImalahPlacement = (save) => {
    if (save && imalahPlacementLetterIndex !== null) {
      setImalahPlacementByLetter((prev) => ({
        ...prev,
        [imalahPlacementLetterIndex]: imalahCanvasPosition,
      }));
    }
    setImalahPlacementModalVisible(false);
    setImalahPlacementLetterIndex(null);
  };

  const openDiamondPlacement = () => {
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0 || currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    setDiamondOverlayIndices((prev) => new Set(prev).add(currentLetterIndex));
    setDiamondPlacementLetterIndex(currentLetterIndex);
    const saved = diamondPlacementByLetter[currentLetterIndex];
    const n = letterPositions.length;
    const defaultX = (1 - (currentLetterIndex + 0.5) / n) * 100;
    setDiamondCanvasPosition(saved || { xPercent: defaultX, yPercent: 85 });
    setDiamondPlacementModalVisible(true);
  };

  const closeDiamondPlacement = (save) => {
    if (save && diamondPlacementLetterIndex !== null) {
      setDiamondPlacementByLetter((prev) => ({
        ...prev,
        [diamondPlacementLetterIndex]: diamondCanvasPosition,
      }));
    }
    setDiamondPlacementModalVisible(false);
    setDiamondPlacementLetterIndex(null);
  };

  // Handle imalah dot press - adds only imalah dot from helper font (no other diacritics)
  const handleImalahDotPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0658 for imalah dot - only add the helper character, no kasrah
    const imalahDotChar = "\u0658"; // ARABIC SMALL HIGH NOON
    scheduleClearSkipMainHarakatKeyPress();
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(imalahDotChar);
    
    // Replace the letter with base letter + only imalah dot
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle helper diamond dot press - adds only diamond dot from helper font (no other diacritics)
  const handleHelperDiamondDotPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0659 for helper diamond dot - only add the helper character, no kasrah
    const helperDiamondDotChar = "\u0659"; // ARABIC PLACE OF SAJDAH
    scheduleClearSkipMainHarakatKeyPress();
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(helperDiamondDotChar);
    
    // Replace the letter with base letter + only helper diamond dot
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Sukoon long-press menu: letter + sukoon + imalah marker (U+0658)
  const handleImalahDotWithSukoonPress = () => {
    if (inputValue.length === 0) return;

    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;

    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;

    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;

    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const ch = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(ch)) {
        letterEnd++;
      } else {
        break;
      }
    }

    const sukoonChar = "\u0652";
    const imalahDotChar = "\u0658";
    scheduleClearSkipMainHarakatKeyPress();
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(sukoonChar + imalahDotChar);

    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);

    addToHistory(newValue);
    onInputChange(newValue);

    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Sukoon long-press menu: letter + sukoon + helper diamond (U+0659)
  const handleHelperDiamondDotWithSukoonPress = () => {
    if (inputValue.length === 0) return;

    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;

    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;

    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;

    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const ch = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(ch)) {
        letterEnd++;
      } else {
        break;
      }
    }

    const sukoonChar = "\u0652";
    const helperDiamondDotChar = "\u0659";
    scheduleClearSkipMainHarakatKeyPress();
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(sukoonChar + helperDiamondDotChar);

    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);

    addToHistory(newValue);
    onInputChange(newValue);

    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle subscript alef press - adds only subscript alef from helper font (no other diacritics)
  const handleSubscriptAlefPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Using U+0656 for subscript alef - only add the helper character, no kasrah
    const subscriptAlefChar = "\u0656"; // ARABIC SUBSCRIPT ALEF
    scheduleClearSkipMainHarakatKeyPress();
    const newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(subscriptAlefChar);
    
    // Replace the letter with base letter + only subscript alef
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle dagger alif press - insert dagger alif as diacritic after fathah
  const handleStandingAlifPress = () => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    const letterPos = letterPositions[currentLetterIndex];
    const letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
    const fathaChar = "\u064E"; // Fathah
    
    // Get existing diacritics
    const existingDiacritics = inputValue.slice(letterStart + 1, letterEnd);
    
    // Ensure fathah is present, then add dagger alif after it
    let newDiacritics = existingDiacritics;
    if (!newDiacritics.includes(fathaChar)) {
      // If no fathah, add it first
      newDiacritics = fathaChar + newDiacritics;
    }
    
    // Add dagger alif if not already present
    if (!newDiacritics.includes(daggerAlifChar)) {
      // Insert dagger alif after fathah
      const fathaIndex = newDiacritics.indexOf(fathaChar);
      if (fathaIndex !== -1) {
        newDiacritics = newDiacritics.slice(0, fathaIndex + 1) + daggerAlifChar + newDiacritics.slice(fathaIndex + 1);
      } else {
        newDiacritics = newDiacritics + daggerAlifChar;
      }
    }

    newDiacritics = prefixDiacriticsWithOrangeShaddaIfActive(newDiacritics);
    scheduleClearSkipMainHarakatKeyPress();
    
    // Replace the letter with base letter + new diacritics
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newDiacritics +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // Keep cursor on the same letter
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[currentLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle harakat variation press - replace only the harakat, keep the base letter
  const handleHarakatPress = (variation) => {
    if (inputValue.length === 0) return;
    
    const letterPositions = getLetterPositions(inputValue);
    if (currentLetterIndex < 0 || currentLetterIndex >= letterPositions.length) return;
    
    const baseLetter = getBaseLetterAtCurrentLetter();
    if (!baseLetter) return;
    
    // Extract the harakat from the variation (everything after the base letter)
    const harakatFromVariation = variation.slice(baseLetter.length);
    const shaddaChar = "\u0651";
    const fathaChar = "\u064E";
    const kasraChar = "\u0650";
    const dammaChar = "\u064F";
    
    // Check if this is a shadda button press
    const isShadda = harakatFromVariation === shaddaChar;
    
    // Check if this is a vowel (fatha, kasra, damma)
    const isVowel = harakatFromVariation === fathaChar || 
                     harakatFromVariation === kasraChar || 
                     harakatFromVariation === dammaChar;
    
    // Orange shadda + chosen harakat (any length), or bare letter (e.g. sukoon menu → letter + shadda only)
    if (isShaddaSelectedRef.current && !isShadda) {
      scheduleClearSkipMainHarakatKeyPress();
      const combinedHarakat =
        harakatFromVariation.length > 0
          ? shaddaChar + harakatFromVariation.replace(new RegExp(shaddaChar, "g"), "")
          : shaddaChar;
      
      const letterPos = letterPositions[currentLetterIndex];
      let letterStart = letterPos.start;
      
      // Find the end position (after the base letter and any existing diacritics)
      let letterEnd = letterStart + 1;
      while (letterEnd < inputValue.length) {
        const char = inputValue[letterEnd];
        if (/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/.test(char)) {
          letterEnd++;
        } else {
          break;
        }
      }
      
      // Replace only the harakat part, keep the base letter
      const newValue =
        inputValue.slice(0, letterStart) +
        baseLetter +
        combinedHarakat +
        inputValue.slice(letterEnd);
      
      // Add to history before updating
      addToHistory(newValue);
      onInputChange(newValue);
      
      // Deselect shadda
      setShaddaSelected(false);
      
      // After updating, ensure currentLetterIndex is still valid
      setTimeout(() => {
        const newLetterPositions = getLetterPositions(newValue);
        if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
          const newPos = newLetterPositions[currentLetterIndex].start;
          setSelection({ start: newPos, end: newPos });
        }
      }, 0);
      return;
    }
    
    // If shadda button is pressed, toggle selection
    if (isShadda) {
      setShaddaSelected(!isShaddaSelectedRef.current);
      return; // Don't apply shadda yet, just toggle selection
    }
    
    // If shadda is selected and another button is pressed (not a vowel), deselect shadda
    if (isShaddaSelectedRef.current && !isVowel) {
      setShaddaSelected(false);
    }
    
    const letterPos = letterPositions[currentLetterIndex];
    let letterStart = letterPos.start;
    
    // Find the end position (after the base letter and any existing diacritics)
    let letterEnd = letterStart + 1;
    while (letterEnd < inputValue.length) {
      const char = inputValue[letterEnd];
      if (/[\u064B-\u065F\u0670\u06E2\u06E4\u06E7\u06E8\u25C6]/.test(char)) {
        letterEnd++;
      } else {
        break;
      }
    }
    
    // Extract the new harakat from the variation (everything after the base letter)
    const newHarakat = variation.slice(baseLetter.length);
    
    // Replace only the harakat part, keep the base letter
    const newValue =
      inputValue.slice(0, letterStart) +
      baseLetter +
      newHarakat +
      inputValue.slice(letterEnd);
    
    // Add to history before updating
    addToHistory(newValue);
    onInputChange(newValue);
    
    // After updating, ensure currentLetterIndex is still valid
    // The letter positions might have changed slightly, but the index should remain the same
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (currentLetterIndex >= 0 && currentLetterIndex < newLetterPositions.length) {
        // Index is still valid, keep it
        setCurrentLetterIndex(currentLetterIndex);
      } else if (newLetterPositions.length > 0) {
        // Index is out of bounds, adjust it
        const newIndex = Math.min(currentLetterIndex, newLetterPositions.length - 1);
        setCurrentLetterIndex(Math.max(0, newIndex));
      }
    }, 0);
  };

  // Handle letter press (for letters mode)
  const handleLetterPress = (letter) => {
    if (inputValue.length === 0) {
      // If empty, just insert the letter
      const newValue = letter;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      // No letters, just append
      const newValue = inputValue + letter;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
    const currentPos = letterPositions[validIndex];
    let newValue = "";
    let newLetterIndex = validIndex;

    if (insertMode === "insertLeft") {
      // Insert before current letter
      newValue = inputValue.slice(0, currentPos.start) + letter + inputValue.slice(currentPos.start);
      newLetterIndex = validIndex; // Stay on the same index (which is now the newly inserted letter)
    } else if (insertMode === "replace") {
      // Replace current letter but keep its harakat (diacritics)
      const currentLetterWithDiacritics = inputValue.slice(currentPos.start, currentPos.end);
      // Extract diacritics from the current letter (everything after the base letter)
      const currentBaseLetter = inputValue[currentPos.start];
      const currentDiacritics = currentLetterWithDiacritics.slice(1); // Everything after the base letter
      // Replace with new letter + old diacritics
      newValue = inputValue.slice(0, currentPos.start) + letter + currentDiacritics + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex; // Stay on the same index
    } else if (insertMode === "insertRight") {
      // Insert after current letter (after its diacritics)
      newValue = inputValue.slice(0, currentPos.end) + letter + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex + 1; // Move to the newly inserted letter
    }

    addToHistory(newValue);
    onInputChange(newValue);
    setCurrentLetterIndex(newLetterIndex);

    // Update selection
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (newLetterIndex >= 0 && newLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[newLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Handle extend stem + hamza press (U+0640 + U+0654)
  const handleExtendStemHamzaPress = () => {
    const tatweelChar = "\u0640"; // Tatweel (extended character)
    const hamzaChar = "\u0654"; // Hamza above
    const combinedChars = tatweelChar + hamzaChar;
    
    if (inputValue.length === 0) {
      // If empty, just insert the combined characters
      const newValue = combinedChars;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      // No letters, just append
      const newValue = inputValue + combinedChars;
      addToHistory(newValue);
      onInputChange(newValue);
      setCurrentLetterIndex(0);
      return;
    }

    const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
    const currentPos = letterPositions[validIndex];
    let newValue = "";
    let newLetterIndex = validIndex;

    if (insertMode === "insertLeft") {
      // Insert before current letter
      newValue = inputValue.slice(0, currentPos.start) + combinedChars + inputValue.slice(currentPos.start);
      newLetterIndex = validIndex;
    } else if (insertMode === "replace") {
      // Replace current letter but keep its harakat (diacritics)
      const currentLetterWithDiacritics = inputValue.slice(currentPos.start, currentPos.end);
      const currentDiacritics = currentLetterWithDiacritics.slice(1);
      newValue = inputValue.slice(0, currentPos.start) + combinedChars + currentDiacritics + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex;
    } else if (insertMode === "insertRight") {
      // Insert after current letter (after its diacritics)
      newValue = inputValue.slice(0, currentPos.end) + combinedChars + inputValue.slice(currentPos.end);
      newLetterIndex = validIndex + 1;
    }

    addToHistory(newValue);
    onInputChange(newValue);
    setCurrentLetterIndex(newLetterIndex);

    // Update selection
    setTimeout(() => {
      const newLetterPositions = getLetterPositions(newValue);
      if (newLetterIndex >= 0 && newLetterIndex < newLetterPositions.length) {
        const newPos = newLetterPositions[newLetterIndex].start;
        setSelection({ start: newPos, end: newPos });
      }
    }, 0);
  };

  // Get current keyboard buttons based on mode and current letter
  const getKeyboardButtons = () => {
    if (keyboardMode === "harakat") {
      const letterPositions = getLetterPositions(inputValue);
      // Ensure currentLetterIndex is valid
      if (letterPositions.length === 0) {
        return [];
      }
      const validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
      
      // If index was invalid, update it
      if (validIndex !== currentLetterIndex) {
        setCurrentLetterIndex(validIndex);
      }
      
      // Get the base letter at the current (validated) index
      if (validIndex >= 0 && validIndex < letterPositions.length) {
        const pos = letterPositions[validIndex].start;
        const char = inputValue[pos];
        if (char) {
          const base = removeDiacritics(char);
          const arabicLetterRegex = /[\u0621-\u063A\u0640\u0641-\u064A\u066E\u0671-\u06D3]/;
          if (base && arabicLetterRegex.test(base)) {
            const main = getHarakatVariations(base);
            const tajweed = HARAKAT_TAJWEED_ROW_CHARS.map((c) => base + c);
            return [...main, ...tajweed];
          }
        }
      }
      return [];
    } else {
      return arabicLetters;
    }
  };

  // Handle arrow key press - move through letters (RTL: left = forward, right = backward)
  const handleArrowPress = (direction) => {
    const letterPositions = getLetterPositions(inputValue);
    if (letterPositions.length === 0) {
      setCurrentLetterIndex(0);
      setShaddaSelected(false); // Deselect shadda when moving
      return;
    }

    let newIndex = currentLetterIndex;
    // In RTL: left arrow moves forward (to next letter, visually right), right arrow moves backward (to previous letter, visually left)
    if (direction === "left" && newIndex < letterPositions.length - 1) {
      newIndex++; // Move forward in RTL (visually right)
    } else if (direction === "right" && newIndex > 0) {
      newIndex--; // Move backward in RTL (visually left)
    }
    
    // If moving to a different letter, deselect shadda
    if (newIndex !== currentLetterIndex) {
      setShaddaSelected(false);
    }
    
    setCurrentLetterIndex(newIndex);
    
    // Update selection to match the letter position
    if (letterPositions[newIndex]) {
      const pos = letterPositions[newIndex].start;
      setSelection({ start: pos, end: pos });
    }
  };

  // Check if arrows can move
  const canMoveLeft = () => {
    const letterPositions = getLetterPositions(inputValue);
    return letterPositions.length > 0 && currentLetterIndex < letterPositions.length - 1;
  };

  const canMoveRight = () => {
    return currentLetterIndex > 0;
  };

  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      onRequestClose={onClose}
    >
      <View style={styles.modalContainer}>
        <Pressable style={styles.backdrop} onPress={onClose} />
        <Pressable
          style={[
            styles.popupContainer,
            {
              position: "absolute",
              top: topPosition,
              left: leftPosition,
              width: popupWidth,
              height: popupHeight,
            },
          ]}
        >
          {/* Content */}
          <ScrollView 
            style={styles.popupContent}
            contentContainerStyle={styles.popupContentContainer}
            showsVerticalScrollIndicator={true}
            scrollEnabled={!longPressButton}
          >
            {selectedNarrator ? (
              <>
                <View style={styles.popupHeader}>
                  <TouchableOpacity
                    onPress={() => onSelectNarrator(null)}
                    style={styles.backButton}
                  >
                    <Text style={styles.backArrow}>←</Text>
                  </TouchableOpacity>
                  <Text style={styles.popupTitle}>
                    {selectedNarrator.title}
                  </Text>
                  <TouchableOpacity
                    onPress={() =>
                      onSaveVariation(variationKey, {
                        content: inputValue,
                        imalah: {
                          indices: Array.from(imalahOverlayIndices),
                          placementByLetter: { ...imalahPlacementByLetter },
                        },
                        diamond: {
                          indices: Array.from(diamondOverlayIndices),
                          placementByLetter: { ...diamondPlacementByLetter },
                        },
                      })
                    }
                    style={[
                      styles.saveButton,
                      isSavedState && styles.saveButtonSaved,
                      hasUnsavedChanges && styles.saveButtonNotSaved,
                    ]}
                  >
                    <Text
                      style={[
                        styles.saveButtonText,
                        isSavedState && styles.saveButtonTextSaved,
                        hasUnsavedChanges && styles.saveButtonTextNotSaved,
                      ]}
                    >
                      {hasUnsavedChanges ? "⚠️ Not Saved" : "Saved"}
                    </Text>
                  </TouchableOpacity>
                </View>

                {/* Input field with delete button when saved */}
                <View style={styles.inputRow}>
                  {isSaved && (
                    <TouchableOpacity
                      onPress={onDeleteVariation}
                      style={styles.deleteButton}
                    >
                      <Text style={styles.deleteIcon}>×</Text>
                    </TouchableOpacity>
                  )}
                  <View style={[styles.inputContainer, isSaved && { marginLeft: 8 }]}>
                    {/* Large display block with letter-by-letter highlighting */}
                    <View style={styles.largeDisplayBlock}>
                      {inputValue && inputValue.length > 0 ? (
                        <View
                          style={{ position: 'relative', width: '100%' }}
                          onLayout={(e) => {
                            const { width, height } = e.nativeEvent.layout;
                            if (width > 0 && height > 0) {
                              mainDisplayInnerSizeRef.current = { width, height };
                              setMainDisplayInnerSize((prev) =>
                                prev.width === width && prev.height === height ? prev : { width, height }
                              );
                            }
                          }}
                        >
                        <Text 
                          style={[
                            styles.displayText,
                            Platform.OS === 'ios' && { 
                              fontFamily: quranFont,
                              fontWeight: 'normal',
                              fontStyle: 'normal',
                            }
                          ]}
                        >
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            // Ensure currentLetterIndex is valid for highlighting
                            let validIndex = 0;
                            if (letterPositions.length > 0) {
                              validIndex = Math.max(0, Math.min(currentLetterIndex, letterPositions.length - 1));
                              // Update state if index was invalid (but only once to avoid loops)
                              if (validIndex !== currentLetterIndex && currentLetterIndex >= 0) {
                                setTimeout(() => {
                                  if (currentLetterIndex !== validIndex) {
                                    setCurrentLetterIndex(validIndex);
                                  }
                                }, 0);
                              }
                            }
                            
                            const segments = [];
                            let lastIndex = 0;
                            
                            letterPositions.forEach((pos, idx) => {
                              const isHighlighted = idx === validIndex;
                              
                              // Add text before this letter (shouldn't happen if grouping is correct, but safety check)
                              if (pos.start > lastIndex) {
                                const beforeText = inputValue.slice(lastIndex, pos.start);
                                segments.push(beforeText);
                              }
                              
                              // Get the letter with all its diacritics
                              const letterWithDiacritics = inputValue.slice(pos.start, pos.end);
                                
                                // Remove diamond marker from display text (we'll render it separately)
                                const letterForDisplay = letterWithDiacritics.replace(/\u25C6/g, '');
                              
                              if (isHighlighted) {
                                segments.push(
                                  <Text
                                    key={`letter-${idx}`}
                                    style={[
                                      styles.displayTextHighlighted,
                                      Platform.OS === 'ios' && { 
                                        fontFamily: quranFont,
                                        fontWeight: 'normal',
                                        fontStyle: 'normal',
                                      }
                                    ]}
                                  >
                                    {letterForDisplay}
                                  </Text>
                                );
                              } else {
                                  segments.push(letterForDisplay);
                              }
                              
                              lastIndex = pos.end;
                            });
                            
                            // Add any remaining text after the last letter
                            if (lastIndex < inputValue.length) {
                              segments.push(inputValue.slice(lastIndex));
                            }
                            
                            return segments;
                          })()}
                        </Text>
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            const diamondPositions = [];
                            letterPositions.forEach((pos, idx) => {
                              const letterWithDiacritics = inputValue.slice(pos.start, pos.end);
                              if (letterWithDiacritics.includes("\u25C6")) {
                                diamondPositions.push(idx);
                              }
                            });
                            return diamondPositions.map((letterIdx, diamondIdx) => (
                              <View
                                key={`diamond-${diamondIdx}`}
                                style={[
                                  {
                                    position: 'absolute',
                                    bottom: -6,
                                    // Approximate positioning from right for RTL
                                    right: `${Math.max(0, (letterPositions.length - letterIdx - 1) * 6)}%`,
                                  },
                                ]}
                              >
                                <View style={styles.diamondShape} />
                              </View>
                            ));
                          })()}
                          {/* Imalah overlay: round filled circle — position from canvas or fallback; size scales with parent */}
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            const n = letterPositions.length;
                            if (n === 0) return null;
                            const minDim = Math.min(mainDisplayInnerSize.width, mainDisplayInnerSize.height);
                            const imalahDotSize = minDim > 0 ? Math.round(Math.max(4, Math.min(12, minDim * 0.06))) : 8;
                            const imalahHalf = imalahDotSize / 2;
                            return Array.from(imalahOverlayIndices).filter((idx) => idx >= 0 && idx < n).map((letterIdx) => {
                              const placement = imalahPlacementByLetter[letterIdx];
                              const style = placement
                                ? { left: `${placement.xPercent}%`, top: `${placement.yPercent}%`, marginLeft: -imalahHalf, marginTop: -imalahHalf, right: undefined, bottom: undefined, width: imalahDotSize, height: imalahDotSize }
                                : { right: `${((letterIdx + 0.5) / n) * 100}%`, marginRight: -imalahHalf, width: imalahDotSize, height: imalahDotSize };
                              return (
                                <View
                                  key={`imalah-${letterIdx}`}
                                  style={[styles.imalahCircleContainer, style]}
                                  pointerEvents="none"
                                >
                                  <View style={[styles.imalahCircle, { width: imalahDotSize, height: imalahDotSize, borderRadius: imalahHalf }]} />
                                </View>
                              );
                            });
                          })()}
                          {/* Diamond overlay: skinny diamond, transparent with stroke — position from canvas or fallback; size scales with parent */}
                          {(() => {
                            const letterPositions = getLetterPositions(inputValue);
                            const n = letterPositions.length;
                            if (n === 0) return null;
                            const minDim = Math.min(mainDisplayInnerSize.width, mainDisplayInnerSize.height);
                            const { scale, min, max, fallbackHeight } = DIAMOND_SIZING.topDisplay;
                            const diamondH = minDim > 0 ? Math.round(Math.max(min, Math.min(max, minDim * scale))) : fallbackHeight;
                            const diamondW = (diamondH * 35) / 49;
                            const halfW = diamondW / 2;
                            const halfH = diamondH / 2;
                            return Array.from(diamondOverlayIndices).filter((idx) => idx >= 0 && idx < n).map((letterIdx) => {
                              const placement = diamondPlacementByLetter[letterIdx];
                              const style = placement
                                ? { left: `${placement.xPercent}%`, top: `${placement.yPercent}%`, marginLeft: -halfW, marginTop: -halfH, right: undefined, bottom: undefined, width: diamondW, height: diamondH }
                                : { right: `${((letterIdx + 0.5) / n) * 100}%`, marginRight: -halfW, width: diamondW, height: diamondH };
                              return (
                                <View
                                  key={`diamond-overlay-${letterIdx}`}
                                  style={[styles.diamondOverlayContainer, style]}
                                  pointerEvents="none"
                                >
                                  <DiamondShapeSvg height={diamondH} />
                                </View>
                              );
                            });
                          })()}
                        </View>
                      ) : (
                        <Text style={styles.displayPlaceholder}>Enter text...</Text>
                      )}
                    </View>
                  </View>
                </View>

                {/* Custom Arabic Keyboard */}
                <View style={styles.customKeyboard}>
                  {/* Controls: two rows so letter arrows + actions never overlap on narrow popups */}
                  <View style={styles.keyboardControlWrap}>
                    <View style={styles.keyboardControlRowPrimary}>
                      <TouchableOpacity
                        style={styles.keyboardToggle}
                        onPress={() => setKeyboardMode(keyboardMode === "harakat" ? "letters" : "harakat")}
                      >
                        <Text style={styles.keyboardToggleText}>
                          {keyboardMode === "harakat" ? "حروف" : "حركات"}
                        </Text>
                      </TouchableOpacity>

                      <View style={styles.keyboardArrowsRow}>
                        <TouchableOpacity
                          style={[
                            styles.keyboardArrowKey,
                            !canMoveLeft() && styles.keyboardArrowKeyDisabled,
                          ]}
                          onPress={() => handleArrowPress("left")}
                          disabled={!canMoveLeft()}
                        >
                          <Text
                            style={[
                              styles.keyboardKeyText,
                              !canMoveLeft() && styles.keyboardKeyTextDisabled,
                            ]}
                          >
                            ←
                          </Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.keyboardArrowKey,
                            !canMoveRight() && styles.keyboardArrowKeyDisabled,
                          ]}
                          onPress={() => handleArrowPress("right")}
                          disabled={!canMoveRight()}
                        >
                          <Text
                            style={[
                              styles.keyboardKeyText,
                              !canMoveRight() && styles.keyboardKeyTextDisabled,
                            ]}
                          >
                            →
                          </Text>
                        </TouchableOpacity>
                      </View>

                      <TouchableOpacity
                        style={styles.keyboardDeleteKey}
                        onPress={() => {
                          if (inputValue.length > 0 && selection.start > 0) {
                            const newValue =
                              inputValue.slice(0, selection.start - 1) +
                              inputValue.slice(selection.start);
                            addToHistory(newValue);
                            onInputChange(newValue);
                            const newPos = selection.start - 1;
                            setSelection({ start: newPos, end: newPos });
                            setTimeout(() => {
                              if (inputRef.current) {
                                inputRef.current.setNativeProps({
                                  selection: { start: newPos, end: newPos },
                                });
                              }
                            }, 0);
                          }
                        }}
                      >
                        <Text style={styles.keyboardKeyText}>⌫</Text>
                      </TouchableOpacity>

                      <TouchableOpacity
                        style={[
                          styles.keyboardUndoKey,
                          historyIndex <= 0 && styles.keyboardUndoKeyDisabled,
                        ]}
                        onPress={handleUndo}
                        disabled={historyIndex <= 0}
                      >
                        <Text
                          style={[
                            styles.keyboardKeyText,
                            historyIndex <= 0 && styles.keyboardKeyTextDisabled,
                          ]}
                        >
                          ↶
                        </Text>
                        {historyIndex > 0 && (
                          <Text style={styles.keyboardUndoCount}>{historyIndex}</Text>
                        )}
                      </TouchableOpacity>
                    </View>

                    {mushafId === 3 && (
                      <View style={styles.keyboardControlRowSecondary}>
                        <TouchableOpacity
                          style={[
                            styles.keyboardImalahKey,
                            (() => {
                              const letterPositions = getLetterPositions(inputValue);
                              const hasLetter =
                                letterPositions.length > 0 &&
                                currentLetterIndex >= 0 &&
                                currentLetterIndex < letterPositions.length;
                              const isActive = hasLetter && imalahOverlayIndices.has(currentLetterIndex);
                              return isActive && styles.keyboardImalahKeyActive;
                            })(),
                          ]}
                          onPress={openImalahPlacement}
                          disabled={!inputValue || getLetterPositions(inputValue).length === 0}
                        >
                          <Text style={styles.keyboardImalahKeyText}>Imalah</Text>
                        </TouchableOpacity>
                        <TouchableOpacity
                          style={[
                            styles.keyboardDiamondKey,
                            (() => {
                              const letterPositions = getLetterPositions(inputValue);
                              const hasLetter =
                                letterPositions.length > 0 &&
                                currentLetterIndex >= 0 &&
                                currentLetterIndex < letterPositions.length;
                              const isActive = hasLetter && diamondOverlayIndices.has(currentLetterIndex);
                              return isActive && styles.keyboardDiamondKeyActive;
                            })(),
                          ]}
                          onPress={openDiamondPlacement}
                          disabled={!inputValue || getLetterPositions(inputValue).length === 0}
                        >
                          <Text style={styles.keyboardDiamondKeyText}>Diamond</Text>
                        </TouchableOpacity>
                      </View>
                    )}
                  </View>

                  {/* Insert mode buttons (only in letters mode) */}
                  {keyboardMode === "letters" && (
                    <View style={styles.keyboardInsertModeRow}>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "insertRight" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("insertRight")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "insertRight" && styles.keyboardInsertModeTextActive,
                        ]}>[</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "replace" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("replace")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "replace" && styles.keyboardInsertModeTextActive,
                        ]}>O</Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.keyboardInsertModeButton,
                          insertMode === "insertLeft" && styles.keyboardInsertModeButtonActive,
                        ]}
                        onPress={() => setInsertMode("insertLeft")}
                      >
                        <Text style={[
                          styles.keyboardInsertModeText,
                          insertMode === "insertLeft" && styles.keyboardInsertModeTextActive,
                        ]}>]</Text>
                      </TouchableOpacity>
                    </View>
                  )}

                  {/* Harakat or Letters buttons */}
                  <View style={styles.keyboardGrid}>
                    {(() => {
                      const buttons = getKeyboardButtons();
                      const buttonCount = buttons.length;
                      const baseForHarakatRowBreak =
                        keyboardMode === "harakat" ? getBaseLetterAtCurrentLetter() : null;
                      const harakatTajweedStartIndex =
                        baseForHarakatRowBreak && buttonCount > 0
                          ? buttons.findIndex((btn) =>
                              HARAKAT_TAJWEED_ROW_CHARS.includes(
                                btn.slice(baseForHarakatRowBreak.length)
                              )
                            )
                          : -1;
                      const shaddaChar = "\u0651";
                      return buttons.length > 0 ? (
                        <>
                          {buttons.map((char, index) => {
                          // Check if this is the shadda button and if it's selected
                          const baseLetter = getBaseLetterAtCurrentLetter();
                          const useLargeKeyStyle =
                            keyboardMode === "harakat" &&
                            (harakatTajweedStartIndex >= 0
                              ? index < harakatTajweedStartIndex
                              : buttonCount <= 5);
                          const isShaddaButton = baseLetter && char === baseLetter + shaddaChar;
                          const isShaddaSelectedForThisButton = isShaddaButton && isShaddaSelected;
                          
                          // Get the original letter at current position (with its current harakat)
                          const letterPositions = getLetterPositions(inputValue);
                          const originalLetter = (currentLetterIndex >= 0 && currentLetterIndex < letterPositions.length) 
                            ? inputValue.slice(letterPositions[currentLetterIndex].start, letterPositions[currentLetterIndex].end)
                            : null;
                          
                          // Extract harakat from the button char (everything after base letter)
                          const harakatChar = baseLetter ? char.slice(baseLetter.length) : "";
                          const tanweenChar = getTanweenVersion(harakatChar);
                          const hasTanween = tanweenChar !== null;
                          const isLongPressed = longPressButton && longPressButton.buttonIndex === index;
                          // For harakat mode, check if this is the sukoon button (letter + sukoon)
                          const sukoonChar = "\u0652"; // Sukoon
                          const isSukoonButton = keyboardMode === "harakat" && baseLetter && char === baseLetter + sukoonChar;
                          const plainLetter = isSukoonButton ? baseLetter : null;
                          // Check if this is a fathah button (for dagger alif)
                          const fathaChar = "\u064E"; // Fathah
                          const isFathahButton = keyboardMode === "harakat" && baseLetter && harakatChar === fathaChar;
                          const daggerAlifChar = "\u0670"; // Dagger alif (ألف خنجرية)
                          // Check if this is a kasrah button (for diamond)
                          const kasraChar = "\u0650"; // Kasrah
                          const isKasrahButton = keyboardMode === "harakat" && baseLetter && harakatChar === kasraChar;
                          // Check if this is a dammah button (for inverted dammah)
                          const dammaChar = "\u064F"; // Dammah
                          const isDammahButton = keyboardMode === "harakat" && baseLetter && harakatChar === dammaChar;
                          const smallHighMeemChar = "\u06E2";
                          const smallHighNoonChar = "\u06E8";
                          const smallHighYehChar = "\u06E7";
                          const isSmallHighMeemButton =
                            keyboardMode === "harakat" && baseLetter && harakatChar === smallHighMeemChar;
                          const isSmallHighNoonButton =
                            keyboardMode === "harakat" && baseLetter && harakatChar === smallHighNoonChar;
                          const isSmallHighYehButton =
                            keyboardMode === "harakat" && baseLetter && harakatChar === smallHighYehChar;
                          const diamondMarker = "\u25C6"; // Diamond marker (◆)
                          
                          return (
                            <React.Fragment key={index}>
                            {keyboardMode === "harakat" &&
                              harakatTajweedStartIndex >= 0 &&
                              index === harakatTajweedStartIndex && (
                                <View style={styles.keyboardHarakatRowBreak} />
                              )}
                            <View 
                              style={{
                                position: "relative",
                                zIndex: isLongPressed ? 100 : 1,
                                overflow: "visible",
                              }}
                              onStartShouldSetResponder={() => isLongPressed}
                              onMoveShouldSetResponder={() => isLongPressed}
                              onResponderMove={(e) => {
                                if (isLongPressed && e?.nativeEvent) {
                                  // Store event values before setTimeout
                                  const touchX = e.nativeEvent.pageX;
                                  const touchY = e.nativeEvent.pageY;
                                  
                                  if (hasTanween && tanweenChar && keyboardMode === "harakat") {
                                    // Check if touch is over tanween button, shadda+tanween button, or standing alif button
                                    setTimeout(() => {
                                      tanweenRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverTanween = 
                                          touchX >= pageX && 
                                          touchX <= pageX + width &&
                                          touchY >= pageY && 
                                          touchY <= pageY + height;
                                        setIsHoveringTanween(isOverTanween);
                                      });
                                      shaddaTanweenRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverShaddaTanween = 
                                          touchX >= pageX && 
                                          touchX <= pageX + width &&
                                          touchY >= pageY && 
                                          touchY <= pageY + height;
                                        setIsHoveringShaddaTanween(isOverShaddaTanween);
                                      });
                                      if (isFathahButton) {
                                        standingAlifRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverStandingAlif = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringStandingAlif(isOverStandingAlif);
                                        });
                                        daggerAlifOnlyRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverDaggerAlifOnly = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringDaggerAlifOnly(isOverDaggerAlifOnly);
                                        });
                                        // Check madd buttons
                                        maddAlifRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddAlif = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddAlif(isOverMaddAlif);
                                        });
                                        maddWawRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddWaw = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddWaw(isOverMaddWaw);
                                        });
                                        maddYaRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddYa = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddYa(isOverMaddYa);
                                        });
                                        maddCombinedRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddCombined = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddCombined(isOverMaddCombined);
                                        });
                                        maddRoundedZeroRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverMaddRoundedZero = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringMaddRoundedZero(isOverMaddRoundedZero);
                                        });
                                        // Check extender hamza + fathah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaFathahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaFathah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaFathah(isOverExtenderHamzaFathah);
                                          });
                                        }
                                      }
                                      if (isDammahButton) {
                                        invertedDammahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverInvertedDammah = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringInvertedDammah(isOverInvertedDammah);
                                        });
                                        // Check extender hamza + dammah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaDammahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaDammah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaDammah(isOverExtenderHamzaDammah);
                                          });
                                        }
                                      }
                                      if (isKasrahButton) {
                                        imalahDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverImalahDot = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringImalahDot(isOverImalahDot);
                                        });
                                        helperDiamondDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverHelperDiamondDot = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringHelperDiamondDot(isOverHelperDiamondDot);
                                        });
                                        subscriptAlefRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                          const isOverSubscriptAlef = 
                                            touchX >= pageX && 
                                            touchX <= pageX + width &&
                                            touchY >= pageY && 
                                            touchY <= pageY + height;
                                          setIsHoveringSubscriptAlef(isOverSubscriptAlef);
                                        });
                                        // Check extender hamza + kasrah button (only if base letter is extender)
                                        if (baseLetter === "\u0640") {
                                          extenderHamzaKasrahRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                            const isOverExtenderHamzaKasrah = 
                                              touchX >= pageX && 
                                              touchX <= pageX + width &&
                                              touchY >= pageY && 
                                              touchY <= pageY + height;
                                            setIsHoveringExtenderHamzaKasrah(isOverExtenderHamzaKasrah);
                                          });
                                        }
                                      }
                                    }, 0);
                                  } else if (isSukoonButton && keyboardMode === "harakat" && plainLetter) {
                                    setTimeout(() => {
                                      sukoonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverSukoon =
                                          touchX >= pageX &&
                                          touchX <= pageX + width &&
                                          touchY >= pageY &&
                                          touchY <= pageY + height;
                                        setIsHoveringSukoon(isOverSukoon);
                                      });
                                      imalahDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverImalahDot =
                                          touchX >= pageX &&
                                          touchX <= pageX + width &&
                                          touchY >= pageY &&
                                          touchY <= pageY + height;
                                        setIsHoveringImalahDot(isOverImalahDot);
                                      });
                                      helperDiamondDotRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                        const isOverHelperDiamondDot =
                                          touchX >= pageX &&
                                          touchX <= pageX + width &&
                                          touchY >= pageY &&
                                          touchY <= pageY + height;
                                        setIsHoveringHelperDiamondDot(isOverHelperDiamondDot);
                                      });
                                    }, 0);
                                  } else if (
                                    (isSmallHighMeemButton ||
                                      isSmallHighNoonButton ||
                                      isSmallHighYehButton) &&
                                    keyboardMode === "harakat" &&
                                    baseLetter
                                  ) {
                                    setTimeout(() => {
                                      const hit = { idx: null };
                                      let pending = TAJWEED_VOWEL_PERMUTATION_MARKS.length;
                                      const doneOne = () => {
                                        pending -= 1;
                                        if (pending === 0) {
                                          hoveringTajweedPermutationIndexRef.current = hit.idx;
                                          setHoveringTajweedPermutationIndex(hit.idx);
                                        }
                                      };
                                      TAJWEED_VOWEL_PERMUTATION_MARKS.forEach((_, permIdx) => {
                                        const refKey = `tajweedPerm-${index}-${permIdx}`;
                                        const cellRef = tajweedPermutationRefs.current[refKey];
                                        if (!cellRef) {
                                          doneOne();
                                          return;
                                        }
                                        cellRef.measure((x, y, w, h, pageX, pageY) => {
                                          const isOver =
                                            touchX >= pageX &&
                                            touchX <= pageX + w &&
                                            touchY >= pageY &&
                                            touchY <= pageY + h;
                                          if (isOver) hit.idx = permIdx;
                                          doneOne();
                                        });
                                      });
                                    }, 0);
                                  }
                                }
                              }}
                              onResponderRelease={(e) => {
                                if (isLongPressed) {
                                  if (keyboardMode === "harakat") {
                                    // Check if released over tanween button, shadda+tanween button, standing alif, or plain letter
                                    if (isHoveringTanween && tanweenChar) {
                                      handleHarakatPress(baseLetter + tanweenChar);
                                    } else if (isHoveringShaddaTanween && tanweenChar) {
                                      const shaddaChar = "\u0651";
                                      handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                    } else if (isHoveringStandingAlif && isFathahButton) {
                                      // Released over dagger alif with fathah button (for fathah button)
                                      handleStandingAlifPress();
                                    } else if (isHoveringDaggerAlifOnly && isFathahButton) {
                                      // Released over dagger alif only button (for fathah button)
                                      handleDaggerAlifOnlyPress();
                                    } else if (isHoveringMaddAlif && isFathahButton) {
                                      // Released over madd alif button
                                      handleMaddAlifPress();
                                    } else if (isHoveringMaddWaw && isFathahButton) {
                                      // Released over madd waw button
                                      handleMaddWawPress();
                                    } else if (isHoveringMaddYa && isFathahButton) {
                                      // Released over madd ya button
                                      handleMaddYaPress();
                                    } else if (isHoveringMaddCombined && isFathahButton) {
                                      // Released over madd combined button
                                      handleMaddCombinedPress();
                                    } else if (isHoveringExtenderHamzaFathah && isFathahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + fathah button
                                      handleExtenderHamzaFathahPress();
                                    } else if (isHoveringMaddRoundedZero && isFathahButton) {
                                      // Released over madd rounded zero button
                                      handleMaddRoundedZeroPress();
                                    } else if (isHoveringInvertedDammah && isDammahButton) {
                                      // Released over inverted dammah button
                                      handleInvertedDammahPress();
                                    } else if (isHoveringExtenderHamzaDammah && isDammahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + dammah button
                                      handleExtenderHamzaDammahPress();
                                    } else if (isHoveringImalahDot && isSukoonButton && plainLetter) {
                                      handleImalahDotWithSukoonPress();
                                    } else if (isHoveringHelperDiamondDot && isSukoonButton && plainLetter) {
                                      handleHelperDiamondDotWithSukoonPress();
                                    } else if (isHoveringImalahDot && isKasrahButton) {
                                      // Released over imalah dot button (for kasrah button)
                                      handleImalahDotPress();
                                    } else if (isHoveringHelperDiamondDot && isKasrahButton) {
                                      // Released over helper diamond dot button (for kasrah button)
                                      handleHelperDiamondDotPress();
                                    } else if (isHoveringSubscriptAlef && isKasrahButton) {
                                      // Released over subscript alef button (for kasrah button)
                                      handleSubscriptAlefPress();
                                    } else if (isHoveringExtenderHamzaKasrah && isKasrahButton && baseLetter === "\u0640") {
                                      // Released over extender hamza + kasrah button
                                      handleExtenderHamzaKasrahPress();
                                    } else if (isHoveringSukoon && isSukoonButton && plainLetter) {
                                      // Released over plain letter button (for sukoon button)
                                      handleHarakatPress(plainLetter);
                                    } else if (
                                      (isSmallHighMeemButton ||
                                        isSmallHighNoonButton ||
                                        isSmallHighYehButton) &&
                                      baseLetter
                                    ) {
                                      const permIdx = hoveringTajweedPermutationIndexRef.current;
                                      if (
                                        permIdx !== null &&
                                        permIdx >= 0 &&
                                        permIdx < TAJWEED_VOWEL_PERMUTATION_MARKS.length
                                      ) {
                                        const vowelMark = TAJWEED_VOWEL_PERMUTATION_MARKS[permIdx];
                                        const tailMark = isSmallHighMeemButton
                                          ? smallHighMeemChar
                                          : isSmallHighNoonButton
                                            ? smallHighNoonChar
                                            : smallHighYehChar;
                                        handleHarakatPress(baseLetter + vowelMark + tailMark);
                                      }
                                    }
                                  }
                                  setLongPressButton(null);
                                  setDragStartY(null);
                                  setIsHoveringTanween(false);
                                  setIsHoveringShaddaTanween(false);
                                  setIsHoveringSukoon(false);
                                  setIsHoveringStandingAlif(false);
                                  setIsHoveringDaggerAlifOnly(false);
                                  setIsHoveringMaddAlif(false);
                                  setIsHoveringMaddWaw(false);
                                  setIsHoveringMaddYa(false);
                                  setIsHoveringMaddCombined(false);
                                  setIsHoveringMaddRoundedZero(false);
                                  setIsHoveringInvertedDammah(false);
                                  setIsHoveringExtenderHamzaDammah(false);
                                  setIsHoveringExtenderHamzaFathah(false);
                                  setIsHoveringImalahDot(false);
                                  setIsHoveringHelperDiamondDot(false);
                                  setIsHoveringSubscriptAlef(false);
                                  setIsHoveringExtenderHamzaKasrah(false);
                                  hoveringTajweedPermutationIndexRef.current = null;
                                  setHoveringTajweedPermutationIndex(null);
                                }
                              }}
                            >
                              <Pressable
                                ref={(ref) => {
                                  if (ref) buttonRefs.current[index] = ref;
                                }}
                                style={[
                                  styles.keyboardKey,
                                  useLargeKeyStyle && styles.keyboardKeyLarge,
                                  isShaddaSelectedForThisButton && styles.keyboardKeyShaddaSelected,
                                  isLongPressed && styles.keyboardKeyLongPressed,
                                ]}
                                onPress={() => {
                                  if (skipNextMainHarakatKeyPressRef.current) {
                                    skipNextMainHarakatKeyPressRef.current = false;
                                    return;
                                  }
                                  if (!isLongPressed) {
                                    keyboardMode === "harakat" 
                                      ? handleHarakatPress(char)
                                      : handleLetterPress(char);
                                  }
                                }}
                                onLongPress={() => {
                                  if (hasTanween && keyboardMode === "harakat") {
                                    // Measure button position
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      const tanweenCharFull = baseLetter + tanweenChar;
                                      setLongPressButton({
                                        char: char,
                                        tanweenChar: tanweenCharFull,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  } else if (isKasrahButton && keyboardMode === "harakat") {
                                    // For kasrah button, show diamond option
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      setLongPressButton({
                                        char: char,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  } else if (isSukoonButton && keyboardMode === "harakat" && plainLetter) {
                                    // For harakat mode, show plain letter option when long-pressing sukoon button
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      setLongPressButton({
                                        char: char,
                                        plainLetter: plainLetter,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  } else if (
                                    (isSmallHighMeemButton ||
                                      isSmallHighNoonButton ||
                                      isSmallHighYehButton) &&
                                    keyboardMode === "harakat" &&
                                    baseLetter
                                  ) {
                                    buttonRefs.current[index]?.measure((x, y, width, height, pageX, pageY) => {
                                      hoveringTajweedPermutationIndexRef.current = null;
                                      setHoveringTajweedPermutationIndex(null);
                                      setLongPressButton({
                                        char,
                                        buttonIndex: index,
                                        position: { x: pageX, y: pageY, width, height },
                                      });
                                      setDragStartY(pageY);
                                    });
                                  }
                                }}
                                delayLongPress={300}
                                onPressOut={() => {
                                  // Don't handle release here, let the wrapper View handle it
                                }}
                              >
                                <Text style={[
                                  styles.keyboardKeyText,
                                  useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                  isShaddaSelectedForThisButton && styles.keyboardKeyTextShaddaSelected,
                                ]}>{char}</Text>
                              </Pressable>
                              
                              {/* Tanween popup - only shows when long-pressed in harakat mode */}
                              {isLongPressed && tanweenChar && keyboardMode === "harakat" && (
                                <>
                                  {isFathahButton ? (
                                    <View style={[
                                      styles.kasrahDropdownGrid,
                                      {
                                        top: (useLargeKeyStyle ? 50 : 36) + 8,
                                      }
                                    ]}>
                                      {/* Row 1: Tanween, Shadda+Tanween, Dagger Alif with fathah */}
                                      <View style={{ flexDirection: "row", marginBottom: 4 }}>
                                        {/* Tanween button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) tanweenRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                      isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                    ]}
                                    onPress={() => {
                                      handleHarakatPress(baseLetter + tanweenChar);
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringTanween(false);
                                      setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                    }}
                                  >
                                    <Text style={[
                                      styles.keyboardKeyText,
                                      useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                    ]}>{baseLetter + tanweenChar}</Text>
                                  </Pressable>
                                  
                                        {/* Shadda+Tanween button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) shaddaTanweenRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                          isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                        ]}
                                        onPress={() => {
                                          const shaddaChar = "\u0651";
                                          handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                      </Pressable>
                                      
                                        {/* Dagger Alif with fathah button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) standingAlifRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                          styles.dropdownGridButton,
                                          isHoveringStandingAlif && styles.keyboardKeyTanweenHovered,
                                        ]}
                                        onPress={() => {
                                          handleStandingAlifPress();
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                          setIsHoveringMaddAlif(false);
                                          setIsHoveringMaddWaw(false);
                                          setIsHoveringMaddYa(false);
                                          setIsHoveringMaddCombined(false);
                                          setIsHoveringMaddRoundedZero(false);
                                          setIsHoveringInvertedDammah(false);
                                          setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + fathaChar + daggerAlifChar}</Text>
                                      </Pressable>
                                      </View>
                                      
                                      {/* Row 2: Dagger Alif only, Madd Alif, Madd Combined */}
                                      <View style={{ flexDirection: "row" }}>
                                        {/* Dagger Alif only button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) daggerAlifOnlyRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                          isHoveringDaggerAlifOnly && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                        ]}
                                        onPress={() => {
                                          handleDaggerAlifOnlyPress();
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + daggerAlifChar}</Text>
                                      </Pressable>
                                        
                                        {/* Madd Alif button */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddAlifRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddAlif && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                          ]}
                                          onPress={() => {
                                            handleMaddAlifPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + fathaChar + "\u0627"}</Text>
                                        </Pressable>
                                        
                                        {/* Madd Combined button */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddCombinedRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddCombined && styles.keyboardKeyTanweenHovered,
                                            { marginRight: 4 },
                                          ]}
                                          onPress={() => {
                                            handleMaddCombinedPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + "\u0653"}</Text>
                                        </Pressable>
                                        
                                        {/* Madd Rounded Zero button (U+06E4) */}
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) maddRoundedZeroRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringMaddRoundedZero && styles.keyboardKeyTanweenHovered,
                                          ]}
                                          onPress={() => {
                                            handleMaddRoundedZeroPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}>{baseLetter + "\u06E4"}</Text>
                                        </Pressable>
                                      </View>
                                      
                                      {/* Extender Hamza + Fathah button (only for extender) */}
                                      {baseLetter === "\u0640" && (
                                        <Pressable
                                          ref={(ref) => {
                                            if (ref) extenderHamzaFathahRefs.current[index] = ref;
                                          }}
                                          style={[
                                            styles.keyboardKeyTanween,
                                            styles.dropdownGridButton,
                                            isHoveringExtenderHamzaFathah && styles.keyboardKeyTanweenHovered,
                                            { marginTop: 4 },
                                          ]}
                                          onPress={() => {
                                            handleExtenderHamzaFathahPress();
                                            setLongPressButton(null);
                                            setDragStartY(null);
                                            setIsHoveringTanween(false);
                                            setIsHoveringShaddaTanween(false);
                                            setIsHoveringStandingAlif(false);
                                            setIsHoveringDaggerAlifOnly(false);
                                            setIsHoveringMaddAlif(false);
                                            setIsHoveringMaddWaw(false);
                                            setIsHoveringMaddYa(false);
                                            setIsHoveringMaddCombined(false);
                                            setIsHoveringMaddRoundedZero(false);
                                            setIsHoveringInvertedDammah(false);
                                            setIsHoveringExtenderHamzaFathah(false);
                                          }}
                                        >
                                          <Text style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}>{"\u0640\u0654\u064E"}</Text>
                                        </Pressable>
                                      )}
                                    </View>
                                  ) : (
                                    <>
                                      {/* For non-fathah buttons with tanween - use grid layout */}
                                      {isKasrahButton ? (
                                        <View style={[
                                          styles.kasrahDropdownGrid,
                                          {
                                            top: (useLargeKeyStyle ? 50 : 36) + 8,
                                          }
                                        ]}>
                                          {/* Tanween button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) tanweenRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                              isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleHarakatPress(baseLetter + tanweenChar);
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringTanween(false);
                                              setIsHoveringShaddaTanween(false);
                                              setIsHoveringStandingAlif(false);
                                              setIsHoveringDaggerAlifOnly(false);
                                            }}
                                          >
                                            <Text style={[
                                              styles.keyboardKeyText,
                                              useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                            ]}>{baseLetter + tanweenChar}</Text>
                                          </Pressable>
                                          
                                          {/* Shadda+Tanween button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) shaddaTanweenRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                              isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              const shaddaChar = "\u0651";
                                              handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringTanween(false);
                                              setIsHoveringShaddaTanween(false);
                                              setIsHoveringStandingAlif(false);
                                              setIsHoveringDaggerAlifOnly(false);
                                            }}
                                          >
                                            <Text style={[
                                              styles.keyboardKeyText,
                                              useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                            ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                          </Pressable>

                                          {/* Imalah dot button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) imalahDotRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringImalahDot && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleImalahDotPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringImalahDot(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                useLargeKeyStyle && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0658"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Helper diamond dot button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) helperDiamondDotRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringHelperDiamondDot && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleHelperDiamondDotPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringHelperDiamondDot(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                useLargeKeyStyle && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0659"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Subscript Alef button */}
                                          <Pressable
                                            ref={(ref) => {
                                              if (ref) subscriptAlefRefs.current[index] = ref;
                                            }}
                                            style={[
                                              styles.keyboardKeyTanween,
                                              styles.keyboardKeyHelperDot,
                                              styles.dropdownGridButton,
                                              isHoveringSubscriptAlef && styles.keyboardKeyTanweenHovered,
                                            ]}
                                            onPress={() => {
                                              handleSubscriptAlefPress();
                                              setLongPressButton(null);
                                              setDragStartY(null);
                                              setIsHoveringSubscriptAlef(false);
                                            }}
                                          >
                                            <View style={styles.helperDotContainer}>
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter}</Text>
                                              <Text style={[
                                                styles.helperDotText,
                                                useLargeKeyStyle && styles.helperDotTextLarge,
                                                { fontFamily: quranFont }
                                              ]}>{"\u0656"}</Text>
                                            </View>
                                          </Pressable>

                                          {/* Extender Hamza + Kasrah button (only for extender) */}
                                          {isKasrahButton && baseLetter === "\u0640" && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) extenderHamzaKasrahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringExtenderHamzaKasrah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleExtenderHamzaKasrahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringImalahDot(false);
                                                setIsHoveringHelperDiamondDot(false);
                                                setIsHoveringSubscriptAlef(false);
                                                setIsHoveringExtenderHamzaKasrah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{"\u0640\u0654\u0650"}</Text>
                                            </Pressable>
                                          )}
                                        </View>
                                      ) : (
                                        <View style={[
                                          styles.kasrahDropdownGrid,
                                          {
                                            top: (useLargeKeyStyle ? 50 : 36) + 8,
                                          }
                                        ]}>
                                          {/* Tanween button */}
                                      <Pressable
                                        ref={(ref) => {
                                          if (ref) tanweenRefs.current[index] = ref;
                                        }}
                                        style={[
                                          styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                          isHoveringTanween && styles.keyboardKeyTanweenHovered,
                                        ]}
                                        onPress={() => {
                                          handleHarakatPress(baseLetter + tanweenChar);
                                          setLongPressButton(null);
                                          setDragStartY(null);
                                          setIsHoveringTanween(false);
                                          setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                              setIsHoveringMaddAlif(false);
                                              setIsHoveringMaddWaw(false);
                                              setIsHoveringMaddYa(false);
                                              setIsHoveringMaddCombined(false);
                                        }}
                                      >
                                        <Text style={[
                                          styles.keyboardKeyText,
                                          useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                        ]}>{baseLetter + tanweenChar}</Text>
                                      </Pressable>
                                      
                                          {/* Shadda+Tanween button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) shaddaTanweenRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                              styles.dropdownGridButton,
                                      isHoveringShaddaTanween && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      const shaddaChar = "\u0651";
                                      handleHarakatPress(baseLetter + shaddaChar + tanweenChar);
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringTanween(false);
                                      setIsHoveringShaddaTanween(false);
                                          setIsHoveringStandingAlif(false);
                                          setIsHoveringDaggerAlifOnly(false);
                                              setIsHoveringMaddAlif(false);
                                              setIsHoveringMaddWaw(false);
                                              setIsHoveringMaddYa(false);
                                              setIsHoveringMaddCombined(false);
                                    }}
                                  >
                                    <Text style={[
                                      styles.keyboardKeyText,
                                      useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                    ]}>{baseLetter + "\u0651" + tanweenChar}</Text>
                                  </Pressable>
                                          
                                          {/* Inverted Dammah button (only for dammah) */}
                                          {isDammahButton && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) invertedDammahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringInvertedDammah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleInvertedDammahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringInvertedDammah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{baseLetter + "\u0657"}</Text>
                                            </Pressable>
                                          )}
                                          {/* Extender Hamza + Dammah button (only for extender and dammah) */}
                                          {isDammahButton && baseLetter === "\u0640" && (
                                            <Pressable
                                              ref={(ref) => {
                                                if (ref) extenderHamzaDammahRefs.current[index] = ref;
                                              }}
                                              style={[
                                                styles.keyboardKeyTanween,
                                                styles.dropdownGridButton,
                                                isHoveringExtenderHamzaDammah && styles.keyboardKeyTanweenHovered,
                                              ]}
                                              onPress={() => {
                                                handleExtenderHamzaDammahPress();
                                                setLongPressButton(null);
                                                setDragStartY(null);
                                                setIsHoveringTanween(false);
                                                setIsHoveringShaddaTanween(false);
                                                setIsHoveringStandingAlif(false);
                                                setIsHoveringDaggerAlifOnly(false);
                                                setIsHoveringMaddAlif(false);
                                                setIsHoveringMaddWaw(false);
                                                setIsHoveringMaddYa(false);
                                                setIsHoveringMaddCombined(false);
                                                setIsHoveringInvertedDammah(false);
                                                setIsHoveringExtenderHamzaDammah(false);
                                              }}
                                            >
                                              <Text style={[
                                                styles.keyboardKeyText,
                                                useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                              ]}>{"\u0640\u0654\u064F"}</Text>
                                            </Pressable>
                                          )}
                                        </View>
                                      )}
                                    </>
                                  )}
                                </>
                              )}
                              
                              {/* Sukoon long-press: two rows (narrow width) so nothing clips; diamond row uses indigo when U+0659 is invisible in mushaf font */}
                              {isLongPressed && isSukoonButton && plainLetter && keyboardMode === "harakat" && (
                                <View
                                  style={[
                                    styles.sukoonDropdownContainer,
                                    {
                                      top: (useLargeKeyStyle ? 50 : 36) + 8,
                                    },
                                  ]}
                                >
                                  <View style={styles.sukoonDropdownRow}>
                                    <Pressable
                                      ref={(ref) => {
                                        if (ref) sukoonRefs.current[index] = ref;
                                      }}
                                      style={[
                                        styles.keyboardKeyTanween,
                                        styles.dropdownGridButton,
                                        isHoveringSukoon && styles.keyboardKeyTanweenHovered,
                                      ]}
                                      onPress={() => {
                                        handleHarakatPress(plainLetter);
                                        setLongPressButton(null);
                                        setDragStartY(null);
                                        setIsHoveringSukoon(false);
                                        setIsHoveringImalahDot(false);
                                        setIsHoveringHelperDiamondDot(false);
                                      }}
                                    >
                                      <Text
                                        style={[
                                          styles.keyboardKeyText,
                                          useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                        ]}
                                      >
                                        {plainLetter}
                                      </Text>
                                    </Pressable>

                                    <Pressable
                                      ref={(ref) => {
                                        if (ref) imalahDotRefs.current[index] = ref;
                                      }}
                                      style={[
                                        styles.keyboardKeyTanween,
                                        styles.keyboardKeyHelperDot,
                                        styles.dropdownGridButton,
                                        isHoveringImalahDot && styles.keyboardKeyTanweenHovered,
                                      ]}
                                      onPress={() => {
                                        handleImalahDotWithSukoonPress();
                                        setLongPressButton(null);
                                        setDragStartY(null);
                                        setIsHoveringSukoon(false);
                                        setIsHoveringImalahDot(false);
                                        setIsHoveringHelperDiamondDot(false);
                                      }}
                                    >
                                      <View style={styles.helperDotContainer}>
                                        <Text
                                          style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}
                                        >
                                          {baseLetter + sukoonChar}
                                        </Text>
                                        <Text
                                          style={[
                                            styles.helperDotText,
                                            useLargeKeyStyle && styles.helperDotTextLarge,
                                            { fontFamily: quranFont },
                                          ]}
                                        >
                                          {"\u0658"}
                                        </Text>
                                      </View>
                                    </Pressable>
                                  </View>

                                  <View style={styles.sukoonDropdownRow}>
                                    <Pressable
                                      ref={(ref) => {
                                        if (ref) helperDiamondDotRefs.current[index] = ref;
                                      }}
                                      style={[
                                        styles.keyboardKeyTanween,
                                        styles.keyboardKeyHelperDiamondSukoon,
                                        styles.dropdownGridButton,
                                        isHoveringHelperDiamondDot && styles.keyboardKeyTanweenHovered,
                                      ]}
                                      onPress={() => {
                                        handleHelperDiamondDotWithSukoonPress();
                                        setLongPressButton(null);
                                        setDragStartY(null);
                                        setIsHoveringSukoon(false);
                                        setIsHoveringImalahDot(false);
                                        setIsHoveringHelperDiamondDot(false);
                                      }}
                                    >
                                      <View style={styles.helperDotContainer}>
                                        <Text
                                          style={[
                                            styles.keyboardKeyText,
                                            useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                          ]}
                                        >
                                          {baseLetter + sukoonChar}
                                        </Text>
                                        <Text
                                          style={[
                                            styles.helperDotText,
                                            useLargeKeyStyle && styles.helperDotTextLarge,
                                            { fontFamily: quranFont },
                                          ]}
                                        >
                                          {"\u0659"}
                                        </Text>
                                      </View>
                                    </Pressable>
                                  </View>
                                </View>
                              )}

                              {/* Small high meem / noon / yeh: vowel × tanween permutations (long-press) */}
                              {isLongPressed &&
                                (isSmallHighMeemButton ||
                                  isSmallHighNoonButton ||
                                  isSmallHighYehButton) &&
                                keyboardMode === "harakat" &&
                                baseLetter && (
                                  <View
                                    style={[
                                      styles.tajweedPermDropdownContainer,
                                      {
                                        top: (useLargeKeyStyle ? 50 : 36) + 8,
                                      },
                                    ]}
                                  >
                                    {[0, 4].map((rowStart) => (
                                      <View key={rowStart} style={styles.tajweedPermDropdownRow}>
                                        {TAJWEED_VOWEL_PERMUTATION_MARKS.slice(rowStart, rowStart + 4).map(
                                          (vowelMark, col) => {
                                            const permIdx = rowStart + col;
                                            const tailMark = isSmallHighMeemButton
                                              ? smallHighMeemChar
                                              : isSmallHighNoonButton
                                                ? smallHighNoonChar
                                                : smallHighYehChar;
                                            const combo = baseLetter + vowelMark + tailMark;
                                            return (
                                              <Pressable
                                                key={permIdx}
                                                ref={(r) => {
                                                  const refKey = `tajweedPerm-${index}-${permIdx}`;
                                                  if (r) tajweedPermutationRefs.current[refKey] = r;
                                                  else delete tajweedPermutationRefs.current[refKey];
                                                }}
                                                style={[
                                                  styles.keyboardKeyTanween,
                                                  styles.dropdownGridButton,
                                                  hoveringTajweedPermutationIndex === permIdx &&
                                                    styles.keyboardKeyTanweenHovered,
                                                ]}
                                                onPress={() => {
                                                  handleHarakatPress(combo);
                                                  setLongPressButton(null);
                                                  setDragStartY(null);
                                                  hoveringTajweedPermutationIndexRef.current = null;
                                                  setHoveringTajweedPermutationIndex(null);
                                                }}
                                              >
                                                <Text
                                                  style={[
                                                    styles.keyboardKeyText,
                                                    useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                                  ]}
                                                >
                                                  {combo}
                                                </Text>
                                              </Pressable>
                                            );
                                          }
                                        )}
                                      </View>
                                    ))}
                                  </View>
                                )}
                              
                              {/* Kasrah button dropdown (no tanween) - shows helper dot buttons in a grid */}
                              {isLongPressed && isKasrahButton && keyboardMode === "harakat" && !hasTanween && (
                                <View style={[
                                  styles.kasrahDropdownGrid,
                                  {
                                    top: (useLargeKeyStyle ? 50 : 36) + 8,
                                  }
                                ]}>
                                  {/* Imalah dot button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) imalahDotRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringImalahDot && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleImalahDotPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringImalahDot(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        useLargeKeyStyle && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0658"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Helper diamond dot button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) helperDiamondDotRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringHelperDiamondDot && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleHelperDiamondDotPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringHelperDiamondDot(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        useLargeKeyStyle && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0659"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Subscript Alef button */}
                                  <Pressable
                                    ref={(ref) => {
                                      if (ref) subscriptAlefRefs.current[index] = ref;
                                    }}
                                    style={[
                                      styles.keyboardKeyTanween,
                                      styles.keyboardKeyHelperDot,
                                      isHoveringSubscriptAlef && styles.keyboardKeyTanweenHovered,
                                    ]}
                                    onPress={() => {
                                      handleSubscriptAlefPress();
                                      setLongPressButton(null);
                                      setDragStartY(null);
                                      setIsHoveringSubscriptAlef(false);
                                    }}
                                  >
                                    <View style={styles.helperDotContainer}>
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                      ]}>{baseLetter}</Text>
                                      <Text style={[
                                        styles.helperDotText,
                                        useLargeKeyStyle && styles.helperDotTextLarge,
                                        { fontFamily: quranFont }
                                      ]}>{"\u0656"}</Text>
                                    </View>
                                  </Pressable>

                                  {/* Extender Hamza + Kasrah button (only for extender) */}
                                  {baseLetter === "\u0640" && (
                                    <Pressable
                                      ref={(ref) => {
                                        if (ref) extenderHamzaKasrahRefs.current[index] = ref;
                                      }}
                                      style={[
                                        styles.keyboardKeyTanween,
                                        styles.dropdownGridButton,
                                        isHoveringExtenderHamzaKasrah && styles.keyboardKeyTanweenHovered,
                                      ]}
                                      onPress={() => {
                                        handleExtenderHamzaKasrahPress();
                                        setLongPressButton(null);
                                        setDragStartY(null);
                                        setIsHoveringImalahDot(false);
                                        setIsHoveringHelperDiamondDot(false);
                                        setIsHoveringSubscriptAlef(false);
                                        setIsHoveringExtenderHamzaKasrah(false);
                                      }}
                                    >
                                      <Text style={[
                                        styles.keyboardKeyText,
                                        useLargeKeyStyle && styles.keyboardKeyTextLarge,
                                      ]}>{"\u0640\u0654\u0650"}</Text>
                                    </Pressable>
                                  )}
                                </View>
                              )}
                            </View>
                            </React.Fragment>
                          );
                        })}
                        </>
                      ) : null;
                    })()}
                    {getKeyboardButtons().length === 0 && (
                      <View style={styles.keyboardEmptyState}>
                        <Text style={styles.keyboardEmptyText}>
                          {keyboardMode === "harakat" 
                            ? "Place cursor on a letter to see harakat variations"
                            : "Select letters mode to type"}
                        </Text>
                      </View>
                    )}
                  </View>
                </View>

                {/* Comparison table */}
                <ComparisonTable
                  originalText={selectedWord?.content || ""}
                  inputText={inputValue}
                  fontFamily={quranFont}
                  imalahData={{
                    indices: Array.from(imalahOverlayIndices),
                    placementByLetter: imalahPlacementByLetter,
                  }}
                  diamondData={{
                    indices: Array.from(diamondOverlayIndices),
                    placementByLetter: diamondPlacementByLetter,
                  }}
                  mainDisplaySize={mainDisplayInnerSize}
                />
              </>
            ) : (
              <>
                {/* Narrators list */}
                <View style={styles.popupHeader}>
                  <TouchableOpacity
                    onPress={onClose}
                    style={styles.closeButton}
                  >
                    <Text style={styles.closeIcon}>✕</Text>
                  </TouchableOpacity>
                  <View style={styles.popupHeaderTitleRow}>
                    <Text style={styles.popupTitle}>Select Narrator</Text>
                    {isShubahHighlight &&
                      currentSurahNumber &&
                      selectedWord && (
                        <ShubahWordAudioButton
                          word={selectedWord}
                          surahNumber={currentSurahNumber}
                        />
                      )}
                  </View>
                </View>
                <ScrollView style={styles.narratorList}>
                  {narrators.map((narrator) => (
                    <TouchableOpacity
                      key={narrator.id}
                      onPress={() => onSelectNarrator(narrator)}
                      style={styles.narratorItem}
                    >
                      <Text style={styles.narratorText}>{narrator.title}</Text>
                    </TouchableOpacity>
                  ))}
                </ScrollView>
              </>
            )}
          </ScrollView>
        </Pressable>
      </View>

      {/* Imalah placement canvas: drag circle to exact position */}
      <Modal
        visible={imalahPlacementModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => closeImalahPlacement(true)}
      >
        <Pressable style={styles.imalahPlacementOverlay} onPress={() => closeImalahPlacement(true)}>
          <Pressable style={styles.imalahPlacementPopover} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.imalahPlacementTitle}>Position imalah</Text>
            <Text style={styles.imalahPlacementHint}>Drag the circle where you want it</Text>
            <GestureDetector gesture={imalahCanvasPanGesture}>
              <View
                ref={imalahCanvasViewRef}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  imalahCanvasSizeRef.current = { width, height };
                  imalahCanvasViewRef.current?.measureInWindow((x, y, w, h) => {
                    imalahCanvasLayoutRef.current = { pageX: x, pageY: y, width: w, height: h };
                  });
                }}
                style={[
                  styles.imalahCanvas,
                  {
                    width: mainDisplayInnerSize.width,
                    height: mainDisplayInnerSize.height,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.imalahCanvasText,
                    Platform.OS === "ios" && { fontFamily: quranFont, fontWeight: "normal", fontStyle: "normal" },
                  ]}
                  numberOfLines={1}
                  pointerEvents="none"
                >
                  {inputValue ? inputValue.replace(/\u25C6/g, "") : ""}
                </Text>
                <View
                  pointerEvents="none"
                  style={[
                    styles.imalahCanvasCircle,
                    {
                      left: `${imalahCanvasPosition.xPercent}%`,
                      top: `${imalahCanvasPosition.yPercent}%`,
                      marginLeft: -6,
                      marginTop: -6,
                    },
                  ]}
                />
              </View>
            </GestureDetector>
            <View style={styles.imalahPlacementActions}>
              <TouchableOpacity
                style={styles.imalahPlacementRemoveBtn}
                onPress={() => {
                  if (imalahPlacementLetterIndex !== null) {
                    setImalahOverlayIndices((prev) => {
                      const next = new Set(prev);
                      next.delete(imalahPlacementLetterIndex);
                      return next;
                    });
                    setImalahPlacementByLetter((prev) => {
                      const o = { ...prev };
                      delete o[imalahPlacementLetterIndex];
                      return o;
                    });
                  }
                  setImalahPlacementModalVisible(false);
                  setImalahPlacementLetterIndex(null);
                }}
              >
                <Text style={styles.imalahPlacementRemoveBtnText}>Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.imalahPlacementDoneBtn} onPress={() => closeImalahPlacement(true)}>
                <Text style={styles.imalahPlacementDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Diamond placement canvas: drag diamond to exact position */}
      <Modal
        visible={diamondPlacementModalVisible}
        transparent
        animationType="fade"
        onRequestClose={() => closeDiamondPlacement(true)}
      >
        <Pressable style={styles.imalahPlacementOverlay} onPress={() => closeDiamondPlacement(true)}>
          <Pressable style={styles.imalahPlacementPopover} onPress={(e) => e.stopPropagation()}>
            <Text style={styles.imalahPlacementTitle}>Position diamond</Text>
            <Text style={styles.imalahPlacementHint}>Drag the diamond where you want it</Text>
            <GestureDetector gesture={diamondCanvasPanGesture}>
              <View
                ref={diamondCanvasViewRef}
                onLayout={(e) => {
                  const { width, height } = e.nativeEvent.layout;
                  diamondCanvasSizeRef.current = { width, height };
                  diamondCanvasViewRef.current?.measureInWindow((x, y, w, h) => {
                    diamondCanvasLayoutRef.current = { pageX: x, pageY: y, width: w, height: h };
                  });
                }}
                style={[
                  styles.imalahCanvas,
                  {
                    width: mainDisplayInnerSize.width,
                    height: mainDisplayInnerSize.height,
                  },
                ]}
              >
                <Text
                  style={[
                    styles.imalahCanvasText,
                    Platform.OS === "ios" && { fontFamily: quranFont, fontWeight: "normal", fontStyle: "normal" },
                  ]}
                  numberOfLines={1}
                  pointerEvents="none"
                >
                  {inputValue ? inputValue.replace(/\u25C6/g, "") : ""}
                </Text>
                <View
                  pointerEvents="none"
                  style={[
                    styles.diamondOverlayContainer,
                    {
                      position: "absolute",
                      left: `${diamondCanvasPosition.xPercent}%`,
                      top: `${diamondCanvasPosition.yPercent}%`,
                      width: (DIAMOND_SIZING.placementModal.height * 35) / 49,
                      height: DIAMOND_SIZING.placementModal.height,
                      marginLeft: -((DIAMOND_SIZING.placementModal.height * 35) / 49) / 2,
                      marginTop: -DIAMOND_SIZING.placementModal.height / 2,
                    },
                  ]}
                >
                  <DiamondShapeSvg height={DIAMOND_SIZING.placementModal.height} />
                </View>
              </View>
            </GestureDetector>
            <View style={styles.imalahPlacementActions}>
              <TouchableOpacity
                style={styles.imalahPlacementRemoveBtn}
                onPress={() => {
                  if (diamondPlacementLetterIndex !== null) {
                    setDiamondOverlayIndices((prev) => {
                      const next = new Set(prev);
                      next.delete(diamondPlacementLetterIndex);
                      return next;
                    });
                    setDiamondPlacementByLetter((prev) => {
                      const o = { ...prev };
                      delete o[diamondPlacementLetterIndex];
                      return o;
                    });
                  }
                  setDiamondPlacementModalVisible(false);
                  setDiamondPlacementLetterIndex(null);
                }}
              >
                <Text style={styles.imalahPlacementRemoveBtnText}>Remove</Text>
              </TouchableOpacity>
              <TouchableOpacity style={styles.imalahPlacementDoneBtn} onPress={() => closeDiamondPlacement(true)}>
                <Text style={styles.imalahPlacementDoneBtnText}>Done</Text>
              </TouchableOpacity>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </Modal>
  );
};

function DrawerAnimatedPanel({ drawerAnim, alignWithMushafContent, children }) {
  const insets = useSafeAreaInsets();
  const paddingTop = alignWithMushafContent
    ? insets.top + MUSHAF_DRAWER_CONTENT_TOP_OFFSET
    : insets.top + 14;
  return (
    <Animated.View
      style={[styles.drawer, { paddingTop, transform: [{ translateX: drawerAnim }] }]}
    >
      {children}
    </Animated.View>
  );
}

export default function App() {
  const [page, setPage] = useState(null);
  const [nextPage, setNextPage] = useState(null);
  const [previousPage, setPreviousPage] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState(null);
  const [fontsLoaded, fontError] = useFonts({
    NaskhNastaleeqIndoPakQWBW: require("./Naskh-Nastaleeq-IndoPak-QWBW.ttf"),
    MeQuran: require("./assets/me_quran_volt_newmet.ttf"),
    AswaatOne: require("./assets/aswaat-one.otf"),
    AswaatHelpers: require("./aswaat-helpers-one-Regular.ttf"),
    // DigitalKhatt: require("./digitalkhatt.otf"),
    DigitalKhatt: require("./DigitalKhattV2.otf"),
    DigitalKhattV3: require("./DigitalKhattV3.ttf"),
    SurahNameV2: require("./surah-name-v2.ttf"),
    Nastaleeq: require("./nastaleeq.ttf"),
  });
  
  // Debug font loading
  useEffect(() => {
    if (fontError) {
      console.error("Font loading error:", fontError);
      if (typeof fontError === 'object') {
        try {
          console.error("Font error details:", JSON.stringify(fontError, null, 2));
        } catch (e) {
          console.error("Font error (stringified):", String(fontError));
        }
      }
    }
    if (fontsLoaded) {
      console.log("✅ Fonts loaded successfully");
      console.log("📝 Using font family:", QURAN_FONT_FAMILY);
      console.log("📖 Mushaf: choose in Settings (2 = 13 Liner IndoPak, 3 = 15 Liner Uthmani)");
      console.log("📱 Platform:", Platform.OS);
      
      // Test if font is available on iOS
      if (Platform.OS === 'ios') {
        console.log("🍎 iOS: Testing font rendering with Unicode characters");
        console.log("🍎 Test characters - Diamond dot (U+0659):", "\u0659");
        console.log("🍎 Test characters - Imalah dot (U+0658):", "\u0658");
        console.log("🍎 Test text with dots: جَعَل\u0659\u0658");
        console.log("🍎 Font family being used:", QURAN_FONT_FAMILY);
        console.log("🍎 Font file path: assets/aswaat-fontlab.ttf");
        console.log("🍎 ⚠️ If characters don't render, the font file's internal name might not match 'AswaatOne'");
        console.log("🍎 ⚠️ Try rebuilding the app: npx expo run:ios --clear");
        console.log("🍎 💡 Possible font names to try: 'Aswaat', 'AswaatOne', 'Aswaat FontLab', or the file's PostScript name");
      }
      

    }
  }, [fontsLoaded, fontError]);
  /** iOS: set when installed app version is below API `GlobalConfig` row name `min_ios_version`. */
  const [iosUpdateWall, setIosUpdateWall] = useState(null);

  const runIosMinVersionCheck = useCallback(async () => {
    if (Platform.OS !== "ios") return;
    const result = await checkIosMinVersionFromApi(getApiBase());
    if (result.blocked) {
      setIosUpdateWall({
        minVersion: result.minVersion ?? "",
        installed: result.installed ?? "",
      });
    } else {
      setIosUpdateWall(null);
    }
  }, []);

  useEffect(() => {
    runIosMinVersionCheck();
  }, [runIosMinVersionCheck]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next === "active") runIosMinVersionCheck();
    });
    return () => sub.remove();
  }, [runIosMinVersionCheck]);

  const [popupVisible, setPopupVisible] = useState(false);
  const [narrators, setNarrators] = useState([]);
  const [selectedNarrator, setSelectedNarrator] = useState(null);
  const [inputValue, setInputValue] = useState("");
  const [selectedWord, setSelectedWord] = useState(null);
  const [selectedWordId, setSelectedWordId] = useState(null);
  const [wordPosition, setWordPosition] = useState(null);
  const [currentPage, setCurrentPage] = useState(9);
  const [pageInput, setPageInput] = useState("9");
  const [showPageSlider, setShowPageSlider] = useState(false);
  const [sliderValue, setSliderValue] = useState(9); // Temporary value for slider (doesn't trigger page load)
  /** "Go to Page" modal number field — string so users can clear/retype; synced from currentPage while modal open */
  const [goPageField, setGoPageField] = useState("");
  const [goPageSurahSearch, setGoPageSurahSearch] = useState("");
  const [totalPages, setTotalPages] = useState(604);
  const juzSegments = useMemo(
    () =>
      segmentsData
        .filter((s) => s.fields.category === "juz")
        .sort((a, b) => b.fields.first_page - a.fields.first_page), // RTL: highest page first
    []
  );
  const surahSegments = useMemo(
    () =>
      segmentsData
        .filter((s) => s.fields.category === "surah")
        .sort((a, b) => b.fields.first_page - a.fields.first_page), // RTL: highest page first
    []
  );
  /** Same titles as the Go to Page surah carousel (`segments.json` surah segments) */
  const surahTitleByNumber = useMemo(() => {
    const m = new Map();
    surahSegments.forEach((s) => {
      const n = s.fields.category_position;
      if (typeof n === "number" && n >= 1 && n <= 114) {
        m.set(n, s.fields.title);
      }
    });
    for (let n = 1; n <= 114; n++) {
      if (!m.has(n)) m.set(n, surahArabicName(n));
    }
    return m;
  }, [surahSegments]);
  const [currentJuzIndex, setCurrentJuzIndex] = useState(0);
  const [currentSurahIndex, setCurrentSurahIndex] = useState(0);
  const juzScrollViewRef = useRef(null);
  const surahScrollViewRef = useRef(null);
  const surahHeaderPickerScrollRef = useRef(null);
  const surahHeaderPickerViewWidthRef = useRef(0);
  const juzCarouselWidthRef = useRef(0);
  const surahCarouselWidthRef = useRef(0);
  /** Go modal: surah number last chosen from the carousel (disambiguates multiple surahs on one page). */
  const goModalSurahHighlightPinRef = useRef(null);
  /** Per-index measured chip width for centering variable-width carousel rows */
  const juzItemWidthsRef = useRef({});
  const surahItemWidthsRef = useRef({});
  const carouselCenterDebounceRef = useRef(null);
  const [selectedNarrators, setSelectedNarrators] = useState([]);
  const [savedVariations, setSavedVariations] = useState([]);
  const [allVariations, setAllVariations] = useState({});
  const [isDrawerVisible, setIsDrawerVisible] = useState(false);
  const [isDrawerFullyOpen, setIsDrawerFullyOpen] = useState(false);
  const [isQiraatSettingsVisible, setIsQiraatSettingsVisible] = useState(false);
  const [isMushafDarkMode, setIsMushafDarkMode] = useState(false);
  // Initialize mushafId from storage on web (sync) so first paint matches; native loads in useEffect
  const [mushafId, setMushafId] = useState(() => {
    if (typeof Platform !== "undefined" && Platform.OS === "web" && typeof localStorage !== "undefined") {
      try {
        const saved = localStorage.getItem("mushafId");
        if (saved) {
          const id = parseInt(saved, 10);
          if (id === 2 || id === 3) return id;
        }
      } catch (e) {}
    }
    // Default to Mushaf 2 (13 Liner IndoPak) so the initial
    // render matches the app settings unless a saved preference
    // overrides it from storage.
    return 2;
  });
  /** Mushaf 2: juz row from API segments (`MushafSegment`); null means fallback to local `segments.json`. */
  const [mushafJuzSegmentsApi, setMushafJuzSegmentsApi] = useState(null);
  /** Mushaf 2: surah list for header-insert picker from API `MushafSegment` category surah; null → 1..114 + local titles. */
  const [mushafSurahSegmentsApi, setMushafSurahSegmentsApi] = useState(null);
  const goToPageJuzSegments = useMemo(() => {
    if (mushafId === 2 && Array.isArray(mushafJuzSegmentsApi) && mushafJuzSegmentsApi.length > 0) {
      return [...mushafJuzSegmentsApi].sort((a, b) => b.fields.first_page - a.fields.first_page);
    }
    return juzSegments;
  }, [mushafId, mushafJuzSegmentsApi, juzSegments]);
  /** Surahs shown in the header-insert / “Select surah” sheet (Mushaf 2: API segments when present). */
  const headerInsertSurahPickerEntries = useMemo(() => {
    if (mushafId === 2 && Array.isArray(mushafSurahSegmentsApi) && mushafSurahSegmentsApi.length > 0) {
      return [...mushafSurahSegmentsApi]
        .sort((a, b) => a.fields.category_position - b.fields.category_position)
        .map((s) => ({
          key: s.pk,
          surahNumber: s.fields.category_position,
          title: (s.fields.title || "").trim() || surahTitleByNumber.get(s.fields.category_position) || "",
        }));
    }
    return Array.from({ length: 114 }, (_, i) => {
      const n = i + 1;
      return {
        key: `local-surah-${n}`,
        surahNumber: n,
        title: surahTitleByNumber.get(n) ?? surahArabicName(n),
      };
    });
  }, [mushafId, mushafSurahSegmentsApi, surahTitleByNumber]);
  const VARIATIONS_SIDEBAR_WIDTH = 320;
  const [isVariationsSidebarOpen, setIsVariationsSidebarOpen] = useState(false);
  const [isVariationBottomSheetVisible, setIsVariationBottomSheetVisible] = useState(false);
  const [isVariationBottomSheetExpanded, setIsVariationBottomSheetExpanded] = useState(false);
  const [sheetTranslateY, setSheetTranslateY] = useState(null); // Animated.Value from VariationBottomSheet for bar visibility
  const [allMushafVariations, setAllMushafVariations] = useState([]);
  const [lastSelectedVariationHighlight, setLastSelectedVariationHighlight] = useState(null);
  /**
   * After prefetch: word id string -> lookup for comparison riwayah succeeded (mushaf listen badge).
   * Missing key = not checked yet; false = checked and not playable.
   */
  const [comparisonSegmentPlayableByWordId, setComparisonSegmentPlayableByWordId] = useState({});
  /** Bottom traversal chips: null = prefetching / unknown; boolean after lookup */
  const [traversalChipSegmentPlayable, setTraversalChipSegmentPlayable] = useState({
    hafs: null,
    comparison: null,
  });
  /** While chip clip fetch/play is in flight — spinners on mushaf word + traversal volume badges */
  const [chipClipLoadingBadge, setChipClipLoadingBadge] = useState(null);
  /** Bumped when app returns to foreground so segment playability is re-checked */
  const [segmentPrefetchResumeTick, setSegmentPrefetchResumeTick] = useState(0);
  const variationsSidebarAnim = useRef(new Animated.Value(VARIATIONS_SIDEBAR_WIDTH)).current;
  const variationsSidebarBackdropAnim = useRef(new Animated.Value(0)).current;
  const variationsSidebarScrollRef = useRef(null);
  const variationsSidebarScrollOffsetRef = useRef(0);
  const VARIATIONS_SIDEBAR_ROW_HEIGHT = 72;
  const [currentTab, setCurrentTab] = useState("Recite");
  /** Top chrome (safe area, status bar, outer nav): leads currentTab during Recite←Listen slide to avoid flash */
  const [chromeTab, setChromeTab] = useState("Recite");
  const [expandedParents, setExpandedParents] = useState(new Set());
  const [parentNarrators, setParentNarrators] = useState([]);
  const [selectedVideo, setSelectedVideo] = useState(null);
  const [activeListenTrack, setActiveListenTrack] = useState(null);
  const [listenIsPlaying, setListenIsPlaying] = useState(false);
  const [listenPositionMs, setListenPositionMs] = useState(0);
  const [listenDurationMs, setListenDurationMs] = useState(0);
  /** Segments for `RecitationVerseSegment` — keyed to current `activeListenTrack` recitation id */
  const [listenVerseSegments, setListenVerseSegments] = useState(/** @type {object[] | null} */ (null));
  const [listenVerseSegmentsRecitationId, setListenVerseSegmentsRecitationId] = useState(null);
  /** When set (traversal chip clip), mushaf highlights this verse only — not playback-driven segment changes */
  const [listenTraversalClipHighlightVerse, setListenTraversalClipHighlightVerse] = useState(null);
  const [listenPlayerVisible, setListenPlayerVisible] = useState(false);
  const [selectedListenReciter, setSelectedListenReciter] = useState(DEFAULT_LISTEN_RECITER_SLUG);
  const [selectedListenNarrator, setSelectedListenNarrator] = useState("all");
  const [listenSurahQuery, setListenSurahQuery] = useState("");
  const [listenReciters, setListenReciters] = useState([]);
  const [listenRecitationsByReciter, setListenRecitationsByReciter] = useState({});
  const [listenCatalogLoading, setListenCatalogLoading] = useState(false);
  const [listenCatalogError, setListenCatalogError] = useState(null);
  const [listenPlayerLayout, setListenPlayerLayout] = useState({ width: 0, height: 0 });
  const [pageCache, setPageCache] = useState({}); // Cache for pre-fetched pages (for React re-renders)
  const [variationCache, setVariationCache] = useState({}); // Cache for variations per page (for React re-renders)
  const pageCacheRef = useRef({}); // Ref cache for synchronous access
  const variationCacheRef = useRef({}); // Ref cache for variations
  /** From GET /api/mushafs/:id/surah_header_markers — page (string) -> surah_header_position[] */
  const [surahHeaderMarkersByPage, setSurahHeaderMarkersByPage] = useState(null);
  const [surahHeaderMarkersTick, setSurahHeaderMarkersTick] = useState(0);
  /** Surah rows for Go-to-Page: only GET /api/mushafs/:id/surah_header_markers (`by_page`). Empty while loading. */
  const goToPageSurahCarouselEntries = useMemo(() => {
    if (surahHeaderMarkersByPage === null) return [];

    if (typeof surahHeaderMarkersByPage !== "object") return [];

    const raw = [];
    const pageKeys = Object.keys(surahHeaderMarkersByPage).sort(
      (x, y) => parseInt(x, 10) - parseInt(y, 10)
    );
    for (const pageStr of pageKeys) {
      const page = parseInt(pageStr, 10);
      if (!Number.isFinite(page) || page < 1) continue;
      const nums = surahHeaderMarkersByPage[pageStr];
      if (!Array.isArray(nums)) continue;
      for (const rawN of nums) {
        const n = Number(rawN);
        if (!Number.isFinite(n) || n < 1 || n > 114) continue;
        raw.push({
          key: `hdr-${page}-${n}`,
          page,
          surahNumber: n,
          title: surahArabicName(n),
          titleEn: surahEnglishAlias(n),
          lastPage: totalPages,
          fromMarkers: true,
        });
      }
    }
    if (raw.length === 0) return [];
    // Mushaf reading order: page ASC, then line order within a page (stable sort keeps API array order).
    raw.sort((a, b) => a.page - b.page);
    for (let i = 0; i < raw.length; i++) {
      if (i + 1 < raw.length) {
        const next = raw[i + 1];
        raw[i].lastPage =
          next.page > raw[i].page ? next.page - 1 : raw[i].page;
      } else {
        raw[i].lastPage = Math.max(raw[i].page, totalPages);
      }
    }
    // Go-to-Page strip: high page on the left (see juz row). Same page: higher surah left so RTL → surah ASC.
    raw.sort((a, b) => b.page - a.page || b.surahNumber - a.surahNumber);
    return raw;
  }, [surahHeaderMarkersByPage, totalPages]);
  const goPageSurahSearchNorm = useMemo(() => {
    const t = goPageSurahSearch.trim().toLowerCase();
    return t.replace(/\s+/g, " ");
  }, [goPageSurahSearch]);
  const goToPageSurahCarouselFiltered = useMemo(() => {
    const entries = goToPageSurahCarouselEntries;
    if (!goPageSurahSearchNorm) return entries;
    return entries.filter((e) => {
      const ar = (e.title || "").toLowerCase();
      const en = (e.titleEn || "").toLowerCase();
      const num = String(e.surahNumber);
      return (
        ar.includes(goPageSurahSearchNorm) ||
        (en && en.includes(goPageSurahSearchNorm)) ||
        num.includes(goPageSurahSearchNorm)
      );
    });
  }, [goToPageSurahCarouselEntries, goPageSurahSearchNorm]);
  const activeSurahCarouselRowIndex = useMemo(() => {
    const filtered = goToPageSurahCarouselFiltered;
    const key = goToPageSurahCarouselEntries[currentSurahIndex]?.key;
    if (!filtered.length) return 0;
    if (!key) return 0;
    const idx = filtered.findIndex((e) => e.key === key);
    return idx >= 0 ? idx : 0;
  }, [goToPageSurahCarouselFiltered, goToPageSurahCarouselEntries, currentSurahIndex]);
  /** Surah picker: first new row index (= tapped line.position, i.e. insert before that line) */
  const pendingHeaderInsertAtRef = useRef(null);
  /** Page number for which the picker was opened (freeze if user swipes before confirming) */
  const pendingHeaderPickPageRef = useRef(null);
  const [headerInsertMode, setHeaderInsertMode] = useState(false);
  const [verserMode, setVerserMode] = useVerserMode({
    mushafId,
    selectedNarrators,
  });
  const [verserAnchorWordId, setVerserAnchorWordId] = useState(null);
  const verserAnchorWordIdRef = useRef(null);
  const [verserAyahPreviewByPage, setVerserAyahPreviewByPage] = useState({});
  const [verserAyahModalVisible, setVerserAyahModalVisible] = useState(false);
  const [verserAyahModalWordIds, setVerserAyahModalWordIds] = useState([]);
  const [verserAyahModalSuggestedLabel, setVerserAyahModalSuggestedLabel] =
    useState("");
  const verserAyahModalWordIdsRef = useRef([]);
  /** After the first modal-applied label on a page, further two-tap ranges auto-use ayah+1 (surah unchanged). */
  const [verserLastAyahByPage, setVerserLastAyahByPage] = useState({});
  /** null | { pageNum, operations: { insertAtPosition, surahNumber, useBasmala }[] } */
  const [headerPreview, setHeaderPreview] = useState(null);
  const headerPreviewRef = useRef(null);
  const [surahPickerVisible, setSurahPickerVisible] = useState(false);
  const DRAWER_WIDTH = 260;
  const TAB_SLIDE_DURATION = 320;
  // Bottom tab bar slides down off-screen in sync with drawer closing (translateY when drawer closed)
  const DRAWER_BOTTOM_NAV_SLIDE = 140;
  const drawerAnim = useRef(new Animated.Value(-DRAWER_WIDTH)).current;
  const backdropAnim = useRef(new Animated.Value(0)).current;
  // Default off-screen so the tab bar never flashes at translateY 0 before the open animation runs
  const drawerBottomNavAnim = useRef(new Animated.Value(DRAWER_BOTTOM_NAV_SLIDE)).current;
  /** Horizontal offset for Recite | Listen carousel: 0 = Mushaf, -screenWidth = Listen */
  const tabSlideAnim = useRef(new Animated.Value(0)).current;
  const [listenColumnMounted, setListenColumnMounted] = useState(false);
  const listenColumnEverMountedRef = useRef(false);
  const currentTabRef = useRef(currentTab);
  const isDrawerVisibleRef = useRef(isDrawerVisible);
  const currentPageRef = useRef(currentPage);
  currentPageRef.current = currentPage;
  const mushafIdRef = useRef(mushafId);
  mushafIdRef.current = mushafId;
  const isNavigatingRef = useRef(false);
  const handlePreviousPageRef = useRef();
  const handleNextPageRef = useRef();
  const fetchingPagesRef = useRef(new Set()); // Track which pages are being fetched
  const inFlightPageRequestsRef = useRef({}); // pageNum -> Promise resolving to page payload
  const isDraggingDrawerRef = useRef(false);
  const drawerStartValueRef = useRef(-DRAWER_WIDTH);
  const isAnimatingDrawerRef = useRef(false);
  const pagerRef = useRef(null);
  /** Skip `onPageSelected` while we programmatically `setPage` (avoids bogus page after `totalPages` updates). */
  const pagerSelectSuppressedRef = useRef(false);
  const listenSoundRef = useRef(null);
  /** Latest listen metadata for lock-screen / Dynamic Island sync (playback callback has a stable ref). */
  const activeListenTrackMetaRef = useRef({ track: null, reciter: null });
  const listenClipEndMsRef = useRef(null);
  const listenClipStartMsRef = useRef(null);
  /** Prevents overlapping chip-segment fetch/play while a prior chip request is in flight */
  const chipClipSegmentRequestInFlightRef = useRef(false);
  /** Invalidate in-flight mushaf-page segment prefetches when page/narrator/resume changes */
  const comparisonSegmentPrefetchGenRef = useRef(0);
  /** Invalidate traversal Hafs|comparison prefetch when active word or resume changes */
  const traversalSegmentPrefetchGenRef = useRef(0);
  /** Set each render after `handlePlayFirstRecitationSegmentForAyah` exists — used by earlier `handleVariationTraversalWordTap`. */
  const playRecitationSegmentForAyahRef = useRef(async () => {});
  const listenVerseSegmentsByRecitationRef = useRef({});
  const listenPlayerDrag = useRef(
    new Animated.ValueXY({
      x: LISTEN_PLAYER_MARGIN,
      y: Dimensions.get("window").height - 245,
    })
  ).current;
  const listenPlayerDragInitializedRef = useRef(false);

  const listenLibraries = useMemo(() => {
    const normalizeTracks = (tracks, riwayahId, riwayahLabel) =>
      (Array.isArray(tracks) ? tracks : [])
        .filter((item) => item?.index != null && item?.name && item?.url)
        .sort((a, b) => Number(a.index) - Number(b.index))
        .map((item) => ({
          ...item,
          trackKey: `${item.reciterSlug || "x"}-${riwayahId}-${item.index}`,
          riwayahId,
          riwayahLabel,
        }));

    const toRows = (tracks) => {
      const rowSize = 3;
      const rows = [];
      for (let i = 0; i < tracks.length; i += rowSize) {
        rows.push(tracks.slice(i, i + rowSize));
      }
      return rows;
    };

    const allApiTracks = Object.values(listenRecitationsByReciter).flat();
    if (allApiTracks.length === 0) return [];

    const byRiwayah = new Map();
    allApiTracks.forEach((t) => {
      const rid = t.riwayahId || "unknown";
      if (!byRiwayah.has(rid)) {
        byRiwayah.set(rid, { title: t.riwayahLabel || rid, items: [] });
      }
      byRiwayah.get(rid).items.push(t);
    });

    return Array.from(byRiwayah.entries())
      .map(([riwayahId, { title, items }]) => {
        const tracks = normalizeTracks(items, riwayahId, title);
        return {
          id: listenLibraryIdForRiwayah(riwayahId),
          title,
          tracks,
          rows: toRows(tracks),
        };
      })
      .sort((a, b) => a.title.localeCompare(b.title));
  }, [listenRecitationsByReciter]);

  const listenNarratorOptions = useMemo(
    () => [
      { id: "all", label: "All Narrators" },
      ...listenLibraries.map((library) => ({
        id: library.id,
        label: library.title,
      })),
    ],
    [listenLibraries]
  );

  const listenFilteredRows = useMemo(() => {
    const normalize = (text) => (text || "").toString().trim().toLowerCase();
    const query = normalize(listenSurahQuery);
    const selectedNarratorLibrary = selectedListenNarrator === "all"
      ? listenLibraries
      : listenLibraries.filter((library) => library.id === selectedListenNarrator);

    const allTracks = selectedNarratorLibrary.flatMap((library) => library.tracks || []);

    const byReciter = allTracks.filter(
      (track) => track.reciterSlug === selectedListenReciter
    );

    const byQuery = query
      ? byReciter.filter((track) => {
          const surahNumber = String(track.index || "");
          const name = normalize(track.name);
          return surahNumber.includes(query) || name.includes(query);
        })
      : byReciter;

    const rows = [];
    for (let i = 0; i < byQuery.length; i += 3) {
      rows.push(byQuery.slice(i, i + 3));
    }
    return rows;
  }, [listenLibraries, listenSurahQuery, selectedListenNarrator, selectedListenReciter]);

  useEffect(() => {
    if (listenReciters.length === 0) return;
    setSelectedListenReciter((prev) => {
      if (prev === "all") return prev;
      if (listenReciters.some((r) => r.slug === prev)) return prev;
      return listenReciters[0].slug;
    });
  }, [listenReciters]);

  useEffect(() => {
    if (!listenColumnMounted) return undefined;
    let cancelled = false;
    (async () => {
      setListenCatalogLoading(true);
      setListenCatalogError(null);
      try {
        const r1 = await fetch(getRecitersUrl());
        if (!r1.ok) throw new Error(`Reciters HTTP ${r1.status}`);
        const reciters = await r1.json();
        if (cancelled) return;
        const list = Array.isArray(reciters) ? reciters : [];
        setListenReciters(list);
        const bySlug = {};
        for (const rec of list) {
          if (!rec?.slug) continue;
          const r2 = await fetch(getRecitationsUrl(rec.slug));
          if (!r2.ok) throw new Error(`Recitations ${rec.slug} HTTP ${r2.status}`);
          const tracks = await r2.json();
          if (cancelled) return;
          const arr = Array.isArray(tracks) ? tracks : [];
          bySlug[rec.slug] = arr.map((t) => ({
            ...t,
            reciterSlug: rec.slug,
            recitationId:
              t?.recitation_id != null
                ? Number(t.recitation_id)
                : t?.recitationId != null
                  ? Number(t.recitationId)
                  : null,
          }));
        }
        setListenRecitationsByReciter(bySlug);
      } catch (e) {
        if (!cancelled) {
          setListenCatalogError(e?.message || "Failed to load recitation catalog");
          setListenRecitationsByReciter({});
        }
      } finally {
        if (!cancelled) setListenCatalogLoading(false);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [listenColumnMounted]);

  const listenNarratorMetaById = useMemo(() => {
    const map = {};
    parentNarrators.forEach((parent) => {
      const parentTitle = parent?.title || "Asim";
      (parent?.children || []).forEach((child) => {
        if (!child?.id) return;
        map[child.id] = {
          label: `${child.title || "Narrator"} <- ${parentTitle}`,
          color: child.highlight_color || "#0f172a",
        };
      });
    });

    // Fallback when parent/child tree is not yet available
    if (!map["hafs-an-asim"]) {
      map["hafs-an-asim"] = { label: "Hafs <- Asim", color: "#0f172a" };
    }
    if (!map["shubah-an-asim"]) {
      map["shubah-an-asim"] = { label: "Shu'bah <- Asim", color: "#334155" };
    }

    return map;
  }, [parentNarrators]);

  const activeListenReciterForPlayer = useMemo(
    () => listenReciters.find((r) => r.slug === activeListenTrack?.reciterSlug),
    [listenReciters, activeListenTrack?.reciterSlug]
  );

  useEffect(() => {
    activeListenTrackMetaRef.current = {
      track: activeListenTrack,
      reciter: activeListenReciterForPlayer,
    };
  }, [activeListenTrack, activeListenReciterForPlayer]);

  useEffect(() => {
    if (Platform.OS !== "ios") return undefined;
    return subscribeListenRemoteCommands({
      onPlay: () => {
        listenSoundRef.current?.playAsync?.().catch(() => {});
      },
      onPause: () => {
        listenSoundRef.current?.pauseAsync?.().catch(() => {});
      },
      onToggle: async () => {
        const s = await listenSoundRef.current?.getStatusAsync?.();
        if (!s?.isLoaded) return;
        if (s.isPlaying) {
          await listenSoundRef.current?.pauseAsync?.().catch(() => {});
        } else {
          await listenSoundRef.current?.playAsync?.().catch(() => {});
        }
      },
      onSeek: (positionMillis) => {
        listenSoundRef.current?.setPositionAsync?.(positionMillis).catch(() => {});
      },
    });
  }, []);

  const getListenVerseSegmentsForRecitation = useCallback(async (recitationId) => {
    const idNum = Number(recitationId);
    if (!Number.isFinite(idNum) || idNum <= 0) return [];
    const cache = listenVerseSegmentsByRecitationRef.current;
    if (cache[idNum]) return cache[idNum];
    const res = await fetch(getVerseSegmentsUrl(idNum));
    if (!res.ok) throw new Error(`Verse segments HTTP ${res.status}`);
    const rows = await res.json();
    const arr = (Array.isArray(rows) ? rows : [])
      .map((row) => ({
        ...row,
        start_time: Number(row.start_time),
        end_time: Number(row.end_time),
        verse: normalizeAyahLabelForListen(row.verse),
      }))
      .filter(
        (row) =>
          row.verse &&
          Number.isFinite(row.start_time) &&
          Number.isFinite(row.end_time) &&
          row.end_time >= row.start_time
      )
      .sort((a, b) => a.start_time - b.start_time);
    cache[idNum] = arr;
    return arr;
  }, []);

  useEffect(() => {
    const rid = activeListenTrack?.recitation_id ?? activeListenTrack?.recitationId;
    if (!rid) {
      setListenVerseSegments(null);
      setListenVerseSegmentsRecitationId(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(getVerseSegmentsUrl(rid));
        if (!res.ok) throw new Error(String(res.status));
        const data = await res.json();
        if (cancelled) return;
        const arr = Array.isArray(data) ? data : [];
        arr.sort((a, b) => Number(a.start_time) - Number(b.start_time));
        setListenVerseSegments(arr);
        setListenVerseSegmentsRecitationId(rid);
      } catch (e) {
        if (!cancelled) {
          setListenVerseSegments([]);
          setListenVerseSegmentsRecitationId(rid);
        }
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [activeListenTrack?.trackKey, activeListenTrack?.recitation_id, activeListenTrack?.recitationId]);

  const listenRecitationHighlightVerse = useMemo(() => {
    const chipClip = !!activeListenTrack?.chipClipPlayback;
    if (listenTraversalClipHighlightVerse) {
      if (chipClip && !listenIsPlaying) {
        return null;
      }
      return listenTraversalClipHighlightVerse;
    }
    if (chipClip) {
      return null;
    }
    const rid = activeListenTrack?.recitation_id ?? activeListenTrack?.recitationId;
    if (
      !rid ||
      listenVerseSegmentsRecitationId !== rid ||
      !Array.isArray(listenVerseSegments) ||
      listenVerseSegments.length === 0
    ) {
      return null;
    }
    const surahNum = Number(activeListenTrack?.index);
    if (!Number.isFinite(surahNum)) return null;
    const sec = listenPositionMs / 1000;
    const seg = recitationSegmentAtSeconds(listenVerseSegments, sec);
    if (!seg?.verse) return null;
    const v = normalizeAyahLabelForListen(seg.verse);
    if (!v) return null;
    const parts = v.split(":");
    if (parts.length >= 2 && Number(parts[0]) !== surahNum) return null;
    return v;
  }, [
    activeListenTrack,
    listenPositionMs,
    listenVerseSegments,
    listenVerseSegmentsRecitationId,
    listenTraversalClipHighlightVerse,
    listenIsPlaying,
  ]);

  /** 0–1 progress within the active chip audio clip (for subtle traversal bar indicator) */
  const chipClipTraversalProgress = useMemo(() => {
    if (!activeListenTrack?.chipClipPlayback || !listenIsPlaying) return null;
    const start = listenClipStartMsRef.current;
    const end = listenClipEndMsRef.current;
    if (!Number.isFinite(start) || !Number.isFinite(end) || end <= start) return null;
    const t = (listenPositionMs - start) / (end - start);
    return Math.max(0, Math.min(1, t));
  }, [
    activeListenTrack?.chipClipPlayback,
    activeListenTrack?.trackKey,
    listenIsPlaying,
    listenPositionMs,
  ]);

  useEffect(() => {
    if (!listenPlayerVisible || isDrawerVisible) return;
    if (listenPlayerDragInitializedRef.current) return;
    listenPlayerDrag.setValue({
      x: LISTEN_PLAYER_MARGIN,
      y: Dimensions.get("window").height - 245,
    });
    listenPlayerDragInitializedRef.current = true;
  }, [isDrawerVisible, listenPlayerDrag, listenPlayerVisible]);

  const listenPlayerPanResponder = useMemo(
    () =>
      PanResponder.create({
        onMoveShouldSetPanResponder: (_, gestureState) =>
          Math.abs(gestureState.dy) > 3,
        onPanResponderGrant: () => {
          listenPlayerDrag.setOffset({
            x: listenPlayerDrag.x.__getValue(),
            y: listenPlayerDrag.y.__getValue(),
          });
          listenPlayerDrag.setValue({ x: 0, y: 0 });
        },
        onPanResponderMove: (_, gestureState) => {
          listenPlayerDrag.x.setValue(0);
          listenPlayerDrag.y.setValue(gestureState.dy);
        },
        onPanResponderRelease: () => {
          listenPlayerDrag.flattenOffset();
          const { width: screenWidth, height: screenHeight } = Dimensions.get("window");
          const playerWidth = listenPlayerLayout.width || screenWidth - LISTEN_PLAYER_MARGIN * 2;
          const playerHeight = listenPlayerLayout.height || 156;
          const minX = LISTEN_PLAYER_MARGIN;
          const maxX = Math.max(minX, screenWidth - playerWidth - LISTEN_PLAYER_MARGIN);
          const minY = 64;
          const maxY = Math.max(minY, screenHeight - playerHeight - LISTEN_PLAYER_MARGIN);
          const clampedX = Math.min(maxX, Math.max(minX, listenPlayerDrag.x.__getValue()));
          const clampedY = Math.min(maxY, Math.max(minY, listenPlayerDrag.y.__getValue()));
          Animated.spring(listenPlayerDrag, {
            toValue: { x: clampedX, y: clampedY },
            useNativeDriver: false,
            damping: 18,
            stiffness: 220,
          }).start();
        },
      }),
    [listenPlayerDrag, listenPlayerLayout]
  );

  useEffect(() => {
    currentTabRef.current = currentTab;
  }, [currentTab]);

  useEffect(() => {
    setChromeTab(currentTab);
  }, [currentTab]);

  // Keep carousel offset aligned with tab (e.g. after remount, or if tab changed without animation).
  useLayoutEffect(() => {
    if (currentTab === "Learn") return;
    const w = Dimensions.get("window").width;
    if (currentTab === "Listen") {
      tabSlideAnim.setValue(-w);
      if (!listenColumnEverMountedRef.current) {
        listenColumnEverMountedRef.current = true;
        setListenColumnMounted(true);
      }
    } else if (currentTab === "Recite") {
      tabSlideAnim.setValue(0);
    }
  }, [currentTab]);

  useEffect(() => {
    isDrawerVisibleRef.current = isDrawerVisible;
  }, [isDrawerVisible]);

  useEffect(() => {
    headerPreviewRef.current = headerPreview;
  }, [headerPreview]);

  useEffect(() => {
    // Listen UX toggle: if no recitation player is visible, force-hide the left sidebar.
    // Keep this guard here so we can easily relax it later.
    if (currentTab === "Listen" && !listenPlayerVisible && isDrawerVisible) {
      closeDrawer();
    }
  }, [currentTab, listenPlayerVisible, isDrawerVisible]);

  // Load saved mushaf preference (2 = 13 Liner IndoPak, 3 = 15 Liner Uthmani)
  useEffect(() => {
    const load = async () => {
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          const saved = localStorage.getItem("mushafId");
          if (saved) {
            const id = parseInt(saved, 10);
            if (id === 2 || id === 3) setMushafId(id);
          }
        } else {
          const saved = await AsyncStorage.getItem("mushafId");
          if (saved) {
            const id = parseInt(saved, 10);
            if (id === 2 || id === 3) setMushafId(id);
          }
        }
      } catch (err) {
        console.error("Error loading mushafId:", err);
      }
    };
    load();
  }, []);

  // Load total pages dynamically for the selected mushaf.
  useEffect(() => {
    const loadMushafMeta = async () => {
      const pageExists = async (position) => {
        try {
          const res = await fetch(`${getApiBase()}/api/mushafs/${mushafId}/pages/${position}`);
          if (!res.ok) return false;
          const data = await res.json();
          return Boolean(data && typeof data === "object" && data.id && data.position);
        } catch (_) {
          return false;
        }
      };

      const discoverTotalPagesFromPagesApi = async () => {
        // Fast-path bounds for known mushafs while still validating via API.
        const lowerSeed = mushafId === 2 ? 604 : 300;
        const upperSeed = mushafId === 2 ? 1200 : 800;

        let low = 0;
        let high = upperSeed;

        // If lower seed exists, start from there to reduce probes for long mushafs.
        if (await pageExists(lowerSeed)) {
          low = lowerSeed;
        }

        // Ensure upper bound is missing; if it exists, expand until missing.
        while (await pageExists(high)) {
          low = high;
          high *= 2;
          if (high > 5000) break;
        }

        // Binary search for highest existing page.
        while (low + 1 < high) {
          const mid = Math.floor((low + high) / 2);
          if (await pageExists(mid)) {
            low = mid;
          } else {
            high = mid;
          }
        }

        return low > 0 ? low : 604;
      };

      try {
        const response = await fetch(`${getApiBase()}/api/mushafs/${mushafId}`);
        if (response.ok) {
          const data = await response.json();
          const parsedTotalPages = Number(data?.total_pages);
          if (Number.isFinite(parsedTotalPages) && parsedTotalPages > 0) {
            setTotalPages(parsedTotalPages);
            return;
          }
        }

        // Backward compatibility: older APIs may not include total_pages.
        const discoveredTotalPages = await discoverTotalPagesFromPagesApi();
        setTotalPages(discoveredTotalPages);
      } catch (err) {
        console.error("Error loading mushaf metadata:", err);
        const discoveredTotalPages = await discoverTotalPagesFromPagesApi();
        setTotalPages(discoveredTotalPages);
      }
    };
    loadMushafMeta();
  }, [mushafId]);

  useEffect(() => {
    if (currentPage > totalPages) {
      setCurrentPage(totalPages);
      setPageInput(String(totalPages));
      setSliderValue(totalPages);
    }
  }, [currentPage, totalPages]);

  // When mushaf changes: persist, clear page cache, and clear current page so we don't show wrong content with new font
  useEffect(() => {
    const save = async () => {
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          localStorage.setItem("mushafId", String(mushafId));
        } else {
          await AsyncStorage.setItem("mushafId", String(mushafId));
        }
      } catch (err) {
        console.error("Error saving mushafId:", err);
      }
    };
    save();
    pageCacheRef.current = {};
    setPageCache({});
    variationCacheRef.current = {};
    setVariationCache({});
    inFlightPageRequestsRef.current = {};
    fetchingPagesRef.current.clear();
    setPage(null); // clear current page so UI shows loading until correct mushaf page is fetched
    setLoading(true);
  }, [mushafId]);

  // Cleanup effect: ensure drawer is in valid state when tab changes or component unmounts
  useEffect(() => {
    if (currentTab !== "Recite") {
      if (isDrawerVisible) closeDrawer();
      if (isVariationsSidebarOpen) closeVariationsSidebar();
    }
  }, [currentTab]);

  // Aggressive check to ensure drawer is ALWAYS in valid state - NEVER allow intermediate states
  useEffect(() => {
    const checkInterval = setInterval(() => {
      // Don't check during animations or dragging
      if (isAnimatingDrawerRef.current || isDraggingDrawerRef.current) {
        return;
      }
      
      if (isDrawerVisible && currentTab === "Recite") {
        const currentValue = drawerAnim._value;
        // If drawer is visible but NOT fully open (value != 0), close it immediately
        if (currentValue !== 0 && currentValue > -DRAWER_WIDTH) {
          // Drawer is in invalid state - force close immediately
          console.warn("Drawer in invalid state, forcing close:", currentValue);
          drawerAnim.setValue(-DRAWER_WIDTH);
          drawerBottomNavAnim.setValue(DRAWER_BOTTOM_NAV_SLIDE);
          backdropAnim.setValue(0);
          setIsDrawerVisible(false);
          setIsDrawerFullyOpen(false);
        } else if (currentValue === 0) {
          // Drawer is fully open
          setIsDrawerFullyOpen(true);
          drawerBottomNavAnim.setValue(0);
        }
      } else if (!isDrawerVisible && currentTab === "Recite") {
        // If drawer should be invisible, ensure it's fully closed
        const currentValue = drawerAnim._value;
        if (currentValue > -DRAWER_WIDTH) {
          drawerAnim.setValue(-DRAWER_WIDTH);
          drawerBottomNavAnim.setValue(0);
          backdropAnim.setValue(0);
        }
        setIsDrawerFullyOpen(false);
      }
    }, 100); // Check every 100ms - very aggressive

    return () => clearInterval(checkInterval);
  }, [isDrawerVisible, currentTab]);

  // Additional safeguard: monitor drawer animation value
  useEffect(() => {
    const listener = drawerAnim.addListener(({ value }) => {
      // Don't interfere during animations or dragging
      if (isAnimatingDrawerRef.current || isDraggingDrawerRef.current) {
        return;
      }
      
      // If drawer is supposed to be visible but not fully open, fix it
      if (isDrawerVisible && value !== 0 && value > -DRAWER_WIDTH) {
        // Force to valid state immediately
        if (value > -DRAWER_WIDTH * 0.5) {
          // More than halfway, snap to open
          drawerAnim.setValue(0);
          drawerBottomNavAnim.setValue(0);
          backdropAnim.setValue(1);
          setIsDrawerFullyOpen(true);
        } else {
          // Less than halfway, snap to closed
          drawerAnim.setValue(-DRAWER_WIDTH);
          drawerBottomNavAnim.setValue(DRAWER_BOTTOM_NAV_SLIDE);
          backdropAnim.setValue(0);
          setIsDrawerVisible(false);
          setIsDrawerFullyOpen(false);
        }
      }
    });

    return () => {
      drawerAnim.removeListener(listener);
    };
  }, [isDrawerVisible]);

  // Helper function to ensure drawer is in a valid state (fully open or fully closed)
  const ensureDrawerValidState = () => {
    const currentValue = drawerAnim._value;
    const threshold = DRAWER_WIDTH * 0.3; // 30% threshold
    
    // If drawer is in an intermediate state, snap it to nearest valid state
    if (currentValue > -threshold && currentValue < 0) {
      // More than 30% open, snap to fully open
      Animated.parallel([
        Animated.spring(drawerAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 300,
        }),
        Animated.spring(drawerBottomNavAnim, {
          toValue: 0,
          useNativeDriver: true,
          damping: 20,
          stiffness: 300,
        }),
      ]).start(() => {
        Animated.timing(backdropAnim, {
          toValue: 1,
          duration: 200,
          easing: Easing.out(Easing.ease),
          useNativeDriver: true,
        }).start();
      });
    } else if (currentValue <= -threshold && currentValue > -DRAWER_WIDTH) {
      // Less than 30% open, snap to fully closed
      closeDrawer();
    }
  };

  // Swipe gesture for opening drawer from left edge (only on Recite tab)
  // This gesture follows the finger like iOS Notes app - optimized for responsiveness
  const drawerSwipeGesture = useRef(
    Gesture.Pan()
      .activeOffsetX([-5, 100]) // Very low threshold for rightward movement, allow left for closing
      .failOffsetY([-20, 20]) // Fail if too much vertical movement
      .minDistance(3) // Very low minimum distance for instant activation
      .onBegin((event) => {
        const startX = event.x;
        const isDrawerOpen = isDrawerVisibleRef.current;
        
        // Check if we should activate this gesture
        if (currentTabRef.current !== "Recite") {
          return;
        }
        
        // If drawer is closed, only activate from left edge (within 20px)
        if (!isDrawerOpen && startX > 20) {
          return; // Don't activate - let page swipe handle it
        }
        
        // Start dragging
        isDraggingDrawerRef.current = true;
        drawerStartValueRef.current = drawerAnim._value;
        
        if (!isDrawerOpen) {
          backdropAnim.setValue(0);
          setIsDrawerVisible(true);
          isDrawerVisibleRef.current = true;
          drawerBottomNavAnim.setValue(DRAWER_BOTTOM_NAV_SLIDE);
        }
      })
      .onUpdate((event) => {
        if (!isDraggingDrawerRef.current) return;
        
        // Update drawer position in real-time following finger
        const newValue = Math.max(
          -DRAWER_WIDTH,
          Math.min(0, drawerStartValueRef.current + event.translationX)
        );
        drawerAnim.setValue(newValue);
        const openT = (newValue + DRAWER_WIDTH) / DRAWER_WIDTH;
        drawerBottomNavAnim.setValue(
          DRAWER_BOTTOM_NAV_SLIDE * (1 - Math.max(0, Math.min(1, openT)))
        );
      })
      .onEnd((event) => {
        const wasDragging = isDraggingDrawerRef.current;
        isDraggingDrawerRef.current = false;
        
        if (!wasDragging) {
          // Force close if not dragging
          closeDrawer();
          return;
        }
        
        const currentValue = drawerAnim._value;
        const swipeThreshold = DRAWER_WIDTH * 0.4; // 40% of drawer width
        const velocity = event.velocityX;
        const startX = event.x - event.translationX;
        const wasDrawerOpen = drawerStartValueRef.current > -DRAWER_WIDTH * 0.5;
        
        // If drawer was closed and didn't start from left edge, close it
        if (!wasDrawerOpen && startX > 20) {
          closeDrawer();
          return;
        }
        
        // Determine if we should open or close based on:
        // 1. Current position (more than 40% open = stay open)
        // 2. Swipe velocity (fast right swipe = open, fast left swipe = close)
        const shouldOpen = 
          (currentValue > -swipeThreshold && velocity > -300) || 
          (velocity > 500 && event.translationX > 0);
        
        if (shouldOpen) {
          // Animate to fully open - MUST reach 0 (bottom nav rises in parallel)
          Animated.parallel([
            Animated.spring(drawerAnim, {
              toValue: 0,
              useNativeDriver: true,
              damping: 20,
              stiffness: 300,
            }),
            Animated.spring(drawerBottomNavAnim, {
              toValue: 0,
              useNativeDriver: true,
              damping: 20,
              stiffness: 300,
            }),
          ]).start(({ finished }) => {
            if (finished) {
              drawerAnim.setValue(0);
              drawerBottomNavAnim.setValue(0);
              setIsDrawerFullyOpen(true);
              Animated.timing(backdropAnim, {
                toValue: 1,
                duration: 200,
                easing: Easing.out(Easing.ease),
                useNativeDriver: true,
              }).start();
            }
          });
        } else {
          // Animate to closed - MUST reach -DRAWER_WIDTH
          closeDrawer();
        }
      })
      .onFinalize(() => {
        isDraggingDrawerRef.current = false;
        // Immediately ensure valid state
        setTimeout(() => {
          const currentValue = drawerAnim._value;
          if (currentValue !== 0 && currentValue !== -DRAWER_WIDTH) {
            // Invalid state - force to nearest valid state
            if (currentValue > -DRAWER_WIDTH * 0.5) {
              drawerAnim.setValue(0);
              drawerBottomNavAnim.setValue(0);
              backdropAnim.setValue(1);
            } else {
              drawerAnim.setValue(-DRAWER_WIDTH);
              drawerBottomNavAnim.setValue(DRAWER_BOTTOM_NAV_SLIDE);
              backdropAnim.setValue(0);
              setIsDrawerVisible(false);
              setIsDrawerFullyOpen(false);
            }
          }
        }, 50);
      })
  ).current;

  const openDrawer = () => {
    isAnimatingDrawerRef.current = true;
    setIsDrawerVisible(true);
    isDrawerVisibleRef.current = true;
    backdropAnim.setValue(0);
    drawerAnim.setValue(-DRAWER_WIDTH);
    drawerBottomNavAnim.setValue(DRAWER_BOTTOM_NAV_SLIDE);
    // Start motion after the next frame so the overlay mounts at the “fully hidden” start pose (mirrors close)
    requestAnimationFrame(() => {
      Animated.parallel([
        Animated.timing(drawerAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(drawerBottomNavAnim, {
          toValue: 0,
          duration: 200,
          easing: Easing.out(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) {
          drawerAnim.setValue(0);
          drawerBottomNavAnim.setValue(0);
          setIsDrawerFullyOpen(true);
          Animated.timing(backdropAnim, {
            toValue: 1,
            duration: 200,
            easing: Easing.out(Easing.ease),
            useNativeDriver: true,
          }).start(() => {
            isAnimatingDrawerRef.current = false;
          });
        } else {
          isAnimatingDrawerRef.current = false;
        }
      });
    });
  };

  const closeDrawer = (options) => {
    const opts =
      options && typeof options === "object" && options.nativeEvent === undefined
        ? options
        : {};
    const { animateBottomNav = true, onClosed } = opts;

    isDraggingDrawerRef.current = false;
    isAnimatingDrawerRef.current = true;
    backdropAnim.setValue(0);

    const finishClose = () => {
      drawerAnim.setValue(-DRAWER_WIDTH);
      backdropAnim.setValue(0);
      isDrawerVisibleRef.current = false;
      setIsDrawerVisible(false);
      setIsDrawerFullyOpen(false);
      onClosed?.();
    };

    if (animateBottomNav) {
      Animated.parallel([
        Animated.timing(drawerAnim, {
          toValue: -DRAWER_WIDTH,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
        Animated.timing(drawerBottomNavAnim, {
          toValue: DRAWER_BOTTOM_NAV_SLIDE,
          duration: 200,
          easing: Easing.in(Easing.cubic),
          useNativeDriver: true,
        }),
      ]).start(({ finished }) => {
        if (finished) finishClose();
        isAnimatingDrawerRef.current = false;
      });
    } else {
      drawerBottomNavAnim.setValue(0);
      Animated.timing(drawerAnim, {
        toValue: -DRAWER_WIDTH,
        duration: 200,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) finishClose();
        isAnimatingDrawerRef.current = false;
      });
    }
  };

  const goToListenTabAnimated = useCallback(() => {
    if (currentTabRef.current === "Listen") return;
    const w = Dimensions.get("window").width;
    const runSlide = () => {
      tabSlideAnim.stopAnimation();
      Animated.timing(tabSlideAnim, {
        toValue: -w,
        duration: TAB_SLIDE_DURATION,
        easing: Easing.inOut(Easing.cubic),
        useNativeDriver: true,
      }).start(({ finished }) => {
        if (finished) setCurrentTab("Listen");
      });
    };
    if (!listenColumnEverMountedRef.current) {
      listenColumnEverMountedRef.current = true;
      setListenColumnMounted(true);
      requestAnimationFrame(() => requestAnimationFrame(runSlide));
    } else {
      runSlide();
    }
  }, [tabSlideAnim]);

  const goToReciteTabAnimated = useCallback(() => {
    if (currentTabRef.current === "Recite") return;
    setChromeTab("Recite");
    tabSlideAnim.stopAnimation();
    Animated.timing(tabSlideAnim, {
      toValue: 0,
      duration: TAB_SLIDE_DURATION,
      easing: Easing.inOut(Easing.cubic),
      useNativeDriver: true,
    }).start(({ finished }) => {
      if (finished) setCurrentTab("Recite");
    });
  }, [tabSlideAnim]);

  // Variations sidebar (right-sliding) - lists all narration changes for mushaf traversal
  // Fetched once in background when narrators are selected; no refetch on sidebar open
  const fetchAllVariations = useCallback(async () => {
    const narratorIds = selectedNarrators
      .filter((id) => typeof id === "number" || /^\d+$/.test(String(id)))
      .map((id) => parseInt(id, 10));
    if (narratorIds.length === 0) {
      setAllMushafVariations([]);
      return;
    }
    const params = new URLSearchParams({ mushaf_id: mushafId, narrator_ids: narratorIds.join(",") });
    const url = `${getVariationsUrl()}?${params.toString()}`;
    try {
      const response = await fetch(url);
      if (response.ok) {
        const data = await response.json();
        setAllMushafVariations(data);
      } else {
        setAllMushafVariations([]);
      }
    } catch (err) {
      console.error("Error fetching all variations:", err);
      setAllMushafVariations([]);
    }
  }, [selectedNarrators, mushafId]);

  // Fetch all variations discreetly in background when narrator selection changes
  useEffect(() => {
    if (selectedNarrators.length > 0) {
      fetchAllVariations();
    } else {
      setAllMushafVariations([]);
    }
  }, [selectedNarrators, fetchAllVariations]);

  const openVariationsSidebar = useCallback(() => {
    setIsVariationsSidebarOpen(true);
    Animated.parallel([
      Animated.timing(variationsSidebarAnim, {
        toValue: 0,
        duration: 250,
        easing: Easing.out(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(variationsSidebarBackdropAnim, {
        toValue: 1,
        duration: 250,
        easing: Easing.out(Easing.ease),
        useNativeDriver: true,
      }),
    ]).start();
  }, [variationsSidebarAnim, variationsSidebarBackdropAnim]);

  // When variations sidebar opens, scroll to selected item (if still on that page) or restore scroll position
  useEffect(() => {
    if (!isVariationsSidebarOpen || allMushafVariations.length === 0) return;
    const timer = setTimeout(() => {
      const scrollRef = variationsSidebarScrollRef.current;
      if (!scrollRef || !scrollRef.scrollTo) return;
      const shouldScrollToSelected =
        lastSelectedVariationHighlight &&
        currentPage === lastSelectedVariationHighlight.pageNum;
      if (shouldScrollToSelected) {
        const idx = allMushafVariations.findIndex(
          (v) => v.word?.id === lastSelectedVariationHighlight.wordId
        );
        if (idx >= 0) {
          const y = Math.max(0, idx * VARIATIONS_SIDEBAR_ROW_HEIGHT - 60);
          scrollRef.scrollTo({ y, animated: false });
        }
      } else {
        scrollRef.scrollTo({
          y: variationsSidebarScrollOffsetRef.current,
          animated: false,
        });
      }
    }, 100);
    return () => clearTimeout(timer);
  }, [isVariationsSidebarOpen, allMushafVariations.length, lastSelectedVariationHighlight, currentPage]);

  const closeVariationsSidebar = useCallback(() => {
    Animated.parallel([
      Animated.timing(variationsSidebarAnim, {
        toValue: VARIATIONS_SIDEBAR_WIDTH,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
      Animated.timing(variationsSidebarBackdropAnim, {
        toValue: 0,
        duration: 220,
        easing: Easing.in(Easing.cubic),
        useNativeDriver: true,
      }),
    ]).start((finished) => {
      if (finished) {
        variationsSidebarAnim.setValue(VARIATIONS_SIDEBAR_WIDTH);
        variationsSidebarBackdropAnim.setValue(0);
        setIsVariationsSidebarOpen(false);
      }
    });
  }, [variationsSidebarAnim, variationsSidebarBackdropAnim]);

  const syncPagerToPage = (pageNum, animated = true) => {
    if (!pagerRef.current) return;
    const clampedPage = Math.min(Math.max(pageNum, 1), totalPages);
    // RTL: index 0 is last page, index totalPages - 1 is first page
    const index = totalPages - clampedPage;
    pagerSelectSuppressedRef.current = true;
    try {
      if (animated && typeof pagerRef.current.setPage === "function") {
        pagerRef.current.setPage(index);
      } else if (typeof pagerRef.current.setPageWithoutAnimation === "function") {
        pagerRef.current.setPageWithoutAnimation(index);
      } else if (typeof pagerRef.current.setPage === "function") {
        pagerRef.current.setPage(index);
      }
    } catch (e) {
      // Ignore pager sync errors
    } finally {
      requestAnimationFrame(() => {
        requestAnimationFrame(() => {
          pagerSelectSuppressedRef.current = false;
        });
      });
    }
  };

  // When API returns real `totalPages`, the pager child count changes; native view often emits
  // `onPageSelected` at index 0 (= last mushaf page in RTL) before respecting `initialPage` — re-sync.
  useLayoutEffect(() => {
    if (totalPages < 1) return;
    syncPagerToPage(currentPageRef.current, false);
  }, [totalPages]);

  // Function to fetch a single page and cache it
  const fetchAndCachePage = async (pageNum, showLoading = false, force = false) => {
    const requestedMushafId = mushafId;
    // Check ref cache first (synchronous access)
    if (!force && pageCacheRef.current[pageNum]) {
      const cached = pageCacheRef.current[pageNum];
      if (pageNum === currentPageRef.current) {
        setPage(cached);
        setLoading(false);
      }
      return cached;
    }

    // If a request is already in flight for this page, await that same request.
    // This avoids a race where foreground loading waits forever while prefetch owns the fetch.
    const inFlight = inFlightPageRequestsRef.current[pageNum];
    if (inFlight) {
      return inFlight;
    }

    fetchingPagesRef.current.add(pageNum);
    const requestPromise = (async () => {
      try {
        const response = await fetch(`${getApiBase()}/api/mushafs/${mushafId}/pages/${pageNum}`);
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        if (!data || typeof data !== "object" || !data.id) {
          throw new Error(`Invalid page payload for mushaf ${mushafId} page ${pageNum}`);
        }
        if (Array.isArray(data.lines)) {
          data.lines.sort((a, b) => Number(a.position) - Number(b.position));
        }

        if (requestedMushafId !== mushafIdRef.current) {
          return null;
        }

        // Cache the page in both ref and state
        pageCacheRef.current[pageNum] = data;
        setPageCache((prev) => ({
          ...prev,
          [pageNum]: data,
        }));

        // If this is currently visible, always stop loading once data arrives.
        if (pageNum === currentPageRef.current) {
          setPage(data);
          setLoading(false);
        }

        return data;
      } catch (err) {
        // Only log errors for current page or if it's a CORS error on web
        const isCorsError = err.message.includes("Failed to fetch") || err.message.includes("CORS");
        const isCurrentPage = pageNum === currentPageRef.current;

        if (isCurrentPage || (isCorsError && Platform.OS === "web")) {
          const errorMessage =
            isCorsError && Platform.OS === "web"
              ? "Could not reach the API from the browser (often a CORS block). On Vercel, requests should go to /api on the same site. On Expo web at localhost, the API must allow your origin in Rails CORS."
              : err.message;

          if (isCurrentPage) {
            console.error(`Error fetching page ${pageNum}:`, err);
            setError(errorMessage);
            setLoading(false);
          } else if (isCorsError && Platform.OS === "web") {
            // Prefetch failures on web (e.g. CORS) — avoid spamming the UI
          }
        }
        return null;
      } finally {
        fetchingPagesRef.current.delete(pageNum);
        delete inFlightPageRequestsRef.current[pageNum];
      }
    })();

    inFlightPageRequestsRef.current[pageNum] = requestPromise;
    return requestPromise;
  };

  // Mushaf 2: fetch juz rows from persisted MushafSegment API; otherwise fallback to local segments JSON.
  useEffect(() => {
    if (mushafId !== 2) {
      setMushafJuzSegmentsApi(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/mushafs/${mushafId}/segments?category=juz`);
        const data = res.ok ? await res.json() : {};
        const rows = Array.isArray(data.segments) ? data.segments : [];
        const normalized = rows.map((s) => ({
          pk: `api-juz-${s.id}`,
          fields: {
            first_page: s.start_page,
            last_page: s.end_page,
            title: s.title || "",
            category: "juz",
            category_position: s.category_position,
          },
        }));
        if (!cancelled) setMushafJuzSegmentsApi(normalized.length > 0 ? normalized : null);
      } catch (_) {
        if (!cancelled) setMushafJuzSegmentsApi(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mushafId]);

  // Mushaf 2: surah rows for header-insert picker from persisted MushafSegment API.
  useEffect(() => {
    if (mushafId !== 2) {
      setMushafSurahSegmentsApi(null);
      return;
    }
    let cancelled = false;
    (async () => {
      try {
        const res = await fetch(`${getApiBase()}/api/mushafs/${mushafId}/segments?category=surah`);
        const data = res.ok ? await res.json() : {};
        const rows = Array.isArray(data.segments) ? data.segments : [];
        const normalized = rows.map((s) => ({
          pk: `api-surah-${s.id}`,
          fields: {
            first_page: s.start_page,
            last_page: s.end_page,
            title: s.title || "",
            category: "surah",
            category_position: s.category_position,
          },
        }));
        if (!cancelled) setMushafSurahSegmentsApi(normalized.length > 0 ? normalized : null);
      } catch (_) {
        if (!cancelled) setMushafSurahSegmentsApi(null);
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mushafId]);

  // Surah banner markers for Go → Page chips (all mushafs; returns empty map where unsupported).
  useEffect(() => {
    let cancelled = false;
    setSurahHeaderMarkersByPage(null);
    (async () => {
      try {
        const res = await fetch(
          `${getApiBase()}/api/mushafs/${mushafId}/surah_header_markers`
        );
        const data = res.ok ? await res.json() : {};
        if (!cancelled) {
          setSurahHeaderMarkersByPage(
            data.by_page && typeof data.by_page === "object" ? data.by_page : {}
          );
        }
      } catch (_) {
        if (!cancelled) setSurahHeaderMarkersByPage({});
      }
    })();
    return () => {
      cancelled = true;
    };
  }, [mushafId, surahHeaderMarkersTick]);

  const openHeaderInsertLine = (insertAtPosition) => {
    if (mushafId !== 2 || !FEATURE_FLAGS.mushaf2HeaderInsert) return;
    const pageNum = currentPageRef.current;
    const base = pageCacheRef.current[pageNum];
    if (!base?.lines?.length) return;
    const hp = headerPreviewRef.current;
    const prevOps =
      hp?.pageNum === pageNum && Array.isArray(hp.operations) ? hp.operations : [];
    const effectivePage =
      prevOps.length > 0 ? mergeSurahHeaderPreviewChain(base, prevOps) : base;
    const sorted = [...effectivePage.lines].sort((a, b) => a.position - b.position);
    const room = MUSHAF_2_MAX_PAGE_LINES - sorted.length;
    if (room < 1) {
      Alert.alert(
        "Cannot insert",
        "Adding another header would exceed 13 lines on this page (or the page is already full)."
      );
      return;
    }
    pendingHeaderInsertAtRef.current = insertAtPosition;
    pendingHeaderPickPageRef.current = pageNum;
    setSurahPickerVisible(true);
  };

  const confirmSurahForHeaderInsert = (surahNumber) => {
    setSurahPickerVisible(false);
    const insertAt = pendingHeaderInsertAtRef.current;
    const pageNum = pendingHeaderPickPageRef.current;
    pendingHeaderInsertAtRef.current = null;
    pendingHeaderPickPageRef.current = null;
    if (insertAt == null || pageNum == null) return;
    const base = pageCacheRef.current[pageNum];
    if (!base?.lines?.length) return;

    setHeaderPreview((prev) => {
      const prevOps =
        prev?.pageNum === pageNum && Array.isArray(prev.operations)
          ? prev.operations
          : [];
      const mergedSoFar =
        prevOps.length > 0 ? mergeSurahHeaderPreviewChain(base, prevOps) : base;
      const count = mergedSoFar.lines.length;
      const room = MUSHAF_2_MAX_PAGE_LINES - count;
      if (room < 1) {
        setTimeout(() =>
          Alert.alert(
            "Cannot insert",
            "Adding this header would exceed 13 lines on the page."
          ),
          0
        );
        return prev;
      }
      const useBasmala = room >= 2;
      return {
        pageNum,
        operations: [
          ...prevOps,
          { insertAtPosition: insertAt, surahNumber, useBasmala },
        ],
      };
    });
  };

  const toggleHeaderInsertMode = () => {
    if (headerInsertMode) {
      setHeaderInsertMode(false);
      setHeaderPreview(null);
      setSurahPickerVisible(false);
      pendingHeaderInsertAtRef.current = null;
      pendingHeaderPickPageRef.current = null;
      return;
    }
    setHeaderInsertMode(true);
  };

  const saveHeaderInsert = async () => {
    const ops = headerPreview?.operations;
    if (!ops?.length || mushafId !== 2) return;
    const { pageNum } = headerPreview;
    try {
      for (let i = 0; i < ops.length; i++) {
        const { insertAtPosition, surahNumber } = ops[i];
        const res = await fetch(
          `${getApiBase()}/api/mushafs/${mushafId}/pages/${pageNum}/insert_surah_header`,
          {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({
              insert_at_position: insertAtPosition,
              surah_number: surahNumber,
            }),
          }
        );
        let body = {};
        try {
          body = await res.json();
        } catch (_) {
          /* ignore */
        }
        if (!res.ok) {
          Alert.alert(
            "Save failed",
            body.error || `HTTP ${res.status} (after ${i} header(s) saved)`
          );
          delete pageCacheRef.current[pageNum];
          setPageCache((p) => {
            const next = { ...p };
            delete next[pageNum];
            return next;
          });
          await fetchAndCachePage(pageNum, false, true);
          setHeaderPreview(null);
          return;
        }
        delete pageCacheRef.current[pageNum];
        setPageCache((prev) => {
          const next = { ...prev };
          delete next[pageNum];
          return next;
        });
        await fetchAndCachePage(pageNum, false, true);
      }
      setHeaderPreview(null);
      setSurahHeaderMarkersTick((t) => t + 1);
      setHeaderInsertMode(false);
      setSurahPickerVisible(false);
      pendingHeaderInsertAtRef.current = null;
      pendingHeaderPickPageRef.current = null;
    } catch (e) {
      Alert.alert("Save failed", e.message);
      try {
        delete pageCacheRef.current[pageNum];
        setPageCache((p) => {
          const next = { ...p };
          delete next[pageNum];
          return next;
        });
        await fetchAndCachePage(pageNum, false, true);
      } catch (_) {
        /* ignore */
      }
      setHeaderPreview(null);
    }
  };

  // Function to fetch variations for a page
  const fetchVariationsForPage = async (pageData, pageNum, isBackground = false) => {
    if (!pageData || !pageData.lines) return;

    try {
      const wordIds = pageData.lines.flatMap((line) =>
        line.words.map((word) => word.id)
      );

      if (wordIds.length > 0) {
        const response = await fetch(
          `${getVariationsUrl()}?word_ids=${wordIds.join(",")}`
        );
        if (response.ok) {
          const variations = await response.json();

          // Convert variations to the format expected by the UI
          const variationsMap = {};
          const savedKeys = [];

          variations.forEach((variation) => {
            const key = `${variation.word_id}-${variation.narrator_id}`;
            const sc = variation.special_characters;
            const imalah = sc?.imalah ?? sc?.["imalah"];
            const diamond = sc?.diamond ?? sc?.["diamond"];
            const hasOverlays = sc && (imalah || diamond);
            variationsMap[key] = hasOverlays
              ? { content: variation.content, imalah: imalah || null, diamond: diamond || null }
              : variation.content;
            savedKeys.push(key);
          });

          // Cache variations for this page in both ref and state
          const cacheData = { variationsMap, savedKeys };
          variationCacheRef.current[pageNum] = cacheData;
          setVariationCache((prev) => ({
            ...prev,
            [pageNum]: cacheData,
          }));

          if (pageNum === currentPage) {
            setAllVariations((prev) => {
              const next = { ...prev };
              Object.keys(variationsMap).forEach((key) => {
                next[key] = variationsMap[key];
              });
              return next;
            });
            setSavedVariations(savedKeys);
          }
        }
      }
    } catch (err) {
      console.error(`Error fetching variations for page ${pageNum}:`, err);
    }
  };

  // Pre-fetch pages around current page
  const preFetchPages = (centerPage) => {
    const pagesToFetch = [];
    for (let i = Math.max(1, centerPage - 5); i <= centerPage + 5; i++) {
      if (!pageCacheRef.current[i] && !fetchingPagesRef.current.has(i)) {
        pagesToFetch.push(i);
      }
    }

    // Fetch all pages in parallel
    pagesToFetch.forEach((pageNum) => {
      fetchAndCachePage(pageNum, false);
    });
  };

  // Main effect: handle page changes with caching
  useEffect(() => {
    // Check if page is in ref cache (synchronous check)
    const cachedPage = pageCacheRef.current[currentPage];
    if (cachedPage) {
      // Page is cached, show it immediately
      setPage(cachedPage);
      setLoading(false);
      
      // Check if we have cached variations
      const cachedVariations = variationCacheRef.current[currentPage];
      if (cachedVariations) {
        setAllVariations((prev) => {
          const next = { ...prev };
          Object.keys(cachedVariations.variationsMap).forEach((key) => {
            next[key] = cachedVariations.variationsMap[key];
          });
          return next;
        });
        setSavedVariations(cachedVariations.savedKeys);
      } else if (selectedNarrators.length > 0) {
        // If narrators are selected, do background refresh of variations
        fetchVariationsForPage(cachedPage, currentPage, true);
      }
    } else {
      // Page not in cache, fetch it with loading indicator
      setLoading(true);
      fetchAndCachePage(currentPage, true).then((data) => {
        // After fetching, get variations if narrators are selected
        if (selectedNarrators.length > 0 && data) {
          fetchVariationsForPage(data, currentPage, false);
        }
      });
    }

    // Load next and previous pages for train effect
    const nextPageNum = currentPage + 1;
    const prevPageNum = currentPage - 1;
    
    // Load next page
    const cachedNext = pageCacheRef.current[nextPageNum];
    if (cachedNext) {
      setNextPage(cachedNext);
    } else {
      fetchAndCachePage(nextPageNum, false).then((data) => {
        if (data) setNextPage(data);
      });
    }
    
    // Load previous page
    if (prevPageNum >= 1) {
      const cachedPrev = pageCacheRef.current[prevPageNum];
      if (cachedPrev) {
        setPreviousPage(cachedPrev);
      } else {
        fetchAndCachePage(prevPageNum, false).then((data) => {
          if (data) setPreviousPage(data);
        });
      }
    } else {
      setPreviousPage(null);
    }

    // Pre-fetch surrounding pages
    preFetchPages(currentPage);
  }, [currentPage, mushafId]);

  // Background refresh variations when narrators change (if on a cached page)
  useEffect(() => {
    const cachedPage = pageCacheRef.current[currentPage];
    if (cachedPage && selectedNarrators.length > 0) {
      // Always refresh variations when narrators change (they might have new selections)
      fetchVariationsForPage(cachedPage, currentPage, true);
    }
  }, [selectedNarrators, currentPage]);

  // Variations on current page for first selected narrator (for bottom traversal bar)
  const firstSelectedNarratorId = selectedNarrators.find((id) => id !== "hafs-an-asim") ?? null;
  const firstNarratorTitle = useMemo(() => {
    if (!firstSelectedNarratorId) return "";
    for (const parent of parentNarrators) {
      const child = parent.children.find((c) => c.id === firstSelectedNarratorId);
      if (child) return child.title ?? "";
    }
    return "";
  }, [firstSelectedNarratorId, parentNarrators]);
  const isShubahHighlight = useMemo(() => {
    if (!firstNarratorTitle) return false;
    return /shu'?bah/i.test(firstNarratorTitle);
  }, [firstNarratorTitle]);
  const currentSurahNumber =
    goToPageSurahCarouselEntries[currentSurahIndex]?.surahNumber ?? null;
  const shubahBottomPlayRef = useRef(null);
  const shubahHasTimestamp = useMemo(() => {
    if (!isShubahHighlight || !currentSurahNumber || !selectedWord) return false;
    const lineWords = Array.isArray(selectedWord.lineWords)
      ? selectedWord.lineWords
      : [];
    const wordText = selectedWord.content;
    if (!wordText) return false;
    const idx =
      lineWords.findIndex((w) => w.id === selectedWord.id) >= 0
        ? lineWords.findIndex((w) => w.id === selectedWord.id)
        : selectedWord.position ?? null;
    const contextSequence =
      idx !== null && idx >= 0
        ? [
            lineWords[idx - 1]?.content,
            wordText,
            lineWords[idx + 1]?.content,
          ].filter(Boolean)
        : [wordText].filter(Boolean);
    try {
      const segment = getWordSegmentForText(currentSurahNumber, wordText, {
        contextSequence,
      });
      return (
        !!segment &&
        typeof segment.start === "number" &&
        typeof segment.end === "number"
      );
    } catch (e) {
      return false;
    }
  }, [isShubahHighlight, currentSurahNumber, selectedWord]);

  // Bar visibility from sheet position: hide when sheet >10% up, show when sheet <90% down (interpolated from sheet translateY)
  // inputRange must be ascending: translateY goes from 0 (expanded) to TRANSLATE_MINIMIZED (minimized)
  const barVisibleStyle = sheetTranslateY
    ? {
        opacity: sheetTranslateY.interpolate({
          inputRange: [
            0,
            0.85 * TRANSLATE_MINIMIZED,
            0.95 * TRANSLATE_MINIMIZED,
            TRANSLATE_MINIMIZED,
          ],
          outputRange: [0, 0, 1, 1],
        }),
        transform: [
          {
            translateY: sheetTranslateY.interpolate({
              inputRange: [
                0,
                0.85 * TRANSLATE_MINIMIZED,
                0.95 * TRANSLATE_MINIMIZED,
                TRANSLATE_MINIMIZED,
              ],
              outputRange: [60, 60, 0, 0],
            }),
          },
        ],
      }
    : { opacity: 1, transform: [{ translateY: 0 }] };

  // Ensure variations bottom sheet defaults open whenever a non-Hafs narrator is selected
  useEffect(() => {
    if (firstSelectedNarratorId && allMushafVariations.length > 0) {
      setIsVariationBottomSheetVisible(true);
    } else {
      setIsVariationBottomSheetVisible(false);
    }
  }, [firstSelectedNarratorId, allMushafVariations.length]);

  // All variations for first narrator (full mushaf) - used for traversal
  const narratorVariations = useMemo(() => {
    if (!firstSelectedNarratorId || allMushafVariations.length === 0) return [];
    const narratorId =
      typeof firstSelectedNarratorId === "number"
        ? firstSelectedNarratorId
        : parseInt(firstSelectedNarratorId, 10);
    const validId = !isNaN(narratorId) ? narratorId : firstSelectedNarratorId;
    return allMushafVariations.filter(
      (v) =>
        v.narrator_id === validId ||
        v.narrator?.id === validId ||
        String(v.narrator_id) === String(firstSelectedNarratorId) ||
        String(v.narrator?.id) === String(firstSelectedNarratorId)
    );
  }, [allMushafVariations, firstSelectedNarratorId]);

  /** Per mushaf page: word ids with a narration change AND a confirmed playable verse-segment lookup */
  const variationListenBadgeWordIdsByPage = useMemo(() => {
    if (!FEATURE_FLAGS.variationWordListenBadge || !firstSelectedNarratorId) return null;
    const map = {};
    for (const v of narratorVariations) {
      const pos = v.word?.line?.page?.position;
      const wid = v.word?.id;
      if (pos == null || wid == null) continue;
      const idStr = String(wid);
      if (comparisonSegmentPlayableByWordId[idStr] !== true) continue;
      const pageKey = Number(pos);
      if (!Number.isFinite(pageKey)) continue;
      if (!map[pageKey]) map[pageKey] = new Set();
      map[pageKey].add(idStr);
    }
    return Object.keys(map).length > 0 ? map : null;
  }, [narratorVariations, firstSelectedNarratorId, comparisonSegmentPlayableByWordId]);

  /** Hafs / narrator chips in the bottom traversal bar: show same volume badge as mushaf words */
  const showTraversalBarListenBadges = useMemo(
    () =>
      FEATURE_FLAGS.variationWordListenBadge &&
      !!firstSelectedNarratorId &&
      narratorVariations.length > 0,
    [firstSelectedNarratorId, narratorVariations.length]
  );

  useEffect(() => {
    setComparisonSegmentPlayableByWordId({});
  }, [firstSelectedNarratorId, mushafId]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => {
      if (state === "active") setSegmentPrefetchResumeTick((n) => n + 1);
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    if (!FEATURE_FLAGS.variationWordListenBadge || !firstSelectedNarratorId) return;
    const compSlug = recitationNarratorSlugForMushafNarratorId(
      firstSelectedNarratorId,
      parentNarrators
    );
    const onPage = narratorVariations.filter(
      (v) => (v.word?.line?.page?.position ?? 0) === currentPage
    );
    if (onPage.length === 0) return;

    const gen = ++comparisonSegmentPrefetchGenRef.current;
    let cancelled = false;

    const ayahToWordIds = new Map();
    for (const v of onPage) {
      const wid = v.word?.id;
      if (wid == null) continue;
      const ayah = normalizeAyahLabelForListen(v.word?.ayah);
      if (!ayah || !ayah.includes(":")) continue;
      const idStr = String(wid);
      if (!ayahToWordIds.has(ayah)) ayahToWordIds.set(ayah, []);
      ayahToWordIds.get(ayah).push(idStr);
    }

    setComparisonSegmentPlayableByWordId((prev) => {
      const next = { ...prev };
      for (const v of onPage) {
        if (v.word?.id == null) continue;
        const idStr = String(v.word.id);
        const ayah = normalizeAyahLabelForListen(v.word?.ayah);
        if (!ayah || !ayah.includes(":")) next[idStr] = false;
      }
      return next;
    });

    if (!compSlug) {
      setComparisonSegmentPlayableByWordId((prev) => {
        const next = { ...prev };
        for (const v of onPage) {
          if (v.word?.id != null) next[String(v.word.id)] = false;
        }
        return next;
      });
      return;
    }

    if (ayahToWordIds.size === 0) {
      setComparisonSegmentPlayableByWordId((prev) => {
        const next = { ...prev };
        for (const v of onPage) {
          if (v.word?.id != null) next[String(v.word.id)] = false;
        }
        return next;
      });
      return;
    }

    (async () => {
      const entries = Array.from(ayahToWordIds.entries());
      const batchSize = 5;
      for (let i = 0; i < entries.length; i += batchSize) {
        if (cancelled || gen !== comparisonSegmentPrefetchGenRef.current) return;
        const batch = entries.slice(i, i + batchSize);
        await Promise.all(
          batch.map(async ([ayah, wordIds]) => {
            const ok = await fetchRecitationVerseSegmentPlayable(ayah, compSlug);
            if (cancelled || gen !== comparisonSegmentPrefetchGenRef.current) return;
            setComparisonSegmentPlayableByWordId((prev) => {
              const next = { ...prev };
              for (const wid of wordIds) next[wid] = ok;
              return next;
            });
          })
        );
      }
    })();

    return () => {
      cancelled = true;
    };
  }, [
    currentPage,
    firstSelectedNarratorId,
    narratorVariations,
    parentNarrators,
    segmentPrefetchResumeTick,
  ]);

  // Current variation index derived from Narration Changes active state (lastSelectedVariationHighlight)
  const currentVariationIndex = useMemo(() => {
    if (narratorVariations.length === 0) return 0;
    if (lastSelectedVariationHighlight) {
      const idx = narratorVariations.findIndex(
        (v) =>
          v.word?.id === lastSelectedVariationHighlight.wordId &&
          (v.word?.line?.page?.position ?? 0) === lastSelectedVariationHighlight.pageNum
      );
      if (idx >= 0) return idx;
    }
    // Fallback: try selectedWordId + currentPage
    if (selectedWordId) {
      const idx = narratorVariations.findIndex(
        (v) =>
          v.word?.id === selectedWordId &&
          (v.word?.line?.page?.position ?? 0) === currentPage
      );
      if (idx >= 0) return idx;
    }
    // Fallback: first variation on current page
    const idx = narratorVariations.findIndex(
      (v) => (v.word?.line?.page?.position ?? 0) === currentPage
    );
    return idx >= 0 ? idx : 0;
  }, [narratorVariations, lastSelectedVariationHighlight, selectedWordId, currentPage]);

  const currentPageVariations = useMemo(
    () =>
      narratorVariations.filter(
        (v) => (v.word?.line?.page?.position ?? 0) === currentPage
      ),
    [narratorVariations, currentPage]
  );

  /** Next/Prev difference strip — keep short so the sheet drag handle stays visible above it. */
  const showOffPageTraversalUI = useMemo(
    () =>
      !!firstSelectedNarratorId &&
      narratorVariations.length > 0 &&
      currentPageVariations.length === 0,
    [firstSelectedNarratorId, narratorVariations.length, currentPageVariations.length]
  );

  const selectedTraversalNarratorIds = useMemo(
    () => selectedNarrators.filter((id) => id !== "hafs-an-asim").slice(0, 2),
    [selectedNarrators]
  );

  const selectedTraversalNarrators = useMemo(
    () =>
      selectedTraversalNarratorIds.map((id) => {
        for (const parent of parentNarrators) {
          const child = parent.children.find((c) => c.id === id);
          if (child) {
            return {
              id,
              title: child.title || "Narrator",
              highlightColor: child.highlight_color || "#f5a623",
            };
          }
        }
        return { id, title: "Narrator", highlightColor: "#f5a623" };
      }),
    [selectedTraversalNarratorIds, parentNarrators]
  );

  /** Maps narrator id (string) to API `highlight_color` for mushaf inline comparison highlights */
  const narratorHighlightColorById = useMemo(() => {
    const map = {};
    for (const parent of parentNarrators) {
      for (const child of parent.children || []) {
        if (child?.id != null) {
          map[String(child.id)] = child.highlight_color || "#00d4ff";
        }
      }
    }
    for (const n of narrators) {
      if (n?.id == null) continue;
      const id = String(n.id);
      if (!map[id]) {
        map[id] = n.highlight_color || "#00d4ff";
      }
    }
    return map;
  }, [parentNarrators, narrators]);

  const activeTraversalVariation = narratorVariations[currentVariationIndex] ?? null;
  const activeTraversalWordId = activeTraversalVariation?.word?.id ?? null;
  const activeHafsTraversalText = activeTraversalVariation?.word?.content ?? "—";

  useEffect(() => {
    if (!FEATURE_FLAGS.variationWordListenBadge || !firstSelectedNarratorId) {
      setTraversalChipSegmentPlayable({ hafs: null, comparison: null });
      return;
    }
    const w = activeTraversalVariation?.word;
    if (!w?.id) {
      setTraversalChipSegmentPlayable({ hafs: null, comparison: null });
      return;
    }

    const gen = ++traversalSegmentPrefetchGenRef.current;
    let cancelled = false;
    const compSlug = recitationNarratorSlugForMushafNarratorId(
      firstSelectedNarratorId,
      parentNarrators
    );

    setTraversalChipSegmentPlayable({ hafs: null, comparison: null });

    (async () => {
      let ayahNorm = normalizeAyahLabelForListen(w.ayah);
      if (!ayahNorm?.includes(":")) {
        try {
          const res = await fetch(`${getApiBase()}/api/words/${w.id}`);
          if (res.ok) {
            const j = await res.json();
            ayahNorm = normalizeAyahLabelForListen(j?.ayah);
          }
        } catch {
          /* ignore */
        }
      }
      if (!ayahNorm?.includes(":")) {
        if (!cancelled && gen === traversalSegmentPrefetchGenRef.current) {
          setTraversalChipSegmentPlayable({ hafs: false, comparison: false });
        }
        return;
      }
      const [hafsOk, compOk] = await Promise.all([
        fetchRecitationVerseSegmentPlayable(ayahNorm, "hafs-an-asim"),
        compSlug
          ? fetchRecitationVerseSegmentPlayable(ayahNorm, compSlug)
          : Promise.resolve(false),
      ]);
      if (cancelled || gen !== traversalSegmentPrefetchGenRef.current) return;
      setTraversalChipSegmentPlayable({ hafs: hafsOk, comparison: compOk });
    })();

    return () => {
      cancelled = true;
    };
  }, [
    activeTraversalVariation?.word?.id,
    activeTraversalVariation?.word?.ayah,
    firstSelectedNarratorId,
    parentNarrators,
    segmentPrefetchResumeTick,
  ]);

  const traversalNarratorCards = useMemo(() => {
    return selectedTraversalNarrators.map((narrator) => {
      const narratorAll = allMushafVariations.filter(
        (v) =>
          String(v.narrator_id) === String(narrator.id) ||
          String(v.narrator?.id) === String(narrator.id)
      );

      let active = null;
      if (activeTraversalWordId != null) {
        active = narratorAll.find((v) => String(v.word?.id) === String(activeTraversalWordId)) ?? null;
      }
      if (!active) {
        active =
          narratorAll.find((v) => (v.word?.line?.page?.position ?? 0) === currentPage) ??
          narratorAll[0] ??
          null;
      }

      return {
        id: narrator.id,
        title: narrator.title,
        highlightColor: narrator.highlightColor,
        content: active?.content ?? "—",
      };
    });
  }, [selectedTraversalNarrators, allMushafVariations, activeTraversalWordId, currentPage]);

  const narratorVariationsSorted = useMemo(() => {
    const sortKey = (v) => {
      const w = v?.word;
      if (!w) return 0;
      const page = w.line?.page?.position ?? 0;
      const linePos = w.line?.position ?? w.line?.id ?? 0;
      const wpos = w.position ?? 0;
      return page * 1e9 + Number(linePos) * 1e6 + Number(wpos);
    };
    return [...narratorVariations].sort((a, b) => sortKey(a) - sortKey(b));
  }, [narratorVariations]);

  const { offPageNextVariation, offPagePrevVariation } = useMemo(() => {
    if (narratorVariationsSorted.length === 0) {
      return { offPageNextVariation: null, offPagePrevVariation: null };
    }
    const firstAfter = narratorVariationsSorted.find(
      (v) => (v.word?.line?.page?.position ?? 0) > currentPage
    );
    let nextV = firstAfter ?? narratorVariationsSorted[0];
    const lastBefore = [...narratorVariationsSorted]
      .reverse()
      .find((v) => (v.word?.line?.page?.position ?? 0) < currentPage);
    let prevV = lastBefore ?? narratorVariationsSorted[narratorVariationsSorted.length - 1];
    if (narratorVariationsSorted.length === 1) {
      nextV = prevV = narratorVariationsSorted[0];
    }
    return { offPageNextVariation: nextV, offPagePrevVariation: prevV };
  }, [narratorVariationsSorted, currentPage]);

  // When page changes (e.g. via swipe) or variations load, sync active state to first variation on current page
  useEffect(() => {
    if (currentPageVariations.length === 0) return;
    const first = currentPageVariations[0];
    if (
      !lastSelectedVariationHighlight ||
      lastSelectedVariationHighlight.pageNum !== currentPage
    ) {
      setLastSelectedVariationHighlight({
        wordId: first?.word?.id,
        pageNum: currentPage,
      });
      if (first?.word?.id) {
        setSelectedWordId(first.word.id);
        setSelectedWord({ id: first.word.id, content: first.word.content });
      }
    }
  }, [currentPage, currentPageVariations.length]);

  // Sync Juz and Surah indices with current page (array is sorted descending for RTL)
  useEffect(() => {
    // Find current Juz (array is sorted descending: highest page first)
    // Find the Juz where first_page <= currentPage <= last_page
    let juzIndex = goToPageJuzSegments.length - 1; // Default to last (lowest page)
    for (let i = 0; i < goToPageJuzSegments.length; i++) {
      const juz = goToPageJuzSegments[i];
      if (currentPage >= juz.fields.first_page && currentPage <= juz.fields.last_page) {
        juzIndex = i;
        break;
      }
      // If currentPage is less than this Juz's first_page, continue to next (lower page number)
      // If we reach the end without a match, use the last index (lowest page)
    }
    setCurrentJuzIndex(juzIndex);

    // Find current Surah (array is sorted descending: highest page first).
    // Chip ranges come from surah_header_markers (`entry.page` .. `entry.lastPage`).
    const entries = goToPageSurahCarouselEntries;
    const matchingIndices = [];
    for (let i = 0; i < entries.length; i++) {
      const entry = entries[i];
      if (currentPage >= entry.page && currentPage <= entry.lastPage) {
        matchingIndices.push(i);
      }
    }
    const pin = goModalSurahHighlightPinRef.current;
    let surahIndex = entries.length - 1;
    if (matchingIndices.length === 0) {
      surahIndex = entries.length - 1;
      goModalSurahHighlightPinRef.current = null;
    } else if (matchingIndices.length === 1) {
      surahIndex = matchingIndices[0];
      goModalSurahHighlightPinRef.current = null;
    } else {
      const pinnedIdx =
        pin != null
          ? matchingIndices.find((i) => entries[i].surahNumber === pin)
          : undefined;
      if (pinnedIdx !== undefined) {
        surahIndex = pinnedIdx;
      } else {
        surahIndex = matchingIndices.reduce((best, i) =>
          entries[i].surahNumber < entries[best].surahNumber ? i : best
        );
        goModalSurahHighlightPinRef.current = null;
      }
    }
    setCurrentSurahIndex(surahIndex);
  }, [currentPage, goToPageJuzSegments, goToPageSurahCarouselEntries]);

  useEffect(() => {
    if (!showPageSlider) {
      goModalSurahHighlightPinRef.current = null;
    }
  }, [showPageSlider]);

  /** Align header-insert surah strip with the surah highlighted for this page in Go to Page (same index logic). */
  const scrollSurahHeaderPickerToGoModalSurah = useCallback(() => {
    const sc = surahHeaderPickerScrollRef.current;
    if (!sc) return;
    const surahNum = goToPageSurahCarouselEntries[currentSurahIndex]?.surahNumber;
    if (typeof surahNum !== "number" || surahNum < 1 || surahNum > 114) return;
    const viewport =
      surahHeaderPickerViewWidthRef.current || Dimensions.get("window").width - 48;
    const stride = SURAH_HEADER_PICKER_CHIP_W + SURAH_HEADER_PICKER_CHIP_GAP;
    const idx = headerInsertSurahPickerEntries.findIndex((e) => e.surahNumber === surahNum);
    if (idx < 0) return;
    const x = Math.max(0, idx * stride + SURAH_HEADER_PICKER_CHIP_W / 2 - viewport / 2);
    sc.scrollTo({ x, animated: true });
  }, [goToPageSurahCarouselEntries, currentSurahIndex, headerInsertSurahPickerEntries]);

  useEffect(() => {
    if (!surahPickerVisible) return;
    const t1 = setTimeout(() => scrollSurahHeaderPickerToGoModalSurah(), 60);
    const t2 = setTimeout(() => scrollSurahHeaderPickerToGoModalSurah(), 220);
    return () => {
      clearTimeout(t1);
      clearTimeout(t2);
    };
  }, [surahPickerVisible, scrollSurahHeaderPickerToGoModalSurah]);

  const scrollCarouselsToCenter = useCallback(() => {
    if (!showPageSlider) return;
    const winW = Dimensions.get("window").width * 0.7;
    const gap = 8;
    const fallbackChip = 88;

    const centerScrollXFromWidths = (widthsMap, index, viewportW) => {
      let x = 0;
      for (let j = 0; j < index; j++) {
        x += (widthsMap[j]?.width ?? fallbackChip) + gap;
      }
      const w = widthsMap[index]?.width ?? fallbackChip;
      return Math.max(0, x + w / 2 - viewportW / 2);
    };

    const juzWidth = juzCarouselWidthRef.current || winW;
    if (
      juzScrollViewRef.current &&
      currentJuzIndex >= 0 &&
      currentJuzIndex < goToPageJuzSegments.length
    ) {
      const scrollX = centerScrollXFromWidths(juzItemWidthsRef.current, currentJuzIndex, juzWidth);
      juzScrollViewRef.current.scrollTo({ x: scrollX, animated: true });
    }

    const surahWidth = surahCarouselWidthRef.current || winW;
    if (
      surahScrollViewRef.current &&
      activeSurahCarouselRowIndex >= 0 &&
      activeSurahCarouselRowIndex < goToPageSurahCarouselFiltered.length
    ) {
      const scrollX = centerScrollXFromWidths(
        surahItemWidthsRef.current,
        activeSurahCarouselRowIndex,
        surahWidth
      );
      surahScrollViewRef.current.scrollTo({ x: scrollX, animated: true });
    }
  }, [
    showPageSlider,
    currentJuzIndex,
    activeSurahCarouselRowIndex,
    goToPageJuzSegments.length,
    goToPageSurahCarouselFiltered.length,
  ]);

  const scheduleCarouselScrollToCenter = useCallback(() => {
    if (carouselCenterDebounceRef.current) clearTimeout(carouselCenterDebounceRef.current);
    carouselCenterDebounceRef.current = setTimeout(() => {
      carouselCenterDebounceRef.current = null;
      scrollCarouselsToCenter();
    }, 48);
  }, [scrollCarouselsToCenter]);

  // Scroll carousels when modal opens or selection changes
  useEffect(() => {
    if (showPageSlider) {
      setSliderValue(currentPage);
      setGoPageField(String(currentPage));
      const timer = setTimeout(scrollCarouselsToCenter, 150);
      return () => clearTimeout(timer);
    }
  }, [
    showPageSlider,
    currentPage,
    currentJuzIndex,
    currentSurahIndex,
    goPageSurahSearchNorm,
    activeSurahCarouselRowIndex,
    scrollCarouselsToCenter,
  ]);

  useEffect(() => {
    if (!showPageSlider) {
      setGoPageSurahSearch("");
      juzItemWidthsRef.current = {};
      surahItemWidthsRef.current = {};
      if (carouselCenterDebounceRef.current) {
        clearTimeout(carouselCenterDebounceRef.current);
        carouselCenterDebounceRef.current = null;
      }
    }
  }, [showPageSlider]);

  // Expose a reusable refresher for variations (used after save/delete)
  const refreshVariations = async () => {
    try {
      if (page && page.lines) {
        const wordIds = page.lines.flatMap((line) =>
          line.words.map((word) => word.id)
        );
        if (wordIds.length > 0) {
          const response = await fetch(
            `${getVariationsUrl()}?word_ids=${wordIds.join(",")}`
          );
if (response.ok) {
            const variations = await response.json();
            const variationsMap = {};
            const savedKeys = [];
            variations.forEach((variation) => {
              const key = `${variation.word_id}-${variation.narrator_id}`;
              const sc = variation.special_characters;
              const imalah = sc?.imalah ?? sc?.["imalah"];
              const diamond = sc?.diamond ?? sc?.["diamond"];
              const hasOverlays = sc && (imalah || diamond);
              variationsMap[key] = hasOverlays
                ? { content: variation.content, imalah: imalah || null, diamond: diamond || null }
                : variation.content;
              savedKeys.push(key);
            });
            setAllVariations((prev) => {
              const next = { ...prev };
              Object.keys(variationsMap).forEach((key) => {
                next[key] = variationsMap[key];
              });
              return next;
            });
            setSavedVariations(savedKeys);

            // Update cache for current page in both ref and state
            const cacheData = { variationsMap, savedKeys };
            variationCacheRef.current[currentPage] = cacheData;
            setVariationCache((prev) => ({
              ...prev,
              [currentPage]: cacheData,
            }));
          }
        }
      }
    } catch (err) {
      console.error("Error refreshing variations:", err);
    }
  };

  useEffect(() => {
    const fetchNarrators = async () => {
      try {
        const response = await fetch(getNarratorsUrl());
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }
        const data = await response.json();
        
        // Create synthetic "Hafs 'an 'Asim" narrator (frontend-only)
        const hafsNarrator = {
          id: "hafs-an-asim", // Special ID for frontend-only narrator
          title: "Hafs",
          highlight_color: "#00d4ff",
          region: { title: "Kufa" },
        };
        
        // Transform nested API data into parent-child structure
        // Group children by their parent narrator
        const parentMap = new Map();
        
        data.forEach((childNarrator) => {
          if (childNarrator.narrator_id && childNarrator.narrator) {
            const parentId = childNarrator.narrator.id;
            if (!parentMap.has(parentId)) {
              parentMap.set(parentId, {
                id: parentId,
                title: childNarrator.narrator.title,
                highlight_color: childNarrator.narrator.highlight_color,
                region: childNarrator.narrator.region,
                children: [],
              });
            }
            parentMap.get(parentId).children.push({
              id: childNarrator.id,
              title: childNarrator.title,
              highlight_color: childNarrator.highlight_color,
              region: childNarrator.region,
            });
          }
        });
        
        // Convert map to array and sort
        const parents = Array.from(parentMap.values()).sort((a, b) => 
          a.title.localeCompare(b.title)
        );
        
        // Find Aasim and add Hafs as the first child
        const asimIndex = parents.findIndex(p => {
          const titleLower = p.title.toLowerCase();
          return titleLower.includes("asim") || 
                 titleLower.includes("aasim") ||
                 titleLower.includes("asem") ||
                 titleLower === "aasim";
        });
        
        if (asimIndex !== -1) {
          // Add Hafs as the first child of Aasim
          parents[asimIndex].children.unshift({
            id: "hafs-an-asim",
            title: "Hafs",
            highlight_color: "#00d4ff",
            region: { title: "Kufa" },
            isHafs: true, // Mark as Hafs for special handling
          });
        }
        
        setParentNarrators(parents);
        
        // Expand all parents by default
        const allParentIds = parents.map(p => p.id);
        setExpandedParents(new Set(allParentIds));
        
        // Flatten all narrators (children only - those with narrator_id and narrator)
        // Filter out parent narrators (those without narrator_id or narrator)
        const allChildNarrators = data
          .filter((child) => child.narrator_id && child.narrator) // Only include child narrators
          .map((child) => ({
            id: child.id,
            title: child.title,
            highlight_color: child.highlight_color,
            region: child.region,
          }));
        
        setNarrators([hafsNarrator, ...allChildNarrators]);

        // Load saved narrator selections (AsyncStorage on native, localStorage on web)
        let savedNarrators = [];
        try {
          if (Platform.OS === "web" && typeof localStorage !== "undefined") {
            const saved = localStorage.getItem("selectedNarrators");
            if (saved) savedNarrators = JSON.parse(saved);
          } else {
            const saved = await AsyncStorage.getItem("selectedNarrators");
            if (saved) savedNarrators = JSON.parse(saved);
          }
        } catch (err) {
          console.error("Error loading saved narrators:", err);
        }
        
        // Always ensure Hafs is selected
        if (savedNarrators.length === 0) {
          setSelectedNarrators([hafsNarrator.id]);
          // Save the default selection
          try {
            if (Platform.OS === "web" && typeof localStorage !== "undefined") {
              localStorage.setItem("selectedNarrators", JSON.stringify([hafsNarrator.id]));
            } else {
              await AsyncStorage.setItem("selectedNarrators", JSON.stringify([hafsNarrator.id]));
            }
          } catch (err) {
            console.error("Error saving default narrator:", err);
          }
        } else {
          // Ensure Hafs is always in the selection
          const hasHafs = savedNarrators.includes(hafsNarrator.id);
          if (!hasHafs) {
            const updatedSelection = [hafsNarrator.id, ...savedNarrators];
            setSelectedNarrators(updatedSelection);
            // Save the updated selection
            try {
              if (Platform.OS === "web" && typeof localStorage !== "undefined") {
                localStorage.setItem("selectedNarrators", JSON.stringify(updatedSelection));
              } else {
                await AsyncStorage.setItem("selectedNarrators", JSON.stringify(updatedSelection));
              }
            } catch (err) {
              console.error("Error saving updated narrator selection:", err);
          }
        } else {
          setSelectedNarrators(savedNarrators);
          }
        }
      } catch (err) {
        console.error("Error fetching narrators:", err);
      }
    };

    fetchNarrators();
  }, []);

  // Save narrator selections whenever they change
  useEffect(() => {
    const persist = async () => {
      // Always ensure Hafs is in the selection before saving
      const selectionToSave = selectedNarrators.includes("hafs-an-asim")
        ? selectedNarrators
        : ["hafs-an-asim", ...selectedNarrators];
      
      try {
        if (Platform.OS === "web" && typeof localStorage !== "undefined") {
          localStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectionToSave)
          );
        } else {
          await AsyncStorage.setItem(
            "selectedNarrators",
            JSON.stringify(selectionToSave)
          );
        }
      } catch (err) {
        console.error("Error saving selected narrators:", err);
      }
    };
    persist();
  }, [selectedNarrators]);

  useEffect(() => {
    verserAyahModalWordIdsRef.current = verserAyahModalWordIds;
  }, [verserAyahModalWordIds]);

  useEffect(() => {
    if (!verserMode) {
      verserAnchorWordIdRef.current = null;
      setVerserAnchorWordId(null);
      setVerserAyahPreviewByPage({});
      setVerserLastAyahByPage({});
      setVerserAyahModalVisible(false);
      setVerserAyahModalWordIds([]);
      setVerserAyahModalSuggestedLabel("");
    }
  }, [verserMode]);

  useEffect(() => {
    verserAnchorWordIdRef.current = null;
    setVerserAnchorWordId(null);
  }, [currentPage]);

  const handleVerserWordTap = useCallback(
    (word) => {
      if (!FEATURE_FLAGS.verser || !verserMode || mushafId !== 2) return;
      const pageNum = currentPageRef.current;
      const page = pageCacheRef.current[pageNum];
      if (!page?.lines) return;
      const wid = word.id;

      const previewMap = verserAyahPreviewByPage[pageNum] || {};
      const lastLabel = verserLastAyahByPage[pageNum];
      const trimmedLast =
        lastLabel != null && String(lastLabel).trim() !== ""
          ? String(lastLabel).trim()
          : null;

      // After first range is settled: one tap tags from next word through this tap (ayah +1).
      if (trimmedLast && Object.keys(previewMap).length > 0) {
        const ids = wordIdsFromNextPreviewThroughClick(page, previewMap, wid);
        if (!ids.length) return;
        const nextLabel = incrementSurahAyah(trimmedLast);
        if (!nextLabel) return;
        setVerserAyahPreviewByPage((prev) => {
          const pageMap = { ...(prev[pageNum] || {}) };
          for (const id of ids) {
            pageMap[String(id)] = nextLabel;
          }
          return { ...prev, [pageNum]: pageMap };
        });
        setVerserLastAyahByPage((prev) => ({
          ...prev,
          [pageNum]: nextLabel,
        }));
        verserAnchorWordIdRef.current = null;
        setVerserAnchorWordId(null);
        return;
      }

      // First range on page: two taps, then modal.
      const anchor = verserAnchorWordIdRef.current;
      if (anchor == null) {
        verserAnchorWordIdRef.current = wid;
        setVerserAnchorWordId(wid);
        return;
      }
      verserAnchorWordIdRef.current = null;
      setVerserAnchorWordId(null);
      const ids = wordIdsInInclusiveRange(page, anchor, wid);
      if (!ids.length) return;
      void (async () => {
        let incomingApi = null;
        try {
          const res = await fetch(
            `${getApiBase()}/api/mushafs/${mushafId}/preceding_surah_carry?page_position=${pageNum}`
          );
          if (res.ok) {
            const data = await res.json();
            const s = Number(data?.surah);
            if (Number.isFinite(s) && s > 0) incomingApi = s;
          }
        } catch (_) {
          /* fall back to cache-only carry in suggestVerserLabelFromRange */
        }
        const suggested =
          mushafId === 2
            ? suggestVerserLabelFromRange(page, ids, {
                incomingSurah: incomingApi,
                pageByPosition: pageCacheRef.current,
                pageNumber: pageNum,
              })
            : "";
        setVerserAyahModalSuggestedLabel(suggested);
        setVerserAyahModalWordIds(ids);
        setVerserAyahModalVisible(true);
      })();
    },
    [verserMode, mushafId, verserLastAyahByPage, verserAyahPreviewByPage]
  );

  const cancelVerserAyahModal = useCallback(() => {
    setVerserAyahModalVisible(false);
    setVerserAyahModalWordIds([]);
    setVerserAyahModalSuggestedLabel("");
  }, []);

  const confirmVerserAyahModal = useCallback((ayahText) => {
    const pageNum = currentPageRef.current;
    const ids = verserAyahModalWordIdsRef.current;
    const trimmed = String(ayahText ?? "").trim();
    setVerserAyahPreviewByPage((prev) => {
      const pageMap = { ...(prev[pageNum] || {}) };
      for (const id of ids) {
        pageMap[String(id)] = trimmed;
      }
      return { ...prev, [pageNum]: pageMap };
    });
    setVerserLastAyahByPage((prev) => ({
      ...prev,
      [pageNum]: trimmed,
    }));
    setVerserAyahModalVisible(false);
    setVerserAyahModalWordIds([]);
    setVerserAyahModalSuggestedLabel("");
  }, []);

  const saveVerserAyahsForCurrentPage = useCallback(async () => {
    if (mushafId !== 2) return;
    const pageNum = currentPageRef.current;
    const map = verserAyahPreviewByPage[pageNum];
    if (!map || !Object.keys(map).length) return;
    const updates = Object.entries(map).map(([word_id, ayah]) => ({
      word_id: parseInt(word_id, 10),
      ayah: ayah ?? "",
    }));
    try {
      const res = await fetch(
        `${getApiBase()}/api/mushafs/${mushafId}/pages/${pageNum}/bulk_update_ayahs`,
        {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ updates }),
        }
      );
      let body = {};
      try {
        body = await res.json();
      } catch (_) {
        /* ignore */
      }
      if (!res.ok) {
        Alert.alert("Save failed", body.error || `HTTP ${res.status}`);
        return;
      }
      pageCacheRef.current[pageNum] = body;
      setPageCache((p) => ({ ...p, [pageNum]: body }));
      if (pageNum === currentPageRef.current) setPage(body);
      setVerserAyahPreviewByPage((p) => {
        const next = { ...p };
        delete next[pageNum];
        return next;
      });
      setVerserLastAyahByPage((p) => {
        const next = { ...p };
        delete next[pageNum];
        return next;
      });
    } catch (e) {
      Alert.alert("Save failed", e.message || String(e));
    }
  }, [mushafId, verserAyahPreviewByPage]);

  /** Short tap on a word that has a narration change for the selected narrator — sync bottom traversal bar */
  const handleVariationTraversalWordTap = useCallback(
    (word, pageNum) => {
      if (!firstSelectedNarratorId || !word?.id || pageNum == null) return;
      const pn = Number(pageNum);
      if (!Number.isFinite(pn)) return;
      const hit = narratorVariations.some(
        (v) =>
          String(v.word?.id) === String(word.id) &&
          (v.word?.line?.page?.position ?? 0) === pn
      );
      if (!hit) return;
      setLastSelectedVariationHighlight({ wordId: word.id, pageNum: pn });

      if (FEATURE_FLAGS.variationWordListenBadge) {
        const vMatch = narratorVariations.find(
          (x) =>
            String(x.word?.id) === String(word.id) &&
            (x.word?.line?.page?.position ?? 0) === pn
        );
        const rawAyah = vMatch?.word?.ayah ?? word?.ayah;
        const ayahLabel = normalizeAyahLabelForListen(rawAyah);
        if (ayahLabel && ayahLabel.includes(":")) {
          void playRecitationSegmentForAyahRef.current(ayahLabel, {
            traversalChip: {
              type: "comparison",
              narratorId: firstSelectedNarratorId,
              narratorTitle: firstNarratorTitle || undefined,
            },
            clipLoadingBadge: { kind: "mushaf-word", wordId: String(word.id) },
          });
        }
      }
    },
    [firstSelectedNarratorId, firstNarratorTitle, narratorVariations]
  );

  const handleWordPress = (word) => {
    if (isDrawerVisibleRef.current) {
      closeDrawer();
    }
    try {
      // Temporary debug logging for Shu'bah word audio work
      console.log("🔍 Held word info:", {
        id: word?.id,
        content: word?.content,
        rawWord: word,
        currentPage,
      });
    } catch (e) {
      // Ignore logging errors
    }

    setSelectedWord(word);
    setSelectedWordId(word.id);
    if (word.layout) {
      setWordPosition(word.layout);
    }
    setPopupVisible(true);
    setSelectedNarrator(null);
    setInputValue(word.content);
    // Sync Narration Changes active state when user taps a word that has a variation
    const hasVariation = narratorVariations.some(
      (v) => v.word?.id === word.id && (v.word?.line?.page?.position ?? 0) === currentPage
    );
    if (hasVariation) {
      setLastSelectedVariationHighlight({ wordId: word.id, pageNum: currentPage });
    }
  };

  const handleSelectNarrator = (narrator) => {
    setSelectedNarrator(narrator);

    if (narrator && selectedWord) {
      // Check if there's an existing variation for this word and narrator
      const variationKey = `${selectedWord.id}-${narrator.id}`;
      const existingVariation = allVariations[variationKey];

      if (existingVariation) {
        setInputValue(
          typeof existingVariation === "object" ? existingVariation.content : existingVariation
        );
      } else {
        // Default to original word content
        setInputValue(selectedWord.content);
      }
    }
  };

  const handleClosePopup = () => {
    setPopupVisible(false);
    setSelectedNarrator(null);
    setInputValue("");
    setSelectedWordId(null);
    setWordPosition(null);
  };

  const handlePageChange = (newPage) => {
    const pageNum = parseInt(newPage, 10);
    if (Number.isNaN(pageNum) || pageNum < 1) return;
    const clamped = Math.min(pageNum, totalPages);
    setCurrentPage(clamped);
    setPageInput(String(clamped));
    syncPagerToPage(clamped);
    // Loading state is handled by useEffect based on cache
  };

  /** Merge refreshed `ayah` onto a word everywhere we keep page / variation / selection state. */
  const mergeWordAyahIntoCaches = useCallback((wordId, ayah) => {
    const idStr = String(wordId);
    const ayahVal = ayah == null ? "" : String(ayah);

    const patchPage = (pg) => {
      if (!pg?.lines) return pg;
      let changed = false;
      const lines = pg.lines.map((line) => ({
        ...line,
        words: (line.words || []).map((w) => {
          if (String(w.id) !== idStr) return w;
          changed = true;
          return { ...w, ayah: ayahVal };
        }),
      }));
      return changed ? { ...pg, lines } : pg;
    };

    setPageCache((prev) => {
      const next = { ...prev };
      for (const k of Object.keys(next)) {
        const patched = patchPage(next[k]);
        if (patched !== next[k]) {
          next[k] = patched;
          pageCacheRef.current[k] = patched;
        }
      }
      return next;
    });

    setPage((p) => (p ? patchPage(p) : p));

    setAllMushafVariations((prev) =>
      prev.map((item) =>
        item.word && String(item.word.id) === idStr
          ? { ...item, word: { ...item.word, ayah: ayahVal } }
          : item
      )
    );

    setSelectedWord((sw) =>
      sw && String(sw.id) === idStr ? { ...sw, ayah: ayahVal } : sw
    );
  }, []);

  /** When the traversal bar shows a variation from another page, tap Hafs / narrator word to jump there. */
  const goToActiveTraversalVariationPage = async (riwayahChip) => {
    const isHafsChip = riwayahChip?.type === "hafs";
    const isComparisonChip = riwayahChip?.type === "comparison";
    console.log("traversal-chip:press", {
      chip: isHafsChip ? "hafs" : isComparisonChip ? "comparison" : "unspecified",
      mushafNarratorId: isComparisonChip ? riwayahChip.narratorId ?? null : null,
      narratorLabel: isHafsChip ? "Hafs" : isComparisonChip ? riwayahChip.narratorTitle ?? null : null,
      hafsHasNoMushafNarratorId: isHafsChip,
      narratorVariationsCount: narratorVariations.length,
      currentVariationIndex,
      hasActiveVariation: !!activeTraversalVariation,
      activeWordId: activeTraversalVariation?.word?.id ?? null,
      activeAyah: activeTraversalVariation?.word?.ayah ?? null,
    });
    const v = activeTraversalVariation;
    let word = v?.word;
    if (!word?.id) {
      console.log("traversal-chip:missing-word-id");
      return;
    }

    let ayahLabel = normalizeAyahLabelForListen(word?.ayah);
    if (!ayahLabel) {
      try {
        const res = await fetch(`${getApiBase()}/api/words/${word.id}`);
        if (!res.ok) {
          console.warn("traversal-chip:refresh-word-ayah-http", { wordId: word.id, status: res.status });
        } else {
          const w = await res.json();
          const freshAyah = w?.ayah;
          const normalized = normalizeAyahLabelForListen(freshAyah);
          if (normalized) {
            mergeWordAyahIntoCaches(word.id, freshAyah);
            word = { ...word, ayah: freshAyah };
            ayahLabel = normalized;
            console.log("traversal-chip:refresh-word-ayah-ok", { wordId: word.id, ayah: ayahLabel });
          }
        }
      } catch (e) {
        console.warn("traversal-chip:refresh-word-ayah-error", { wordId: word.id, message: e?.message });
      }
    }

    if (ayahLabel) {
      console.log(`ayah: ${ayahLabel}`);
      void handlePlayFirstRecitationSegmentForAyah(ayahLabel, {
        traversalChip: riwayahChip,
        clipLoadingBadge:
          riwayahChip?.type === "hafs"
            ? { kind: "traversal-hafs" }
            : riwayahChip?.type === "comparison"
              ? {
                  kind: "traversal-comparison",
                  narratorId: String(riwayahChip.narratorId),
                }
              : undefined,
      });
    }
    const pageNum = word.line?.page?.position;
    if (pageNum == null) return;
    if (Number(pageNum) === Number(currentPage)) return;
    setLastSelectedVariationHighlight({ wordId: word.id, pageNum });
    setCurrentPage(pageNum);
    setPageInput(String(pageNum));
    handlePageChange(String(pageNum));
    setSelectedWordId(word.id);
    setSelectedWord({ ...word, content: word.content });
  };

  const handlePreviousPage = () => {
    const page = currentPageRef.current;
    if (page > 1) {
      const newPage = page - 1;
      console.log("handlePreviousPage: going from", page, "to", newPage);
      setCurrentPage(newPage);
      setPageInput(newPage.toString());
      syncPagerToPage(newPage);
      // Loading state is handled by useEffect based on cache
    }
  };

  const handleNextPage = () => {
    const page = currentPageRef.current;
    if (page < totalPages) {
      const newPage = page + 1;
      console.log("handleNextPage: going from", page, "to", newPage);
      setCurrentPage(newPage);
      setPageInput(newPage.toString());
      syncPagerToPage(newPage);
      // Loading state is handled by useEffect based on cache
    }
  };

  // Update handler refs whenever handlers are recreated
  useEffect(() => {
    handlePreviousPageRef.current = handlePreviousPage;
    handleNextPageRef.current = handleNextPage;
  });

  // Helper function to find which parent a child narrator belongs to
  const findParentForChild = (childId) => {
    // Hafs belongs to Aasim
    if (childId === "hafs-an-asim") {
      return parentNarrators.find(p => {
        const titleLower = p.title.toLowerCase();
        return titleLower.includes("asim") || 
               titleLower.includes("aasim") ||
               titleLower.includes("asem");
      });
    }
    
    // Find parent by checking all parent narrators' children
    for (const parent of parentNarrators) {
      if (parent.children.some(child => child.id === childId)) {
        return parent;
      }
    }
    return null;
  };

  const handleToggleNarrator = (narratorId) => {
    // Prevent toggling Hafs off - it's always selected
    if (narratorId === "hafs-an-asim") {
      return; // Do nothing - Hafs is always selected
    }
    
    setSelectedNarrators((prev) => {
      // Ensure Hafs is always in the selection
      const hasHafs = prev.includes("hafs-an-asim");
      const withoutHafs = prev.filter((id) => id !== "hafs-an-asim");
      
      // Find the parent of the clicked narrator
      const clickedParent = findParentForChild(narratorId);
      if (!clickedParent) {
        return prev; // If we can't find the parent, don't change selection
      }
      
      // Find which parent the currently selected children belong to (excluding Hafs)
      let currentParentId = null;
      if (withoutHafs.length > 0) {
        const firstSelectedChild = withoutHafs[0];
        const firstSelectedParent = findParentForChild(firstSelectedChild);
        if (firstSelectedParent) {
          currentParentId = firstSelectedParent.id;
        }
      }
      
        // If clicking any other narrator
      if (withoutHafs.includes(narratorId)) {
        // Deselecting narrator - only allow if it's from the same parent
        if (currentParentId === clickedParent.id) {
          const newSelection = withoutHafs.filter((id) => id !== narratorId);
          // Always include Hafs
          return ["hafs-an-asim", ...newSelection];
        }
        return prev; // Can't deselect if it's the only one from that parent
        } else {
        // Selecting narrator
        // If clicking a child from a different parent, clear all other selections
        if (currentParentId && currentParentId !== clickedParent.id) {
          // Clear all selections from other parents, keep only Hafs and the new selection
          return ["hafs-an-asim", narratorId];
        } else {
          // Same parent - add to selection
          return ["hafs-an-asim", ...withoutHafs, narratorId];
        }
      }
    });
  };

  const handleToggleParent = (parentId) => {
    setExpandedParents((prev) => {
      const newSet = new Set(prev);
      if (newSet.has(parentId)) {
        newSet.delete(parentId);
      } else {
        newSet.add(parentId);
      }
      return newSet;
    });
  };

  const handleResetToHafs = () => {
    // Reset to only Hafs (which is always selected)
    setSelectedNarrators(["hafs-an-asim"]);
  };

  const handleSaveVariation = async (variationKey, payload) => {
    if (!variationKey || !selectedWord || !selectedNarrator) return;

    const isCurrentlySaved = savedVariations.includes(variationKey);
    const content =
      typeof payload === "object" && payload && payload.content != null
        ? payload.content
        : inputValue;

    try {
      if (isCurrentlySaved) {
        // Delete variation on API then unsave locally
        try {
          await fetch(
            `${getVariationsUrl()}/by_keys?word_id=${selectedWord.id}&narrator_id=${selectedNarrator.id}`,
            { method: "DELETE" }
          );
        } catch (e) {
          console.error(
            "API delete variation failed (continuing to update UI):",
            e
          );
        }

        setSavedVariations((prev) =>
          prev.filter((key) => key !== variationKey)
        );
        setAllVariations((prev) => {
          const newVariations = { ...prev };
          delete newVariations[variationKey];
          return newVariations;
        });
      } else {
        // Save variation to API (content + special_characters for imalah/diamond)
        const special_characters =
          typeof payload === "object" && payload && (payload.imalah || payload.diamond)
            ? { imalah: payload.imalah || null, diamond: payload.diamond || null }
            : null;
        const response = await fetch(getVariationsUrl(), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
          },
          body: JSON.stringify({
            variation: {
              content,
              word_id: selectedWord.id,
              narrator_id: selectedNarrator.id,
              ...(special_characters && { special_characters }),
            },
          }),
        });

        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`);
        }

        // Store full payload locally (content + imalah + diamond) so Tweaked and mushaf show overlays
        const toStore =
          typeof payload === "object" && payload && (payload.imalah || payload.diamond)
            ? { content: payload.content, imalah: payload.imalah, diamond: payload.diamond }
            : content;
        setAllVariations((prev) => ({
          ...prev,
          [variationKey]: toStore,
        }));

        setSavedVariations((prev) => [...prev, variationKey]);

        await refreshVariations();
      }
    } catch (error) {
      console.error("Error saving variation:", error);
    }
  };

  const handleDeleteVariation = async () => {
    if (!selectedWord || !selectedNarrator) return;
    const variationKey = `${selectedWord.id}-${selectedNarrator.id}`;
    
    // Optimistically update local state first
    setAllVariations((prev) => {
      const newVariations = { ...prev };
      delete newVariations[variationKey];
      return newVariations;
    });
    setSavedVariations((prev) => prev.filter((k) => k !== variationKey));
    setInputValue(selectedWord.content);
    
    try {
      // Then delete from API
      const response = await fetch(
        `${getVariationsUrl()}/by_keys?word_id=${selectedWord.id}&narrator_id=${selectedNarrator.id}`,
        { method: "DELETE" }
      );
      
      if (response.ok || response.status === 204) {
        // Deletion successful - refresh to sync with server
        // Use a small delay to ensure server has processed the deletion
        setTimeout(async () => {
          await refreshVariations();
        }, 100);
      } else {
        // If deletion failed, re-fetch to restore correct state from server
        console.error("Failed to delete variation on server, status:", response.status);
        await refreshVariations();
      }
    } catch (e) {
      console.error("Error deleting variation:", e);
      // On network error, refresh to get server state after a delay
      // This gives the server time to process if it's a temporary issue
      setTimeout(async () => {
        await refreshVariations();
      }, 500);
    }
  };

  const handleListenPlaybackStatusUpdate = useCallback((status) => {
    if (!status?.isLoaded) {
      setListenIsPlaying(false);
      listenClipEndMsRef.current = null;
      listenClipStartMsRef.current = null;
      return;
    }
    const positionMs = status.positionMillis ?? 0;
    setListenPositionMs(positionMs);
    setListenDurationMs(status.durationMillis ?? 0);
    setListenIsPlaying(status.isPlaying ?? false);

    if (Platform.OS === "ios") {
      const { track, reciter } = activeListenTrackMetaRef.current;
      if (track) {
        scheduleListenNowPlayingSync({
          track,
          reciter,
          positionMs,
          durationMs: status.durationMillis ?? 0,
          isPlaying: status.isPlaying ?? false,
        });
      }
    }
    const clipEndMs = listenClipEndMsRef.current;
    if (
      clipEndMs != null &&
      status.isPlaying &&
      Number.isFinite(positionMs) &&
      positionMs >= clipEndMs - 40 &&
      listenSoundRef.current
    ) {
      listenSoundRef.current
        .pauseAsync()
        .then(() => listenSoundRef.current?.setPositionAsync(clipEndMs))
        .catch(() => {})
        .finally(() => {
          listenClipEndMsRef.current = null;
          listenClipStartMsRef.current = null;
          setListenIsPlaying(false);
          setListenPositionMs(clipEndMs);
          setListenTraversalClipHighlightVerse(null);
        });
      return;
    }
    if (status.didJustFinish) {
      listenClipEndMsRef.current = null;
      listenClipStartMsRef.current = null;
      setListenIsPlaying(false);
      setListenTraversalClipHighlightVerse(null);
      if (Platform.OS === "ios") {
        clearListenNowPlaying();
      }
    }
  }, []);

  const unloadListenSound = useCallback(async () => {
    if (listenSoundRef.current) {
      try {
        await listenSoundRef.current.unloadAsync();
      } catch (e) {
        console.warn("Unable to unload recitation sound:", e);
      } finally {
        listenSoundRef.current = null;
      }
    }
  }, []);

  useEffect(() => {
    Audio.setAudioModeAsync({
      staysActiveInBackground: true,
      shouldDuckAndroid: true,
      playsInSilentModeIOS: true,
      playThroughEarpieceAndroid: false,
    }).catch((e) => console.warn("Audio mode setup failed:", e));
  }, []);

  useEffect(() => {
    return () => {
      unloadListenSound();
    };
  }, [unloadListenSound]);

  const handlePlayListenTrack = useCallback(
    async (track, playOptions = {}) => {
      if (!track?.url) return;
      try {
        listenClipEndMsRef.current = null;
        listenClipStartMsRef.current = null;
        if (!playOptions.suppressPlayer) {
          setListenTraversalClipHighlightVerse(null);
        }
        if (activeListenTrack?.trackKey === track.trackKey && listenSoundRef.current) {
          const status = await listenSoundRef.current.getStatusAsync();
          if (status?.isLoaded) {
            if (status.isPlaying) {
              await listenSoundRef.current.pauseAsync();
            } else {
              await listenSoundRef.current.playAsync();
            }
          }
          return;
        }

        await unloadListenSound();

        if (playOptions.suppressPlayer) {
          setListenPlayerVisible(false);
        }

        const { sound } = await Audio.Sound.createAsync(
          { uri: track.url },
          { shouldPlay: true, progressUpdateIntervalMillis: 120 },
          handleListenPlaybackStatusUpdate
        );
        listenSoundRef.current = sound;
        setActiveListenTrack(track);
        if (Platform.OS === "ios") {
          const reciterRow = listenReciters.find((r) => r.slug === track.reciterSlug);
          scheduleListenNowPlayingSync({
            track,
            reciter: reciterRow,
            positionMs: 0,
            durationMs: 0,
            isPlaying: true,
            force: true,
          });
        }
        if (!playOptions.suppressPlayer) {
          setListenPlayerVisible(true);
        }
        setListenPositionMs(0);
      } catch (e) {
        console.error("Error playing surah recitation:", e);
      }
    },
    [activeListenTrack, handleListenPlaybackStatusUpdate, unloadListenSound, listenReciters]
  );

  const handleCloseListenPlayer = useCallback(async () => {
    listenClipEndMsRef.current = null;
    listenClipStartMsRef.current = null;
    await unloadListenSound();
    if (Platform.OS === "ios") {
      await clearListenNowPlaying();
    }
    setActiveListenTrack(null);
    setListenIsPlaying(false);
    setListenPositionMs(0);
    setListenDurationMs(0);
    setListenPlayerVisible(false);
    setListenTraversalClipHighlightVerse(null);
    setChipClipLoadingBadge(null);
  }, [unloadListenSound]);

  const handleSeekListenTrack = useCallback(async (value) => {
    if (!listenSoundRef.current) return;
    listenClipEndMsRef.current = null;
    listenClipStartMsRef.current = null;
    const nextPosition = Array.isArray(value) ? value[0] : value;
    if (typeof nextPosition !== "number") return;
    try {
      await listenSoundRef.current.setPositionAsync(nextPosition);
      setListenPositionMs(nextPosition);
      if (Platform.OS === "ios") {
        const { track, reciter } = activeListenTrackMetaRef.current;
        if (track) {
          const st = await listenSoundRef.current.getStatusAsync();
          if (st?.isLoaded) {
            scheduleListenNowPlayingSync({
              track,
              reciter,
              positionMs: nextPosition,
              durationMs: st.durationMillis ?? 0,
              isPlaying: st.isPlaying ?? false,
              force: true,
            });
          }
        }
      }
    } catch (e) {
      console.warn("Failed to seek recitation:", e);
    }
  }, []);

  const formatListenTime = useCallback((millis) => {
    const safeMs = Number.isFinite(millis) ? Math.max(0, millis) : 0;
    const totalSeconds = Math.floor(safeMs / 1000);
    const mins = Math.floor(totalSeconds / 60);
    const secs = totalSeconds % 60;
    return `${mins}:${String(secs).padStart(2, "0")}`;
  }, []);

  /**
   * `RecitationVerseSegment` for the word's ayah; when `traversalChip` is set, scopes lookup by riwayah
   * (Hafs → hafs-an-asim; comparison narrator e.g. Shu'bah → shubah-an-asim).
   */
  const handlePlayFirstRecitationSegmentForAyah = useCallback(
    async (ayahLabel, options = {}) => {
      const normalizedAyah = normalizeAyahLabelForListen(ayahLabel);
      if (!normalizedAyah || !normalizedAyah.includes(":")) return;

      const chip = options.traversalChip;

      if (chip && activeListenTrack?.chipClipPlayback) {
        const cur = activeListenTrack.chipClipSource;
        const playingAyah = normalizeAyahLabelForListen(
          activeListenTrack.chipClipAyah ?? ""
        );
        const sameAyah = playingAyah && playingAyah === normalizedAyah;
        if (cur && sameAyah) {
          const sameChip =
            cur.type === chip.type &&
            (chip.type !== "comparison" ||
              String(cur.narratorId) === String(chip.narratorId));
          if (sameChip && listenIsPlaying) {
            await handleCloseListenPlayer();
            return;
          }
        }
      }

      if (chip) {
        if (chipClipSegmentRequestInFlightRef.current) return;
        chipClipSegmentRequestInFlightRef.current = true;
        const loadingBadge =
          options.clipLoadingBadge ??
          (chip.type === "hafs"
            ? { kind: "traversal-hafs" }
            : chip.type === "comparison"
              ? { kind: "traversal-comparison", narratorId: String(chip.narratorId) }
              : null);
        if (loadingBadge) setChipClipLoadingBadge(loadingBadge);
      }

      const narratorSlug =
        chip?.type === "hafs"
          ? "hafs-an-asim"
          : chip?.type === "comparison"
            ? recitationNarratorSlugForMushafNarratorId(chip.narratorId, parentNarrators)
            : null;

      try {
        const lookupUrl = buildVerseSegmentLookupUrl(
          normalizedAyah,
          narratorSlug ? { narratorSlug } : {}
        );
        console.log("recitation-verse-segment:lookup", {
          ayah: normalizedAyah,
          narrator_slug: narratorSlug,
          traversal_chip: chip ?? null,
          unmapped_comparison_narrator:
            chip?.type === "comparison" && narratorSlug == null ? true : false,
        });

        const res = await fetch(lookupUrl);
        if (!res.ok) {
          console.warn("recitation-verse-segment:not-found-or-error", {
            ayah: normalizedAyah,
            narrator_slug: narratorSlug,
            httpStatus: res.status,
            api_base: getApiBase(),
            hint:
              res.status === 404
                ? "No row on this API host (e.g. production DB empty for this ayah+riwayah). For local segments set USE_LOCALHOST_API and LOCAL_API_BASE (LAN IP on device)."
                : undefined,
          });
          return;
        }
        const payload = await res.json();
        if (!payload?.audio_url || payload.recitation_id == null) {
          console.warn("recitation-verse-segment:invalid-payload", {
            ayah: normalizedAyah,
            narrator_slug: narratorSlug,
          });
          return;
        }

        console.log("recitation-verse-segment:found", {
          ayah: normalizedAyah,
          narrator_slug_requested: narratorSlug,
          segment: {
            verse: payload.verse,
            start_time: payload.start_time,
            end_time: payload.end_time,
            recitation_id: payload.recitation_id,
          },
          riwayah_slug: payload.riwayah_slug,
          riwayah_title: payload.riwayah_title,
          reciter_slug: payload.reciter_slug,
        });

        const chipClipSource =
          chip?.type === "hafs"
            ? { type: "hafs" }
            : chip?.type === "comparison"
              ? { type: "comparison", narratorId: chip.narratorId }
              : null;
        const track = {
          url: payload.audio_url,
          index: payload.surah_position,
          name: payload.verse || normalizedAyah,
          recitationId: Number(payload.recitation_id),
          reciterSlug: payload.reciter_slug,
          riwayahId: payload.riwayah_slug,
          riwayahLabel: payload.riwayah_title || payload.riwayah_slug,
          trackKey: `lookup-${payload.recitation_id}-${normalizedAyah}-${payload.riwayah_slug || "x"}`,
          chipClipPlayback: !!chip,
          chipClipSource,
          chipClipAyah: chip ? normalizedAyah : undefined,
        };
        const startMs = Math.max(0, Math.round(Number(payload.start_time) * 1000));
        const endMs = Math.max(startMs + 120, Math.round(Number(payload.end_time) * 1000));
        const suppressPlayer = !!chip;
        if (suppressPlayer) {
          setListenTraversalClipHighlightVerse(normalizedAyah);
        }
        await handlePlayListenTrack(track, { suppressPlayer });
        /** Hide spinners as soon as the sound is loaded — do not wait for seek + play (feels laggy). */
        if (chip) setChipClipLoadingBadge(null);
        if (listenSoundRef.current) {
          await listenSoundRef.current.setPositionAsync(startMs);
          listenClipStartMsRef.current = startMs;
          listenClipEndMsRef.current = endMs;
          await listenSoundRef.current.playAsync();
          setListenPositionMs(startMs);
        }
      } catch (e) {
        setListenTraversalClipHighlightVerse(null);
        console.warn("recitation-verse-segment:fetch-error", {
          ayah: normalizedAyah,
          narrator_slug: narratorSlug,
          message: e?.message,
        });
      } finally {
        if (chip) {
          chipClipSegmentRequestInFlightRef.current = false;
          setChipClipLoadingBadge(null);
        }
      }
    },
    [
      handlePlayListenTrack,
      handleCloseListenPlayer,
      parentNarrators,
      activeListenTrack,
      listenIsPlaying,
    ]
  );
  playRecitationSegmentForAyahRef.current = handlePlayFirstRecitationSegmentForAyah;

  if (iosUpdateWall) {
    const storeUrl = resolveIosAppStoreUrl();
    return (
      <SafeAreaProvider>
        <SafeAreaViewEdged
          style={styles.iosUpdateWallRoot}
          edges={["top", "right", "bottom", "left"]}
          accessibilityViewIsModal
        >
          <StatusBar barStyle="dark-content" />
          <View style={styles.iosUpdateWallBackdrop}>
            <View style={styles.iosUpdateWallCard}>
              <Image
                accessibilityIgnoresInvertColors
                source={require("./assets/icon.png")}
                style={styles.iosUpdateWallIcon}
              />
              <Text style={styles.iosUpdateWallBrand}>Aswaat</Text>
              <Text style={styles.iosUpdateWallTitle}>Update required</Text>
              <Text style={styles.iosUpdateWallBody}>
                A newer version is available. Please update to continue using Aswaat.
              </Text>
              <TouchableOpacity
                accessibilityRole="button"
                accessibilityLabel="Open the App Store to update Aswaat"
                style={styles.iosUpdateWallButton}
                onPress={() => {
                  const url = resolveIosAppStoreUrl();
                  Linking.openURL(url).catch(() => {
                    Alert.alert(
                      "Could not open App Store",
                      "Search the App Store for “Aswaat” or update this app from your home screen."
                    );
                  });
                }}
                activeOpacity={0.85}
              >
                <Text style={styles.iosUpdateWallButtonText}>Update in App Store</Text>
              </TouchableOpacity>
            </View>
          </View>
        </SafeAreaViewEdged>
      </SafeAreaProvider>
    );
  }

  if (error) {
    return (
      <View style={styles.errorContainer}>
        <Text style={styles.errorText}>Error: {error}</Text>
        <Text style={styles.errorHint}>
          Make sure the Rails server is running at http://localhost:3000
        </Text>
      </View>
    );
  }

  if (!fontsLoaded) {
    return (
      <View style={styles.loadingContainer}>
        <ActivityIndicator size="large" color="#000" />
        <Text style={styles.loadingText}>Loading font...</Text>
      </View>
    );
  }

  // Bottom inset for home indicator so bar can extend to screen bottom without overlap
  const bottomBarInset = Platform.OS === "ios" ? 34 : 0;
  const isDrawerPlayerCompact = isDrawerVisible;
  const isListenTab = currentTab === "Listen";
  const screenWidth = Dimensions.get("window").width;
  // Listen UX toggle: sidebar allowed only when recitation window/player is active.
  // Keep this condition explicit so we can switch behavior later.
  const canShowListenSidebar = listenPlayerVisible;
  /** Dark notch / status strip like mushaf top bar (#1F1F22), not Learn */
  const mushafStyleTopChrome =
    chromeTab === "Recite" || chromeTab === "Listen";
  /** Hafs is always selected; "no narrator" means no additional qiraat in the strip. */
  const mushafTopBarOnlyHafs = !selectedNarrators.some(
    (id) => id !== "hafs-an-asim"
  );

  return (
    <WebPasswordGate>
    <SafeAreaProvider>
      <GestureHandlerRootView
        style={[
          { flex: 1 },
          mushafStyleTopChrome && { backgroundColor: "#1F1F22" },
        ]}
      >
        <StatusBar
          barStyle={
            mushafStyleTopChrome || isMushafDarkMode
              ? "light-content"
              : "dark-content"
          }
        />
        <SafeAreaViewEdged
          edges={["top"]}
          style={[
            styles.safeArea,
            isMushafDarkMode && styles.safeAreaDark,
            mushafStyleTopChrome && styles.safeAreaReciteTopChrome,
          ]}
        >
        {chromeTab === "Learn" && (
          <View style={styles.navBar}>
            <TouchableOpacity
              accessibilityRole="button"
              onPress={openDrawer}
              style={styles.navButton}
            >
              <Text style={styles.navIcon}>☰</Text>
            </TouchableOpacity>
            <Text style={styles.navTitle}>{chromeTab}</Text>
            <View style={styles.navRightSpacer} />
          </View>
        )}

        <View
          style={[
            styles.mainContainer,
            isMushafDarkMode && styles.mainContainerDark,
          ]}
        >
          {currentTab !== "Learn" && (
            <View style={{ flex: 1, width: screenWidth, overflow: "hidden" }}>
              <Animated.View
                style={{
                  flexDirection: "row",
                  width: screenWidth * 2,
                  flex: 1,
                  minWidth: screenWidth * 2,
                  transform: [{ translateX: tabSlideAnim }],
                }}
              >
                <View style={{ width: screenWidth, flex: 1 }}>
            <View
              style={styles.mushafReciteColumn}
              onStartShouldSetResponderCapture={() => {
                if (isDrawerVisibleRef.current) {
                  closeDrawer();
                }
                return false;
              }}
            >
              {/* Top bar with selected narrators */}
              <View style={styles.mushafTopBar}>
                <TouchableOpacity
                  onPress={() => (isDrawerFullyOpen ? closeDrawer() : openDrawer())}
                  style={styles.mushafMenuButton}
                >
                  <Text style={styles.mushafMenuIcon}>☰</Text>
                </TouchableOpacity>
                
                <ScrollView
                  horizontal
                  showsHorizontalScrollIndicator={false}
                  style={styles.mushafNarratorPillsScroll}
                  contentContainerStyle={styles.mushafNarratorPills}
                  onScrollBeginDrag={() => {
                    if (isDrawerVisibleRef.current) closeDrawer();
                  }}
                >
                  {selectedNarrators
                    .filter(id => id !== "hafs-an-asim") // Exclude Hafs from pills
                    .map((narratorId) => {
                      // Find narrator details
                      let narrator = null;
                      for (const parent of parentNarrators) {
                        const child = parent.children.find(c => c.id === narratorId);
                        if (child) {
                          narrator = child;
                          break;
                        }
                      }
                      // Also check in the flat narrators list
                      if (!narrator) {
                        narrator = narrators.find(n => n.id === narratorId);
                      }
                      
                      if (!narrator) return null;
                      
                      const highlightColor = narrator.highlight_color || "#00d4ff";
                      
                      return (
                        <TouchableOpacity
                          key={narratorId}
                          activeOpacity={0.7}
                          onPress={() =>
                            isDrawerFullyOpen ? closeDrawer() : openDrawer()
                          }
                          style={[
                            styles.mushafNarratorPill,
                            { borderColor: highlightColor },
                          ]}
                        >
                          <Text
                            style={[
                              styles.mushafNarratorPillText,
                              { color: highlightColor },
                            ]}
                          >
                            {narrator.title}
                          </Text>
                        </TouchableOpacity>
                      );
                    })}
                </ScrollView>
                
                <View style={styles.mushafRightIcons}>
                  {mushafId === 2 &&
                  mushafTopBarOnlyHafs &&
                  FEATURE_FLAGS.mushaf2HeaderInsert ? (
                    <>
                      <TouchableOpacity
                        style={styles.mushafHeaderToolButton}
                        onPress={() => {
                          if (isDrawerVisibleRef.current) closeDrawer();
                          toggleHeaderInsertMode();
                        }}
                      >
                        <Text style={styles.mushafHeaderToolButtonText}>
                          {headerInsertMode ? "Header ✓" : "Header"}
                        </Text>
                      </TouchableOpacity>
                      {headerInsertMode && headerPreview?.operations?.length ? (
                        <TouchableOpacity
                          style={styles.mushafHeaderToolButton}
                          onPress={() => {
                            if (isDrawerVisibleRef.current) closeDrawer();
                            saveHeaderInsert();
                          }}
                        >
                          <Text style={styles.mushafHeaderToolButtonText}>Save</Text>
                        </TouchableOpacity>
                      ) : null}
                    </>
                  ) : null}
                  {mushafId === 2 &&
                  mushafTopBarOnlyHafs &&
                  FEATURE_FLAGS.verser ? (
                    <VerserToolbarButton
                      active={verserMode}
                      style={styles.mushafHeaderToolButton}
                      textStyle={styles.mushafHeaderToolButtonText}
                      onPress={() => {
                        if (isDrawerVisibleRef.current) closeDrawer();
                        setVerserMode((v) => !v);
                      }}
                    />
                  ) : null}
                  {mushafId === 2 &&
                  mushafTopBarOnlyHafs &&
                  FEATURE_FLAGS.verser &&
                  verserMode &&
                  Object.keys(verserAyahPreviewByPage[currentPage] || {}).length >
                    0 ? (
                    <VerserSaveAyahButton
                      style={styles.mushafHeaderToolButton}
                      textStyle={styles.mushafHeaderToolButtonText}
                      onPress={() => {
                        if (isDrawerVisibleRef.current) closeDrawer();
                        saveVerserAyahsForCurrentPage();
                      }}
                    />
                  ) : null}
                  <TouchableOpacity
                    activeOpacity={0.7}
                    onPress={() => {
                      if (isDrawerVisibleRef.current) closeDrawer();
                      setShowPageSlider(true);
                    }}
                  >
                    <Text style={styles.mushafPageIndicator}>Pg. {currentPage}</Text>
                  </TouchableOpacity>
                  <TouchableOpacity
                    style={styles.mushafIconButton}
                    onPress={() => {
                      if (isDrawerVisibleRef.current) closeDrawer();
                      setShowPageSlider(true);
                    }}
                  >
                    <Search stroke="#ffffff" width={20} height={20} />
                  </TouchableOpacity>
                </View>
              </View>
              
              <View
                style={[
                  styles.contentContainer,
                  isMushafDarkMode && styles.contentContainerDark,
                ]}
              >
                <PagerView
                  ref={pagerRef}
                  style={[
                    { flex: 1 },
                    isMushafDarkMode && { backgroundColor: "#1F1F22" },
                  ]}
                  // RTL: initial index is inverted so higher page numbers appear on the left
                  initialPage={Math.max(0, totalPages - currentPage)}
                  onPageSelected={(e) => {
                    if (pagerSelectSuppressedRef.current) return;
                    if (isDrawerVisibleRef.current) {
                      closeDrawer();
                    }
                    const position = e.nativeEvent.position ?? 0;
                    // RTL: pager index is inverted into page number
                    const newPageNum = totalPages - position;
                    if (newPageNum !== currentPageRef.current) {
                      setCurrentPage(newPageNum);
                      setPageInput(String(newPageNum));
                    }
                  }}
                >
                  {Array.from({ length: totalPages }).map((_, idx) => {
                    // RTL: index 0 shows last page, index totalPages - 1 shows first page
                    const pageNum = totalPages - idx;
                    const cachedPage = pageCacheRef.current[pageNum];
                    const isCurrent = pageNum === currentPage;
                    let pageData = cachedPage;
                    if (
                      FEATURE_FLAGS.mushaf2HeaderInsert &&
                      mushafId === 2 &&
                      headerPreview?.operations?.length &&
                      headerPreview.pageNum === pageNum &&
                      cachedPage
                    ) {
                      pageData = mergeSurahHeaderPreviewChain(
                        cachedPage,
                        headerPreview.operations
                      );
                    }
                    // Derive from cache only: global `loading` can stay true across races (e.g. a
                    // prefetch completes and fills the ref before `setLoading(false)` runs for the
                    // visible page on first launch / mushaf hydration).
                    const isLoading = isCurrent && !pageData;

                    return (
                      <View
                        key={String(pageNum)}
                        style={[
                          styles.pageViewContainer,
                          isMushafDarkMode && styles.pageViewContainerDark,
                        ]}
                      >
                        <PageView
                          page={pageData}
                          onWordPress={isCurrent ? handleWordPress : () => {}}
                          selectedWordId={isCurrent ? selectedWordId : null}
                          loading={isLoading}
                          savedVariations={isCurrent ? savedVariations : []}
                          selectedNarrators={selectedNarrators}
                          allVariations={isCurrent ? allVariations : {}}
                          narratorHighlightColorById={narratorHighlightColorById}
                          highlightFirstLine={goToPageJuzSegments.some(
                            (j) => j.fields.first_page === pageNum
                          )}
                          isDarkMode={isMushafDarkMode}
                          mushafId={mushafId}
                          onVariationTraversalWordTap={
                            isCurrent && firstSelectedNarratorId
                              ? handleVariationTraversalWordTap
                              : undefined
                          }
                          variationListenBadgeWordIds={
                            variationListenBadgeWordIdsByPage?.[pageNum] ?? null
                          }
                          chipClipLoadingBadge={chipClipLoadingBadge}
                          headerInsertMode={
                            isCurrent &&
                            headerInsertMode &&
                            FEATURE_FLAGS.mushaf2HeaderInsert &&
                            mushafId === 2
                          }
                          onHeaderInsertLinePress={
                            isCurrent &&
                            headerInsertMode &&
                            FEATURE_FLAGS.mushaf2HeaderInsert &&
                            mushafId === 2
                              ? openHeaderInsertLine
                              : undefined
                          }
                          verserActive={
                            isCurrent &&
                            verserMode &&
                            FEATURE_FLAGS.verser &&
                            mushafId === 2
                          }
                          verserAyahPreview={
                            verserMode && FEATURE_FLAGS.verser && mushafId === 2
                              ? verserAyahPreviewByPage[pageNum] ?? {}
                              : {}
                          }
                          verserAnchorWordId={
                            isCurrent &&
                            verserMode &&
                            FEATURE_FLAGS.verser &&
                            mushafId === 2
                              ? verserAnchorWordId
                              : null
                          }
                          onVerserWordTap={
                            isCurrent &&
                            verserMode &&
                            FEATURE_FLAGS.verser &&
                            mushafId === 2
                              ? handleVerserWordTap
                              : undefined
                          }
                          recitationListenHighlightVerse={listenRecitationHighlightVerse}
                        />
                      </View>
                    );
                  })}
                </PagerView>
                <VerserAyahRangeModal
                  visible={verserAyahModalVisible}
                  wordCount={verserAyahModalWordIds.length}
                  suggestedLabel={verserAyahModalSuggestedLabel}
                  isDarkMode={isMushafDarkMode}
                  onCancel={cancelVerserAyahModal}
                  onConfirm={confirmVerserAyahModal}
                />
              </View>

              {/* Variations bottom sheet - sits under the traversal bar */}
              <VariationBottomSheet
                isVisible={
                  currentTab === "Recite" &&
                  !!firstSelectedNarratorId &&
                  isVariationBottomSheetVisible
                }
                showHandle={!!firstSelectedNarratorId}
                variations={allMushafVariations}
                comparisonNarrators={selectedTraversalNarrators}
                currentPage={currentPage}
                lastSelectedVariationHighlight={lastSelectedVariationHighlight}
                activeVariationWordId={activeTraversalWordId}
                scrollFocusWordId={selectedWordId ?? activeTraversalWordId}
                mushafId={mushafId}
                getQuranFontFamily={getQuranFontFamily}
                onExpandedChange={setIsVariationBottomSheetExpanded}
                registerTranslateY={setSheetTranslateY}
                onSelectVariation={(variation, { pageNum, wordId }) => {
                  setLastSelectedVariationHighlight(
                    wordId != null ? { wordId, pageNum } : null
                  );
                  setCurrentPage(pageNum);
                  setPageInput(String(pageNum));
                  handlePageChange(String(pageNum));
                  setSelectedWordId(wordId ?? null);
                  setSelectedWord(
                    variation.word
                      ? { id: variation.word.id, content: variation.word.content }
                      : null
                  );
                }}
              />

              {/* Bottom bar always visible; empty-state content lives inside this same container */}
              <Animated.View
                style={[
                  styles.variationTraversalBar,
                  !firstSelectedNarratorId && styles.variationTraversalBarEmpty,
                  showTraversalBarListenBadges &&
                    (traversalChipSegmentPlayable.hafs === true ||
                      traversalChipSegmentPlayable.comparison === true) &&
                    styles.variationTraversalBarListenBadgeOverflow,
                  {
                    paddingBottom:
                      (firstSelectedNarratorId
                        ? RECITE_BOTTOM_BAR_PADDING_BOTTOM +
                          (showOffPageTraversalUI
                            ? OFF_PAGE_TRAVERSAL_BAR_BOTTOM_PAD_EXTRA
                            : 0)
                        : 0) + bottomBarInset,
                  },
                  barVisibleStyle,
                ]}
                onStartShouldSetResponder={() => true}
                onResponderRelease={() => {
                  if (firstSelectedNarratorId && allMushafVariations.length > 0) {
                    setIsVariationBottomSheetVisible(true);
                  }
                }}
              >
                {firstSelectedNarratorId && (
                  /* Left arrow - next variation */
                  <TouchableOpacity
                    style={[
                      styles.variationTraversalArrowButton,
                      narratorVariations.length === 0 && styles.variationTraversalArrowButtonDisabled,
                    ]}
                    disabled={narratorVariations.length === 0}
                    onPress={() => {
                      if (narratorVariations.length === 0) return;
                      const next =
                        (currentVariationIndex + 1) % narratorVariations.length;
                      const v = narratorVariations[next];
                      const pageNum = v.word?.line?.page?.position ?? currentPage;
                      setLastSelectedVariationHighlight(
                        v?.word?.id ? { wordId: v.word.id, pageNum } : null
                      );
                      setCurrentPage(pageNum);
                      setPageInput(String(pageNum));
                      handlePageChange(String(pageNum));
                      if (v?.word?.id) {
                        setSelectedWordId(v.word.id);
                        setSelectedWord({ id: v.word.id, content: v.word.content });
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.variationTraversalArrowButtonText,
                        narratorVariations.length === 0 && styles.variationTraversalArrowDisabled,
                      ]}
                    >
                      ‹
                    </Text>
                  </TouchableOpacity>
                )}

                {firstSelectedNarratorId ? (
                  showOffPageTraversalUI ? (
                    <View
                      style={[
                        styles.variationTraversalSegmentedControl,
                        styles.variationTraversalOffPageSegmented,
                      ]}
                    >
                      <TouchableOpacity
                        style={[
                          styles.variationTraversalOffPageCard,
                          styles.variationTraversalOffPageCardNext,
                        ]}
                        activeOpacity={0.72}
                        onPress={() => {
                          const v = offPageNextVariation;
                          if (!v) return;
                          const pageNum = v.word?.line?.page?.position ?? currentPage;
                          setLastSelectedVariationHighlight(
                            v?.word?.id != null ? { wordId: v.word.id, pageNum } : null
                          );
                          setCurrentPage(pageNum);
                          setPageInput(String(pageNum));
                          handlePageChange(String(pageNum));
                          if (v?.word?.id != null) {
                            setSelectedWordId(v.word.id);
                            setSelectedWord({ id: v.word.id, content: v.word.content });
                          }
                        }}
                      >
                        <Text style={styles.variationTraversalOffPageHeading}>
                          Next Difference:
                        </Text>
                        <View
                          style={[
                            styles.variationTraversalOffPageWordWrap,
                            {
                              borderColor:
                                selectedTraversalNarrators[0]?.highlightColor ?? "#f5a623",
                            },
                          ]}
                        >
                          <Text
                            style={[
                              styles.variationTraversalOffPageWord,
                              { fontFamily: getQuranFontFamily(mushafId) },
                            ]}
                            numberOfLines={1}
                          >
                            {offPageNextVariation?.word?.content ?? "—"}
                          </Text>
                        </View>
                        <Text style={styles.variationTraversalOffPagePage}>
                          Pg. {offPageNextVariation?.word?.line?.page?.position ?? "—"}
                        </Text>
                      </TouchableOpacity>
                      <TouchableOpacity
                        style={[
                          styles.variationTraversalOffPageCard,
                          styles.variationTraversalOffPageCardPrev,
                        ]}
                        activeOpacity={0.72}
                        onPress={() => {
                          const v = offPagePrevVariation;
                          if (!v) return;
                          const pageNum = v.word?.line?.page?.position ?? currentPage;
                          setLastSelectedVariationHighlight(
                            v?.word?.id != null ? { wordId: v.word.id, pageNum } : null
                          );
                          setCurrentPage(pageNum);
                          setPageInput(String(pageNum));
                          handlePageChange(String(pageNum));
                          if (v?.word?.id != null) {
                            setSelectedWordId(v.word.id);
                            setSelectedWord({ id: v.word.id, content: v.word.content });
                          }
                        }}
                      >
                        <View
                          style={styles.variationTraversalOffPagePrevBg}
                          pointerEvents="none"
                        />
                        <View style={styles.variationTraversalOffPagePrevContent}>
                          <Text style={styles.variationTraversalOffPageHeading}>
                            Prev Difference:
                          </Text>
                          <View
                            style={[
                              styles.variationTraversalOffPageWordWrap,
                              {
                                borderColor:
                                  selectedTraversalNarrators[0]?.highlightColor ?? "#f5a623",
                              },
                            ]}
                          >
                            <Text
                              style={[
                                styles.variationTraversalOffPageWord,
                                { fontFamily: getQuranFontFamily(mushafId) },
                              ]}
                              numberOfLines={1}
                            >
                              {offPagePrevVariation?.word?.content ?? "—"}
                            </Text>
                          </View>
                          <Text style={styles.variationTraversalOffPagePage}>
                            Pg. {offPagePrevVariation?.word?.line?.page?.position ?? "—"}
                          </Text>
                        </View>
                      </TouchableOpacity>
                    </View>
                  ) : (
                    <View style={styles.variationTraversalSegmentedControl}>
                      <TouchableOpacity
                        style={[
                          styles.variationTraversalCard,
                          showTraversalBarListenBadges &&
                            traversalChipSegmentPlayable.hafs === true &&
                            styles.variationTraversalCardBadgeOverflow,
                        ]}
                        activeOpacity={0.72}
                        disabled={narratorVariations.length === 0}
                        onPress={() => {
                          console.log("traversal-chip:hafs-card-press");
                          goToActiveTraversalVariationPage({ type: "hafs" });
                        }}
                      >
                        <Text style={styles.variationTraversalCardLabel}>Hafs</Text>
                        <View
                          style={[
                            styles.variationTraversalCardWordWrap,
                            showTraversalBarListenBadges &&
                              traversalChipSegmentPlayable.hafs === true &&
                              styles.variationTraversalCardWordWrapWithBadge,
                          ]}
                        >
                          <Text
                            style={[
                              styles.variationTraversalCardWord,
                              { fontFamily: getQuranFontFamily(mushafId) },
                            ]}
                            numberOfLines={1}
                          >
                            {activeHafsTraversalText}
                          </Text>
                          {chipClipTraversalProgress != null &&
                          activeListenTrack?.chipClipSource?.type === "hafs" ? (
                            <View
                              style={styles.variationTraversalChipClipOverlay}
                              pointerEvents="none"
                            >
                              <View style={styles.variationTraversalChipClipOverlayTrack} />
                              <View
                                style={[
                                  styles.variationTraversalChipClipOverlayFill,
                                  {
                                    width: `${Math.round(chipClipTraversalProgress * 1000) / 10}%`,
                                  },
                                ]}
                              />
                            </View>
                          ) : null}
                          {showTraversalBarListenBadges &&
                          traversalChipSegmentPlayable.hafs === true ? (
                            <View style={styles.traversalCardListenBadge} pointerEvents="none">
                              <View style={styles.traversalCardListenBadgeInner}>
                                {chipClipLoadingBadge?.kind === "traversal-hafs" ? (
                                  <ActivityIndicator
                                    color="#ffffff"
                                    style={styles.traversalCardListenBadgeSpinner}
                                  />
                                ) : (
                                  <Volume2
                                    stroke="#ffffff"
                                    width={11}
                                    height={11}
                                    strokeWidth={2.05}
                                  />
                                )}
                              </View>
                            </View>
                          ) : null}
                        </View>
                      </TouchableOpacity>
                      <Text style={styles.variationTraversalSwapIcon}>↔</Text>
                      {traversalNarratorCards.map((card) => (
                        <TouchableOpacity
                          key={`traversal-card-${card.id}`}
                          style={[
                            styles.variationTraversalCard,
                            styles.variationTraversalCardNarrator,
                            showTraversalBarListenBadges &&
                              traversalChipSegmentPlayable.comparison === true &&
                              styles.variationTraversalCardBadgeOverflow,
                          ]}
                          activeOpacity={0.72}
                          disabled={narratorVariations.length === 0}
                          onPress={() => {
                            console.log(`traversal-chip:narrator-card-press:${card.id}`);
                            goToActiveTraversalVariationPage({
                              type: "comparison",
                              narratorId: card.id,
                              narratorTitle: card.title,
                            });
                          }}
                        >
                          <Text style={styles.variationTraversalCardLabel}>{card.title}</Text>
                          <View
                            style={[
                              styles.variationTraversalCardWordWrap,
                              styles.variationTraversalCardWordWrapNarrator,
                              showTraversalBarListenBadges &&
                                traversalChipSegmentPlayable.comparison === true &&
                                styles.variationTraversalCardWordWrapWithBadge,
                              { borderColor: card.highlightColor },
                            ]}
                          >
                            <Text
                              style={[
                                styles.variationTraversalCardWord,
                                styles.variationTraversalCardWordActive,
                                { fontFamily: getQuranFontFamily(mushafId) },
                              ]}
                              numberOfLines={1}
                            >
                              {card.content}
                            </Text>
                            {chipClipTraversalProgress != null &&
                            activeListenTrack?.chipClipSource?.type === "comparison" &&
                            String(activeListenTrack.chipClipSource.narratorId) ===
                              String(card.id) ? (
                              <View
                                style={styles.variationTraversalChipClipOverlay}
                                pointerEvents="none"
                              >
                                <View style={styles.variationTraversalChipClipOverlayTrack} />
                                <View
                                  style={[
                                    styles.variationTraversalChipClipOverlayFill,
                                    {
                                      width: `${Math.round(chipClipTraversalProgress * 1000) / 10}%`,
                                    },
                                  ]}
                                />
                              </View>
                            ) : null}
                            {showTraversalBarListenBadges &&
                            traversalChipSegmentPlayable.comparison === true ? (
                              <View style={styles.traversalCardListenBadge} pointerEvents="none">
                                <View style={styles.traversalCardListenBadgeInner}>
                                  {chipClipLoadingBadge?.kind === "traversal-comparison" &&
                                  String(chipClipLoadingBadge.narratorId) === String(card.id) ? (
                                    <ActivityIndicator
                                      color="#ffffff"
                                      style={styles.traversalCardListenBadgeSpinner}
                                    />
                                  ) : (
                                    <Volume2
                                      stroke="#ffffff"
                                      width={11}
                                      height={11}
                                      strokeWidth={2.05}
                                    />
                                  )}
                                </View>
                              </View>
                            ) : null}
                          </View>
                        </TouchableOpacity>
                      ))}
                    </View>
                  )
                ) : (
                  <TouchableOpacity
                    style={styles.noRiwayahBannerInTraversal}
                    onPress={openDrawer}
                    activeOpacity={0.8}
                  >
                    <View style={styles.noRiwayahBannerIcon}>
                      <Text style={styles.noRiwayahBannerIconText}>+</Text>
                    </View>
                    <View style={styles.noRiwayahBannerText}>
                      <Text style={styles.noRiwayahBannerTitle}>No Riwaayah Selected</Text>
                      <Text style={styles.noRiwayahBannerSubtitle}>
                        Open menu to compare recitations
                      </Text>
                    </View>
                  </TouchableOpacity>
                )}

                {firstSelectedNarratorId && (
                  /* Right arrow - previous variation */
                  <TouchableOpacity
                    style={[
                      styles.variationTraversalArrowButton,
                      narratorVariations.length === 0 && styles.variationTraversalArrowButtonDisabled,
                    ]}
                    disabled={narratorVariations.length === 0}
                    onPress={() => {
                      if (narratorVariations.length === 0) return;
                      const prev =
                        (currentVariationIndex - 1 + narratorVariations.length) %
                        narratorVariations.length;
                      const v = narratorVariations[prev];
                      const pageNum = v.word?.line?.page?.position ?? currentPage;
                      setLastSelectedVariationHighlight(
                        v?.word?.id ? { wordId: v.word.id, pageNum } : null
                      );
                      setCurrentPage(pageNum);
                      setPageInput(String(pageNum));
                      handlePageChange(String(pageNum));
                      if (v?.word?.id) {
                        setSelectedWordId(v.word.id);
                        setSelectedWord({ id: v.word.id, content: v.word.content });
                      }
                    }}
                  >
                    <Text
                      style={[
                        styles.variationTraversalArrowButtonText,
                        narratorVariations.length === 0 && styles.variationTraversalArrowDisabled,
                      ]}
                    >
                      ›
                    </Text>
                  </TouchableOpacity>
                )}
              </Animated.View>
            </View>
                </View>

                <View style={{ width: screenWidth, flex: 1, position: "relative" }}>
                  {listenColumnMounted ? (
                    <>
                      <View style={styles.listenContainer}>
                        <ScrollView
                          contentContainerStyle={[
                            styles.listenScrollContent,
                            styles.listenScrollContentWithBottomNav,
                            listenPlayerVisible && styles.listenScrollContentWithPlayer,
                          ]}
                          showsVerticalScrollIndicator={false}
                        >
                          <View style={styles.listenSection}>
                            <Text style={styles.listenSectionTitle}>Quran Library</Text>
                            <Text style={styles.listenSectionSubtitle}>
                              {listenReciterDisplayName(listenReciters, selectedListenReciter)}
                            </Text>
                            <View style={styles.listenFilterRow}>
                              <TouchableOpacity
                                style={styles.listenFilterChip}
                                onPress={() =>
                                  setSelectedListenReciter((prev) => {
                                    if (prev === "all") {
                                      return listenReciters[0]?.slug || DEFAULT_LISTEN_RECITER_SLUG;
                                    }
                                    return "all";
                                  })
                                }
                                activeOpacity={0.85}
                              >
                                <Text style={styles.listenFilterChipLabel}>Reciter</Text>
                                <Text style={styles.listenFilterChipValue} numberOfLines={1}>
                                  {selectedListenReciter === "all"
                                    ? "All"
                                    : listenReciterDisplayName(listenReciters, selectedListenReciter)}
                                </Text>
                              </TouchableOpacity>

                              <ScrollView
                                horizontal
                                showsHorizontalScrollIndicator={false}
                                contentContainerStyle={styles.listenNarratorPills}
                              >
                                {listenNarratorOptions.map((option) => {
                                  const selected = selectedListenNarrator === option.id;
                                  return (
                                    <TouchableOpacity
                                      key={option.id}
                                      style={[
                                        styles.listenNarratorPill,
                                        selected && styles.listenNarratorPillSelected,
                                      ]}
                                      onPress={() => setSelectedListenNarrator(option.id)}
                                      activeOpacity={0.85}
                                    >
                                      <Text
                                        style={[
                                          styles.listenNarratorPillText,
                                          selected && styles.listenNarratorPillTextSelected,
                                        ]}
                                      >
                                        {option.label}
                                      </Text>
                                    </TouchableOpacity>
                                  );
                                })}
                              </ScrollView>

                              <View style={styles.listenSurahInputWrap}>
                                <Text style={styles.listenSurahInputLabel}>Surah</Text>
                                <TextInput
                                  value={listenSurahQuery}
                                  onChangeText={setListenSurahQuery}
                                  placeholder="Search name or #"
                                  placeholderTextColor="#94a3b8"
                                  style={styles.listenSurahInput}
                                />
                              </View>
                            </View>

                            <View style={styles.listenGrid}>
                              {listenCatalogLoading ? (
                                <ActivityIndicator size="large" color="#64748b" style={{ marginTop: 24 }} />
                              ) : listenCatalogError ? (
                                <Text style={styles.listenEmptyText}>{listenCatalogError}</Text>
                              ) : listenFilteredRows.length === 0 ? (
                                <Text style={styles.listenEmptyText}>No surahs match these filters.</Text>
                              ) : (
                                listenFilteredRows.map((row, rowIndex) => (
                                  <View key={`listen-row-filtered-${rowIndex}`} style={styles.listenGridRow}>
                                    {row.map((track) => {
                                      const isActive = activeListenTrack?.trackKey === track.trackKey;
                                      const narratorMeta = listenNarratorMetaById[track.riwayahId] || {
                                        label: track.riwayahLabel || "Narrator",
                                        color: "#334155",
                                      };
                                      const recRow = listenReciters.find((r) => r.slug === track.reciterSlug);
                                      return (
                                        <TouchableOpacity
                                          key={`listen-track-${track.trackKey}`}
                                          style={styles.listenCard}
                                          activeOpacity={0.85}
                                          onPress={() => handlePlayListenTrack(track)}
                                        >
                                          <View style={styles.listenThumb}>
                                            <Image
                                              source={listenReciterAvatarSource(
                                                recRow || { slug: track.reciterSlug, avatar_url: "" }
                                              )}
                                              style={styles.listenThumbImage}
                                              resizeMode="cover"
                                            />
                                            <View style={styles.listenPlayBadge}>
                                              <Text style={styles.listenPlayBadgeText}>
                                                {isActive && listenIsPlaying ? "❚❚" : "▶"}
                                              </Text>
                                            </View>
                                          </View>
                                          <Text style={styles.listenCardTitle} numberOfLines={1}>
                                            {`Surah ${track.index}`}
                                          </Text>
                                          <Text style={styles.listenCardSubtitle} numberOfLines={1}>
                                            {track.name}
                                          </Text>
                                          <View
                                            style={[
                                              styles.listenNarratorBadge,
                                              { backgroundColor: narratorMeta.color },
                                            ]}
                                          >
                                            <Text style={styles.listenNarratorBadgeText} numberOfLines={1}>
                                              {narratorMeta.label}
                                            </Text>
                                          </View>
                                        </TouchableOpacity>
                                      );
                                    })}
                                  </View>
                                ))
                              )}
                            </View>
                          </View>
                        </ScrollView>
                      </View>
                      <View style={styles.listenPersistentBottomNav}>
                        <TouchableOpacity style={styles.drawerNavButton} onPress={goToReciteTabAnimated}>
                          <Text
                            style={[styles.drawerNavIcon, chromeTab === "Recite" && styles.drawerNavIconActive]}
                          >
                            📖
                          </Text>
                          <Text
                            style={[styles.drawerNavLabel, chromeTab === "Recite" && styles.drawerNavLabelActive]}
                          >
                            Mushaf
                          </Text>
                        </TouchableOpacity>

                        <TouchableOpacity style={styles.drawerNavButton} onPress={goToListenTabAnimated}>
                          <Text
                            style={[styles.drawerNavIcon, chromeTab === "Listen" && styles.drawerNavIconActive]}
                          >
                            🎧
                          </Text>
                          <Text
                            style={[styles.drawerNavLabel, chromeTab === "Listen" && styles.drawerNavLabelActive]}
                          >
                            Recitation
                          </Text>
                        </TouchableOpacity>
                      </View>
                    </>
                  ) : (
                    <View style={{ flex: 1 }} />
                  )}
                </View>
              </Animated.View>
            </View>
          )}

          {currentTab === "Learn" && (
            <View style={styles.learnContainer}>
              {!selectedVideo ? (
                <ScrollView
                  contentContainerStyle={styles.learnScrollContent}
                  showsVerticalScrollIndicator={false}
                >
                  {Array.from({ length: 5 }).map((_, sectionIdx) => (
                    <View
                      key={`section-${sectionIdx}`}
                      style={styles.learnSection}
                    >
                      <Text style={styles.learnSectionTitle}>{`Course ${
                        sectionIdx + 1
                      }`}</Text>
                      <ScrollView
                        horizontal
                        showsHorizontalScrollIndicator={false}
                        contentContainerStyle={styles.learnRow}
                      >
                        {Array.from({ length: 10 }).map((__, videoIdx) => {
                          const title = `Lesson ${videoIdx + 1}`;
                          return (
                            <TouchableOpacity
                              key={`video-${sectionIdx}-${videoIdx}`}
                              style={styles.videoCard}
                              onPress={() => setSelectedVideo({ title })}
                            >
                              <View style={styles.videoThumb}>
                                <View style={styles.playTriangle} />
                              </View>
                              <Text style={styles.videoTitle} numberOfLines={2}>
                                {title}
                              </Text>
                            </TouchableOpacity>
                          );
                        })}
                      </ScrollView>
                    </View>
                  ))}
                </ScrollView>
              ) : (
                <ScrollView
                  contentContainerStyle={styles.learnDetailContent}
                  showsVerticalScrollIndicator={false}
                >
                  <View style={styles.learnDetailHeader}>
                    <TouchableOpacity
                      style={styles.backButton}
                      onPress={() => setSelectedVideo(null)}
                    >
                      <Text style={styles.backArrow}>←</Text>
                    </TouchableOpacity>
                    <Text style={styles.learnDetailTitle}>
                      {selectedVideo.title}
                    </Text>
                    <View style={{ width: 28 }} />
                  </View>

                  <View style={styles.learnVideoWrapper}>
                    <View style={styles.learnVideoSquare}>
                      <View style={styles.playTriangleLarge} />
                    </View>
                  </View>

                  <View style={styles.learnActionRow}>
                    <TouchableOpacity style={styles.learnActionBtn}>
                      <Text style={styles.learnActionIcon}>♡</Text>
                      <Text style={styles.learnActionLabel}>Favorite</Text>
                    </TouchableOpacity>
                    <TouchableOpacity style={styles.learnActionBtn}>
                      <Text style={styles.learnActionIcon}>?</Text>
                      <Text style={styles.learnActionLabel}>Question</Text>
                    </TouchableOpacity>
                  </View>

                  <Text style={styles.learnDescription}>
                    Lorem ipsum dolor sit amet, consectetur adipiscing elit. Sed
                    do eiusmod tempor incididunt ut labore et dolore magna
                    aliqua. Ut enim ad minim veniam, quis nostrud exercitation
                    ullamco laboris nisi ut aliquip ex ea commodo consequat.
                    Duis aute irure dolor in reprehenderit in voluptate velit
                    esse cillum dolore eu fugiat nulla pariatur.
                  </Text>
                </ScrollView>
              )}
            </View>
          )}
        </View>
        </SafeAreaViewEdged>

      {listenPlayerVisible && activeListenTrack && !isDrawerPlayerCompact && (
        <Animated.View
          style={[
            styles.globalListenPlayer,
            {
              transform: [
                { translateX: listenPlayerDrag.x },
                { translateY: listenPlayerDrag.y },
              ],
            },
          ]}
          onLayout={(e) => {
            const { width, height } = e.nativeEvent.layout || {};
            if (!width || !height) return;
            if (
              width !== listenPlayerLayout.width ||
              height !== listenPlayerLayout.height
            ) {
              setListenPlayerLayout({ width, height });
            }
          }}
        >
          <>
            <View style={styles.globalListenPlayerTop} {...listenPlayerPanResponder.panHandlers}>
              <View style={styles.globalListenPlayerMeta}>
                <Image
                  source={listenReciterAvatarSource(
                    activeListenReciterForPlayer || {
                      slug: activeListenTrack.reciterSlug,
                      avatar_url: "",
                    }
                  )}
                  style={styles.globalListenPlayerAvatar}
                />
                <View style={styles.globalListenPlayerMetaText}>
                  <Text style={styles.globalListenPlayerTitle} numberOfLines={1}>
                    {`Surah ${activeListenTrack.index} · ${activeListenTrack.name}`}
                  </Text>
                  <Text style={styles.globalListenPlayerSubtitle} numberOfLines={1}>
                    {`${activeListenTrack.reciterSlug || ""} · ${activeListenTrack.riwayahLabel || ""}`}
                  </Text>
                </View>
              </View>
              <TouchableOpacity
                onPress={handleCloseListenPlayer}
                style={styles.globalListenPlayerClose}
                accessibilityRole="button"
                accessibilityLabel="Close global recitation player"
              >
                <Text style={styles.globalListenPlayerCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            <Slider
              value={listenPositionMs}
              minimumValue={0}
              maximumValue={Math.max(listenDurationMs, 1)}
              onSlidingComplete={handleSeekListenTrack}
              minimumTrackTintColor="#111"
              maximumTrackTintColor="#d0d4da"
              thumbTintColor="#111"
              thumbStyle={styles.globalListenPlayerThumb}
              trackStyle={styles.globalListenPlayerTrack}
              containerStyle={styles.globalListenPlayerSlider}
            />
            <View style={styles.globalListenPlayerTimeRow}>
              <Text style={styles.globalListenPlayerTime}>{formatListenTime(listenPositionMs)}</Text>
              <TouchableOpacity
                onPress={() => activeListenTrack && handlePlayListenTrack(activeListenTrack)}
                style={styles.globalListenPlayerToggle}
              >
                <Text style={styles.globalListenPlayerToggleText}>
                  {listenIsPlaying ? "Pause" : "Play"}
                </Text>
              </TouchableOpacity>
              <Text style={styles.globalListenPlayerTime}>{formatListenTime(listenDurationMs)}</Text>
            </View>
          </>
        </Animated.View>
      )}

      {isDrawerVisible && (!isListenTab || canShowListenSidebar) && (
        <View style={styles.drawerOverlay}>
          <Pressable
            style={styles.drawerBackdropPressable}
            onPressIn={() => closeDrawer()}
            pointerEvents="auto"
          >
            <Animated.View
              pointerEvents="none"
              style={[styles.drawerBackdropFill, { opacity: backdropAnim }]}
            />
          </Pressable>
          <DrawerAnimatedPanel
            drawerAnim={drawerAnim}
            alignWithMushafContent={!isListenTab}
          >
            <View style={styles.drawerHeader}>
              <View style={styles.drawerHeaderTop}>
                <TouchableOpacity
                  style={styles.drawerHeaderIcon}
                  onPress={() => setIsQiraatSettingsVisible(true)}
                  accessibilityRole="button"
                  accessibilityLabel="Open Qiraat settings"
                >
                  <Text style={styles.drawerHeaderIconText}>⚙️</Text>
                </TouchableOpacity>
                <View style={styles.drawerHeaderTextContainer}>
                  <Text style={styles.drawerTitle}>القراءات</Text>
                </View>
              </View>
              {(() => {
                // Check if there are any narrators selected besides Hafs
                const hasOtherNarrators = selectedNarrators.some(id => id !== "hafs-an-asim");
                const isDisabled = !hasOtherNarrators;
                
                return (
                  <TouchableOpacity
                    style={[
                      styles.resetButton,
                      isDisabled && styles.resetButtonDisabled,
                    ]}
                    onPress={isDisabled ? undefined : handleResetToHafs}
                    activeOpacity={isDisabled ? 1 : 0.7}
                    disabled={isDisabled}
                  >
                    <Text style={[
                      styles.resetButtonIcon,
                      isDisabled && styles.resetButtonIconDisabled,
                    ]}>↻</Text>
                    <Text style={[
                      styles.resetButtonText,
                      isDisabled && styles.resetButtonTextDisabled,
                    ]}>Reset to Hafs</Text>
                  </TouchableOpacity>
                );
              })()}
            </View>
            <ScrollView
              contentContainerStyle={styles.drawerNarratorsContent}
              showsVerticalScrollIndicator={false}
            >
              {/* Parent narrators with children */}
              {parentNarrators.map((parent) => {
                const isExpanded = expandedParents.has(parent.id);
                return (
                  <View key={parent.id} style={styles.parentCard}>
                  <TouchableOpacity
                      style={styles.parentCardHeader}
                      onPress={() => handleToggleParent(parent.id)}
                      activeOpacity={0.7}
                    >
                      <View style={styles.parentCardInfo}>
                        <Text style={styles.parentCardTitle}>{parent.title}</Text>
                        <View style={styles.parentCardLocation}>
                          <Text style={styles.locationIcon}>📍</Text>
                          <Text style={styles.parentCardLocationText}>
                            {parent.region?.title || ""}
                          </Text>
                        </View>
                      </View>
                      <Text style={styles.chevronIcon}>
                        {isExpanded ? "▼" : "▶"}
                      </Text>
                    </TouchableOpacity>
                    {isExpanded && (
                      <View style={styles.childrenContainer}>
                        <View style={styles.childrenVerticalLine} />
                        <View style={styles.childrenContent}>
                          {parent.children.map((child) => {
                            const isHafs = child.id === "hafs-an-asim";
                            const isSelected = selectedNarrators.includes(child.id);
                            const ChildComponent = isHafs ? View : TouchableOpacity;
                            return (
                              <ChildComponent
                                key={child.id}
                    style={[
                                  styles.childCard,
                                  isSelected && styles.childCardSelected,
                                  isHafs && styles.childCardDisabled,
                                ]}
                                onPress={isHafs ? undefined : () => handleToggleNarrator(child.id)}
                                activeOpacity={isHafs ? 1 : 0.7}
                              >
                                <View style={styles.childCardContent}>
                                  <View style={styles.childCardInfo}>
                                    <Text style={styles.childCardTitle}>
                                      {child.title}
                                    </Text>
                                    <View style={styles.childCardLocation}>
                                      <Text style={styles.locationIcon}>📍</Text>
                                      <Text style={styles.childCardLocationText}>
                                        {child.region?.title || ""}
                                      </Text>
                                    </View>
                                  </View>
                      <View
                        style={[
                          styles.drawerCheckbox,
                                      isHafs && styles.drawerCheckboxDisabled,
                                      isSelected && !isHafs && styles.drawerCheckboxSelected,
                                      isSelected && isHafs && styles.drawerCheckboxDisabledSelected,
                        ]}
                      >
                                    {isSelected && (
                                      <Text style={styles.drawerCheckmark}>✓</Text>
                                    )}
                      </View>
                                </View>
                                {isSelected && !isHafs && child.highlight_color && (
                                  <View
                        style={[
                                      styles.childCardBar,
                                      { backgroundColor: child.highlight_color },
                                    ]}
                                  />
                                )}
                              </ChildComponent>
                            );
                          })}
                    </View>
                      </View>
                    )}
                  </View>
                );
              })}
            </ScrollView>
          </DrawerAnimatedPanel>
          {!isListenTab && (
            <Animated.View
              style={[
                styles.drawerBottomNav,
                { transform: [{ translateY: drawerBottomNavAnim }] },
              ]}
            >
              <TouchableOpacity
                style={styles.drawerNavButton}
                onPress={() => {
                  if (currentTab === "Listen") {
                    closeDrawer({
                      onClosed: () => goToReciteTabAnimated(),
                    });
                  } else {
                    tabSlideAnim.setValue(0);
                    if (currentTab !== "Recite") setCurrentTab("Recite");
                    closeDrawer();
                  }
                }}
              >
                <Text style={[styles.drawerNavIcon, chromeTab === "Recite" && styles.drawerNavIconActive]}>
                  📖
                </Text>
                <Text style={[styles.drawerNavLabel, chromeTab === "Recite" && styles.drawerNavLabelActive]}>
                  Mushaf
                </Text>
              </TouchableOpacity>

              <TouchableOpacity
                style={styles.drawerNavButton}
                onPress={() => {
                  closeDrawer({
                    animateBottomNav: false,
                    onClosed: () => goToListenTabAnimated(),
                  });
                }}
              >
                <Text style={[styles.drawerNavIcon, chromeTab === "Listen" && styles.drawerNavIconActive]}>
                  🎧
                </Text>
                <Text style={[styles.drawerNavLabel, chromeTab === "Listen" && styles.drawerNavLabelActive]}>
                  Recitation
                </Text>
              </TouchableOpacity>
            </Animated.View>
          )}
          {listenPlayerVisible && activeListenTrack && isDrawerPlayerCompact && (
            <View style={[styles.globalListenPlayer, styles.globalListenPlayerDrawerCompact]}>
              <TouchableOpacity
                onPress={handleCloseListenPlayer}
                style={styles.globalListenPlayerCompactClose}
                accessibilityRole="button"
                accessibilityLabel="Close global recitation player"
              >
                <Text style={styles.globalListenPlayerCloseText}>✕</Text>
              </TouchableOpacity>
              <Image
                source={listenReciterAvatarSource(
                  activeListenReciterForPlayer || {
                    slug: activeListenTrack.reciterSlug,
                    avatar_url: "",
                  }
                )}
                style={styles.globalListenPlayerCompactAvatar}
              />
              <Slider
                value={listenPositionMs}
                minimumValue={0}
                maximumValue={Math.max(listenDurationMs, 1)}
                onSlidingComplete={handleSeekListenTrack}
                minimumTrackTintColor="#111"
                maximumTrackTintColor="#d0d4da"
                thumbTintColor="#111"
                thumbStyle={styles.globalListenPlayerCompactThumb}
                trackStyle={styles.globalListenPlayerCompactTrack}
                containerStyle={styles.globalListenPlayerCompactSlider}
              />
              <TouchableOpacity
                onPress={() => activeListenTrack && handlePlayListenTrack(activeListenTrack)}
                style={styles.globalListenPlayerCompactToggle}
              >
                <Text style={styles.globalListenPlayerCompactToggleText}>
                  {listenIsPlaying ? "❚❚" : "▶"}
                </Text>
              </TouchableOpacity>
            </View>
          )}
        </View>
      )}

      {/* Variations sidebar - right-sliding, lists all narration changes for mushaf traversal */}
      {isVariationsSidebarOpen && (
        <SafeAreaView style={styles.variationsSidebarOverlay} pointerEvents="box-none">
          <Pressable style={StyleSheet.absoluteFill} onPress={closeVariationsSidebar}>
            <Animated.View
              style={[
                StyleSheet.absoluteFill,
                styles.variationsSidebarBackdrop,
                { opacity: variationsSidebarBackdropAnim },
              ]}
            />
          </Pressable>
          <Animated.View
            style={[
              styles.variationsSidebarPanel,
              { transform: [{ translateX: variationsSidebarAnim }] },
            ]}
          >
            <View style={styles.variationsSidebarHeader}>
              <Text style={styles.variationsSidebarTitle}>Narration Changes</Text>
              <TouchableOpacity onPress={closeVariationsSidebar} style={styles.variationsSidebarClose}>
                <Text style={styles.variationsSidebarCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            {allMushafVariations.length === 0 ? (
              <View style={styles.variationsSidebarEmpty}>
                <Text style={styles.variationsSidebarEmptyText}>
                  {selectedNarrators.length === 0
                    ? "Select narrators from the menu to see differences"
                    : "No variations found for selected narrators"}
                </Text>
              </View>
            ) : (
              <ScrollView
                ref={variationsSidebarScrollRef}
                style={styles.variationsSidebarList}
                contentContainerStyle={styles.variationsSidebarListContent}
                showsVerticalScrollIndicator={true}
                onScroll={(e) => {
                  variationsSidebarScrollOffsetRef.current =
                    e.nativeEvent.contentOffset.y;
                }}
                scrollEventThrottle={100}
              >
                {allMushafVariations.map((variation) => {
                  const pageNum = variation.word?.line?.page?.position ?? 0;
                  const narratorTitle = variation.narrator?.title ?? "";
                  const originalText = variation.word?.content ?? "";
                  const variationText = variation.content ?? "";
                  const wordId = variation.word?.id;
                  const isActiveItem =
                    lastSelectedVariationHighlight &&
                    currentPage === lastSelectedVariationHighlight.pageNum &&
                    wordId === lastSelectedVariationHighlight.wordId;
                  return (
                    <TouchableOpacity
                      key={`${variation.word_id}-${variation.narrator_id}`}
                      style={[styles.variationsSidebarItem, isActiveItem && styles.variationsSidebarItemActive]}
                      onPress={() => {
                        setLastSelectedVariationHighlight(
                          wordId != null ? { wordId, pageNum } : null
                        );
                        setCurrentPage(pageNum);
                        setPageInput(String(pageNum));
                        handlePageChange(String(pageNum));
                        setSelectedWordId(wordId ?? null);
                        setSelectedWord(
                          variation.word
                            ? { id: variation.word.id, content: variation.word.content }
                            : null
                        );
                        closeVariationsSidebar();
                      }}
                      activeOpacity={0.7}
                    >
                      <Text style={styles.variationsSidebarItemPage}>Page {pageNum}</Text>
                      <View style={styles.variationsSidebarItemRow}>
                        <View style={styles.variationsSidebarItemBlock}>
                          <Text style={styles.variationsSidebarItemLabel}>Hafs</Text>
                          <View style={styles.variationsSidebarChipUnselected}>
                            <Text
                              style={[styles.variationsSidebarChipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                              numberOfLines={1}
                            >
                              {originalText}
                            </Text>
                          </View>
                        </View>
                        <Text style={styles.variationsSidebarItemArrow}>›</Text>
                        <View style={styles.variationsSidebarItemBlock}>
                          <Text style={styles.variationsSidebarItemLabel}>{narratorTitle}</Text>
                          <View style={styles.variationsSidebarChipSelected}>
                            <Text
                              style={[styles.variationsSidebarChipText, { fontFamily: getQuranFontFamily(mushafId) }]}
                              numberOfLines={1}
                            >
                              {variationText}
                            </Text>
                          </View>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
            )}
          </Animated.View>
        </SafeAreaView>
      )}

      <NarratorPopup
        visible={popupVisible}
        onClose={handleClosePopup}
        narrators={narrators.filter((narrator) => narrator.id !== "hafs-an-asim")}
        selectedNarrator={selectedNarrator}
        onSelectNarrator={handleSelectNarrator}
        inputValue={inputValue}
        onInputChange={setInputValue}
        position={wordPosition}
        selectedWord={selectedWord}
        savedVariations={savedVariations}
        allVariations={allVariations}
        variationImalah={
          selectedWord && selectedNarrator
            ? (() => {
                const v = allVariations[`${selectedWord.id}-${selectedNarrator.id}`];
                return typeof v === "object" && v && v.imalah ? v.imalah : null;
              })()
            : null
        }
        variationDiamond={
          selectedWord && selectedNarrator
            ? (() => {
                const v = allVariations[`${selectedWord.id}-${selectedNarrator.id}`];
                return typeof v === "object" && v && v.diamond ? v.diamond : null;
              })()
            : null
        }
        onSaveVariation={handleSaveVariation}
        onDeleteVariation={handleDeleteVariation}
        mushafId={mushafId}
        currentSurahNumber={
          goToPageSurahCarouselEntries[currentSurahIndex]?.surahNumber ?? null
        }
        isShubahHighlight={isShubahHighlight}
      />

      <QiraatSettingsModal
        visible={isQiraatSettingsVisible}
        onClose={() => setIsQiraatSettingsVisible(false)}
        isDarkMode={isMushafDarkMode}
        onToggleDarkMode={setIsMushafDarkMode}
        mushafId={mushafId}
        onMushafChange={setMushafId}
      />

      <Modal
        visible={surahPickerVisible}
        transparent
        animationType="fade"
        onRequestClose={() => {
          setSurahPickerVisible(false);
          pendingHeaderInsertAtRef.current = null;
          pendingHeaderPickPageRef.current = null;
        }}
      >
        <Pressable
          style={styles.surahPickerOverlay}
          onPress={() => {
            setSurahPickerVisible(false);
            pendingHeaderInsertAtRef.current = null;
            pendingHeaderPickPageRef.current = null;
          }}
        >
          <Pressable style={styles.surahPickerSheet} onPress={() => {}}>
            <Text style={styles.surahPickerTitle}>Select surah</Text>
            <ScrollView
              ref={surahHeaderPickerScrollRef}
              horizontal
              showsHorizontalScrollIndicator
              keyboardShouldPersistTaps="handled"
              contentContainerStyle={styles.surahPickerScroll}
              onLayout={(e) => {
                surahHeaderPickerViewWidthRef.current = e.nativeEvent.layout.width;
                if (surahPickerVisible) {
                  requestAnimationFrame(() => scrollSurahHeaderPickerToGoModalSurah());
                }
              }}
            >
              {headerInsertSurahPickerEntries.map((entry) => {
                const n = entry.surahNumber;
                const surahName = entry.title || "";
                const goModalSurahNum =
                  goToPageSurahCarouselEntries[currentSurahIndex]?.surahNumber;
                const isGoModalSurah =
                  typeof goModalSurahNum === "number" && n === goModalSurahNum;
                return (
                  <TouchableOpacity
                    key={entry.key}
                    style={[
                      styles.surahPickerChip,
                      isGoModalSurah && styles.surahPickerChipActive,
                    ]}
                    onPress={() => confirmSurahForHeaderInsert(n)}
                  >
                    <Text
                      style={[
                        styles.surahPickerChipNumber,
                        isGoModalSurah && styles.surahPickerChipNumberActive,
                      ]}
                    >
                      {n}
                    </Text>
                    {surahName ? (
                      <Text
                        style={[
                          styles.surahPickerChipName,
                          isGoModalSurah && styles.surahPickerChipNameActive,
                        ]}
                        numberOfLines={2}
                        allowFontScaling={false}
                      >
                        {surahName}
                      </Text>
                    ) : null}
                  </TouchableOpacity>
                );
              })}
            </ScrollView>
          </Pressable>
        </Pressable>
      </Modal>

      {/* Page Slider Modal */}
      <Modal
        visible={showPageSlider}
        transparent={true}
        animationType="fade"
        onRequestClose={() => {
          setShowPageSlider(false);
          setGoPageSurahSearch("");
        }}
      >
        <Pressable
          style={styles.pageSliderModalOverlay}
          onPress={() => {
            Keyboard.dismiss();
            setShowPageSlider(false);
            setGoPageSurahSearch("");
          }}
        >
          <Pressable
            style={styles.pageSliderModalContent}
            onPress={() => Keyboard.dismiss()}
          >
            <View style={styles.pageSliderHeader}>
              <Text style={styles.pageSliderTitle}>Go to Page</Text>
              <TouchableOpacity
                onPress={() => {
                  setShowPageSlider(false);
                  setGoPageSurahSearch("");
                }}
                style={styles.pageSliderCloseButton}
              >
                <Text style={styles.pageSliderCloseText}>✕</Text>
              </TouchableOpacity>
            </View>
            
            {/* Juz Carousel */}
            <View
              style={styles.carouselContainer}
              onLayout={(e) => {
                juzCarouselWidthRef.current = e.nativeEvent.layout.width;
                if (showPageSlider) scheduleCarouselScrollToCenter();
              }}
            >
              <Text style={styles.carouselLabel}>Juz</Text>
              <ScrollView
                ref={juzScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.carouselContent}
                style={styles.carouselScrollView}
              >
                {goToPageJuzSegments.map((juz, index) => (
                  <TouchableOpacity
                    key={juz.pk}
                    style={[
                      styles.carouselItemBase,
                      styles.carouselItemJuz,
                      index === currentJuzIndex && styles.carouselItemActive,
                    ]}
                    onLayout={(e) => {
                      const { width } = e.nativeEvent.layout;
                      juzItemWidthsRef.current[index] = { width };
                      if (showPageSlider) scheduleCarouselScrollToCenter();
                    }}
                    onPress={() => {
                      const pageNum = juz.fields.first_page;
                      handlePageChange(pageNum.toString());
                    }}
                  >
                    <Text
                      style={[
                        styles.carouselItemText,
                        index === currentJuzIndex && styles.carouselItemTextActive,
                      ]}
                      numberOfLines={1}
                    >
                      {(juz.fields.title || "")
                        .replace(/Juz\s*/i, "")
                        .trim()}
                    </Text>
                  </TouchableOpacity>
                ))}
              </ScrollView>
            </View>

            {/* Surah Carousel */}
            <View
              style={styles.carouselContainer}
              onLayout={(e) => {
                surahCarouselWidthRef.current = e.nativeEvent.layout.width;
                if (showPageSlider) scheduleCarouselScrollToCenter();
              }}
            >
              <Text style={styles.carouselLabel}>Surah</Text>
              <TextInput
                style={styles.goPageSurahSearchInput}
                value={goPageSurahSearch}
                onChangeText={setGoPageSurahSearch}
                placeholder="Search Arabic or English name…"
                placeholderTextColor="#999"
                autoCorrect={false}
                autoCapitalize="none"
                clearButtonMode="while-editing"
              />
              {goToPageSurahCarouselEntries.length > 0 &&
              goToPageSurahCarouselFiltered.length === 0 ? (
                <Text style={styles.goPageSurahSearchEmpty}>No surah matches this search.</Text>
              ) : (
              <ScrollView
                ref={surahScrollViewRef}
                horizontal
                showsHorizontalScrollIndicator={false}
                keyboardShouldPersistTaps="handled"
                keyboardDismissMode="on-drag"
                contentContainerStyle={styles.carouselContent}
                style={styles.carouselSurahScrollView}
              >
                {goToPageSurahCarouselFiltered.map((entry, index) => {
                  const surahNum = entry.surahNumber;
                  const surahStart = entry.page;
                  const headerNumsOnAnchor =
                    surahHeaderMarkersByPage &&
                    surahHeaderMarkersByPage[String(surahStart)];
                  const hasSurahHeaderOnAnchorPage =
                    !entry.fromMarkers &&
                    FEATURE_FLAGS.mushaf2HeaderInsert &&
                    mushafId === 2 &&
                    Array.isArray(headerNumsOnAnchor) &&
                    surahNum > 0 &&
                    headerNumsOnAnchor.some((h) => Number(h) === surahNum);
                  const surahChipLit =
                    index === activeSurahCarouselRowIndex || hasSurahHeaderOnAnchorPage;
                  return (
                    <TouchableOpacity
                      key={entry.key}
                      style={[
                        styles.carouselItemBase,
                        styles.carouselItemSurah,
                        hasSurahHeaderOnAnchorPage &&
                          styles.carouselItemSurahHasDbHeader,
                        index === activeSurahCarouselRowIndex &&
                          !hasSurahHeaderOnAnchorPage &&
                          styles.carouselItemActive,
                      ]}
                      onLayout={(e) => {
                        const { width } = e.nativeEvent.layout;
                        surahItemWidthsRef.current[index] = { width };
                        if (showPageSlider) scheduleCarouselScrollToCenter();
                      }}
                      onPress={() => {
                        goModalSurahHighlightPinRef.current = entry.surahNumber;
                        const idx = goToPageSurahCarouselEntries.findIndex(
                          (e) => e.key === entry.key
                        );
                        if (idx >= 0) {
                          setCurrentSurahIndex(idx);
                        }
                        handlePageChange(String(Math.max(1, entry.page)));
                      }}
                    >
                      <View style={styles.carouselSurahChipInner}>
                        <Text
                          style={[
                            styles.carouselItemText,
                            styles.carouselItemSurahTitle,
                            surahChipLit && styles.carouselItemTextActive,
                          ]}
                        >
                          {entry.title}
                        </Text>
                        <View
                          style={[
                            styles.carouselSurahNumPill,
                            surahChipLit && styles.carouselSurahNumPillLit,
                          ]}
                          pointerEvents="none"
                        >
                          <Text
                            style={[
                              styles.carouselSurahNumPillText,
                              surahChipLit && styles.carouselSurahNumPillTextLit,
                            ]}
                            allowFontScaling={false}
                          >
                            {surahNum}
                          </Text>
                        </View>
                      </View>
                    </TouchableOpacity>
                  );
                })}
              </ScrollView>
              )}
            </View>
            
            <View style={styles.pageSliderContainer}>
              <TextInput
                style={styles.pageSliderPageNumberInput}
                value={goPageField}
                onChangeText={(text) => {
                  const digits = text.replace(/[^\d]/g, "");
                  setGoPageField(digits);
                  if (digits === "") return;
                  const num = parseInt(digits, 10);
                  if (Number.isNaN(num) || num < 1) return;
                  if (num <= totalPages) {
                    handlePageChange(String(num));
                  }
                }}
                onSubmitEditing={() => {
                  Keyboard.dismiss();
                }}
                keyboardType="number-pad"
                returnKeyType="done"
                blurOnSubmit
                selectTextOnFocus
                textAlign="center"
              />
              <View style={styles.pageSliderWrapper}>
                <Slider
                  value={totalPages - sliderValue + 1}
                  minimumValue={1}
                  maximumValue={totalPages}
                  step={1}
                  onValueChange={(value) => {
                    const pageNum = Array.isArray(value) ? value[0] : value;
                    // Convert slider value to actual page (inverted for RTL)
                    // Slider left (min) = last page, Slider right (max) = page 1
                    const actualPage = totalPages - Math.round(pageNum) + 1;
                    setSliderValue(actualPage); // Only update display, don't trigger page load
                  }}
                  onSlidingComplete={(value) => {
                    const pageNum = Array.isArray(value) ? value[0] : value;
                    // Convert slider value to actual page (inverted for RTL)
                    const actualPage = totalPages - Math.round(pageNum) + 1;
                    setCurrentPage(actualPage);
                    setSliderValue(actualPage);
                    setPageInput(actualPage.toString());
                    handlePageChange(actualPage.toString());
                  }}
                  minimumTrackTintColor="#e0e0e0"
                  maximumTrackTintColor="#027778"
                  thumbTintColor="#027778"
                  thumbStyle={styles.pageSliderThumb}
                  trackStyle={styles.pageSliderTrack}
                  containerStyle={styles.pageSliderContainerStyle}
                  thumbTouchSize={{ width: 50, height: 50 }}
                />
              </View>
              <View style={styles.pageSliderLabels}>
                <Text style={styles.pageSliderLabel}>{totalPages}</Text>
                <Text style={styles.pageSliderLabel}>1</Text>
              </View>
            </View>
          </Pressable>
        </Pressable>
      </Modal>
    </GestureHandlerRootView>
    </SafeAreaProvider>
    </WebPasswordGate>
  );
}

/** Shared shell for Mushaf / Recitation tab bars (drawer + listen column) — keep pixel-identical */
const tabBarSurfaceBase = {
  position: "absolute",
  bottom: 0,
  left: 0,
  right: 0,
  width: "100%",
  flexDirection: "row",
  backgroundColor: "#1F1F22",
  borderTopLeftRadius: 16,
  borderTopRightRadius: 16,
  paddingTop: 12,
  paddingBottom: Platform.OS === "ios" ? 35 : 12,
  paddingHorizontal: 8,
  justifyContent: "space-around",
  alignItems: "center",
  shadowColor: "#000",
  shadowOffset: { width: 0, height: -2 },
  shadowOpacity: 0.1,
  shadowRadius: 4,
  elevation: 5,
};

const styles = StyleSheet.create({
  loadingContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
  },
  loadingText: {
    marginTop: 10,
    fontSize: 16,
    color: "#666",
  },
  errorContainer: {
    flex: 1,
    justifyContent: "center",
    alignItems: "center",
    backgroundColor: "#fff",
    padding: 20,
  },
  errorText: {
    fontSize: 18,
    color: "#d32f2f",
    fontWeight: "bold",
    marginBottom: 10,
    textAlign: "center",
  },
  errorHint: {
    fontSize: 14,
    color: "#666",
    textAlign: "center",
  },
  iosUpdateWallRoot: {
    flex: 1,
    width: "100%",
    backgroundColor: "#E8E4DF",
  },
  iosUpdateWallBackdrop: {
    flex: 1,
    width: "100%",
    minHeight: 0,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 24,
    paddingVertical: 12,
  },
  iosUpdateWallCard: {
    width: "100%",
    maxWidth: 400,
    alignItems: "center",
    backgroundColor: "#FFFFFF",
    borderRadius: 28,
    paddingVertical: 40,
    paddingHorizontal: 28,
    shadowColor: "#1a1208",
    shadowOffset: { width: 0, height: 12 },
    shadowOpacity: 0.12,
    shadowRadius: 32,
    elevation: 8,
  },
  iosUpdateWallIcon: {
    width: 88,
    height: 88,
    borderRadius: 20,
    marginBottom: 14,
  },
  iosUpdateWallBrand: {
    fontSize: 13,
    fontWeight: "600",
    letterSpacing: 2,
    color: "#6B6560",
    textTransform: "uppercase",
    marginBottom: 6,
  },
  iosUpdateWallTitle: {
    fontSize: 26,
    fontWeight: "700",
    color: "#1C1B1A",
    marginBottom: 12,
    textAlign: "center",
    letterSpacing: -0.3,
  },
  iosUpdateWallBody: {
    fontSize: 16,
    color: "#5C5854",
    textAlign: "center",
    lineHeight: 24,
    marginBottom: 32,
    paddingHorizontal: 4,
  },
  iosUpdateWallButton: {
    alignSelf: "stretch",
    backgroundColor: "#1F1F22",
    paddingVertical: 16,
    paddingHorizontal: 24,
    borderRadius: 14,
  },
  iosUpdateWallButtonText: {
    color: "#fff",
    fontSize: 17,
    fontWeight: "600",
    textAlign: "center",
    letterSpacing: -0.2,
  },
  iosUpdateWallHint: {
    fontSize: 15,
    color: "#7A756E",
    textAlign: "center",
    lineHeight: 22,
    paddingHorizontal: 4,
  },
  mainContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  mushafReciteColumn: {
    flex: 1,
  },
  safeArea: {
    flex: 1,
    backgroundColor: "#fff",
  },
  mainContainerDark: {
    backgroundColor: "#1F1F22",
  },
  safeAreaDark: {
    backgroundColor: "#1F1F22",
  },
  // Recite: match status / notch strip to mushafTopBar (#1F1F22) even when page is light mode
  safeAreaReciteTopChrome: {
    backgroundColor: "#1F1F22",
  },
  navBar: {
    minHeight: 50,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 12,
    paddingTop: Platform.OS === "ios" ? 0 : StatusBar.currentHeight || 0,
    paddingBottom: 8,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9ecef",
    backgroundColor: "#ffffff",
  },
  navButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  navButtonHidden: {
    width: 28,
  },
  navIcon: {
    fontSize: 22,
    color: "#1a1a1a",
  },
  navTitle: {
    fontSize: 16,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  navRightSpacer: {
    width: 28,
  },
  mushafTopBar: {
    flexDirection: "row",
    alignItems: "center",
    backgroundColor: "#1F1F22",
    paddingHorizontal: 12,
    paddingVertical: 10,
    borderBottomWidth: 2,
    borderBottomColor: "#00d4ff",
    minHeight: 50,
  },
  mushafMenuButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
    marginRight: 12,
  },
  mushafMenuIcon: {
    fontSize: 22,
    color: "#ffffff",
  },
  /** Fills space between menu and page/search so pills scroll instead of pushing the right cluster off-screen */
  mushafNarratorPillsScroll: {
    flex: 1,
    minWidth: 0,
  },
  mushafNarratorPills: {
    flexDirection: "row",
    alignItems: "center",
    paddingRight: 12,
  },
  mushafNarratorPill: {
    paddingHorizontal: 12,
    paddingVertical: 6,
    borderRadius: 20,
    borderWidth: 1.5,
    marginRight: 8,
    backgroundColor: "transparent",
  },
  mushafNarratorPillText: {
    fontSize: 14,
    fontWeight: "500",
  },
  mushafRightIcons: {
    flexDirection: "row",
    alignItems: "center",
    flexShrink: 0,
  },
  mushafHeaderToolButton: {
    paddingHorizontal: 8,
    paddingVertical: 4,
    marginRight: 6,
    borderRadius: 4,
    backgroundColor: "rgba(255,255,255,0.14)",
  },
  mushafHeaderToolButtonText: {
    fontSize: 11,
    fontWeight: "600",
    color: "#ffffff",
  },
  lineHeaderInsertTarget: {
    borderTopWidth: 1,
    borderBottomWidth: 1,
    borderTopColor: "#B84700",
    borderBottomColor: "#B84700",
    borderStyle: "dashed",
  },
  lineHeaderInsertTargetPressed: {
    backgroundColor: "rgba(184, 71, 0, 0.1)",
  },
  surahPickerOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.45)",
    justifyContent: "flex-end",
  },
  surahPickerSheet: {
    backgroundColor: "#2a2a2e",
    borderTopLeftRadius: 16,
    borderTopRightRadius: 16,
    paddingTop: 14,
    paddingBottom: 28,
    paddingHorizontal: 12,
    maxHeight: "52%",
  },
  surahPickerTitle: {
    color: "#fff",
    fontSize: 16,
    fontWeight: "600",
    marginBottom: 12,
    textAlign: "center",
  },
  surahPickerScroll: {
    flexDirection: "row",
    alignItems: "stretch",
    paddingVertical: 8,
    flexWrap: "nowrap",
  },
  surahPickerChip: {
    width: SURAH_HEADER_PICKER_CHIP_W,
    maxWidth: SURAH_HEADER_PICKER_CHIP_W,
    paddingVertical: 8,
    paddingHorizontal: 6,
    marginRight: SURAH_HEADER_PICKER_CHIP_GAP,
    borderRadius: 8,
    backgroundColor: "#44454a",
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 1,
    borderColor: "transparent",
  },
  surahPickerChipActive: {
    backgroundColor: "#027778",
    borderColor: "#027778",
  },
  surahPickerChipNumber: {
    color: "rgba(255,255,255,0.85)",
    fontSize: 15,
    fontWeight: "700",
    marginBottom: 4,
  },
  surahPickerChipNumberActive: {
    color: "#ffffff",
  },
  surahPickerChipName: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "500",
    textAlign: "center",
    width: "100%",
  },
  surahPickerChipNameActive: {
    fontWeight: "600",
  },
  mushafPageIndicator: {
    fontSize: 12,
    fontWeight: "500",
    color: "rgba(255,255,255,0.75)",
    letterSpacing: 0.3,
    marginRight: 12,
  },
  mushafIconButton: {
    paddingHorizontal: 8,
    paddingVertical: 6,
  },
  mushafIcon: {
    fontSize: 20,
    color: "#ffffff",
  },
  contentContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  contentContainerDark: {
    backgroundColor: "#1F1F22",
  },
  variationTraversalBar: {
    flexDirection: "row",
    backgroundColor: "#313237",
    paddingTop: 8,
    paddingBottom: 8,
    paddingHorizontal: 10,
    alignItems: "center",
    justifyContent: "space-between",
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: "#313237",
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    overflow: "hidden",
    zIndex: 2,
    elevation: 11,
  },
  /** Lets mushaf-style listen badges extend slightly below the word chips without clipping */
  variationTraversalBarListenBadgeOverflow: {
    overflow: "visible",
  },
  variationTraversalBarEmpty: {
    minHeight: 120,
    paddingTop: 12,
    justifyContent: "center",
  },
  variationTraversalArrowButton: {
    width: 36,
    height: 36,
    borderRadius: 18,
    backgroundColor: "transparent",
    alignItems: "center",
    justifyContent: "center",
  },
  variationTraversalArrowButtonDisabled: {
    backgroundColor: "#555",
    opacity: 0.6,
  },
  variationTraversalArrowButtonText: {
    fontSize: 28,
    fontWeight: "600",
    color: "#fff",
    lineHeight: 30,
  },
  variationTraversalSegmentedControl: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    marginHorizontal: 6,
    backgroundColor: "#4a4d5b",
    borderRadius: 14,
    paddingVertical: 6,
    paddingHorizontal: 6,
    minHeight: 82,
  },
  variationTraversalOffPageSegmented: {
    // No outer padding here: pill gray + Prev dark extend to the rounded clip; each half uses inner
    // padding so Prev does not get a light “halo” from `#4a4d5b` around the darker fill.
    minHeight: 82,
    paddingVertical: 0,
    paddingHorizontal: 0,
    marginHorizontal: 6,
    alignItems: "stretch",
    borderRadius: 14,
    overflow: "hidden",
  },
  /** Clip progress inside word box only: base + warm fill left → right */
  variationTraversalChipClipOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    borderRadius: 10,
    overflow: "hidden",
    zIndex: 2,
  },
  variationTraversalChipClipOverlayTrack: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "rgba(255,255,255,0.05)",
  },
  variationTraversalChipClipOverlayFill: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    borderRadius: 10,
    backgroundColor: "rgba(232, 212, 168, 0.22)",
  },
  variationTraversalCard: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 2,
    paddingHorizontal: 6,
    borderRadius: 12,
    minWidth: 0,
  },
  variationTraversalCardNarrator: {
    backgroundColor: "transparent",
  },
  variationTraversalCardBadgeOverflow: {
    overflow: "visible",
  },
  variationTraversalCardWordWrapWithBadge: {
    overflow: "visible",
  },
  /** Bottom-right of each Hafs / narrator word tile (mushaf badges stay centered on the word) */
  traversalCardListenBadge: {
    position: "absolute",
    right: 4,
    bottom: -6,
    zIndex: 4,
    overflow: "visible",
  },
  /** Larger than mushaf `wordListenBadgeInner` — traversal bar only */
  traversalCardListenBadgeInner: {
    width: 20,
    height: 20,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#313139",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.14)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2.5,
    elevation: 3,
  },
  traversalCardListenBadgeSpinner: {
    width: 13,
    height: 13,
    transform: [{ scale: 0.92 }],
  },
  variationTraversalCardLabel: {
    fontSize: 11,
    color: "#d8d8db",
    marginBottom: 4,
  },
  variationTraversalCardWordWrap: {
    alignSelf: "center",
    backgroundColor: "#2f313d",
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 46,
    minWidth: 92,
    paddingHorizontal: 16,
    position: "relative",
    overflow: "hidden",
  },
  variationTraversalCardWordWrapNarrator: {
    borderWidth: 1.8,
  },
  variationTraversalCardWord: {
    fontSize: 22,
    color: "#ffffff",
    textAlign: "center",
    lineHeight: 0,
  },
  variationTraversalCardWordActive: {
    color: "#fff",
  },
  variationTraversalSwapIcon: {
    fontSize: 24,
    color: "#d5d5d9",
    marginHorizontal: 5,
    lineHeight: 26,
  },
  variationTraversalOffPageCard: {
    flex: 1,
    alignSelf: "stretch",
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 0,
    paddingHorizontal: 0,
    minWidth: 0,
  },
  /** Left half: inset matches old pill padding; right side stays tight to the center split. */
  variationTraversalOffPageCardNext: {
    backgroundColor: "transparent",
    paddingTop: 6,
    paddingBottom: 6,
    paddingLeft: 6,
    paddingRight: 2,
  },
  /** Prev half: overflow clips the full-bleed bg layer (`variationTraversalOffPagePrevBg`). */
  variationTraversalOffPageCardPrev: {
    overflow: "hidden",
  },
  /** Flush with pill top/right/bottom; radius matches outer pill (14). */
  variationTraversalOffPagePrevBg: {
    ...StyleSheet.absoluteFillObject,
    backgroundColor: "#383c4a",
    borderTopRightRadius: 14,
    borderBottomRightRadius: 14,
  },
  /** Padding lives inside Prev so the dark bg is not inset by the old outer pill padding. */
  variationTraversalOffPagePrevContent: {
    flex: 1,
    width: "100%",
    alignItems: "center",
    justifyContent: "center",
    paddingTop: 6,
    paddingBottom: 6,
    paddingRight: 6,
    paddingLeft: 4,
  },
  variationTraversalOffPageHeading: {
    fontSize: 9,
    fontWeight: "600",
    color: "#f0f0f3",
    marginBottom: 4,
    textAlign: "center",
  },
  variationTraversalOffPagePage: {
    fontSize: 9,
    color: "#c4c6ce",
    marginTop: 4,
    textAlign: "center",
  },
  variationTraversalOffPageWordWrap: {
    alignSelf: "center",
    backgroundColor: "#2f313d",
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 34,
    minWidth: 80,
    maxWidth: "100%",
    paddingVertical: 4,
    paddingHorizontal: 12,
    position: "relative",
    overflow: "hidden",
    borderWidth: 1.4,
  },
  variationTraversalOffPageWord: {
    fontSize: 15,
    color: "#ffffff",
    textAlign: "center",
    lineHeight: 0,
  },
  variationTraversalArrowDisabled: {
    opacity: 0.5,
  },
  noRiwayahBannerInTraversal: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
    backgroundColor: "#4a4d5b",
    flex: 1,
    marginHorizontal: 10,
    marginVertical: 0,
    paddingVertical: 0,
    paddingHorizontal: 14,
    borderRadius: 14,
    minHeight: 60,
  },
  noRiwayahBannerIcon: {
    width: 44,
    height: 44,
    borderRadius: 22,
    backgroundColor: "rgba(255,255,255,0.2)",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 14,
  },
  noRiwayahBannerIconText: {
    fontSize: 22,
    fontWeight: "300",
    color: "#fff",
  },
  noRiwayahBannerText: {
    alignItems: "flex-start",
  },
  noRiwayahBannerTitle: {
    fontSize: 17,
    fontWeight: "600",
    color: "#fff",
    marginBottom: 2,
  },
  noRiwayahBannerSubtitle: {
    fontSize: 12,
    color: "rgba(255,255,255,0.7)",
  },
  pageViewContainer: {
    flex: 1,
    width: "100%",
  },
  pageViewContainerDark: {
    backgroundColor: "#1F1F22",
  },
  pageBehind: {
    opacity: 0.95,
    zIndex: 0,
  },
  pageCurrent: {
    zIndex: 1,
  },
  container: {
    flex: 1,
    backgroundColor: "#fff",
    alignItems: "center",
    justifyContent: "flex-start",
    paddingVertical: 2,
    paddingHorizontal: 15,
  },
  pageContent: {
    width: "100%",
    maxWidth: 600,
    backgroundColor: "#fff",
    paddingTop: 8,
    paddingBottom: 32,
    paddingHorizontal: 2,
  },
  containerDark: {
    backgroundColor: "#1F1F22",
  },
  pageContentDark: {
    backgroundColor: "#1F1F22",
  },
  pageStateWrap: {
    flex: 1,
    minHeight: 360,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 16,
  },
  pageStateCard: {
    width: "100%",
    maxWidth: 320,
    borderRadius: 16,
    alignItems: "center",
    paddingVertical: 22,
    paddingHorizontal: 18,
    backgroundColor: "#F3F4F6",
    borderWidth: 1,
    borderColor: "#E5E7EB",
  },
  pageStateCardDark: {
    backgroundColor: "#2A2A2E",
    borderColor: "#3B3B42",
  },
  pageStateTitle: {
    marginTop: 12,
    fontSize: 17,
    fontWeight: "600",
    color: "#111827",
  },
  pageStateTitleDark: {
    color: "#F9FAFB",
  },
  line: {
    flexDirection: "row-reverse",
    justifyContent: "space-between",
    alignItems: "center",
    minHeight: 40,
  },
  lineWithBorder: {
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#000",
  },
  lineWithBorderDark: {
    borderBottomColor: "#444",
  },
  lineDark: {
    borderBottomColor: "#444",
  },
  firstLineOfJuz: {
    backgroundColor: "#000",
    borderBottomColor: "#333",
    marginHorizontal: -2,
    paddingHorizontal: 2,
  },
  firstLineOfJuzDark: {
    backgroundColor: "#fff",
    borderBottomColor: "#ccc",
    marginHorizontal: -2,
    paddingHorizontal: 2,
  },
  firstLineOfJuzText: {
    color: "#fff",
  },
  firstLineOfJuzDarkText: {
    color: "#000",
  },
  wordPressable: {
    paddingHorizontal: 2,
  },
  /** Badge extends past the word box; keep paint/hit from clipping on some platforms */
  wordPressableListenOverflow: {
    overflow: "visible",
    zIndex: 3,
  },
  wordWithListenBadgeWrap: {
    position: "relative",
    overflow: "visible",
  },
  /** Out of flow: does not change line height; straddles bottom edge of the word */
  wordListenBadge: {
    position: "absolute",
    left: 0,
    right: 0,
    bottom: -7,
    alignItems: "center",
    zIndex: 2,
    overflow: "visible",
  },
  wordListenBadgeInner: {
    width: 15,
    height: 15,
    borderRadius: 8,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#313139",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(255, 255, 255, 0.14)",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 1 },
    shadowOpacity: 0.35,
    shadowRadius: 2,
    elevation: 3,
  },
  wordListenBadgeInnerDark: {
    backgroundColor: "#313139",
    borderColor: "rgba(255, 255, 255, 0.18)",
    shadowOpacity: 0.5,
  },
  wordListenBadgeSpinner: {
    width: 10,
    height: 10,
    transform: [{ scale: 0.82 }],
  },
  wordPressed: {
    opacity: 0.5,
  },
  wordSelected: {
    backgroundColor: "#e0e0e0",
    borderRadius: 4,
  },
  verserRangeAnchor: {
    backgroundColor: "rgba(0, 212, 255, 0.22)",
    borderRadius: 4,
  },
  wordRecitationListenHighlight: {
    backgroundColor: "rgba(255, 193, 7, 0.38)",
    borderRadius: 4,
  },
  wordRecitationListenHighlightDark: {
    backgroundColor: "rgba(255, 193, 7, 0.28)",
    borderRadius: 4,
  },
  wordBlockWithOverlay: {
    backgroundColor: "rgba(200, 230, 201, 0.5)",
    borderRadius: 4,
    padding: 0,
    margin: 0,
  },
  wordBlockWithOverlayDark: {
    backgroundColor: "rgba(76, 175, 80, 0.25)",
    borderRadius: 4,
    padding: 0,
    margin: 0,
  },
  differentChar: {
    backgroundColor: "#ffb366",
    borderRadius: 2,
    paddingHorizontal: 1,
    paddingVertical: 0,
    lineHeight: undefined,
  },
  inlineComparison: {
    flexDirection: "row",
  },
  word: {
    fontSize: 24,
    color: "#1a1a1a",
    fontFamily: QURAN_FONT_FAMILY,
    fontWeight: "500",
    writingDirection: "rtl",
    lineHeight: 46,
  },
  wordDark: {
    color: "#ffffff",
  },
  modalContainer: {
    flex: 1,
  },
  backdrop: {
    flex: 1,
    backgroundColor: "transparent",
  },
  popupContainer: {
    backgroundColor: "#fff",
    borderRadius: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
    alignItems: "center",
    maxHeight: "90%",
    maxWidth: "90%",
  },
  caret: {
    width: 0,
    height: 0,
    borderLeftWidth: 12,
    borderRightWidth: 12,
    borderBottomWidth: 12,
    borderLeftColor: "transparent",
    borderRightColor: "transparent",
    borderBottomColor: "#fff",
    marginTop: -12,
  },
  popupContent: {
    width: "100%",
    flex: 1,
  },
  popupContentContainer: {
    padding: 20,
    flexGrow: 1,
  },
  drawerOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    flexDirection: "column",
    backgroundColor: "transparent",
  },
  drawerBackdropPressable: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 0,
  },
  drawerBackdropFill: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    backgroundColor: "rgba(0,0,0,0.25)",
  },
  drawer: {
    position: "absolute",
    left: 0,
    top: 0,
    bottom: 0,
    width: 260,
    zIndex: 1,
    backgroundColor: "#1F1F22",
    borderRightWidth: StyleSheet.hairlineWidth,
    borderRightColor: "#3a3a3a",
    paddingHorizontal: 16,
    shadowColor: "#000",
    shadowOffset: { width: 2, height: 0 },
    shadowOpacity: 0.1,
    shadowRadius: 6,
    elevation: 6,
  },
  drawerHeader: {
    marginBottom: 20,
  },
  drawerHeaderTop: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 16,
  },
  drawerHeaderIcon: {
    marginRight: 12,
  },
  drawerHeaderIconText: {
    fontSize: 20,
  },
  drawerHeaderTextContainer: {
    flex: 1,
  },
  drawerTitle: {
    fontSize: 24,
    fontWeight: "700",
    color: "#ffffff",
    marginBottom: 4,
  },
  drawerSubtitle: {
    fontSize: 14,
    color: "#aaaaaa",
    lineHeight: 20,
  },
  resetButton: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#3a3a3a",
    borderRadius: 8,
    paddingVertical: 10,
    paddingHorizontal: 16,
  },
  resetButtonDisabled: {
    backgroundColor: "#2a2a2a",
    opacity: 0.5,
  },
  resetButtonIcon: {
    fontSize: 16,
    color: "#ffffff",
    marginRight: 8,
  },
  resetButtonIconDisabled: {
    color: "#888888",
  },
  resetButtonText: {
    fontSize: 14,
    color: "#ffffff",
    fontWeight: "500",
  },
  resetButtonTextDisabled: {
    color: "#888888",
  },
  drawerNarratorsContent: {
    paddingBottom: 40,
  },
  parentCard: {
    marginBottom: 12,
    borderRadius: 12,
    overflow: "hidden",
  },
  parentCardHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    backgroundColor: "#027778",
    paddingVertical: 14,
    paddingHorizontal: 16,
    borderRadius: 12,
  },
  parentCardInfo: {
    flex: 1,
  },
  parentCardTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#ffffff",
    marginBottom: 4,
  },
  parentCardLocation: {
    flexDirection: "row",
    alignItems: "center",
  },
  locationIcon: {
    fontSize: 12,
    marginRight: 6,
  },
  parentCardLocationText: {
    fontSize: 14,
    color: "#ffffff",
    opacity: 0.9,
  },
  chevronIcon: {
    fontSize: 14,
    color: "#ffffff",
    marginLeft: 12,
  },
  childrenContainer: {
    marginTop: 8,
    flexDirection: "row",
    position: "relative",
  },
  childrenVerticalLine: {
    width: 2,
    backgroundColor: "#555",
    marginLeft: 16,
    marginRight: 12,
  },
  childrenContent: {
    flex: 1,
  },
  childCard: {
    backgroundColor: "transparent",
    borderRadius: 12,
    marginBottom: 8,
    overflow: "hidden",
    position: "relative",
  },
  childCardSelected: {
    backgroundColor: "#3a3a3a",
  },
  childCardDisabled: {
    opacity: 0.7,
  },
  childCardContent: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingVertical: 12,
    paddingHorizontal: 16,
  },
  childCardInfo: {
    flex: 1,
  },
  childCardTitle: {
    fontSize: 16,
    fontWeight: "500",
    color: "#ffffff",
    marginBottom: 4,
  },
  childCardTitleDisabled: {
    color: "#666666",
    opacity: 0.5,
  },
  childCardLocation: {
    flexDirection: "row",
    alignItems: "center",
  },
  childCardLocationText: {
    fontSize: 13,
    color: "#aaaaaa",
  },
  childCardLocationTextDisabled: {
    color: "#666666",
    opacity: 0.5,
  },
  childCardBar: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 4,
  },
  drawerBottomNav: {
    ...tabBarSurfaceBase,
    zIndex: 10,
  },
  drawerNavButton: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingVertical: 8,
  },
  drawerNavIcon: {
    fontSize: 24,
    marginBottom: 4,
    color: "#ffffff",
  },
  drawerNavIconActive: {
    color: "#00d4ff",
  },
  drawerNavLabel: {
    fontSize: 12,
    color: "#ffffff",
    fontWeight: "500",
  },
  drawerNavLabelActive: {
    color: "#00d4ff",
    fontWeight: "600",
  },
  drawerNarratorItem: {
    paddingVertical: 12,
    paddingHorizontal: 12,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: "#3a3a3a",
    marginBottom: 10,
    backgroundColor: "#1f1f1f",
  },
  drawerNarratorItemSelected: {
    borderColor: "#00d4ff",
    backgroundColor: "#1a3a42",
  },
  drawerNarratorRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  drawerCheckbox: {
    width: 20,
    height: 20,
    borderRadius: 6,
    borderWidth: 2,
    borderColor: "#555",
    alignItems: "center",
    justifyContent: "center",
    marginRight: 12,
    backgroundColor: "transparent",
  },
  drawerCheckboxDisabled: {
    borderColor: "#666",
    backgroundColor: "#555",
    opacity: 0.6,
  },
  drawerCheckboxSelected: {
    borderColor: "#00d4ff",
    backgroundColor: "#00d4ff",
  },
  drawerCheckboxDisabledSelected: {
    borderColor: "#666",
    backgroundColor: "#666",
    opacity: 0.6,
  },
  drawerCheckmark: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  drawerNarratorText: {
    flex: 1,
    fontSize: 16,
    color: "#ffffff",
    fontWeight: "500",
  },
  drawerNarratorTextSelected: {
    color: "#00d4ff",
  },
  learnContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  learnScrollContent: {
    paddingVertical: 12,
  },
  learnSection: {
    marginBottom: 16,
    paddingBottom: 12,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#e9ecef",
  },
  learnSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    paddingHorizontal: 16,
    marginBottom: 8,
  },
  learnRow: {
    paddingHorizontal: 12,
  },
  videoCard: {
    width: 140,
    marginHorizontal: 4,
  },
  videoThumb: {
    width: 140,
    height: 140,
    borderRadius: 12,
    backgroundColor: "#dfe3e6",
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 6,
  },
  playTriangle: {
    width: 0,
    height: 0,
    borderTopWidth: 12,
    borderBottomWidth: 12,
    borderLeftWidth: 18,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffffff",
    marginLeft: 6,
  },
  videoTitle: {
    fontSize: 12,
    color: "#1a1a1a",
  },
  listenContainer: {
    flex: 1,
    backgroundColor: "#fff",
  },
  listenScrollContent: {
    paddingTop: 12,
    paddingBottom: 28,
  },
  listenScrollContentWithBottomNav: {
    // Clears unified tab bar (same height as drawerBottomNav)
    paddingBottom: 120,
  },
  listenScrollContentWithPlayer: {
    paddingBottom: 196,
  },
  listenPersistentBottomNav: {
    ...tabBarSurfaceBase,
    zIndex: 120,
  },
  listenSection: {
    marginBottom: 18,
  },
  listenSectionTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
    paddingHorizontal: 16,
  },
  listenSectionSubtitle: {
    fontSize: 13,
    color: "#667085",
    paddingHorizontal: 16,
    marginTop: 2,
    marginBottom: 12,
  },
  listenFilterRow: {
    paddingHorizontal: 12,
    marginBottom: 12,
  },
  listenFilterChip: {
    backgroundColor: "#f8fafc",
    borderWidth: 1,
    borderColor: "#e2e8f0",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    marginHorizontal: 4,
    marginBottom: 10,
  },
  listenFilterChipLabel: {
    fontSize: 11,
    color: "#64748b",
    marginBottom: 2,
    fontWeight: "500",
  },
  listenFilterChipValue: {
    fontSize: 14,
    color: "#0f172a",
    fontWeight: "600",
  },
  listenNarratorPills: {
    paddingHorizontal: 4,
    paddingBottom: 8,
  },
  listenNarratorPill: {
    borderWidth: 1,
    borderColor: "#dbe3ea",
    backgroundColor: "#fff",
    paddingHorizontal: 12,
    paddingVertical: 7,
    borderRadius: 999,
    marginRight: 8,
  },
  listenNarratorPillSelected: {
    backgroundColor: "#111827",
    borderColor: "#111827",
  },
  listenNarratorPillText: {
    fontSize: 12,
    color: "#334155",
    fontWeight: "600",
  },
  listenNarratorPillTextSelected: {
    color: "#fff",
  },
  listenSurahInputWrap: {
    marginHorizontal: 4,
  },
  listenSurahInputLabel: {
    fontSize: 11,
    color: "#64748b",
    marginBottom: 5,
    fontWeight: "500",
  },
  listenSurahInput: {
    borderWidth: 1,
    borderColor: "#dbe3ea",
    borderRadius: 12,
    paddingHorizontal: 12,
    paddingVertical: 9,
    fontSize: 14,
    color: "#0f172a",
    backgroundColor: "#fff",
  },
  listenGrid: {
    paddingHorizontal: 12,
  },
  listenGridRow: {
    flexDirection: "row",
    marginBottom: 14,
  },
  listenCard: {
    flex: 1,
    marginHorizontal: 4,
  },
  listenThumb: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 12,
    backgroundColor: "#dfe3e6",
    overflow: "hidden",
    justifyContent: "flex-end",
  },
  listenThumbImage: {
    width: "100%",
    height: "100%",
  },
  listenPlayBadge: {
    position: "absolute",
    right: 8,
    bottom: 8,
    width: 28,
    height: 28,
    borderRadius: 14,
    backgroundColor: "rgba(17, 17, 17, 0.75)",
    alignItems: "center",
    justifyContent: "center",
  },
  listenPlayBadgeText: {
    color: "#fff",
    fontSize: 12,
    fontWeight: "700",
  },
  listenCardTitle: {
    fontSize: 13,
    fontWeight: "600",
    color: "#1a1a1a",
    marginTop: 7,
  },
  listenCardSubtitle: {
    fontSize: 12,
    color: "#667085",
    marginTop: 2,
  },
  listenNarratorBadge: {
    alignSelf: "flex-start",
    marginTop: 6,
    borderRadius: 999,
    paddingHorizontal: 10,
    paddingVertical: 4,
    maxWidth: "100%",
  },
  listenNarratorBadgeText: {
    fontSize: 11,
    color: "#ffffff",
    fontWeight: "700",
  },
  listenEmptyText: {
    fontSize: 14,
    color: "#64748b",
    textAlign: "center",
    paddingVertical: 20,
  },
  globalListenPlayer: {
    position: "absolute",
    left: 0,
    top: 0,
    width: Dimensions.get("window").width - LISTEN_PLAYER_MARGIN * 2,
    maxWidth: 520,
    borderRadius: 16,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    paddingHorizontal: 12,
    paddingTop: 10,
    paddingBottom: 12,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 6 },
    shadowOpacity: 0.12,
    shadowRadius: 10,
    elevation: 8,
    zIndex: 999,
  },
  globalListenPlayerDrawerCompact: {
    width: 124,
    height: 138,
    top: undefined,
    left: undefined,
    right: 18,
    bottom: Platform.OS === "ios" ? 132 : 110,
    paddingHorizontal: 8,
    paddingTop: 8,
    paddingBottom: 8,
    borderRadius: 14,
    alignItems: "center",
    justifyContent: "space-between",
    zIndex: 1100,
    elevation: 12,
  },
  globalListenPlayerTop: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  globalListenPlayerMeta: {
    flexDirection: "row",
    alignItems: "center",
    flex: 1,
    marginRight: 8,
  },
  globalListenPlayerAvatar: {
    width: 44,
    height: 44,
    borderRadius: 8,
    marginRight: 10,
  },
  globalListenPlayerMetaText: {
    flex: 1,
  },
  globalListenPlayerTitle: {
    fontSize: 14,
    fontWeight: "600",
    color: "#0f172a",
  },
  globalListenPlayerSubtitle: {
    fontSize: 12,
    color: "#64748b",
    marginTop: 1,
  },
  globalListenPlayerClose: {
    width: 26,
    height: 26,
    borderRadius: 13,
    alignItems: "center",
    justifyContent: "center",
  },
  globalListenPlayerCloseText: {
    fontSize: 16,
    color: "#334155",
    fontWeight: "700",
  },
  globalListenPlayerCompactClose: {
    position: "absolute",
    top: 4,
    right: 4,
    width: 22,
    height: 22,
    borderRadius: 11,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(255,255,255,0.85)",
    zIndex: 2,
  },
  globalListenPlayerCompactAvatar: {
    width: 66,
    height: 66,
    borderRadius: 8,
    marginTop: 6,
  },
  globalListenPlayerCompactSlider: {
    width: "100%",
    marginTop: 2,
    marginBottom: 2,
  },
  globalListenPlayerCompactTrack: {
    height: 3,
    borderRadius: 999,
  },
  globalListenPlayerCompactThumb: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  globalListenPlayerCompactToggle: {
    width: 30,
    height: 30,
    borderRadius: 15,
    backgroundColor: "#111827",
    alignItems: "center",
    justifyContent: "center",
  },
  globalListenPlayerCompactToggleText: {
    color: "#fff",
    fontSize: 13,
    fontWeight: "700",
    marginLeft: 1,
  },
  globalListenPlayerSlider: {
    marginTop: 8,
    marginBottom: 2,
  },
  globalListenPlayerTrack: {
    height: 4,
    borderRadius: 999,
  },
  globalListenPlayerThumb: {
    width: 14,
    height: 14,
    borderRadius: 7,
  },
  globalListenPlayerTimeRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginTop: 2,
  },
  globalListenPlayerTime: {
    fontSize: 11,
    color: "#64748b",
    minWidth: 42,
  },
  globalListenPlayerToggle: {
    paddingHorizontal: 16,
    paddingVertical: 5,
    borderRadius: 999,
    backgroundColor: "#111827",
  },
  globalListenPlayerToggleText: {
    color: "#ffffff",
    fontSize: 12,
    fontWeight: "600",
  },
  listenPlaceholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "#fff",
  },
  listenText: {
    fontSize: 16,
    color: "#666",
  },
  // Learn detail view styles
  learnDetailContent: {
    paddingBottom: 24,
  },
  learnDetailHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingTop: 8,
    paddingBottom: 12,
  },
  learnDetailTitle: {
    fontSize: 18,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  learnVideoWrapper: {
    paddingHorizontal: 16,
  },
  learnVideoSquare: {
    width: "100%",
    aspectRatio: 1,
    borderRadius: 16,
    backgroundColor: "#dfe3e6",
    alignItems: "center",
    justifyContent: "center",
  },
  playTriangleLarge: {
    width: 0,
    height: 0,
    borderTopWidth: 18,
    borderBottomWidth: 18,
    borderLeftWidth: 28,
    borderTopColor: "transparent",
    borderBottomColor: "transparent",
    borderLeftColor: "#ffffff",
    marginLeft: 8,
  },
  learnActionRow: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 16,
    paddingVertical: 12,
    gap: 16,
  },
  learnActionBtn: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 12,
    backgroundColor: "#f6f7f8",
    flex: 1,
    justifyContent: "center",
  },
  learnActionIcon: {
    fontSize: 16,
    color: "#1a1a1a",
    marginRight: 6,
  },
  learnActionLabel: {
    fontSize: 14,
    color: "#1a1a1a",
    fontWeight: "500",
  },
  learnDescription: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 14,
    color: "#444",
    lineHeight: 20,
  },
  popupHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 16,
  },
  variationTraversalNarratorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
  },
  variationTraversalPlayWrapper: {
    marginLeft: 4,
  },
  variationTraversalSegmentPlayable: {
    position: "relative",
  },
  variationTraversalPlayIndicator: {
    position: "absolute",
    right: 6,
    bottom: 6,
    width: 16,
    height: 16,
    borderRadius: 8,
    backgroundColor: "#027778",
    alignItems: "center",
    justifyContent: "center",
  },
  variationTraversalPlayIndicatorIcon: {
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "600",
  },
  popupHeaderTitleRow: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "flex-start",
  },
  backButton: {
    marginRight: 12,
    padding: 4,
  },
  backArrow: {
    fontSize: 24,
    color: "#007AFF",
  },
  closeButton: {
    marginRight: 12,
    padding: 4,
  },
  closeIcon: {
    fontSize: 20,
    color: "#666",
    fontWeight: "bold",
  },
  popupTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
    flex: 1,
  },
  saveButton: {
    paddingHorizontal: 16,
    paddingVertical: 8,
    borderRadius: 8,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  saveButtonSaved: {
    backgroundColor: "#10b981",
    borderColor: "#10b981",
  },
  saveButtonNotSaved: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  saveButtonText: {
    fontSize: 14,
    color: "#374151",
    fontWeight: "600",
  },
  saveButtonTextSaved: {
    color: "#ffffff",
  },
  saveButtonTextNotSaved: {
    color: "#ffffff",
  },
  narratorList: {
    maxHeight: 300,
  },
  narratorItem: {
    paddingVertical: 12,
    paddingHorizontal: 8,
    borderBottomWidth: 1,
    borderBottomColor: "#f0f0f0",
  },
  narratorText: {
    fontSize: 16,
    color: "#1a1a1a",
  },
  inputContainer: {
    position: "relative",
    flex: 1,
  },
  customKeyboard: {
    marginTop: 12,
    paddingTop: 12,
    borderTopWidth: 1,
    borderTopColor: "#e5e7eb",
  },
  keyboardControlWrap: {
    marginBottom: 10,
    width: "100%",
  },
  keyboardControlRowPrimary: {
    flexDirection: "row",
    alignItems: "center",
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 8,
    width: "100%",
  },
  keyboardControlRowSecondary: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    flexWrap: "wrap",
    rowGap: 8,
    columnGap: 10,
    width: "100%",
    marginTop: 8,
  },
  keyboardToggle: {
    paddingHorizontal: 14,
    paddingVertical: 8,
    backgroundColor: "#f3f4f6",
    borderRadius: 8,
    borderWidth: 1,
    borderColor: "#d1d5db",
  },
  keyboardToggleText: {
    fontSize: 13,
    color: "#374151",
    fontWeight: "600",
  },
  keyboardArrowsRow: {
    flexDirection: "row",
    gap: 6,
    flexShrink: 0,
  },
  keyboardArrowKey: {
    width: 44,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardArrowKeyDisabled: {
    backgroundColor: "#f3f4f6",
    borderColor: "#e5e7eb",
    opacity: 0.5,
  },
  keyboardDeleteKey: {
    width: 44,
    height: 36,
    backgroundColor: "#fee2e2",
    borderWidth: 1,
    borderColor: "#fecaca",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardUndoKey: {
    width: 44,
    height: 36,
    backgroundColor: "#dbeafe",
    borderWidth: 1,
    borderColor: "#93c5fd",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    position: "relative",
  },
  keyboardUndoKeyDisabled: {
    backgroundColor: "#f3f4f6",
    borderColor: "#d1d5db",
    opacity: 0.5,
  },
  keyboardUndoCount: {
    position: "absolute",
    top: -4,
    right: -4,
    backgroundColor: "#3b82f6",
    color: "#ffffff",
    fontSize: 10,
    fontWeight: "700",
    minWidth: 16,
    height: 16,
    borderRadius: 8,
    textAlign: "center",
    lineHeight: 16,
    paddingHorizontal: 3,
    overflow: "hidden",
  },
  keyboardImalahKey: {
    minWidth: 56,
    height: 36,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  keyboardImalahKeyActive: {
    backgroundColor: "#d1fae5",
    borderColor: "#10b981",
  },
  keyboardImalahKeyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  keyboardDiamondKey: {
    minWidth: 56,
    height: 36,
    backgroundColor: "#f3f4f6",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 6,
  },
  keyboardDiamondKeyActive: {
    backgroundColor: "#e0e7ff",
    borderColor: "#6366f1",
  },
  keyboardDiamondKeyText: {
    fontSize: 12,
    fontWeight: "600",
    color: "#374151",
  },
  keyboardKeyTextDisabled: {
    color: "#9ca3af",
  },
  keyboardInsertModeRow: {
    flexDirection: "row",
    justifyContent: "center",
    gap: 8,
    marginBottom: 10,
  },
  keyboardInsertModeButton: {
    minWidth: 50,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#d1d5db",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    paddingHorizontal: 12,
  },
  keyboardInsertModeButtonActive: {
    backgroundColor: "#3b82f6",
    borderColor: "#2563eb",
  },
  keyboardInsertModeText: {
    fontSize: 16,
    color: "#1f2937",
    fontWeight: "600",
  },
  keyboardInsertModeTextActive: {
    color: "#ffffff",
  },
  keyboardGrid: {
    flexDirection: "row",
    flexWrap: "wrap",
    gap: 5,
    justifyContent: "center",
  },
  /** Forces the next harakat keys onto a new row inside `keyboardGrid` (flex-wrap). */
  keyboardHarakatRowBreak: {
    width: "100%",
    height: 0,
  },
  keyboardKey: {
    width: 36,
    height: 36,
    backgroundColor: "#ffffff",
    borderWidth: 1,
    borderColor: "#e5e7eb",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
  },
  keyboardKeyLarge: {
    width: 50,
    height: 60,
  },
  keyboardKeyText: {
    fontSize: 18,
    color: "#1f2937",
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyTextLarge: {
    fontSize: 32,
  },
  keyboardKeyPreviewText: {
    fontSize: 10,
    color: "#9ca3af",
    marginTop: 2,
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyPreviewTextLarge: {
    fontSize: 12,
  },
  keyboardKeyTextTanween: {
    fontSize: 12,
    color: "#6b7280",
    marginTop: 2,
    fontFamily: QURAN_FONT_FAMILY,
  },
  keyboardKeyTextTanweenLarge: {
    fontSize: 16,
  },
  keyboardKeyShaddaSelected: {
    backgroundColor: "#fbbf24",
    borderColor: "#fbbf24",
  },
  keyboardKeyTextShaddaSelected: {
    color: "#ffffff",
  },
  keyboardKeyLongPressed: {
    backgroundColor: "#e5e7eb",
  },
  keyboardKeyTanween: {
    width: 66,
    height: 70,
    paddingTop: -10,
    backgroundColor: "#ffffff",
    borderWidth: 2,
    borderColor: "#3b82f6",
    borderRadius: 6,
    justifyContent: "center",
    alignItems: "center",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.25,
    shadowRadius: 4,
    elevation: 5,
    zIndex: 1000,
  },
  keyboardKeyDiamond: {
    backgroundColor: "#fef2f2",
    borderColor: "#dc2626",
    borderWidth: 3,
  },
  diamondContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: "100%",
    height: "100%",
  },
  diamondBelow: {
    position: "absolute",
    bottom: -10,
    alignItems: "center",
    justifyContent: "center",
    width: "100%",
  },
  diamondShape: {
    width: 10,
    height: 10,
    backgroundColor: "#dc2626",
    transform: [{ rotate: "45deg" }],
    borderWidth: 0,
  },
  imalahCircleContainer: {
    position: "absolute",
    bottom: -8,
    alignItems: "center",
    justifyContent: "center",
    width: 8,
    height: 8,
  },
  imalahCircle: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#000",
  },
  diamondOverlayContainer: {
    position: "absolute",
    alignItems: "center",
    justifyContent: "center",
  },
  imalahPlacementOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.4)",
    justifyContent: "center",
    alignItems: "center",
    padding: 24,
  },
  imalahPlacementPopover: {
    backgroundColor: "#fff",
    borderRadius: 12,
    padding: 16,
    minWidth: 280,
    maxWidth: 320,
  },
  imalahPlacementTitle: {
    fontSize: 16,
    fontWeight: "700",
    color: "#111",
    marginBottom: 4,
  },
  imalahPlacementHint: {
    fontSize: 13,
    color: "#666",
    marginBottom: 12,
  },
  imalahCanvas: {
    width: "100%",
    height: 72,
    backgroundColor: "#f5f5f5",
    borderRadius: 8,
    position: "relative",
    justifyContent: "center",
    alignItems: "center",
    marginBottom: 12,
  },
  imalahCanvasText: {
    fontSize: 28,
    fontFamily: QURAN_FONT_FAMILY,
    color: "#1a1a1a",
    textAlign: "center",
    writingDirection: "rtl",
  },
  imalahCanvasCircle: {
    position: "absolute",
    width: 12,
    height: 12,
    borderRadius: 6,
    backgroundColor: "#000",
  },
  imalahPlacementActions: {
    flexDirection: "row",
    justifyContent: "space-between",
    gap: 12,
  },
  imalahPlacementRemoveBtn: {
    paddingVertical: 10,
    paddingHorizontal: 16,
    borderRadius: 8,
    backgroundColor: "#fee2e2",
  },
  imalahPlacementRemoveBtnText: {
    fontSize: 14,
    fontWeight: "600",
    color: "#b91c1c",
  },
  imalahPlacementDoneBtn: {
    paddingVertical: 10,
    paddingHorizontal: 20,
    borderRadius: 8,
    backgroundColor: "#10b981",
  },
  imalahPlacementDoneBtnText: {
    fontSize: 14,
    fontWeight: "700",
    color: "#fff",
  },
  keyboardKeyHelperDot: {
    backgroundColor: "#f0fdf4",
    borderColor: "#16a34a",
    borderWidth: 3,
  },
  helperDotContainer: {
    alignItems: "center",
    justifyContent: "center",
    position: "relative",
    width: "100%",
    height: "100%",
    flexDirection: "row",
  },
  helperDotText: {
    fontSize: 18,
    color: "#1f2937",
    marginLeft: 2,
  },
  helperDotTextLarge: {
    fontSize: 24,
  },
  keyboardKeyTanweenHovered: {
    backgroundColor: "#dbeafe",
    borderColor: "#2563eb",
    borderWidth: 3,
  },
  kasrahDropdownGrid: {
    position: "absolute",
    left: 0,
    flexDirection: "row",
    flexWrap: "wrap",
    width: 142, // 2 columns * 66px width + 10px gap
    gap: 10,
    zIndex: 1000,
  },
  sukoonDropdownContainer: {
    position: "absolute",
    left: "50%",
    marginLeft: -71, // half of row width 142 — centers strip under the key, avoids ScrollView clipping a 3rd column
    zIndex: 1000,
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  /** 4×keyboardKeyTanween (66) + 3×gap (10) — centers under key for tajweed vowel permutations */
  tajweedPermDropdownContainer: {
    position: "absolute",
    left: "50%",
    marginLeft: -147,
    zIndex: 1000,
    flexDirection: "column",
    alignItems: "center",
    gap: 8,
  },
  tajweedPermDropdownRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 10,
    justifyContent: "center",
    width: 294,
  },
  sukoonDropdownRow: {
    flexDirection: "row",
    flexWrap: "nowrap",
    gap: 10,
    justifyContent: "center",
    width: 142,
  },
  keyboardKeyHelperDiamondSukoon: {
    backgroundColor: "#eef2ff",
    borderColor: "#6366f1",
    borderWidth: 3,
  },
  keyboardEmptyState: {
    width: "100%",
    padding: 20,
    alignItems: "center",
    justifyContent: "center",
  },
  keyboardEmptyText: {
    fontSize: 12,
    color: "#9ca3af",
    textAlign: "center",
  },
  input: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    padding: 20,
    fontSize: 6,
    backgroundColor: "#f9f9f9",
    color: "#1a1a1a",
    fontFamily: QURAN_FONT_FAMILY,
    writingDirection: "rtl",
    textAlign: "right",
    minHeight: 44,
  },
  largeDisplayBlock: {
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 12,
    padding: 0,
    paddingVertical: 0,
    backgroundColor: "#ffffff",
    minHeight: 62,
    justifyContent: "center",
    alignItems: "center",
  },
  displayText: {
    fontSize: 32,
    fontFamily: QURAN_FONT_FAMILY,
    fontWeight: 'normal',
    fontStyle: 'normal',
    color: "#1a1a1a",
    lineHeight: 60,
    includeFontPadding: false,
    textAlign: "center",
    writingDirection: "rtl",
    paddingVertical: 4,
  },
  displayTextHighlighted: {
    backgroundColor: "#10b981",
    borderRadius: 4,
    paddingHorizontal: 3,
    paddingVertical: 2,
    color: "#ffffff",
    fontFamily: QURAN_FONT_FAMILY,
  },
  displayPlaceholder: {
    fontSize: 24,
    color: "#999",
    fontFamily: QURAN_FONT_FAMILY,
    textAlign: "right",
  },
  renderedTextContainer: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    padding: 12,
    paddingTop: 14,
    paddingBottom: 14,
    justifyContent: "flex-start",
    alignItems: "flex-end",
    pointerEvents: "none",
  },
  renderedTextWrapper: {
    position: "relative",
    flexDirection: "row-reverse",
    alignItems: "flex-start",
    width: "100%",
  },
  renderedText: {
    fontSize: 16,
    fontFamily: QURAN_FONT_FAMILY,
    writingDirection: "rtl",
    textAlign: "right",
    color: "#1a1a1a",
    lineHeight: 24,
    includeFontPadding: true,
  },
  redDotAbsolute: {
    position: "absolute",
    bottom: -4,
    alignItems: "center",
    justifyContent: "center",
  },
  redDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    backgroundColor: "#ff0000",
  },
  inputRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  deleteButton: {
    padding: 10,
    borderWidth: 1,
    borderColor: "#ddd",
    borderRadius: 8,
    backgroundColor: "#fff3f3",
  },
  deleteIcon: {
    fontSize: 16,
    color: "#d32f2f",
  },
  variationsSidebarOverlay: {
    position: "absolute",
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    zIndex: 1000,
  },
  variationsSidebarBackdrop: {
    backgroundColor: "rgba(0,0,0,0.4)",
  },
  variationsSidebarPanel: {
    position: "absolute",
    right: 0,
    top: 0,
    bottom: 0,
    width: 320,
    backgroundColor: "#1F1F22",
    shadowColor: "#000",
    shadowOffset: { width: -2, height: 0 },
    shadowOpacity: 0.15,
    shadowRadius: 8,
    elevation: 8,
  },
  variationsSidebarHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 16,
    paddingVertical: 16,
    paddingTop: Platform.OS === "ios" ? 56 : (StatusBar.currentHeight || 0) + 24,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3a",
    backgroundColor: "#1F1F22",
  },
  variationsSidebarTitle: {
    fontSize: 18,
    fontWeight: "700",
    color: "#ffffff",
  },
  variationsSidebarClose: {
    padding: 8,
    marginRight: -8,
  },
  variationsSidebarCloseText: {
    fontSize: 20,
    color: "#aaaaaa",
    fontWeight: "600",
  },
  variationsSidebarEmpty: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    padding: 32,
  },
  variationsSidebarEmptyText: {
    fontSize: 14,
    color: "#aaaaaa",
    textAlign: "center",
    lineHeight: 22,
  },
  variationsSidebarList: {
    flex: 1,
    backgroundColor: "#1F1F22",
  },
  variationsSidebarListContent: {
    paddingBottom: 40,
    paddingHorizontal: 12,
  },
  variationsSidebarItem: {
    paddingVertical: 12,
    paddingHorizontal: 4,
    borderBottomWidth: StyleSheet.hairlineWidth,
    borderBottomColor: "#3a3a3a",
    backgroundColor: "#1F1F22",
  },
  variationsSidebarItemActive: {
    backgroundColor: "#353535",
  },
  variationsSidebarItemPage: {
    fontSize: 11,
    color: "#888",
    marginBottom: 8,
  },
  variationsSidebarItemRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  variationsSidebarItemBlock: {
    flex: 1,
    alignItems: "center",
    minWidth: 0,
  },
  variationsSidebarItemLabel: {
    fontSize: 11,
    color: "#999",
    marginBottom: 4,
  },
  variationsSidebarChipUnselected: {
    backgroundColor: "#555",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
  },
  variationsSidebarChipSelected: {
    backgroundColor: "#1a1a1a",
    paddingHorizontal: 12,
    paddingVertical: 8,
    borderRadius: 20,
    borderWidth: 2,
    borderColor: "#c9a227",
  },
  variationsSidebarChipText: {
    fontSize: 16,
    fontWeight: "700",
    color: "#ffffff",
    textAlign: "center",
  },
  variationsSidebarItemArrow: {
    fontSize: 18,
    color: "#888",
    marginHorizontal: 8,
    flexShrink: 0,
  },
  pageSliderModalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0, 0, 0, 0.5)",
    justifyContent: "center",
    alignItems: "center",
  },
  pageSliderModalContent: {
    backgroundColor: "#fff",
    borderRadius: 16,
    padding: 24,
    width: "85%",
    maxWidth: 400,
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.3,
    shadowRadius: 8,
    elevation: 8,
  },
  pageSliderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: 24,
  },
  pageSliderTitle: {
    fontSize: 20,
    fontWeight: "600",
    color: "#1a1a1a",
  },
  pageSliderCloseButton: {
    padding: 4,
  },
  pageSliderCloseText: {
    fontSize: 24,
    color: "#666",
    fontWeight: "300",
  },
  pageSliderContainer: {
    alignItems: "stretch",
  },
  pageSliderPageNumber: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#027778",
    textAlign: "center",
    marginBottom: 20,
  },
  pageSliderPageNumberInput: {
    fontSize: 32,
    fontWeight: "bold",
    color: "#027778",
    textAlign: "center",
    marginBottom: 20,
    borderWidth: 2,
    borderColor: "#027778",
    borderRadius: 8,
    paddingVertical: 12,
    paddingHorizontal: 20,
    backgroundColor: "#f9f9f9",
  },
  pageSliderWrapper: {
    marginHorizontal: 10,
    marginBottom: 12,
  },
  pageSliderContainerStyle: {
    flex: 1,
  },
  pageSliderThumb: {
    width: 24,
    height: 24,
    backgroundColor: "#027778",
    shadowColor: "#027778",
    shadowOffset: { width: 0, height: 2 },
    shadowOpacity: 0.3,
    shadowRadius: 4,
    elevation: 4,
  },
  pageSliderTrack: {
    height: 4,
    borderRadius: 2,
  },
  pageSliderLabels: {
    flexDirection: "row",
    justifyContent: "space-between",
    marginTop: 8,
    paddingHorizontal: 10,
  },
  pageSliderLabel: {
    fontSize: 14,
    color: "#666",
  },
  carouselContainer: {
    marginBottom: 20,
  },
  carouselLabel: {
    fontSize: 14,
    fontWeight: "600",
    color: "#333",
    marginBottom: 8,
  },
  goPageSurahSearchInput: {
    borderWidth: 1,
    borderColor: "#d0d0d0",
    borderRadius: 10,
    paddingVertical: 10,
    paddingHorizontal: 12,
    fontSize: 16,
    marginBottom: 10,
    backgroundColor: "#fafafa",
    color: "#1a1a1a",
  },
  goPageSurahSearchEmpty: {
    fontSize: 14,
    color: "#666",
    paddingVertical: 12,
    textAlign: "center",
  },
  carouselScrollView: {
    maxHeight: 52,
  },
  carouselSurahScrollView: {
    maxHeight: 96,
  },
  carouselContent: {
    paddingRight: 10,
    flexDirection: "row",
    alignItems: "center",
  },
  carouselItemBase: {
    paddingHorizontal: 14,
    marginRight: 8,
    borderRadius: 8,
    backgroundColor: "#f5f5f5",
    borderWidth: 1,
    borderColor: "#e0e0e0",
    alignItems: "center",
    justifyContent: "center",
    alignSelf: "flex-start",
    flexShrink: 0,
  },
  carouselItemJuz: {
    height: 44,
  },
  carouselItemSurah: {
    minHeight: 56,
    paddingVertical: 6,
    paddingHorizontal: 12,
    overflow: "visible",
  },
  carouselSurahChipInner: {
    position: "relative",
    alignItems: "center",
    justifyContent: "center",
    paddingBottom: 18,
    paddingTop: 2,
    minWidth: 40,
  },
  /** Surah index (1–114) — sits under Arabic title */
  carouselSurahNumPill: {
    position: "absolute",
    bottom: 0,
    alignSelf: "center",
    minWidth: 24,
    paddingHorizontal: 8,
    paddingVertical: 3,
    borderRadius: 999,
    backgroundColor: "rgba(0,0,0,0.06)",
    borderWidth: StyleSheet.hairlineWidth,
    borderColor: "rgba(0,0,0,0.1)",
    alignItems: "center",
    justifyContent: "center",
  },
  carouselSurahNumPillLit: {
    backgroundColor: "rgba(255,255,255,0.22)",
    borderColor: "rgba(255,255,255,0.38)",
  },
  carouselSurahNumPillText: {
    fontSize: 11,
    fontWeight: "700",
    color: "#4a5568",
    letterSpacing: 0.2,
  },
  carouselSurahNumPillTextLit: {
    color: "#fff",
  },
  carouselItemActive: {
    backgroundColor: "#027778",
    borderColor: "#027778",
  },
  /** Go to Page surah chip: mushaf 2 + header-insert flag — page has a line with this surah's banner row */
  carouselItemSurahHasDbHeader: {
    backgroundColor: "#2e7d32",
    borderColor: "#1b5e20",
  },
  carouselItemText: {
    fontSize: 14,
    color: "#666",
    fontWeight: "500",
    flexShrink: 0,
  },
  carouselItemSurahTitle: {
    textAlign: "center",
    marginBottom: 6,
  },
  carouselItemTextActive: {
    color: "#fff",
    fontWeight: "600",
  },
});
