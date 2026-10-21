'use client';
import { useLanguage } from '../../contexts/LanguageContext';
import { actionName, type ActionProfile } from './actionProfile';
import type { Live2DCapabilities } from './capabilities';
import { effectiveResourceUses, idleResources } from './resourceConfig';
import { resourceTargetLabel } from './resourceLabels';

export function BehaviorSettings({ profile, caps, onChange, onEdit, onTest, ready, selectedTarget }: {
  profile: ActionProfile; caps: Live2DCapabilities; onChange: (profile: ActionProfile) => void;
  onEdit: (target: string) => void; onTest: (target: string) => void; ready: boolean; selectedTarget: string;
}) {
  const { t } = useLanguage();
  const uses = effectiveResourceUses(profile, caps);
  const motions = caps.actions.filter(item => item.kind === 'motion');
  return <section className="live2d-behaviors" aria-label={t('互动规则')}>
    <details className="live2d-action-fields" open>
      <summary>{t('平时动作')}</summary>
      <label>{t('播放方式')}<select className="nd-input" value={profile.idle.mode} onChange={event => onChange({ ...profile, idle: { ...profile.idle, mode: event.target.value as ActionProfile['idle']['mode'] } })}>
        <option value="model">{t('使用模型默认')}</option><option value="custom">{t('选择动作')}</option><option value="off">{t('关闭动作播放')}</option>
      </select></label>
      {profile.idle.mode === 'custom' && <>
        <fieldset className="live2d-idle-selection"><legend>{t('待机清单')}</legend>{motions.map(action => <label key={action.id}><input type="checkbox" checked={profile.idle.actionIds.includes(action.id)} onChange={event => onChange({ ...profile, idle: { ...profile.idle, actionIds: event.target.checked ? [...profile.idle.actionIds, action.id] : profile.idle.actionIds.filter(id => id !== action.id) } })} />{actionName(action, profile, undefined, t)}</label>)}</fieldset>
        {profile.idle.actionIds.filter(id => !motions.some(action => action.id === id)).map(id => <p key={id} role="status">{t('资源已缺失 · 请重新绑定')} <button className="nd-ghost-btn" type="button" onClick={() => onChange({ ...profile, idle: { ...profile.idle, actionIds: profile.idle.actionIds.filter(item => item !== id) } })}>{t('移除用途')}</button></p>)}
        <label>{t('播放顺序')}<select className="nd-input" value={profile.idle.order} onChange={event => onChange({ ...profile, idle: { ...profile.idle, order: event.target.value as 'random' | 'sequence' } })}><option value="random">{t('随机播放')}</option><option value="sequence">{t('顺序播放')}</option></select></label>
        <label>{t('动作间隔（秒）')}<input className="nd-input" type="number" min="0" max="60" value={profile.idle.interval} onChange={event => onChange({ ...profile, idle: { ...profile.idle, interval: Number(event.target.value) } })} /></label>
      </>}
      <p>{t('当前待机清单：{0} 个动作', idleResources(profile, caps).length)}</p>
      <button type="button" className="nd-ghost-btn" disabled={!ready} onClick={() => onTest('idle')}>{t('试用待机')}</button>
    </details>
    {(['tap', 'key', 'mood'] as const).map((kind, index) => <section key={kind} className="live2d-rule-group">
      <h4>{t(['点击部位', '键盘快捷键', '伴学反馈'][index])}</h4>
      {uses.filter(use => kind === 'tap' ? /^(area|zone):/.test(use.target) : use.target.startsWith(`${kind}:`)).map(use => <article className="live2d-rule-row" key={use.target} data-selected={selectedTarget === use.target}>
        <div><strong>{resourceTargetLabel(use.target, profile, t)}</strong><p>{use.resolution.status === 'action' ? actionName(use.resolution.action, profile, undefined, t) : t(({ disabled: '已禁用', missing: '绑定资源已缺失', none: '尚未设置用途' })[use.resolution.status])}</p><small>{t(use.source === 'custom' ? '你设置的' : '来自模型默认')}</small></div>
        <button type="button" className="nd-ghost-btn" onClick={() => onEdit(use.target)}>{t('修改')}</button>
        <button type="button" className="nd-ghost-btn" disabled={!ready || use.resolution.status !== 'action'} onClick={() => onTest(use.target)}>{t('试用')}</button>
        <button type="button" className="nd-ghost-btn" disabled={use.resolution.status === 'disabled'} onClick={() => onChange({ ...profile, bindings: { ...profile.bindings, [use.target]: { mode: 'disabled' } } })}>{t('停用')}</button>
      </article>)}
      {kind === 'tap' && !caps.interactions.some(item => item.part === 'head') && !profile.hotspots.some(item => item.part === 'head') && <p>{t('模型未提供头部区域，可在下方添加点击区域。')}</p>}
      {kind === 'key' && !uses.some(use => use.target.startsWith('key:')) && <p>{t('尚未添加快捷键，可在下方录入。')}</p>}
    </section>)}
  </section>;
}
