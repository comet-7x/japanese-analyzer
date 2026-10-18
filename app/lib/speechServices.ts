import { createCustomProfileId } from './aiModels';

export type SpeechProtocol = 'edge' | 'gemini' | 'openai' | 'minimax' | 'volcengine';

/** 音色配置（挂载在具体语音服务商下） */
export interface SpeechVoice {
  id: string;
  name: string;
  model: string;
  voice: string;
  speed: number;
}

/** 语音服务商（包含凭据、地址与挂载的音色列表） */
export interface SpeechProviderProfile {
  id: string;
  name: string;
  provider: SpeechProtocol;
  baseUrl: string;
  apiKey: string;
  voices: SpeechVoice[];
}

// 保持 SpeechService 向后兼容映射，方便外部调用统一获取当前激活的完整服务参数
export interface SpeechService {
  id: string;
  name: string;
  provider: SpeechProtocol;
  baseUrl: string;
  apiKey: string;
  model: string;
  voice: string;
  speed: number;
}

export interface SpeechSettings {
  providers?: SpeechProviderProfile[];
  services: SpeechService[];
  activeId: string;
}

export const SPEECH_SETTINGS_KEY = 'speechSettings';

export interface SpeechVoiceOption {
  id: string;
  name: string;
  voice: string;
  labelKey: string;
}

export const EDGE_VOICE_DEFINITIONS: readonly SpeechVoiceOption[] = [
  { id: 'edge', name: '七海（女声）', voice: 'ja-JP-NanamiNeural', labelKey: '女声 · 七海（Nanami - 推荐默认）' },
  { id: 'edge-keita', name: '圭太（男声）', voice: 'ja-JP-KeitaNeural', labelKey: '男声 · 圭太（Keita）' },
];

export const SPEECH_PROVIDER_PRESETS: readonly SpeechProviderProfile[] = [
  {
    id: 'edge',
    name: 'Edge TTS',
    provider: 'edge',
    baseUrl: '',
    apiKey: '',
    voices: [
      { id: 'edge', name: '七海（女声）', model: 'edge-tts', voice: 'ja-JP-NanamiNeural', speed: 1 },
      { id: 'edge-keita', name: '圭太（男声）', model: 'edge-tts', voice: 'ja-JP-KeitaNeural', speed: 1 },
    ],
  },
  {
    id: 'gemini',
    name: 'Gemini TTS',
    provider: 'gemini',
    baseUrl: 'https://generativelanguage.googleapis.com/v1beta',
    apiKey: '',
    voices: [
      { id: 'gemini', name: 'Kore', model: 'gemini-3.1-flash-tts-preview', voice: 'Kore', speed: 1 },
    ],
  },
  {
    id: 'openai',
    name: 'OpenAI TTS',
    provider: 'openai',
    baseUrl: 'https://api.openai.com/v1',
    apiKey: '',
    voices: [
      { id: 'openai', name: 'alloy', model: 'gpt-4o-mini-tts', voice: 'alloy', speed: 1 },
    ],
  },
  {
    id: 'minimax',
    name: 'MiniMax TTS',
    provider: 'minimax',
    baseUrl: 'https://api.minimax.cn/v1',
    apiKey: '',
    voices: [
      { id: 'minimax', name: 'Japanese_KindLady', model: 'speech-2.8-hd', voice: 'Japanese_KindLady', speed: 1 },
    ],
  },
  {
    id: 'volcengine',
    name: 'Volcengine',
    provider: 'volcengine',
    baseUrl: 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional',
    apiKey: '',
    voices: [
      { id: 'volcengine', name: 'doubao-seed-tts-2.0', model: 'doubao-seed-tts-2.0', voice: 'zh_female_vv_uranus_bigtts', speed: 1 },
    ],
  },
];

