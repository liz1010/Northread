"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "../../../db/index.ts";

const { goals } = schema;

/**
 * 更新目标。保存后 revalidate 目标页与今日页。
 *
 * 推荐管线（scripts/recommend.ts 与 /api/refresh 的后台任务）每次运行都从
 * goals 表重新读活跃目标（title/why/currentLevel/expectedOutput/avoid），
 * 初筛和重排的 prompt 也随之变化——所以「目标更新后推荐标准自动跟随」，
 * 不需要额外迁移，只要重新生成一次推荐即可。
 */
export async function updateGoal(id: string, form: FormData): Promise<string | null> {
  const title = String(form.get("title") ?? "").trim();
  if (!title) return "标题不能为空";

  const status = form.get("status") === "active" ? "active" : "paused";

  await db
    .update(goals)
    .set({
      title,
      why: String(form.get("why") ?? "").trim() || null,
      currentLevel: String(form.get("currentLevel") ?? "").trim() || null,
      expectedOutput: String(form.get("expectedOutput") ?? "").trim() || null,
      avoid: String(form.get("avoid") ?? "").trim() || null,
      status,
      updatedAt: Math.floor(Date.now() / 1000),
    })
    .where(eq(goals.id, id));

  revalidatePath("/goals");
  revalidatePath("/");
  return null;
}
