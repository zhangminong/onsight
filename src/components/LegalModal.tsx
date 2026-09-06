import { Modal, Pressable, ScrollView, StyleSheet, Text, View } from "react-native";

import { t, type UiLang } from "../i18n";
import { legalCopy } from "../lib/legal";
import { colors } from "../theme";

export type LegalKind = "privacy" | "terms";

type Props = {
  visible: boolean;
  kind: LegalKind;
  lang?: UiLang;
  onClose: () => void;
};

export function LegalModal({ visible, kind, lang, onClose }: Props) {
  const c = t(lang);
  const { title, body } = legalCopy(kind, lang);
  return (
    <Modal visible={visible} animationType="slide" transparent>
      <View style={styles.mask}>
        <View style={styles.sheet}>
          <View style={styles.head}>
            <Text style={styles.title}>{title}</Text>
            <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={c.close}>
              <Text style={styles.closeText}>{c.close}</Text>
            </Pressable>
          </View>
          <ScrollView style={styles.body} contentContainerStyle={styles.bodyContent}>
            <Text style={styles.copy}>{body}</Text>
          </ScrollView>
        </View>
      </View>
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
  title: { color: colors.text, fontSize: 20, fontWeight: "700", flex: 1 },
  close: { minHeight: 44, justifyContent: "center", paddingHorizontal: 8 },
  closeText: { color: colors.okText, fontWeight: "700" },
  body: { maxHeight: 520 },
  bodyContent: { paddingBottom: 24 },
  copy: { color: colors.muted, fontSize: 14, lineHeight: 22 },
});
