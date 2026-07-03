export class SearchIntentEngine {
  static classify(keyword: string): string {
    // Basic intent classification logic
    const lowerKeyword = keyword.toLowerCase();
    if (lowerKeyword.includes("how to") || lowerKeyword.includes("what is")) return "Informational";
    if (lowerKeyword.includes("buy") || lowerKeyword.includes("price")) return "Transactional";
    if (lowerKeyword.includes("best") || lowerKeyword.includes("review")) return "Commercial";
    return "Informational";
  }
}
