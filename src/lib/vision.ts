import { HISTORY_LIMIT, MAX_VALID_SHOTS } from "../constants";
import { t, type UiLang } from "../i18n";
import { modelFor, PROVIDERS, type AnswerMode, type ProviderId } from "./provider";
import { forDisplay } from "./ttsClean";

export type ChatTurn = {
  id: string;
  role: "user" | "assistant";
  content: string;
  imageUri?: string;
  imageUris?: string[];
  thinking?: string;
};

export type StreamEvent =
  | { type: "think"; text: string }
  | { type: "token"; text: string }
  | { type: "done"; text: string };

type ChatMessage = {
  role: "system" | "user" | "assistant";
  content: string | Array<Record<string, unknown>>;
};

function textHistory(turns: ChatTurn[]): ChatMessage[] {
  const cleaned: ChatMessage[] = [];
  for (const turn of turns.slice(-HISTORY_LIMIT)) {
    const content = turn.content.trim();
    if ((turn.role === "user" || turn.role === "assistant") && content) {
      cleaned.push({ role: turn.role, content });
    }
  }
  return cleaned;
}

function parseSseBuffer(
  buffer: string,
  onEvent: (payload: Record<string, unknown>) => void,
): string {
  const parts = buffer.split("\n\n");
  const rest = parts.pop() ?? "";
  for (const block of parts) {
    for (const line of block.split("\n")) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (!data || data === "[DONE]") continue;
      try {
        onEvent(JSON.parse(data) as Record<string, unknown>);
      } catch {
        /* ignore partial JSON */
      }
    }
  }
  return rest;
}

function deltaFromChunk(chunk: Record<string, unknown>): {
  think: string;
  token: string;
} {
  const choices = chunk.choices as Array<Record<string, unknown>> | undefined;
  const choice = choices?.[0];
  const delta = (choice?.delta || {}) as Record<string, unknown>;
  const extra = (delta.model_extra || {}) as Record<string, unknown>;
  const message = (choice?.message || {}) as Record<string, unknown>;
  const think = String(
    delta.reasoning_content ||
      extra.reasoning_content ||
      delta.reasoning ||
      extra.reasoning ||
      message.reasoning_content ||
      "",
  );
  const token = String(delta.content || message.content || "");
  return { think, token };
}

async function readXhrStream(
  url: string,
  headers: Record<string, string>,
  body: string,
  signal: AbortSignal,
  onChunk: (payload: Record<string, unknown>) => void,
): Promise<void> {
  await new Promise<void>((resolve, reject) => {
    const xhr = new XMLHttpRequest();
    xhr.open("POST", url);
    Object.entries(headers).forEach(([key, value]) => xhr.setRequestHeader(key, value));
    xhr.responseType = "text";
    let seen = 0;
    let buffer = "";

    const flush = (done: boolean) => {
      const incoming = String(xhr.responseText || "").slice(seen);
      seen = String(xhr.responseText || "").length;
      if (!incoming && !done) return;
      buffer = parseSseBuffer(buffer + incoming + (done ? "\n\n" : ""), onChunk);
    };

    xhr.onprogress = () => flush(false);
    xhr.onerror = () => reject(new Error("networkFailed"));
    xhr.onabort = () => {
      const error = new Error("Aborted");
      error.name = "AbortError";
      reject(error);
    };
    xhr.onload = () => {
      flush(true);
      if (xhr.status >= 400) {
        reject(new Error(errorMessage(xhr.status, xhr.responseText)));
        return;
      }
      resolve();
    };
    signal.addEventListener("abort", () => xhr.abort());
    xhr.send(body);
  });
}

function errorMessage(status: number, raw: string): string {
  if (status === 401) return "invalidKey";
  if (status === 402) return "noCredit";
  if (status === 429) return "rateLimited";
  let detail = "";
  try {
    const parsed = JSON.parse(raw) as { error?: { message?: string } };
    detail = parsed.error?.message || "";
  } catch {
    detail = raw.slice(0, 180);
  }
  return detail || `modelFailed:${status}`;
}

export async function streamVisionReply(options: {
  apiKey: string;
  provider: ProviderId;
  answerMode: AnswerMode;
  systemPrompt: string;
  history: ChatTurn[];
  userText: string;
  imageBase64: string | string[];
  signal: AbortSignal;
  onEvent: (event: StreamEvent) => void;
  uiLang?: UiLang;
}): Promise<string> {
  const {
    apiKey,
    provider,
    answerMode,
    systemPrompt,
    history,
    userText,
    imageBase64,
    signal,
    onEvent,
    uiLang,
  } = options;
  const c = t(uiLang);
  const config = PROVIDERS[provider];
  const thinking = answerMode === "think";
  const jpegs = (Array.isArray(imageBase64) ? imageBase64 : [imageBase64])
    .map((item) => item.replace(/^data:image\/\w+;base64,/, ""))
    .filter(Boolean)
    .slice(0, MAX_VALID_SHOTS);
  let prompt = userText.trim() || c.visionFallback;
  if (jpegs.length > 1) {
    prompt = `${prompt}\n(${c.visionMultiShot})`;
  }
  const detail = thinking ? "high" : "low";
  const messages: ChatMessage[] = [
    { role: "system", content: systemPrompt.trim() || "You are a helpful on-site visual assistant." },
    ...textHistory(history),
    {
      role: "user",
      content: [
        ...jpegs.map((jpeg) => ({
          type: "image_url",
          image_url: {
            url: `data:image/jpeg;base64,${jpeg}`,
            detail,
          },
        })),
        { type: "text", text: prompt },
      ],
    },
  ];

  const payload: Record<string, unknown> = {
    model: modelFor(provider, answerMode),
    messages,
    stream: true,
    max_tokens: thinking ? 8192 : 1024,
  };
  if (provider === "deepseek") {
    payload.thinking = { type: thinking ? "enabled" : "disabled" };
    if (thinking) payload.reasoning_effort = "high";
    else payload.temperature = 0.4;
  } else if (!thinking) {
    payload.temperature = 0.4;
  }

  const parts: string[] = [];
  await readXhrStream(
    config.chatUrl,
    {
      Authorization: `Bearer ${apiKey.trim()}`,
      "Content-Type": "application/json",
    },
    JSON.stringify(payload),
    signal,
    (chunk) => {
      const { think, token } = deltaFromChunk(chunk);
      if (think) onEvent({ type: "think", text: think });
      if (token) {
        parts.push(token);
        onEvent({ type: "token", text: token });
      }
    },
  );
  const text = forDisplay(parts.join(""));
  onEvent({ type: "done", text });
  return text;
}
