import { SYSTEM_PROMPT, t } from "./i18n";

export const APP_NAME = "OnSight";
export const APP_TAGLINE = t("en").tagline;

export const ENABLE_TIPS = false;

/** App Store Connect 产品页需要可公开访问的隐私政策链接。仓库公开并打开 GitHub Pages 后即可访问。 */
export const PRIVACY_POLICY_URL = "https://zhangminong.github.io/onsight/";

export const DEFAULT_SYSTEM_PROMPT = SYSTEM_PROMPT.en;

export const DISCLAIMER = t("en").disclaimer;

export const TIP_PRODUCTS = [
  { id: "com.onsight.tip.1", label: "Coffee", usd: "$0.99" },
  { id: "com.onsight.tip.3", label: "Snack", usd: "$2.99" },
  { id: "com.onsight.tip.5", label: "Lunch", usd: "$4.99" },
  { id: "com.onsight.tip.10", label: "Thanks", usd: "$9.99" },
] as const;

export const HISTORY_LIMIT = 8;
export const MAX_IMAGE_QUALITY = 0.72;
export const MAX_VALID_SHOTS = 3;
/** 思考模式连拍间隔。自动听写和按住说话共用。 */
export const THINK_SHOT_INTERVAL_MS = 3000;
