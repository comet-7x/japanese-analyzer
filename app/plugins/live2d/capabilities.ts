import { areasForPart, interactionPart, resolveInteractionMotion, type InteractionPart } from './interaction';
import type { CompanionMood } from './companion';

// Bump when the catalog's matching rules or report schema change so stored imports are re-inspected.
export const CAPABILITY_VERSION = 2;
export type Live2DAction = { id: string; kind: 'motion' | 'expression'; name: string; group: string; index: number; file: string };
export function actionId(kind: Live2DAction['kind'], group: string, index: number, file: string) {
  return JSON.stringify([kind, group, index, file.replace(/\\/g, '/')]);
}
export const MOOD_ACTIONS = {
  analyzing: { label: '思考反馈', pattern: /^(?:think(?:ing)?|doubt|confused|wait|思考|考える)(?:\d+)?$/i },
  success: { label: '成功反馈', pattern: /^(?:smile|happy|joy|success|cheer|nod|微笑|开心|成功|笑顔|喜び)(?:\d+)?$/i },
  error: { label: '困惑反馈', pattern: /^(?:confus(?:ed|ion)?|sad|error|doubt|困惑|悲伤|困る|悲しい)(?:\d+)?$/i },
} as const;
type MoodAction = Exclude<CompanionMood, 'idle'>;
export interface Live2DCapabilities {
  version: number;
  actions: Live2DAction[];
  interactions: Array<{ area: string; part: InteractionPart | null; motion: string | null }>;
  motionGroups: Array<{ name: string; count: number }>;
  expressions: string[];
  idle: string | null;
  moods: Record<MoodAction, { expression: string | null; motion: string | null }>;
  unboundMotionGroups: string[];
}

const semanticName = (name: string) => name.replace(/^(?:motion|expression|exp)[ _-]+/i, '').replace(/[\s_@.\-]/g, '');

/** Builds a model-independent capability table from the complete declared asset inventory. */
export function detectLive2DCapabilities(input: {
  areas: string[]; motions: Record<string, readonly unknown[] | undefined>; expressions: string[];
  expressionDefinitions?: readonly { Name: string; File: string }[];
}): Live2DCapabilities {
  const motionGroups = Object.keys(input.motions).filter(name => input.motions[name]?.length)
    .map(name => ({ name, count: input.motions[name]!.length }));
  const expressions = [...new Set(input.expressions.filter(Boolean))];
  const interactions = [...new Set(input.areas.filter(Boolean))].map(area => ({
    area, part: interactionPart(area), motion: resolveInteractionMotion([area], input.motions),
  }));
  const moods = Object.fromEntries(Object.entries(MOOD_ACTIONS).map(([mood, definition]) => [mood, {
    expression: expressions.find(name => definition.pattern.test(semanticName(name))) ?? null,
    motion: motionGroups.find(group => definition.pattern.test(semanticName(group.name)))?.name ?? null,
  }])) as Live2DCapabilities['moods'];
  const idle = motionGroups.find(group => /^idle$/i.test(group.name))?.name ?? null;
  const bound = new Set([idle, ...interactions.map(item => item.motion), ...Object.values(moods).map(item => item.motion)]);
  const actions: Live2DAction[] = motionGroups.flatMap(group => input.motions[group.name]!.map((definition, index) => {
    const file = typeof record(definition).File === 'string' ? record(definition).File as string : '';
    return { id: actionId('motion', group.name, index, file), kind: 'motion', name: `${group.name} · ${index + 1}`, group: group.name, index, file };
  }));
  (input.expressionDefinitions ?? input.expressions.map(Name => ({ Name, File: '' }))).forEach((definition, index) => {
    actions.push({ id: actionId('expression', definition.Name, index, definition.File), kind: 'expression', name: definition.Name,
      group: definition.Name, index, file: definition.File });
  });
  return { version: CAPABILITY_VERSION, actions, interactions, motionGroups, expressions, idle, moods,
    unboundMotionGroups: motionGroups.filter(group => !bound.has(group.name)).map(group => group.name) };
}

export function resolveCapabilityInteraction(areas: string[], capabilities: Live2DCapabilities): string | null {
  const head = areasForPart(areas, 'head');
  for (const area of head.length ? head : areas) {
    const motion = capabilities.interactions.find(item => item.area === area)?.motion;
    if (motion) return motion;
  }
  return null;
}

function record(value: unknown): Record<string, unknown> {
  return value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
}

/** Import-time discovery does not infer semantics from numbered files or claim runtime readiness. */
export function capabilitiesFromManifest(manifest: unknown): Live2DCapabilities {
  const source = record(manifest);
  const refs = record(source.FileReferences);
  const areas = Array.isArray(source.HitAreas) ? source.HitAreas.flatMap(value => {
    const area = record(value);
    return typeof area.Name === 'string' && typeof area.Id === 'string' && area.Id ? [area.Name] : [];
  }) : [];
  const motions: Record<string, unknown[]> = Object.create(null);
  for (const [name, definitions] of Object.entries(record(refs.Motions))) {
    if (Array.isArray(definitions)) motions[name] = definitions.filter(value => typeof record(value).File === 'string');
  }
  const expressions = Array.isArray(refs.Expressions) ? refs.Expressions.flatMap(value => {
    const expression = record(value);
    return typeof expression.Name === 'string' && typeof expression.File === 'string' ? [expression.Name] : [];
  }) : [];
  const expressionDefinitions = Array.isArray(refs.Expressions) ? refs.Expressions.flatMap(value => {
    const item = record(value);
    return typeof item.Name === 'string' && typeof item.File === 'string' ? [{ Name: item.Name, File: item.File }] : [];
  }) : [];
  return detectLive2DCapabilities({ areas, motions, expressions, expressionDefinitions });
}
