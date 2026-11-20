/**
 * Canonical CourtPulse brand mark geometry and colors.
 * Shared directly by the in-app React component (CourtPulseMark.tsx) and the
 * static PWA/favicon generator (scripts/generate-icons.mjs) so they never drift.
 */

export const COURTPULSE_BRAND = {
  themeColor: '#059669',
  tileTop: '#0b221c',
  tileMid: '#072c22',
  tileDeep: '#041a15',
  tileBase: '#03110e',
  emeraldLight: '#34d399',
  emeraldMid: '#10b981',
  emeraldDeep: '#059669',
  glowMint: '#6ee7b7',
  featherSide: '#d1fae5',
  backgroundColor: '#f2f4f5',
} as const;

export const COURTPULSE_MARK_GEOMETRY = {
  viewBoxSize: 512,
  roundedRadius: 118,
  rimInset: 1.5,
  rimSize: 509,
  rimRadius: 116.5,
  rimStrokeWidth: 3,
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
  // Subtle architectural court service arcs framing the obsidian-emerald tile
  courtArcOuter: 'M 224 512 A 288 288 0 0 1 512 224',
  courtArcInner: 'M 0 196 A 212 212 0 0 1 196 0',
  // Tapered aerodynamic pulse crest wrapping the shuttlecock nose (velocity / rally arc)
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
  const gl2Id = `${idPrefix}-gl2`;
  const accentId = `${idPrefix}-ac`;
  const featherId = `${idPrefix}-ft`;
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
      <feDropShadow dx="0" dy="10" stdDeviation="12" flood-color="#000000" flood-opacity="0.45"/>
    </filter>`
    : '';

  const shuttleFilterAttr = includeShadow ? ` filter="url(#${shId})"` : '';
  const sizeAttrs = size > 0 ? ` width="${size}" height="${size}"` : '';

  return `<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 ${g.viewBoxSize} ${g.viewBoxSize}"${sizeAttrs}>
  <defs>
    <linearGradient id="${bgId}" x1="0.06" y1="0" x2="0.94" y2="1">
      <stop offset="0%" stop-color="${b.tileTop}"/>
      <stop offset="44%" stop-color="${b.tileMid}"/>
      <stop offset="82%" stop-color="${b.tileDeep}"/>
      <stop offset="100%" stop-color="${b.tileBase}"/>
    </linearGradient>
    <radialGradient id="${glId}" cx="74%" cy="22%" r="64%">
      <stop offset="0%" stop-color="${b.emeraldMid}" stop-opacity="0.46"/>
      <stop offset="52%" stop-color="${b.emeraldDeep}" stop-opacity="0.16"/>
      <stop offset="100%" stop-color="${b.tileDeep}" stop-opacity="0"/>
    </radialGradient>
    <radialGradient id="${gl2Id}" cx="18%" cy="88%" r="48%">
      <stop offset="0%" stop-color="${b.emeraldLight}" stop-opacity="0.12"/>
      <stop offset="100%" stop-color="${b.tileBase}" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="${accentId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${b.glowMint}"/>
      <stop offset="50%" stop-color="${b.emeraldLight}"/>
      <stop offset="100%" stop-color="${b.emeraldMid}"/>
    </linearGradient>
    <linearGradient id="${featherId}" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0%" stop-color="#ffffff"/>
      <stop offset="100%" stop-color="${b.featherSide}"/>
    </linearGradient>
    <linearGradient id="${rimId}" x1="0" y1="0" x2="1" y2="1">
      <stop offset="0%" stop-color="${b.glowMint}" stop-opacity="0.42"/>
      <stop offset="42%" stop-color="${b.emeraldLight}" stop-opacity="0.14"/>
      <stop offset="100%" stop-color="#000000" stop-opacity="0.32"/>
    </linearGradient>
    ${shadowFilter}
    <clipPath id="${clId}">${clipRect}</clipPath>
  </defs>
  <g clip-path="url(#${clId})">
    <rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="url(#${bgId})"/>
    <rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="url(#${glId})"/>
    <rect width="${g.viewBoxSize}" height="${g.viewBoxSize}" fill="url(#${gl2Id})"/>
    <g fill="none" stroke="${b.emeraldLight}" stroke-opacity="0.12" stroke-width="5">
      <path d="${g.courtArcOuter}"/>
      <path d="${g.courtArcInner}"/>
    </g>
    ${rimStroke}
    <g transform="${buildMarkTransform(rounded)}"${shuttleFilterAttr}>
      <path d="${g.pulseCrestPath}" fill="url(#${accentId})"/>
      <path d="${g.corkPath}" fill="#ffffff"/>
      <rect x="${g.collar.x}" y="${g.collar.y}" width="${g.collar.width}" height="${g.collar.height}" rx="${g.collar.rx}" fill="url(#${accentId})"/>
      <path d="${g.leftFeatherPath}" fill="url(#${featherId})"/>
      <path d="${g.rightFeatherPath}" fill="url(#${featherId})"/>
      <path d="${g.centerFeatherPath}" fill="#ffffff"/>
    </g>
  </g>
</svg>`;
}
