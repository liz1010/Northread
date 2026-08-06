import { FEEDBACK_KINDS } from "../../../lib/feedback.ts";
import { getLibrary } from "../../../lib/queries.ts";
import { originalUrl } from "../../../lib/urls.ts";

export const dynamic = "force-dynamic";

const LABEL = Object.fromEntries(FEEDBACK_KINDS.map((f) => [f.kind, f.label]));
const STATE: Record<string, string> = {
  new: "未读",
  reading: "在读",
  read: "已读",
  later: "稍后",
  skipped: "已忽略",
  abandoned: "放弃了",
};

export default async function Library() {
  const rows = await getLibrary();

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-3xl font-semibold tracking-tight">资料库</h1>
        <p className="mt-1 text-sm text-ink-500">推荐过的内容，以及当时的理由和你的反馈</p>
      </header>

      {rows.length === 0 ? (
        <div className="rounded-xl border border-dashed border-ink-200 p-8 text-center text-sm text-ink-500">
          还没有推荐记录。
        </div>
      ) : (
        <ul className="space-y-3">
          {rows.map((r) => (
            <li key={r.recId} className="rounded-xl border border-ink-200 bg-surface p-4">
              <div className="flex flex-wrap items-center gap-2 text-xs">
                <span className="text-ink-300 tabular-nums">{r.date}</span>
                <span className="rounded-full bg-pine-100 px-2 py-0.5 text-pine-700">
                  {r.goalTitle}
                </span>
                <span className="text-ink-500">{r.sourceName ?? "手动添加"}</span>
                <span
                  className={`ml-auto ${r.state === "abandoned" ? "text-clay-700" : "text-ink-300"}`}
                >
                  {STATE[r.state] ?? r.state}
                </span>
              </div>

              <h3 className="mt-2 font-serif leading-snug font-semibold">
                <a href={originalUrl(r.url)} target="_blank" rel="noreferrer" className="hover:underline">
                  {r.title}
                </a>
              </h3>

              {r.reason && (
                <p className="mt-1 text-xs leading-relaxed text-ink-500">当时的理由：{r.reason}</p>
              )}

              {r.feedback.length > 0 && (
                <div className="mt-2 flex flex-wrap gap-1.5">
                  {r.feedback.map((k) => (
                    <span
                      key={k}
                      className="rounded-full border border-ink-200 px-2 py-0.5 text-[11px] text-ink-500"
                    >
                      {LABEL[k] ?? k}
                    </span>
                  ))}
                </div>
              )}
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
