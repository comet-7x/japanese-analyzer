'use client';

import { useEffect, useRef, type ReactNode } from 'react';
import { useModalFocus } from './useModalFocus';
import { createPortal } from 'react-dom';

/** Keep nested editors outside the animated, scrollable settings container. */
export default function SettingsConfigLayer({ children, onClose }: { children: ReactNode; onClose: () => void }) {
  const root = useRef<HTMLDivElement>(null);
  useModalFocus(root, true);
  useEffect(() => {
    const containers = [document.body, ...document.querySelectorAll<HTMLElement>('.settings-modal-content')];
    const previous = containers.map((element) => element.style.overflow);
    containers.forEach((element) => { element.style.overflow = 'hidden'; });
    return () => containers.forEach((element, index) => { element.style.overflow = previous[index]; });
  }, []);
  useEffect(() => {
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      onClose();
    };
    // Handle the nested editor before the parent settings dialog's bubble listener.
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);
  return createPortal(<div ref={root} tabIndex={-1}>{children}</div>, document.body);
}
