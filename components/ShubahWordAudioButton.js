import React, {
  useEffect,
  useRef,
  useState,
  forwardRef,
  useImperativeHandle,
} from "react";
import {
  ActivityIndicator,
  StyleSheet,
  Text,
  TouchableOpacity,
  View,
} from "react-native";
import { Audio } from "expo-av";
import {
  getShubahAudioUrlForSurah,
  getWordSegmentForText,
} from "./shubahTimestamps";

const ShubahWordAudioButton = forwardRef(function ShubahWordAudioButton(
  { word, surahNumber, showIcon = true },
  ref
) {
  const [isLoading, setIsLoading] = useState(false);
  const [isPlaying, setIsPlaying] = useState(false);
  const [error, setError] = useState(null);
  const soundRef = useRef(null);
  const currentWordEndRef = useRef(null);

  const wordText = word?.content;
  const lineWords = Array.isArray(word?.lineWords) ? word.lineWords : [];
  const targetIndex =
    lineWords.findIndex((w) => w.id === word?.id) >= 0
      ? lineWords.findIndex((w) => w.id === word?.id)
      : word?.position ?? null;
  const contextSequence =
    targetIndex !== null && targetIndex >= 0
      ? [
          lineWords[targetIndex - 1]?.content,
          wordText,
          lineWords[targetIndex + 1]?.content,
        ].filter(Boolean)
      : [wordText].filter(Boolean);
  const verseText =
    word?.ayah_text ||
    word?.verse_text ||
    word?.ayah?.text ||
    word?.verse?.text ||
    null;

  useEffect(() => {
    return () => {
      if (soundRef.current) {
        soundRef.current.unloadAsync().catch(() => {});
      }
    };
  }, []);

  const handlePlay = async () => {
    if (!wordText || !surahNumber) return;

    setError(null);
    setIsLoading(true);

    try {
      const segment = getWordSegmentForText(surahNumber, wordText, {
        verseText,
        contextSequence,
      });
      if (!segment || typeof segment.start !== "number" || typeof segment.end !== "number") {
        setError("No timing for this word yet.");
        setIsLoading(false);
        return;
      }

      const audioUrl = getShubahAudioUrlForSurah(surahNumber);
      if (!audioUrl) {
        setError("Missing audio URL.");
        setIsLoading(false);
        return;
      }

      try {
        // Debug: log which JSON entry we matched for this word
        console.log("🎧 Shu'bah match", {
          word: wordText,
          surahNumber,
          source: segment.source || "unknown",
          similarity: segment.similarity ?? null,
          start: segment.start,
          end: segment.end,
          score: segment.score ?? null,
        });
      } catch (e) {
        // Ignore logging failures
      }

      if (!soundRef.current) {
        const { sound } = await Audio.Sound.createAsync(
          { uri: audioUrl },
          { shouldPlay: false },
          (status) => {
            if (!status.isLoaded) return;
            if (status.isPlaying) {
              const endSeconds = currentWordEndRef.current;
              if (
                typeof endSeconds === "number" &&
                status.positionMillis >= endSeconds * 1000
              ) {
                soundRef.current
                  ?.pauseAsync()
                  .catch(() => {});
                setIsPlaying(false);
              }
            }
          }
        );
        soundRef.current = sound;
      }

      const paddedStart = Math.max(0, (segment.start || 0) - 0.03);
      currentWordEndRef.current = segment.end;

      await soundRef.current.setPositionAsync(paddedStart * 1000);
      await soundRef.current.playAsync();
      setIsPlaying(true);
      if (segment.source === "segment") {
        setError(null);
      }
    } catch (e) {
      console.error("Error playing Shu'bah word audio", e);
      setError("Audio error.");
    } finally {
      setIsLoading(false);
    }
  };

  useImperativeHandle(ref, () => ({
    play: () => {
      if (!isLoading) {
        handlePlay();
      }
    },
  }));

  const disabled = isLoading || !wordText || !surahNumber;

  return (
    <View
      style={[
        styles.container,
        !showIcon && styles.containerInvisible,
      ]}
    >
      <TouchableOpacity
        onPress={handlePlay}
        style={[
          styles.button,
          disabled && styles.buttonDisabled,
          !showIcon && styles.buttonInvisible,
        ]}
        disabled={disabled}
        activeOpacity={0.8}
      >
        {showIcon && isLoading ? (
          <ActivityIndicator size="small" color="#ffffff" />
        ) : showIcon ? (
          <Text style={styles.icon}>▶︎</Text>
        ) : null}
      </TouchableOpacity>
      {showIcon && error ? <Text style={styles.errorText}>{error}</Text> : null}
    </View>
  );
});

const styles = StyleSheet.create({
  container: {
    flexDirection: "row",
    alignItems: "center",
  },
  containerInvisible: {
    width: 0,
    height: 0,
    overflow: "hidden",
  },
  button: {
    width: 32,
    height: 32,
    borderRadius: 16,
    backgroundColor: "#027778",
    alignItems: "center",
    justifyContent: "center",
    marginLeft: 8,
  },
  buttonInvisible: {
    width: 0,
    height: 0,
    marginLeft: 0,
    borderRadius: 0,
    backgroundColor: "transparent",
  },
  buttonDisabled: {
    backgroundColor: "#999999",
  },
  icon: {
    color: "#ffffff",
    fontSize: 18,
    fontWeight: "600",
  },
  errorText: {
    marginLeft: 8,
    fontSize: 12,
    color: "#cc0000",
  },
});

export default ShubahWordAudioButton;

