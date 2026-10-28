export interface JudgeAskResult {
  answer: "是" | "否" | "无关" | "部分相关" | "驳回";
  reason?: string;
}

export interface JudgeScore {
  overall: number;
  rank: string;
  key_plot: number;
  logic: number;
  detail: number;
  comment: string;
}

export interface Judge {
  readonly kind: "mock" | "remote";
  ask(question: string): JudgeAskResult;
  submit(answer: string): JudgeScore;
}

/**
 * Replacement boundary for a future remote judge. A later branch may construct
 * another Judge from JUDGE_API_URL, JUDGE_API_KEY and JUDGE_MODEL. This MVP
 * intentionally does not read, declare or send any of those runtime secrets.
 */
export const mockJudge: Judge = {
  kind: "mock",
  ask(question) {
    if (question.includes("无法判断")) {
      return {
        answer: "驳回",
        reason: "Mock 规则：包含“无法判断”的问题会被驳回。",
      };
    }
    if (question.includes("外星")) return { answer: "无关" };
    if (question.includes("一部分")) return { answer: "部分相关" };
    return { answer: "是" };
  },
  submit() {
    return {
      overall: 72,
      rank: "基本还原",
      key_plot: 70,
      logic: 74,
      detail: 72,
      comment: "【Mock 固定评分】仅用于演示流程，不代表真实裁判结果。",
    };
  },
};
