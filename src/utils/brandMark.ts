/**
 * Canonical CourtPulse brand mark geometry and colors.
 * Shared directly by the in-app React component (CourtPulseMark.tsx) and the
 * static PWA/favicon generator (scripts/generate-icons.mjs) so they never drift.
 */

export const COURTPULSE_BRAND = {
  themeColor: '#059669',
  tileBg: '#047857',
  markPrimary: '#ffffff',
  markAccent: '#a7f3d0',
  backgroundColor: '#f2f4f5',
} as const;

export const COURTPULSE_MARK_GEOMETRY = {
  viewBoxSize: 512,
  roundedRadius: 118,
  // Optical center along the upright symmetry axis places the mark balanced inside
  // circular, squircle, teardrop, and superellipse masks.
  centerX: 256,
  centerY: 256,
  rotationDeg: 40,
  opticalPivotY: -20,
  // "any" / UI rounded tiles fill the frame comfortably; maskable / iOS stay well inside
  // both the W3C 80% safe zone (r <= 204.8) and Android's 66.7% viewport (r <= 170.7).
  roundedScale: 1.08,
  maskableScale: 0.9,
  // Clean aerodynamic arc framing the shuttlecock nose
  pulseCrestPath:
    'M -72 -84 C -48 -142 48 -142 72 -84 C 46 -116 -46 -116 -72 -84 Z',
  corkPath:
    'M -34 -22 L -34 -48 C -34 -74 -19 -92 0 -92 C 19 -92 34 -74 34 -48 L 34 -22 C 34 -16 30 -12 24 -12 L -24 -12 C -30 -12 -34 -16 -34 -22 Z',
  collar: { x: -40, y: 0, width: 80, height: 19, rx: 9.5 },
  leftFeatherPath:
    'M -42 30 L -96 126 C -101 136 -94 148 -82 147 L -50 144 C -42 143 -37 137 -36 128 L -27 30 Z',
  rightFeatherPath:
    'M 42 30 L 96 126 C 101 136 94 148 82 147 L 50 144 C 42 143 37 137 36 128 L 27 30 Z',
  centerFeatherPath:
    'M -15 30 L -24 146 C -25 158 -14 166 0 166 C 14 166 25 158 24 146 L 15 30 Z',
} as const;

export interface BuildCourtPulseTileSvgOptions {
  size?: number;
  rounded?: boolean;
  includeShadow?: boolean;
  idPrefix?: string;
}

export function buildMarkTransform(rounded: boolean): string {
  const g = COURTPULSE_MARK_GEOMETRY;
  const scale = rounded ? g.roundedScale : g.maskableScale;
  return `translate(${g.centerX} ${g.centerY}) rotate(${g.rotationDeg}) scale(${scale}) translate(0 ${g.opticalPivotY})`;
}

export function buildCourtPulseTileSvg(
  options: BuildCourtPulseTileSvgOptions = {}
): string {
  const { size = 512, rounded = true } = options;

  const g = COURTPULSE_MARK_GEOMETRY;
  const b = COURTPULSE_BRAND;

  const tileRect = rounded
    ? `<rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" rx="${g.roundedRadius}" fill="${b.tileBg}"/>`
    : `<rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="${b.tileBg}"/>`;

  const sizeAttrs = size > 0 ? ` width="${size}" height="${size}"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.viewBoxSize} ${g.viewBoxSize}"${sizeAttrs}>
  ${tileRect}
  <g transform="${buildMarkTransform(rounded)}">
    <path d="${g.pulseCrestPath}" fill="${b.markAccent}"/>
    <path d="${g.corkPath}" fill="${b.markPrimary}"/>
    <rect x="${g.collar.x}" y="${g.collar.y}" width="${g.collar.width}" height="${g.collar.height}" rx="${g.collar.rx}" fill="${b.markAccent}"/>
    <path d="${g.leftFeatherPath}" fill="${b.markPrimary}"/>
    <path d="${g.rightFeatherPath}" fill="${b.markPrimary}"/>
    <path d="${g.centerFeatherPath}" fill="${b.markPrimary}"/>
  </g>
</svg>`;
}
