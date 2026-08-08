import { and, desc, eq, gte, inArray, isNull, sql } from "drizzle-orm";

import { db, schema } from "../../db/index.ts";
import { getProvider } from "../model/index.ts";
import type { CandidateItem, GoalContext } from "../model/types.ts";

const {
  dailyRecommendations,
  goalNodes,
  goalSourcePolicies,
  goals,
  itemGoalScores,
  items,
  sources,
} = schema;

const DAY = 86400;
const nowSec = () => Math.floor(Date.now() / 1000);
/** 本地时区日期（不能 toISOString——UTC 会在本地凌晨跨天，导致推荐存到前一天） */
const today = () => {
  const d = new Date();
  const p = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())}`;
};

/** 周末给深读包——硬东西需要连续时间，工作日 2 小时启动不了 */
function isWeekend(d = new Date()): boolean {
  const day = d.getDay();
  return day === 0 || day === 6;
}

async function loadGoals(): Promise<GoalContext[]> {
  const gs = await db.select().from(goals).where(eq(goals.status, "active")).orderBy(goals.sortOrder);
  const nodes = await db.select().from(goalNodes);
  return gs.map((g) => ({
    id: g.id,
    title: g.title,
    why: g.why,
    currentLevel: g.currentLevel,
    expectedOutput: g.expectedOutput,
    avoid: g.avoid,
    nodes: nodes
      .filter((n) => n.goalId === g.id)
      .sort((a, b) => a.sortOrder - b.sortOrder)
      .map((n) => ({
        id: n.id,
        title: n.title,
        doneCriteria: n.doneCriteria,
        status: n.status,
      })),
  }));
}

/**
 * 取候选集：还没被推荐过、最近抓到的内容。
 * 不按发布时间硬筛——学习型目标里，一篇两年前的好文章仍然有价值。
 */
async function loadCandidates(limit: number): Promise<CandidateItem[]> {
  const alreadyRecommended = db
    .select({ id: dailyRecommendations.itemId })
    .from(dailyRecommendations);

  const rows = await db
    .select({
      id: items.id,
      title: items.title,
      summary: items.summary,
      lang: items.lang,
      url: items.url,
      publishedAt: items.publishedAt,
      sourceId: items.sourceId,
      sourceName: sources.name,
      sourceWeight: sources.globalWeight,
    })
    .from(items)
    .leftJoin(sources, eq(items.sourceId, sources.id))
    .where(
      and(
        sql`${items.id} NOT IN ${alreadyRecommended}`,
        eq(sources.status, "active"),
      ),
    )
    .orderBy(desc(items.publishedAt))
    .limit(limit);

  const policies = await db.select().from(goalSourcePolicies);

  return rows.map((r) => ({
    id: r.id,
    title: r.title,
    sourceName: r.sourceName ?? "手动添加",
    sourceWeight: r.sourceWeight ?? 1,
    goalWeights: Object.fromEntries(
      policies.filter((p) => p.sourceId === r.sourceId).map((p) => [p.goalId, p.weight]),
    ),
    publishedAt: r.publishedAt,
    summary: r.summary,
    lang: r.lang,
    url: r.url,
  }));
}

/**
 * 单源垄断抑制（§6.3）。查最近 7 天每个源已经出过几条。
 */
async function weeklyUsage(): Promise<Map<number, number>> {
  const since = nowSec() - 7 * DAY;
  const rows = await db
    .select({ sourceId: items.sourceId, n: sql<number>`count(*)` })
    .from(dailyRecommendations)
    .innerJoin(items, eq(items.id, dailyRecommendations.itemId))
    .where(gte(dailyRecommendations.createdAt, since))
    .groupBy(items.sourceId);
  return new Map(rows.map((r) => [r.sourceId ?? -1, Number(r.n)]));
}

export type RecommendReport = {
  provider: string;
  date: string;
  weekend: boolean;
  candidates: number;
  keptByPrefilter: number;
  filtered: number;
  filterReasons: Record<string, number>;
  picks: Array<{ goal: string; title: string; source: string; score: number; reason: string }>;
  deepRead: Array<{ goal: string; title: string; source: string }>;
};

export async function generateToday(
  opts: { candidateLimit?: number; dryRun?: boolean } = {},
): Promise<RecommendReport> {
  const provider = getProvider();
  const date = today();
  const weekend = isWeekend();

  const goalList = await loadGoals();
  if (!goalList.length) throw new Error("没有活跃目标，先跑 npm run seed");

  const candidates = await loadCandidates(opts.candidateLimit ?? 120);

  // ---- 初筛 ----
  const { verdicts, modelRunId: preRunId } = await provider.prefilter(goalList, candidates);
  const keptIds = new Set(verdicts.filter((v) => v.keep).map((v) => v.itemId));

  const filterReasons: Record<string, number> = {};
  for (const v of verdicts) {
    if (!v.keep) filterReasons[v.reason] = (filterReasons[v.reason] ?? 0) + 1;
  }

  if (!opts.dryRun) {
    for (const v of verdicts) {
      if (!v.goalId) continue;
      await db.insert(itemGoalScores).values({
        itemId: v.itemId,
        goalId: v.goalId,
        stage: "prefilter",
        relevance: v.relevance,
        reason: v.reason,
        modelRunId: preRunId,
        promptVersion: "v1",
      });
    }
  }

  const survivors = candidates.filter((c) => keptIds.has(c.id));

  // ---- 重排 ----
  // 工作日每个目标最多 3 条、周末 3 条（日常 + 深读），给足候选余量。
  // 分配时会因为撞源/周上限丢弃一些，没有余量后面的目标会拿不到候选。
  const slotsPerGoal = 3;
  const { picks, modelRunId: rerankRunId } = await provider.rerank(goalList, survivors, {
    slotsPerGoal,
  });

  // ---- 名额分配 ----
  const usage = await weeklyUsage();
  const byId = new Map(candidates.map((c) => [c.id, c]));
  const srcIdByItem = new Map<number, number>();
  {
    const rows = await db
      .select({ id: items.id, sourceId: items.sourceId })
      .from(items)
      .where(inArray(items.id, picks.map((p) => p.itemId)));
    for (const r of rows) srcIdByItem.set(r.id, r.sourceId ?? -1);
  }

  const daily: typeof picks = [];
  const deep: typeof picks = [];
  const takenSources = new Set<number>();
  const MAX_PER_WEEK = 3;

  // 按 itemId 去重，不能用对象身份——不同目标会为同一篇文章各生成一个
  // pick 对象，用 includes() 判断的话同一篇会被同时推给两个目标。
  const takenItems = new Set<number>();

  const usable = (p: (typeof picks)[number]) => {
    if (takenItems.has(p.itemId)) return false;
    const sid = srcIdByItem.get(p.itemId) ?? -1;
    if (takenSources.has(sid)) return false; // 同一个源今天最多一条
    if ((usage.get(sid) ?? 0) >= MAX_PER_WEEK) return false; // 周上限
    return true;
  };
  const take = (p: (typeof picks)[number], into: typeof picks) => {
    into.push(p);
    takenItems.add(p.itemId);
    takenSources.add(srcIdByItem.get(p.itemId) ?? -1);
  };

  const byGoal = new Map(
    goalList.map((g) => [
      g.id,
      picks.filter((p) => p.goalId === g.id).sort((a, b) => b.score - a.score),
    ]),
  );

  // 第一轮：每个目标各拿一条日常推荐。
  // 必须分两轮——否则排在前面的目标会把源占光，后面的目标一条都拿不到。
  // （实测过：半导体目标抢走一篇本该属于大模型目标的文章去做深读，
  //   结果大模型目标当天颗粒无收。）
  for (const goal of goalList) {
    const p = (byGoal.get(goal.id) ?? []).find(usable);
    if (p) take(p, daily);
  }

  // 保底补足：某些目标第一轮可能因为撞源/周上限/重复而颗粒无收
  // （实测出现过当天只有 2 条）。用户要求每天至少每个目标 1 条。
  // 此时放宽「同一个源一天最多一条」，只保留「同篇不重复」+「周上限」，
  // 从全量 rerank 候选按分数给缺的目标补一条。宁可同源两条，也不能让目标空着。
  if (daily.length < goalList.length) {
    const pickedGoals = new Set(daily.map((p) => p.goalId));
    const byScore = [...picks].sort((a, b) => b.score - a.score);
    for (const p of byScore) {
      if (daily.length >= goalList.length) break;
      if (takenItems.has(p.itemId)) continue;
      if (pickedGoals.has(p.goalId)) continue; // 每个目标最多补一条
      const sid = srcIdByItem.get(p.itemId) ?? -1;
      if ((usage.get(sid) ?? 0) >= MAX_PER_WEEK) continue; // 仍守周上限
      take(p, daily);
      pickedGoals.add(p.goalId);
    }

    // 仍缺的目标：rerank 完全没给它选候选（模型偶尔漏选目标）。
    // 从本次 prefilter 的高相关候选直接补一条，保证每天每个目标至少 1 条。
    const missingGoals = goalList.filter((g) => !pickedGoals.has(g.id));
    if (missingGoals.length > 0 && preRunId != null) {
      const fallback = await db
        .select({
          itemId: itemGoalScores.itemId,
          goalId: itemGoalScores.goalId,
          relevance: itemGoalScores.relevance,
        })
        .from(itemGoalScores)
        .where(
          and(
            eq(itemGoalScores.stage, "prefilter"),
            eq(itemGoalScores.modelRunId, preRunId),
            inArray(
              itemGoalScores.goalId,
              missingGoals.map((g) => g.id),
            ),
          ),
        )
        .orderBy(desc(itemGoalScores.relevance));
      for (const g of missingGoals) {
        if (daily.length >= goalList.length) break;
        const row = fallback.find(
          (r) =>
            r.goalId === g.id &&
            !takenItems.has(r.itemId) &&
            (usage.get(srcIdByItem.get(r.itemId) ?? -1) ?? 0) < MAX_PER_WEEK,
        );
        if (!row) continue;
        const cand = byId.get(row.itemId);
        const pick: (typeof picks)[number] = {
          itemId: row.itemId,
          goalId: g.id,
          nodeId: null,
          score: Math.round((row.relevance ?? 0) * 100),
          relevance: row.relevance ?? 0,
          sourceWeight: cand?.sourceWeight ?? 1,
          gapFit: 0,
          novelty: 0,
          readingCost: 0,
          reason: "rerank 未选中该目标，由初筛高相关候选兜底",
          confidence: "medium",
          readingAdvice: "完整阅读",
          caveat: null,
          scaffold: { prereq: [], questions: [], selfCheck: [] },
        };
        take(pick, daily);
        pickedGoals.add(g.id);
      }
    }
  }

  // 每日补足：用户要求每天 5 条（3 个目标×1 条基础不够）。
  // 从 rerank 候选按分数继续补，允许同源多条（守周上限、不重复同篇），
  // 直到凑满 5 条或候选耗尽。周末另有深读包，不影响日常 5 条。
  const DAILY_TARGET = 5;
  if (daily.length < DAILY_TARGET) {
    const byScore = [...picks].sort((a, b) => b.score - a.score);
    for (const p of byScore) {
      if (daily.length >= DAILY_TARGET) break;
      if (takenItems.has(p.itemId)) continue;
      const sid = srcIdByItem.get(p.itemId) ?? -1;
      if ((usage.get(sid) ?? 0) >= MAX_PER_WEEK) continue;
      take(p, daily);
    }
  }

  // 第二轮：周末的深读包，每个目标最多再加一条。
  //
  // 这一轮**不检查同日撞源**，只保留周上限。理由：深读是额外给的槽位，
  // 同一个强源（比如 SemiAnalysis）周末出第二篇的代价，远小于「周末什么
  // 都没有」。实测严格去重会让深读静默为空——用户看不到任何提示，
  // 只会以为今天没好东西。
  if (weekend) {
    for (const goal of goalList) {
      const p = (byGoal.get(goal.id) ?? []).find(
        (x) =>
          !takenItems.has(x.itemId) &&
          (usage.get(srcIdByItem.get(x.itemId) ?? -1) ?? 0) < MAX_PER_WEEK,
      );
      if (p) {
        deep.push(p);
        takenItems.add(p.itemId);
      }
    }
  }

  // ---- 落库 ----
  if (!opts.dryRun) {
    const write = async (list: typeof picks, slot: "daily" | "weekend_deep") => {
      for (const [i, p] of list.entries()) {
        await db.insert(itemGoalScores).values({
          itemId: p.itemId,
          goalId: p.goalId,
          nodeId: p.nodeId,
          stage: "rerank",
          score: p.score,
          relevance: p.relevance,
          sourceWeight: p.sourceWeight,
          gapFit: p.gapFit,
          novelty: p.novelty,
          readingCost: p.readingCost,
          reason: p.reason,
          confidence: p.confidence,
          readingAdvice: p.readingAdvice,
          caveat: p.caveat,
          modelRunId: rerankRunId,
          promptVersion: "v1",
        });
        await db
          .insert(dailyRecommendations)
          .values({
            date,
            slot,
            rank: i + 1,
            itemId: p.itemId,
            goalId: p.goalId,
            nodeId: p.nodeId,
            reason: p.reason,
            confidence: p.confidence,
            readingAdvice: p.readingAdvice,
            caveat: p.caveat,
            scaffold: p.scaffold,
            // 今日页要显示「过滤掉多少、为什么」——这是产品主张的一部分，
            // 主动隐藏噪声本身就是价值，所以数字必须留痕。
            context: {
              provider: provider.name,
              candidates: candidates.length,
              filtered: candidates.length - survivors.length,
              filterReasons: Object.fromEntries(
                Object.entries(filterReasons)
                  .sort((a, b) => b[1] - a[1])
                  .slice(0, 5),
              ),
            },
          })
          // 同一天刷新时覆盖旧推荐（用户对当前推荐不满意，点刷新换一批）。
          // 跨天自然插入新行；已推荐过的文章仍会被候选排除。
          .onConflictDoUpdate({
            target: [dailyRecommendations.date, dailyRecommendations.slot, dailyRecommendations.rank],
            set: {
              itemId: p.itemId,
              goalId: p.goalId,
              nodeId: p.nodeId,
              reason: p.reason,
              confidence: p.confidence,
              readingAdvice: p.readingAdvice,
              caveat: p.caveat,
              scaffold: p.scaffold,
              context: {
                provider: provider.name,
                candidates: candidates.length,
                filtered: candidates.length - survivors.length,
                filterReasons: Object.fromEntries(
                  Object.entries(filterReasons)
                    .sort((a, b) => b[1] - a[1])
                    .slice(0, 5),
                ),
              },
            },
          });
      }
    };
    await write(daily, "daily");
    await write(deep, "weekend_deep");
  }

  const fmt = (p: (typeof picks)[number]) => ({
    goal: goalList.find((g) => g.id === p.goalId)?.title ?? p.goalId,
    title: byId.get(p.itemId)?.title ?? String(p.itemId),
    source: byId.get(p.itemId)?.sourceName ?? "?",
    score: p.score,
    reason: p.reason,
  });

  return {
    provider: provider.name,
    date,
    weekend,
    candidates: candidates.length,
    keptByPrefilter: survivors.length,
    filtered: candidates.length - survivors.length,
    filterReasons,
    picks: daily.map(fmt),
    deepRead: deep.map((p) => ({
      goal: goalList.find((g) => g.id === p.goalId)?.title ?? p.goalId,
      title: byId.get(p.itemId)?.title ?? String(p.itemId),
      source: byId.get(p.itemId)?.sourceName ?? "?",
    })),
  };
}
