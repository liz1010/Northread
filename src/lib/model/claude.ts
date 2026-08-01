import Anthropic from "@anthropic-ai/sdk";
import { readFileSync } from "node:fs";

import { db, schema } from "../../db/index.ts";
import type {
  CandidateItem,
  GoalContext,
  ModelProvider,
  PrefilterVerdict,
  RerankPick,
  SubGoal,
} from "./types.ts";

const { modelRuns } = schema;

const PROMPT_VERSION = "v1";

/** 认知标尺。目标 cognition 的评分要过这八条。 */
let rubricCache: string | null = null;
function rubric(): string {
  if (rubricCache === null) {
    try {
      rubricCache = readFileSync(
        new URL("../../../seed/reference/cognition-rubric.md", import.meta.url),
        "utf8",
      );
    } catch {
      rubricCache = "";
    }
  }
  return rubricCache;
}

/**
 * 阅读策略。这段会进每个 prompt——它是这个产品和普通 RSS 阅读器的区别。
 */
const READING_POLICY = `
工具的目的是帮用户克服惰性，不是迁就惰性。评分和写推荐理由时遵守：

1. 不因为一篇材料难就降权。难本身不是减分项。
2. 推硬材料时必须给脚手架：需要哪些前置、带着什么问题读、读完怎么自检。
3. 有依赖关系的材料，前置的排前面，并在理由里说明它是为后面哪一篇做准备。
4. 推荐理由必须指向具体的目标、子目标或已读内容，不能是通用套话。
   反例：「这篇文章很有价值」。正例：「它补上你在 X 上的缺口，是理解后面 Y 的前置」。
`.trim();

type ClaudeOpts = {
  apiKey?: string;
  prefilterModel?: string;
  rerankModel?: string;
  prefilterEffort?: string;
  rerankEffort?: string;
};

export class ClaudeProvider implements ModelProvider {
  readonly name = "claude";
  private client: Anthropic;
  private opts: Required<Omit<ClaudeOpts, "apiKey">>;

  constructor(o: ClaudeOpts = {}) {
    this.client = new Anthropic({ apiKey: o.apiKey ?? process.env.ANTHROPIC_API_KEY });
    this.opts = {
      prefilterModel: o.prefilterModel ?? process.env.NORTHREAD_PREFILTER_MODEL ?? "claude-opus-5",
      rerankModel: o.rerankModel ?? process.env.NORTHREAD_RERANK_MODEL ?? "claude-opus-5",
      prefilterEffort: o.prefilterEffort ?? process.env.NORTHREAD_PREFILTER_EFFORT ?? "low",
      rerankEffort: o.rerankEffort ?? process.env.NORTHREAD_RERANK_EFFORT ?? "high",
    };
  }

  /**
   * 统一的调用入口：结构化输出 + 拒绝处理 + model_runs 记录。
   *
   * 带上 fallbacks:"default"——Claude Opus 5 的安全分类器可能拒绝请求
   * （HTTP 200 但 stop_reason=refusal）。开启后 API 会自动换模型重跑，
   * 而不是把一个空结果丢回来。
   */
  private async call<T>(args: {
    purpose: "decompose" | "prefilter" | "rerank";
    model: string;
    effort: string;
    system: string;
    user: string;
    schema: Record<string, unknown>;
    itemIds?: number[];
  }): Promise<{ data: T; modelRunId: number | null }> {
    const t0 = Date.now();
    let stopReason: string | null = null;
    let refusalCategory: string | null = null;
    let errorMsg: string | null = null;
    let usage: Anthropic.Usage | null = null;
    let data: T | null = null;

    try {
      const res = await this.client.beta.messages.create({
        model: args.model,
        max_tokens: 16000,
        betas: ["server-side-fallback-2026-07-01"],
        fallbacks: "default",
        output_config: {
          effort: args.effort as "low" | "medium" | "high" | "xhigh" | "max",
          format: { type: "json_schema", schema: args.schema },
        },
        system: [
          { type: "text", text: args.system, cache_control: { type: "ephemeral" } },
        ],
        messages: [{ role: "user", content: args.user }],
      });

      stopReason = res.stop_reason;
      usage = res.usage as Anthropic.Usage;

      if (res.stop_reason === "refusal") {
        refusalCategory = res.stop_details?.category ?? null;
        throw new Error(`模型拒绝了这次请求（category=${refusalCategory ?? "未知"}）`);
      }

      const text = res.content.find((b) => b.type === "text");
      if (!text || text.type !== "text") throw new Error("响应里没有文本块");
      data = JSON.parse(text.text) as T;
    } catch (e) {
      errorMsg = e instanceof Error ? e.message : String(e);
    }

    const [run] = await db
      .insert(modelRuns)
      .values({
        model: args.model,
        purpose: args.purpose,
        promptVersion: PROMPT_VERSION,
        inputItemIds: args.itemIds ?? null,
        outputJson: data as never,
        latencyMs: Date.now() - t0,
        inputTokens: usage?.input_tokens ?? null,
        outputTokens: usage?.output_tokens ?? null,
        cacheReadTokens: usage?.cache_read_input_tokens ?? null,
        stopReason,
        refusalCategory,
        error: errorMsg,
      })
      .returning({ id: modelRuns.id });

    if (errorMsg || data === null) throw new Error(errorMsg ?? "模型没有返回可用结果");
    return { data, modelRunId: run.id };
  }

