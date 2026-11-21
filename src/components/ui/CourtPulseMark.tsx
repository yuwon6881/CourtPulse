import React from 'react';
import {
  buildMarkTransform,
  COURTPULSE_BRAND,
  COURTPULSE_MARK_GEOMETRY,
} from '../../utils/brandMark.ts';

interface CourtPulseMarkProps {
  className?: string;
}

/**
 * Inline vector brand mark matching the PWA launcher tile and browser favicon
 * (src/utils/brandMark.ts). Pure flat solid colors with zero gradients.
 */
export const CourtPulseMark: React.FC<CourtPulseMarkProps> = ({
  className = 'w-7 h-7',
}) => {
  const g = COURTPULSE_MARK_GEOMETRY;
  const b = COURTPULSE_BRAND;

  return (
    <svg
      xmlns="http://www.w3.org/2000/svg"
      viewBox={`0 0 ${g.viewBoxSize} ${g.viewBoxSize}`}
      aria-hidden="true"
      className={className}
    >
      <rect
        width={g.viewBoxSize}
        height={g.viewBoxSize}
        rx={g.roundedRadius}
        fill={b.tileBg}
      />
      <g transform={buildMarkTransform(true)}>
        <path d={g.pulseCrestPath} fill={b.markAccent} />
        <path d={g.corkPath} fill={b.markPrimary} />
        <rect
          x={g.collar.x}
          y={g.collar.y}
          width={g.collar.width}
          height={g.collar.height}
          rx={g.collar.rx}
          fill={b.markAccent}
        />
        <path d={g.leftFeatherPath} fill={b.markPrimary} />
        <path d={g.rightFeatherPath} fill={b.markPrimary} />
        <path d={g.centerFeatherPath} fill={b.markPrimary} />
      </g>
    </svg>
  );
};
