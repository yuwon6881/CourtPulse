export type UsageProfilePreset = 'cost_saving' | 'balanced' | 'performance';

export interface UsageProfileConfig {
  id: UsageProfilePreset;
  label: string;
  shortTag: string;
  description: string;
  baseRestringCycleDays: number;
  baseGripCycleDays: number;
  stringLifeMultiplier: number;
  stringWarnThreshold: number;
  stringCriticalThreshold: number;
  gripMaxMatchesMultiplier: number;
  shuttleLowThreshold: number;
  suggestionSummary: string;
}

export interface HostPlayerSummary {
  id: string;
  name: string;
  email?: string;
  clubIds: string[];
  elo: number;
  matchesPlayed: number;
  defaultProfile?: UsageProfilePreset;
}

export type RacketStatus = 'active' | 'active_primary' | 'active_backup' | 'needs_restring' | 'retired_cracked';
export type GripType = 'towel' | 'pu_overgrip' | 'replacement_grip';
export type BalancePoint = 'head_heavy' | 'even_balance' | 'head_light';
export type ShaftStiffness = 'extra_stiff' | 'stiff' | 'medium' | 'flexible';

export interface StringingLogEntry {
  id: string;
  racketId: string;
  stringModel: string;
  gaugeMm: number;
  tensionLbs?: number;
  mainTensionLbs: number;
  crossTensionLbs: number;
  stringerName?: string;
  cost?: number;
  strungAtDate: string;
  brokenOrCutDate?: string;
  outcome?: 'active' | 'snapped' | 'cut_for_fresh_bed';
  snapLocation?: string;
  hoursPlayedOnBed: number;
  matchesPlayedOnBed: number;
  estimatedEffectiveTensionLbs: number;
  notes?: string;
}

export interface RacketGearItem {
  id: string;
  playerId: string;
  nickname?: string;
  brand: string;
  model: string;
  weightSpec?: '2U' | '3U' | '4U' | '5U';
  gripSize?: 'G4' | 'G5' | 'G6';
  balance?: BalancePoint;
  stiffness?: ShaftStiffness;
  status: RacketStatus;
  purchaseDate?: string;
  purchasePrice?: number;
  serialCode?: string;
  currentStringLogId?: string;
  stringHealthScore: number;
  gripType: GripType;
  gripBrandModel: string;
  gripColor?: string;
  lastGripChangeDate?: string;
  matchesSinceGripChange: number;
  maxMatchesPerGrip: number;
  grommetCondition: 'fresh' | 'moderate_sink' | 'rotate_needed' | 'replace_urgent';
  lastGrommetInspectionDate?: string;
  framePaintChipsCount: number;
  notes?: string;
}

export interface FootwearAndConsumableItem {
  id: string;
  playerId: string;
  category: 'shuttle_tube';
  brandModel: string;
  acquiredDate: string;
  hoursOrSessionsUsed: number;
  maxRecommendedHours: number;
  conditionPercent: number;
  statusNote: string;
}

export interface EquipmentLockerViewProps {
  player: HostPlayerSummary;
  allPlayers?: HostPlayerSummary[];
  onSelectPlayer?: (playerId: string) => void;
  /** Players may change only their own locker; admins may change any. */
  canEdit: boolean;
  /** Signed-in account uid whose Firestore locker is authoritative; null keeps gear on this device. */
  cloudOwnerId: string | null;
}
