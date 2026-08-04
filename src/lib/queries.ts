import { and, desc, eq, gte, sql } from "drizzle-orm";

import { db, schema } from "../db/index.ts";

const {
  dailyRecommendations,
  feedback,
  fetchRuns,
  goalNodes,
  goals,
  itemGoalScores,
  items,
  sources,
} = schema;

const DAY = 86400;
export const todayStr = () => new Date().toISOString().slice(0, 10);

export type RecCard = Awaited<ReturnType<typeof getTodayRecs>>[number];

/** 今日推荐。带上评分分项、脚手架、已有反馈。 */
export async function getTodayRecs(date = todayStr()) {
  const rows = await db
    .select({
      id: dailyRecommendations.id,
      slot: dailyRecommendations.slot,
      rank: dailyRecommendations.rank,
      reason: dailyRecommendations.reason,
      confidence: dailyRecommendations.confidence,
      readingAdvice: dailyRecommendations.readingAdvice,
      caveat: dailyRecommendations.caveat,
      scaffold: dailyRecommendations.scaffold,
      state: dailyRecommendations.state,
      context: dailyRecommendations.context,
      itemId: items.id,
      title: items.title,
      url: items.url,
      summary: items.summary,
      publishedAt: items.publishedAt,
      readingMinutes: items.readingMinutes,
      lang: items.lang,
      sourceName: sources.name,
      sourceFragile: sources.fragile,
      goalId: goals.id,
      goalTitle: goals.title,
      nodeTitle: goalNodes.title,
    })
    .from(dailyRecommendations)
    .innerJoin(items, eq(items.id, dailyRecommendations.itemId))
    .innerJoin(goals, eq(goals.id, dailyRecommendations.goalId))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .leftJoin(goalNodes, eq(goalNodes.id, dailyRecommendations.nodeId))
    .where(eq(dailyRecommendations.date, date))
    .orderBy(dailyRecommendations.slot, dailyRecommendations.rank);

  const scores = await db
    .select()
    .from(itemGoalScores)
    .where(eq(itemGoalScores.stage, "rerank"));

  const fbs = await db.select().from(feedback);

  return rows.map((r) => ({
    ...r,
    score: scores.find((s) => s.itemId === r.itemId && s.goalId === r.goalId) ?? null,
    feedback: fbs.filter((f) => f.recommendationId === r.id).map((f) => f.kind),
  }));
}

/** 今日过滤统计。存在推荐的 context 里。 */
export async function getFilterStats(date = todayStr()) {
  const [row] = await db
    .select({ context: dailyRecommendations.context })
    .from(dailyRecommendations)
    .where(eq(dailyRecommendations.date, date))
    .limit(1);
  const c = row?.context as
    | { candidates?: number; filtered?: number; filterReasons?: Record<string, number>; provider?: string }
    | undefined;
  return {
    candidates: c?.candidates ?? 0,
    filtered: c?.filtered ?? 0,
    reasons: c?.filterReasons ?? {},
    provider: c?.provider ?? null,
  };
}

/** 最近抓取失败的源。脆弱源挂了必须看得见，不能默默少推内容。 */
export async function getFailedSources(hours = 36) {
  const since = Math.floor(Date.now() / 1000) - hours * 3600;
  const latest = await db
    .select({
      sourceId: fetchRuns.sourceId,
      name: sources.name,
      fragile: sources.fragile,
      status: fetchRuns.status,
      error: fetchRuns.error,
      startedAt: fetchRuns.startedAt,
    })
    .from(fetchRuns)
    .innerJoin(sources, eq(sources.id, fetchRuns.sourceId))
    .where(gte(fetchRuns.startedAt, since))
    .orderBy(desc(fetchRuns.startedAt));

  // 每个源只看最近一次
  const seen = new Set<number>();
  return latest
    .filter((r) => (seen.has(r.sourceId) ? false : (seen.add(r.sourceId), true)))
    .filter((r) => r.status === "error");
}

export async function getGoalsWithNodes() {
  const gs = await db.select().from(goals).orderBy(goals.sortOrder);
  const nodes = await db.select().from(goalNodes).orderBy(goalNodes.sortOrder);
  const recCounts = await db
    .select({ goalId: dailyRecommendations.goalId, n: sql<number>`count(*)` })
    .from(dailyRecommendations)
    .groupBy(dailyRecommendations.goalId);

  return gs.map((g) => ({
    ...g,
    nodes: nodes.filter((n) => n.goalId === g.id),
    recommended: Number(recCounts.find((c) => c.goalId === g.id)?.n ?? 0),
  }));
}

