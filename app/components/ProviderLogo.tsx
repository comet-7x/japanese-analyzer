'use client';

import Image from 'next/image';
import { getProviderIcon, type ProviderLogoProfile } from '../lib/providerIcons';

interface ProviderLogoProps {
  profile: ProviderLogoProfile | null;
  className?: string;
}

function letterOf(name: string): string {
  const trimmed = (name || '').trim();
  return trimmed ? trimmed[0].toUpperCase() : '?';
}

export function ProviderLogo({ profile, className = 'h-4 w-4' }: ProviderLogoProps) {
  const src = getProviderIcon(profile);

  if (src) {
    return (
      <Image
        unoptimized
        width={16}
        height={16}
        src={src}
        alt=""
        aria-hidden="true"
        className={`${className} shrink-0 rounded-full bg-white object-contain p-[2px] ring-1 ring-black/10`}
      />
    );
  }

  if (!profile) {
    return (
      <span
        className={`${className} grid shrink-0 place-items-center rounded-full text-[9px] font-semibold`}
        style={{ background: 'var(--line-2)', color: 'var(--ink-3)' }}
        aria-hidden="true"
      >
        ?
      </span>
    );
  }

  return (
    <span
      className={`${className} grid shrink-0 place-items-center rounded-full text-[9px] font-semibold`}
      style={{ background: 'var(--primary-soft)', color: 'var(--primary)' }}
      aria-hidden="true"
    >
      {letterOf(profile.name)}
    </span>
  );
}
