/** Service-owned vocabulary; extend this catalog instead of adding model-specific branches. */
export const INTERACTION_PARTS = {
  head: { label: '头部互动', pattern: /head|face|頭|顔|头|脸/i, aliases: ['head', 'face'] },
  body: { label: '身体互动', pattern: /body|bust|chest|胴|胸|身体|身體/i, aliases: ['body', 'bust', 'chest'] },
  leftHand: { label: '左手互动', pattern: /left[ _-]*hand|hand[ _-]*left|左手/i, aliases: ['lefthand', 'handleft'] },
  rightHand: { label: '右手互动', pattern: /right[ _-]*hand|hand[ _-]*right|右手/i, aliases: ['righthand', 'handright'] },
  leftArm: { label: '左臂互动', pattern: /left[ _-]*arm|arm[ _-]*left|左腕|左臂/i, aliases: ['leftarm', 'armleft'] },
  rightArm: { label: '右臂互动', pattern: /right[ _-]*arm|arm[ _-]*right|右腕|右臂/i, aliases: ['rightarm', 'armright'] },
  leftLeg: { label: '左腿互动', pattern: /left[ _-]*leg|leg[ _-]*left|左足|左腿/i, aliases: ['leftleg', 'legleft'] },
  rightLeg: { label: '右腿互动', pattern: /right[ _-]*leg|leg[ _-]*right|右足|右腿/i, aliases: ['rightleg', 'legright'] },
} as const;
export type InteractionPart = keyof typeof INTERACTION_PARTS;
export function interactionPart(area: string): InteractionPart | null {
  return (Object.keys(INTERACTION_PARTS) as InteractionPart[]).find(part => INTERACTION_PARTS[part].pattern.test(area)) ?? null;
}
const normalize = (name: string) => name.toLowerCase().replace(/hit[ _-]*area/gi, '').replace(/[\s_@.\-]/g, '');
const actions = ['tap', 'touch', 'pat', 'flick', 'click', 'タップ', 'なでる', '点击', '轻触', '触摸'];

export function areasForPart(areas: string[], part: InteractionPart): string[] {
  return areas.filter(area => INTERACTION_PARTS[part].pattern.test(area));
}

/** Only select a declared part's motion or an explicitly generic interaction. Never substitute another body part or Idle. */
export function resolveInteractionMotion(areas: string[], definitions: Record<string, readonly unknown[] | undefined>): string | null {
  if (!areas.length) return null;
  const groups = Object.keys(definitions).filter(name => (definitions[name]?.length ?? 0) > 0);
  // A head region can overlap a larger body region; prefer the more specific head hit.
  const head = areasForPart(areas, 'head');
  const ordered = head.length ? head : areas;
  for (const area of ordered) {
    const aliases = [normalize(area)];
    const part = interactionPart(area);
    if (part) aliases.push(...INTERACTION_PARTS[part].aliases);
    for (const alias of aliases) {
      const group = groups.find(name => {
        const candidate = normalize(name);
        return candidate === alias || actions.some(action => candidate === action + alias || candidate === alias + action);
      });
      if (group) return group;
    }
  }
  return groups.find(name => /^(tap|touch|interact|interaction)$/i.test(name)) ?? null;
}

export function isCharacterTap(start: { pointerId: number; startX: number; startY: number; moved: boolean },
  event: { type: string; pointerId: number; clientX: number; clientY: number; button: number; isPrimary: boolean }): boolean {
  return event.type === 'pointerup' && event.isPrimary && event.button === 0 && start.pointerId === event.pointerId
    && !start.moved && Math.hypot(event.clientX - start.startX, event.clientY - start.startY) < 5;
}
