import { style } from '@vanilla-extract/css';

export const root = style({ display: 'flex', flexDirection: 'column', gap: '0.5rem' });

export const widget = style({ selectors: { '&:empty': { display: 'none' } } });
