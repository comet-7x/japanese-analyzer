export type TranslationProviderId = 'model' | 'google' | 'baidu';
export type MachineTranslationProviderId = Exclude<TranslationProviderId, 'model'>;

export interface TranslationServiceSettings {
  preferredProvider: TranslationProviderId;
  google: { apiKey: string };
  baidu: { appId: string; secret: string };
}

export const TRANSLATION_SERVICES_KEY = 'japaneseAnalyzer:translationServices:v1';
export const DEFAULT_TRANSLATION_SERVICE_SETTINGS: TranslationServiceSettings = {
  preferredProvider: 'model',
  google: { apiKey: '' },
  baidu: { appId: '', secret: '' },
};

export function readTranslationServiceSettings(raw: string | null): TranslationServiceSettings {
  try {
    const value = JSON.parse(raw || '{}') as Partial<TranslationServiceSettings>;
    const preferredProvider = value.preferredProvider;
    return {
      preferredProvider: preferredProvider === 'google' || preferredProvider === 'baidu' ? preferredProvider : 'model',
      google: { apiKey: typeof value.google?.apiKey === 'string' ? value.google.apiKey : '' },
      baidu: {
        appId: typeof value.baidu?.appId === 'string' ? value.baidu.appId : '',
        secret: typeof value.baidu?.secret === 'string' ? value.baidu.secret : '',
      },
    };
  } catch {
    return {
      preferredProvider: 'model',
      google: { apiKey: '' },
      baidu: { appId: '', secret: '' },
    };
  }
}

export interface MachineTranslationResponse {
  provider: MachineTranslationProviderId;
  translation: string;
}

export interface TranslationReview {
  translation: string;
  summary: string;
}
