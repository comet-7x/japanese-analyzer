// Keep the supported languages and default aligned with app/i18n/index.ts.
const supported = ['zh-CN', 'zh-TW', 'en', 'ko'];
export const normalizeLauncherLocale = value => supported.includes(value) ? value : 'zh-CN';

export async function readLauncherLocale({ readNative, readStored }) {
  if (readNative) {
    try {
      const value = await readNative();
      if (supported.includes(value)) return value;
    } catch { /* The launcher remains usable if native preference lookup fails. */ }
  }
  try { return normalizeLauncherLocale(readStored()); }
  catch { return 'zh-CN'; }
}
