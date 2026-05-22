/**
 * QU-DON | src/modules/InteractionManager.js
 * 環境調查 + NPC 對話系統
 *
 * 使用方式（main.js 遊戲迴圈）：
 *   if (state.confirmJust) {
 *     if (interaction.isActive) interaction.advance();
 *     else                      interaction.tryInteract(player.gx, player.gy, facing);
 *   }
 *
 * NPC 互動：
 *   interaction.setEntityManager(entityManager);
 *   → tryInteract 會自動偵測正前方（或穿過特定障礙物）的可互動 NPC
 *
 * 設計守則：
 *   - 不修改 MapManager._isDirty（純讀取，不觸發重渲染）
 *   - 不使用 input.lock()（避免阻斷確認鍵自身的讀取）
 *   - 調查中 main.js 提前 return，lerp 動畫同步暫停
 */

// ─── 環境描述資料表（Tile ID → 對話內容）────────────────────────────────────────
const TILE_EXAMINE = {
  1024: {
    speaker: '（環境）',
    text: '這張床雖然硬，但在黑石街，能躺著睡覺已經是奢侈。',
  },
  1026: {
    speaker: '（環境）',
    text: '播著無止盡的雪花，這台老古董快撐不下去了。',
  },
  1027: {
    speaker: '（環境）',
    text: '水龍頭滴著帶有鏽味的水，提醒著你時間正在流逝。',
  },
  1028: {
    speaker: '（環境）',
    text: '皮革已經龜裂。曾經你在這決定過無數人的生死，現在只能用來發呆。',
  },
  // ── 便利商店環境調查 ──────────────────────────────────────────────────────
  1034: {
    speaker: '（環境）',
    text: '貨架上的泡麵快過期了。包裝紙起了一角，像是在無聲地求救。',
  },
  1036: {
    speaker: '（環境）',
    text: '冰櫃透出冷冷的藍光。架上有幾瓶不知名能量飲料，標籤已經褪色。',
  },
};

// ─── 面向 → 前方格子偏移量 ─────────────────────────────────────────────────────
const FACING_DELTA = {
  up:    [  0, -1 ],
  down:  [  0,  1 ],
  left:  [ -1,  0 ],
  right: [  1,  0 ],
};

// ─── 允許「穿透互動」的障礙 Tile ID（如收銀台）──────────────────────────────────
// 當正前方是這些 tile 時，視線延伸一格，偵測更遠的 NPC
const PASSTHROUGH_TILES = new Set([1035]);

export class InteractionManager {
  /**
   * @param {import('../modules/MapManager.js').MapManager} mapManager
   * @param {import('../ui/DialogueOverlay.js').DialogueOverlay} dialogueOverlay
   */
  constructor(mapManager, dialogueOverlay) {
    this._map        = mapManager;
    this._dlg        = dialogueOverlay;
    this._em         = null;   // EntityManager（可選，啟用 NPC 互動）
    this._active     = false;
    this._tileConfig = null;   // config.json tiles 字典，非同步載入後填入

    // 非阻塞預載：搶在玩家第一次按確認鍵之前完成
    fetch('./src/data/maps/config.json')
      .then(r => r.json())
      .then(json => { this._tileConfig = json.tiles ?? {}; })
      .catch(() => { this._tileConfig = {}; });
  }

  /**
   * 注入 EntityManager，啟用 NPC 對話偵測。
   * 在 main.js 的 startGame 階段呼叫一次即可（EntityManager 不隨地圖重建）。
   * @param {import('../core/EntityManager.js').EntityManager} entityManager
   */
  setEntityManager(entityManager) {
    this._em = entityManager;
  }

  // ─── 公開 API ──────────────────────────────────────────────────────────────