  async decomposeGoal(goal: GoalContext) {
    const system = `你是一个阅读教练，负责把用户的大目标拆成可执行的子目标。

${READING_POLICY}

拆解要求：
- 深度由你决定。太浅（只有 2-3 条泛泛的方向）和太深（几十个琐碎条目）都不好。
- 每个子目标必须有「怎么算补上了」的判据，可以被检验。
- 有依赖关系的排前面，用 sortOrder 表示。
- 严格按用户自述的当前水平来拆。不要拆出他早就掌握的东西。
${goal.id === "cognition" ? `\n这个目标的评分标尺如下，拆子目标时要对齐：\n${rubric()}` : ""}`;

    const user = `目标：${goal.title}
为什么要做：${goal.why ?? "（未填）"}
当前水平：${goal.currentLevel ?? "（未填）"}
期望产出：${goal.expectedOutput ?? "（未填）"}
明确不想看到：${goal.avoid ?? "（无）"}`;

    const { data, modelRunId } = await this.call<{ subGoals: SubGoal[] }>({
      purpose: "decompose",
      model: this.opts.rerankModel,
      effort: this.opts.rerankEffort,
      system,
      user,
      schema: {
        type: "object",
        properties: {
          subGoals: {
            type: "array",
            items: {
              type: "object",
              properties: {
                title: { type: "string" },
                why: { type: "string" },
                doneCriteria: { type: "string" },
                sortOrder: { type: "integer" },
                parentTitle: { type: "string" },
              },
              required: ["title", "why", "doneCriteria", "sortOrder"],
              additionalProperties: false,
            },
          },
        },
        required: ["subGoals"],
        additionalProperties: false,
      },
    });
    return { subGoals: data.subGoals, modelRunId };
  }

  async prefilter(goals: GoalContext[], items: CandidateItem[]) {
    const system = `你在做阅读候选的初筛。输入只有标题、来源和摘要，信息有限——
你的任务不是给出最终判断，而是决定「值不值得进入最终候选集」。

判断依据：
- 是否与任一目标相关（相关就保留，哪怕只是可能相关）
- 是否明显是通稿、发布公告、营销内容
- 是否明显低信息量

宁可放过，不要错杀：这一步的代价是多花一点重排的钱，
而错杀的代价是用户永远看不到那条内容。`;

    const goalBlock = goals
      .map((g) => `- ${g.id}：${g.title}\n  当前水平：${g.currentLevel ?? "未填"}\n  不想看到：${g.avoid ?? "无"}`)
      .join("\n");

    const itemBlock = items
      .map(
        (i) =>
          `[${i.id}] ${i.title}\n  来源：${i.sourceName}\n  摘要：${(i.summary ?? "（无摘要）").slice(0, 500)}`,
      )
      .join("\n\n");

    const { data, modelRunId } = await this.call<{ verdicts: PrefilterVerdict[] }>({
      purpose: "prefilter",
      model: this.opts.prefilterModel,
      effort: this.opts.prefilterEffort,
      system,
      user: `目标：\n${goalBlock}\n\n候选内容：\n${itemBlock}`,
      itemIds: items.map((i) => i.id),
      schema: {
        type: "object",
        properties: {
          verdicts: {
            type: "array",
            items: {
              type: "object",
              properties: {
                itemId: { type: "integer" },
                goalId: { type: ["string", "null"] },
                relevance: { type: "number" },
                keep: { type: "boolean" },
                reason: { type: "string" },
              },
              required: ["itemId", "goalId", "relevance", "keep", "reason"],
              additionalProperties: false,
            },
          },
        },
        required: ["verdicts"],
        additionalProperties: false,
      },
    });
    return { verdicts: data.verdicts, modelRunId };
  }

