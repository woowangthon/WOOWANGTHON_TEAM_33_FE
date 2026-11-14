// Operational policy, shared across cases. No example answers or law-specific weights.
export const harnessPolicy = {
  version: 5,
  summary: { maxFacts: 16, sourceRepairAttempts: 1, repairAttempts: 1, automaticRestarts: 1 },
  retrieval: { candidateLimit: 24, selectedLimit: 8, minimumScore: 3 },
} as const;

export const officeJurisdiction = process.env.SERVICE_JURISDICTION || '청주시';
