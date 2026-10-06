/**
 * QU-DON | src/core/AudioManager.js
 * 靜態單例 BGM 管理器 — Web Audio API（HTMLAudioElement）
 *
 * 用法：
 *   AudioManager.playBGM('assets/sounds/bgm/neon_bar_theme.webm');
 *   AudioManager.stopBGM();
 */

export class AudioManager {
  static _audio  = null;   // 當前 HTMLAudioElement
  static _url    = '';     // 當前播放的 URL
  static _volume = 0.55;   // 全域音量 0~1
  static _muted  = false;  // 設定中的「音樂」關閉
  static _wanted = '';     // 目前場景應該播放的 BGM（靜音時記住，取消靜音後接著播）

  /** 開關音樂。關閉時停止播放；重新開啟時播放目前場景的 BGM。 */
  static setMuted(muted) {
    AudioManager._muted = !!muted;
    if (AudioManager._muted) {
      const wanted = AudioManager._wanted;
      AudioManager.stopBGM();
      AudioManager._wanted = wanted;
    } else if (AudioManager._wanted) {
      AudioManager.playBGM(AudioManager._wanted);
    }
  }

  static get muted() { return AudioManager._muted; }

  /**
   * 播放 BGM。若已在播放同一檔案則不重新啟動。
   * @param {string} url 音訊路徑
   */
  static playBGM(url) {
    AudioManager._wanted = url;
    if (AudioManager._muted) return;
    if (AudioManager._url === url && AudioManager._audio && !AudioManager._audio.paused) return;

    AudioManager.stopBGM();

    const audio  = new Audio(url);
    audio.loop   = true;
    audio.volume = AudioManager._volume;

    audio.play().catch(err => {
      // 瀏覽器 autoplay 政策：使用者互動後才能播放，靜默忽略
      console.warn('[AudioManager] BGM 播放被封鎖（autoplay policy）:', err.message);
    });

    AudioManager._audio = audio;
    AudioManager._url   = url;
  }

  /** 停止目前 BGM 並釋放資源。 */
  static stopBGM() {
    AudioManager._wanted = '';
    if (!AudioManager._audio) return;
    AudioManager._audio.pause();
    AudioManager._audio.currentTime = 0;
    AudioManager._audio.src = '';
    AudioManager._audio = null;
    AudioManager._url   = '';
  }

  /**
   * 設定音量（立即套用到當前播放中的音訊）。
   * @param {number} v 0~1
   */
  static setVolume(v) {
    AudioManager._volume = Math.max(0, Math.min(1, v));
    if (AudioManager._audio) AudioManager._audio.volume = AudioManager._volume;
  }
}
