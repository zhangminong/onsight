import { useEffect, useRef } from "react";
import { requireOptionalNativeModule } from "expo-modules-core";

import { ASR_HINTS } from "../i18n";
import type { SpeechLang } from "./speech";

type NativeAsr = {
  start: (options: Record<string, unknown>) => void;
  stop: () => void;
  abort: () => void;
  requestPermissionsAsync: () => Promise<{ granted?: boolean }>;
  getPermissionsAsync: () => Promise<{ granted?: boolean }>;
  addListener: (
    event: string,
    listener: (event: Record<string, unknown>) => void,
  ) => { remove: () => void };
};

type AsrHit = { transcript?: string; confidence?: number };

const nativeAsr = requireOptionalNativeModule<NativeAsr>("ExpoSpeechRecognition");

export function isNativeAsrAvailable(): boolean {
  return nativeAsr != null;
}

export async function requestSpeechPermissions(): Promise<boolean> {
  if (!nativeAsr) return false;
  try {
    const result = await nativeAsr.requestPermissionsAsync();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export async function getSpeechPermission(): Promise<boolean> {
  if (!nativeAsr) return false;
  try {
    const result = await nativeAsr.getPermissionsAsync();
    return Boolean(result.granted);
  } catch {
    return false;
  }
}

export function startListening(options: {
  lang: SpeechLang;
  continuous: boolean;
  vad?: boolean;
}): void {
  if (!nativeAsr) return;
  nativeAsr.start({
    lang: options.lang,
    interimResults: true,
    continuous: options.continuous,
    addsPunctuation: true,
    maxAlternatives: 5,
    requiresOnDeviceRecognition: false,
    contextualStrings: ASR_HINTS[options.lang],
    iosTaskHint: "dictation",
    iosVoiceProcessingEnabled: false,
    iosCategory: {
      category: "playAndRecord",
      categoryOptions: ["defaultToSpeaker", "allowBluetooth", "mixWithOthers"],
      mode: "spokenAudio",
    },
    volumeChangeEventOptions: options.vad
      ? { enabled: true, intervalMillis: 80 }
      : undefined,
  });
}

export function stopListening(): void {
  try {
    nativeAsr?.stop();
  } catch {
    /* ignore */
  }
}

export function abortListening(): void {
  try {
    nativeAsr?.abort();
  } catch {
    /* ignore */
  }
}

function asHits(event: Record<string, unknown>): AsrHit[] {
  const results = event.results as AsrHit[] | { [key: string]: AsrHit } | undefined;
  if (Array.isArray(results)) return results;
  if (results && typeof results === "object") {
    return Object.keys(results)
      .sort()
      .map((key) => results[key])
      .filter(Boolean);
  }
  return [];
}

function pickTranscript(event: Record<string, unknown>): string {
  const hits = asHits(event);
  if (!hits.length) return "";
  const isFinal = Boolean(event.isFinal);
  let best = hits[0];
  for (const hit of hits) {
    const text = String(hit?.transcript || "").trim();
    if (!text) continue;
    const conf = Number(hit.confidence);
    const bestConf = Number(best?.confidence);
    if (isFinal && Number.isFinite(conf) && conf > 0 && conf > (Number.isFinite(bestConf) ? bestConf : -1)) {
      best = hit;
      continue;
    }
    if (isFinal && (!Number.isFinite(bestConf) || bestConf <= 0) && text.length > String(best?.transcript || "").trim().length) {
      best = hit;
    }
  }
  return String(best?.transcript || "").trim();
}

export function useAsrEvents(handlers: {
  onPartial: (text: string) => void;
  onFinal: (text: string) => void;
  onEnd: () => void;
  onError: (message: string) => void;
  onSpeechStart?: () => void;
  onVolume?: (value: number) => void;
}): void {
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!nativeAsr) return;
    const resultSub = nativeAsr.addListener("result", (event) => {
      const text = pickTranscript(event);
      if (!text) return;
      if (event.isFinal) handlersRef.current.onFinal(text);
      else handlersRef.current.onPartial(text);
    });
    const startSub = nativeAsr.addListener("speechstart", () => {
      handlersRef.current.onSpeechStart?.();
    });
    const volumeSub = nativeAsr.addListener("volumechange", (event) => {
      const value = Number(event.value);
      if (Number.isFinite(value)) handlersRef.current.onVolume?.(value);
    });
    const endSub = nativeAsr.addListener("end", () => handlersRef.current.onEnd());
    const errorSub = nativeAsr.addListener("error", (event) => {
      const message = String(event.message || event.error || "asrError");
      handlersRef.current.onError(message);
    });
    return () => {
      resultSub.remove();
      startSub.remove();
      volumeSub.remove();
      endSub.remove();
      errorSub.remove();
    };
  }, []);
}
