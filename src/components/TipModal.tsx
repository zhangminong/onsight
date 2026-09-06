import { useEffect, useRef, useState } from "react";
import { Alert, Modal, Pressable, StyleSheet, Text, View } from "react-native";
import { ErrorCode, useIAP } from "expo-iap";

import { TIP_PRODUCTS } from "../constants";
import { t, type UiLang } from "../i18n";
import { tapSuccess } from "../lib/haptics";
import { isIapAvailable, TIP_SKUS } from "../lib/iap";
import { colors } from "../theme";

type Props = {
  visible: boolean;
  lang?: UiLang;
  onClose: () => void;
};

export function TipModal({ visible, lang, onClose }: Props) {
  if (!isIapAvailable()) {
    return <TipSheet visible={visible} lang={lang} onClose={onClose} />;
  }
  return <TipStore visible={visible} lang={lang} onClose={onClose} />;
}

function TipStore({ visible, lang, onClose }: Props) {
  const c = t(lang);
  const [busySku, setBusySku] = useState<string | null>(null);
  const [status, setStatus] = useState("");
  const userInitiatedRef = useRef(false);

  const { connected, products, fetchProducts, requestPurchase, finishTransaction, getAvailablePurchases } = useIAP({
    onPurchaseSuccess: async (purchase) => {
      const fromUser = userInitiatedRef.current;
      userInitiatedRef.current = false;
      try {
        await finishTransaction({ purchase, isConsumable: true });
        if (fromUser) {
          tapSuccess();
          Alert.alert(c.tipThanksTitle, c.tipThanksBody);
        }
      } catch (error) {
        if (fromUser) {
          Alert.alert(c.tipIncomplete, error instanceof Error ? error.message : c.tipIncompleteFallback);
        }
      } finally {
        setBusySku(null);
      }
    },
    onPurchaseError: (error) => {
      userInitiatedRef.current = false;
      setBusySku(null);
      if (error.code === ErrorCode.UserCancelled) return;
      Alert.alert(c.tipUnavailable, error.message || c.tipUnavailableBody);
    },
  });

  useEffect(() => {
    if (!visible || !connected) return;
    setStatus(c.tipLoadingPrices);
    void fetchProducts({ skus: TIP_SKUS, type: "in-app" })
      .then(() => {
        setStatus("");
        return getAvailablePurchases();
      })
      .catch(() => setStatus(c.tipNoProducts));
  }, [c.tipLoadingPrices, c.tipNoProducts, connected, fetchProducts, getAvailablePurchases, visible]);

  const buy = (sku: string) => {
    if (busySku) return;
    setBusySku(sku);
    userInitiatedRef.current = true;
    void requestPurchase({
      request: {
        apple: { sku },
        google: { skus: [sku] },
      },
      type: "in-app",
    }).catch((error) => {
      userInitiatedRef.current = false;
      setBusySku(null);
      Alert.alert(c.tipStartFailed, error instanceof Error ? error.message : c.tipRetry);
    });
  };

  return (
    <TipSheet
      visible={visible}
      lang={lang}
      onClose={onClose}
      status={status || (connected ? "" : c.tipConnecting)}
      prices={Object.fromEntries(products.map((item) => [item.id, item.displayPrice]))}
      busySku={busySku}
      onBuy={buy}
    />
  );
}

function TipSheet({
  visible,
  lang,
  onClose,
  status,
  prices,
  busySku,
  onBuy,
}: Props & {
  status?: string;
  prices?: Record<string, string>;
  busySku?: string | null;
  onBuy?: (sku: string) => void;
}) {
  const c = t(lang);
  return (
    <Modal visible={visible} animationType="fade" transparent>
      <View style={styles.mask}>
        <View style={styles.sheet}>
          <Text style={styles.title}>{c.tipTitle}</Text>
          <Text style={styles.body}>{c.tipBody}</Text>
          {status ? <Text style={styles.status}>{status}</Text> : null}
          <View style={styles.grid}>
            {TIP_PRODUCTS.map((item) => (
              <Pressable
                key={item.id}
                style={[styles.card, busySku === item.id && styles.cardBusy]}
                disabled={Boolean(busySku)}
                accessibilityRole="button"
                accessibilityLabel={c.tipA11y(item.label, prices?.[item.id] || item.usd)}
                onPress={() => {
                  if (onBuy) {
                    onBuy(item.id);
                    return;
                  }
                  Alert.alert(c.tipNeedBuildTitle, c.tipNeedBuildBody);
                }}
              >
                <Text style={styles.cardLabel}>{item.label}</Text>
                <Text style={styles.cardPrice}>{prices?.[item.id] || item.usd}</Text>
              </Pressable>
            ))}
          </View>
          <Pressable onPress={onClose} style={styles.close} accessibilityRole="button" accessibilityLabel={c.closeTips}>
            <Text style={styles.closeText}>{c.close}</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  mask: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.55)",
    justifyContent: "center",
    padding: 22,
  },
  sheet: {
    backgroundColor: colors.panel,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: colors.line,
    padding: 18,
  },
  title: { color: colors.text, fontSize: 20, fontWeight: "700" },
  body: { color: colors.muted, marginTop: 8, lineHeight: 20 },
  status: { color: colors.warnText, marginTop: 10, fontSize: 13, lineHeight: 18 },
  grid: { flexDirection: "row", flexWrap: "wrap", gap: 10, marginTop: 16 },
  card: {
    width: "47%",
    borderWidth: 1,
    borderColor: colors.line,
    borderRadius: 12,
    paddingVertical: 14,
    alignItems: "center",
    backgroundColor: colors.ink,
    minHeight: 72,
    justifyContent: "center",
  },
  cardBusy: { opacity: 0.55 },
  cardLabel: { color: colors.muted, fontSize: 12 },
  cardPrice: { color: colors.accent, fontSize: 18, fontWeight: "700", marginTop: 4 },
  close: { alignSelf: "flex-end", marginTop: 16, minHeight: 44, justifyContent: "center", padding: 8 },
  closeText: { color: colors.text, fontWeight: "600" },
});
