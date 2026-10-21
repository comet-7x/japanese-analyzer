'use client';

import dynamic from 'next/dynamic';
import { useLanguage } from '../../contexts/LanguageContext';
import { localizeError } from '../../i18n';
import { useEffect, useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { Live2DCanvasHandle, ActionPlaybackState, ModelProjection } from './Live2DCanvas';
import { getLive2DModelFiles } from './modelLibrary';
import Live2DScrollFeedback from './Live2DScrollFeedback';
import { Icon } from '../../components/Icons';
import { defaultActionName, hitAreaLabel } from './actionLabels';
import type { Live2DCapabilities } from './capabilities';
import { effectiveResourceUses, idleResources } from './resourceConfig';
import { ResourceAssignment } from './ResourceAssignment';
import { BehaviorSettings } from './BehaviorSettings';
import { filterResources, indexResourceUses, RESOURCE_PAGE_SIZE } from './resourceIndex';
import { ResourceCatalog } from './ResourceCatalog';
import { resourceTargetLabel } from './resourceLabels';
import { INTERACTION_PARTS } from './interaction';
import { actionName, emptyActionProfile, isActionShortcut, removeActionHotspot, sanitizeActionProfile, shortcutFromEvent, unit,
  type ActionBinding, type ActionHotspot, type ActionProfile } from './actionProfile';

const Live2DCanvas = dynamic(() => import('./Live2DCanvas'), { ssr: false });
const DEFAULT_KEYS = ['Enter', 'Space', 'Shift+Enter'];
const MOODS = [{ id: 'analyzing', label: '分析中' }, { id: 'success', label: '分析成功' }, { id: 'error', label: '分析失败' }];
export default function Live2DActionEditor({ view = 'resources', pauseWhenIdle, modelId, capabilities, value, onChange, onBack }: {
  view?: 'resources' | 'rules'; pauseWhenIdle?: boolean; modelId: string; capabilities: Live2DCapabilities; value?: ActionProfile;
  onChange: (profile: ActionProfile) => void; onBack: () => void;
}) {
  const { t, locale } = useLanguage();
  const profile = useMemo(() => value ?? emptyActionProfile(), [value]);
  const latest = useRef(profile); latest.current = profile;
  const canvas = useRef<Live2DCanvasHandle>(null);
  const stage = useRef<HTMLDivElement>(null);
  const heading = useRef<HTMLHeadingElement>(null);
  const editor = useRef<HTMLDivElement>(null);
  const detail = useRef<HTMLDivElement>(null);
  const library = useRef<HTMLElement>(null);
  const [scrollTarget, setScrollTarget] = useState<HTMLElement | null>(null);
  const [resourcesTarget, setResourcesTarget] = useState<HTMLDivElement | null>(null);
  const [source, setSource] = useState<File[] | null>(null);
  const [ready, setReady] = useState(false);
  const [error, setError] = useState('');
  const [mobileDetail, setMobileDetail] = useState(false);
  const [testing, setTesting] = useState(false);
  const [hitFeedback, setHitFeedback] = useState('');
  const testPointer = useRef<{ id: number; x: number; y: number; moved: boolean } | null>(null);
  const [testIdle, setTestIdle] = useState(false);
  const [simulatedMood, setSimulatedMood] = useState<'idle' | 'analyzing' | 'success' | 'error'>('idle');
  const [undoProfile, setUndoProfile] = useState<ActionProfile | null>(null);
  const [assigning, setAssigning] = useState(false);
  const uses = useMemo(() => effectiveResourceUses(profile, capabilities), [profile, capabilities]);
  const useIndex = useMemo(() => indexResourceUses(uses), [uses]);
  const [page, setPage] = useState(0);
  const [repeatActionId, setRepeatActionId] = useState<string | null>(null);
  useEffect(() => { setRepeatActionId(null); setTesting(false); setTestIdle(false); setSimulatedMood('idle'); setEditing(false); setAssigning(false); canvas.current?.stopAction(); }, [view]);
  const [search, setSearch] = useState('');
  const [useFilter, setUseFilter] = useState('all');
  const [kind, setKind] = useState('all');
  const [selectedId, setSelectedId] = useState(capabilities.actions[0]?.id ?? '');
  useEffect(() => { if (detail.current) detail.current.scrollTop = 0; }, [view, selectedId]);
  const [target, setTarget] = useState(capabilities.interactions[0] ? `area:${capabilities.interactions[0].area}` : 'key:Enter');
  const [selectedZoneId, setSelectedZoneId] = useState<string | null>(profile.hotspots[0]?.id ?? null);
  const [playback, setPlayback] = useState<ActionPlaybackState>({ status: 'stopped', actionId: null });
  const [resourceStates, setResourceStates] = useState<Record<string, ActionPlaybackState['status']>>({});
  const [editing, setEditing] = useState(false);
  const [projection, setProjection] = useState<ModelProjection | null>(null);
  const [shortcutError, setShortcutError] = useState('');
  const [shortcut, setShortcut] = useState('');
  const gesture = useRef<{ pointer: number; start: { x: number; y: number }; zone: ActionHotspot; mode: 'draw' | 'move' | 'resize' } | null>(null);
  useEffect(() => {
    heading.current?.focus();
    setScrollTarget(editor.current?.closest<HTMLElement>('.settings-tab-pane') ?? null);
    let cancelled = false;
    void getLive2DModelFiles(modelId).then(result => {
      if (!cancelled) { if (result) setSource(result.files); else setError('模型文件不存在，请重新导入。'); }
    }).catch(cause => { if (!cancelled) setError(cause instanceof Error ? cause.message : '模型加载失败。'); });
    return () => { cancelled = true; };
  }, [modelId]);
  useEffect(() => {
    if (!ready || !stage.current) return;
    let frame = 0;
    const update = () => { cancelAnimationFrame(frame); frame = requestAnimationFrame(() => setProjection(canvas.current?.getProjection() ?? null)); };
    const observer = new ResizeObserver(update); observer.observe(stage.current); update();
    return () => { observer.disconnect(); cancelAnimationFrame(frame); };
  }, [ready]);
  const change = (patch: Partial<ActionProfile>) => onChange(sanitizeActionProfile({ ...latest.current, ...patch }));
  const bind = (next: ActionBinding) => change({ bindings: { ...latest.current.bindings, [target]: next } });
  const actions = capabilities.actions;
  const ordinals = useMemo(() => new Map(actions.map((action, index) => [action.id, index + 1])), [actions]);
  const removeUse = (id: string, resourceId: string) => {
    if (id === 'idle') change({ idle: { ...profile.idle, mode: 'custom', actionIds: idleResources(profile, capabilities).filter(item => item.id !== resourceId).map(item => item.id) } });
    else if (id === 'defaultExpression') change({ defaultExpression: null });
    else change({ bindings: { ...profile.bindings, [id]: { mode: 'disabled' } } });
  };
  const displayName = (action: typeof actions[number]) => actionName(action, profile, actions.indexOf(action) + 1, t);
  const filtered = useMemo(() => filterResources(actions, profile, useIndex, search, kind, useFilter, t), [actions, profile, useIndex, search, kind, useFilter, t]);
  const currentPage = Math.min(page, Math.max(0, Math.ceil(filtered.length / RESOURCE_PAGE_SIZE) - 1));
  const pageItems = filtered.slice(currentPage * RESOURCE_PAGE_SIZE, (currentPage + 1) * RESOURCE_PAGE_SIZE);
  const selectResource = (id: string) => { setRepeatActionId(null); canvas.current?.stopAction(); setSelectedId(id); setMobileDetail(true); setAssigning(false); };

  const selected = actions.find(action => action.id === selectedId);
  const zone = profile.hotspots.find(item => item.id === selectedZoneId);
  const keys = [...new Set([...DEFAULT_KEYS, ...Object.keys(profile.bindings).filter(key => key.startsWith('key:')).map(key => key.slice(4))])];
  const binding = profile.bindings[target];
  const bindingValue = binding?.mode === 'manual' ? binding.actionId : binding?.mode ?? 'auto';
  const missing = binding?.mode === 'manual' && !actions.some(action => action.id === binding.actionId);
  const targets = [
    ...profile.hotspots.map(item => ({ id: `zone:${item.id}`, label: t('自定义 · {0}', item.name) })),
    ...capabilities.interactions.map(item => ({ id: `area:${item.area}`, label: t('原生 · {0}', hitAreaLabel(item.area, t)) })),
    ...MOODS.map(item => ({ id: `mood:${item.id}`, label: t('伴学 · {0}', t(item.label)) })),
    ...keys.map(key => ({ id: `key:${key}`, label: t('键盘 · {0}', key) })),
  ];
  const patchZone = (patch: Partial<ActionHotspot>) => {
    if (!zone) return;
    const next = { ...zone, ...patch };
    next.x = Math.min(next.x, 1 - next.width); next.y = Math.min(next.y, 1 - next.height);
    change({ hotspots: profile.hotspots.map(item => item.id === zone.id ? next : item) });
  };
  const play = (id = selectedId) => { if (id !== repeatActionId) setRepeatActionId(null); setTestIdle(false); setTesting(false); setEditing(false); void canvas.current?.playAction(id); };
  const receivePlayback = (state: ActionPlaybackState) => {
    setPlayback(state);
    if (state.status === 'error') setRepeatActionId(null);
    setResourceStates(current => {
      const next = { ...current };
      for (const [id, status] of Object.entries(next)) {
        if ((status === 'playing' || status === 'loading') && id !== state.actionId) next[id] = 'stopped';
      }
      if (state.actionId) next[state.actionId] = state.status;
      return next;
    });
  };
  const adjacent = (offset: number) => {
    const index = Math.max(0, filtered.findIndex(action => action.id === selectedId));
    const next = filtered[(index + offset + filtered.length) % filtered.length];
    if (next) { setPage(Math.floor(filtered.indexOf(next) / RESOURCE_PAGE_SIZE)); setSelectedId(next.id); play(next.id); }
  };
  const pointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (!editing || event.button !== 0 || !event.isPrimary) return;
    const point = canvas.current?.clientToModel(event.clientX, event.clientY);
    if (!point) return;
    event.preventDefault(); event.currentTarget.setPointerCapture(event.pointerId);
    const hit = (event.target as Element).closest('[data-zone]');
    const current = latest.current.hotspots.find(item => item.id === hit?.getAttribute('data-zone'));
    const start = { x: unit(point.x), y: unit(point.y) };
    const rectangle = current ?? { id: crypto.randomUUID(), name: t('区域 {0}', latest.current.hotspots.length + 1), x: start.x, y: start.y, width: .01, height: .01 };
    if (!current) {
      if (latest.current.hotspots.length >= 64) { setError('最多支持 64 个自定义区域。'); return; }
      change({ hotspots: [...latest.current.hotspots, rectangle] });
    }
    setTarget(`zone:${rectangle.id}`);
    setSelectedZoneId(rectangle.id);
    gesture.current = { pointer: event.pointerId, start, zone: rectangle, mode: current ? hit?.getAttribute('data-resize') ? 'resize' : 'move' : 'draw' };
  };
  const pointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    const drag = gesture.current;
    if (!drag || drag.pointer !== event.pointerId) return;
    const point = canvas.current?.clientToModel(event.clientX, event.clientY);
    if (!point) return;
    const dx = point.x - drag.start.x, dy = point.y - drag.start.y;
    let next = { ...drag.zone };
    if (drag.mode === 'move') next = { ...next, x: Math.max(0, Math.min(1 - next.width, next.x + dx)), y: Math.max(0, Math.min(1 - next.height, next.y + dy)) };
    else if (drag.mode === 'resize') next = { ...next, width: Math.min(1 - next.x, Math.max(.01, next.width + dx)), height: Math.min(1 - next.y, Math.max(.01, next.height + dy)) };
    else next = { ...next, x: Math.min(drag.start.x, unit(point.x)), y: Math.min(drag.start.y, unit(point.y)), width: Math.max(.01, Math.abs(unit(point.x) - drag.start.x)), height: Math.max(.01, Math.abs(unit(point.y) - drag.start.y)) };
    change({ hotspots: latest.current.hotspots.map(item => item.id === next.id ? next : item) });
  };
  const finish = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (gesture.current?.pointer !== event.pointerId) return;
    gesture.current = null;
    if (event.currentTarget.hasPointerCapture(event.pointerId)) event.currentTarget.releasePointerCapture(event.pointerId);
  };
  const addShortcut = () => {
    if (!isActionShortcut(shortcut)) { setShortcutError('请按字母、数字、Enter 或空格，可搭配 Shift；方向键用于移动角色。'); return; }
    if (keys.includes(shortcut)) { setTarget(`key:${shortcut}`); setAssigning(true); setShortcutError('此快捷键已存在，请直接选择对应触发方式。'); return; }
    change({ bindings: { ...latest.current.bindings, [`key:${shortcut}`]: { mode: 'auto' } } });
    setTarget(`key:${shortcut}`); setShortcut(''); setShortcutError('');
  };
  const removeZone = (id: string) => {
    const current = latest.current;
    const index = current.hotspots.findIndex(item => item.id === id);
    const next = removeActionHotspot(current, id);
    const neighbour = next.hotspots[Math.min(index, next.hotspots.length - 1)];
    if (gesture.current?.zone.id === id) gesture.current = null;
    setUndoProfile(current); onChange(next);
    if (selectedZoneId === id) setSelectedZoneId(neighbour?.id ?? null);
    if (target === `zone:${id}`) setTarget(neighbour ? `zone:${neighbour.id}` : 'key:Enter');
  };
  const reorder = (offset: number) => {
    if (!zone) return;
    const items = [...profile.hotspots], index = items.findIndex(item => item.id === zone.id), to = index + offset;
    if (to < 0 || to >= items.length) return;
    [items[index], items[to]] = [items[to], items[index]]; change({ hotspots: items });
  };
  return <div className="live2d-action-editor" ref={editor}>
    {scrollTarget && <Live2DScrollFeedback target={scrollTarget} ownerId="live2d-action-editor-scroll" label={t("滚动动作管理")} layoutKey={`${target}:${editing}:${filtered.length}`} />}
    {resourcesTarget && <Live2DScrollFeedback target={resourcesTarget} ownerId="live2d-action-resources-scroll" label={t("滚动动作目录")} layoutKey={`${search}:${kind}`} />}
    <div className="live2d-action-heading">
      <button className="nd-ghost-btn" type="button" onClick={onBack} aria-label={t("返回角色设置")}><svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" aria-hidden="true"><path d="m15 6-6 6 6 6" /></svg>{t("返回")}</button>
      <h3 ref={heading} tabIndex={-1}>{t(view === 'resources' ? '动作与表情' : '互动设置')}</h3>
      <p>{t(view === 'resources' ? '预览只用于观察效果，设置用途后保存才能应用到桌面角色。' : '查看什么时候触发什么效果，并在预览中直接试用。')}</p>
    </div>
    <div className="live2d-action-workspace" data-view={view} data-detail={mobileDetail}>
      {view === 'resources' && <section className="live2d-action-library" ref={library} aria-label={t("动作资源目录")}>
        <label>{t("搜索动作")}<input className="nd-input" type="search" value={search} onChange={event => { setSearch(event.target.value); setPage(0); }} placeholder={t("名称、动作组或文件名")} /></label>
        <div className="live2d-resource-tabs" role="group" aria-label={t('资源类型')}>
          {['all', 'motion', 'expression'].map((id, index) => <button type="button" className="nd-ghost-btn" key={id} aria-pressed={kind === id} onClick={() => { setKind(id); setPage(0); }}>{t(['全部', '动作', '表情'][index])} {actions.filter(item => id === 'all' || item.kind === id).length}</button>)}
        </div>
        <label>{t('按用途筛选')}<select className="nd-input" value={useFilter} onChange={event => { setUseFilter(event.target.value); setPage(0); }}>{['all', 'idle', 'tap', 'key', 'mood', 'unused'].map((id, index) => <option key={id} value={id}>{t(['全部', '平时自动播放', '点击部位', '键盘快捷键', '伴学反馈', '尚未设置用途'][index])}</option>)}</select></label>
        <div className="live2d-action-resources" ref={setResourcesTarget}>
          <ResourceCatalog actions={pageItems} ordinals={ordinals} profile={profile} uses={useIndex} selectedId={selectedId} states={resourceStates}
            onSelect={selectResource} onPreview={id => { selectResource(id); play(id); }} />
          {!filtered.length && <p role="status">{t(kind === 'expression' && !actions.some(item => item.kind === 'expression') ? '此模型未包含表情文件。' : '没有匹配的资源。')}</p>}
          {!filtered.length && search && <button type="button" className="nd-ghost-btn" onClick={() => setSearch('')}>{t('清除搜索')}</button>}
        </div>
        {filtered.length > RESOURCE_PAGE_SIZE && <nav className="live2d-resource-pagination" aria-label={t('资源目录翻页')}><p role="status">{t('显示 {0}–{1}，共 {2} 项', currentPage * RESOURCE_PAGE_SIZE + 1, Math.min((currentPage + 1) * RESOURCE_PAGE_SIZE, filtered.length), filtered.length)}</p><button type="button" className="nd-ghost-btn" disabled={currentPage === 0} onClick={() => { setPage(currentPage - 1); if (resourcesTarget) resourcesTarget.scrollTop = 0; }}>{t('上一页')}</button><button type="button" className="nd-ghost-btn" disabled={(currentPage + 1) * RESOURCE_PAGE_SIZE >= filtered.length} onClick={() => { setPage(currentPage + 1); if (resourcesTarget) resourcesTarget.scrollTop = 0; }}>{t('下一页')}</button></nav>}
      </section>}
      {view === 'rules' && <BehaviorSettings pauseWhenIdle={pauseWhenIdle} profile={profile} caps={capabilities} onChange={onChange} selectedTarget={target} ready={ready}
        onEdit={id => { setTarget(id); setAssigning(true); }} onTest={id => {
          setRepeatActionId(null); setEditing(false); setTesting(true); setTestIdle(id === 'idle');
          if (id.startsWith('mood:')) { setSimulatedMood(id.slice(5) as typeof simulatedMood); return; }
          setSimulatedMood('idle');
          if (id === 'idle') return;
          void canvas.current?.triggerTarget(id);
        }} />}
      <div className="live2d-action-detail" ref={detail}>
        {view === 'resources' && <button className="nd-ghost-btn live2d-mobile-back" type="button" onClick={() => setMobileDetail(false)}>{t('返回动作列表')}</button>}
        {view === 'resources' && selected && <div className="live2d-resource-toolbar"><strong>{displayName(selected)}</strong><button type="button" className="nd-primary-btn" aria-expanded={assigning} onClick={() => { if (detail.current) detail.current.scrollTop = 0; setAssigning(!assigning); }}>{t('用于…')}</button></div>}
        {view === 'resources' && assigning && selected && <ResourceAssignment key={selected.id} action={selected} profile={profile} caps={capabilities} onChange={onChange} onDone={() => setAssigning(false)} />}
        <section className="live2d-action-preview" aria-label={t("独立角色预览")}>
          <div className="live2d-action-stage" ref={stage} tabIndex={testing ? 0 : undefined} role={testing ? 'group' : undefined} aria-label={testing ? t('试用互动，轻点角色或使用快捷键') : undefined}
            onPointerDown={event => { if (testing && !editing && event.button === 0 && event.isPrimary) testPointer.current = { id: event.pointerId, x: event.clientX, y: event.clientY, moved: false }; }}
            onPointerMove={event => { const pointer = testPointer.current; if (pointer && pointer.id === event.pointerId && Math.hypot(event.clientX - pointer.x, event.clientY - pointer.y) >= 5) pointer.moved = true; }}
            onPointerCancel={() => { testPointer.current = null; }}
            onPointerUp={event => { const pointer = testPointer.current; testPointer.current = null; if (testing && !editing && pointer?.id === event.pointerId && !pointer.moved) void canvas.current?.tapAt(event.clientX, event.clientY); }}
            onKeyDown={event => { if (event.target !== event.currentTarget || !testing || event.repeat) return; const key = shortcutFromEvent(event); if (key && canvas.current?.triggerShortcut(key)) event.preventDefault(); }}>
            {source && <Live2DCanvas ref={canvas} source={source} preview repeatActionId={repeatActionId} testCompanion={testing} mood={testing ? simulatedMood : 'idle'} interactionProfile={profile} testBehaviors={testIdle} trackPointer={false} pauseWhenIdle={!testIdle} onReady={() => setReady(true)} onError={cause => setError(cause.message)} onActionState={receivePlayback} onHitFeedback={(id, result, overlaps) => {
              const label = id ? resourceTargetLabel(id, profile, t) : t('空白区域');
              const effect = result.status === 'action' ? displayName(result.action) : t(result.status === 'disabled' ? '已禁用' : result.status === 'missing' ? '绑定资源已缺失' : '尚未设置用途');
              setHitFeedback(t('命中 {0} → {1}', label, effect) + (overlaps > 1 ? ' · ' + t('{0} 个区域重叠，按列表优先级执行', overlaps) : ''));
            }} />}
            {editing && projection && <svg className="live2d-hotspot-overlay" aria-label={t("绘制和移动热区，可使用下方数字输入调整")} onPointerDown={pointerDown} onPointerMove={pointerMove} onPointerUp={finish} onPointerCancel={finish} onLostPointerCapture={finish}>
              <g transform={`matrix(${projection.a} ${projection.b} ${projection.c} ${projection.d} ${projection.tx} ${projection.ty})`}>
                {[...profile.hotspots].reverse().map(item => <g key={item.id}>
                  <rect data-zone={item.id} x={item.x} y={item.y} width={item.width} height={item.height} className={selectedZoneId === item.id ? 'is-selected' : ''} vectorEffect="non-scaling-stroke" />
                  {selectedZoneId === item.id && <rect data-zone={item.id} data-resize="true" x={item.x + item.width - 5 / Math.abs(projection.a)} y={item.y + item.height - 5 / Math.abs(projection.d)} width={10 / Math.abs(projection.a)} height={10 / Math.abs(projection.d)} className="live2d-hotspot-handle" vectorEffect="non-scaling-stroke" />}
                </g>)}
              </g>
            </svg>}
            {!ready && !error && <span className="live2d-action-loading">{t("正在加载预览…")}</span>}
          </div>
          {view === 'rules' && <div className="live2d-action-buttons">{testing && simulatedMood !== 'idle' && <button type="button" className="nd-ghost-btn" onClick={() => setSimulatedMood('idle')}>{t('结束模拟事件')}</button>}<button type="button" className="nd-ghost-btn" aria-pressed={testing} onClick={() => { setEditing(false); setTestIdle(false); setTesting(!testing); }}>{t('试用互动')}</button><button type="button" className="nd-ghost-btn" aria-pressed={editing} onClick={() => { setTesting(false); setRepeatActionId(null); setTestIdle(false); setSimulatedMood('idle'); canvas.current?.resetPose(); setEditing(!editing); }}>{t('编辑区域')}</button></div>}
          <div className="live2d-action-preview-tools">
            <button type="button" className="nd-ghost-btn" disabled={!ready || !filtered.length} onClick={() => adjacent(-1)} aria-label={t("预览上一个动作")}>{t("上一个")}</button>
            <button type="button" className="nd-ghost-btn" disabled={!ready || !selected} onClick={() => play()}>{t("预览一次")}</button>
            <button type="button" className="nd-ghost-btn" disabled={!ready} onClick={() => { setRepeatActionId(null); setTestIdle(false); setSimulatedMood('idle'); canvas.current?.stopAction(); }}>{t("停止")}</button>
            <button type="button" className="nd-ghost-btn" disabled={!ready || !filtered.length} onClick={() => adjacent(1)} aria-label={t("预览下一个动作")}>{t("下一个")}</button>
            <button type="button" className="nd-ghost-btn" disabled={!ready} onClick={() => { setRepeatActionId(null); setTestIdle(false); setSimulatedMood('idle'); canvas.current?.resetPose(); }}>{t("复位姿态／表情")}</button>
          </div>
          {view === 'resources' && selected?.kind === 'motion' && <label className="live2d-preview-loop"><input type="checkbox" checked={repeatActionId === selected.id} disabled={!ready} onChange={event => { if (event.target.checked) { play(selected.id); setRepeatActionId(selected.id); } else { setRepeatActionId(null); canvas.current?.stopAction(); } }} />{t('循环预览此动作')}</label>}
          {repeatActionId && <p>{t('循环仅影响预览，停止或切换资源后结束。')}</p>}
          <p className="live2d-hit-feedback" role="status" aria-atomic="true">{testing ? hitFeedback : ''}</p>
          <p className="live2d-action-status" role="status">{testIdle ? t('正在试用待机清单，点击停止结束。') : testing && !editing ? t('轻点预览角色或聚焦后按快捷键；仅影响预览。') : playback.status === 'loading' ? t('正在加载所选资源…') : playback.status === 'playing' ? t(repeatActionId ? '正在循环预览 · 默认静音' : '正在预览 · 默认静音，不循环') : playback.status === 'finished' ? t('动作已播放完毕') : playback.status === 'error' ? (playback.error && localizeError(playback.error, locale)) : editing ? t('在角色上拖出矩形；拖动区域移动，拖动右下角调整大小。') : t('预览与桌面角色独立，默认静音，不循环。')}</p>
        </section>
        {view === 'resources' && selected && <section className="live2d-action-fields">
          <label>{t("动作名称")}<input maxLength={80} value={profile.aliases[selected.id] ?? ''} placeholder={defaultActionName(selected, actions.indexOf(selected) + 1, t)} onChange={event => change({ aliases: { ...profile.aliases, [selected.id]: event.target.value } })} /></label>
          <details className="live2d-action-file"><summary>{t("原始文件信息")}</summary><p>{selected.name}<br />{selected.file || t('未声明文件路径')}</p></details>
          <p className="live2d-action-file">{t('当前用途')}：{uses.filter(use => use.resolution.status === 'action' && use.resolution.action.id === selected.id).map(use => resourceTargetLabel(use.target, profile, t)).join('、') || t('尚未设置用途')}</p>
          {selected.kind === 'expression' && <>
            <label>{t('表情恢复方式')}<select className="nd-input" value={profile.expressionPolicies[selected.id]?.mode ?? 'timed'} onChange={event => change({ expressionPolicies: { ...profile.expressionPolicies, [selected.id]: { mode: event.target.value as 'timed' | 'toggle', seconds: profile.expressionPolicies[selected.id]?.seconds ?? 3.5 } } })}><option value="timed">{t('指定秒数后恢复')}</option><option value="toggle">{t('再次触发关闭')}</option></select></label>
            {(profile.expressionPolicies[selected.id]?.mode ?? 'timed') === 'timed' && <label>{t('持续时间（秒）')}<input className="nd-input" type="number" min="0.5" max="60" step="0.5" value={profile.expressionPolicies[selected.id]?.seconds ?? 3.5} onChange={event => change({ expressionPolicies: { ...profile.expressionPolicies, [selected.id]: { mode: 'timed', seconds: Number(event.target.value) } } })} /></label>}
            <button type="button" className="nd-ghost-btn" disabled={profile.defaultExpression !== selected.id} onClick={() => change({ defaultExpression: null })}>{t('恢复模型默认外观')}</button>
          </>}
          <ul className="live2d-resource-uses">{uses.filter(use => use.resolution.status === 'action' && use.resolution.action.id === selected.id).map(use => <li key={use.target}><span>{resourceTargetLabel(use.target, profile, t)}</span><button type="button" className="nd-ghost-btn" aria-label={t('移除用途：{0}', resourceTargetLabel(use.target, profile, t))} onClick={() => removeUse(use.target, selected.id)}>{t('移除用途')}</button></li>)}</ul>
        </section>}
        {view === 'rules' && assigning && <section className="live2d-action-fields">
          <h4>{resourceTargetLabel(target, profile, t)}</h4>
          <label>{t("触发方式")}<select value={target} onChange={event => { setTarget(event.target.value); if (event.target.value.startsWith('zone:')) setSelectedZoneId(event.target.value.slice(5)); }}>{targets.map(item => <option key={item.id} value={item.id}>{item.label}</option>)}</select></label>
          <label>{t("绑定资源")}<select value={bindingValue} onChange={event => bind(event.target.value === 'auto' || event.target.value === 'disabled' ? { mode: event.target.value } : { mode: 'manual', actionId: event.target.value })}>
            <option value="auto">{t("自动识别")}</option><option value="disabled">{t("禁用此触发方式")}</option>
            {missing && binding?.mode === 'manual' && <option value={binding.actionId}>{t("资源已缺失 · 请重新绑定")}</option>}
            {actions.map(action => <option key={action.id} value={action.id}>{displayName(action)} · {action.kind === 'motion' ? t('动作') : t('表情')}</option>)}
          </select></label>
          {target.startsWith('mood:') && uses.find(use => use.target === target)?.resolution.status === 'action' && (() => {
            const resolution = uses.find(use => use.target === target)!.resolution;
            if (resolution.status !== 'action' || resolution.action.kind !== 'expression') return null;
            const policy = profile.expressionPolicies[target] ?? { mode: 'timed', seconds: 3.5 };
            return <><label>{t('伴学表情恢复方式')}<select className="nd-input" value={policy.mode === 'event' ? 'event' : 'timed'} onChange={event => change({ expressionPolicies: { ...profile.expressionPolicies, [target]: { ...policy, mode: event.target.value as 'timed' | 'event' } } })}><option value="event">{t('事件结束后恢复')}</option><option value="timed">{t('指定秒数后恢复')}</option></select></label>
            {policy.mode !== 'event' && <label>{t('持续时间（秒）')}<input className="nd-input" type="number" min="0.5" max="60" step="0.5" value={policy.seconds} onChange={event => change({ expressionPolicies: { ...profile.expressionPolicies, [target]: { mode: 'timed', seconds: Number(event.target.value) } } })} /></label>}
            <p>{t('事件结束或被新反馈替换时，恢复默认外观。')}</p></>;
          })()}
          {missing && <p className="live2d-settings-error" role="status">{t("绑定的资源已缺失，此触发方式暂不执行。可重新选择资源或恢复自动。")}</p>}
          <div className="live2d-action-buttons"><button className="nd-ghost-btn" type="button" disabled={!selected} onClick={() => selected && bind({ mode: 'manual', actionId: selected.id })}>{t("绑定所选动作")}</button><button className="nd-ghost-btn" type="button" onClick={() => bind({ mode: 'auto' })}>{t("恢复自动")}</button></div>
          <p>{t("自定义热区优先于原生部位，重叠时列表靠前的区域优先。禁用会阻止该区域触发其他动作。")}</p>
        </section>}
        {view === 'rules' && <><details className="live2d-action-fields" open={editing || undefined}>
          <summary>{t("自定义热区")}</summary>
          <p>{t("模型未提供头部等区域时，可自行添加。矩形固定在模型画布上，不跟随骨骼变形。")}</p>
          <div className="live2d-action-buttons">
            <button type="button" className="nd-ghost-btn" disabled={!ready} aria-pressed={editing} onClick={() => { canvas.current?.resetPose(); setEditing(!editing); }}>{editing ? t('完成区域编辑') : t('在角色上绘制区域')}</button>
            <button type="button" className="nd-ghost-btn" disabled={profile.hotspots.length >= 64} onClick={() => { const item = { id: crypto.randomUUID(), name: t('区域 {0}', profile.hotspots.length + 1), x: .3, y: .1, width: .4, height: .25 }; change({ hotspots: [...profile.hotspots, item] }); setTarget(`zone:${item.id}`); setSelectedZoneId(item.id); canvas.current?.resetPose(); setEditing(true); }}>{t("添加区域")}</button>
          </div>
          {profile.hotspots.length > 0 ? <ol className="live2d-hotspot-list">{profile.hotspots.map(item => <li key={item.id}>
            <button className="nd-ghost-btn live2d-hotspot-select" type="button" aria-pressed={zone?.id === item.id} onClick={() => { setSelectedZoneId(item.id); setTarget(`zone:${item.id}`); }}>{item.name || t('未命名区域')}</button>
            <button className="nd-ghost-btn live2d-hotspot-delete" type="button" aria-label={t('删除区域：{0}', item.name || t('未命名区域'))} onClick={() => removeZone(item.id)}>{Icon.trash}<span>{t("删除")}</span></button>
          </li>)}</ol> : <p>{t("尚无自定义区域。")}</p>}
          {zone && <>
            <label>{t("区域名称")}<input maxLength={80} value={zone.name} onChange={event => patchZone({ name: event.target.value })} /></label>
            <label>{t("部位类型")}<select value={zone.part ?? ''} onChange={event => patchZone({ part: event.target.value as ActionHotspot['part'] || undefined })}><option value="">{t("自定义")}</option>{Object.entries(INTERACTION_PARTS).map(([id, part]) => <option key={id} value={id}>{t(part.label)}</option>)}</select></label>
            <div className="live2d-hotspot-numbers">{(['x', 'y', 'width', 'height'] as const).map((key, index) => <label key={key}>{t(['横向位置', '纵向位置', '宽度', '高度'][index])}（%）<input type="number" min={key === 'width' || key === 'height' ? 1 : 0} max="100" step="0.5" value={Math.round(zone[key] * 1000) / 10} onChange={event => { if (event.target.value !== '') patchZone({ [key]: unit(Number(event.target.value) / 100) }); }} /></label>)}</div>
            <div className="live2d-action-buttons"><button className="nd-ghost-btn" type="button" disabled={profile.hotspots[0]?.id === zone.id} onClick={() => reorder(-1)}>{t("优先级上移")}</button><button className="nd-ghost-btn" type="button" disabled={profile.hotspots.at(-1)?.id === zone.id} onClick={() => reorder(1)}>{t("优先级下移")}</button><button className="nd-ghost-btn" type="button" onClick={() => removeZone(zone.id)}>{t("删除当前区域")}</button></div>
          </>}
        </details>
        <details className="live2d-action-fields">
          <summary>{t("键盘快捷键")}</summary><p>{t("仅聚焦桌面角色时生效。Enter／空格触发默认互动，Shift+Enter 触发头部互动；方向键保留用于移动角色。")}</p>
          <label>{t("录入快捷键")}<input value={shortcut} placeholder={t("点击此处，再按快捷键")} readOnly onKeyDown={event => { if (event.key === 'Tab') return; event.preventDefault(); const key = shortcutFromEvent(event); if (key) { setShortcut(key); setShortcutError(''); } else setShortcutError('不支持此组合。请使用字母、数字、Enter 或空格，可搭配 Shift。'); }} /></label>
          <button type="button" className="nd-ghost-btn" onClick={addShortcut}>{t("添加快捷键")}</button>
          {target.startsWith('key:') && !DEFAULT_KEYS.includes(target.slice(4)) && <button type="button" className="nd-ghost-btn" onClick={() => { const bindings = { ...profile.bindings }; delete bindings[target]; change({ bindings }); setTarget('key:Enter'); }}>{t("删除此快捷键")}</button>}
          <p className="live2d-settings-error" role="status">{shortcutError && localizeError(shortcutError, locale)}</p>
        </details>
        {undoProfile && <button className="nd-ghost-btn" type="button" onClick={() => { const removed = undoProfile.hotspots.find(item => !profile.hotspots.some(zone => zone.id === item.id)); if (removed) { const restored = [...profile.hotspots]; restored.splice(Math.min(undoProfile.hotspots.indexOf(removed), restored.length), 0, removed); onChange({ ...profile, hotspots: restored, bindings: { ...profile.bindings, ...(undoProfile.bindings[`zone:${removed.id}`] ? { [`zone:${removed.id}`]: undoProfile.bindings[`zone:${removed.id}`] } : {}) } }); } setUndoProfile(null); }}>{t('撤销删除区域')}</button>}
        <button className="nd-ghost-btn" type="button" onClick={() => { if (window.confirm(t('重置当前模型的动作名称、绑定、热区和快捷键？大小和其他模型配置保持不变。'))) { onChange(emptyActionProfile()); setTarget('key:Enter'); setSelectedZoneId(null); } }}>{t("重置当前模型互动配置")}</button>
        </>}
        {error && <p className="live2d-settings-error" role="alert">{localizeError(error, locale)}</p>}
      </div>
    </div>
  </div>;
}