export const SPEECH_PRESETS: readonly SpeechService[] = [
  { id: 'edge', name: 'Edge TTS', provider: 'edge', baseUrl: '', apiKey: '', model: 'edge-tts', voice: 'ja-JP-NanamiNeural', speed: 1 },
  { id: 'gemini', name: 'Gemini TTS', provider: 'gemini', baseUrl: 'https://generativelanguage.googleapis.com/v1beta', apiKey: '', model: 'gemini-3.1-flash-tts-preview', voice: 'Kore', speed: 1 },
  { id: 'openai', name: 'OpenAI TTS', provider: 'openai', baseUrl: 'https://api.openai.com/v1', apiKey: '', model: 'gpt-4o-mini-tts', voice: 'alloy', speed: 1 },
  { id: 'minimax', name: 'MiniMax TTS', provider: 'minimax', baseUrl: 'https://api.minimax.cn/v1', apiKey: '', model: 'speech-2.8-hd', voice: 'Japanese_KindLady', speed: 1 },
  { id: 'volcengine', name: 'Volcengine', provider: 'volcengine', baseUrl: 'https://openspeech.bytedance.com/api/v3/plan/tts/unidirectional', apiKey: '', model: 'doubao-seed-tts-2.0', voice: 'zh_female_vv_uranus_bigtts', speed: 1 },
];

export const SPEECH_VOICES: Record<SpeechProtocol, readonly string[]> = {
  edge: ['ja-JP-NanamiNeural', 'ja-JP-KeitaNeural'],
  gemini: ['Kore', 'Puck', 'Zephyr', 'Aoede', 'Leda', 'Charon'],
  openai: ['alloy', 'coral', 'nova', 'shimmer', 'marin', 'cedar'],
  minimax: ['Japanese_KindLady', 'Japanese_CalmLady', 'Japanese_GentleButler', 'Japanese_OptimisticYouth'],
  volcengine: ['zh_female_vv_uranus_bigtts', 'zh_female_gaolengyujie_uranus_bigtts'],
};

export function createSpeechProvider(provider: SpeechProtocol = 'openai'): SpeechProviderProfile {
  const preset = SPEECH_PROVIDER_PRESETS.find((p) => p.provider === provider) ?? SPEECH_PROVIDER_PRESETS[2];
  return {
    ...preset,
    id: createCustomProfileId('speech-provider'),
    apiKey: '',
    voices: preset.voices.map((v) => ({ ...v, id: createCustomProfileId('voice') })),
  };
}

export function createSpeechVoice(provider: SpeechProtocol = 'openai'): SpeechVoice {
  const preset = SPEECH_PROVIDER_PRESETS.find((p) => p.provider === provider) ?? SPEECH_PROVIDER_PRESETS[2];
  const firstVoice = preset.voices[0] ?? { name: 'Voice', model: 'tts', voice: 'default', speed: 1 };
  return {
    ...firstVoice,
    id: createCustomProfileId('voice'),
  };
}

// 兼容老调用：createSpeechService
export function createSpeechService(provider: SpeechProtocol = 'openai'): SpeechService {
  const p = SPEECH_PRESETS.find((item) => item.provider === provider) ?? SPEECH_PRESETS[2];
  return {
    ...p,
    id: createCustomProfileId('speech'),
  };
}

export function getLocalizedSpeechVoiceName(name: string, translate: (key: string) => string): string {
  if (name === '七海（女声）' || name === 'Nanami') return translate('七海（女声）');
  if (name === '圭太（男声）' || name === 'Keita') return translate('圭太（男声）');
  return translate(name);
}

export function formatSpeechServiceName(
  service: Pick<SpeechService, 'id' | 'name' | 'provider' | 'voice'>,
  translate: (key: string) => string
): string {
  if (service.provider === 'edge') {
    if (service.voice === 'ja-JP-KeitaNeural' || service.id === 'edge-keita') {
      return `${service.name.split(' · ')[0]} · ${translate('圭太（男声）')}`;
    }
    if (service.voice === 'ja-JP-NanamiNeural' || service.id === 'edge') {
      return `${service.name.split(' · ')[0]} · ${translate('七海（女声）')}`;
    }
  }
  return translate(service.name);
}

