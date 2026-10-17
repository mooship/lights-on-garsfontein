import { style } from '@vanilla-extract/css';
import { vars } from './styles/theme.css';

export const error = style({ color: vars.color.off, fontWeight: 600, margin: 'auto 0' });
