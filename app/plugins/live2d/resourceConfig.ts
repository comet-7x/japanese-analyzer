import type { Live2DAction, Live2DCapabilities } from './capabilities';
import { automaticAreaAction, resolveActionBinding, resolveShortcutAction, type ActionProfile, type ActionResolution } from './actionProfile';

export interface ResourceUse { target: string; source: 'model' | 'custom'; resolution: ActionResolution }

export function idleResources(profile: ActionProfile, caps: Live2DCapabilities): Live2DAction[] {
  if (profile.idle.mode === 'off') return [];
  return caps.actions.filter(action => action.kind === 'motion' && (profile.idle.mode === 'model'
    ? action.group === caps.idle : profile.idle.actionIds.includes(action.id)));
}

export function automaticTargetAction(target: string, profile: ActionProfile, caps: Live2DCapabilities) {
  if (target.startsWith('area:')) return automaticAreaAction(target.slice(5), caps);
  if (target.startsWith('zone:')) {
    const zone = profile.hotspots.find(item => item.id === target.slice(5));
    const area = caps.interactions.find(item => zone?.part && item.part === zone.part)?.area;
    return area ? automaticAreaAction(area, caps) : undefined;
  }
  const mood = caps.moods[target.slice(5) as keyof typeof caps.moods];
  return target.startsWith('mood:') && mood ? caps.actions.find(action => mood.expression
    ? action.kind === 'expression' && action.group === mood.expression : action.kind === 'motion' && action.group === mood.motion) : undefined;
}

/** One effective-use projection for the catalog, rule editor and runtime diagnostics. */
export function effectiveResourceUses(profile: ActionProfile, caps: Live2DCapabilities): ResourceUse[] {
  const targets = new Set([...caps.interactions.map(item => `area:${item.area}`), ...profile.hotspots.map(item => `zone:${item.id}`),
    ...Object.keys(caps.moods).map(mood => `mood:${mood}`), ...Object.keys(profile.bindings)]);
  const uses: ResourceUse[] = [...targets].map(target => ({ target, source: profile.bindings[target]?.mode === 'manual' ? 'custom' : 'model',
    resolution: target.startsWith('key:') ? resolveShortcutAction(profile, target.slice(4), caps) ?? { status: 'none' }
      : resolveActionBinding(profile, target, caps, automaticTargetAction(target, profile, caps)) }));
  for (const action of idleResources(profile, caps)) uses.push({ target: 'idle', source: profile.idle.mode === 'custom' ? 'custom' : 'model', resolution: { status: 'action', action } });
  if (profile.idle.mode === 'custom') for (const id of profile.idle.actionIds) {
    if (!caps.actions.some(action => action.id === id && action.kind === 'motion')) uses.push({ target: 'idle', source: 'custom', resolution: { status: 'missing' } });
  }
  if (profile.defaultExpression) uses.push({ target: 'defaultExpression', source: 'custom',
    resolution: caps.actions.some(action => action.id === profile.defaultExpression && action.kind === 'expression')
      ? { status: 'action', action: caps.actions.find(action => action.id === profile.defaultExpression)! } : { status: 'missing' } });
  return uses;
}

/** A single failed resource is excluded for this session; no fallback to unrelated assets. */
export class IdlePlaylist {
  private previous: string | null = null;
  private failed = new Set<string>();
  reset() { this.previous = null; this.failed.clear(); }
  reject(id: string) { this.failed.add(id); }
  next(items: Live2DAction[], order: 'random' | 'sequence', random = Math.random): Live2DAction | undefined {
    const available = items.filter(item => !this.failed.has(item.id));
    if (!available.length) return;
    const index = available.findIndex(item => item.id === this.previous);
    const pool = available.length > 1 ? available.filter(item => item.id !== this.previous) : available;
    const item = order === 'sequence' ? available[(index + 1) % available.length] : pool[Math.min(pool.length - 1, Math.floor(Math.max(0, random()) * pool.length))];
    this.previous = item.id; return item;
  }
}