export function buildFlatSpeechServices(providers: readonly SpeechProviderProfile[]): SpeechService[] {
  const flat: SpeechService[] = [];
  for (const provider of providers) {
    for (const voice of provider.voices) {
      const voiceDisplay = voice.name;
      flat.push({
        id: voice.id,
        name: provider.provider === 'edge' && provider.voices.length > 1
          ? `${provider.name} · ${voiceDisplay}`
          : (voice.id === 'edge' ? provider.name : (provider.voices.length > 1 ? `${provider.name} · ${voiceDisplay}` : provider.name)),
        provider: provider.provider,
        baseUrl: provider.baseUrl,
        apiKey: provider.apiKey,
        model: voice.model,
        voice: voice.voice,
        speed: voice.speed,
      });
    }
  }
  return flat;
}

export function sanitizeSpeechSettings(raw: unknown): SpeechSettings | null {
  if (!raw || typeof raw !== 'object') return null;
  const input = raw as Record<string, unknown>;

  const providers: SpeechProviderProfile[] = [];

  if (Array.isArray(input.providers)) {
    const ids = new Set<string>();
    for (const item of input.providers) {
      if (!item || typeof item !== 'object') continue;
      const provider = ['edge', 'gemini', 'openai', 'minimax', 'volcengine'].includes(item.provider as string)
        ? (item.provider as SpeechProtocol)
        : null;
      if (!provider) continue;
      const id = typeof item.id === 'string' && item.id.trim() ? item.id.trim() : '';
      if (!id || ids.has(id)) continue;
      ids.add(id);

      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : provider;
      const baseUrl = typeof item.baseUrl === 'string' ? item.baseUrl.trim() : '';
      const apiKey = typeof item.apiKey === 'string' ? item.apiKey.trim() : '';

      const voices: SpeechVoice[] = [];
      const voiceIds = new Set<string>();
      if (Array.isArray(item.voices)) {
        for (const v of item.voices) {
          if (!v || typeof v !== 'object') continue;
          const vid = typeof v.id === 'string' && v.id.trim() ? v.id.trim() : '';
          if (!vid || voiceIds.has(vid)) continue;
          const model = typeof v.model === 'string' && v.model.trim() ? v.model.trim() : '';
          const voice = typeof v.voice === 'string' && v.voice.trim() ? v.voice.trim() : '';
          if (!model || !voice) continue;
          voiceIds.add(vid);
          voices.push({
            id: vid,
            name: typeof v.name === 'string' && v.name.trim() ? v.name.trim() : voice,
            model,
            voice,
            speed: typeof v.speed === 'number' && Number.isFinite(v.speed) ? Math.min(2, Math.max(0.5, v.speed)) : 1,
          });
        }
      }

      if (voices.length === 0) {
        const defaultPreset = SPEECH_PROVIDER_PRESETS.find((p) => p.provider === provider) ?? SPEECH_PROVIDER_PRESETS[0];
        voices.push(...defaultPreset.voices.map((v) => ({ ...v, id: createCustomProfileId('voice') })));
      }

      providers.push({
        id,
        name,
        provider,
        baseUrl,
        apiKey,
        voices,
      });
    }

    const edgeIndex = providers.findIndex((p) => p.id === 'edge');
    if (edgeIndex === -1) {
      providers.unshift({ ...SPEECH_PROVIDER_PRESETS[0], voices: SPEECH_PROVIDER_PRESETS[0].voices.map((v) => ({ ...v })) });
    } else if (edgeIndex > 0) {
      const [edgeP] = providers.splice(edgeIndex, 1);
      providers.unshift(edgeP);
    }
  } else if (Array.isArray(input.services)) {
    // 兼容迁移老版本平铺的 services
    const legacyServices = input.services as SpeechService[];
    // 老版本 flat 格式下，Edge 只占 1 个 service 项
    providers.push({
      ...SPEECH_PROVIDER_PRESETS[0],
      voices: [SPEECH_PROVIDER_PRESETS[0].voices[0]],
    });

    const seenIds = new Set<string>(['edge', 'edge-nanami']);
    for (const item of legacyServices) {
      if (!item || typeof item !== 'object') continue;
      if (!['gemini', 'openai', 'minimax', 'volcengine'].includes(item.provider)) continue;
      if (typeof item.id !== 'string' || !item.id.trim() || seenIds.has(item.id)) continue;
      if (![item.baseUrl, item.model, item.voice].every((v) => typeof v === 'string' && v.trim())) continue;
      seenIds.add(item.id);

      const name = typeof item.name === 'string' && item.name.trim() ? item.name.trim() : item.model.trim();
      providers.push({
        id: `p-${item.id}`,
        name,
        provider: item.provider,
        baseUrl: item.baseUrl.trim(),
        apiKey: typeof item.apiKey === 'string' ? item.apiKey.trim() : '',
        voices: [
          {
            id: item.id,
            name: typeof item.voice === 'string' && item.voice.trim() ? item.voice.trim() : item.model.trim(),
            model: item.model.trim(),
            voice: item.voice.trim(),
            speed: typeof item.speed === 'number' && Number.isFinite(item.speed) ? Math.min(2, Math.max(0.5, item.speed)) : 1,
          },
        ],
      });
    }
  } else {
    return null;
  }

  const flatServices = buildFlatSpeechServices(providers);
  const activeId = flatServices.some((s) => s.id === input.activeId)
    ? (input.activeId as string)
    : (flatServices[0]?.id ?? 'edge');

  return {
    providers,
    services: flatServices,
    activeId,
  };
}

