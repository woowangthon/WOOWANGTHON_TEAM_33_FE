// Operational policy, shared across cases. No example answers or law-specific weights.
export const harnessPolicy = {
  version: 2,
  summary: { maxCharacters: 220, maxSentences: 2, maxFacts: 16, repairAttempts: 1 },
  retrieval: { candidateLimit: 24, selectedLimit: 8, minimumScore: 3 },
} as const;

export const officeJurisdiction = process.env.SERVICE_JURISDICTION || '청주시';
