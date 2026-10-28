/**
 * Types for Acuity - AI Alert Correlation & Incident Detection Platform
 */

export type AlertSeverity = 'CRITICAL' | 'HIGH' | 'MEDIUM' | 'LOW' | 'INFO';

export type AlertStatus = 'firing' | 'resolved';

export type MonitorSource = 'prometheus' | 'datadog' | 'cloudwatch' | 'sentry' | 'jaeger' | 'kafka-lag';

export interface Alert {
  id: string;
  fingerprint: string;
  serviceId: string;
  serviceName: string;
  severity: AlertSeverity;
  status: AlertStatus;
  metricName: string;
  metricValue: number;
  threshold: number;
  title: string;
  description: string;
  sourceMonitor: MonitorSource;
  timestamp: string; // ISO
  environment: 'production' | 'staging';
  cluster: string;
  region: string;
  rawPayload: Record<string, unknown>;
  dedupCount: number;
  firstSeen: string;
  lastSeen: string;
  scenarioId?: string;
  resolvedAt?: string;
}

export interface ServiceNode {
  id: string;
  name: string;
  tier: 0 | 1 | 2 | 3; // 0=Edge/Ingress, 1=Core Business, 2=Workers & Middle, 3=Data Layer & Infrastructure
  tierName: string;
  team: string;
  dependencies: string[]; // Services this service calls (upstream to downstream flow)
  downstream?: string[];
  protocol: 'gRPC' | 'HTTP/REST' | 'Kafka' | 'PostgreSQL' | 'Redis' | 'GraphQL' | 'gRPC/Internal';
  cluster: string;
  region: string;
  sloTarget: number;
  currentHealth: 'healthy' | 'degraded' | 'critical';
  activeAlertCount: number;
}

export interface PropagationHop {
  fromService: string;
  toService: string;
  lagSeconds: number;
  evidence: string;
}

export interface RootCauseCandidate {
  candidateServiceId: string;
  candidateServiceName: string;
  confidenceScore: number; // 0 - 1
  propagationPath: string[]; // sequence of service IDs
  propagationHops: PropagationHop[];
  evidenceReasons: string[];
  firstFiringAlert: Alert;
}

export interface IncidentAISummary {
  narrative: string;
  impactAssessment: string;
  blastRadiusExplanation: string;
  recommendedRunbook: string[];
  mitigationAction: string;
  isFromGemini: boolean;
  generatedAt: string;
}

export interface TimelineEvent {
  id: string;
  timestamp: string;
  serviceId: string;
  serviceName: string;
  severity: AlertSeverity;
  title: string;
  eventType: 'first_alert' | 'cascade' | 'status_change' | 'action';
  details: string;
}

export interface Incident {
  id: string;
  title: string;
  severity: AlertSeverity;
  status: 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED';
  startTime: string;
  lastAlertTime: string;
  durationSeconds: number;
  rawAlertCount: number;
  dedupAlertCount: number;
  blastRadius: {
    serviceCount: number;
    affectedServices: string[];
    impactedTiers: number[];
    estimatedUserImpact: 'CRITICAL' | 'HIGH' | 'MODERATE' | 'LOW';
  };
  rootCauseAnalysis: RootCauseCandidate;
  aiSummary?: IncidentAISummary;
  alerts: Alert[];
  timelineEvents: TimelineEvent[];
  scenarioId?: string;
}

export interface GroundTruthScenario {
  id: string;
  name: string;
  category: 'INFRASTRUCTURE_FAILURE' | 'DEPENDENCY_OUTAGE' | 'DATA_CORRUPTION' | 'NETWORK_PARTITION' | 'NOISE_STORM' | 'MULTI_INCIDENT_CONCURRENT';
  description: string;
  injectedRootCauseService: string;
  expectedIncidentCount: number;
  expectedRootCause: string;
  expectedGroupings: string[][]; // list of service ID sets expected in distinct incidents
  alerts: Alert[];
}

export interface ScenarioBreakdown {
  scenarioId: string;
  name: string;
  category: string;
  expectedIncidents: number;
  detectedIncidents: number;
  precision: number;
  recall: number;
  f1Score: number;
  falseMerges: number;
  falseSplits: number;
  verdict: 'PASS' | 'WARN' | 'FAIL';
  details: string;
}

export interface BenchmarkResult {
  totalRawAlerts: number;
  totalDeduplicatedAlerts: number;
  noiseReductionPercent: number;
  groundTruthIncidents: number;
  detectedIncidents: number;
  precision: number;
  recall: number;
  f1Score: number;
  falseMerges: number;
  falseSplits: number;
  missedIncidents: number;
  scenariosEvaluated: number;
  durationMs: number;
  scenarioBreakdown: ScenarioBreakdown[];
}

export interface AlertTuningRecommendation {
  id: string;
  alertFingerprint: string;
  serviceId: string;
  serviceName: string;
  metricName: string;
  alertTitle: string;
  issueType: 'high_flapping' | 'redundant_threshold' | 'unactionable_noise' | 'overly_sensitive_window' | 'missing_dependency_context';
  occurrences: number;
  incidentsCorrelated: number;
  correlationRate: number; // percentage
  suggestedAction: string;
  confidence: 'HIGH' | 'MEDIUM' | 'LOW';
  codePatchRecommendation?: string;
  status: 'pending' | 'accepted' | 'dismissed';
}

export interface ReviewerFeedback {
  id: string;
  incidentId: string;
  timestamp: string;
  reviewer: string;
  verdict: 'CORRECT' | 'INCORRECT' | 'UNCERTAIN';
  suggestedAction: 'KEEP' | 'SUGGEST_SPLIT' | 'SUGGEST_MERGE';
  suggestedRelatedIncidentId?: string;
  notes: string;
}

export interface AuditEvent {
  id: string;
  timestamp: string;
  type: 'FEEDBACK_SUBMITTED' | 'STATUS_CHANGED' | 'EVALUATION_RUN' | 'SIMULATION_RESET' | 'SCENARIO_INJECTED' | 'CONFIG_CHANGED' | 'ALERT_TUNING_REVIEW';
  actor: string;
  targetId: string;
  details: Record<string, unknown>;
}

export interface SystemSettings {
  engineVersion: string;
  datasetSeed: number;
  timeWindowSeconds: number;
  linkDensityThreshold: number;
  maxClusterDiameter: number;
  modelName: string;
  geminiEnabled: boolean;
  activeSplit: 'train' | 'val' | 'test';
  lateArrivalWindowSeconds: number;
}
