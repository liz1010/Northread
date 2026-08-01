export const dynamic = "force-dynamic";

export default function Review() {
  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">复盘</h1>
        <p className="mt-1 text-sm text-ink-500">每周回答：这一周的阅读到底推动了什么</p>
      </header>

      <div className="rounded-xl border border-dashed border-ink-200 p-6">
        <p className="text-sm text-ink-700">还没做。</p>
        <p className="mt-3 text-xs leading-relaxed text-ink-500">
          复盘要回答三件事：哪些阅读真的推动了目标、哪些信源只贡献了噪声、下周该调整什么。
          这三件事都需要至少一周的真实反馈数据才有意义——现在库里一条反馈都没有，
          现在做出来只会是一个空壳。
        </p>
        <p className="mt-3 text-xs leading-relaxed text-ink-300">
          按实施计划，它属于阶段 5，排在「今日页 + 反馈」跑通之后。
        </p>
      </div>
    </div>
  );
}
