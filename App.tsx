import { useCallback, useEffect, useRef, useState } from "react";
import {
  ActivityIndicator,
  Alert,
  AppState,
  Image,
  KeyboardAvoidingView,
  Linking,
  PanResponder,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
} from "react-native";
import { StatusBar } from "expo-status-bar";
import { CameraView, useCameraPermissions } from "expo-camera";
import { activateKeepAwakeAsync, deactivateKeepAwake } from "expo-keep-awake";
import * as Application from "expo-application";
import { SafeAreaProvider, SafeAreaView } from "react-native-safe-area-context";

import { LegalModal, type LegalKind } from "./src/components/LegalModal";
import { OnboardingModal } from "./src/components/OnboardingModal";
import { SettingsModal } from "./src/components/SettingsModal";
import { APP_NAME, MAX_IMAGE_QUALITY, MAX_VALID_SHOTS, THINK_SHOT_INTERVAL_MS } from "./src/constants";
import { statusLabel, t } from "./src/i18n";
import {
  abortListening,
  getSpeechPermission,
  isNativeAsrAvailable,
  requestSpeechPermissions,
  startListening,
  stopListening,
  useAsrEvents,
} from "./src/lib/asr";
import { isLikelyBlurry } from "./src/lib/blur";
import { tapLight, tapMedium } from "./src/lib/haptics";
import { detectProvider, looksLikeApiKey } from "./src/lib/provider";
import { getMetering, isSpeakerPlayback, preparePlayback, requestMicPermission, startMetering, startRecording, stopRecording } from "./src/lib/recordVoice";
import {
  applyKeyToPrefs,
  loadApiKey,
  loadOnboarded,
  loadPrefs,
  saveApiKey,
  saveOnboarded,
  savePrefs,
  type Prefs,
} from "./src/lib/settings";
import { isSpeaking, speakText, stopSpeaking, warmupVoices } from "./src/lib/speech";
import { transcribeWithOpenAI } from "./src/lib/transcribe";
import { forDisplay } from "./src/lib/ttsClean";
import { streamVisionReply, type ChatTurn } from "./src/lib/vision";
import { colors } from "./src/theme";

type FlagKind = "ok" | "warn" | "off";

const VAD_TICK_MS = 80;
const VAD_START_DB = -28;
const VAD_HOLD_DB = -34;
const VAD_MIN_PEAK_DB = -25;
const VAD_START_FRAMES = 3;
const VAD_MIN_SPEECH_FRAMES = 6;
const VAD_END_FRAMES = 19;
/** expo-speech-recognition iOS volume is scaled about -2..10 */
const ASR_VAD_START = 3.2;
const ASR_VAD_HOLD = 2.4;
const ASR_VAD_MIN_PEAK = 4.0;
const ASR_VAD_BARGE_FRAMES = 5;
const ASR_END_SILENCE_MS = 1500;
const VAD_BARGE_DB = -12;
const VAD_BARGE_HOLD_DB = -18;

/** φ ≈ 1.618；主画面约占整屏 0.618（约五分之三）。 */
const PHI = (1 + Math.sqrt(5)) / 2;
const PHI_INV = 1 / PHI;
const PREVIEW_SHARE_MIN = 0.5;
const PREVIEW_SHARE_MAX = PHI_INV + (1 - PHI_INV) ** 2;

function clamp(value: number, lo: number, hi: number) {
  return Math.min(hi, Math.max(lo, value));
}

function touchSpan(touches: readonly { pageX: number; pageY: number }[]) {
  if (touches.length < 2) return 0;
  return Math.hypot(touches[0].pageX - touches[1].pageX, touches[0].pageY - touches[1].pageY);
}

function emptyVad() {
  return { heard: false, loud: 0, quiet: 0, speech: 0, peak: -160, snapped: false };
}

function looksLikeSpeech(text: string): boolean {
  const trimmed = text.trim();
  if (trimmed.length < 2) return false;
  if (/^(uh+|um+|mm+|ah+|嗯+|啊+|呃+|哦+|唔+|哈+|嘿+)$/i.test(trimmed)) return false;
  return true;
}

