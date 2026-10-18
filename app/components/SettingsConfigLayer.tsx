'use client';

import { useEffect, type ReactNode } from 'react';
import { createPortal } from 'react-dom';

/** Keep nested editors outside the animated, scrollable settings container. */
export default function SettingsConfigLayer({ children, onClose }: { children: ReactNode; onClose?: () => void }) {
  useEffect(() => {
    const containers = [document.body, ...document.querySelectorAll<HTMLElement>('.settings-modal-content')];
    const previous = containers.map((element) => element.style.overflow);
    containers.forEach((element) => { element.style.overflow = 'hidden'; });
    return () => containers.forEach((element, index) => { element.style.overflow = previous[index]; });
  }, []);
  useEffect(() => {
    if (!onClose) return;
    const handleEscape = (event: KeyboardEvent) => {
      if (event.key !== 'Escape') return;
      event.preventDefault(); event.stopImmediatePropagation();
      onClose();
    };
    document.addEventListener('keydown', handleEscape, true);
    return () => document.removeEventListener('keydown', handleEscape, true);
  }, [onClose]);
  return createPortal(children, document.body);
}