  /**
   * 玩家按下確認鍵時呼叫。
   * 偵測流程：
   *   1. 正前方 NPC（直接碰觸）
   *   2. 隔著「穿透 tile」的 NPC（如玩家 → 收銀台 → 店員）
   *   3. 正前方 Tile 環境調查
   * @param {number} gx      玩家當前格 X
   * @param {number} gy      玩家當前格 Y
   * @param {string} facing  玩家面向 ('up'|'down'|'left'|'right')
   * @returns {boolean}  true 表示對話已觸發
   */
  tryInteract(gx, gy, facing) {
    if (this._active) return false;

    const [dx, dy] = FACING_DELTA[facing] ?? [0, 1];
    const tx = gx + dx;
    const ty = gy + dy;

    const md = this._map.mapData;
    if (!md) return false;
    if (tx < 0 || ty < 0 || tx >= md.width || ty >= (md.height ?? Infinity)) return false;

    // ── 1 & 2：NPC 互動（直接 + 穿透障礙物）───────────────────────────────────
    if (this._em) {
      let npc = this._em.getNpcAt(tx, ty);

      if (!npc) {
        // 正前方是「穿透 tile」（例如收銀台）→ 嘗試再往前一格
        const frontIdx    = ty * md.width + tx;
        const frontTileId = md.layers.objects?.[frontIdx] ?? 0;
        if (PASSTHROUGH_TILES.has(frontTileId)) {
          const nx = tx + dx;
          const ny = ty + dy;
          const inBounds = nx >= 0 && ny >= 0 && nx < md.width && ny < (md.height ?? Infinity);
          if (inBounds) npc = this._em.getNpcAt(nx, ny);
        }
      }

      if (npc?.interactable && npc.entityData?.dialogue?.length) {
        return this._startNpcDialogue(npc);
      }
    }

    // ── 3：Tile 環境調查（TILE_EXAMINE 優先，config.json 描述次之）──────────────
    const idx    = ty * md.width + tx;
    const tileId = md.layers.objects?.[idx] || md.layers.ground?.[idx] || 0;
    return this._checkObjectTrigger(tileId);
  }

  /**
   * 對話框開啟期間，鍵盤確認鍵呼叫此方法。
   * 打字中 → 立即顯示全文；打字完成 → 推進下一行或關閉。
   */
  advance() {
    if (!this._active) return;
    this._dlg.advance();
  }

  /** 對話框是否正在顯示中（用於 main.js 封鎖移動輸入） */
  get isActive() { return this._active; }

  // ─── 內部 ──────────────────────────────────────────────────────────────────

  /**
   * 逐行顯示 NPC 的 dialogue 陣列，全部播完後關閉。
   * 預留 TODO：最後一行結束後可插入選項選單（商店 / 搶劫）。
   */
  _startNpcDialogue(npc) {
    const lines  = npc.entityData.dialogue;
    const name   = npc.entityData.name ?? npc.id;
    let   lineIdx = 0;

    this._active      = true;
    this._dlg.visible = true;

    const showNext = () => {
      if (lineIdx >= lines.length) {
        // TODO: Show Shop/Robbery menu here after dialogue
        //   e.g. this._dlg.show('', name, [{ label: '購物' }, { label: '搶劫' }, { label: '離開' }]);
        this._close();
        return;
      }
      this._dlg.show(lines[lineIdx], name);
      lineIdx++;
      this._dlg.once('next', showNext);
    };

    showNext();
    return true;
  }

  /**
   * 方塊調查觸發器：
   *   優先路徑 — TILE_EXAMINE 硬編碼表（富文本 lore 描述）
   *   次要路徑 — config.json 動態查詢（collides=true 且有 desc 的方塊）
   *
   * 修改點：此方法抽離自 tryInteract() 原 128-138 行的內聯邏輯，
   *         並在後段新增 config.json 回退路徑。
   *
   * @param {number} tileId  — 前方格子的 tile ID
   * @returns {boolean}  true = 已觸發對話
   */
  _checkObjectTrigger(tileId) {
    // ── 路徑一：TILE_EXAMINE 精確對應（lore 優先）────────────────────────────
    const examine = TILE_EXAMINE[tileId];
    if (examine) {
      this._active      = true;
      this._dlg.visible = true;
      this._dlg.show(examine.text, examine.speaker);
      this._dlg.once('next', () => this._close());
      return true;
    }

    // ── 路徑二：config.json 動態描述（collides=true + desc）─────────────────
    // _tileConfig 由建構式非同步載入；尚未就緒時靜默跳過（不阻塞玩家操作）
    const tileDef = this._tileConfig?.[String(tileId)];
    if (tileDef?.collides === true && tileDef.desc) {
      const text = `* 檢查此處的環境…\n發現【${tileDef.desc}】。`;
      this._active      = true;
      this._dlg.visible = true;
      this._dlg.show(text, '（環境）');
      this._dlg.once('next', () => this._close());
      return true;
    }

    return false;
  }

  _close() {
    this._active      = false;
    this._dlg.visible = false;
  }
}
