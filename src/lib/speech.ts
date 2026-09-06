import { Platform } from "react-native";
import * as Speech from "expo-speech";
import { VoiceQuality, type Voice } from "expo-speech";

import { forSpeech } from "./ttsClean";

export type SpeechLang = "zh-CN" | "en-US";

let speaking = false;
const voiceCache = new Map<SpeechLang, string | undefined>();

export function stopSpeaking(): void {
  speaking = false;
  try {
    void Speech.stop();
  } catch {
    /* ignore */
  }
}

export function isSpeaking(): boolean {
  return speaking;
}

function langMatches(voice: Voice, lang: SpeechLang): boolean {
  const code = voice.language.replace("_", "-").toLowerCase();
  return lang === "en-US" ? code.startsWith("en") : code.startsWith("zh");
}

function voiceScore(voice: Voice): number {
  const blob = `${voice.identifier} ${voice.name}`.toLowerCase();
  let score = voice.quality === VoiceQuality.Enhanced ? 80 : 10;
  if (blob.includes("premium") || blob.includes("neural") || blob.includes("siri")) score += 40;
  if (blob.includes("enhanced")) score += 20;
  if (blob.includes("compact") || blob.includes("default")) score -= 15;
  if (/tingting|ting-ting|meijia|sinji|yu-shu|li-mu|nana/.test(blob)) score += 8;
  return score;
}

export function warmupVoices(): void {
  void voiceFor("zh-CN");
  void voiceFor("en-US");
}

async function voiceFor(lang: SpeechLang): Promise<string | undefined> {
  if (voiceCache.has(lang)) return voiceCache.get(lang);
  try {
    const voices = await Speech.getAvailableVoicesAsync();
    const matched = voices.filter((voice) => langMatches(voice, lang));
    const pool = matched.length ? matched : voices;
    pool.sort((a, b) => voiceScore(b) - voiceScore(a));
    const id = pool[0]?.identifier;
    voiceCache.set(lang, id);
    return id;
  } catch {
    voiceCache.set(lang, undefined);
    return undefined;
  }
}

export async function speakText(
  text: string,
  options: { rate: number; lang: SpeechLang; onDone?: () => void },
): Promise<void> {
  const cleaned = forSpeech(text);
  if (!cleaned) {
    options.onDone?.();
    return;
  }
  speaking = false;
  try {
    await Speech.stop();
  } catch {
    /* ignore */
  }
  speaking = true;
  const rate = Math.min(1.6, Math.max(0.6, options.rate));
  const voice = await voiceFor(options.lang);
  const maxMs = Math.min(120_000, 1_200 + cleaned.length * 160);
  await new Promise<void>((resolve) => {
    let settled = false;
    const finish = () => {
      if (settled) return;
      settled = true;
      speaking = false;
      options.onDone?.();
      resolve();
    };
    const timer = setTimeout(finish, maxMs);
    Speech.speak(cleaned, {
      language: options.lang,
      voice,
      rate,
      pitch: 0.97,
      volume: 1,
      useApplicationAudioSession: Platform.OS !== "ios",
      onDone: () => {
        clearTimeout(timer);
        finish();
      },
      onStopped: () => {
        clearTimeout(timer);
        speaking = false;
        resolve();
      },
      onError: () => {
        clearTimeout(timer);
        speaking = false;
        resolve();
      },
    });
  });
}
