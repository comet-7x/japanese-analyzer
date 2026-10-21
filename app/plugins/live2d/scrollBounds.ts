export interface ScrollBounds { left: number; top: number; right: number; bottom: number }
export function intersectScrollBounds(target: ScrollBounds, clips: readonly ScrollBounds[]): ScrollBounds {
  return clips.reduce((rect, clip) => ({ left: Math.max(rect.left, clip.left), top: Math.max(rect.top, clip.top),
    right: Math.min(rect.right, clip.right), bottom: Math.min(rect.bottom, clip.bottom) }),
  { left: target.left, top: target.top, right: target.right, bottom: target.bottom });
}
/** Portal scrollbars must respect every clipping ancestor, including a dialog's footer. */
export function visibleScrollBounds(target: HTMLElement): ScrollBounds {
  const viewport = window.visualViewport;
  const left = viewport?.offsetLeft ?? 0, top = viewport?.offsetTop ?? 0;
  const clips: ScrollBounds[] = [{ left, top, right: left + (viewport?.width ?? window.innerWidth), bottom: top + (viewport?.height ?? window.innerHeight) }];
  for (let parent = target.parentElement; parent; parent = parent.parentElement) {
    const style = getComputedStyle(parent);
    const x = /auto|scroll|hidden|clip/.test(style.overflowX), y = /auto|scroll|hidden|clip/.test(style.overflowY);
    if (!x && !y) continue;
    const rect = parent.getBoundingClientRect();
    clips.push({ left: x ? rect.left + parent.clientLeft : -Infinity, right: x ? rect.left + parent.clientLeft + parent.clientWidth : Infinity,
      top: y ? rect.top + parent.clientTop : -Infinity, bottom: y ? rect.top + parent.clientTop + parent.clientHeight : Infinity });
  }
  return intersectScrollBounds(target.getBoundingClientRect(), clips);
}
