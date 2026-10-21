import type { Live2DAction } from './capabilities';
import type { ResourceUse } from './resourceConfig';
import type { ActionProfile } from './actionProfile';
import { actionName } from './actionProfile';
import type { Translator } from '../../i18n';

export const RESOURCE_PAGE_SIZE = 50;
export function indexResourceUses(uses: ResourceUse[]) {
  const index = new Map<string, ResourceUse[]>();
  for (const use of uses) if (use.resolution.status === 'action') {
    const list = index.get(use.resolution.action.id) ?? [];
    list.push(use); index.set(use.resolution.action.id, list);
  }
  return index;
}
export function filterResources(actions: Live2DAction[], profile: ActionProfile, uses: Map<string, ResourceUse[]>, search: string, kind: string, purpose: string, t?: Translator) {
  const query = search.toLocaleLowerCase();
  return actions.filter((action, index) => {
    if (kind !== 'all' && action.kind !== kind) return false;
    const assigned = uses.get(action.id) ?? [];
    if (purpose === 'unused' && assigned.length) return false;
    if (purpose !== 'all' && purpose !== 'unused' && !assigned.some(use => purpose === 'idle' ? use.target === 'idle' : purpose === 'tap' ? /^(area|zone):/.test(use.target) : use.target.startsWith(purpose + ':'))) return false;
    return !query || `${actionName(action, profile, index + 1, t)} ${action.name} ${action.file}`.toLocaleLowerCase().includes(query);
  });
}
