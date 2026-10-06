# QU-DON 瞿董默示錄

PixiJS v8 純靜態 PWA（無 build），推到 `main` 後由 GitHub Actions 部署到 GitHub Pages。

## 寫任何劇情、台詞、道具、地圖之前
先讀 [docs/WORLD.md](docs/WORLD.md)（世界觀設定集，canon）。地名、人物、用語、禁忌都以它為準；標 🔒 的內容不可直接寫進遊戲文字。

## 修改規則
- `sw.js`：JS / JSON / HTML 走 Network First（線上玩家自動拿新版）；圖片 / 音訊走 Cache First，**改了圖片或音訊要升 `CACHE_NAME`**。新增的檔案加進 `PRECACHE` 才能離線遊玩。
- 效能預算：手機是主要目標。新增大圖前先壓縮（UI 圖用 WebP、地圖格 48px），不要讓精靈包在子容器裡做裁切（PixiJS 8.2.6 會畫壞，見 `MapManager._addTile`）。
- 版面比例統一用 `src/core/Layout.js`（直式 66/34、橫式全畫面 + 疊加按鈕），不要在各模組寫死 0.66。
- 改資料後跑 `node scripts/validate_data.js`，必須 0 錯誤（CI 部署前也會跑）。
- 黑石街西郊、哈卡街東郊由 `scripts/build_west_suburb.js`、`scripts/build_hakka_east_suburb.js` 生成，不要手改那兩個地圖 JSON。其他地圖是單行 JSON，用腳本讀寫（`JSON.stringify(JSON.parse(raw)) === raw` 先確認格式）。
- NPC 對話 / 選項 / 條件寫在 `src/data/npcs/npcs_<地圖ID>.json`，格式見 `src/core/EntityManager.js` 與 `src/modules/InteractionManager.js` 開頭註解；調查點寫在地圖 JSON 的 `triggers`（`type: "examine"`）；任務日誌寫在 `src/data/journal.json`。條件一律用 `if` / `ifNot` / `requiresItem`。
- 新角色沒有美術時：新增 `src/data/entities/actors/<id>.json`，借用既有雪碧圖並加 `visuals.tint`，標上 `"_art"`，再登記到 `registry.json`。
- 驗證腳本會檢查可走到性（出口 / NPC / 調查點）、物品 ID、預快取清單；資料改完一定要跑。
