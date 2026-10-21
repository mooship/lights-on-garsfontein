import { keyframes, style } from '@vanilla-extract/css';

// Motion only confirms that something happened: data arriving or the status changing. It moves
// opacity and transform alone, so it never shifts layout, and the reduced-motion rule in the global
// styles stills all of it.

/** For movement that settles, rather than a mechanical ease-out. */
export const SETTLE = 'cubic-bezier(0.2, 0.8, 0.2, 1)';

const rise = keyframes({ from: { opacity: 0, transform: 'translateY(4px)' } });
const fade = keyframes({ from: { opacity: 0 } });
const pop = keyframes({
  '0%': { opacity: 0, transform: 'scale(0.6)' },
  '60%': { opacity: 1, transform: 'scale(1.08)' },
});

/** Content taking a skeleton's place, or newly added. Block boxes only: a transform skips inline ones. */
export const enter = style({ animation: `${rise} 220ms ease-out backwards` });

/** The status icon, when a poll changes the status. */
export const changedIcon = style({ animation: `${pop} 420ms ${SETTLE} backwards` });

/** The status headline, when a poll changes the status; inline, so opacity alone. */
export const changedText = style({ animation: `${fade} 320ms ease-out backwards` });

const sink = keyframes({ to: { opacity: 0, transform: 'translateY(4px)' } });

/** On its way out; the owner removes it once the animation ends. */
export const leave = style({ animation: `${sink} 180ms ease-in forwards` });
