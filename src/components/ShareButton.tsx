import { useState } from 'react';
import { shareLink } from '../lib/share';
import { useSim } from '../sim/store';

/** Copies a link that opens this exact vehicle design for whoever receives it. */
export default function ShareButton({ className = 'btn ghost' }: { className?: string }) {
  const { vehicle } = useSim();
  const [state, setState] = useState<'idle' | 'copied' | 'failed'>('idle');
  return (
    <button
      className={className}
      onClick={async () => {
        try {
          await navigator.clipboard.writeText(await shareLink(vehicle));
          setState('copied');
        } catch {
          setState('failed');
        }
        setTimeout(() => setState('idle'), 2400);
      }}
    >
      {state === 'copied' ? 'Link copied' : state === 'failed' ? 'Copy failed' : 'Copy share link'}
    </button>
  );
}
