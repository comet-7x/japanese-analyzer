'use client';

import { useLanguage } from '../../contexts/LanguageContext';
import { INTERACTION_PARTS, type InteractionPart } from './interaction';
import { MOOD_ACTIONS, type Live2DCapabilities } from './capabilities';
import { actionName, automaticAreaAction, resolveActionBinding, type ActionProfile } from './actionProfile';
import { actionGroupLabel } from './actionLabels';

/** @deprecated Historical summary, retained for reference; the workspace uses effectiveResourceUses instead. */
export default function Live2DCapabilitySummary({ capabilities, profile }: { capabilities: Live2DCapabilities; profile?: ActionProfile }) {
  const { t } = useLanguage();
  const parts = (Object.keys(INTERACTION_PARTS) as InteractionPart[]).filter(part =>
    part === 'head' || part === 'body' || capabilities.interactions.some(item => item.part === part && item.motion));
  const status = (target: string, auto?: typeof capabilities.actions[number]) => {
    const result = resolveActionBinding(profile, target, capabilities, auto);
    return t(result.status === 'disabled' ? '已禁用' : result.status === 'missing' ? '绑定资源已缺失'
      : result.status === 'none' ? '未绑定' : profile?.bindings[target]?.mode === 'manual' ? '手动绑定' : '自动启用');
  };
  const count = capabilities.motionGroups.reduce((total, group) => total + group.count, 0);
  return <>
    <dl className="live2d-capability-list">
      {parts.map(part => {
        const zone = profile?.hotspots.find(item => item.part === part);
        const area = capabilities.interactions.find(item => item.part === part)?.area;
        return <div key={part}><dt>{t(INTERACTION_PARTS[part].label)}</dt><dd>{zone || area ? status(zone ? `zone:${zone.id}` : `area:${area}`, area ? automaticAreaAction(area, capabilities) : undefined) : t('模型未提供')}</dd></div>;
      })}
      {profile?.hotspots.filter(item => !item.part).map(item => <div key={item.id}><dt>{item.name}</dt><dd>{status(`zone:${item.id}`)}</dd></div>)}
      {capabilities.interactions.filter(item => !item.part).map(item => <div key={item.area}><dt>{item.area}</dt><dd>{status(`area:${item.area}`, automaticAreaAction(item.area, capabilities))}</dd></div>)}
      {Object.entries(MOOD_ACTIONS).map(([mood, definition]) => {
        const binding = capabilities.moods[mood as keyof typeof capabilities.moods];
        const auto = capabilities.actions.find(item => binding.expression ? item.kind === 'expression' && item.group === binding.expression : item.kind === 'motion' && item.group === binding.motion);
        return <div key={mood}><dt>{t(definition.label)}</dt><dd>{status(`mood:${mood}`, auto)}</dd></div>;
      })}
      <div><dt>{t('表情资源')}</dt><dd>{t('{0} 个表情', capabilities.expressions.length)}</dd></div>
    </dl>
    <details className="live2d-capability-resources">
      <summary>{t('动作资源：{0} 组，共 {1} 个动作', capabilities.motionGroups.length, count)}</summary>
      <ul>{capabilities.motionGroups.map((group, index) => <li key={group.name}>
        <span>{actionGroupLabel(group.name, index + 1, t)}</span><span>{t('{0} 个动作', group.count)}{capabilities.unboundMotionGroups.includes(group.name) && ` · ${t('未自动绑定')}`}</span>
      </li>)}</ul>
      {!!capabilities.expressions.length && <p>{capabilities.actions.filter(action => action.kind === 'expression').map((action, index) => actionName(action, profile, index + 1, t)).join(' · ')}</p>}
    </details>
    <p className="live2d-capability-hint">{t('导入后自动识别并启用支持的互动；用途不明确的动作仅登记，不自动绑定。')}</p>
  </>;
}
