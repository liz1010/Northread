import type {
  CandidateItem,
  GoalContext,
  ModelProvider,
  PrefilterVerdict,
  RerankPick,
  SubGoal,
} from "./types.ts";

/**
 * 不调模型的实现。用规则打分：关键词命中 + 信源权重 + 时效性。
 *
 * 存在的意义有两个：
 *   1. 没有 API key 时也能把整条链路和界面跑通
 *   2. 真模型出问题时，用它对比一下就知道问题出在模型层还是管线层
 *
 * 推荐质量必然一般——它不理解内容，只是在匹配字符串。
 */

/** 每个目标的关键词表。真模型不需要这个，是 Mock 的拐杖。 */
const KEYWORDS: Record<string, string[]> = {
  "semiconductor-research": [
    "semiconductor", "chip", "fab", "foundry", "tsmc", "nvidia", "amd", "intel",
    "asml", "wafer", "node", "lithography", "hbm", "memory", "capex", "supply chain",
    "earnings", "revenue", "margin", "valuation", "cycle", "demand", "packaging",
    "半导体", "芯片", "晶圆", "制程", "产能", "财报", "估值", "周期", "供应链",
  ],
  cognition: [
    "complexity", "emergence", "reductionism", "epistemic", "philosophy", "science",
    "reasoning", "bias", "model", "framework", "first principles", "falsifiable",
    "physics", "causal", "abduction", "paradigm", "mental model",
    "复杂系统", "涌现", "还原论", "第一性原理", "认知", "思维", "哲学", "证伪",
  ],
  "llm-craft": [
    "llm", "transformer", "attention", "rlhf", "fine-tun", "inference", "agent",
    "prompt", "context window", "eval", "benchmark", "tokenizer", "post-train",
    "reasoning model", "tool use", "embedding", "distillation",
    "大模型", "推理", "微调", "智能体", "上下文",
  ],
};

const HYPE = [
  "announcing", "introducing", "we're excited", "partnership", "webinar",
  "register now", "sponsored", "重磅", "震惊", "速看",
];

function scoreAgainstGoal(item: CandidateItem, goalId: string): number {
  const hay = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  const words = KEYWORDS[goalId] ?? [];
  const hits = words.filter((w) => hay.includes(w)).length;
  // 命中数开方，避免长文因为词多而占便宜
  return Math.min(1, Math.sqrt(hits) / 3);
}

function recency(publishedAt: number | null): number {
  if (!publishedAt) return 0.4;
  const days = (Date.now() / 1000 - publishedAt) / 86400;
  if (days < 3) return 1;
  if (days < 14) return 0.8;
  if (days < 60) return 0.5;
  return 0.25;
}

function hypePenalty(item: CandidateItem): number {
  const hay = `${item.title} ${item.summary ?? ""}`.toLowerCase();
  return HYPE.some((w) => hay.includes(w)) ? 0.3 : 0;
}

export class MockProvider implements ModelProvider {
  readonly name = "mock";

  async decomposeGoal(goal: GoalContext) {
    // Mock 拆不出有意义的子目标——它不理解目标在说什么。
    // 这里返回一个占位结构，落库时会标成 createdBy='user' 而不是 'ai'，
    // 界面上也会明确显示「等接上真模型后重拆」。
    const subGoals: SubGoal[] = [
      {
        title: `${goal.title} —— 建立基础框架`,
        why: "占位子目标。Mock 模式不做真实拆解。",
        doneCriteria: "接上真模型后由 AI 重新拆解。",
        sortOrder: 0,
      },
      {
        title: `${goal.title} —— 形成独立判断`,
        why: "占位子目标。Mock 模式不做真实拆解。",
        doneCriteria: "接上真模型后由 AI 重新拆解。",
        sortOrder: 1,
      },
    ];
    return { subGoals, modelRunId: null };
  }

  async prefilter(goals: GoalContext[], items: CandidateItem[]) {
    const verdicts: PrefilterVerdict[] = items.map((item) => {
      let best = { goalId: null as string | null, rel: 0 };
      for (const g of goals) {
        const kw = scoreAgainstGoal(item, g.id);
        const gw = item.goalWeights[g.id] ?? 0;
        // 源权重为 0 表示这个源不服务该目标，直接跳过
        const rel = gw > 0 ? kw * 0.7 + Math.min(1, gw / 2) * 0.3 : kw * 0.5;
        if (rel > best.rel) best = { goalId: g.id, rel };
      }
      const rel = Math.max(0, best.rel - hypePenalty(item));
      const keep = rel >= 0.25;
      return {
        itemId: item.id,
        goalId: keep ? best.goalId : null,
        relevance: Number(rel.toFixed(3)),
        keep,
        reason: keep
          ? `关键词命中 ${best.goalId}，信源权重 ${(item.goalWeights[best.goalId!] ?? 0).toFixed(1)}`
          : "关键词命中不足",
      };
    });
    return { verdicts, modelRunId: null };
  }

  async rerank(goals: GoalContext[], items: CandidateItem[], opts: { slotsPerGoal: number }) {
    const picks: RerankPick[] = [];

    for (const goal of goals) {
      const scored = items
        .map((item) => {
          const relevance = scoreAgainstGoal(item, goal.id);
          const sourceWeight = item.goalWeights[goal.id] ?? item.sourceWeight;
          const novelty = recency(item.publishedAt);
          // Mock 判断不了缺口匹配和阅读成本，给中性值而不是编一个
          const gapFit = 0.5;
          const readingCost = 0.5;
          const score =
            relevance * 0.45 + Math.min(1, sourceWeight / 2) * 0.3 + novelty * 0.25;
          return { item, relevance, sourceWeight, novelty, gapFit, readingCost, score };
        })
        .filter((s) => s.relevance > 0)
        .sort((a, b) => b.score - a.score);

      // 单源垄断抑制：同一个源每天最多进一条
      const usedSources = new Set<string>();
      let taken = 0;
      for (const s of scored) {
        if (taken >= opts.slotsPerGoal) break;
        if (usedSources.has(s.item.sourceName)) continue;
        usedSources.add(s.item.sourceName);
        taken++;

        picks.push({
          itemId: s.item.id,
          goalId: goal.id,
          nodeId: null,
          score: Number((s.score * 100).toFixed(1)),
          relevance: Number(s.relevance.toFixed(3)),
          sourceWeight: s.sourceWeight,
          gapFit: s.gapFit,
          novelty: Number(s.novelty.toFixed(3)),
          readingCost: s.readingCost,
          reason: `【规则打分，非模型判断】来自 ${s.item.sourceName}，关键词与「${goal.title}」匹配度 ${(s.relevance * 100).toFixed(0)}%。`,
          confidence: "low",
          readingAdvice: "完整阅读",
          caveat: "Mock 模式：这条推荐由关键词匹配产生，没有真正理解内容。",
          scaffold: {
            prereq: [],
            questions: ["（Mock 模式不生成引导问题，接上真模型后会有）"],
            selfCheck: [],
          },
        });
      }
    }
    return { picks, modelRunId: null };
  }
}
