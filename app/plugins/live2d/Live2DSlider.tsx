'use client';

import { useEffect, useRef, useState, type InputHTMLAttributes } from 'react';
import { motion, useReducedMotion, useSpring } from 'motion/react';

export const CONTROL_SPRING = { stiffness: 700, damping: 36, mass: .4, restDelta: .01, restSpeed: .1 };
const IMPULSE_SPRING = { stiffness: 900, damping: 22, mass: .3, restDelta: .005, restSpeed: .05 };

type Props = Omit<InputHTMLAttributes<HTMLInputElement>, 'type' | 'value' | 'min' | 'max' | 'onChange'> & {
  value: number; min: number; max: number; onValueChange: (value: number) => void;
};

export default function Live2DSlider({ value, min, max, onValueChange, ...props }: Props) {
  const reduced = useReducedMotion();
  const [active, setActive] = useState(false);
  const progress = Math.max(0, Math.min(100, (value - min) / (max - min) * 100));
  const impulse = useSpring(0, IMPULSE_SPRING);
  const emphasis = useSpring(1, CONTROL_SPRING);
  // Position is direct manipulation: fill and thumb must commit together.
  // Springs are reserved for press scale and the small perpendicular impulse.
  const position = `${progress}%`;
  const last = useRef(value);
  const lastImpulse = useRef(0);

  useEffect(() => {
    if (reduced) impulse.jump(0);
    else {
      if (last.current !== value && performance.now() - lastImpulse.current >= 70) {
        // A sub-pixel impulse settles through a real damped spring, without moving the value.
        impulse.jump(value === min || value === max ? 1.2 : .7);
        impulse.set(0);
        lastImpulse.current = performance.now();
      }
    }
    last.current = value;
  }, [value, min, max, reduced, impulse]);

  useEffect(() => {
    if (reduced) emphasis.jump(1);
    else emphasis.set(active ? 1.12 : 1);
  }, [active, reduced, emphasis]);

  return <span className="live2d-slider" data-active={active || undefined} data-reduced-motion={reduced || undefined}>
    <span className="live2d-slider-rail" aria-hidden="true">
      <span className="live2d-slider-fill" style={{ width: position }} />
    </span>
    <span className="live2d-slider-handle-layer" aria-hidden="true">
      <span className="live2d-slider-thumb-position" style={{ left: position }}>
        <motion.span className="live2d-slider-thumb" style={{ y: impulse, scale: emphasis }} />
      </span>
    </span>
    <input {...props} type="range" value={value} min={min} max={max}
      onChange={event => onValueChange(Number(event.target.value))}
      onPointerDown={event => { setActive(true); event.currentTarget.setPointerCapture(event.pointerId); props.onPointerDown?.(event); }}
      onPointerUp={event => { setActive(false); props.onPointerUp?.(event); }}
      onPointerCancel={event => { setActive(false); props.onPointerCancel?.(event); }}
      onLostPointerCapture={event => { setActive(false); props.onLostPointerCapture?.(event); }}
      onFocus={event => { setActive(true); props.onFocus?.(event); }}
      onBlur={event => { setActive(false); props.onBlur?.(event); }} />
  </span>;
}