  async rerank(goals: GoalContext[], items: CandidateItem[], opts: { slotsPerGoal: number }) {
    const system = `你在为用户挑选今天该读什么。这是最终决定，要在候选之间做相对比较，
而不是分别给孤立的分数。核心问题是：

「如果这个目标今天只能读一条，哪一条最能推动它？它相对于其他候选新增了什么？」

${READING_POLICY}

每个目标选 ${opts.slotsPerGoal} 条。同一个来源每天最多出一条。

必须输出的字段里，scaffold 最重要——它是用户能不能真的读下去的关键：
- prereq：读之前需要先懂什么（没有就给空数组，不要硬编）
- questions：带着哪些问题读
- selfCheck：读完怎么检验自己真的懂了

caveat 要诚实写出这篇材料的不足，比如「只讲了结论没给数据」。没有就填 null。

${goals.some((g) => g.id === "cognition") ? `认知目标的评分标尺：\n${rubric()}` : ""}`;

    const goalBlock = goals
      .map(
        (g) =>
          `- ${g.id}：${g.title}\n  当前水平：${g.currentLevel ?? "未填"}\n  期望产出：${g.expectedOutput ?? "未填"}\n  子目标：${g.nodes.map((n) => `${n.title}（${n.status}）`).join("；") || "尚未拆解"}`,
      )
      .join("\n");

    const itemBlock = items
      .map(
        (i) =>
          `[${i.id}] ${i.title}\n  来源：${i.sourceName}（权重 ${i.sourceWeight}）\n  摘要：${(i.summary ?? "（无摘要）").slice(0, 1200)}`,
      )
      .join("\n\n");

    const { data, modelRunId } = await this.call<{ picks: RerankPick[] }>({
      purpose: "rerank",
      model: this.opts.rerankModel,
      effort: this.opts.rerankEffort,
      system,
      user: `目标：\n${goalBlock}\n\n候选内容：\n${itemBlock}`,
      itemIds: items.map((i) => i.id),
      schema: {
        type: "object",
        properties: {
          picks: {
            type: "array",
            items: {
              type: "object",
              properties: {
                itemId: { type: "integer" },
                goalId: { type: "string" },
                nodeId: { type: ["integer", "null"] },
                score: { type: "number" },
                relevance: { type: "number" },
                sourceWeight: { type: "number" },
                gapFit: { type: "number" },
                novelty: { type: "number" },
                readingCost: { type: "number" },
                reason: { type: "string" },
                confidence: { type: "string", enum: ["low", "medium", "high"] },
                readingAdvice: { type: "string" },
                caveat: { type: ["string", "null"] },
                scaffold: {
                  type: "object",
                  properties: {
                    prereq: { type: "array", items: { type: "string" } },
                    questions: { type: "array", items: { type: "string" } },
                    selfCheck: { type: "array", items: { type: "string" } },
                  },
                  required: ["prereq", "questions", "selfCheck"],
                  additionalProperties: false,
                },
              },
              required: [
                "itemId", "goalId", "nodeId", "score", "relevance", "sourceWeight",
                "gapFit", "novelty", "readingCost", "reason", "confidence",
                "readingAdvice", "caveat", "scaffold",
              ],
              additionalProperties: false,
            },
          },
        },
        required: ["picks"],
        additionalProperties: false,
      },
    });
    return { picks: data.picks, modelRunId };
  }
}
