import { ClaudeProvider } from "./claude.ts";
import { MockProvider } from "./mock.ts";
import type { ModelProvider } from "./types.ts";

/**
 * 选实现。没有 API key 时自动退回 Mock，而不是在运行时崩掉——
 * 这样界面和管线随时能跑，接不接模型是独立的一件事。
 */
export function getProvider(): ModelProvider {
  if (process.env.NORTHREAD_USE_MOCK === "1") return new MockProvider();
  if (!process.env.ANTHROPIC_API_KEY) {
    console.warn("⚠ 未设置 ANTHROPIC_API_KEY，回退到 Mock（规则打分，不调模型）");
    return new MockProvider();
  }
  return new ClaudeProvider();
}

export { ClaudeProvider, MockProvider };
export * from "./types.ts";
