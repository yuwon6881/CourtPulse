/**
 * Canonical CourtPulse brand mark geometry and colors.
 * Shared directly by the in-app React component (CourtPulseMark.tsx) and the
 * static PWA/favicon generator (scripts/generate-icons.mjs) so they never drift.
 */

export const COURTPULSE_BRAND = {
  themeColor: '#059669',
  emeraldLight: '#10b981',
  emeraldMid: '#059669',
  emeraldDeep: '#047857',
  emeraldDark: '#064e3b',
  glowMint: '#a7f3d0',
  featherSide: '#ecfdf5',
  backgroundColor: '#f8fafc',
} as const;

export const COURTPULSE_MARK_GEOMETRY = {
  viewBoxSize: 512,
  roundedRadius: 115,
  rimInset: 1.5,
  rimSize: 509,
  rimRadius: 113.5,
  rimStrokeWidth: 3,
  // Optical center along the upright symmetry axis places the mark balanced inside
  // circular, squircle, teardrop, and superellipse masks.
  centerX: 256,
  centerY: 256,
  rotationDeg: 45,
  opticalPivotY: -10,
  // "any" / UI rounded tiles fill the frame comfortably; maskable / iOS stay well inside
  // both the W3C 80% safe zone (r <= 204.8) and Android's 66.7% viewport (r <= 170.7).
  roundedScale: 1.06,
  maskableScale: 0.94,
  innerArcPath: 'M -47.5 -91.9 A 62 62 0 0 1 47.5 -91.9',
  innerArcStrokeWidth: 18,
  innerArcOpacity: 0.95,
  outerArcPath: 'M -69.1 -118.7 A 96 96 0 0 1 69.1 -118.7',
  outerArcStrokeWidth: 16,
  outerArcOpacity: 0.8,
  corkPath:
    'M -30 -24 L -30 -50 C -30 -72 -17 -88 0 -88 C 17 -88 30 -72 30 -50 L 30 -24 C 30 -20 27 -18 23 -18 L -23 -18 C -27 -18 -30 -20 -30 -24 Z',
  collar: { x: -35, y: -8, width: 70, height: 17, rx: 8.5 },
  leftFeatherPath:
    'M -37 21 L -90 128 C -95 138 -88 150 -76 149 L -46 146 C -39 145 -34 140 -33 132 L -23 20 Z',
  rightFeatherPath:
    'M 37 21 L 90 128 C 95 138 88 150 76 149 L 46 146 C 39 145 34 140 33 132 L 23 20 Z',
  centerFeatherPath:
    'M -11 20 L -19 149 C -20 161 -12 169 0 169 C 12 169 20 161 19 149 L 11 20 Z',
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
  const {
    size = 512,
    rounded = true,
    includeShadow = true,
    idPrefix = 'cp',
  } = options;

  const g = COURTPULSE_MARK_GEOMETRY;
  const b = COURTPULSE_BRAND;

  const bgId = `${idPrefix}-bg`;
  const glId = `${idPrefix}-gl`;
  const rimId = `${idPrefix}-rim`;
  const shId = `${idPrefix}-sh`;
  const clId = `${idPrefix}-cl`;

  const clipRect = rounded
    ? `<rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" rx="${g.roundedRadius}"/>`
    : `<rect width="${g.viewBoxSize}" height="${g.viewBoxSize}"/>`;

  const rimStroke = rounded
    ? `<rect x="${g.rimInset}" y="${g.rimInset}" width="${g.rimSize}" height="${g.rimSize}" rx="${g.rimRadius}" fill="none" stroke="url(#${rimId})" stroke-width="${g.rimStrokeWidth}"/>`
    : '';

  const shadowFilter = includeShadow
    ? `<filter id="${shId}" x="-40%" y="-40%" width="180%" height="180%">
      <feDropShadow dx="0" dy="8" stdDeviation="10" flood-color="#022c22" flood-opacity="0.30"/>
    </filter>`
    : '';

  const shuttleFilterAttr = includeShadow ? ` filter="url(#${shId})"` : '';
  const sizeAttrs = size > 0 ? ` width="${size}" height="${size}"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.viewBoxSize} ${g.viewBoxSize}"${sizeAttrs}>
  <defs>
    <linearGradient id="${bgId}" x1="0.08" y1="0" x2="0.92" y2="1">
      <stop offset="0%" stop-color="${b.emeraldLight}"/>
      <stop offset="46%" stop-color="${b.emeraldMid}"/>
      <stop offset="84%" stop-color="${b.emeraldDeep}"/>
      <stop offset="100%" stop-color="${b.emeraldDark}"/>
    </linearGradient>
    <radialGradient id="${glId}" cx="68%" cy="28%" r="60%">
      <stop offset="0%" stop-color="${b.glowMint}" stop-opacity="0.34"/>
      <stop offset="100%" stop-color="${b.emeraldMid}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${rimId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.30"/>
      <stop offset="50%" stop-color="#ffffff" stop-opacity="0.06"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.16"/>
    </linearGradient>
    ${shadowFilter}
    <clipPath id="${clId}">${clipRect}</clipPath>
  </defs>
  <g clip-path="url(#${clId})">
    <rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="url(#${bgId})"/>
    <rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="url(#${glId})"/>
    ${rimStroke}
    <g transform="${buildMarkTransform(rounded)}">
      <g fill="none" stroke-linecap="round">
        <path d="${g.innerArcPath}" stroke="#ffffff" stroke-width="${g.innerArcStrokeWidth}" stroke-opacity="${g.innerArcOpacity}"/>
        <path d="${g.outerArcPath}" stroke="${b.glowMint}" stroke-width="${g.outerArcStrokeWidth}" stroke-opacity="${g.outerArcOpacity}"/>
      </g>
      <g${shuttleFilterAttr}>
        <path d="${g.corkPath}" fill="#ffffff"/>
        <rect x="${g.collar.x}" y="${g.collar.y}" width="${g.collar.width}" height="${g.collar.height}" rx="${g.collar.rx}" fill="${b.glowMint}"/>
        <path d="${g.leftFeatherPath}" fill="${b.featherSide}"/>
        <path d="${g.rightFeatherPath}" fill="${b.featherSide}"/>
        <path d="${g.centerFeatherPath}" fill="#ffffff"/>
      </g>
    </g>
  </g>
</svg>`;
}
