/**
 * Typed Contracts and Schemas for Gemini Interpretation & Explanation Layer
 */

import { AlertSeverity } from './schemas';

export interface AlertEvidenceItem {
  alertId: string;
  serviceId: string;
  serviceName: string;
  metricName: string;
  metricValue: number;
  threshold: number;
  severity: AlertSeverity;
  title: string;
  description: string;
  timestamp: string;
  sourceMonitor: string;
  dedupCount: number;
}

export interface CompactEvidenceBundle {
  incidentId: string;
  computedSeverity: AlertSeverity;
  alertCount: number;
  durationSeconds: number;
  deterministicProbableOrigin: {
    serviceId: string;
    serviceName: string;
    confidenceScore: number;
    propagationPath: string[];
    evidenceReasons: string[];
  };
  observedAlerts: AlertEvidenceItem[];
  topologyNeighbors: {
    upstreamServices: string[];
    downstreamServices: string[];
  };
  knownFacts: string[];
}

export interface CompetingHypothesis {
  originServiceId: string;
  originServiceName: string;
  rationale: string;
  confidenceQualitative: 'HIGH' | 'MEDIUM' | 'LOW';
  keyAssumptions: string[];
}

export interface DiagnosticCheck {
  targetService: string;
  commandOrCheck: string;
  purpose: string;
  expectedOutcome: string;
}

export interface ReviewMergeRecommendation {
  suggestedRelatedIncidentId?: string;
  relationshipRationale: string;
  confidenceQualitative: 'HIGH' | 'MEDIUM' | 'LOW';
}

export interface GeminiIncidentExplanation {
  conciseSummary: string;
  normalizedErrorCategory: string;
  supportingEvidenceIds: string[];
  contradictoryEvidenceIds: string[];
  rejectedHallucinatedEvidenceIds?: string[];
  leadingHypothesis: CompetingHypothesis;
  competingHypotheses: CompetingHypothesis[];
  missingEvidence: string[];
  uncertaintyNotes: string;
  recommendedDiagnostics: DiagnosticCheck[];
  mergeRecommendation?: ReviewMergeRecommendation;
  isFromGemini: boolean;
  modelName: string;
  latencyMs: number;
  estimatedCostUsd: number;
  generatedAt: string;
}

export interface GeminiAmbiguityAnalysis {
  alertId: string;
  rawText: string;
  normalizedErrorCategory: string;
  underlyingMetricGuess: string;
  isAmbiguous: boolean;
  ambiguityReason?: string;
  extractedEntityTokens: string[];
}

export interface GeminiInvocationMetrics {
  totalCalls: number;
  successfulCalls: number;
  fallbackCalls: number;
  timeoutCalls: number;
  cacheHits: number;
  totalTokens: number;
  estimatedTotalCostUsd: number;
  averageLatencyMs: number;
  invalidEvidenceIdCount: number;
}

export interface LLMComparisonScorecard {
  modeLLMDisabled: {
    incidentCount: number;
    notificationReductionPercent: number;
    pairwisePrecision: number;
    pairwiseRecall: number;
    pairwiseF1: number;
    top1OriginAccuracy: number;
    explanationCoveragePercent: number;
    hallucinatedEvidenceRate: number;
    averageLatencyMs: number;
  };
  modeLLMEnabled: {
    incidentCount: number;
    notificationReductionPercent: number;
    pairwisePrecision: number;
    pairwiseRecall: number;
    pairwiseF1: number;
    top1OriginAccuracy: number;
    explanationCoveragePercent: number;
    hallucinatedEvidenceRate: number;
    averageLatencyMs: number;
    modelInvocationCount: number;
    estimatedCostUsd: number;
  };
  interpretationGainNotes: string[];
}
