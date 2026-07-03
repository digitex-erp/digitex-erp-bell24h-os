export class MarketOpportunityEngine {
  static calculateOpportunityScore(volume: number, difficulty: number): number {
    // Scoring algorithm: Higher volume and lower difficulty = higher score
    if (difficulty === 0) return volume * 10;
    return (volume / difficulty) * 100;
  }
}
