import type { Live2DAction } from './capabilities';
import { interactionPart, INTERACTION_PARTS } from './interaction';
import type { Translator } from '../../i18n';

const sourceText: Translator = (key, ...values) => key.replace(/\{(\d+)\}/g, (_, index) => String(values[Number(index)]));

/** Presentation labels only: these never change resource IDs or automatic bindings. */
export function actionGroupLabel(group: string, ordinal = 1, t: Translator = sourceText): string {
  const name = group.replace(/[\s_.-]/g, '').toLowerCase();
  if (/^(idle|standby|wait)(\d+)?$/.test(name)) return t('自然待机');
  if (/^(think|thinking|doubt)(\d+)?$/.test(name)) return t('思考动作');
  if (/^(smile|happy|joy|success|cheer)(\d+)?$/.test(name)) return t('开心动作');
  if (/^(sad|confused|confusion|error)(\d+)?$/.test(name)) return t('困惑动作');
  if (/^(tap|touch|interact|interaction)$/.test(name)) return t('触碰互动');
  if (/^(tap|touch|pat|flick|click)|(?:tap|touch|pat|flick|click)$/.test(name)) {
    const part = interactionPart(group);
    if (part) return t(INTERACTION_PARTS[part].label);
  }
  return /[\u3400-\u9fff\u3040-\u30ff]/u.test(group) ? group : t('自定义动作组 {0}', ordinal);
}
export function defaultActionName(action: Live2DAction, ordinal = action.index + 1, t: Translator = sourceText): string {
  if (action.kind === 'expression') {
    const name = action.group.replace(/^(expression|exp)[ _-]*/i, '').toLowerCase();
    const labels: Record<string, string> = { smile: '微笑表情', happy: '开心表情', sad: '难过表情', angry: '生气表情', surprised: '惊讶表情', confused: '困惑表情' };
    return labels[name] ? t(labels[name]) : (/[\u3400-\u9fff\u3040-\u30ff]/u.test(name) ? action.group : t('自定义表情 {0}', ordinal));
  }
  const group = actionGroupLabel(action.group);
  return group.startsWith('自定义动作组') ? t('自定义动作 {0}', ordinal) : `${actionGroupLabel(action.group, ordinal, t)} ${action.index + 1}`;
}
export function hitAreaLabel(area: string, t: Translator = sourceText): string {
  const part = interactionPart(area);
  return part ? t(INTERACTION_PARTS[part].label.replace(/互动$/, '区域')) : area;
}
