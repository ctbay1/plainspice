/**
 * A tiny translation helper for the app shell: t('key', { name: value }) fills {name}
 * placeholders; tn('base', count) picks the plural form base_one / base_other (base_zero when the
 * catalog has one) with Intl.PluralRules. One catalog today (en-US); tr-TR comes next with the
 * same keys, and LOCALE then follows the user's choice.
 */
import { en, type Messages } from './en.ts';

/** The locale of the UI and of React Aria's own strings (I18nProvider). */
export const LOCALE = 'en-US';

const catalog: Messages = en;
const plurals = new Intl.PluralRules(LOCALE);

export type MessageKey = keyof typeof en;
type Params = Readonly<Record<string, string | number>>;

/** Keys that have plural forms: 'checksCount' for checksCount_one / checksCount_other. */
export type PluralBase = {
  [K in MessageKey]: K extends `${infer B}_other` ? B : never;
}[MessageKey];

function fill(template: string, params?: Params): string {
  if (!params) return template;
  return template.replace(/\{(\w+)\}/g, (match, name: string) => (name in params ? String(params[name]) : match));
}

export function t(key: MessageKey, params?: Params): string {
  return fill(catalog[key], params);
}

/** The plural form for `count` ({count} is filled in too). */
export function tn(base: PluralBase, count: number, params?: Params): string {
  const all = { count, ...params };
  const zero = `${base}_zero` as MessageKey;
  if (count === 0 && zero in catalog) return fill(catalog[zero], all);
  const form = `${base}_${plurals.select(count)}` as MessageKey;
  return fill(form in catalog ? catalog[form] : catalog[`${base}_other` as MessageKey], all);
}
