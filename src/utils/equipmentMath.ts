import type {
  RacketGearItem,
  StringingLogEntry,
  UsageProfileConfig,
  UsageProfilePreset,
} from '../types/equipment.ts';

export const USAGE_PROFILE_PRESETS: Record<UsageProfilePreset, UsageProfileConfig> = {
  cost_saving: {
    id: 'cost_saving',
    label: 'Max Durability',
    shortTag: 'Budget Saver',
    description: '',
    baseRestringCycleDays: 95,
    baseGripCycleDays: 42,
    stringLifeMultiplier: 1.4,
    stringWarnThreshold: 30,
    stringCriticalThreshold: 15,
    gripMaxMatchesMultiplier: 1.5,
    shuttleLowThreshold: 2,
    suggestionSummary: '',
  },
  balanced: {
    id: 'balanced',
    label: 'Regular Club',
    shortTag: 'Balanced',
    description: '',
    baseRestringCycleDays: 65,
    baseGripCycleDays: 28,
    stringLifeMultiplier: 1.0,
    stringWarnThreshold: 45,
    stringCriticalThreshold: 25,
    gripMaxMatchesMultiplier: 1.0,
    shuttleLowThreshold: 3,
    suggestionSummary: '',
  },
  performance: {
    id: 'performance',
    label: 'Peak Feel',
    shortTag: 'Crisp & Tacky',
    description: '',
    baseRestringCycleDays: 42,
    baseGripCycleDays: 18,
    stringLifeMultiplier: 0.75,
    stringWarnThreshold: 60,
    stringCriticalThreshold: 35,
    gripMaxMatchesMultiplier: 0.75,
    shuttleLowThreshold: 4,
    suggestionSummary: '',
  },
};

export function getUsageProfileConfig(preset: UsageProfilePreset = 'balanced'): UsageProfileConfig {
  return USAGE_PROFILE_PRESETS[preset] ?? USAGE_PROFILE_PRESETS.balanced;
}

/**
 * Today's calendar date in the player's local time zone as YYYY-MM-DD. Using UTC here would
 * roll the date over mid-evening for players east of Greenwich.
 */
export function todayIsoDate(now: Date = new Date()): string {
  const month = String(now.getMonth() + 1).padStart(2, '0');
  const day = String(now.getDate()).padStart(2, '0');
  return `${now.getFullYear()}-${month}-${day}`;
}

/**
 * Calculates days elapsed between two YYYY-MM-DD date strings.
 */
export function calculateDaysElapsed(strungAtDate: string, referenceDate = todayIsoDate()): number {
  const start = Date.parse(`${strungAtDate}T00:00:00Z`);
  const end = Date.parse(`${referenceDate}T00:00:00Z`);
  if (Number.isNaN(start) || Number.isNaN(end)) return 0;
  return Math.max(0, Math.round((end - start) / 86400000));
}

/**
 * Adds a specified number of days to a YYYY-MM-DD date string and returns YYYY-MM-DD.
 */
export function addDaysToDate(dateStr: string, daysToAdd: number): string {
  const startMs = Date.parse(`${dateStr}T00:00:00Z`);
  if (Number.isNaN(startMs)) return dateStr;
  const target = new Date(startMs + Math.round(daysToAdd) * 86400000);
  return target.toISOString().slice(0, 10);
}

/**
 * Calculates the initial strung tension in lbs (supports single tension or legacy main/cross).
 */
export function getInitialAverageTension(mainTensionLbs: number, crossTensionLbs?: number): number {
  if (typeof crossTensionLbs !== 'number' || Number.isNaN(crossTensionLbs)) {
    return Number(mainTensionLbs.toFixed(1));
  }
  return Number(((mainTensionLbs + crossTensionLbs) / 2).toFixed(1));
}

export interface GripDurationStatus {
  wrappedAtDate: string;
  daysElapsed: number;
  recommendedCycleDays: number;
  recommendedRewrapDate: string;
  daysUntilRewrap: number;
  gripHealthPercent: number;
  isDue: boolean;
  isWarning: boolean;
  statusLabel: string;
}

/**
 * Computes duration-based grip freshness percentage and re-wrap schedule for a racket's paired grip.
 */
