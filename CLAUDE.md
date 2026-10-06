# QU-DON 瞿董默示錄

PixiJS v8 純靜態 PWA（無 build），推到 `main` 後由 GitHub Actions 部署到 GitHub Pages。

## 寫任何劇情、台詞、道具、地圖之前
先讀 [docs/WORLD.md](docs/WORLD.md)（世界觀設定集，canon）。地名、人物、用語、禁忌都以它為準；標 🔒 的內容不可直接寫進遊戲文字。

## 修改規則
- 改了任何遊戲檔案都要升 `sw.js` 的 `CACHE_NAME` 版本號（Cache First，不升手機會一直拿舊檔）；新增的檔案要加進 `LOCAL_FILES`。
- 改資料後跑 `node scripts/validate_data.js`，必須 0 錯誤（CI 部署前也會跑）。
- 黑石街西郊地圖由 `node scripts/build_west_suburb.js` 生成，不要手改 `map_black_rock_west_suburb.json`。
- NPC 對話 / 選項 / 條件寫在 `src/data/npcs/npcs_<地圖ID>.json`，格式見 `src/core/EntityManager.js` 與 `src/modules/InteractionManager.js` 開頭註解。
