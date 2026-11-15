import React from 'react';
import { getHolesForType } from '../data/ocarinaData';
import { HoleMap, OcarinaType } from '../types/ocarina';

interface OcarinaDiagramProps {
  type: OcarinaType;
  holes: HoleMap;
  size?: 'xs' | 'sm' | 'md' | 'lg';
  interactive?: boolean;
  onToggleHole?: (holeId: string) => void;
  showLabels?: boolean;
  highlightMismatch?: boolean;
  className?: string;
}

export const OcarinaDiagram: React.FC<OcarinaDiagramProps> = ({
  type,
  holes,
  size = 'md',
  interactive = false,
  onToggleHole,
  showLabels = false,
  highlightMismatch = false,
  className = '',
}) => {
  const holeDefs = getHolesForType(type);

  const dims =
    size === 'xs'
      ? 'w-16 h-14'
      : size === 'sm'
      ? 'w-24 h-20'
      : size === 'md'
      ? 'w-44 h-36'
      : 'w-64 sm:w-72 h-52 sm:h-60';

  const hasThumbs = type !== '4-hole';

  return (
    <div className={`inline-flex flex-col items-center select-none ${className}`}>
      <svg
        viewBox="0 0 108 100"
        className={`${dims} overflow-visible drop-shadow-sm`}
        role="img"
        aria-label={`${type} ocarina fingering diagram`}
      >
        {/* Silhouette by Ocarina Type */}
        {type === '12-hole' ? (
          <g>
            {/* Mouthpiece stem */}
            <path
              d="M 41 53 L 32 69 C 29 74 34 78 39 74 L 51 56 Z"
              fill={highlightMismatch ? '#E5B8AC' : '#D57960'}
              stroke="#9E412B"
              strokeWidth="1.6"
              strokeLinejoin="round"
            />
            {/* Sweet potato main body */}
            <path
              d="M 14 42 C 13 24, 34 15, 62 17 C 85 18, 99 28, 98 41 C 97 53, 81 61, 56 61 C 33 61, 15 54, 14 42 Z"
              fill={highlightMismatch ? '#F3D8D0' : '#E39780'}
              stroke="#9E412B"
              strokeWidth="1.8"
            />
            {/* Subtle highlight sheen */}
            <path
              d="M 24 27 C 40 20, 68 20, 86 27"
              fill="none"
              stroke="#FAF6F0"
              strokeOpacity="0.45"
              strokeWidth="1.8"
              strokeLinecap="round"
            />
          </g>
        ) : (
          <g>
            {/* Pendant rounded clay body */}
            <path
              d="M 50 12 C 74 12, 86 28, 84 48 C 82 65, 67 74, 50 74 C 33 74, 18 65, 16 48 C 14 28, 26 12, 50 12 Z"
              fill={highlightMismatch ? '#F3D8D0' : '#E39780'}
              stroke="#9E412B"
              strokeWidth="1.8"
            />
            {/* Top mouthpiece lip */}
            <rect
              x="43"
              y="7"
              width="14"
              height="8"
              rx="3"
              fill="#C2593F"
              stroke="#9E412B"
              strokeWidth="1.5"
            />
          </g>
        )}

        {/* Back-thumbs indicator strip */}
        {hasThumbs && (
          <g>
            <rect
              x="25"
              y="70"
              width="52"
              height="20"
              rx="10"
              fill="#F3ECE1"
              stroke="#D6C8B8"
              strokeWidth="1.2"
            />
            {size !== 'xs' && (
              <text
                x="51"
                y="97"
                textAnchor="middle"
                fontSize="6.5"
                fill="#6E5D55"
                fontWeight="600"
              >
                BACK THUMBS
              </text>
            )}
          </g>
        )}

        {/* Finger Holes */}
        {holeDefs.map((hole) => {
          const isClosed = Boolean(holes[hole.id]);
          return (
            <g
              key={hole.id}
              onClick={interactive && onToggleHole ? () => onToggleHole(hole.id) : undefined}
              className={interactive ? 'cursor-pointer group' : undefined}
            >
              {/* Invisible generous touch target for mobile */}
              {interactive && (
                <circle
                  cx={hole.x}
                  cy={hole.y}
                  r={Math.max(7.5, hole.r + 3.5)}
                  fill="transparent"
                />
              )}
              <circle
                cx={hole.x}
                cy={hole.y}
                r={hole.r}
                fill={isClosed ? '#2C221E' : '#FAF6F0'}
                stroke={isClosed ? '#2C221E' : '#7C5849'}
                strokeWidth={hole.isSubhole ? 1.2 : 1.6}
                className={
                  interactive
                    ? 'transition-transform duration-100 group-hover:scale-110'
                    : undefined
                }
              />
              {showLabels && size !== 'xs' && (
                <text
                  x={hole.x}
                  y={hole.y + 1.5}
                  textAnchor="middle"
                  fontSize={hole.isSubhole ? '3.3' : '4.2'}
                  fontWeight="700"
                  fill={isClosed ? '#FAF6F0' : '#2C221E'}
                  pointerEvents="none"
                >
                  {hole.id}
                </text>
              )}
            </g>
          );
        })}
      </svg>
    </div>
  );
};
