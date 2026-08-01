/**
 * 反馈选项。来自产品愿景 §6——不能只有赞和踩。
 *
 * 单独放在这里而不是 actions.ts：带 "use server" 的文件只能导出异步函数，
 * 导出常量会让整个模块在构建时报错。
 */
export const FEEDBACK_KINDS = [
  { kind: "helped_goal", label: "对目标有帮助" },
  { kind: "led_to_action", label: "产生了行动" },
  { kind: "changed_my_mind", label: "改变了我的判断" },
  { kind: "worth_rereading", label: "值得反复读" },
  { kind: "already_knew", label: "已经知道了" },
  { kind: "too_shallow", label: "太浅或太难" },
  { kind: "not_now", label: "现在不需要" },
  { kind: "unreliable_source", label: "信源不可靠" },
  { kind: "abandoned", label: "读不下去，放弃了" },
] as const;

export type FeedbackKind = (typeof FEEDBACK_KINDS)[number]["kind"];
