// Re-exports the canonical CourtPulse brand mark from src/utils/brandMark.ts
// so scripts and React UI share one exact source of truth.
export {
  COURTPULSE_BRAND,
  COURTPULSE_MARK_GEOMETRY,
  buildCourtPulseTileSvg,
  buildMarkTransform,
} from '../src/utils/brandMark.ts';
