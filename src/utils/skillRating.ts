/**
 * Skill rating: an Elo-style replay of the match history, so a win is worth more against a strong
 * side than a weak one, and a loss costs less when the other side was the favourite.
 *
 * Why not win rate: a player who keeps getting paired with weaker partners loses a lot without
 * being weak, and one who always partners the strongest players wins a lot without being strong.
 * Here each team is rated as the average of its players, the expected result comes from the gap
 * between the two teams, and every player moves by how far the result was from that expectation.
 *
 * Margin: a 21-19 win moves ratings less than a 21-8 win. The win itself still counts most.
 *
 * Pure and order-based: callers pass matches already in chronological order.
 */
export const SKILL_BASE_RATING = 1200;

const K_PROVISIONAL = 40; // a player's first few games settle quickly
const K_ESTABLISHED = 24;
const PROVISIONAL_GAMES = 6;

/** Scales the rating change by how decisive the win was: ~0.85x for 21-19 up to ~1.5x for a rout. */
export function marginMultiplier(winnerPoints: number, loserPoints: number): number {
  const w = Math.max(0, Number(winnerPoints) || 0);
  const l = Math.max(0, Number(loserPoints) || 0);
  if (w <= 0 || w <= l) return 1;
  const share = (w - l) / w; // 0 (even) .. 1 (shut out)
  return 0.75 + 0.75 * Math.min(1, share * 1.4);
}

export interface SkillMatchInput {
  winnerSide: 'A' | 'B' | string;
  scoreTeamA: number;
  scoreTeamB: number;
  sideA: string[];
  sideB: string[];
}

const mean = (xs: number[]): number => xs.reduce((a, b) => a + b, 0) / xs.length;

/** Replays matches (oldest first) and returns every participant's rating; unknown players stay absent. */
export function computeSkillRatingMap(matches: SkillMatchInput[]): Map<string, number> {
  const ratings = new Map<string, number>();
  const games = new Map<string, number>();
  const get = (id: string) => ratings.get(id) ?? SKILL_BASE_RATING;

  for (const m of matches) {
    if (m.winnerSide !== 'A' && m.winnerSide !== 'B') continue;
    if (m.sideA.length === 0 || m.sideB.length === 0) continue;
    if (m.sideA.some((id) => m.sideB.includes(id))) continue;

    const rA = mean(m.sideA.map(get));
    const rB = mean(m.sideB.map(get));
    const expectedA = 1 / (1 + Math.pow(10, (rB - rA) / 400));
    const aWon = m.winnerSide === 'A';
    const actualA = aWon ? 1 : 0;

    const winnerPts = aWon ? m.scoreTeamA : m.scoreTeamB;
    const loserPts = aWon ? m.scoreTeamB : m.scoreTeamA;
    const winnerGap = aWon ? rA - rB : rB - rA;
    // A favourite piling up easy wins must not inflate itself: damp by how favoured the winner was
    const damp = 2.2 / (Math.max(-400, Math.min(400, winnerGap)) * 0.001 + 2.2);
    const swing = marginMultiplier(winnerPts, loserPts) * damp;

    const apply = (ids: string[], actual: number, expected: number) => {
      for (const id of ids) {
        const played = games.get(id) ?? 0;
        const k = played < PROVISIONAL_GAMES ? K_PROVISIONAL : K_ESTABLISHED;
        ratings.set(id, get(id) + k * swing * (actual - expected));
        games.set(id, played + 1);
      }
    };
    apply(m.sideA, actualA, expectedA);
    apply(m.sideB, 1 - actualA, 1 - expectedA);
  }

  const out = new Map<string, number>();
  ratings.forEach((v, id) => out.set(id, Math.max(0, Math.min(10000, Math.round(v)))));
  return out;
}
