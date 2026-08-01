/**
 * 把 seed/goals-and-sources.json 写进数据库。
 * 可重复执行：已存在的按 url / id 更新，不会产生重复。
 */
import { readFileSync } from "node:fs";
import { eq } from "drizzle-orm";

import { db, schema } from "../src/db/index.ts";

const { goalSourcePolicies, goals, sources } = schema;

type Seed = {
  goals: Array<{
    id: string;
    title: string;
    why?: string;
    horizonMonths?: number | string;
    currentLevel?: string;
    expectedOutput?: string;
    avoid?: string;
    decomposeHint?: string | string[];
  }>;
  sources: Array<{
    name: string;
    url: string;
    lang?: string;
    globalWeight?: number;
    maxPerWeek?: number;
    fragile?: boolean;
    bulkFeed?: boolean;
    note?: string;
    goalWeights?: Record<string, number>;
  }>;
};

const seed: Seed = JSON.parse(
  readFileSync(new URL("../seed/goals-and-sources.json", import.meta.url), "utf8"),
);

let g = 0;
for (const [i, goal] of seed.goals.entries()) {
  const hint = Array.isArray(goal.decomposeHint)
    ? goal.decomposeHint
    : goal.decomposeHint
      ? [goal.decomposeHint]
      : null;

  const row = {
    title: goal.title,
    why: goal.why ?? null,
    horizon: goal.horizonMonths != null ? String(goal.horizonMonths) : null,
    currentLevel: goal.currentLevel ?? null,
    expectedOutput: goal.expectedOutput ?? null,
    avoid: goal.avoid ?? null,
    decomposeHint: hint,
    sortOrder: i,
    updatedAt: Math.floor(Date.now() / 1000),
  };

  const existing = await db.select().from(goals).where(eq(goals.id, goal.id)).limit(1);
  if (existing.length) {
    await db.update(goals).set(row).where(eq(goals.id, goal.id));
  } else {
    await db.insert(goals).values({ id: goal.id, ...row });
  }
  g++;
}

let s = 0;
let p = 0;
for (const src of seed.sources) {
  const row = {
    name: src.name,
    lang: src.lang ?? "en",
    globalWeight: src.globalWeight ?? 1,
    maxPerWeek: src.maxPerWeek ?? 3,
    fragile: src.fragile ?? false,
    bulkFeed: src.bulkFeed ?? false,
    note: src.note ?? null,
  };

  const existing = await db.select().from(sources).where(eq(sources.url, src.url)).limit(1);
  let sourceId: number;
  if (existing.length) {
    sourceId = existing[0].id;
    await db.update(sources).set(row).where(eq(sources.id, sourceId));
  } else {
    const [ins] = await db.insert(sources).values({ url: src.url, ...row }).returning({ id: sources.id });
    sourceId = ins.id;
  }
  s++;

  await db.delete(goalSourcePolicies).where(eq(goalSourcePolicies.sourceId, sourceId));
  for (const [goalId, weight] of Object.entries(src.goalWeights ?? {})) {
    await db.insert(goalSourcePolicies).values({ goalId, sourceId, weight });
    p++;
  }
}

console.log(`目标 ${g} 个，信源 ${s} 个，目标-信源权重 ${p} 条`);
