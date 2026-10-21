'use client';
import { useEffect, type RefObject } from 'react';
const stack: HTMLElement[] = [];
const controls = 'button:not(:disabled), input:not(:disabled), select:not(:disabled), textarea:not(:disabled), a[href], summary, [tabindex="0"]';
/** Scope focus and inertness to the active dialog, including nested portal editors. */
export function useModalFocus(root: RefObject<HTMLElement | null>, open: boolean) {
  useEffect(() => {
    const dialog = root.current;
    if (!open || !dialog) return;
    const previous = document.activeElement instanceof HTMLElement ? document.activeElement : null;
    const changed: Array<{ element: HTMLElement; inert: boolean }> = [];
    let branch: HTMLElement = dialog;
    while (branch.parentElement) {
      for (const element of branch.parentElement.children) {
        if (element !== branch && element instanceof HTMLElement && !['SCRIPT', 'STYLE', 'LINK'].includes(element.tagName)) {
          changed.push({ element, inert: element.inert }); element.inert = true;
        }
      }
      if (branch.parentElement === document.body) break;
      branch = branch.parentElement;
    }
    stack.push(dialog);
    const focusables = () => Array.from(dialog.querySelectorAll<HTMLElement>(controls)).filter(element => element.getClientRects().length && !element.closest('[inert]'));
    const focusFirst = () => (focusables()[0] ?? dialog).focus({ preventScroll: true });
    if (!dialog.contains(document.activeElement)) focusFirst();
    const keydown = (event: KeyboardEvent) => {
      if (stack.at(-1) !== dialog || event.key !== 'Tab') return;
      const items = focusables(), first = items[0], last = items.at(-1);
      if (!first) { event.preventDefault(); dialog.focus(); }
      else if (event.shiftKey && (document.activeElement === first || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); last?.focus(); }
      else if (!event.shiftKey && (document.activeElement === last || !items.includes(document.activeElement as HTMLElement))) { event.preventDefault(); first.focus(); }
    };
    const focusin = (event: FocusEvent) => { if (stack.at(-1) === dialog && !dialog.contains(event.target as Node)) focusFirst(); };
    document.addEventListener('keydown', keydown);
    document.addEventListener('focusin', focusin);
    return () => {
      stack.splice(stack.indexOf(dialog), 1);
      document.removeEventListener('keydown', keydown); document.removeEventListener('focusin', focusin);
      for (const { element, inert } of changed.reverse()) element.inert = inert;
      if (previous?.isConnected && !previous.closest('[inert]')) previous.focus({ preventScroll: true });
    };
  }, [root, open]);
}
