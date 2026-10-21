import { sanitizeActionProfile, type ActionProfile } from './actionProfile';

export const LIVE2D_SETTINGS_KEY = 'japaneseAnalyzer:live2d:v1';

export const LIVE2D_SCALE = { min: 0.4, max: 2.5, default: 1 };
export const LIVE2D_SENSITIVITY = { min: 0.5, max: 2, default: 1 };

export interface Live2DModelConfig {
  scale: number;
  sensitivity: number;
  interaction?: ActionProfile;
}

export interface Live2DSettings {
  enabled: boolean;
  pauseWhenIdle: boolean;
  modelConfigs: Record<string, Live2DModelConfig>;
  modelId: string | null;
  lipSync: boolean;
  trackPointer: boolean;
  minimized: boolean;
  scale: number;
  opacity: number;
  sensitivity: number;
  position: { x: number; y: number } | null;
  mobilePosition: { x: number; y: number } | null;
  capsulePosition?: { x: number; y: number };
  mobileCapsulePosition?: { x: number; y: number };
}

export const DEFAULT_LIVE2D_SETTINGS: Live2DSettings = {
  enabled: false,
  pauseWhenIdle: false,
  modelConfigs: {},
  modelId: null,
  lipSync: true,
  trackPointer: true,
  minimized: false,
  scale: 1,
  opacity: 1,
  sensitivity: 1,
  position: null,
  mobilePosition: null,
};

type StorageReader = Pick<Storage, 'getItem'>;

function clamp(value: unknown, fallback: number, min: number, max: number): number {
  return typeof value === 'number' && Number.isFinite(value)
    ? Math.min(max, Math.max(min, value))
    : fallback;
}

export function sanitizeLive2DSettings(value: unknown): Live2DSettings {
  if (!value || typeof value !== 'object') return { ...DEFAULT_LIVE2D_SETTINGS };
  const source = value as Record<string, unknown>;
  const modelConfigs: Record<string, Live2DModelConfig> = {};
  if (source.modelConfigs && typeof source.modelConfigs === 'object' && !Array.isArray(source.modelConfigs)) {
    for (const [id, config] of Object.entries(source.modelConfigs)) {
      if (!config || typeof config !== 'object' || !id || ['__proto__', 'constructor', 'prototype'].includes(id)) continue;
      const candidate = config as Record<string, unknown>;
      modelConfigs[id] = {
        ...(candidate.interaction ? { interaction: sanitizeActionProfile(candidate.interaction) } : {}),
        scale: clamp(candidate.scale, 1, LIVE2D_SCALE.min, LIVE2D_SCALE.max),
        sensitivity: clamp(candidate.sensitivity, 1, LIVE2D_SENSITIVITY.min, LIVE2D_SENSITIVITY.max),
      };
    }
  }
  const rawPosition = source.position;
  const position = rawPosition && typeof rawPosition === 'object'
    ? rawPosition as Record<string, unknown>
    : null;
  const rawMobilePosition = source.mobilePosition;
  const mobilePosition = rawMobilePosition && typeof rawMobilePosition === 'object'
    ? rawMobilePosition as Record<string, unknown>
    : null;
  const capsulePositions: Pick<Live2DSettings, 'capsulePosition' | 'mobileCapsulePosition'> = {};
  for (const key of ['capsulePosition', 'mobileCapsulePosition'] as const) {
    const point = source[key] as { x?: unknown; y?: unknown } | null;
    if (point && typeof point.x === 'number' && Number.isFinite(point.x) && typeof point.y === 'number' && Number.isFinite(point.y)) capsulePositions[key] = { x: point.x, y: point.y };
  }

  return {
    ...capsulePositions,
    enabled: source.enabled === true,
    pauseWhenIdle: source.pauseWhenIdle === true,
    modelConfigs,
    modelId: typeof source.modelId === 'string' && source.modelId.trim()
      ? source.modelId.trim() : null,
    lipSync: source.lipSync !== false,
    trackPointer: source.trackPointer !== false,
    minimized: source.minimized === true,
    scale: clamp(source.scale, 1, LIVE2D_SCALE.min, LIVE2D_SCALE.max),
    opacity: clamp(source.opacity, 1, 0.3, 1),
    sensitivity: clamp(source.sensitivity, 1, LIVE2D_SENSITIVITY.min, LIVE2D_SENSITIVITY.max),
    position: position && typeof position.x === 'number' && Number.isFinite(position.x)
      && typeof position.y === 'number' && Number.isFinite(position.y)
      ? { x: position.x, y: position.y } : null,
    mobilePosition: mobilePosition && typeof mobilePosition.x === 'number' && Number.isFinite(mobilePosition.x)
      && typeof mobilePosition.y === 'number' && Number.isFinite(mobilePosition.y)
      ? { x: mobilePosition.x, y: mobilePosition.y } : null,
  };
}

export function loadLive2DSettings(storage: StorageReader): Live2DSettings {
  try {
    const raw = storage.getItem(LIVE2D_SETTINGS_KEY);
    return raw ? sanitizeLive2DSettings(JSON.parse(raw)) : { ...DEFAULT_LIVE2D_SETTINGS };
  } catch {
    return { ...DEFAULT_LIVE2D_SETTINGS };
  }
}

/** Model switches, not sanitization, restore model-specific preferences. */
export function selectLive2DModel(settings: Live2DSettings, modelId: string | null): Live2DSettings {
  const modelConfigs = { ...settings.modelConfigs };
  if (settings.modelId) modelConfigs[settings.modelId] = { ...modelConfigs[settings.modelId], scale: settings.scale, sensitivity: settings.sensitivity };
  const config = modelId ? modelConfigs[modelId] : undefined;
  return sanitizeLive2DSettings({ ...settings, modelId, modelConfigs,
    scale: config?.scale ?? 1, sensitivity: config?.sensitivity ?? 1 });
}

export function updateLive2DModelConfig(
  settings: Live2DSettings, modelId: string | null, patch: Partial<Live2DModelConfig>,
): Live2DSettings {
  if (settings.modelId !== modelId) return settings;
  const config = { ...(modelId ? settings.modelConfigs[modelId] : {}), scale: settings.scale, sensitivity: settings.sensitivity, ...patch };
  return sanitizeLive2DSettings({ ...settings, scale: config.scale, sensitivity: config.sensitivity, modelConfigs: modelId
    ? { ...settings.modelConfigs, [modelId]: config } : settings.modelConfigs });
}

export function removeLive2DModelConfig(settings: Live2DSettings, modelId: string): Live2DSettings {
  const modelConfigs = { ...settings.modelConfigs };
  delete modelConfigs[modelId];
  return { ...settings, modelConfigs, modelId: settings.modelId === modelId ? null : settings.modelId };
}
