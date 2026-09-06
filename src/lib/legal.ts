import { t, type UiLang } from "../i18n";

export function legalCopy(kind: "privacy" | "terms", lang: UiLang | undefined) {
  const c = t(lang);
  return kind === "privacy"
    ? { title: c.privacyTitle, body: c.privacyBody }
    : { title: c.termsTitle, body: c.termsBody };
}
