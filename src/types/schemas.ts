/**
 * Typed Data Contracts and Schemas for Alert Correlation & Incident Detection
 */

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';
export type MonitorSource = 'prometheus' | 'datadog' | 'cloudwatch' | 'sentry' | 'jaeger' | 'kafka-lag';
export type DatasetSplit = 'train' | 'val' | 'test';

export interface RawAlertRecord {
  id?: unknown;
  serviceId?: unknown;
  serviceName?: unknown;
  severity?: unknown;
  status?: unknown;
  metricName?: unknown;
  metricValue?: unknown;
  threshold?: unknown;
  title?: unknown;
  description?: unknown;
  sourceMonitor?: unknown;
  timestamp?: unknown;
  environment?: unknown;
  cluster?: unknown;
  region?: unknown;
  rawPayload?: unknown;
  dedupCount?: unknown;
}

export interface ValidationError {
  recordId: string;
  field: string;
  value: unknown;
  message: string;
  fatal: boolean;
}

export interface ValidationReport {
  totalProcessed: number;
  validCount: number;
  invalidCount: number;
  errors: ValidationError[];
}

export interface NormalizedAlert {
  id: string; // Original alert ID preserved
  fingerprint: string;
  serviceId: string;
  serviceName: string;
  severity: AlertSeverity;
  status: 'firing' | 'resolved';
  metricName: string;
  metricValue: number;
  threshold: number;
  title: string;
  description: string;
  sourceMonitor: MonitorSource;
  timestamp: string; // Guaranteed valid ISO 8601
  timestampMs: number;
  environment: 'production' | 'staging';
  cluster: string;
  region: string;
  rawPayload: Record<string, unknown>;
  dedupCount: number;
  firstSeen: string;
  lastSeen: string;
}

export interface CanonicalAlert extends NormalizedAlert {
  rawAlertIds: string[]; // List of all original alert IDs mapped to this canonical entry
  suppressedCount: number;
}

export interface CandidateEvidence {
  temporalScore: number;
  topologicalScore: number;
  semanticScore: number;
  localityScore: number;
  totalScore: number;
  reasons: string[];
}

export type CandidateOutcome = 'ACCEPTED' | 'UNCERTAIN' | 'REJECTED';

export interface CandidateRelationship {
  alertAId: string;
  alertBId: string;
  evidence: CandidateEvidence;
  outcome: CandidateOutcome;
}

export interface ProbableOriginRanking {
  candidateServiceId: string;
  candidateServiceName: string;
  confidenceScore: number;
  propagationPath: string[];
  evidenceReasons: string[];
}

export interface PredictedGroup {
  id: string;
  algorithm: 'no_grouping' | 'dedup_only' | 'simple_time_window' | 'dependency_aware';
  alertIds: string[];
  rawAlertCount: number;
  startTime: string;
  lastAlertTime: string;
  probableOrigin?: ProbableOriginRanking;
  uncertainAlertIds?: string[];
  severity: AlertSeverity;
}

export interface GroundTruthIncident {
  id: string;
  scenarioId: string;
  split: DatasetSplit;
  category: string;
  title: string;
  rootCauseServiceId: string;
  affectedServiceIds: string[];
  alertIds: string[];
  startTime: string;
  endTime: string;
  isCritical: boolean;
}

export interface EvaluationMetrics {
  algorithm: string;
  totalRawAlerts: number;
  totalGroundTruthIncidents: number;
  totalPredictedGroups: number;
  
  // Pairwise Clustering Metrics
  pairwisePrecision: number;
  pairwiseRecall: number;
  pairwiseF1: number;
  truePositivePairs: number;
  falsePositivePairs: number;
  falseNegativePairs: number;

  // Incident-level Metrics (Jaccard >= 0.5 matching)
  incidentLevelRecall: number;
  matchedIncidents: number;

  // Errors & Diagnostics
  falseMerges: number;
  falseSplits: number;
  criticalIncidentMisses: number;

  // Operational Impact
  notificationReductionPercent: number;
  averageDetectionDelayMs: number;
  top1OriginAccuracy: number; // Evaluated only where ground truth defines an origin

  // Metadata
  denominators: {
    pairwisePrecisionDenominator: string;
    pairwiseRecallDenominator: string;
    incidentRecallDenominator: string;
    originAccuracyEvaluatedCount: number;
  };
}

export interface BaselineComparison {
  split: DatasetSplit;
  datasetSize: number;
  baselines: {
    noGrouping: EvaluationMetrics;
    dedupOnly: EvaluationMetrics;
    simpleTimeWindow: EvaluationMetrics;
    dependencyAware: EvaluationMetrics;
  };
}
