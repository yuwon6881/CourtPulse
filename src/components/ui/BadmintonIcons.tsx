import React from 'react';

interface BadmintonIconProps extends React.SVGProps<SVGSVGElement> {
  className?: string;
}

/**
 * Custom crossed badminton rackets + flying shuttlecock cork icon.
 * Crafted to match Lucide's 24x24 stroke rhythm while bringing unmistakable
 * badminton identity to CourtPulse's emerald/slate dark & light themes.
 */
export const BadmintonMatchIcon: React.FC<BadmintonIconProps> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.85}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
    {...props}
  >
    {/* Left-to-right badminton racket */}
    <g transform="rotate(-41 12 14.5)">
      <ellipse
        cx="12"
        cy="6.8"
        rx="3.35"
        ry="4.45"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <line x1="12" y1="11.25" x2="12" y2="18.3" />
      <line x1="12" y1="18.3" x2="12" y2="21.9" strokeWidth={2.75} />
    </g>

    {/* Right-to-left badminton racket */}
    <g transform="rotate(41 12 14.5)">
      <ellipse
        cx="12"
        cy="6.8"
        rx="3.35"
        ry="4.45"
        fill="currentColor"
        fillOpacity="0.14"
      />
      <line x1="12" y1="11.25" x2="12" y2="18.3" />
      <line x1="12" y1="18.3" x2="12" y2="21.9" strokeWidth={2.75} />
    </g>

    {/* Flying shuttlecock accent centered above the crossed frames */}
    <circle cx="12" cy="4.2" r="1.45" fill="currentColor" stroke="none" />
  </svg>
);

/**
 * Custom single diagonal badminton racket icon for Equipment Locker & racket inventory.
 */
export const BadmintonRacketIcon: React.FC<BadmintonIconProps> = ({
  className = 'w-4 h-4',
  ...props
}) => (
  <svg
    xmlns="http://www.w3.org/2000/svg"
    viewBox="0 0 24 24"
    fill="none"
    stroke="currentColor"
    strokeWidth={1.85}
    strokeLinecap="round"
    strokeLinejoin="round"
    aria-hidden="true"
    className={className}
    {...props}
  >
    <g transform="rotate(45 12 12)">
      <ellipse
        cx="12"
        cy="7.2"
        rx="4.35"
        ry="5.45"
        fill="currentColor"
        fillOpacity="0.13"
      />
      <line
        x1="12"
        y1="2.8"
        x2="12"
        y2="11.6"
        strokeWidth={1.15}
        strokeOpacity={0.5}
      />
      <line
        x1="8.7"
        y1="7.2"
        x2="15.3"
        y2="7.2"
        strokeWidth={1.15}
        strokeOpacity={0.5}
      />
      <line x1="12" y1="12.65" x2="12" y2="17.8" />
      <line x1="12" y1="17.8" x2="12" y2="21.9" strokeWidth={2.8} />
    </g>
  </svg>
);
