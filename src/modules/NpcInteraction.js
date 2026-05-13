// NpcInteraction.js
// 負責處理玩家與 NPC 的互動邏輯、招募條件檢查

export class NpcInteraction {
  constructor(gameStateManager, dialogueOverlay) {
    this.gsm = gameStateManager;
    this.dialogue = dialogueOverlay;
  }

  // 玩家與 NPC 互動的主入口
  interact(npc) {
    if (!npc) return;

    const lines = this._resolveDialogue(npc);
    this.dialogue.show(lines);

    // 互動後自動設定 met 旗標
    this.gsm.setNpcFlag(`met_${npc.id}`);
  }

  // 根據目前狀態決定顯示哪組對話
  _resolveDialogue(npc) {
    if (this.gsm.isRecruited(npc.id)) {
      return npc.dialogue.recruited ?? npc.dialogue.default;
    }
    if (npc.recruitable && this.checkRecruitCondition(npc)) {
      return npc.dialogue.recruitable ?? npc.dialogue.default;
    }
    return npc.dialogue.default;
  }

  // 檢查招募條件是否滿足
  checkRecruitCondition(npc) {
    if (!npc.recruitable || !npc.recruitCondition) return false;

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
    if (!npc.recruitable) return false;
    if (this.gsm.isRecruited(npc.id)) return false;
    if (!this.checkRecruitCondition(npc)) return false;

    this.gsm.recruitNpc(npc.id);
    console.log(`[NpcInteraction] 成功招募：${npc.name}`);
    return true;
  }
}
