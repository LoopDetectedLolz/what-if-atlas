/**
 * The map palette: 24 colours plus reset-to-white.
 *
 * This is content, not chrome — a deliberate exception to the blog's "don't add
 * a new colour" rule, which governs the interface, not the map's contents.
 *
 * Chosen so that any two neighbours are told apart by someone with the common
 * forms of colour blindness: six hue families at four lightness steps, with the
 * lightness steps carrying enough contrast on their own that a deuteranope
 * still sees four distinct bands within a family. Mid tones are muted rather
 * than saturated so black hatching and dark labels stay legible on top.
 */

export interface Swatch {
  hex: string;
  name: string;
}

export const RESET = '#FFFFFF';

export const PALETTE: readonly Swatch[] = [
  // reds
  { hex: '#FBD5CE', name: 'Blush' },
  { hex: '#F0A08E', name: 'Clay' },
  { hex: '#D4624B', name: 'Brick' },
  { hex: '#8F3524', name: 'Oxblood' },
  // ambers
  { hex: '#FDE7C0', name: 'Sand' },
  { hex: '#F5C778', name: 'Wheat' },
  { hex: '#D99B31', name: 'Ochre' },
  { hex: '#8F5F11', name: 'Umber' },
  // greens
  { hex: '#D7EFC9', name: 'Mint' },
  { hex: '#A3D48A', name: 'Moss' },
  { hex: '#5E9E4B', name: 'Fern' },
  { hex: '#2F5F26', name: 'Pine' },
  // teals
  { hex: '#CDEBEA', name: 'Ice' },
  { hex: '#8CCFCF', name: 'Lagoon' },
  { hex: '#43979B', name: 'Teal' },
  { hex: '#1C5A5F', name: 'Deep teal' },
  // blues
  { hex: '#D3E3F7', name: 'Sky' },
  { hex: '#9CBCE8', name: 'Cornflower' },
  { hex: '#4F7CC0', name: 'Slate blue' },
  { hex: '#23457A', name: 'Navy' },
  // purples
  { hex: '#E6D8F0', name: 'Lilac' },
  { hex: '#C0A4DB', name: 'Mauve' },
  { hex: '#8B64B0', name: 'Violet' },
  { hex: '#4D3070', name: 'Aubergine' },
];

/** Is this colour dark enough that text or hatching on it should be light? */
export function isDark(hex: string): boolean {
  const n = hex.replace('#', '');
  const r = parseInt(n.slice(0, 2), 16);
  const g = parseInt(n.slice(2, 4), 16);
  const b = parseInt(n.slice(4, 6), 16);
  // Rec. 709 relative luminance, which tracks perceived brightness far better
  // than a plain RGB average.
  return (0.2126 * r + 0.7152 * g + 0.0722 * b) / 255 < 0.55;
}