export function calculateGripDurationStatus(params: {
  lastGripChangeDate?: string;
  fallbackDate?: string;
  gripType?: RacketGearItem['gripType'];
  profilePreset?: UsageProfilePreset;
  referenceDate?: string;
}): GripDurationStatus {
  const refDate = params.referenceDate ?? todayIsoDate();
  const preset = params.profilePreset ?? 'balanced';
  const cfg = getUsageProfileConfig(preset);
  const wrappedAtDate = params.lastGripChangeDate || params.fallbackDate || refDate;
  const daysElapsed = calculateDaysElapsed(wrappedAtDate, refDate);

  // Towel grips saturate slightly faster than PU overgrips
  const typeFactor = params.gripType === 'towel' ? 0.85 : 1.0;
  const recommendedCycleDays = Math.max(10, Math.round(cfg.baseGripCycleDays * typeFactor));
  const recommendedRewrapDate = addDaysToDate(wrappedAtDate, recommendedCycleDays);
  const daysUntilRewrap = recommendedCycleDays - daysElapsed;

  const rawPercent = Math.round(100 - (daysElapsed / recommendedCycleDays) * 85);
  const gripHealthPercent = Math.max(0, Math.min(100, rawPercent));

  const isDue = daysUntilRewrap <= 0 || gripHealthPercent <= 20;
  const isWarning = !isDue && (daysUntilRewrap <= 6 || gripHealthPercent <= 40);

  const statusLabel = isDue
    ? daysUntilRewrap < 0
      ? `Overdue ${Math.abs(daysUntilRewrap)}d (${recommendedRewrapDate})`
      : `Re-wrap due (${recommendedRewrapDate})`
    : `Target: ${recommendedRewrapDate} (${daysUntilRewrap}d left)`;

  return {
    wrappedAtDate,
    daysElapsed,
    recommendedCycleDays,
    recommendedRewrapDate,
    daysUntilRewrap,
    gripHealthPercent,
    isDue,
    isWarning,
    statusLabel,
  };
}

export interface DurationRestringRecommendation {
  daysElapsed: number;
  recommendedCycleDays: number;
  recommendedRestringDate: string;
  daysUntilRestring: number;
  estimatedCourtHours: number;
  effectiveTensionLbs: number;
  healthScore: number;
  statusLabel: string;
  suggestionText: string;
  tone: 'neutral' | 'warn' | 'danger';
}

/**
 * Computes a duration- and history-based restring recommendation from the restring date (`strungAtDate`),
 * strung tension, pre-computed historical average span (or past logs), and the player's profile preset.
 */