function isStopOnly(text: string): boolean {
  const t = text
    .trim()
    .replace(/[\s，。！？、,.!?；;：:“”‘’"'~…]+/g, "")
    .toLowerCase();
  if (!t) return false;
  if (/^(停){1,8}$/.test(t)) return true;
  if (/^(stop){1,4}$/.test(t)) return true;
  return /^(停下|停止|停一下|停一停|先停|你停|别说了|别讲了|闭嘴|不要说了)$/.test(t);
}

type Shot = { base64: string; uri: string };

function nextId(): string {
  return `${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

export default function App() {
  const cameraRef = useRef<CameraView>(null);
  const chatRef = useRef<ScrollView>(null);
  const { height } = useWindowDimensions();
  const [permission, requestPermission] = useCameraPermissions();
  const [prefs, setPrefs] = useState<Prefs | null>(null);
  const [apiKey, setApiKey] = useState("");
  const [draftKey, setDraftKey] = useState("");
  const [featureOn, setFeatureOn] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState("idle");
  const [partial, setPartial] = useState("");
  const [turns, setTurns] = useState<ChatTurn[]>([]);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [legalKind, setLegalKind] = useState<LegalKind>("privacy");
  const [legalOpen, setLegalOpen] = useState(false);
  const [onboarded, setOnboarded] = useState<boolean | null>(null);
  const [speechReady, setSpeechReady] = useState(false);
  const [micReady, setMicReady] = useState(false);
  const [listening, setListening] = useState(false);
  const [holdMute, setHoldMute] = useState(false);
  const [pttDown, setPttDown] = useState(false);
  const [cameraReady, setCameraReady] = useState(false);
  const [ttsPlaying, setTtsPlaying] = useState(false);
  const [moreOpen, setMoreOpen] = useState(false);
  const [zoom, setZoom] = useState(0);
  const [previewShare, setPreviewShare] = useState(PHI_INV);
  const [bodyH, setBodyH] = useState(0);
  const [focusMode, setFocusMode] = useState<"on" | "off">("off");
  const [focusRing, setFocusRing] = useState<{ x: number; y: number; key: number } | null>(null);

  const prefsRef = useRef(prefs);
  const apiKeyRef = useRef(apiKey);
  const featureRef = useRef(featureOn);
  const holdMuteRef = useRef(holdMute);
  const pttDownRef = useRef(pttDown);
  const turnsRef = useRef(turns);
  const abortRef = useRef<AbortController | null>(null);
  const askGen = useRef(0);
  const sendingRef = useRef(false);
  const busyRef = useRef(false);
  const ttsRef = useRef(false);
  const ignoreMicUntilRef = useRef(0);
  const resumeTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const asrEndTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const shotIntervalRef = useRef<ReturnType<typeof setInterval> | null>(null);
  const lastShotAtRef = useRef(0);
  const haltCaptureRef = useRef(false);
  const shotsArmedRef = useRef(false);
  const resumeListenRef = useRef<() => void>(() => {});
  const maybeListenRef = useRef<() => void>(() => {});
  const pendingFramesRef = useRef<Shot[]>([]);
  const snappingRef = useRef(false);
  const asrSnapRef = useRef(false);
  const asrStoppingRef = useRef(false);
  const lastAsrTextRef = useRef("");
  const ttsBaselineRef = useRef(-40);
  const listeningRef = useRef(false);
  const vadRef = useRef(emptyVad());
  const zoomRef = useRef(0);
  const previewShareRef = useRef(PHI_INV);
  const bodyHRef = useRef(0);
  const sizedByUser = useRef(false);
  const shareInited = useRef(false);
  const pinchStartDist = useRef(0);
  const pinchBaseZoom = useRef(0);
  const dragStartShare = useRef(PHI_INV);
  const tapStart = useRef({ x: 0, y: 0, t: 0, fingers: 0 });
  const focusAtRef = useRef<(x: number, y: number) => void>(() => {});
  const ringTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lockTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const speakerMuteTtsRef = useRef(false);
  const speakerNoBargeRef = useRef(false);
  const speakerDecidedRef = useRef(false);
  const speakerAlertOpenRef = useRef(false);

  zoomRef.current = zoom;
  previewShareRef.current = previewShare;
  bodyHRef.current = bodyH;

  focusAtRef.current = (x, y) => {
    const key = Date.now();
    setFocusRing({ x, y, key });
    setFocusMode("off");
    tapLight();
    if (ringTimerRef.current) clearTimeout(ringTimerRef.current);
    if (lockTimerRef.current) clearTimeout(lockTimerRef.current);
    ringTimerRef.current = setTimeout(() => {
      setFocusRing((ring) => (ring?.key === key ? null : ring));
    }, 120);
    lockTimerRef.current = setTimeout(() => {
      setFocusMode("on");
      lockTimerRef.current = setTimeout(() => setFocusMode("off"), 1000);
    }, 40);
  };

  const pinchResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: (event, gesture) =>
        event.nativeEvent.touches.length >= 2 || Math.hypot(gesture.dx, gesture.dy) > 6,
      onPanResponderGrant: (event) => {
        const fingers = event.nativeEvent.touches.length;
        tapStart.current = {
          x: event.nativeEvent.locationX,
          y: event.nativeEvent.locationY,
          t: Date.now(),
          fingers,
        };
        if (fingers >= 2) {
          pinchStartDist.current = touchSpan(event.nativeEvent.touches);
          pinchBaseZoom.current = zoomRef.current;
        }
      },
      onPanResponderMove: (event) => {
        const dist = touchSpan(event.nativeEvent.touches);
        if (event.nativeEvent.touches.length < 2 || pinchStartDist.current < 8 || dist < 8) return;
        tapStart.current.fingers = 2;
        const next = clamp(pinchBaseZoom.current + (dist / pinchStartDist.current - 1) * 0.55, 0, 1);
        zoomRef.current = next;
        setZoom(next);
      },
      onPanResponderRelease: (_event, gesture) => {
        if (tapStart.current.fingers !== 1) return;
        if (Math.hypot(gesture.dx, gesture.dy) > 14) return;
        if (Date.now() - tapStart.current.t > 320) return;
        focusAtRef.current(tapStart.current.x, tapStart.current.y);
      },
    }),
  ).current;

  const resizeResponder = useRef(
    PanResponder.create({
      onStartShouldSetPanResponder: () => true,
      onMoveShouldSetPanResponder: () => true,
      onPanResponderGrant: () => {
        sizedByUser.current = true;
        dragStartShare.current = previewShareRef.current;
      },
      onPanResponderMove: (_event, gesture) => {
        const heightPx = bodyHRef.current;
        if (!heightPx) return;
        setPreviewShare(clamp(dragStartShare.current + gesture.dy / heightPx, PREVIEW_SHARE_MIN, PREVIEW_SHARE_MAX));
      },
    }),
  ).current;

  prefsRef.current = prefs;
  apiKeyRef.current = apiKey;
  featureRef.current = featureOn;
  holdMuteRef.current = holdMute;
  pttDownRef.current = pttDown;
  turnsRef.current = turns;

  const nativeAsr = isNativeAsrAvailable();
  const useMicListen = Boolean(!nativeAsr);

  useEffect(() => {
    void (async () => {
      const [storedPrefs, storedKey, seenOnboarding] = await Promise.all([
        loadPrefs(),
        loadApiKey(),
        loadOnboarded(),
      ]);
      setPrefs(applyKeyToPrefs(storedPrefs, storedKey));
      setApiKey(storedKey);
      setOnboarded(seenOnboarding);
      if (seenOnboarding && !storedKey) setSettingsOpen(true);
      warmupVoices();
    })();
  }, []);

  useEffect(() => {
    if (!onboarded) return;
    if (!permission?.granted) void requestPermission();
  }, [onboarded, permission, requestPermission]);

  useEffect(() => {
    if (!onboarded) return;
    void (async () => {
      setSpeechReady((await getSpeechPermission()) || (await requestSpeechPermissions()));
      setMicReady(await requestMicPermission());
    })();
  }, [onboarded]);

  useEffect(() => {
    if (featureOn) void activateKeepAwakeAsync();
    else void deactivateKeepAwake();
  }, [featureOn]);

  useEffect(() => {
    if (!prefs) return;
    const on = Boolean(onboarded && apiKey.trim());
    setFeatureOn(on);
    if (!on) {
      abortListening();
      void stopRecording();
      setListening(false);
      setStatus("needsSetup");
    }
  }, [apiKey, onboarded, prefs]);

  useEffect(() => {
    const sub = AppState.addEventListener("change", (next) => {
      if (next !== "active") {
        abortListening();
        void stopRecording();
        stopSpeaking();
        setListening(false);
        setTtsPlaying(false);
        ttsRef.current = false;
      } else if (featureRef.current && !holdMuteRef.current) {
        ignoreMicUntilRef.current = 0;
        maybeListenRef.current();
      }
    });
    return () => sub.remove();
  }, []);

  useEffect(() => {
    return () => {
      if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
      if (asrEndTimerRef.current) clearTimeout(asrEndTimerRef.current);
      if (shotIntervalRef.current) clearInterval(shotIntervalRef.current);
    };
  }, []);

  const persistPrefs = useCallback(async (next: Prefs) => {
    prefsRef.current = next;
    setPrefs(next);
    await savePrefs(next);
  }, []);

  const interruptTurn = useCallback(() => {
    askGen.current += 1;
    abortRef.current?.abort();
    abortRef.current = null;
    ttsRef.current = false;
    sendingRef.current = false;
    busyRef.current = false;
    haltCaptureRef.current = true;
    shotsArmedRef.current = false;
    if (shotIntervalRef.current) {
      clearInterval(shotIntervalRef.current);
      shotIntervalRef.current = null;
    }
    pendingFramesRef.current = [];
    stopSpeaking();
    setTtsPlaying(false);
    setBusy(false);
  }, []);

  const captureFrame = useCallback(async (): Promise<Shot | null> => {
    try {
      const photo = await cameraRef.current?.takePictureAsync({
        quality: MAX_IMAGE_QUALITY,
        base64: true,
        skipProcessing: true,
        shutterSound: false,
      });
      if (!photo?.base64) return null;
      return { base64: photo.base64, uri: photo.uri };
    } catch {
      return null;
    }
  }, []);

  const stopShotInterval = useCallback(() => {
    if (shotIntervalRef.current) {
      clearInterval(shotIntervalRef.current);
      shotIntervalRef.current = null;
    }
  }, []);

  const shotCap = useCallback(() => {
    const current = prefsRef.current;
    if (current?.mode === "ptt" && current.answerMode === "think") return 2;
    return MAX_VALID_SHOTS;
  }, []);

  const pushFrame = useCallback(async () => {
    if (haltCaptureRef.current) return;
    for (let i = 0; i < 40 && snappingRef.current; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    if (haltCaptureRef.current) return;
    snappingRef.current = true;
    try {
      const frame = await captureFrame();
      if (haltCaptureRef.current || !frame) return;
      if (isLikelyBlurry(frame.base64)) return;
      const prev = pendingFramesRef.current[pendingFramesRef.current.length - 1];
      if (prev && prev.base64 === frame.base64) return;
      lastShotAtRef.current = Date.now();
      const cap = shotCap();
      if (pendingFramesRef.current.length >= cap) {
        pendingFramesRef.current = [...pendingFramesRef.current.slice(0, cap - 1), frame];
        stopShotInterval();
        return;
      }
      pendingFramesRef.current = [...pendingFramesRef.current, frame];
      if (pendingFramesRef.current.length >= cap) stopShotInterval();
    } finally {
      snappingRef.current = false;
    }
  }, [captureFrame, shotCap, stopShotInterval]);

  const haltShots = useCallback(() => {
    haltCaptureRef.current = true;
    shotsArmedRef.current = false;
    stopShotInterval();
    pendingFramesRef.current = [];
  }, [stopShotInterval]);

  const ensureShots = useCallback(() => {
    if (shotsArmedRef.current) return;
    haltCaptureRef.current = false;
    shotsArmedRef.current = true;
    pendingFramesRef.current = [];
    lastShotAtRef.current = 0;
    stopShotInterval();
    void pushFrame();
    if (prefsRef.current?.answerMode === "think") {
      shotIntervalRef.current = setInterval(() => {
        if (haltCaptureRef.current) return;
        void pushFrame();
      }, THINK_SHOT_INTERVAL_MS);
    }
  }, [pushFrame, stopShotInterval]);

  const takeEndFrames = useCallback(async (): Promise<Shot[]> => {
    stopShotInterval();
    if (!haltCaptureRef.current && shotsArmedRef.current) {
      if (!pendingFramesRef.current.length || Date.now() - lastShotAtRef.current >= THINK_SHOT_INTERVAL_MS) {
        await pushFrame();
      }
    }
    for (let i = 0; i < 40 && snappingRef.current; i += 1) {
      await new Promise((resolve) => setTimeout(resolve, 25));
    }
    const cap = shotCap();
    const shots = pendingFramesRef.current.filter((shot) => !isLikelyBlurry(shot.base64)).slice(0, cap);
    pendingFramesRef.current = [];
    shotsArmedRef.current = false;
    return shots;
  }, [pushFrame, shotCap, stopShotInterval]);

  const askModel = useCallback(
    async (userText: string, frame?: Shot | Shot[] | null) => {
      const currentPrefs = prefsRef.current;
      const key = apiKeyRef.current.trim();
      if (!currentPrefs || !key) return;
      interruptTurn();
      sendingRef.current = true;
      busyRef.current = true;
      abortListening();
      void stopRecording();
      listeningRef.current = false;
      setListening(false);
      const myGen = askGen.current;
      const given = Array.isArray(frame) ? frame : frame ? [frame] : [];
      let shots = (given.length ? given : pendingFramesRef.current).slice(0, MAX_VALID_SHOTS);
      pendingFramesRef.current = [];
      shots = shots.filter((shot) => !isLikelyBlurry(shot.base64));
      if (currentPrefs.answerMode === "fast") shots = shots.slice(0, 1);
      else if (currentPrefs.mode === "ptt") shots = shots.slice(0, 2);
      if (!shots.length) {
        const one = await captureFrame();
        if (one && !isLikelyBlurry(one.base64)) shots = [one];
      }
      if (!shots.length) {
        sendingRef.current = false;
        busyRef.current = false;
        setStatus("tooBlurry");
        resumeListenRef.current();
        return;
      }
      haltCaptureRef.current = true;
      stopShotInterval();
      if (!speakerNoBargeRef.current && !speakerMuteTtsRef.current) {
        void startMetering().catch(() => {});
      }
      const userTurn: ChatTurn = {
        id: nextId(),
        role: "user",
        content: userText.trim() || t(currentPrefs.uiLang).lookingAtScene,
        imageUri: shots[0]?.uri,
        imageUris: shots.map((item) => item.uri),
      };
      const assistantTurn: ChatTurn = { id: nextId(), role: "assistant", content: "", thinking: "" };
      setTurns((prev) => [...prev, userTurn, assistantTurn]);
      setBusy(true);
      setStatus(currentPrefs.answerMode === "think" ? "thinking" : "answering");
      const controller = new AbortController();
      abortRef.current = controller;
      let rawReply = "";
      try {
        const reply = await streamVisionReply({
          apiKey: key,
          provider: currentPrefs.provider,
          answerMode: currentPrefs.answerMode,
          systemPrompt: currentPrefs.systemPrompt,
          history: turnsRef.current.filter((turn) => turn.id !== assistantTurn.id),
          userText,
          imageBase64: shots.map((item) => item.base64),
          signal: controller.signal,
          uiLang: currentPrefs.uiLang,
          onEvent: (event) => {
            if (myGen !== askGen.current) return;
            if (event.type === "think") {
              setTurns((prev) =>
                prev.map((turn) =>
                  turn.id === assistantTurn.id
                    ? { ...turn, thinking: `${turn.thinking || ""}${event.text}` }
                    : turn,
                ),
              );
            }
            if (event.type === "token") {
              rawReply += event.text;
              const shown = forDisplay(rawReply);
              setTurns((prev) =>
                prev.map((turn) =>
                  turn.id === assistantTurn.id ? { ...turn, content: shown } : turn,
                ),
              );
            }
            if (event.type === "done" && event.text) {
              setTurns((prev) =>
                prev.map((turn) =>
                  turn.id === assistantTurn.id ? { ...turn, content: event.text } : turn,
                ),
              );
            }
          },
        });
        if (myGen !== askGen.current) return;
        if (reply && currentPrefs.enableTts && !speakerMuteTtsRef.current) {
          abortListening();
          listeningRef.current = false;
          setListening(false);
          ttsRef.current = true;
          setTtsPlaying(true);
          setStatus("speaking");
          ttsBaselineRef.current = -40;
          vadRef.current = emptyVad();
          ignoreMicUntilRef.current = Date.now() + 500;
          await preparePlayback(!speakerNoBargeRef.current);
          if (myGen !== askGen.current) return;
          if (!speakerNoBargeRef.current) {
            try {
              await startMetering();
            } catch {
              /* barge-in unavailable; tap-to-interrupt still works */
            }
          }
          if (myGen !== askGen.current) return;
          await speakText(reply, { rate: currentPrefs.ttsRate, lang: currentPrefs.speechLang });
          if (myGen !== askGen.current) return;
          ttsRef.current = false;
          setTtsPlaying(false);
          void stopRecording(true);
          ignoreMicUntilRef.current = Date.now() + (speakerNoBargeRef.current ? 900 : 400);
        }
        if (myGen === askGen.current) setStatus("idle");
      } catch (error) {
        if ((error as { name?: string }).name === "AbortError") return;
        const message = error instanceof Error ? error.message : "requestFailed";
        const shown = statusLabel(t(currentPrefs.uiLang), message);
        setTurns((prev) =>
          prev.map((turn) =>
            turn.id === assistantTurn.id ? { ...turn, content: turn.content || `(${shown})` } : turn,
          ),
        );
        setStatus(message);
      } finally {
        ttsRef.current = false;
        if (myGen === askGen.current) {
          sendingRef.current = false;
          busyRef.current = false;
          setBusy(false);
          if (prefsRef.current?.mode === "auto") resumeListenRef.current();
        }
      }
    },
    [captureFrame, interruptTurn, stopShotInterval],
  );

  const onUtteranceStart = useCallback(
    (capture = true) => {
      if (sendingRef.current || ttsRef.current || isSpeaking() || busyRef.current) {
        interruptTurn();
        setStatus("interruptedListening");
      } else if (capture) {
        setStatus("capturedListening");
      } else {
        setStatus("listening");
      }
      vadRef.current.snapped = true;
      tapLight();
      if (capture) ensureShots();
    },
    [ensureShots, interruptTurn],
  );

  const finishMicClip = useCallback(async () => {
    const shots = await takeEndFrames();
    const current = prefsRef.current;
    if (current?.provider === "openai") {
      setStatus("recognizing");
      const uri = await stopRecording(true);
      listeningRef.current = false;
      setListening(false);
      if (featureRef.current && current.mode === "auto" && !holdMuteRef.current) {
        void startRecording().then(() => {
          listeningRef.current = true;
          setListening(true);
        });
      }
      if (!uri) {
        setStatus("idle");
        resumeListenRef.current();
        return;
      }
      try {
        const text = await transcribeWithOpenAI({
          apiKey: apiKeyRef.current,
          fileUri: uri,
          language: current.speechLang === "en-US" ? "en" : "zh",
        });
        if (text && isStopOnly(text)) {
          haltShots();
          setStatus("stopped");
          resumeListenRef.current();
          return;
        }
        if (text && looksLikeSpeech(text)) await askModel(text, shots);
        else {
          setStatus("noise");
          resumeListenRef.current();
        }
      } catch (error) {
        setStatus(error instanceof Error ? error.message : "asrFailed");
        resumeListenRef.current();
      }
      return;
    }
    await askModel("", shots);
  }, [askModel, haltShots, takeEndFrames]);

  const maybeListen = useCallback(() => {
    const current = prefsRef.current;
    if (!current || !featureRef.current || holdMuteRef.current) return;
    if (sendingRef.current || ttsRef.current || busyRef.current) return;
    if (current.mode === "ptt" && !pttDownRef.current) return;
    if (listeningRef.current) return;
    if (nativeAsr && speechReady) {
      try {
        asrStoppingRef.current = false;
        lastAsrTextRef.current = "";
        asrSnapRef.current = false;
        vadRef.current = emptyVad();
        if (asrEndTimerRef.current) {
          clearTimeout(asrEndTimerRef.current);
          asrEndTimerRef.current = null;
        }
        startListening({
          lang: current.speechLang,
          continuous: current.mode === "auto",
          vad: current.mode === "auto",
        });
        listeningRef.current = true;
        setListening(true);
        if (current.mode === "auto") setStatus("speakToSend");
      } catch {
        listeningRef.current = false;
        setSpeechReady(false);
      }
      return;
    }
    if (micReady) {
      vadRef.current = emptyVad();
      void startRecording()
        .then(() => {
          if (!featureRef.current || holdMuteRef.current) {
            void stopRecording();
            return;
          }
          setListening(true);
          listeningRef.current = true;
          setStatus(current.mode === "auto" ? "speakToSend" : "listening");
        })
        .catch(() => setMicReady(false));
    }
  }, [micReady, nativeAsr, speechReady]);

  const resumeAutoListen = useCallback(() => {
    const delayMs = 700;
    ignoreMicUntilRef.current = Date.now() + delayMs;
    vadRef.current = emptyVad();
    if (resumeTimerRef.current) clearTimeout(resumeTimerRef.current);
    resumeTimerRef.current = setTimeout(() => {
      resumeTimerRef.current = null;
      if (
        featureRef.current &&
        prefsRef.current?.mode === "auto" &&
        !holdMuteRef.current &&
        !sendingRef.current &&
        !ttsRef.current &&
        !busyRef.current
      ) {
        maybeListen();
      }
    }, delayMs);
  }, [maybeListen]);

  resumeListenRef.current = resumeAutoListen;
  maybeListenRef.current = maybeListen;

  const beginAsrUtterance = useCallback(() => {
    if (asrSnapRef.current) return;
    asrSnapRef.current = true;
    onUtteranceStart(false);
  }, [onUtteranceStart]);

  const finishAutoUtterance = useCallback(() => {
    if (asrStoppingRef.current || sendingRef.current || ttsRef.current) return;
    if (prefsRef.current?.mode !== "auto") return;
    asrStoppingRef.current = true;
    if (asrEndTimerRef.current) {
      clearTimeout(asrEndTimerRef.current);
      asrEndTimerRef.current = null;
    }
    setStatus("recognizing");
    stopListening();
  }, []);

  const commitAsrText = useCallback(
    (text: string) => {
      if (sendingRef.current) return;
      if (prefsRef.current?.mode === "ptt") {
        lastAsrTextRef.current = text.trim();
        setPartial(text);
        return;
      }
      setPartial("");
      asrSnapRef.current = false;
      asrStoppingRef.current = false;
      lastAsrTextRef.current = "";
      vadRef.current = emptyVad();
      if (asrEndTimerRef.current) {
        clearTimeout(asrEndTimerRef.current);
        asrEndTimerRef.current = null;
      }
      if (!featureRef.current || holdMuteRef.current) return;
      if (isStopOnly(text)) {
        haltShots();
        setStatus("stopped");
        resumeAutoListen();
        return;
      }
      if (!looksLikeSpeech(text)) {
        pendingFramesRef.current = [];
        stopShotInterval();
        setStatus("noise");
        resumeAutoListen();
        return;
      }
      void takeEndFrames().then((shots) => {
        void askModel(text, shots);
      });
    },
    [askModel, haltShots, resumeAutoListen, stopShotInterval, takeEndFrames],
  );

  useAsrEvents({
    onSpeechStart: () => {
      if (!featureRef.current || holdMuteRef.current) return;
      if (prefsRef.current?.mode !== "auto") return;
      if (ttsRef.current) return;
      if (sendingRef.current) return;
      if (Date.now() < ignoreMicUntilRef.current) return;
      beginAsrUtterance();
    },
    onVolume: (value) => {
      if (!featureRef.current || holdMuteRef.current) return;
      if (prefsRef.current?.mode !== "auto") return;
      if (ttsRef.current || sendingRef.current || asrStoppingRef.current) return;
      if (!asrSnapRef.current && Date.now() < ignoreMicUntilRef.current) return;
      const vad = vadRef.current;
      const loudNow = value > (vad.heard ? ASR_VAD_HOLD : ASR_VAD_START);
      if (loudNow) {
        vad.loud += 1;
        vad.quiet = 0;
        vad.speech += 1;
        if (value > vad.peak) vad.peak = value;
        if (!vad.heard && vad.loud >= VAD_START_FRAMES) {
          vad.heard = true;
          beginAsrUtterance();
        }
        return;
      }
      vad.loud = 0;
      if (!vad.heard) return;
      vad.quiet += 1;
      if (vad.quiet < VAD_END_FRAMES) return;
      const speechOk = vad.speech >= VAD_MIN_SPEECH_FRAMES && vad.peak >= ASR_VAD_MIN_PEAK;
      vadRef.current = emptyVad();
      if (speechOk) finishAutoUtterance();
      else {
        pendingFramesRef.current = [];
        asrSnapRef.current = false;
        setStatus("speakToSend");
      }
    },
    onPartial: (text) => {
      if (!featureRef.current || holdMuteRef.current) return;
      if (ttsRef.current) return;
      if (!asrSnapRef.current && Date.now() < ignoreMicUntilRef.current) return;
      if (isStopOnly(text)) {
        haltShots();
        lastAsrTextRef.current = text;
        setPartial(text);
        asrSnapRef.current = true;
        if (busyRef.current || isSpeaking()) {
          interruptTurn();
          setStatus("stopped");
        }
        if (asrEndTimerRef.current) clearTimeout(asrEndTimerRef.current);
        asrEndTimerRef.current = setTimeout(() => {
          asrEndTimerRef.current = null;
          finishAutoUtterance();
        }, 600);
        return;
      }
      if (isSpeaking()) {
        if (!looksLikeSpeech(text) || text.trim().length < 3) return;
      }
      lastAsrTextRef.current = text;
      setPartial(text);
      beginAsrUtterance();
      ensureShots();
      if (prefsRef.current?.mode !== "auto" || asrStoppingRef.current) return;
      if (asrEndTimerRef.current) clearTimeout(asrEndTimerRef.current);
      asrEndTimerRef.current = setTimeout(() => {
        asrEndTimerRef.current = null;
        if (lastAsrTextRef.current && asrSnapRef.current) finishAutoUtterance();
      }, ASR_END_SILENCE_MS);
    },
    onFinal: (text) => {
      if (ttsRef.current) return;
      commitAsrText(text);
    },
    onEnd: () => {
      listeningRef.current = false;
      setListening(false);
      if (asrEndTimerRef.current) {
        clearTimeout(asrEndTimerRef.current);
        asrEndTimerRef.current = null;
      }
      if (ttsRef.current) return;
      const leftover = lastAsrTextRef.current;
      const shouldCommit = asrStoppingRef.current || asrSnapRef.current;
      asrSnapRef.current = false;
      asrStoppingRef.current = false;
      if (sendingRef.current) return;
      if (prefsRef.current?.mode === "ptt") return;
      if (
        featureRef.current &&
        prefsRef.current?.mode === "auto" &&
        !holdMuteRef.current &&
        shouldCommit &&
        leftover &&
        looksLikeSpeech(leftover)
      ) {
        commitAsrText(leftover);
        return;
      }
      lastAsrTextRef.current = "";
      if (featureRef.current && prefsRef.current?.mode === "auto" && !holdMuteRef.current) {
        resumeAutoListen();
      }
    },
    onError: (message) => {
      listeningRef.current = false;
      setListening(false);
      asrStoppingRef.current = false;
      if (ttsRef.current) return;
      const lower = message.toLowerCase();
      if (lower.includes("permission")) {
        setSpeechReady(false);
        return;
      }
      if (
        featureRef.current &&
        prefsRef.current?.mode === "auto" &&
        !holdMuteRef.current &&
        !sendingRef.current &&
        !ttsRef.current
      ) {
        resumeAutoListen();
      }
    },
  });

  useEffect(() => {
    if (!onboarded || prefs?.mode !== "auto") {
      speakerMuteTtsRef.current = false;
      speakerNoBargeRef.current = false;
      speakerDecidedRef.current = false;
      return;
    }
    let cancelled = false;
    const check = async () => {
      const speaker = await isSpeakerPlayback();
      if (cancelled) return;
      if (!speaker) {
        speakerMuteTtsRef.current = false;
        speakerNoBargeRef.current = false;
        speakerDecidedRef.current = false;
        speakerAlertOpenRef.current = false;
        return;
      }
      if (speakerDecidedRef.current || speakerAlertOpenRef.current) return;
      speakerAlertOpenRef.current = true;
      const copy = t(prefsRef.current?.uiLang);
      Alert.alert(
        copy.speakerTitle,
        copy.speakerBody,
        [
          {
            text: copy.speakerMuteTts,
            onPress: () => {
              speakerMuteTtsRef.current = true;
              speakerNoBargeRef.current = true;
              speakerDecidedRef.current = true;
              speakerAlertOpenRef.current = false;
              stopSpeaking();
              setTtsPlaying(false);
              setStatus("speakerTextOnly");
            },
          },
          {
            text: copy.speakerNoBarge,
            onPress: () => {
              speakerMuteTtsRef.current = false;
              speakerNoBargeRef.current = true;
              speakerDecidedRef.current = true;
              speakerAlertOpenRef.current = false;
              setStatus("speakerTapStop");
            },
          },
          {
            text: copy.speakerWearing,
            style: "cancel",
            onPress: () => {
              speakerDecidedRef.current = true;
              speakerAlertOpenRef.current = false;
            },
          },
        ],
        {
          cancelable: true,
          onDismiss: () => {
            speakerAlertOpenRef.current = false;
            speakerDecidedRef.current = true;
          },
        },
      );
    };
    void check();
    const timer = setInterval(() => void check(), 2500);
    return () => {
      cancelled = true;
      clearInterval(timer);
    };
  }, [onboarded, prefs?.mode]);

  useEffect(() => {
    if (featureOn && prefs?.mode === "auto" && !holdMute) {
      resumeAutoListen();
      return;
    }
    abortListening();
    void stopRecording();
    listeningRef.current = false;
    setListening(false);
  }, [featureOn, holdMute, prefs?.mode, prefs?.provider, resumeAutoListen]);

  useEffect(() => {
    if (!featureOn || prefs?.mode !== "auto" || !useMicListen || !listening) return;
    const timer = setInterval(() => {
      void (async () => {
        const meter = await getMetering();
        if (meter == null || holdMuteRef.current) return;
        const vad = vadRef.current;
        if (!vad.heard && Date.now() < ignoreMicUntilRef.current) return;
        const duringTts = ttsRef.current;
        const startDb = duringTts ? VAD_BARGE_DB : VAD_START_DB;
        const holdDb = duringTts ? VAD_BARGE_HOLD_DB : VAD_HOLD_DB;
        const startFrames = duringTts ? ASR_VAD_BARGE_FRAMES : VAD_START_FRAMES;
        const loudNow = meter > (vad.heard ? holdDb : startDb);
        if (loudNow) {
          vad.loud += 1;
          vad.quiet = 0;
          vad.speech += 1;
          if (meter > vad.peak) vad.peak = meter;
          if (!vad.heard && vad.loud >= startFrames) {
            vad.heard = true;
            onUtteranceStart();
          }
        } else {
          vad.loud = 0;
          if (duringTts || !vad.heard) return;
          vad.quiet += 1;
          if (vad.quiet < VAD_END_FRAMES) return;
          const speechOk = vad.speech >= VAD_MIN_SPEECH_FRAMES && vad.peak >= VAD_MIN_PEAK_DB;
          vadRef.current = emptyVad();
          if (speechOk) await finishMicClip();
          else {
            pendingFramesRef.current = [];
            setStatus("noise");
          }
        }
      })();
    }, VAD_TICK_MS);
    return () => clearInterval(timer);
  }, [featureOn, finishMicClip, listening, onUtteranceStart, prefs?.mode, useMicListen]);

  const bargeInNow = useCallback(() => {
    if (!ttsRef.current && !busyRef.current && !isSpeaking()) return;
    haltShots();
    interruptTurn();
    tapMedium();
    setStatus("interruptedListening");
    ignoreMicUntilRef.current = 0;
    asrSnapRef.current = false;
    lastAsrTextRef.current = "";
    vadRef.current = emptyVad();
    void stopRecording(true).finally(() => {
      listeningRef.current = false;
      maybeListenRef.current();
    });
  }, [haltShots, interruptTurn]);

  useEffect(() => {
    if (!featureOn || prefs?.mode !== "auto" || holdMute || !(ttsPlaying || busy)) return;
    vadRef.current = emptyVad();
    const timer = setInterval(() => {
      void (async () => {
        if ((!ttsRef.current && !busyRef.current) || holdMuteRef.current) return;
        if (speakerNoBargeRef.current || speakerMuteTtsRef.current) return;
        const meter = await getMetering();
        if (meter == null) return;
        if (Date.now() < ignoreMicUntilRef.current) {
          ttsBaselineRef.current = meter;
          return;
        }
        const baseline = ttsBaselineRef.current;
        ttsBaselineRef.current = baseline * 0.9 + meter * 0.1;
        const spike = meter > baseline + 8 && meter > VAD_BARGE_HOLD_DB;
        const vad = vadRef.current;
        if (spike) {
          vad.loud += 1;
          vad.speech += 1;
          if (meter > vad.peak) vad.peak = meter;
          if (!vad.heard && vad.loud >= ASR_VAD_BARGE_FRAMES) {
            vad.heard = true;
            bargeInNow();
          }
        } else {
          vad.loud = 0;
        }
      })();
    }, VAD_TICK_MS);
    return () => clearInterval(timer);
  }, [bargeInNow, busy, featureOn, holdMute, prefs?.mode, ttsPlaying]);

  const interruptSpeaking = useCallback(() => {
    haltShots();
    bargeInNow();
  }, [bargeInNow, haltShots]);

  const onTalkDown = () => {
    if (!prefs || !apiKey.trim()) return;
    if (prefs.mode !== "ptt") {
      if (ttsPlaying || ttsRef.current || isSpeaking() || busy) interruptSpeaking();
      return;
    }
    pttDownRef.current = true;
    setPttDown(true);
    onUtteranceStart(true);
    maybeListen();
  };

  const onTalkUp = () => {
    if (!prefs || prefs.mode !== "ptt") return;
    pttDownRef.current = false;
    setPttDown(false);
    if (nativeAsr) {
      setStatus("recognizing");
      void (async () => {
        const shots = await takeEndFrames();
        stopListening();
        await new Promise((resolve) => setTimeout(resolve, 350));
        if (sendingRef.current || pttDownRef.current) return;
        const text = lastAsrTextRef.current.trim();
        if (isStopOnly(text)) {
          haltShots();
          setStatus("stopped");
          return;
        }
        if (text && looksLikeSpeech(text)) await askModel(text, shots);
        else setStatus("noise");
      })();
      return;
    }
    void finishMicClip();
  };

  const saveSettings = async () => {
    if (!prefs) return;
    const nextKey = draftKey.trim() || apiKey;
    if (nextKey && !looksLikeApiKey(nextKey)) {
      Alert.alert(t(prefs.uiLang).badKeyTitle, t(prefs.uiLang).badKeyBody);
      return;
    }
    let nextPrefs = prefs;
    if (draftKey.trim()) {
      nextPrefs = applyKeyToPrefs({ ...prefs, providerLocked: false }, draftKey);
    }
    await saveApiKey(nextKey);
    await persistPrefs(nextPrefs);
    setApiKey(nextKey);
    setDraftKey("");
    setSettingsOpen(false);
  };

  const finishOnboarding = async () => {
    await saveOnboarded();
    setOnboarded(true);
    await requestPermission();
    setSpeechReady((await getSpeechPermission()) || (await requestSpeechPermissions()));
    setMicReady(await requestMicPermission());
    if (!apiKey.trim()) setSettingsOpen(true);
  };

  const clearApiKey = async () => {
    await saveApiKey("");
    setApiKey("");
    setDraftKey("");
    setSettingsOpen(false);
  };

  if (!prefs || onboarded === null) {
    return (
      <View style={styles.boot}>
        <ActivityIndicator color={colors.accent2} />
      </View>
    );
  }

  const cameraOk = Boolean(permission?.granted && cameraReady);
  const c = t(prefs.uiLang);
  const previewH = bodyH ? Math.round((bodyH - 21) * previewShare) : undefined;
  const zoomLabel = `${(1 + zoom * 4).toFixed(1)}×`;
  const voiceLabel = nativeAsr
    ? speechReady
      ? c.nativeAsr
      : c.asrDenied
    : micReady
      ? c.autoListen
      : c.micOff;
  const talkLabel = !apiKey.trim()
    ? c.fillKey
    : ttsPlaying
      ? c.tapToInterrupt
      : pttDown
        ? c.releaseToSend
        : c.holdToTalk;
  const showTalk = prefs.mode === "ptt";

  const changeRate = (delta: number) => {
    const ttsRate = Math.min(1.6, Math.max(0.6, Math.round((prefs.ttsRate + delta) * 10) / 10));
    void persistPrefs({ ...prefs, ttsRate });
  };

  const cycleZoom = () => {
    const steps = [0, 0.22, 0.45];
    const index = steps.findIndex((step) => Math.abs(zoom - step) < 0.08);
    const next = steps[(index < 0 ? 0 : index + 1) % steps.length];
    zoomRef.current = next;
    setZoom(next);
  };

  const onBodyLayout = (nextH: number) => {
    if (!nextH) return;
    setBodyH(nextH);
    if (shareInited.current || sizedByUser.current) return;
    shareInited.current = true;
    setPreviewShare(clamp((height * PHI_INV) / nextH, PREVIEW_SHARE_MIN, PREVIEW_SHARE_MAX));
  };

  const cameraBlock = (
    <View style={styles.pip}>
      {permission?.granted ? (
        <CameraView
          ref={cameraRef}
          style={[styles.camera, { transform: [{ rotate: `${prefs.cameraRotate}deg` }] }]}
          facing={prefs.cameraFacing}
          mode="video"
          mute
          zoom={zoom}
          autofocus={focusMode}
          onCameraReady={() => setCameraReady(true)}
        />
      ) : (
        <Pressable
          style={styles.videoEmpty}
          onPress={() => {
            if (permission && !permission.canAskAgain) {
              void Linking.openSettings();
              return;
            }
            void requestPermission();
          }}
          accessibilityRole="button"
          accessibilityLabel={c.allowCamera}
        >
          <Text style={styles.muted}>
            {permission && !permission.granted && !permission.canAskAgain ? c.openCameraSettings : c.allowCamera}
          </Text>
        </Pressable>
      )}
      {permission?.granted ? (
        <View style={styles.pinchLayer} collapsable={false} {...pinchResponder.panHandlers} />
      ) : null}
      {focusRing ? (
        <View pointerEvents="none" style={[styles.focusRing, { left: focusRing.x - 34, top: focusRing.y - 34 }]} />
      ) : null}
      <View style={styles.videoHud} pointerEvents="box-none">
        <Text style={styles.chip}>{statusLabel(c, status)}</Text>
        <Pressable onPress={cycleZoom} accessibilityRole="button" accessibilityLabel={c.zoomA11y(zoomLabel)}>
          <Text style={styles.chip}>{zoomLabel}</Text>
        </Pressable>
        <Pressable
          onPress={() => {
            setCameraReady(false);
            void persistPrefs({ ...prefs, cameraFacing: prefs.cameraFacing === "back" ? "front" : "back" });
          }}
          accessibilityRole="button"
          accessibilityLabel={prefs.cameraFacing === "back" ? c.switchToFront : c.switchToBack}
        >
          <Text style={styles.chip}>{prefs.cameraFacing === "back" ? c.rear : c.front}</Text>
        </Pressable>
      </View>
    </View>
  );

  const chatBlock = prefs.showText ? (
    <ScrollView
      ref={chatRef}
      style={styles.chat}
      contentContainerStyle={styles.chatContent}
      onContentSizeChange={() => chatRef.current?.scrollToEnd({ animated: true })}
    >
      {turns.length === 0 ? (
        <Text style={styles.sys}>{c.emptyChat}</Text>
      ) : null}
      {turns.map((turn) => (
        <View key={turn.id} style={[styles.bubble, turn.role === "user" ? styles.user : styles.assistant]}>
          {(turn.imageUris?.length ? turn.imageUris : turn.imageUri ? [turn.imageUri] : []).length ? (
            <View style={styles.shots}>
              {(turn.imageUris?.length ? turn.imageUris : [turn.imageUri as string]).map((uri, index) => (
                <Image key={`${turn.id}-${index}`} source={{ uri }} style={styles.shot} resizeMode="cover" />
              ))}
            </View>
          ) : null}
          {turn.thinking ? <ThinkTicker text={turn.thinking} /> : null}
          <Text style={styles.bubbleText}>
            {turn.content ||
              (turn.role === "assistant" && busy ? (turn.thinking ? "" : c.watching) : "")}
          </Text>
        </View>
      ))}
      {partial ? <Text style={styles.partial}>{c.recognizingPrefix}{partial}</Text> : null}
    </ScrollView>
  ) : (
    <View style={styles.flex} />
  );

  return (
    <SafeAreaProvider>
      <SafeAreaView style={styles.safe}>
        <StatusBar style="light" />
        <KeyboardAvoidingView style={styles.flex} behavior={Platform.OS === "ios" ? "padding" : undefined}>
          <View style={styles.header}>
            <View style={styles.headerLeft}>
              <Text style={styles.brand}>{APP_NAME}</Text>
              <View style={styles.dots}>
                <Dot kind={featureOn ? "ok" : "off"} text={featureOn ? c.working : c.needsSetup} />
                <Dot kind={cameraOk ? "ok" : "warn"} text={cameraOk ? c.cameraOk : c.cameraOff} />
                <Dot kind={nativeAsr || micReady ? "ok" : "warn"} text={voiceLabel} />
              </View>
            </View>
            <Pressable
              onPress={() => setSettingsOpen(true)}
              style={styles.settingsBtn}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityLabel={c.openSettings}
            >
              <Text style={styles.settingsBtnText}>{c.settings}</Text>
            </Pressable>
          </View>

          <View
            style={styles.body}
            onLayout={(event) => onBodyLayout(event.nativeEvent.layout.height)}
          >
            <View style={[styles.previewStage, previewH ? { height: previewH } : styles.previewFallback]}>
              {cameraBlock}
            </View>
            <View
              style={styles.resizeHit}
              {...resizeResponder.panHandlers}
              accessibilityRole="adjustable"
              accessibilityLabel={c.resizePreview}
            >
              <View style={styles.resizeBar} />
            </View>
            {chatBlock}
          </View>

          {ttsPlaying || busy ? (
            <Pressable
              onPress={interruptSpeaking}
              style={styles.interruptBar}
              accessibilityRole="button"
              accessibilityLabel={c.interrupt}
            >
              <Text style={styles.interruptText}>{ttsPlaying ? c.interruptSpeech : c.tapToInterrupt}</Text>
            </Pressable>
          ) : null}

          {showTalk ? (
            <Pressable
              onPress={() => {
                if (!apiKey.trim()) {
                  setSettingsOpen(true);
                  return;
                }
                if (ttsPlaying || ttsRef.current || isSpeaking() || busy) interruptSpeaking();
              }}
              onPressIn={onTalkDown}
              onPressOut={onTalkUp}
              style={[styles.talkMain, (pttDown || ttsPlaying || busy) && styles.talkHot]}
              accessibilityRole="button"
              accessibilityLabel={talkLabel}
            >
              <Text style={styles.talkText}>{busy && !ttsPlaying ? c.tapToInterrupt : talkLabel}</Text>
            </Pressable>
          ) : null}

          {moreOpen ? (
            <>
              <View style={styles.dock}>
                <View style={styles.segment}>
                  <MiniToggle
                    label={c.fast}
                    on={prefs.answerMode === "fast"}
                    onPress={() => {
                      const current = prefsRef.current;
                      if (!current) return;
                      void persistPrefs({ ...current, answerMode: "fast" });
                    }}
                  />
                  <MiniToggle
                    label={c.think}
                    on={prefs.answerMode === "think"}
                    onPress={() => {
                      const current = prefsRef.current;
                      if (!current) return;
                      void persistPrefs({ ...current, answerMode: "think" });
                    }}
                  />
                </View>
                <View style={styles.segment}>
                  <MiniToggle
                    label={c.auto}
                    on={prefs.mode === "auto"}
                    onPress={() => {
                      const current = prefsRef.current;
                      if (!current) return;
                      void persistPrefs({ ...current, mode: "auto" });
                    }}
                  />
                  <MiniToggle
                    label={c.hold}
                    on={prefs.mode === "ptt"}
                    onPress={() => {
                      const current = prefsRef.current;
                      if (!current) return;
                      void persistPrefs({ ...current, mode: "ptt" });
                    }}
                  />
                </View>
              </View>

              <View style={styles.footer}>
                <View style={styles.rateCluster}>
                  <Text style={styles.rateLabel}>{c.rate}</Text>
                  <Pressable style={styles.rateBtn} onPress={() => changeRate(-0.1)}>
                    <Text style={styles.rateBtnText}>−</Text>
                  </Pressable>
                  <Text style={styles.rateValue}>{prefs.ttsRate.toFixed(1)}×</Text>
                  <Pressable style={styles.rateBtn} onPress={() => changeRate(0.1)}>
                    <Text style={styles.rateBtnText}>＋</Text>
                  </Pressable>
                </View>
                <View style={styles.footerActions}>
                  <Pressable
                    style={styles.toolHit}
                    onPress={() => {
                      const current = prefsRef.current;
                      if (!current) return;
                      void persistPrefs({
                        ...current,
                        cameraRotate: ((current.cameraRotate + 180) % 360) as 0 | 180,
                      });
                    }}
                  >
                    <Text style={styles.tool}>{c.rotate(prefs.cameraRotate || 0)}</Text>
                  </Pressable>
                  <Pressable
                    style={styles.toolHit}
                    onPress={() => {
                      interruptTurn();
                      haltShots();
                      setTurns([]);
                      setStatus(featureOn ? "idle" : "needsSetup");
                    }}
                  >
                    <Text style={styles.tool}>{c.newChat}</Text>
                  </Pressable>
                </View>
              </View>
            </>
          ) : null}

          <Pressable
            onPress={() => setMoreOpen((open) => !open)}
            style={styles.moreBtn}
            accessibilityRole="button"
            accessibilityLabel={moreOpen ? c.closeMore : c.openMore}
          >
            <Text style={styles.moreBtnText}>{moreOpen ? c.collapse : c.more}</Text>
          </Pressable>
        </KeyboardAvoidingView>

        <SettingsModal
          visible={settingsOpen}
          apiKey={apiKey}
          draftKey={draftKey}
          prefs={prefs}
          appVersion={`${Application.nativeApplicationVersion || "1.0.0"} (${Application.nativeBuildVersion || "1"})`}
          onChangeDraftKey={(value) => {
            setDraftKey(value);
            if (!value.trim()) return;
            setPrefs((prev) => (prev && !prev.providerLocked ? { ...prev, provider: detectProvider(value) } : prev));
          }}
          onChangePrefs={(next) => {
            setPrefs(next);
            if (next.uiLang !== prefs.uiLang) void persistPrefs(next);
          }}
          onSave={() => void saveSettings()}
          onClearKey={() => void clearApiKey()}
          onOpenLegal={(kind) => {
            setLegalKind(kind);
            setLegalOpen(true);
          }}
          onClose={() => {
            void loadPrefs().then(setPrefs);
            setDraftKey("");
            setSettingsOpen(false);
          }}
        />
        <LegalModal visible={legalOpen} kind={legalKind} lang={prefs.uiLang} onClose={() => setLegalOpen(false)} />
        <OnboardingModal visible={!onboarded} lang={prefs.uiLang} onAgree={() => void finishOnboarding()} />
      </SafeAreaView>
    </SafeAreaProvider>
  );
}

function Dot({ kind, text }: { kind: FlagKind; text: string }) {
  return (
    <View style={styles.dot}>
      <View style={[styles.dotMark, kind === "ok" ? styles.dotOk : kind === "warn" ? styles.dotWarn : styles.dotOff]} />
      <Text style={styles.dotText}>{text}</Text>
    </View>
  );
}

function MiniToggle({ label, on, onPress }: { label: string; on: boolean; onPress: () => void }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={6}
      style={[styles.mini, on && styles.miniOn]}
      accessibilityRole="button"
      accessibilityState={{ selected: on }}
      accessibilityLabel={label}
    >
      <Text style={[styles.miniText, on && styles.miniTextOn]}>{label}</Text>
    </Pressable>
  );
}

function ThinkTicker({ text }: { text: string }) {
  const scroller = useRef<ScrollView>(null);
  const shown = text.replace(/\s+/g, " ").trim();
  useEffect(() => {
    if (!shown) return;
    requestAnimationFrame(() => scroller.current?.scrollToEnd({ animated: true }));
  }, [shown]);
  if (!shown) return null;
  return (
    <View style={styles.tickerWrap}>
      <ScrollView
        ref={scroller}
        horizontal
        showsHorizontalScrollIndicator={false}
        contentContainerStyle={styles.tickerContent}
      >
        <Text style={styles.ticker} numberOfLines={1}>
          {shown}
        </Text>
      </ScrollView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: colors.bg },
  flex: { flex: 1 },
  boot: { flex: 1, backgroundColor: colors.bg, alignItems: "center", justifyContent: "center" },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: 13,
    paddingBottom: 8,
  },
  headerLeft: { flex: 1, paddingRight: 13 },
  brand: { color: colors.text, fontSize: 21, fontWeight: "700" },
  dots: { flexDirection: "row", gap: 13, marginTop: 5 },
  dot: { flexDirection: "row", alignItems: "center", gap: 5 },
  dotMark: { width: 8, height: 8, borderRadius: 4 },
  dotOk: { backgroundColor: colors.accent2 },
  dotWarn: { backgroundColor: colors.accent },
  dotOff: { backgroundColor: "#6b7264" },
  dotText: { color: colors.muted, fontSize: 12 },
  settingsBtn: { minHeight: 44, paddingHorizontal: 8, alignItems: "center", justifyContent: "center" },
  settingsBtnText: { color: colors.okText, fontWeight: "700", fontSize: 16 },
  body: { flex: 1, paddingHorizontal: 8 },
  previewStage: { width: "100%" },
  previewFallback: { flex: PHI },
  pip: {
    flex: 1,
    borderRadius: 13,
    overflow: "hidden",
    backgroundColor: colors.ink,
    borderWidth: 1,
    borderColor: colors.line,
  },
  camera: { flex: 1 },
  pinchLayer: { position: "absolute", top: 0, right: 0, bottom: 0, left: 0, zIndex: 1 },
  focusRing: {
    position: "absolute",
    width: 68,
    height: 68,
    borderWidth: 1.5,
    borderColor: "#f2d27a",
    borderRadius: 8,
    zIndex: 2,
  },
  videoEmpty: { flex: 1, alignItems: "center", justifyContent: "center" },
  muted: { color: colors.muted },
  videoHud: {
    position: "absolute",
    left: 8,
    right: 8,
    bottom: 8,
    zIndex: 3,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    gap: 8,
  },
  resizeHit: {
    height: 21,
    alignItems: "center",
    justifyContent: "center",
  },
  resizeBar: {
    width: 55,
    height: 5,
    borderRadius: 3,
    backgroundColor: colors.line,
  },
  chip: {
    color: colors.text,
    backgroundColor: "rgba(0,0,0,0.5)",
    paddingHorizontal: 8,
    paddingVertical: 4,
    borderRadius: 999,
    overflow: "hidden",
    fontSize: 11,
  },
  chat: { flex: 1 },
  chatContent: { paddingBottom: 8, gap: 8 },
  sys: { color: colors.muted, lineHeight: 22 },
  bubble: { borderRadius: 14, padding: 12, borderWidth: 1 },
  user: { alignSelf: "flex-end", backgroundColor: "#24301d", borderColor: "#3d5a2e", maxWidth: "88%" },
  assistant: { alignSelf: "flex-start", backgroundColor: colors.panel, borderColor: colors.line, maxWidth: "92%" },
  bubbleText: { color: colors.text, lineHeight: 22, fontSize: 16 },
  shots: { flexDirection: "row", gap: 6, marginBottom: 8 },
  shot: { width: 96, aspectRatio: 3 / 4, borderRadius: 8, backgroundColor: colors.ink },
  tickerWrap: {
    height: 22,
    marginBottom: 6,
    overflow: "hidden",
  },
  tickerContent: { alignItems: "center", paddingRight: 12 },
  ticker: { color: colors.muted, fontSize: 12, lineHeight: 22 },
  partial: { color: colors.warnText, fontSize: 13 },
  interruptBar: {
    marginHorizontal: 13,
    marginTop: 8,
    borderRadius: 13,
    paddingVertical: 13,
    alignItems: "center",
    backgroundColor: colors.accent,
  },
  interruptText: { color: "#1a1408", fontWeight: "800", fontSize: 16 },
  dock: {
    flexDirection: "row",
    alignItems: "center",
    gap: 8,
    paddingHorizontal: 13,
    paddingTop: 8,
    zIndex: 2,
  },
  segment: {
    flex: 1,
    flexDirection: "row",
    backgroundColor: colors.panel,
    borderRadius: 16,
    borderWidth: 1,
    borderColor: colors.line,
    overflow: "hidden",
    minHeight: 48,
    zIndex: 3,
  },
  mini: { flex: 1, minHeight: 48, paddingVertical: 14, alignItems: "center", justifyContent: "center" },
  miniOn: { backgroundColor: "#1c2a16" },
  miniText: { color: colors.muted, fontSize: 15, fontWeight: "700" },
  miniTextOn: { color: colors.okText },
  talkMain: {
    marginHorizontal: 13,
    marginTop: 8,
    borderRadius: 13,
    minHeight: 55,
    paddingVertical: 13,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
  },
  moreBtn: {
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
    marginHorizontal: 13,
    marginTop: 5,
    marginBottom: 3,
  },
  moreBtnText: { color: colors.muted, fontSize: 13, fontWeight: "600" },
  talkHot: { borderColor: colors.accent, backgroundColor: "#2a2414" },
  talkText: { color: colors.text, fontWeight: "700", fontSize: 15 },
  footer: {
    flexDirection: "row",
    alignItems: "center",
    paddingHorizontal: 13,
    paddingTop: 8,
    paddingBottom: 5,
    gap: 13,
  },
  footerActions: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  rateCluster: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    paddingHorizontal: 8,
    paddingVertical: 6,
    minHeight: 48,
  },
  rateLabel: { color: colors.muted, fontWeight: "700", fontSize: 13 },
  rateBtn: {
    width: 40,
    height: 40,
    borderRadius: 10,
    alignItems: "center",
    justifyContent: "center",
  },
  rateBtnText: { color: colors.text, fontSize: 22, fontWeight: "700", lineHeight: 24 },
  rateValue: { color: colors.okText, fontWeight: "800", minWidth: 40, textAlign: "center", fontSize: 14 },
  toolHit: { minHeight: 44, minWidth: 44, alignItems: "center", justifyContent: "center", paddingHorizontal: 4 },
  tool: { color: colors.muted, fontWeight: "700", fontSize: 14 },
});
