import { Platform } from "react-native";
import { requireOptionalNativeModule } from "expo-modules-core";

const Native = requireOptionalNativeModule("AswaatNowPlaying");

const EVT = {
  play: "AswaatNowPlaying.onRemotePlay",
  pause: "AswaatNowPlaying.onRemotePause",
  toggle: "AswaatNowPlaying.onRemoteTogglePlayPause",
  seek: "AswaatNowPlaying.onRemoteSeek",
};

let lastPostedAt = 0;
let lastScheduledPlaying = null;

function resolveArtworkUrl(reciter) {
  const u = (reciter?.avatar_url || "").trim();
  if (u.startsWith("http://") || u.startsWith("https://")) return u;
  return null;
}

/**
 * Pushes metadata to MPNowPlayingInfoCenter (lock screen, Control Center, Dynamic Island).
 * Throttles frequent position-only updates unless `force` is true.
 */
export function scheduleListenNowPlayingSync({
  track,
  reciter,
  positionMs,
  durationMs,
  isPlaying,
  force = false,
}) {
  if (Platform.OS !== "ios" || !Native || !track) return Promise.resolve();

  const now = Date.now();
  const playingChanged = lastScheduledPlaying !== isPlaying;
  lastScheduledPlaying = isPlaying;
  // Throttle position-only updates while playing; always push play/pause transitions and forced updates.
  if (!force && isPlaying && !playingChanged && now - lastPostedAt < 900) {
    return Promise.resolve();
  }
  lastPostedAt = now;

  const title = `Surah ${track.index} · ${track.name || ""}`.trim();
  const reciterName = (reciter?.name || "").trim() || track.reciterSlug || "";
  const artist = [reciterName, track.riwayahLabel].filter(Boolean).join(" · ");

  return Native.updateNowPlaying({
    title,
    artist: artist || undefined,
    durationMillis: durationMs,
    positionMillis: positionMs,
    playbackRate: isPlaying ? 1 : 0,
    artworkUrl: resolveArtworkUrl(reciter),
  });
}

export function clearListenNowPlaying() {
  if (Platform.OS !== "ios" || !Native) return Promise.resolve();
  lastPostedAt = 0;
  lastScheduledPlaying = null;
  return Native.clearNowPlaying();
}

/**
 * @param {{ onPlay: () => void, onPause: () => void, onToggle: () => void, onSeek: (positionMillis: number) => void }} handlers
 * @returns {() => void} unsubscribe
 */
export function subscribeListenRemoteCommands(handlers) {
  if (Platform.OS !== "ios" || !Native) {
    return () => {};
  }
  const subs = [
    Native.addListener(EVT.play, () => handlers.onPlay?.()),
    Native.addListener(EVT.pause, () => handlers.onPause?.()),
    Native.addListener(EVT.toggle, () => handlers.onToggle?.()),
    Native.addListener(EVT.seek, (e) => {
      const ms = Number(e?.positionMillis);
      if (Number.isFinite(ms)) handlers.onSeek?.(ms);
    }),
  ];
  return () => {
    subs.forEach((s) => s.remove());
  };
}
