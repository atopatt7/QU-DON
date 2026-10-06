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
  // ── 西郊（工地 / 營地）環境調查 ──────────────────────────────────────────
  1015: {
    speaker: '（環境）',
    text: '灌到一半的水泥地基，鋼筋像肋骨一樣從裡面戳出來。',
  },
  1039: {
    speaker: '（環境）',
    text: '疊成小山的水泥管。管子裡有人睡過的痕跡——紙箱、空酒瓶、一隻破襪子。',
  },
  1040: {
    speaker: '（環境）',
    text: '生鏽的鐵皮圍籬，上面噴著「鴻圖建設」四個字，又被人用黑漆塗掉一半。',
  },
  1041: {
    speaker: '（環境）',
    text: '防水布搭成的帳篷，用磚頭壓著四角。裡面傳出收音機的雜訊。',
  },
  1042: {
    speaker: '（環境）',
    text: '鐵桶裡燒著木板和舊報紙。這是整片西郊唯一暖和的地方。',
  },
  1050: {
    speaker: '（環境）',
    text: '工地辦公室的鐵皮牆。窗戶被報紙糊住，裡面的燈還亮著。',
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
    this._gsm        = null;   // GameStateManager（可選，啟用招募 / 旗標）
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

  /**
   * 注入 GameStateManager，啟用招募 / 旗標 / 戰鬥選擇肢處理。
   * 在 main.js 的 startGame 階段呼叫一次即可。
   */
  setGameStateManager(gsm) {
    this._gsm = gsm;
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
        const d = npc.entityData;
        return this._runScript({
          speaker:  d.name ?? npc.id,
          dialogue: d.dialogue,
          choices:  d.choices,
          onEnd:    d.onEnd,
        }, npc);
      }
    }

    // ── 3：地圖觸發點（map.triggers 中 type="examine"，依座標，可帶條件 variants）───
    const trigger = (md.triggers ?? []).find(t => t.type === 'examine' && t.gx === tx && t.gy === ty);
    if (trigger) {
      const t = this._gsm ? this._gsm.resolveVariant(trigger) : trigger;
      if (!t.hidden && t.dialogue?.length) {
        return this._runScript({ speaker: '（環境）', ...t });
      }
    }

    // ── 4：Tile 環境調查（TILE_EXAMINE 優先，config.json 描述次之）──────────────
    const idx    = ty * md.width + tx;
    const tileId = md.layers.objects?.[idx] || md.layers.ground?.[idx] || 0;
    return this._checkObjectTrigger(tileId);
  }

  /**
   * 對話框開啟期間，鍵盤確認鍵呼叫此方法。
   * 打字中 → 立即顯示全文；有選項 → 選定游標所在項；否則推進下一行或關閉。
   */
  advance() {
    if (!this._active) return;
    this._dlg.advance();
  }

  /** 對話框顯示選項時移動游標（delta = ±1）。 */
  moveChoice(delta) {
    if (!this._active) return false;
    return this._dlg.moveChoice(delta);
  }

  /**
   * 顯示一則單行訊息（系統提示 / 劇情旁白），確認鍵關閉。
   * 對話中呼叫時忽略（不打斷進行中的對話）。
   */
  showMessage(text, speaker = '（系統）') {
    if (this._active) return false;
    this._active      = true;
    this._dlg.visible = true;
    this._dlg.show(text, speaker);
    this._dlg.once('next', () => this._close());
    return true;
  }

  /** 播放一段對話腳本（序章、劇情事件用；格式同 _runScript）。對話中呼叫時忽略。 */
  play(script) {
    if (this._active) return false;
    return this._runScript(script);
  }

  /** 對話框是否正在顯示中（用於 main.js 封鎖移動輸入） */
  get isActive() { return this._active; }

  // ─── 內部 ──────────────────────────────────────────────────────────────────

  /**
   * 執行一段對話腳本（NPC 與地圖觸發點共用）。
   *
   * script 格式：
   *   speaker:  說話者名稱
   *   dialogue: ["第一行", "第二行", ...]       逐行顯示；最後一行與選項同時出現
   *   choices:  [choice, ...]                  可選；不符合條件的選項自動隱藏
   *   onEnd:    { setFlag, giveItem, takeItem } 沒有選項時，對話結束後套用
   *
   * choice 格式：
   *   text:         選項文字
   *   action:       "CLOSE"（預設）| "BATTLE" | "RECRUIT" | "SET_FLAG"（舊格式，搭配 flagId）
   *   if / ifNot / requiresItem   顯示條件（見 GameStateManager.meets）
   *   takeItem / giveItem         "itemId" | { id, qty } | [ ... ]
   *   setFlag:      "flag" | ["flag", ...]   對話結束時設定
   *   reply:        ["...", ...]             選完後說話者的回應
   */
  _runScript(script, npc = null) {
    const speaker = script.speaker ?? '（環境）';
    const lines   = script.dialogue?.length ? script.dialogue : ['……'];
    const choices = (script.choices ?? []).filter(c => this._meets(c));
    let   i = 0;

    this._active      = true;
    this._dlg.visible = true;

    const showNext = () => {
      if (i >= lines.length) {
        // 沒有選項的腳本：套用 onEnd 效果，播完獲得物品等系統訊息後關閉
        const sys = this._applyItems(script.onEnd);
        this._playQueue(sys, () => {
          this._applyFlags(script.onEnd);
          this._close();
        });
        return;
      }
      const text   = lines[i++];
      const isLast = i === lines.length;
      if (isLast && choices.length) {
        this._dlg.show(text, speaker, choices);
        this._dlg.once('choice', ({ index }) => this._handleChoice(choices[index], npc, speaker));
      } else {
        this._dlg.show(text, speaker);
        this._dlg.once('next', showNext);
      }
    };

    showNext();
    return true;
  }

  /**
   * 選擇肢結果：物品交換 → 說話者回應 → 系統訊息 → 設定旗標 → 執行動作。
   * 旗標放在最後設定，讓 NPC 位置 / 外觀變化發生在對話關閉之後。
   */
  _handleChoice(choice, npc, speaker) {
    const sys   = this._applyItems(choice);
    const queue = [
      ...(choice.reply ?? []).map(text => ({ text, speaker })),
      ...sys,
    ];

    this._playQueue(queue, () => {
      this._applyFlags(choice);

      switch (choice.action) {
        case 'RECRUIT':
          if (this._gsm && npc) {
            this._gsm.recruitNpc(npc.id, npc.entityData?.name ?? npc.id);
            this._playQueue(
              [{ text: `${npc.entityData?.name ?? npc.id} 加入了你的隊伍。`, speaker: '（系統）' }],
              () => this._close(),
            );
            return;
          }
          break;

        case 'BATTLE':
          // 關閉對話框後交給 main.js 的 'battle:trigger' 監聽器（InteractionManager 不直接持有 BattleUI）
          this._close();
          if (npc) this._gsm?.emit('battle:trigger', { npc });
          return;

        case 'SET_FLAG': // 舊格式：{ action: "SET_FLAG", flagId, flagValue }
          if (choice.flagId) this._gsm?.setFlag(choice.flagId, choice.flagValue ?? true);
          break;
      }
      this._close();
    });
  }

  /** 依序顯示 [{ text, speaker }]，全部播完後呼叫 done。 */
  _playQueue(queue, done) {
    if (!queue.length) { done(); return; }
    const [head, ...rest] = queue;
    this._dlg.show(head.text, head.speaker);
    this._dlg.once('next', () => this._playQueue(rest, done));
  }

  _meets(cond) { return this._gsm ? this._gsm.meets(cond) : true; }

  /** 套用 takeItem / giveItem，回傳要顯示的系統訊息。 */
  _applyItems(fx) {
    if (!fx || !this._gsm) return [];
    const list = v => (v == null ? [] : Array.isArray(v) ? v : [v])
      .map(e => (typeof e === 'string' ? { id: e, qty: 1 } : { qty: 1, ...e }));
    const msgs = [];
    for (const { id, qty } of list(fx.takeItem)) {
      if (this._gsm.removeItem(id, qty)) {
        msgs.push({ text: `交出【${this._gsm.itemName(id)}】×${qty}`, speaker: '（系統）' });
      }
    }
    for (const { id, qty } of list(fx.giveItem)) {
      this._gsm.addItem(id, qty);
      msgs.push({ text: `獲得【${this._gsm.itemName(id)}】×${qty}`, speaker: '（系統）' });
    }
    return msgs;
  }

  _applyFlags(fx) {
    if (!fx?.setFlag || !this._gsm) return;
    for (const f of [].concat(fx.setFlag)) this._gsm.setFlag(f);
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
    if (examine) return this.showMessage(examine.text, examine.speaker);

    // ── 路徑二：config.json 動態描述（collides=true + desc）─────────────────
    // _tileConfig 由建構式非同步載入；尚未就緒時靜默跳過（不阻塞玩家操作）
    const tileDef = this._tileConfig?.[String(tileId)];
    if (tileDef?.collides === true && tileDef.desc) {
      return this.showMessage(`* 檢查此處的環境…\n發現【${tileDef.desc}】。`, '（環境）');
    }

    return false;
  }

  _close() {
    this._active      = false;
    this._dlg.visible = false;
  }
}
