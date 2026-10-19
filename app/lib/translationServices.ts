import { createCustomProfileId } from './aiModels';

export type TranslationProviderId = 'model' | 'mymemory' | string;
export type MachineTranslationProviderId = 'mymemory';
export type TranslationProtocol = 'mymemory';

export interface TranslationService {
  id: string;
  name: string;
  provider: TranslationProtocol;
  email?: string;
  apiKey?: string;
  baseUrl?: string;
}

export interface TranslationServiceSettings {
  services: TranslationService[];
  activeId: string;
  preferredProvider: TranslationProviderId;
  myMemoryEmail?: string;
}

export const TRANSLATION_PRESETS: readonly TranslationService[] = [
  {
    id: 'mymemory',
    name: 'MyMemory',
    provider: 'mymemory',
  },
];

export function createTranslationService(provider: TranslationProtocol = 'mymemory'): TranslationService {
  const preset = TRANSLATION_PRESETS.find((p) => p.provider === provider) ?? TRANSLATION_PRESETS[0];
  return { ...preset, id: createCustomProfileId('translate') };
}

export function isValidMyMemoryEmail(value: string): boolean {
  return value.length <= 254 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(value);
}

export const TRANSLATION_SERVICES_KEY = 'japaneseAnalyzer:translationServices:v1';

export function sanitizeTranslationServices(raw: unknown): TranslationService[] {
  if (!Array.isArray(raw)) return [{ ...TRANSLATION_PRESETS[0] }];
  const services: TranslationService[] = [];
  const ids = new Set<string>();
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const provider = item.provider === 'mymemory' ? 'mymemory' : null;
    if (!provider) continue;
    const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
    if (!id || ids.has(id)) continue;
    ids.add(id);
    const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : 'MyMemory';
    const email = typeof item.email === 'string' ? item.email.trim() : '';
    services.push({
      id,
      name,
      provider,
      ...(isValidMyMemoryEmail(email) ? { email } : {}),
      ...(typeof item.apiKey === 'string' && item.apiKey.trim() ? { apiKey: item.apiKey.trim() } : {}),
      ...(typeof item.baseUrl === 'string' && item.baseUrl.trim() ? { baseUrl: item.baseUrl.trim() } : {}),
    });
  }
  if (!services.some((s) => s.id === 'mymemory')) {
    services.unshift({ ...TRANSLATION_PRESETS[0] });
  }
  return services.length > 0 ? services : [{ ...TRANSLATION_PRESETS[0] }];
}

export function readTranslationServiceSettings(raw: string | null): TranslationServiceSettings {
  try {
    const parsed = JSON.parse(raw || '{}');
    const value = (parsed && typeof parsed === 'object' ? parsed : {}) as Record<string, unknown>;

    let services: TranslationService[];
    if (Array.isArray(value.services)) {
      services = sanitizeTranslationServices(value.services);
    } else {
      const legacyEmail = typeof value.myMemoryEmail === 'string' ? value.myMemoryEmail.trim() : '';
      services = [
        {
          ...TRANSLATION_PRESETS[0],
          ...(isValidMyMemoryEmail(legacyEmail) ? { email: legacyEmail } : {}),
        },
      ];
    }

    const activeId = typeof value.activeId === 'string' && services.some((s) => s.id === value.activeId)
      ? value.activeId
      : services[0].id;

    const preferredProvider = value.preferredProvider === 'model'
      ? 'model'
      : services.some((s) => s.id === value.preferredProvider)
        ? (value.preferredProvider as TranslationProviderId)
        : activeId;

    const myMemoryService = services.find((s) => s.provider === 'mymemory');
    const myMemoryEmail = myMemoryService?.email;

    return {
      preferredProvider,
      activeId,
      services,
      ...(myMemoryEmail ? { myMemoryEmail } : {}),
    };
  } catch {
    return {
      preferredProvider: 'mymemory',
      activeId: 'mymemory',
      services: [{ ...TRANSLATION_PRESETS[0] }],
    };
  }
}

export function getActiveTranslationService(settings: TranslationServiceSettings): TranslationService {
  return settings.services.find((s) => s.id === settings.activeId) || settings.services[0] || TRANSLATION_PRESETS[0];
}

export interface MachineTranslationResponse {
  provider: MachineTranslationProviderId;
  translation: string;
}

export interface TranslationReview {
  translation: string;
  summary: string;
}
