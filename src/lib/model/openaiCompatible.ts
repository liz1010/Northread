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
const PROMPT_VERSION = "v1-openai";

/**
 * OpenAI 兼容接口的实现。一套代码接四种后端：
 *   DeepSeek     https://api.deepseek.com          deepseek-chat / deepseek-reasoner
 *   阿里云百炼    https://dashscope.aliyuncs.com/compatible-mode/v1
 *   Ollama       http://127.0.0.1:11434/v1
 *   vLLM         http://127.0.0.1:8000/v1
 *
 * 和 Claude 那个实现的关键差异：
 * 这些服务只支持 response_format:{type:"json_object"}，**不支持 json_schema**。
 * 所以结构约束只能写进 prompt，返回后必须自己校验——不能假设字段一定在。
 */

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

const READING_POLICY = `
工具的目的是帮用户克服惰性，不是迁就惰性。评分和写推荐理由时遵守：

1. 不因为一篇材料难就降权。难本身不是减分项。
2. 推硬材料时必须给脚手架：需要哪些前置、带着什么问题读、读完怎么自检。
3. 有依赖关系的材料，前置的排前面，并在理由里说明它是为后面哪一篇做准备。
4. 推荐理由必须指向具体的目标、子目标或已读内容，不能是通用套话。
   反例：「这篇文章很有价值」。正例：「它补上你在 X 上的缺口，是理解后面 Y 的前置」。
`.trim();

type Opts = {
  baseUrl?: string;
  apiKey?: string;
  prefilterModel?: string;
  rerankModel?: string;
};

export class OpenAICompatibleProvider implements ModelProvider {
  readonly name: string;
  private baseUrl: string;
  private apiKey: string;
  private prefilterModel: string;
  private rerankModel: string;

  constructor(o: Opts = {}) {
    this.baseUrl = (o.baseUrl ?? process.env.NORTHREAD_API_BASE ?? "https://api.deepseek.com")
      .replace(/\/+$/, "");
    this.apiKey = o.apiKey ?? process.env.NORTHREAD_API_KEY ?? "";
    this.prefilterModel =
      o.prefilterModel ?? process.env.NORTHREAD_PREFILTER_MODEL ?? "deepseek-chat";
    this.rerankModel = o.rerankModel ?? process.env.NORTHREAD_RERANK_MODEL ?? "deepseek-chat";
    this.name = `openai-compat(${new URL(this.baseUrl).host})`;
  }

