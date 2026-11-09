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
        <linearGradient id={bgId} x1="0.08" y1="0" x2="0.92" y2="1">
          <stop offset="0%" stopColor={b.emeraldLight} />
          <stop offset="46%" stopColor={b.emeraldMid} />
          <stop offset="84%" stopColor={b.emeraldDeep} />
          <stop offset="100%" stopColor={b.emeraldDark} />
        </linearGradient>
        <radialGradient id={glId} cx="68%" cy="28%" r="60%">
          <stop offset="0%" stopColor={b.glowMint} stopOpacity="0.34" />
          <stop offset="100%" stopColor={b.emeraldMid} stopOpacity="0" />
        </radialGradient>
        <linearGradient id={rimId} x1="0" y1="0" x2="1" y2="1">
          <stop offset="0%" stopColor="#ffffff" stopOpacity="0.30" />
          <stop offset="50%" stopColor="#ffffff" stopOpacity="0.06" />
          <stop offset="100%" stopColor="#000000" stopOpacity="0.16" />
        </linearGradient>
        <clipPath id={clId}>
          <rect width={g.viewBoxSize} height={g.viewBoxSize} rx={g.roundedRadius} />
        </clipPath>
      </defs>
      <g clipPath={`url(#${clId})`}>
        <rect width={g.viewBoxSize} height={g.viewBoxSize} fill={`url(#${bgId})`} />
        <rect width={g.viewBoxSize} height={g.viewBoxSize} fill={`url(#${glId})`} />
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
          <g fill="none" strokeLinecap="round">
            <path
              d={g.innerArcPath}
              stroke="#ffffff"
              strokeWidth={g.innerArcStrokeWidth}
              strokeOpacity={g.innerArcOpacity}
            />
            <path
              d={g.outerArcPath}
              stroke={b.glowMint}
              strokeWidth={g.outerArcStrokeWidth}
              strokeOpacity={g.outerArcOpacity}
            />
          </g>
          <g>
            <path d={g.corkPath} fill="#ffffff" />
            <rect
              x={g.collar.x}
              y={g.collar.y}
              width={g.collar.width}
              height={g.collar.height}
              rx={g.collar.rx}
              fill={b.glowMint}
            />
            <path d={g.leftFeatherPath} fill={b.featherSide} />
            <path d={g.rightFeatherPath} fill={b.featherSide} />
            <path d={g.centerFeatherPath} fill="#ffffff" />
          </g>
        </g>
      </g>
    </svg>
  );
};
