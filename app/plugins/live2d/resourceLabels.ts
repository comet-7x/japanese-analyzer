import type { Translator } from '../../i18n';
import type { ActionProfile } from './actionProfile';
import { hitAreaLabel } from './actionLabels';

export function resourceTargetLabel(target: string, profile: ActionProfile, t: Translator): string {
  if (target === 'idle') return t('平时自动播放');
  if (target === 'defaultExpression') return t('默认外观');
  if (target.startsWith('zone:')) return t('轻点 {0}', profile.hotspots.find(item => item.id === target.slice(5))?.name ?? t('自定义区域'));
  if (target.startsWith('area:')) return t('轻点 {0}', hitAreaLabel(target.slice(5), t));
  if (target.startsWith('key:')) return t('按 {0}', target.slice(4));
  const labels: Record<string, string> = { analyzing: '开始分析', success: '分析成功', error: '分析失败' };
  return t(labels[target.slice(5)] ?? target);
}
