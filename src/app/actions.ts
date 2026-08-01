"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";

import { db, schema } from "../db/index.ts";
import type { FeedbackKind } from "../lib/feedback.ts";

const { dailyRecommendations, feedback } = schema;

export async function submitFeedback(recId: number, itemId: number, kind: FeedbackKind) {
  await db.insert(feedback).values({ recommendationId: recId, itemId, kind });

  // 「放弃」按 readingPolicy 处理：这是脚手架不够的信号，
  // 不是内容太难要降级的信号——两条路径在后续调权重时分开走。
  if (kind === "abandoned") {
    await db
      .update(dailyRecommendations)
      .set({ state: "abandoned" })
      .where(eq(dailyRecommendations.id, recId));
  }
  revalidatePath("/");
  revalidatePath("/library");
}

export async function setState(
  recId: number,
  state: "new" | "reading" | "read" | "later" | "skipped" | "abandoned",
) {
  await db.update(dailyRecommendations).set({ state }).where(eq(dailyRecommendations.id, recId));
  revalidatePath("/");
  revalidatePath("/library");
}
