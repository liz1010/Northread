import { ClaudeProvider } from "./claude.ts";
import { MockProvider } from "./mock.ts";
import { OpenAICompatibleProvider } from "./openaiCompatible.ts";
import type { ModelProvider } from "./types.ts";

/**
 * 选实现。优先级：
 *   1. NORTHREAD_USE_MOCK=1        规则打分，不调模型
 *   2. NORTHREAD_API_KEY           OpenAI 兼容（DeepSeek / 百炼 / Ollama / vLLM）
 *   3. ANTHROPIC_API_KEY           Claude
 *   4. 都没有                       退回 Mock 并警告
 *
 * 最后一条很重要：缺 key 时不能在运行时崩掉，否则每天的 cron 会静默失败。
 */
export function getProvider(): ModelProvider {
  if (process.env.NORTHREAD_USE_MOCK === "1") return new MockProvider();
  if (process.env.NORTHREAD_API_KEY) return new OpenAICompatibleProvider();
  if (process.env.ANTHROPIC_API_KEY) return new ClaudeProvider();

  console.warn(
    "⚠ 没有配置任何模型 key（NORTHREAD_API_KEY / ANTHROPIC_API_KEY），" +
      "回退到 Mock —— 推荐只是关键词匹配，不是模型判断。",
  );
  return new MockProvider();
}

export { ClaudeProvider, MockProvider, OpenAICompatibleProvider };
export * from "./types.ts";
