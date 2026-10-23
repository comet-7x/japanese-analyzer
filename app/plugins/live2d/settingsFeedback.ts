/** Count changed fields; an ordered list is one setting, not one change per character. */
export function countSettingChanges(before: unknown, after: unknown): number {
  if (JSON.stringify(before) === JSON.stringify(after)) return 0;
  if (before && after && typeof before === 'object' && typeof after === 'object' && !Array.isArray(before) && !Array.isArray(after)) {
    const a = before as Record<string, unknown>, b = after as Record<string, unknown>;
    return [...new Set([...Object.keys(a), ...Object.keys(b)])].reduce((total, key) => total + countSettingChanges(a[key], b[key]), 0);
  }
  return 1;
}
