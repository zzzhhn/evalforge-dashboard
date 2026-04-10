import { cookies } from "next/headers";
import { translations, type Locale, type TranslationKey } from "./translations";

export async function getLocale(): Promise<Locale> {
  const cookieStore = await cookies();
  const raw = cookieStore.get("locale")?.value;
  return raw === "en" ? "en" : "zh";
}

function interpolate(
  template: string,
  params?: Record<string, string | number>
): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (_, key) =>
    params[key] !== undefined ? String(params[key]) : `{${key}}`
  );
}

export function t(
  locale: Locale,
  key: TranslationKey,
  params?: Record<string, string | number>
): string {
  const value = translations[locale][key] ?? translations.zh[key] ?? key;
  return interpolate(value, params);
}
