import {
  AudioModule,
  RecordingPresets,
  setAudioModeAsync,
  type AudioRecorder,
} from "expo-audio";

let recorder: AudioRecorder | null = null;
let routeProbe: AudioRecorder | null = null;

export async function requestMicPermission(): Promise<boolean> {
  const result = await AudioModule.requestRecordingPermissionsAsync();
  return result.granted;
}

export async function startRecording(): Promise<void> {
  await stopRecording(true);
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
  });
  const options = {
    ...RecordingPresets.HIGH_QUALITY,
    isMeteringEnabled: true,
  };
  const next = new AudioModule.AudioRecorder(options);
  await next.prepareToRecordAsync();
  next.record();
  recorder = next;
}

/** Light recorder for barge-in while TTS plays. Does not start speech recognition. */
export async function startMetering(): Promise<void> {
  await stopRecording(true);
  await setAudioModeAsync({
    allowsRecording: true,
    playsInSilentMode: true,
    interruptionMode: "mixWithOthers",
  });
  const options = {
    ...RecordingPresets.LOW_QUALITY,
    isMeteringEnabled: true,
    numberOfChannels: 1,
    sampleRate: 16000,
  };
  const next = new AudioModule.AudioRecorder(options);
  await next.prepareToRecordAsync();
  next.record();
  recorder = next;
}

export async function stopRecording(keepSession = false): Promise<string | null> {
  const current = recorder;
  recorder = null;
  if (!current) return null;
  try {
    await current.stop();
    if (!keepSession) {
      await setAudioModeAsync({
        allowsRecording: false,
        playsInSilentMode: true,
        interruptionMode: "mixWithOthers",
      });
    }
    return current.uri;
  } catch {
    return null;
  }
}

export async function preparePlayback(keepMic = false): Promise<void> {
  await stopRecording(keepMic);
  await setAudioModeAsync({
    allowsRecording: keepMic,
    playsInSilentMode: true,
    interruptionMode: keepMic ? "mixWithOthers" : "duckOthers",
    shouldRouteThroughEarpiece: false,
  });
}

export async function getMetering(): Promise<number | null> {
  if (!recorder) return null;
  const status = recorder.getStatus();
  return typeof status.metering === "number" ? status.metering : null;
}

function looksLikeHeadset(input: { type?: string; name?: string }): boolean {
  const blob = `${input.type || ""} ${input.name || ""}`.toLowerCase();
  return /headset|headphone|bluetooth|airpod|usb|car audio|receiver|hfp|a2dp|ble/.test(blob);
}

function looksLikeBuiltInMic(input: { type?: string; name?: string }): boolean {
  const blob = `${input.type || ""} ${input.name || ""}`.toLowerCase();
  return /built-?in mic|microphonebuilt|built-in microphone|mic/.test(blob) && !looksLikeHeadset(input);
}

/** True when audio is likely going out the speaker (no headphones / Bluetooth). */
export async function isSpeakerPlayback(): Promise<boolean> {
  try {
    if (!routeProbe && !recorder) {
      routeProbe = new AudioModule.AudioRecorder({
        ...RecordingPresets.LOW_QUALITY,
        isMeteringEnabled: false,
      });
    }
    const probe = recorder ?? routeProbe;
    if (!probe) return false;
    const available = probe.getAvailableInputs?.() || [];
    if (available.some((item) => looksLikeHeadset(item))) return false;
    const current = await probe.getCurrentInput();
    if (looksLikeHeadset(current)) return false;
    if (looksLikeBuiltInMic(current)) return true;
    return false;
  } catch {
    return false;
  }
}
