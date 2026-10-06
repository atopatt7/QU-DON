/**
 * QU-DON | src/core/Layout.js
 * 畫面配置：地圖區與控制面板的分割規則（所有模組共用，避免各自寫死比例）
 *
 *   直式（手機直拿、一般桌面視窗）：上方 66% 地圖，下方 34% 控制面板（木紋底）
 *   橫式（手機橫拿、寬螢幕）：地圖佔滿整個畫面，D-Pad 與按鈕疊在左右下角（無底板）
 */

const PORTRAIT_GAME_RATIO = 0.66;

/** 寬明顯大於高時視為橫式（留一點餘裕，接近正方形的視窗仍用直式） */
export function isLandscape(W, H) {
  return W > H * 1.15;
}

/** 地圖可視區域的高度（px） */
export function gameAreaHeight(W, H) {
  return isLandscape(W, H) ? H : Math.floor(H * PORTRAIT_GAME_RATIO);
}

/**
 * 控制面板的配置。
 * @returns {{ overlay: boolean, height: number }}
 *   overlay = true 時面板透明、疊在地圖上（橫式）
 */
export function panelLayout(W, H) {
  if (isLandscape(W, H)) {
    return { overlay: true, height: Math.min(Math.floor(H * 0.48), 200) };
  }
  return { overlay: false, height: H - gameAreaHeight(W, H) };
}
