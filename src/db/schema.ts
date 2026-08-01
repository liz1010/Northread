import { sql } from "drizzle-orm";
import {
  index,
  integer,
  real,
  sqliteTable,
  text,
  uniqueIndex,
} from "drizzle-orm/sqlite-core";

/**
 * 数据模型。对应实施计划 §9，外加两张表：
 *   goal_nodes  —— AI 拆出来的子目标树
 *   fetch_runs  —— 抓取记录。脆弱源（nitter）挂掉时界面要能明确报错，
 *                  不能默默少推内容让人以为「今天就是没好东西」。
 */

const now = sql`(unixepoch())`;

/* ------------------------------------------------------------------ *
 * 目标层
 * ------------------------------------------------------------------ */

export const goals = sqliteTable("goals", {
  id: text("id").primaryKey(),
  title: text("title").notNull(),
  why: text("why"),
  horizon: text("horizon"),
  /** 用户自述的当前水平。拆子目标时这是最重要的输入。 */
  currentLevel: text("current_level"),
  expectedOutput: text("expected_output"),
  /** 明确不想看到的东西 */
  avoid: text("avoid"),
  /** 拆解时给模型的额外提示，JSON 字符串数组 */
  decomposeHint: text("decompose_hint", { mode: "json" }).$type<string[]>(),
  status: text("status", { enum: ["active", "paused"] })
    .notNull()
    .default("active"),
  sortOrder: integer("sort_order").notNull().default(0),
  createdAt: integer("created_at").notNull().default(now),
  updatedAt: integer("updated_at").notNull().default(now),
});

/**
 * 子目标树。由 AI 拆出，深度不固定——拆到几层由模型决定。
 * 用户可以改、可以自己加（createdBy='user'）。
 */
export const goalNodes = sqliteTable(
  "goal_nodes",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    /** null = 挂在目标根下 */
    parentId: integer("parent_id"),
    title: text("title").notNull(),
    /** 为什么需要这个子目标 */
    why: text("why"),
    /** 怎么算「补上了」——没有这个就无法判定完成 */
    doneCriteria: text("done_criteria"),
    status: text("status", { enum: ["pending", "active", "done"] })
      .notNull()
      .default("pending"),
    depth: integer("depth").notNull().default(0),
    sortOrder: integer("sort_order").notNull().default(0),
    createdBy: text("created_by", { enum: ["ai", "user"] })
      .notNull()
      .default("ai"),
    /** 来自哪次模型调用，出问题时能追溯 */
    modelRunId: integer("model_run_id"),
    createdAt: integer("created_at").notNull().default(now),
    doneAt: integer("done_at"),
  },
  (t) => [
    index("goal_nodes_goal_idx").on(t.goalId),
    index("goal_nodes_parent_idx").on(t.parentId),
  ],
);

/* ------------------------------------------------------------------ *
 * 信源层
 * ------------------------------------------------------------------ */

export const sources = sqliteTable(
  "sources",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    name: text("name").notNull(),
    url: text("url").notNull(),
    lang: text("lang").notNull().default("en"),
    /** 0=静音 0.5=降权 1=中性 1.5=重要 2=核心 */
    globalWeight: real("global_weight").notNull().default(1),
    maxPerWeek: integer("max_per_week").notNull().default(3),
    status: text("status", { enum: ["active", "muted"] })
      .notNull()
      .default("active"),
    /** 镜像站等随时可能挂的源，UI 上要单独标注 */
    fragile: integer("fragile", { mode: "boolean" }).notNull().default(false),
    /** feed 返回全站存档（上千条）的源，抓取时必须按日期截断 */
    bulkFeed: integer("bulk_feed", { mode: "boolean" }).notNull().default(false),
    note: text("note"),
    lastFetchedAt: integer("last_fetched_at"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [uniqueIndex("sources_url_idx").on(t.url)],
);

export const goalSourcePolicies = sqliteTable(
  "goal_source_policies",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    weight: real("weight").notNull().default(1),
    note: text("note"),
  },
  (t) => [uniqueIndex("gsp_goal_source_idx").on(t.goalId, t.sourceId)],
);

