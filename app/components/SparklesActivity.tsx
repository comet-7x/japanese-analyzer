import { I } from './Icons';

/** A steady central star with small surrounding stars fading in and out. */
export default function SparklesActivity({ className = '' }: { className?: string }) {
  return <span className={`batch-sparkles ${className}`} aria-hidden="true">
    <I w={18} sw={1.5}>
      <path d="m11 6-1.6 4.4L5 12l4.4 1.6L11 18l1.6-4.4L17 12l-4.4-1.6Z" />
      <path className="batch-sparkle batch-sparkle-one" d="m19 2 .8 2.2L22 5l-2.2.8L19 8l-.8-2.2L16 5l2.2-.8Z" />
      <path className="batch-sparkle batch-sparkle-two" d="m20 16 .6 1.9L22.5 18.5l-1.9.6L20 21l-.6-1.9-1.9-.6 1.9-.6Z" />
      <path className="batch-sparkle batch-sparkle-three" d="m4 3 .6 1.4L6 5l-1.4.6L4 7l-.6-1.4L2 5l1.4-.6Z" />
    </I>
  </span>;
}
