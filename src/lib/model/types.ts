/**
 * 模型接口。实施计划 §8.3。
 *
 * 唯一需要在 Mock 和真模型之间保持一致的地方——换供应商只改实现，
 * 管线代码一行不动。
 */

export type SubGoal = {
  title: string;
  why: string;
  /** 怎么算「补上了」。没有这个，子目标就是一句空话。 */
  doneCriteria: string;
  /** 相对顺序，前置的排前面 */
  sortOrder: number;
  /** 挂在哪个父节点下（用 title 引用，落库时再解析成 id） */
  parentTitle?: string;
  children?: SubGoal[];
};

export type GoalContext = {
  id: string;
  title: string;
  why: string | null;
  currentLevel: string | null;
  expectedOutput: string | null;
  avoid: string | null;
  nodes: Array<{ id: number; title: string; doneCriteria: string | null; status: string }>;
};

export type CandidateItem = {
  id: number;
  title: string;
  sourceName: string;
  sourceWeight: number;
  /** 该源对各目标的权重 */
  goalWeights: Record<string, number>;
  publishedAt: number | null;
  summary: string | null;
  lang: string | null;
  url: string;
};

/** 初筛：只判断值不值得进最终候选集，输入尽量薄（§6.1） */
export type PrefilterVerdict = {
  itemId: number;
  /** null 表示和所有目标都不相关 */
  goalId: string | null;
  relevance: number;
  keep: boolean;
  reason: string;
};

/** 脚手架。readingPolicy 的落点：难度不降，支撑要给。 */
export type Scaffold = {
  /** 读之前需要先懂什么 */
  prereq: string[];
  /** 带着哪些问题读 */
  questions: string[];
  /** 读完怎么自检 */
  selfCheck: string[];
};

/** 重排：候选之间比较，产出可解释的推荐 */
export type RerankPick = {
  itemId: number;
  goalId: string;
  nodeId: number | null;
  score: number;
  /* 分项——界面上「这个分数怎么来的」要能展开 */
  relevance: number;
  sourceWeight: number;
  gapFit: number;
  novelty: number;
  readingCost: number;
  /* 输出 */
  reason: string;
  confidence: "low" | "medium" | "high";
  readingAdvice: string;
  caveat: string | null;
  scaffold: Scaffold;
};

export type RunMeta = {
  modelRunId: number | null;
};

export interface ModelProvider {
  readonly name: string;
  /** 大目标拆子目标。拆到几层由实现决定。 */
  decomposeGoal(goal: GoalContext): Promise<{ subGoals: SubGoal[] } & RunMeta>;
  /** 初筛 */
  prefilter(
    goals: GoalContext[],
    items: CandidateItem[],
  ): Promise<{ verdicts: PrefilterVerdict[] } & RunMeta>;
  /** 重排。slotsPerGoal 表示每个目标要几条。 */
  rerank(
    goals: GoalContext[],
    items: CandidateItem[],
    opts: { slotsPerGoal: number },
  ): Promise<{ picks: RerankPick[] } & RunMeta>;
}