/** 每次抓取一个源的结果。失败要能在界面上看到。 */
export const fetchRuns = sqliteTable(
  "fetch_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    sourceId: integer("source_id")
      .notNull()
      .references(() => sources.id, { onDelete: "cascade" }),
    startedAt: integer("started_at").notNull().default(now),
    finishedAt: integer("finished_at"),
    status: text("status", { enum: ["ok", "error"] }).notNull(),
    httpStatus: integer("http_status"),
    itemsSeen: integer("items_seen").notNull().default(0),
    itemsNew: integer("items_new").notNull().default(0),
    error: text("error"),
  },
  (t) => [index("fetch_runs_source_idx").on(t.sourceId, t.startedAt)],
);

/* ------------------------------------------------------------------ *
 * 内容层
 * ------------------------------------------------------------------ */

export const items = sqliteTable(
  "items",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** null = 手动粘进来的，不属于任何订阅源 */
    sourceId: integer("source_id").references(() => sources.id, {
      onDelete: "set null",
    }),
    url: text("url").notNull(),
    /** 去掉 utm 等追踪参数后的规范化 URL，去重用 */
    canonicalUrl: text("canonical_url").notNull(),
    title: text("title").notNull(),
    author: text("author"),
    publishedAt: integer("published_at"),
    summary: text("summary"),
    /** 提取出的正文。版权内容不长期保留，见实施计划 §8.2 */
    contentText: text("content_text"),
    lang: text("lang"),
    wordCount: integer("word_count"),
    readingMinutes: integer("reading_minutes"),
    /** 正文指纹，用于内容级去重 */
    contentHash: text("content_hash"),
    /** 标题归一化后的指纹，用于跨源转载检测 */
    titleHash: text("title_hash"),
    extractStatus: text("extract_status", {
      enum: ["ok", "partial", "failed", "skipped", "pending"],
    })
      .notNull()
      .default("skipped"),
    extractError: text("extract_error"),
    fetchedAt: integer("fetched_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("items_canonical_url_idx").on(t.canonicalUrl),
    index("items_content_hash_idx").on(t.contentHash),
    index("items_title_hash_idx").on(t.titleHash),
    index("items_published_idx").on(t.publishedAt),
  ],
);

/**
 * 评分。初筛和重排都写这张表，用 stage 区分。
 * 分项字段是为了在界面上展开「这个分数怎么来的」——
 * 产品愿景 §5.2.1 明确反对不可见的单一分数。
 */
export const itemGoalScores = sqliteTable(
  "item_goal_scores",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    /** 命中的具体子目标 */
    nodeId: integer("node_id"),
    stage: text("stage", { enum: ["prefilter", "rerank"] }).notNull(),
    score: real("score"),
    /* --- 分项 --- */
    relevance: real("relevance"),
    sourceWeight: real("source_weight"),
    gapFit: real("gap_fit"),
    novelty: real("novelty"),
    duplication: real("duplication"),
    readingCost: real("reading_cost"),
    /* --- 输出 --- */
    reason: text("reason"),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }),
    /** 完整阅读 / 速览 / 只读某节 */
    readingAdvice: text("reading_advice"),
    /** 已知的不足，比如「成本权衡讲得薄」 */
    caveat: text("caveat"),
    promptVersion: text("prompt_version"),
    modelRunId: integer("model_run_id"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    index("igs_item_idx").on(t.itemId),
    index("igs_stage_idx").on(t.stage, t.createdAt),
  ],
);

/* ------------------------------------------------------------------ *
 * 推荐与反馈
 * ------------------------------------------------------------------ */

