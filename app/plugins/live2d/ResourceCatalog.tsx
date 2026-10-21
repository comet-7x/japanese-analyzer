'use client';
import { useLanguage } from '../../contexts/LanguageContext';
import { actionName, type ActionProfile } from './actionProfile';
import type { Live2DAction } from './capabilities';
import type { ResourceUse } from './resourceConfig';
import type { ActionPlaybackState } from './Live2DCanvas';
import { resourceTargetLabel } from './resourceLabels';

export function ResourceCatalog({ actions, profile, uses, selectedId, states, onSelect, onPreview }: {
  actions: Live2DAction[]; profile: ActionProfile; uses: Map<string, ResourceUse[]>; selectedId: string;
  states: Record<string, ActionPlaybackState['status']>; onSelect: (id: string) => void; onPreview: (id: string) => void;
}) {
  const { t } = useLanguage();
  return actions.map((action, index) => {
    const assigned = uses.get(action.id) ?? [];
    return <article key={action.id} className="live2d-catalog-row" data-selected={action.id === selectedId}>
      <button type="button" className="live2d-catalog-select" aria-pressed={action.id === selectedId} onClick={() => onSelect(action.id)}>
        <strong>{actionName(action, profile, index + 1, t)}</strong>
        <small>{t(action.kind === 'motion' ? '动作' : '表情')} · {assigned.map(use => resourceTargetLabel(use.target, profile, t)).join('、') || t('尚未设置用途')}</small>
      </button>
      <button type="button" className="nd-ghost-btn" onClick={() => onPreview(action.id)} aria-label={t('预览 {0}', actionName(action, profile, index + 1, t))}><svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" aria-hidden="true"><path d="m9 5 11 7-11 7Z" /></svg></button>
      {states[action.id] && <small className="live2d-resource-state">{t(({ loading: '加载中', playing: '预览中', finished: '已结束', stopped: '已停止', error: '加载失败' })[states[action.id]])}</small>}
    </article>;
  });
}
