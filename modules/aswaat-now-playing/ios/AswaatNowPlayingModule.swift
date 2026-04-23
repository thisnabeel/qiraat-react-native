import ExpoModulesCore
import MediaPlayer
import UIKit

private enum AswaatNowPlayingEvents {
  static let remotePlay = "AswaatNowPlaying.onRemotePlay"
  static let remotePause = "AswaatNowPlaying.onRemotePause"
  static let remoteToggle = "AswaatNowPlaying.onRemoteTogglePlayPause"
  static let remoteSeek = "AswaatNowPlaying.onRemoteSeek"
}

public final class AswaatNowPlayingModule: Module {
  private var artworkTask: URLSessionDataTask?

  public func definition() -> ModuleDefinition {
    Name("AswaatNowPlaying")

    Events(
      AswaatNowPlayingEvents.remotePlay,
      AswaatNowPlayingEvents.remotePause,
      AswaatNowPlayingEvents.remoteToggle,
      AswaatNowPlayingEvents.remoteSeek
    )

    OnCreate {
      let center = MPRemoteCommandCenter.shared()
      center.playCommand.isEnabled = true
      center.pauseCommand.isEnabled = true
      center.togglePlayPauseCommand.isEnabled = true
      center.changePlaybackPositionCommand.isEnabled = true

      center.playCommand.addTarget { [weak self] _ in
        self?.sendEvent(AswaatNowPlayingEvents.remotePlay, [:])
        return .success
      }
      center.pauseCommand.addTarget { [weak self] _ in
        self?.sendEvent(AswaatNowPlayingEvents.remotePause, [:])
        return .success
      }
      center.togglePlayPauseCommand.addTarget { [weak self] _ in
        self?.sendEvent(AswaatNowPlayingEvents.remoteToggle, [:])
        return .success
      }
      center.changePlaybackPositionCommand.addTarget { [weak self] event in
        guard let e = event as? MPChangePlaybackPositionCommandEvent else {
          return .commandFailed
        }
        self?.sendEvent(AswaatNowPlayingEvents.remoteSeek, [
          "positionMillis": e.positionTime * 1000.0
        ])
        return .success
      }
    }

    OnDestroy {
      let center = MPRemoteCommandCenter.shared()
      center.playCommand.removeTarget(nil)
      center.pauseCommand.removeTarget(nil)
      center.togglePlayPauseCommand.removeTarget(nil)
      center.changePlaybackPositionCommand.removeTarget(nil)
      center.playCommand.isEnabled = false
      center.pauseCommand.isEnabled = false
      center.togglePlayPauseCommand.isEnabled = false
      center.changePlaybackPositionCommand.isEnabled = false
    }

    AsyncFunction("updateNowPlaying") { (raw: [String: Any]) in
      self.artworkTask?.cancel()
      self.artworkTask = nil

      let title = raw["title"] as? String ?? ""
      let artist = raw["artist"] as? String
      let durationMillis = Self.readDouble(raw["durationMillis"]) ?? 0
      let positionMillis = Self.readDouble(raw["positionMillis"]) ?? 0
      let playbackRate = Self.readDouble(raw["playbackRate"]) ?? 0
      let artworkUrlString = (raw["artworkUrl"] as? String)?.trimmingCharacters(in: .whitespacesAndNewlines)

      var info: [String: Any] = [
        MPMediaItemPropertyTitle: title,
        MPMediaItemPropertyPlaybackDuration: durationMillis / 1000.0,
        MPNowPlayingInfoPropertyElapsedPlaybackTime: positionMillis / 1000.0,
        MPNowPlayingInfoPropertyPlaybackRate: playbackRate
      ]
      if let artist, !artist.isEmpty {
        info[MPMediaItemPropertyArtist] = artist
      }

      MPNowPlayingInfoCenter.default().nowPlayingInfo = info

      guard let artworkUrlString, let url = URL(string: artworkUrlString), url.scheme == "http" || url.scheme == "https" else {
        return
      }

      let task = URLSession.shared.dataTask(with: url) { [weak self] data, _, _ in
        guard let self else { return }
        guard let data, let image = UIImage(data: data) else { return }
        let artwork = MPMediaItemArtwork(boundsSize: image.size) { _ in image }
        DispatchQueue.main.async {
          var merged = MPNowPlayingInfoCenter.default().nowPlayingInfo ?? [:]
          merged[MPMediaItemPropertyArtwork] = artwork
          MPNowPlayingInfoCenter.default().nowPlayingInfo = merged
        }
      }
      self.artworkTask = task
      task.resume()
    }
    .runOnQueue(.main)

    AsyncFunction("clearNowPlaying") {
      self.artworkTask?.cancel()
      self.artworkTask = nil
      MPNowPlayingInfoCenter.default().nowPlayingInfo = nil
    }
    .runOnQueue(.main)
  }

  private static func readDouble(_ value: Any?) -> Double? {
    if let d = value as? Double { return d }
    if let i = value as? Int { return Double(i) }
    if let n = value as? NSNumber { return n.doubleValue }
    return nil
  }
}
