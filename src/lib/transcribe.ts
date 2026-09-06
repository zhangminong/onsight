export async function transcribeWithOpenAI(options: {
  apiKey: string;
  fileUri: string;
  language: "zh" | "en";
}): Promise<string> {
  const form = new FormData();
  form.append("model", "whisper-1");
  form.append("language", options.language === "en" ? "en" : "zh");
  form.append("file", {
    uri: options.fileUri,
    name: "speech.m4a",
    type: "audio/m4a",
  } as unknown as Blob);

  const response = await fetch("https://api.openai.com/v1/audio/transcriptions", {
    method: "POST",
    headers: { Authorization: `Bearer ${options.apiKey.trim()}` },
    body: form,
  });
  const raw = await response.text();
  if (!response.ok) {
    throw new Error("transcribeFailed");
  }
  const parsed = JSON.parse(raw) as { text?: string };
  return String(parsed.text || "").trim();
}
