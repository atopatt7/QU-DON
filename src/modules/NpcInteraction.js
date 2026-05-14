// NpcInteraction.js
// 負責處理玩家與 NPC 的互動邏輯、招募條件檢查

export class NpcInteraction {
  constructor(gameStateManager, dialogueOverlay) {
    this.gsm = gameStateManager;
    this.dialogue = dialogueOverlay;
  }

  // 玩家與 NPC 互動的主入口；依 category 分流處理
  interact(npc) {
    if (!npc) return;

    const category = npc.category ?? 'system';

    switch (category) {
      case 'system':
        // 觸發商店或一般對話介面
        // TODO: 根據 npc.serviceType 分別開啟 ShopUI / DialogueOverlay
        this.dialogue.show(this._resolveDialogue(npc));
        this.gsm.setNpcFlag(`met_${npc.id}`);
        break;

      case 'recruitable':
        // 帶選項的招募 / 劇情對話
        // TODO: 傳入選項陣列讓 DialogueOverlay 顯示「加入」/「拒絕」按鈕
        this.dialogue.show(this._resolveDialogue(npc));
        this.gsm.setNpcFlag(`met_${npc.id}`);
        break;

      case 'hostile':
        // 敵對型不接受對話，直接轉為戰鬥狀態
        // TODO: 通知 CombatManager 以此 npc 為目標觸發戰鬥
        console.log(`[NpcInteraction] ${npc.name} 是敵對 NPC，拒絕對話，觸發戰鬥。`);
        break;

      default:
        console.warn(`[NpcInteraction] 未知 category：${category}`);
    }
  }

  // 根據目前狀態決定顯示哪組對話
  _resolveDialogue(npc) {
    if (this.gsm.isRecruited(npc.id)) {
      return npc.dialogue.recruited ?? npc.dialogue.default;
    }
    if (npc.category === 'recruitable' && this.checkRecruitCondition(npc)) {
      return npc.dialogue.recruitable ?? npc.dialogue.default;
    }
    return npc.dialogue.default;
  }

  // 檢查招募條件是否滿足
  checkRecruitCondition(npc) {
    if (npc.category !== 'recruitable' || !npc.recruitCondition) return false;

    const cond = npc.recruitCondition;

    switch (cond.type) {
      case 'flagSet':
        return this.gsm.getNpcFlag(cond.flagId);

      case 'itemOwned':
        return this.gsm.state?.items?.includes(cond.itemId) ?? false;

      case 'questCompleted':
        return this.gsm.getNpcFlag(`quest_${cond.questId}_completed`);

      default:
        console.warn(`[NpcInteraction] 未知的招募條件類型：${cond.type}`);
        return false;
    }
  }

  // 執行招募
  recruit(npc) {
    if (npc.category !== 'recruitable') return false;
    if (this.gsm.isRecruited(npc.id)) return false;
    if (!this.checkRecruitCondition(npc)) return false;

    this.gsm.recruitNpc(npc.id);
    console.log(`[NpcInteraction] 成功招募：${npc.name}`);
    return true;
  }
}