export function calculateDurationRestringRecommendation(params: {
  strungAtDate: string;
  tensionLbs: number;
  crossTensionLbs?: number;
  gaugeMm?: number;
  outcome?: 'active' | 'snapped' | 'cut_for_fresh_bed';
  profilePreset?: UsageProfilePreset;
  playerHistoricalLogs?: StringingLogEntry[];
  precomputedHistoricalSpanDays?: number | null;
  playerMatchesPlayed?: number;
  referenceDate?: string;
}): DurationRestringRecommendation {
  const refDate = params.referenceDate ?? todayIsoDate();
  const preset = params.profilePreset ?? 'balanced';
  const cfg = getUsageProfileConfig(preset);
  const daysElapsed = calculateDaysElapsed(params.strungAtDate, refDate);

  let historicalAvgDays = cfg.baseRestringCycleDays;
  if (typeof params.precomputedHistoricalSpanDays === 'number' && params.precomputedHistoricalSpanDays > 0) {
    historicalAvgDays = Math.round(params.precomputedHistoricalSpanDays * cfg.stringLifeMultiplier);
  } else if (params.playerHistoricalLogs && params.playerHistoricalLogs.length > 0) {
    let sum = 0;
    let count = 0;
    for (let i = 0; i < params.playerHistoricalLogs.length; i++) {
      const log = params.playerHistoricalLogs[i];
      if (log.brokenOrCutDate && log.strungAtDate) {
        const span = calculateDaysElapsed(log.strungAtDate, log.brokenOrCutDate);
        if (span >= 14 && span <= 180) {
          sum += span;
          count++;
        }
      }
    }
    if (count > 0) {
      historicalAvgDays = Math.round((sum / count) * cfg.stringLifeMultiplier);
    }
  }

  const initialAvgTension = getInitialAverageTension(params.tensionLbs, params.crossTensionLbs);
  const tensionDelta = Math.max(-2, Math.min(5, initialAvgTension - 26));
  const tensionDaysAdjustment = Math.round(tensionDelta * -2.5);
  const blendedCycle = Math.round(cfg.baseRestringCycleDays * 0.7 + historicalAvgDays * 0.3);
  const recommendedCycleDays = Math.max(21, Math.min(150, blendedCycle + tensionDaysAdjustment));

  const recommendedRestringDate = addDaysToDate(params.strungAtDate, recommendedCycleDays);
  const daysUntilRestring = recommendedCycleDays - daysElapsed;

  const cadencePerDay =
    params.playerMatchesPlayed && params.playerMatchesPlayed > 160 ? 0.36 : 0.3;
  const estimatedCourtHours = Number((daysElapsed * cadencePerDay).toFixed(1));
  const estimatedMatches = Math.round(estimatedCourtHours * 1.3);

  if (params.outcome === 'snapped' || params.outcome === 'cut_for_fresh_bed') {
    return {
      daysElapsed,
      recommendedCycleDays,
      recommendedRestringDate,
      daysUntilRestring: 0,
      estimatedCourtHours,
      effectiveTensionLbs: 0,
      healthScore: 0,
      statusLabel: 'Snapped · Restring needed',
      suggestionText: '',
      tone: 'danger',
    };
  }

  const effectiveTensionLbs = calculateEffectiveTension({
    mainTensionLbs: params.tensionLbs,
    crossTensionLbs: params.crossTensionLbs ?? params.tensionLbs,
    gaugeMm: params.gaugeMm ?? 0.66,
    hoursPlayedOnBed: estimatedCourtHours,
    matchesPlayedOnBed: estimatedMatches,
    daysElapsed,
    outcome: 'active',
  });

  const cycleProgress = daysElapsed / recommendedCycleDays;
  const targetWarnHealth = cfg.stringWarnThreshold;
  const rawHealth = Math.round(100 - cycleProgress * (100 - targetWarnHealth));
  const healthScore = Math.max(5, Math.min(100, rawHealth));

  let statusLabel = `Target: ${recommendedRestringDate} (${daysUntilRestring}d left)`;
  let tone: 'neutral' | 'warn' | 'danger' = 'neutral';

  if (daysUntilRestring < -10 || healthScore <= cfg.stringCriticalThreshold) {
    const overdueDays = Math.abs(daysUntilRestring);
    statusLabel = `Overdue ${overdueDays}d (${recommendedRestringDate})`;
    tone = 'danger';
  } else if (daysUntilRestring <= 10 || healthScore <= cfg.stringWarnThreshold) {
    statusLabel =
      daysUntilRestring >= 0
        ? `Due in ${daysUntilRestring}d (${recommendedRestringDate})`
        : `Due now (${recommendedRestringDate})`;
    tone = 'warn';
  }

  return {
    daysElapsed,
    recommendedCycleDays,
    recommendedRestringDate,
    daysUntilRestring,
    estimatedCourtHours,
    effectiveTensionLbs,
    healthScore,
    statusLabel,
    suggestionText: '',
    tone,
  };
}

/**
 * Estimates current effective string bed tension in lbs.
 */
export function calculateEffectiveTension(params: {
  mainTensionLbs: number;
  crossTensionLbs?: number;
  gaugeMm: number;
  hoursPlayedOnBed: number;
  matchesPlayedOnBed: number;
  daysElapsed: number;
  outcome?: 'active' | 'snapped' | 'cut_for_fresh_bed';
}): number {
  if (params.outcome === 'snapped' || params.outcome === 'cut_for_fresh_bed') {
    return 0;
  }

  const avgInitial = getInitialAverageTension(params.mainTensionLbs, params.crossTensionLbs);
  if (avgInitial <= 0) return 0;

  const initialCreepLbs = params.daysElapsed > 0 || params.hoursPlayedOnBed > 0
    ? avgInitial * 0.042
    : avgInitial * 0.015;

  const gaugeFactor = Math.max(0.85, Math.min(1.3, (0.70 - params.gaugeMm) * 3.2 + 1.0));

  const dynamicPlayLossLbs =
    (params.hoursPlayedOnBed * 0.135 + params.matchesPlayedOnBed * 0.055) * gaugeFactor;

  const passiveDaysLossLbs = params.daysElapsed > 0
    ? Math.log10(params.daysElapsed + 1) * 0.65
    : 0;

  const rawEffective = avgInitial - initialCreepLbs - dynamicPlayLossLbs - passiveDaysLossLbs;
  return Number(Math.max(16.0, Math.min(avgInitial, rawEffective)).toFixed(1));
}