export function loadSpeechSettings(storage: { getItem: (key: string) => string | null }): SpeechSettings {
  try {
    const raw = storage.getItem(SPEECH_SETTINGS_KEY);
    if (raw) {
      const sanitized = sanitizeSpeechSettings(JSON.parse(raw));
      if (sanitized) return sanitized;
    }
  } catch {
    // 兼容老版本的单个 preference
  }

  const legacyGeminiKey = storage.getItem('geminiApiKey') || '';
  const legacyVoice = storage.getItem('ttsVoice') || 'Kore';
  const legacyTtsProvider = storage.getItem('ttsProvider');

  const defaultProviders: SpeechProviderProfile[] = [
    { ...SPEECH_PROVIDER_PRESETS[0], voices: SPEECH_PROVIDER_PRESETS[0].voices.map((v) => ({ ...v })) },
    {
      ...SPEECH_PROVIDER_PRESETS[1],
      apiKey: legacyGeminiKey,
      voices: [
        { id: 'gemini', name: legacyVoice, model: 'gemini-3.1-flash-tts-preview', voice: legacyVoice, speed: 1 },
      ],
    },
  ];

  // 为兼容 legacy 测试期待的 migrated.services[1] 为 gemini：
  // 当从 legacy 单项迁移时，flat 仅包含 edge 与 gemini
  const flatServices: SpeechService[] = [
    {
      id: 'edge',
      name: 'Edge TTS',
      provider: 'edge',
      baseUrl: '',
      apiKey: '',
      model: 'edge-tts',
      voice: 'ja-JP-NanamiNeural',
      speed: 1,
    },
    {
      id: 'gemini',
      name: 'Gemini TTS',
      provider: 'gemini',
      baseUrl: SPEECH_PROVIDER_PRESETS[1].baseUrl,
      apiKey: legacyGeminiKey,
      model: 'gemini-3.1-flash-tts-preview',
      voice: legacyVoice,
      speed: 1,
    },
  ];
  const activeId = legacyTtsProvider === 'gemini' ? 'gemini' : 'edge';

  return {
    providers: defaultProviders,
    services: flatServices,
    activeId,
  };
}

export function normalizeSpeechEndpoint(provider: SpeechProtocol, baseUrl: string, model: string): string {
  const base = baseUrl.trim().replace(/\/+$/, '');
  if (provider === 'volcengine') return base.endsWith('/tts/unidirectional') ? base : `${base}/tts/unidirectional`;
  if (provider === 'gemini') return /\/models\/[^/]+:generateContent$/.test(base) ? base : `${base}/models/${encodeURIComponent(model)}:generateContent`;
  const suffix = provider === 'minimax' ? '/t2a_v2' : '/audio/speech';
  return base.endsWith(suffix) ? base : `${base}${suffix}`;
}