  /** 统一调用：JSON 模式 + 结果校验 + model_runs 记录 */
  private async call<T>(args: {
    purpose: "decompose" | "prefilter" | "rerank";
    model: string;
    system: string;
    user: string;
    /** 返回后自己校验——json_object 模式不保证结构 */
    validate: (raw: unknown) => T;
    itemIds?: number[];
  }): Promise<{ data: T; modelRunId: number | null }> {
    const t0 = Date.now();
    let errorMsg: string | null = null;
    let finishReason: string | null = null;
    let usage: { prompt_tokens?: number; completion_tokens?: number } | null = null;
    let data: T | null = null;

    try {
      const res = await fetch(`${this.baseUrl}/chat/completions`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${this.apiKey}`,
        },
        body: JSON.stringify({
          model: args.model,
          messages: [
            { role: "system", content: args.system },
            { role: "user", content: args.user },
          ],
          // DeepSeek 的 JSON 模式要求 prompt 里出现 "json" 字样，
          // system 提示词里已经写了输出 JSON 的要求。
          response_format: { type: "json_object" },
          max_tokens: 8000,
          stream: false,
        }),
      });

      if (!res.ok) {
        const body = await res.text().catch(() => "");
        throw new Error(`HTTP ${res.status}: ${body.slice(0, 300)}`);
      }

      const json = (await res.json()) as {
        choices?: Array<{ message?: { content?: string }; finish_reason?: string }>;
        usage?: { prompt_tokens?: number; completion_tokens?: number };
      };
      usage = json.usage ?? null;
      finishReason = json.choices?.[0]?.finish_reason ?? null;

      const text = json.choices?.[0]?.message?.content;
      if (!text) throw new Error("响应里没有内容");
      if (finishReason === "length") {
        throw new Error("输出被 max_tokens 截断，JSON 不完整——减少每批条数或调大 max_tokens");
      }

      let parsed: unknown;
      try {
        parsed = JSON.parse(text);
      } catch {
        // 有些模型会在 JSON 外面套 ```json 代码块
        const m = text.match(/\{[\s\S]*\}/);
        if (!m) throw new Error(`返回的不是 JSON：${text.slice(0, 200)}`);
        parsed = JSON.parse(m[0]);
      }
      data = args.validate(parsed);
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
        inputTokens: usage?.prompt_tokens ?? null,
        outputTokens: usage?.completion_tokens ?? null,
        stopReason: finishReason,
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
- 严格按用户自述的当前水平来拆，不要拆出他早就掌握的东西。
${goal.id === "cognition" ? `\n这个目标的评分标尺如下，拆子目标时要对齐：\n${rubric()}` : ""}

只输出 json，格式如下，不要有任何其他文字：
{"subGoals":[{"title":"子目标标题","why":"为什么需要它","doneCriteria":"怎么算补上了","sortOrder":0}]}`;

    const user = `目标：${goal.title}
为什么要做：${goal.why ?? "（未填）"}
当前水平：${goal.currentLevel ?? "（未填）"}
期望产出：${goal.expectedOutput ?? "（未填）"}
明确不想看到：${goal.avoid ?? "（无）"}`;

    return this.call<{ subGoals: SubGoal[] }>({
      purpose: "decompose",
      model: this.rerankModel,
      system,
      user,
      validate: (raw) => {
        const o = raw as { subGoals?: unknown };
        if (!Array.isArray(o.subGoals)) throw new Error("返回里没有 subGoals 数组");
        const subGoals = o.subGoals
          .filter((s): s is Record<string, unknown> => !!s && typeof s === "object")
          .map((s, i) => ({
            title: String(s.title ?? "").trim(),
            why: String(s.why ?? ""),
            doneCriteria: String(s.doneCriteria ?? ""),
            sortOrder: Number(s.sortOrder ?? i),
          }))
          .filter((s) => s.title);
        if (!subGoals.length) throw new Error("拆解结果为空");
        return { subGoals };
      },
    }).then((r) => ({ subGoals: r.data.subGoals, modelRunId: r.modelRunId }));
  }

  async prefilter(goals: GoalContext[], items: CandidateItem[]) {
    const system = `你在做阅读候选的初筛。输入只有标题、来源和摘要，信息有限——
你的任务不是给出最终判断，而是决定「值不值得进入最终候选集」。

判断依据：是否与任一目标相关；是否明显是通稿、发布公告、营销内容；是否明显低信息量。

宁可放过，不要错杀：这一步的代价是多花一点重排的钱，
而错杀的代价是用户永远看不到那条内容。

只输出 json，每个候选一条，不要遗漏也不要编造 id：
{"verdicts":[{"itemId":123,"goalId":"目标id或null","relevance":0.75,"keep":true,"reason":"一句话理由"}]}`;

    const goalBlock = goals
      .map(
        (g) =>
          `- ${g.id}：${g.title}\n  当前水平：${g.currentLevel ?? "未填"}\n  不想看到：${g.avoid ?? "无"}`,
      )
      .join("\n");

    // 一次塞 120 条容易让模型「偷懒」返回空数组（实测发生过：output_tokens=7）。
    // 分批 + 空结果重试 + 保守兜底，保证初筛永远有输出。
    const BATCH = 50;
    const verdicts: PrefilterVerdict[] = [];
    let modelRunId: number | null = null;

    for (let i = 0; i < items.length; i += BATCH) {
      const batch = items.slice(i, i + BATCH);
      const itemBlock = batch
        .map(
          (it) =>
            `[${it.id}] ${it.title}\n  来源：${it.sourceName}\n  摘要：${(it.summary ?? "（无摘要）").slice(0, 400)}`,
        )
        .join("\n\n");

      let batchVerdicts: PrefilterVerdict[] = [];
      // 模型偶尔会返回空数组或全部 id 不匹配——重试 3 次
      for (let attempt = 0; attempt < 3 && !batchVerdicts.length; attempt++) {
        const res = await this.call<{ verdicts: PrefilterVerdict[] }>({
          purpose: "prefilter",
          model: this.prefilterModel,
          system,
          user: `目标：\n${goalBlock}\n\n候选内容（第 ${i / BATCH + 1} 批）：\n${itemBlock}`,
          itemIds: batch.map((it) => it.id),
          validate: (raw) => {
            const o = raw as { verdicts?: unknown };
            if (!Array.isArray(o.verdicts)) throw new Error("返回里没有 verdicts 数组");
            const known = new Set(batch.map((it) => it.id));
            const goalIds = new Set(goals.map((g) => g.id));
            const vs = o.verdicts
              .filter((v): v is Record<string, unknown> => !!v && typeof v === "object")
              .map((v) => ({
                itemId: Number(v.itemId),
                goalId: goalIds.has(String(v.goalId)) ? String(v.goalId) : null,
                relevance: Number(v.relevance ?? 0),
                keep: Boolean(v.keep),
                reason: String(v.reason ?? ""),
              }))
              // 模型偶尔会编造不存在的 id，丢掉
              .filter((v) => known.has(v.itemId));
            return { verdicts: vs };
          },
        });
        modelRunId = res.modelRunId ?? modelRunId;
        batchVerdicts = res.data.verdicts;
      }
      if (!batchVerdicts.length) {
        // 重试仍空——保守兜底：全部保留，让重排阶段做精细判断。
        // 初筛的原则本来就是「宁可放过，不要错杀」。
        batchVerdicts = batch.map((it) => ({
          itemId: it.id,
          goalId: null,
          relevance: 0.3,
          keep: true,
          reason: "初筛未返回判定，保守保留",
        }));
      }
      verdicts.push(...batchVerdicts);
    }

    return { verdicts, modelRunId };
  }

  async rerank(goals: GoalContext[], items: CandidateItem[], opts: { slotsPerGoal: number }) {
    const system = `你在为用户挑选今天该读什么。这是最终决定，要在候选之间做相对比较，
而不是分别给孤立的分数。核心问题是：

「如果这个目标今天只能读一条，哪一条最能推动它？它相对于其他候选新增了什么？」

${READING_POLICY}

每个目标选 ${opts.slotsPerGoal} 条。同一个来源每天最多出一条。
**必须覆盖所有目标**：下面每个目标都要至少选 1 条，不能漏掉任何目标。
只有当某个目标在候选里确实没有相关内容时才允许跳过，并在 reason 里说明。

scaffold 最重要，它是用户能不能真的读下去的关键。caveat 要诚实写出这篇材料的
不足（比如「只讲了结论没给数据」），没有就填 null。

${goals.some((g) => g.id === "cognition") ? `认知目标的评分标尺：\n${rubric()}\n` : ""}
只输出 json：
{"picks":[{"itemId":123,"goalId":"目标id","nodeId":null,"score":85,"relevance":0.9,
"sourceWeight":1.5,"gapFit":0.8,"novelty":0.7,"readingCost":0.4,
"reason":"为什么是它、为什么是现在","confidence":"high","readingAdvice":"完整阅读",
"caveat":"已知不足或 null",
"scaffold":{"prereq":["前置1"],"questions":["带着读的问题1"],"selfCheck":["自检点1"]}}]}`;

    const goalBlock = goals
      .map(
        (g) =>
          `- ${g.id}：${g.title}\n  当前水平：${g.currentLevel ?? "未填"}\n  期望产出：${g.expectedOutput ?? "未填"}\n  子目标：${g.nodes.map((n) => `${n.title}（${n.status}）`).join("；") || "尚未拆解"}`,
      )
      .join("\n");
    const itemBlock = items
      .map(
        (i) =>
          `[${i.id}] ${i.title}\n  来源：${i.sourceName}（权重 ${i.sourceWeight}）\n  摘要：${(i.summary ?? "（无摘要）").slice(0, 900)}`,
      )
      .join("\n\n");

    return this.call<{ picks: RerankPick[] }>({
      purpose: "rerank",
      model: this.rerankModel,
      system,
      user: `目标：\n${goalBlock}\n\n候选内容：\n${itemBlock}`,
      itemIds: items.map((i) => i.id),
      validate: (raw) => {
        const o = raw as { picks?: unknown };
        if (!Array.isArray(o.picks)) throw new Error("返回里没有 picks 数组");
        const known = new Set(items.map((i) => i.id));
        const goalIds = new Set(goals.map((g) => g.id));
        const num = (v: unknown, d = 0) => {
          const n = Number(v);
          return Number.isFinite(n) ? n : d;
        };
        const arr = (v: unknown): string[] =>
          Array.isArray(v) ? v.map(String).filter(Boolean) : [];

        const picks = o.picks
          .filter((p): p is Record<string, unknown> => !!p && typeof p === "object")
          .map((p) => {
            const sc = (p.scaffold ?? {}) as Record<string, unknown>;
            const conf = String(p.confidence ?? "medium");
            return {
              itemId: num(p.itemId, -1),
              goalId: String(p.goalId ?? ""),
              nodeId: p.nodeId == null ? null : num(p.nodeId),
              score: num(p.score),
              relevance: num(p.relevance),
              sourceWeight: num(p.sourceWeight, 1),
              gapFit: num(p.gapFit),
              novelty: num(p.novelty),
              readingCost: num(p.readingCost),
              reason: String(p.reason ?? ""),
              confidence: (["low", "medium", "high"].includes(conf) ? conf : "medium") as
                | "low"
                | "medium"
                | "high",
              readingAdvice: String(p.readingAdvice ?? "完整阅读"),
              caveat: p.caveat == null ? null : String(p.caveat),
              scaffold: {
                prereq: arr(sc.prereq),
                questions: arr(sc.questions),
                selfCheck: arr(sc.selfCheck),
              },
            };
          })
          .filter((p) => known.has(p.itemId) && goalIds.has(p.goalId));
        return { picks };
      },
    }).then((r) => ({ picks: r.data.picks, modelRunId: r.modelRunId }));
  }
}
