import AsyncStorage from "@react-native-async-storage/async-storage";
import * as SecureStore from "expo-secure-store";

import { DEFAULT_SYSTEM_PROMPT } from "../constants";
import { isDefaultPrompt, promptFor, type UiLang } from "../i18n";
import { detectProvider, type ProviderId } from "./provider";

const PREFS_KEY = "onsight.prefs.v1";
const API_KEY_STORE = "onsight.apiKey";
const ONBOARDED_KEY = "onsight.onboarded.v1";

export type TalkMode = "auto" | "ptt";
export type AnswerMode = "fast" | "think";

export type Prefs = {
  showText: boolean;
  enableTts: boolean;
  ttsRate: number;
  mode: TalkMode;
  answerMode: AnswerMode;
  cameraRotate: 0 | 90 | 180 | 270;
  systemPrompt: string;
  provider: ProviderId;
  providerLocked: boolean;
  speechLang: "zh-CN" | "en-US";
  cameraFacing: "back" | "front";
  uiLang: UiLang;
};

export const DEFAULT_PREFS: Prefs = {
  showText: true,
  enableTts: true,
  ttsRate: 1.2,
  mode: "auto",
  answerMode: "fast",
  cameraRotate: 0,
  systemPrompt: DEFAULT_SYSTEM_PROMPT,
  provider: "deepseek",
  providerLocked: false,
  speechLang: "en-US",
  cameraFacing: "back",
  uiLang: "en",
};

function clampRate(value: unknown): number {
  const rate = Number(value);
  if (!Number.isFinite(rate)) return 1.2;
  return Math.min(1.6, Math.max(0.6, rate));
}

export async function loadApiKey(): Promise<string> {
  try {
    return (await SecureStore.getItemAsync(API_KEY_STORE)) || "";
  } catch {
    return "";
  }
}

export async function saveApiKey(key: string): Promise<void> {
  const value = key.trim();
  if (!value) {
    await SecureStore.deleteItemAsync(API_KEY_STORE);
    return;
  }
  await SecureStore.setItemAsync(API_KEY_STORE, value);
}

export async function loadPrefs(): Promise<Prefs> {
  try {
    const raw = await AsyncStorage.getItem(PREFS_KEY);
    if (!raw) return { ...DEFAULT_PREFS };
    const parsed = JSON.parse(raw) as Partial<Prefs>;
    const provider =
      parsed.provider === "openai" || parsed.provider === "deepseek"
        ? parsed.provider
        : "deepseek";
    const hasUiLang = parsed.uiLang === "zh" || parsed.uiLang === "en";
    const uiLang: UiLang = parsed.uiLang === "zh" ? "zh" : "en";
    let systemPrompt = String(parsed.systemPrompt || promptFor(uiLang));
    if (isDefaultPrompt(systemPrompt)) {
      systemPrompt = promptFor(uiLang);
    }
    return {
      ...DEFAULT_PREFS,
      ...parsed,
      ttsRate: clampRate(parsed.ttsRate),
      mode: parsed.mode === "ptt" ? "ptt" : "auto",
      answerMode: parsed.answerMode === "think" ? "think" : "fast",
      cameraRotate: [0, 90, 180, 270].includes(Number(parsed.cameraRotate))
        ? (Number(parsed.cameraRotate) as Prefs["cameraRotate"])
        : 0,
      systemPrompt,
      provider,
      providerLocked: Boolean(parsed.providerLocked),
      speechLang: hasUiLang
        ? parsed.speechLang === "zh-CN"
          ? "zh-CN"
          : "en-US"
        : DEFAULT_PREFS.speechLang,
      cameraFacing: parsed.cameraFacing === "front" ? "front" : "back",
      uiLang,
    };
  } catch {
    return { ...DEFAULT_PREFS };
  }
}

export async function savePrefs(prefs: Prefs): Promise<void> {
  await AsyncStorage.setItem(PREFS_KEY, JSON.stringify(prefs));
}

export async function loadOnboarded(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(ONBOARDED_KEY)) === "1";
  } catch {
    return false;
  }
}

export async function saveOnboarded(): Promise<void> {
  await AsyncStorage.setItem(ONBOARDED_KEY, "1");
}

export function applyKeyToPrefs(prefs: Prefs, apiKey: string): Prefs {
  if (!apiKey.trim()) return prefs;
  if (prefs.providerLocked) return prefs;
  return { ...prefs, provider: detectProvider(apiKey) };
}

export function maskKey(key: string): string {
  const value = key.trim();
  if (!value) return "";
  if (value.length <= 8) return "";
  return `${value.slice(0, 4)}…${value.slice(-4)}`;
}
