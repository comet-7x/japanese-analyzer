'use client';
import { useState } from 'react';
import { useLanguage } from '../../contexts/LanguageContext';
import type { ActionProfile } from './actionProfile';
import type { Live2DAction, Live2DCapabilities } from './capabilities';
import { actionName } from './actionProfile';
import { idleResources } from './resourceConfig';
import { resourceTargetLabel } from './resourceLabels';

export function ResourceAssignment({ action, profile, caps, onChange, onDone }: {
  action: Live2DAction; profile: ActionProfile; caps: Live2DCapabilities;
  onChange: (profile: ActionProfile) => void; onDone: () => void;
}) {
  const { t } = useLanguage();
  const [purpose, setPurpose] = useState(action.kind === 'motion' ? 'idle' : 'mood');
  const [target, setTarget] = useState('');
  const [replace, setReplace] = useState(false);
  const targets = purpose === 'tap' ? [...caps.interactions.map(item => `area:${item.area}`), ...profile.hotspots.map(item => `zone:${item.id}`)]
    : purpose === 'key' ? ['key:Enter', 'key:Space', 'key:Shift+Enter', ...Object.keys(profile.bindings).filter(key => key.startsWith('key:'))]
      : ['mood:analyzing', 'mood:success', 'mood:error'];
  const selected = targets.includes(target) ? target : targets[0];
  const old = profile.bindings[selected];
  const conflict = !['idle', 'appearance'].includes(purpose) && old?.mode === 'manual' && old.actionId !== action.id;
  const apply = (append = false) => {
    if (conflict && !replace) { setReplace(true); return; }
    if (purpose === 'idle') onChange({ ...profile, idle: { ...profile.idle, mode: 'custom',
      actionIds: append ? [...new Set([...idleResources(profile, caps).map(item => item.id), action.id])] : [action.id] } });
    else if (purpose === 'appearance') onChange({ ...profile, defaultExpression: action.id });
    else if (selected) onChange({ ...profile, bindings: { ...profile.bindings, [selected]: { mode: 'manual', actionId: action.id } } });
    onDone();
  };
  return <section className="live2d-action-fields live2d-assignment" aria-label={t('设置用途')}>
    <h4>{t('将 {0} 用于', actionName(action, profile, undefined, t))}</h4>
    <label>{t('使用方式')}<select className="nd-input" value={purpose} onChange={event => { setPurpose(event.target.value); setTarget(''); setReplace(false); }}>
      {action.kind === 'motion' && <option value="idle">{t('平时自动播放')}</option>}
      <option value="tap">{t('点击角色部位')}</option><option value="key">{t('键盘快捷键')}</option><option value="mood">{t('伴学反馈')}</option>
      {action.kind === 'expression' && <option value="appearance">{t('默认外观')}</option>}
    </select></label>
    {!['idle', 'appearance'].includes(purpose) && <label>{t('什么时候触发')}<select className="nd-input" value={selected ?? ''} onChange={event => { setTarget(event.target.value); setReplace(false); }}>{[...new Set(targets)].map(id => <option key={id} value={id}>{resourceTargetLabel(id, profile, t)}</option>)}</select></label>}
    {purpose === 'tap' && !targets.length && <p>{t('模型没有点击区域，请在互动设置中添加区域。')}</p>}
    {conflict && <p role="status">{t('此触发方式已有指定资源，确认后将替换。')}</p>}
    <div className="live2d-action-buttons">
      <button type="button" className="nd-btn" disabled={purpose === 'tap' && !targets.length} onClick={() => apply()}>{t(purpose === 'idle' ? '只播放此动作' : replace ? '确认替换' : '添加用途')}</button>
      {purpose === 'idle' && idleResources(profile, caps).length > 0 && <button type="button" className="nd-ghost-btn" onClick={() => apply(true)}>{t('加入现有待机清单')}</button>}
      <button type="button" className="nd-ghost-btn" onClick={onDone}>{t('取消')}</button>
    </div>
    <p>{t('已加入设置草稿，保存设置后应用到桌面角色。')}</p>
  </section>;
}
