import { PRESETS, type ProviderProfile } from './aiModels';

// 已知厂商 id → 本地静态 logo 路径的映射。
// 新增厂商时：把 SVG 放进 public/icons/providers/{id}.svg 并在此登记即可，ProviderLogo 自动识别。
export const PROVIDER_ICONS: Record<string, string> = {
  edge: '/icons/providers/edge.svg',
  minimax: '/icons/providers/minimax.svg',
  deepseek: '/icons/providers/deepseek.svg',
  openai: '/icons/providers/openai.svg',
  openrouter: '/icons/providers/openrouter.svg',
  qwen: '/icons/providers/qwen.svg',
  moonshot: '/icons/providers/moonshot.svg',
  zhipu: '/icons/providers/zhipu.svg',
  siliconflow: '/icons/providers/siliconflow.svg',
  volcengine: '/icons/providers/volcengine.svg',
  gemini: '/icons/providers/gemini.svg',
  groq: '/icons/providers/groq.svg',
  mistral: '/icons/providers/mistral.svg',
  mymemory: '/icons/providers/mymemory.svg',
};

export type ProviderLogoProfile = Pick<ProviderProfile, 'id' | 'name'> & Partial<Pick<ProviderProfile, 'presetId' | 'baseUrl'>>;

/** 旧配置没有品牌字段时，通过已知 id 或官方端点识别，避免按可编辑的名称猜测。 */
export function getProviderIcon(profile: ProviderLogoProfile | null): string | undefined {
  if (!profile) return undefined;
  for (const id of [profile.presetId, profile.id]) {
    if (id && Object.prototype.hasOwnProperty.call(PROVIDER_ICONS, id)) return PROVIDER_ICONS[id];
  }
  if (!profile.baseUrl) return undefined;
  try {
    const origin = new URL(profile.baseUrl).origin;
    const preset = PRESETS.find((item) => new URL(item.baseUrl).origin === origin);
    return preset ? PROVIDER_ICONS[preset.id] : undefined;
  } catch {
    return undefined;
  }
}