export async function getSources() {
  const rows = await db.select().from(sources).orderBy(desc(sources.globalWeight));
  const counts = await db
    .select({ sourceId: items.sourceId, n: sql<number>`count(*)` })
    .from(items)
    .groupBy(items.sourceId);
  const recCounts = await db
    .select({ sourceId: items.sourceId, n: sql<number>`count(*)` })
    .from(dailyRecommendations)
    .innerJoin(items, eq(items.id, dailyRecommendations.itemId))
    .groupBy(items.sourceId);
  const lastRuns = await db
    .select({
      sourceId: fetchRuns.sourceId,
      status: fetchRuns.status,
      error: fetchRuns.error,
      startedAt: fetchRuns.startedAt,
    })
    .from(fetchRuns)
    .orderBy(desc(fetchRuns.startedAt));

  const seen = new Set<number>();
  const latest = new Map(
    lastRuns
      .filter((r) => (seen.has(r.sourceId) ? false : (seen.add(r.sourceId), true)))
      .map((r) => [r.sourceId, r]),
  );

  return rows.map((s) => ({
    ...s,
    itemCount: Number(counts.find((c) => c.sourceId === s.id)?.n ?? 0),
    recCount: Number(recCounts.find((c) => c.sourceId === s.id)?.n ?? 0),
    lastRun: latest.get(s.id) ?? null,
  }));
}

/** 资料库：所有被推荐过的内容 + 反馈 */
export async function getLibrary(limit = 100) {
  const rows = await db
    .select({
      recId: dailyRecommendations.id,
      date: dailyRecommendations.date,
      state: dailyRecommendations.state,
      reason: dailyRecommendations.reason,
      itemId: items.id,
      title: items.title,
      url: items.url,
      sourceName: sources.name,
      goalTitle: goals.title,
    })
    .from(dailyRecommendations)
    .innerJoin(items, eq(items.id, dailyRecommendations.itemId))
    .innerJoin(goals, eq(goals.id, dailyRecommendations.goalId))
    .leftJoin(sources, eq(sources.id, items.sourceId))
    .orderBy(desc(dailyRecommendations.date), dailyRecommendations.rank)
    .limit(limit);

  const fbs = await db.select().from(feedback);
  return rows.map((r) => ({
    ...r,
    feedback: fbs.filter((f) => f.recommendationId === r.recId).map((f) => f.kind),
  }));
}

/** 库存概览，今日页底部显示 */
export async function getInventory() {
  const [{ total }] = await db.select({ total: sql<number>`count(*)` }).from(items);
  const since = Math.floor(Date.now() / 1000) - 7 * DAY;
  const [{ recent }] = await db
    .select({ recent: sql<number>`count(*)` })
    .from(items)
    .where(gte(items.publishedAt, since));
  const [{ used }] = await db
    .select({ used: sql<number>`count(distinct ${dailyRecommendations.itemId})` })
    .from(dailyRecommendations);
  return { total: Number(total), recent: Number(recent), used: Number(used) };
}

/** 阅读工作台：文章正文 + 推荐上下文（目标、评分分项、来源） */
export async function getReadingContext(itemId: number) {
  const [item] = await db.select().from(items).where(eq(items.id, itemId));
  if (!item) return null;

  let rec: (typeof dailyRecommendations.$inferSelect) | null = null;
  let goal: (typeof goals.$inferSelect) | null = null;
  let score: (typeof itemGoalScores.$inferSelect) | null = null;
  let source: (typeof sources.$inferSelect) | null = null;

  if (item.sourceId) {
    [source] = await db.select().from(sources).where(eq(sources.id, item.sourceId));
  }
  [rec] = await db
    .select()
    .from(dailyRecommendations)
    .where(eq(dailyRecommendations.itemId, itemId))
    .orderBy(desc(dailyRecommendations.date))
    .limit(1);
  if (rec) {
    [goal] = await db.select().from(goals).where(eq(goals.id, rec.goalId));
    [score] = await db
      .select()
      .from(itemGoalScores)
      .where(
        and(
          eq(itemGoalScores.itemId, itemId),
          eq(itemGoalScores.goalId, rec.goalId),
          eq(itemGoalScores.stage, "rerank"),
        ),
      )
      .limit(1);
  }
  return { item, rec, goal, score, source };
}
