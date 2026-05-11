# 對話頭像 / Portraits

格式：PNG（透明背景）
尺寸：78×78 px（DialogueOverlay 頭像框固定尺寸）

命名規則：`{speaker_id}_portrait.png`

| 檔案 | 說話者 |
|------|--------|
| qu_don_portrait.png | 瞿董（主角） |
| raymond_portrait.png | 雷蒙 |
| lina_portrait.png | 莉娜 |
| eddie_portrait.png | 艾迪 |
| unknown_portrait.png | ???（身份未知 NPC 通用） |

使用方式：在 DialogueOverlay 的 `speaker` 欄位
填入對應 ID（去掉 _portrait.png），程式自動載入貼圖。