export const dailyRecommendations = sqliteTable(
  "daily_recommendations",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    /** YYYY-MM-DD */
    date: text("date").notNull(),
    /** 工作日三条 vs 周末深读包 */
    slot: text("slot", { enum: ["daily", "weekend_deep"] })
      .notNull()
      .default("daily"),
    rank: integer("rank").notNull(),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    goalId: text("goal_id")
      .notNull()
      .references(() => goals.id, { onDelete: "cascade" }),
    nodeId: integer("node_id"),
    reason: text("reason"),
    confidence: text("confidence", { enum: ["low", "medium", "high"] }),
    readingAdvice: text("reading_advice"),
    caveat: text("caveat"),
    /**
     * 脚手架。readingPolicy 的核心：难度不降，但要给支撑。
     * { prereq: string[], questions: string[], selfCheck: string[] }
     */
    scaffold: text("scaffold", { mode: "json" }).$type<{
      prereq?: string[];
      questions?: string[];
      selfCheck?: string[];
    }>(),
    /** 生成时的上下文快照，用于复现 */
    context: text("context", { mode: "json" }),
    /** 阅读状态 */
    state: text("state", {
      enum: ["new", "reading", "read", "later", "skipped", "abandoned"],
    })
      .notNull()
      .default("new"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [
    uniqueIndex("daily_rec_unique_idx").on(t.date, t.slot, t.rank),
    index("daily_rec_date_idx").on(t.date),
  ],
);

/**
 * 显式反馈。选项来自产品愿景 §6。
 * abandoned 单独拎出来：按 readingPolicy，中途放弃是「脚手架不够」的信号，
 * 不是「内容太难要降级」的信号——处理方式完全不同。
 */
export const feedback = sqliteTable(
  "feedback",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    recommendationId: integer("recommendation_id").references(
      () => dailyRecommendations.id,
      { onDelete: "cascade" },
    ),
    itemId: integer("item_id")
      .notNull()
      .references(() => items.id, { onDelete: "cascade" }),
    kind: text("kind", {
      enum: [
        "helped_goal",
        "not_now",
        "already_knew",
        "too_shallow",
        "unreliable_source",
        "worth_rereading",
        "changed_my_mind",
        "led_to_action",
        "abandoned",
      ],
    }).notNull(),
    note: text("note"),
    createdAt: integer("created_at").notNull().default(now),
  },
  (t) => [index("feedback_item_idx").on(t.itemId)],
);

export const notes = sqliteTable("notes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").references(() => items.id, {
    onDelete: "set null",
  }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  nodeId: integer("node_id"),
  text: text("text").notNull(),
  createdAt: integer("created_at").notNull().default(now),
});

export const actions = sqliteTable("actions", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  itemId: integer("item_id").references(() => items.id, {
    onDelete: "set null",
  }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "set null" }),
  text: text("text").notNull(),
  status: text("status", { enum: ["open", "done"] })
    .notNull()
    .default("open"),
  createdAt: integer("created_at").notNull().default(now),
  doneAt: integer("done_at"),
});

/* ------------------------------------------------------------------ *
 * 可观测性
 * ------------------------------------------------------------------ */

/** 每次模型调用。实施计划 §8.4——让推荐问题可复现，而不是凭感觉改 prompt。 */
export const modelRuns = sqliteTable(
  "model_runs",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    at: integer("at").notNull().default(now),
    model: text("model").notNull(),
    purpose: text("purpose", {
      enum: ["decompose", "prefilter", "rerank", "explain", "review"],
    }).notNull(),
    promptVersion: text("prompt_version").notNull(),
    /** 只存 ID，不在日志里重复打印正文 */
    inputItemIds: text("input_item_ids", { mode: "json" }).$type<number[]>(),
    outputJson: text("output_json", { mode: "json" }),
    latencyMs: integer("latency_ms"),
    inputTokens: integer("input_tokens"),
    outputTokens: integer("output_tokens"),
    cacheReadTokens: integer("cache_read_tokens"),
    /** end_turn / max_tokens / refusal ... */
    stopReason: text("stop_reason"),
    /** stop_reason=refusal 时的分类 */
    refusalCategory: text("refusal_category"),
    error: text("error"),
  },
  (t) => [index("model_runs_at_idx").on(t.at), index("model_runs_purpose_idx").on(t.purpose)],
);

/** 权重变更。实施计划 §6.4——AI 建议、用户确认，且可撤销。 */
export const policyChanges = sqliteTable("policy_changes", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  sourceId: integer("source_id").references(() => sources.id, {
    onDelete: "cascade",
  }),
  goalId: text("goal_id").references(() => goals.id, { onDelete: "cascade" }),
  field: text("field").notNull(),
  fromValue: text("from_value"),
  toValue: text("to_value"),
  reason: text("reason"),
  proposedBy: text("proposed_by", { enum: ["ai", "user"] })
    .notNull()
    .default("ai"),
  status: text("status", {
    enum: ["proposed", "accepted", "rejected", "reverted"],
  })
    .notNull()
    .default("proposed"),
  modelRunId: integer("model_run_id"),
  createdAt: integer("created_at").notNull().default(now),
  decidedAt: integer("decided_at"),
});
