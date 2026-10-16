import { messages } from './messages';
import { appMessages } from './appMessages';

export { messages } from './messages';
export { appMessages } from './appMessages';
export type MobileLocale = keyof typeof messages;
export type SourceMessageKey = keyof typeof messages.en;
export type AppMessageKey = keyof typeof appMessages.en;
export type MessageKey = SourceMessageKey | AppMessageKey;
export type TranslationValue = string | number | boolean | null;
export type TranslationArguments =
  | readonly TranslationValue[]
  | Readonly<Record<string, TranslationValue | undefined>>;

/** The source supports Chinese and English, with English as its fallback. */
export function normalizeLocale(locale: string | null | undefined): MobileLocale {
  return locale?.toLowerCase().split(/[-_]/)[0] === 'zh' ? 'zh' : 'en';
}

/**
 * Match LocaleHelper.kt: no arguments preserve placeholders; supplied arguments
 * remove unresolved placeholders. Unknown message keys remain visible as keys.
 */
export function translate(
  locale: MobileLocale,
  key: MessageKey | (string & {}),
  args?: TranslationArguments,
): string {
  const catalog = messages[locale] as Readonly<Record<string, string>>;
  const fallback = messages.en as Readonly<Record<string, string>>;
  const own = (table: Readonly<Record<string, string>>) =>
    Object.prototype.hasOwnProperty.call(table, key) ? table[key] : undefined;
  const template = own(catalog) ?? own(fallback) ?? own(appMessages[locale]) ?? own(appMessages.en) ?? key;
  if (args === undefined || Object.keys(args).length === 0) return template;

  if (Array.isArray(args)) {
    return template.replace(/\{([+-]?\d+)\}/g, (placeholder: string, index: string) => {
      const position = Number(index);
      if (!Number.isInteger(position) || position < -2147483648 || position > 2147483647) {
        return placeholder;
      }
      if (position < 0) throw new RangeError('Negative positional translation index');
      if (position >= args.length) return '';
      return String(args[position]);
    });
  }

  const named = args as Readonly<Record<string, TranslationValue | undefined>>;
  return template.replace(/\{([^}]+)\}/g, (_placeholder: string, name: string) => {
    const value = named[name];
    return value == null ? '' : String(value);
  });
}

export function createTranslator(locale: MobileLocale) {
  return (key: MessageKey | (string & {}), args?: TranslationArguments) =>
    translate(locale, key, args);
}
