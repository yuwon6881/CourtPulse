import React, { useId } from 'react';
import {
  buildMarkTransform,
  COURTPULSE_BRAND,
  COURTPULSE_MARK_GEOMETRY,
} from '../../utils/brandMark.ts';

interface CourtPulseMarkProps {
  className?: string;
}

/**
 * Inline vector brand mark matching the PWA launcher tile (src/utils/brandMark.ts).
 * Uses a per-instance SVG ID prefix so multiple marks on the page never collide.
 */
export const CourtPulseMark: React.FC<CourtPulseMarkProps> = ({
  className = 'w-7 h-7',
}) => {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '');
  const bgId = `cpm-bg-${uid}`;
  const glId = `cpm-gl-${uid}`;
  const gl2Id = `cpm-gl2-${uid}`;
  const accentId = `cpm-ac-${uid}`;
  const featherId = `cpm-ft-${uid}`;
  const rimId = `cpm-rim-${uid}`;
  const clId = `cpm-cl-${uid}`;

  const g = COURTPULSE_MARK_GEOMETRY;
  const b = COURTPULSE_BRAND;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${g.viewBoxSize} ${g.viewBoxSize}`}
      aria-hidden="true"
      className={className}
    >
      <defs>
        <linearGradient id={bgId} x1="0.06" y1="0" x2="0.94" y2="1">
          <stop offset="0%" stopColor={b.tileTop} />
          <stop offset="44%" stopColor={b.tileMid} />
          <stop offset="82%" stopColor={b.tileDeep} />
          <stop offset="100%" stopColor={b.tileBase} />
        </linearGradient>
        <radialGradient id={glId} cx="74%" cy="22%" r="64%">
          <stop offset="0%" stopColor={b.emeraldMid} stopOpacity="0.46" />
          <stop offset="52%" stopColor={b.emeraldDeep} stopOpacity="0.16" />
          <stop offset="100%" stopColor={b.tileDeep} stopOpacity="0" />
        </radialGradient>
        <radialGradient id={gl2Id} cx="18%" cy="88%" r="48%">
          <stop offset="0%" stopColor={b.emeraldLight} stopOpacity="0.12" />
          <stop offset="100%" stopColor={b.tileBase} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={accentId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={b.glowMint} />
          <stop offset="50%" stopColor={b.emeraldLight} />
          <stop offset="100%" stopColor={b.emeraldMid} />
        </linearGradient>
        <linearGradient id={featherId} x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#ffffff" />
          <stop offset="100%" stopColor={b.featherSide} />
        </linearGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor={b.glowMint} stopOpacity="0.42" />
          <stop offset="42%" stopColor={b.emeraldLight} stopOpacity="0.14" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.32" />
        </linearGradient>
        <clipPath id={clId}>
          <rect width={g.viewBoxSize} height={g.viewBoxSize} rx={g.roundedRadius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clId})`}>
        <rect width={g.viewBoxSize} height={g.viewBoxSize} fill={`url(#${bgId})`} />
        <rect width={g.viewBoxSize} height={g.viewBoxSize} fill={`url(#${glId})`} />
        <rect width={g.viewBoxSize} height={g.viewBoxSize} fill={`url(#${gl2Id})`} />
        <g fill="none" stroke={b.emeraldLight} strokeOpacity="0.12" strokeWidth="5">
          <path d={g.courtArcOuter} />
          <path d={g.courtArcInner} />
        </g>
        <rect
          x={g.rimInset}
          y={g.rimInset}
          width={g.rimSize}
          height={g.rimSize}
          rx={g.rimRadius}
          fill="none"
          stroke={`url(#${rimId})`}
          strokeWidth={g.rimStrokeWidth}
        />
        <g transform={buildMarkTransform(true)}>
          <path d={g.pulseCrestPath} fill={`url(#${accentId})`} />
          <path d={g.corkPath} fill="#ffffff" />
          <rect
            x={g.collar.x}
            y={g.collar.y}
            width={g.collar.width}
            height={g.collar.height}
            rx={g.collar.rx}
            fill={`url(#${accentId})`}
          />
          <path d={g.leftFeatherPath} fill={`url(#${featherId})`} />
          <path d={g.rightFeatherPath} fill={`url(#${featherId})`} />
          <path d={g.centerFeatherPath} fill="#ffffff" />
        </g>
      </g>
    </svg>
  );
};
