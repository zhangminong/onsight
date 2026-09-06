import { Pressable, StyleSheet, Text, View } from "react-native";

import { APP_NAME } from "../constants";
import { t, type UiLang } from "../i18n";
import { colors } from "../theme";

type Props = {
  visible: boolean;
  lang?: UiLang;
  onAgree: () => void;
};

export function OnboardingModal({ visible, lang, onAgree }: Props) {
  const c = t(lang);
  if (!visible) return null;
  const pages = [
    {
      title: c.onboardingWelcome(APP_NAME),
      body: c.onboardingWelcomeBody(c.tagline),
    },
    {
      title: c.onboardingPerms,
      body: c.onboardingPermsBody,
    },
    {
      title: c.onboardingData,
      body: c.onboardingDataBody,
    },
  ];
  return (
    <View style={styles.root} accessibilityViewIsModal>
      <Text style={styles.kicker}>{c.onboardingKicker}</Text>
      <Text style={styles.brand}>{APP_NAME}</Text>
      {pages.map((page) => (
        <View key={page.title} style={styles.card}>
          <Text style={styles.title}>{page.title}</Text>
          <Text style={styles.body}>{page.body}</Text>
        </View>
      ))}
      <Text style={styles.fine}>{c.disclaimer}</Text>
      <Pressable
        onPress={onAgree}
        style={styles.cta}
        accessibilityRole="button"
        accessibilityLabel={c.agreeA11y}
      >
        <Text style={styles.ctaText}>{c.agreeContinue}</Text>
      </Pressable>
      <Text style={styles.hint}>{c.agreeHint}</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  root: {
    ...StyleSheet.absoluteFill,
    backgroundColor: colors.bg,
    paddingHorizontal: 20,
    paddingTop: 64,
    paddingBottom: 28,
    zIndex: 40,
  },
  kicker: { color: colors.accent, fontWeight: "700", fontSize: 13 },
  brand: { color: colors.text, fontSize: 28, fontWeight: "800", marginTop: 6, marginBottom: 16 },
  card: {
    backgroundColor: colors.panel,
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 16,
    padding: 14,
    marginBottom: 10,
  },
  title: { color: colors.text, fontSize: 17, fontWeight: "700", marginBottom: 6 },
  body: { color: colors.muted, lineHeight: 22, fontSize: 15 },
  fine: { color: colors.muted, fontSize: 11, lineHeight: 16, marginTop: 4 },
  cta: {
    marginTop: 18,
    backgroundColor: colors.accent2,
    borderRadius: 16,
    minHeight: 52,
    alignItems: "center",
    justifyContent: "center",
  },
  ctaText: { color: "#10200a", fontWeight: "800", fontSize: 17 },
  hint: { color: colors.muted, fontSize: 12, textAlign: "center", marginTop: 10, lineHeight: 18 },
});
