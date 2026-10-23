import type { Live2DAction, Live2DCapabilities } from './capabilities';
import { interactionPart, type InteractionPart } from './interaction';
import { defaultActionName } from './actionLabels';
import type { Translator } from '../../i18n';

export type ActionBinding = { mode: 'auto' } | { mode: 'disabled' } | { mode: 'manual'; actionId: string };
export interface ActionHotspot { id: string; name: string; part?: InteractionPart; x: number; y: number; width: number; height: number }
export interface ActionProfile {
  version: 2;
  aliases: Record<string, string>;
  bindings: Record<string, ActionBinding>;
  hotspots: ActionHotspot[];
  idle: { mode: 'model' | 'custom' | 'off'; actionIds: string[]; order: 'random' | 'sequence'; interval: number };
  defaultExpression: string | null;
  expressionPolicies: Record<string, { mode: 'timed' | 'toggle' | 'event'; seconds: number }>;
}
export const emptyActionProfile = (): ActionProfile => ({ version: 2, aliases: {}, bindings: {}, hotspots: [],
  idle: { mode: 'model', actionIds: [], order: 'random', interval: 0 }, defaultExpression: null, expressionPolicies: {} });
const safeKey = (key: string) => !!key && key.length <= 2048 && !['__proto__', 'prototype', 'constructor'].includes(key);
const object = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
export const unit = (value: number) => Math.max(0, Math.min(1, value));
export function sanitizeActionProfile(value: unknown): ActionProfile {
  const source = object(value), result = emptyActionProfile();
  const idle = object(source.idle);
  result.idle = { mode: idle.mode === 'custom' || idle.mode === 'off' ? idle.mode : 'model',
    actionIds: [...new Set((Array.isArray(idle.actionIds) ? idle.actionIds : []).filter((id): id is string => typeof id === 'string' && safeKey(id)))].slice(0, 1024),
    order: idle.order === 'sequence' ? 'sequence' : 'random',
    interval: typeof idle.interval === 'number' && Number.isFinite(idle.interval) ? Math.max(0, Math.min(60, idle.interval)) : 0 };
  result.defaultExpression = typeof source.defaultExpression === 'string' && safeKey(source.defaultExpression) ? source.defaultExpression : null;
  for (const [target, raw] of Object.entries(object(source.expressionPolicies)).slice(0, 512)) {
    if (!safeKey(target)) continue;
    const policy = object(raw);
    result.expressionPolicies[target] = { mode: policy.mode === 'event' && target.startsWith('mood:') ? 'event' : policy.mode === 'toggle' ? 'toggle' : 'timed',
      seconds: typeof policy.seconds === 'number' && Number.isFinite(policy.seconds) ? Math.max(.5, Math.min(60, policy.seconds)) : 3.5 };
  }
  for (const [id, alias] of Object.entries(object(source.aliases)).slice(0, 1024)) {
    if (safeKey(id) && typeof alias === 'string' && alias.trim()) result.aliases[id] = alias.slice(0, 80);
  }
  for (const [target, raw] of Object.entries(object(source.bindings)).slice(0, 512)) {
    if (!safeKey(target)) continue;
    const binding = object(raw);
    if (binding.mode === 'disabled' || binding.mode === 'auto') result.bindings[target] = { mode: binding.mode };
    else if (binding.mode === 'manual' && typeof binding.actionId === 'string' && safeKey(binding.actionId)) result.bindings[target] = { mode: 'manual', actionId: binding.actionId };
  }
  const ids = new Set<string>();
  for (const raw of Array.isArray(source.hotspots) ? source.hotspots.slice(0, 64) : []) {
    const item = object(raw);
    if (typeof item.id !== 'string' || !safeKey(item.id) || ids.has(item.id)
      || !['x', 'y', 'width', 'height'].every(key => typeof item[key] === 'number' && Number.isFinite(item[key]))) continue;
    const x = unit(item.x as number), y = unit(item.y as number);
    const width = Math.min(1 - x, Math.max(.01, item.width as number));
    const height = Math.min(1 - y, Math.max(.01, item.height as number));
    if (width <= 0 || height <= 0) continue;
    const part = typeof item.part === 'string' ? interactionPart(item.part) : null;
    ids.add(item.id);
    result.hotspots.push({ id: item.id, name: typeof item.name === 'string' ? item.name.slice(0, 80) : '自定义区域',
      ...(part ? { part } : {}), x, y, width, height });
  }
  return result;
}
export const actionName = (action: Live2DAction, profile?: ActionProfile, ordinal?: number, t?: Translator) => profile?.aliases[action.id]?.trim() || defaultActionName(action, ordinal, t);
export function removeActionHotspot(profile: ActionProfile, id: string): ActionProfile {
  const bindings = { ...profile.bindings };
  delete bindings[`zone:${id}`];
  return { ...profile, hotspots: profile.hotspots.filter(item => item.id !== id), bindings };
}
export type ActionResolution = { status: 'action'; action: Live2DAction } | { status: 'disabled' | 'missing' | 'none' };
export function resolveActionBinding(profile: ActionProfile | undefined, target: string, capabilities: Live2DCapabilities, auto?: Live2DAction): ActionResolution {
  const binding = profile?.bindings[target];
  if (binding?.mode === 'disabled') return { status: 'disabled' };
  if (binding?.mode === 'manual') {
    const action = capabilities.actions.find(item => item.id === binding.actionId);
    return action ? { status: 'action', action } : { status: 'missing' };
  }
  return auto ? { status: 'action', action: auto } : { status: 'none' };
}
export function automaticAreaAction(area: string, capabilities: Live2DCapabilities) {
  const group = capabilities.interactions.find(item => item.area === area)?.motion;
  return capabilities.actions.find(item => item.kind === 'motion' && item.group === group);
}
export function hotspotAt(profile: ActionProfile | undefined, point: { x: number; y: number }) {
  return profile?.hotspots.find(zone => point.x >= zone.x && point.x <= zone.x + zone.width && point.y >= zone.y && point.y <= zone.y + zone.height);
}
export function resolvePointerTarget(profile: ActionProfile | undefined, point: { x: number; y: number }, areas: string[], capabilities: Live2DCapabilities): { target: string | null; resolution: ActionResolution } {
  const zone = hotspotAt(profile, point);
  if (zone) {
    const area = capabilities.interactions.find(item => zone.part && item.part === zone.part)?.area;
    return { target: `zone:${zone.id}`, resolution: resolveActionBinding(profile, `zone:${zone.id}`, capabilities, area ? automaticAreaAction(area, capabilities) : undefined) };
  }
  const head = areas.filter(area => interactionPart(area) === 'head');
  for (const area of head.length ? head : areas) {
    const result = resolveActionBinding(profile, `area:${area}`, capabilities, automaticAreaAction(area, capabilities));
    if (result.status !== 'none') return { target: `area:${area}`, resolution: result };
  }
  return { target: areas[0] ? `area:${areas[0]}` : null, resolution: { status: 'none' } };
}
export function resolvePointerAction(profile: ActionProfile | undefined, point: { x: number; y: number }, areas: string[], capabilities: Live2DCapabilities): ActionResolution {
  return resolvePointerTarget(profile, point, areas, capabilities).resolution;
}
export function resolvePartAction(profile: ActionProfile | undefined, part: InteractionPart | undefined, capabilities: Live2DCapabilities): ActionResolution {
  const zone = profile?.hotspots.find(item => item.part === (part ?? 'body'));
  const candidates = capabilities.interactions.filter(item => item.part === (part ?? 'body'));
  const area = (candidates.length || part ? candidates : capabilities.interactions)[0]?.area;
  return resolveActionBinding(profile, zone ? `zone:${zone.id}` : `area:${area}`, capabilities,
    area ? automaticAreaAction(area, capabilities) : undefined);
}
export function resolveShortcutAction(profile: ActionProfile | undefined, key: string, capabilities: Live2DCapabilities): ActionResolution | null {
  const configured = profile?.bindings[`key:${key}`];
  if (configured && configured.mode !== 'auto') return resolveActionBinding(profile, `key:${key}`, capabilities);
  return key === 'Enter' || key === 'Space' || key === 'Shift+Enter'
    ? resolvePartAction(profile, key === 'Shift+Enter' ? 'head' : undefined, capabilities) : null;
}
/** Browser/navigation chords are unavailable; action shortcuts only run with actor focus. */
export function shortcutFromEvent(event: { key: string; shiftKey: boolean; ctrlKey: boolean; altKey: boolean; metaKey: boolean }): string | null {
  if (event.ctrlKey || event.metaKey || event.altKey) return null;
  const key = event.key === ' ' ? 'Space' : event.key.length === 1 ? event.key.toUpperCase() : event.key;
  if (key !== 'Enter' && key !== 'Space' && !/^[A-Z0-9]$/.test(key)) return null;
  return `${event.shiftKey ? 'Shift+' : ''}${key}`;
}
export function isActionShortcut(value: string) { return /^(Shift\+)?(Enter|Space|[A-Z0-9])$/.test(value); }
/** Late resource loads may finish, but only the newest command may start playback. */
export class ActionCommandGate {
  private generation = 0;
  cancel() { this.generation++; }
  async run(load: () => Promise<boolean>, start: () => Promise<boolean>) {
    const request = ++this.generation;
    if (!await load() || request !== this.generation) return false;
    return start();
  }
}
