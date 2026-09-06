export type ProviderId = "deepseek" | "openai";
export type AnswerMode = "fast" | "think";

export type ProviderConfig = {
  id: ProviderId;
  name: string;
  baseUrl: string;
  chatUrl: string;
  keyUrl: string;
  fastModel: string;
  thinkModel: string;
};

export const PROVIDERS: Record<ProviderId, ProviderConfig> = {
  deepseek: {
    id: "deepseek",
    name: "DeepSeek",
    baseUrl: "https://api.deepseek.com",
    chatUrl: "https://api.deepseek.com/chat/completions",
    keyUrl: "https://platform.deepseek.com/api_keys",
    fastModel: "deepseek-v4-flash-vision-exp",
    thinkModel: "deepseek-v4-flash-vision-exp",
  },
  openai: {
    id: "openai",
    name: "OpenAI",
    baseUrl: "https://api.openai.com/v1",
    chatUrl: "https://api.openai.com/v1/chat/completions",
    keyUrl: "https://platform.openai.com/api-keys",
    fastModel: "gpt-4o",
    thinkModel: "gpt-4.1",
  },
};

const OPENAI_PREFIXES = ["sk-proj-", "sk-None-", "sk-svcacct-"];

export function looksLikeApiKey(key: string): boolean {
  const value = key.trim();
  return value.startsWith("sk-") && value.length >= 20;
}

export function detectProvider(key: string): ProviderId {
  const value = key.trim();
  if (OPENAI_PREFIXES.some((prefix) => value.startsWith(prefix))) {
    return "openai";
  }
  return "deepseek";
}

export function modelFor(provider: ProviderId, answerMode: AnswerMode): string {
  const config = PROVIDERS[provider];
  return answerMode === "think" ? config.thinkModel : config.fastModel;
}
