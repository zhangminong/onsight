import {
  Alert,
  Keyboard,
  KeyboardAvoidingView,
  Linking,
  Modal,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Switch,
  Text,
  TextInput,
  View,
} from "react-native";

import { PRIVACY_POLICY_URL } from "../constants";
import { applyUiLang, t, type UiLang } from "../i18n";
import { PROVIDERS, type ProviderId } from "../lib/provider";
import { maskKey, type Prefs } from "../lib/settings";
import { colors } from "../theme";

type Props = {
  visible: boolean;
  apiKey: string;
  draftKey: string;
  prefs: Prefs;
  appVersion: string;
  onChangeDraftKey: (value: string) => void;
  onChangePrefs: (prefs: Prefs) => void;
  onSave: () => void;
  onClose: () => void;
  onClearKey: () => void;
  onOpenLegal: (kind: "privacy" | "terms") => void;
};

export function SettingsModal({
  visible,
  apiKey,
  draftKey,
  prefs,
  appVersion,
  onChangeDraftKey,
  onChangePrefs,
  onSave,
  onClose,
  onClearKey,
  onOpenLegal,
}: Props) {
  const c = t(prefs.uiLang);
  const provider = PROVIDERS[prefs.provider];
  const hint = maskKey(apiKey);

  const save = () => {
    Keyboard.dismiss();
    onSave();
  };

  return (
    <Modal visible={visible} animationType="slide" transparent>
      <KeyboardAvoidingView
        style={styles.mask}
        behavior={Platform.OS === "ios" ? "padding" : undefined}
      >
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{c.settings}</Text>
            <View style={styles.actions}>
              <Pressable onPress={onClose} style={styles.ghost}>
                <Text style={styles.ghostText}>{c.cancel}</Text>
              </Pressable>
              <Pressable onPress={save} style={styles.primary}>
                <Text style={styles.primaryText}>{c.save}</Text>
              </Pressable>
            </View>
          </View>
          <ScrollView
            style={styles.body}
            keyboardShouldPersistTaps="always"
            keyboardDismissMode="none"
          >
            <Text style={styles.label}>{c.appLanguage}</Text>
            <View style={styles.row}>
              {(
                [
                  ["en", c.english],
                  ["zh", c.chinese],
                ] as const
              ).map(([id, label]: readonly [UiLang, string]) => (
                <Pressable
                  key={id}
                  onPress={() => onChangePrefs(applyUiLang(prefs, id))}
                  style={[styles.chip, prefs.uiLang === id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, prefs.uiLang === id && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>{c.apiKey}</Text>
            <TextInput
              value={draftKey}
              onChangeText={onChangeDraftKey}
              placeholder="sk-…"
              placeholderTextColor={colors.muted}
              autoCapitalize="none"
              autoCorrect={false}
              secureTextEntry
              style={styles.input}
            />
            <Text style={styles.hint}>{apiKey ? (hint ? c.keySaved(hint) : c.keyMasked) : c.keyEmpty}</Text>

            <Text style={styles.label}>{c.provider}</Text>
            <View style={styles.row}>
              {(Object.keys(PROVIDERS) as ProviderId[]).map((id) => (
                <Pressable
                  key={id}
                  onPress={() => onChangePrefs({ ...prefs, provider: id, providerLocked: true })}
                  style={[styles.chip, prefs.provider === id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, prefs.provider === id && styles.chipTextOn]}>
                    {PROVIDERS[id].name}
                  </Text>
                </Pressable>
              ))}
            </View>
            <Text style={styles.hint}>{c.providerHint}</Text>

            <Pressable onPress={() => Linking.openURL(provider.keyUrl)}>
              <Text style={styles.link}>{c.applyKey(provider.name)}</Text>
            </Pressable>

            <Text style={styles.label}>{c.assistantPrompt}</Text>
            <TextInput
              value={prefs.systemPrompt}
              onChangeText={(systemPrompt) => onChangePrefs({ ...prefs, systemPrompt })}
              multiline
              style={[styles.input, styles.textarea]}
            />

            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{c.showText}</Text>
              <Switch
                value={prefs.showText}
                onValueChange={(showText) => onChangePrefs({ ...prefs, showText })}
                trackColor={{ true: colors.accent2 }}
              />
            </View>
            <View style={styles.toggleRow}>
              <Text style={styles.toggleLabel}>{c.voicePlayback}</Text>
              <Switch
                value={prefs.enableTts}
                onValueChange={(enableTts) => onChangePrefs({ ...prefs, enableTts })}
                trackColor={{ true: colors.accent2 }}
              />
            </View>

            <Text style={styles.label}>{c.dictationLanguage}</Text>
            <View style={styles.row}>
              {(
                [
                  ["zh-CN", c.chinese],
                  ["en-US", c.english],
                ] as const
              ).map(([id, label]) => (
                <Pressable
                  key={id}
                  onPress={() => onChangePrefs({ ...prefs, speechLang: id })}
                  style={[styles.chip, prefs.speechLang === id && styles.chipOn]}
                >
                  <Text style={[styles.chipText, prefs.speechLang === id && styles.chipTextOn]}>{label}</Text>
                </Pressable>
              ))}
            </View>

            <Text style={styles.label}>{c.about}</Text>
            <Pressable onPress={() => onOpenLegal("privacy")} style={styles.linkHit}>
              <Text style={styles.link}>{c.privacy}</Text>
            </Pressable>
            <Pressable onPress={() => onOpenLegal("terms")} style={styles.linkHit}>
              <Text style={styles.link}>{c.terms}</Text>
            </Pressable>
            {PRIVACY_POLICY_URL ? (
              <Pressable onPress={() => void Linking.openURL(PRIVACY_POLICY_URL)} style={styles.linkHit}>
                <Text style={styles.link}>{c.privacyWeb}</Text>
              </Pressable>
            ) : null}
            <Pressable onPress={() => void Linking.openSettings()} style={styles.linkHit}>
              <Text style={styles.link}>{c.openSystemSettings}</Text>
            </Pressable>
            {apiKey ? (
              <Pressable
                onPress={() =>
                  Alert.alert(c.clearKeyTitle, c.clearKeyBody, [
                    { text: c.cancel, style: "cancel" },
                    { text: c.clear, style: "destructive", onPress: onClearKey },
                  ])
                }
                style={styles.linkHit}
              >
                <Text style={styles.danger}>{c.clearKey}</Text>
              </Pressable>
            ) : null}

            <Text style={styles.fine}>{c.disclaimer}</Text>
            <Text style={styles.version}>{c.version(appVersion)}</Text>
          </ScrollView>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "flex-end",
  },
  sheet: {
    backgroundColor: colors.panel,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    borderColor: colors.line,
    borderWidth: 1,
    maxHeight: "88%",
    padding: 16,
  },
  head: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    marginBottom: 12,
    gap: 12,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700", flexShrink: 1 },
  body: { maxHeight: 520 },
  label: { color: colors.text, marginTop: 12, marginBottom: 6, fontWeight: "600" },
  input: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    color: colors.text,
    paddingHorizontal: 12,
    paddingVertical: 10,
    backgroundColor: colors.ink,
  },
  textarea: { minHeight: 110, textAlignVertical: "top" },
  hint: { color: colors.muted, fontSize: 12, marginTop: 6, lineHeight: 18 },
  row: { flexDirection: "row", gap: 8 },
  chip: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  chipOn: { borderColor: colors.accent2, backgroundColor: "#1c2a16" },
  chipText: { color: colors.muted },
  chipTextOn: { color: colors.okText, fontWeight: "700" },
  link: { color: colors.accent, marginTop: 10, fontWeight: "600" },
  toggleRow: {
    marginTop: 14,
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  toggleLabel: { color: colors.text },
  fine: { color: colors.muted, fontSize: 11, marginTop: 16, lineHeight: 16 },
  version: { color: colors.muted, fontSize: 11, marginTop: 10, marginBottom: 8 },
  linkHit: { minHeight: 44, justifyContent: "center" },
  danger: { color: colors.danger, marginTop: 4, fontWeight: "600" },
  actions: { flexDirection: "row", alignItems: "center", gap: 8 },
  ghost: {
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 10,
    paddingHorizontal: 14,
    paddingVertical: 8,
  },
  ghostText: { color: colors.text },
  primary: {
    backgroundColor: colors.accent2,
    borderRadius: 10,
    paddingHorizontal: 16,
    paddingVertical: 8,
  },
  primaryText: { color: "#10200a", fontWeight: "700" },
});
