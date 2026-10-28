import { Alert, Incident, ServiceNode, BenchmarkResult, AlertTuningRecommendation } from '../types';
import { SERVICES_TOPOLOGY } from '../engine/topologyData';
import { generateFullDayProductionDataset, getGroundTruthScenarios } from '../engine/syntheticScenarios';
import { correlateAlertsIntoIncidents } from '../engine/correlationEngine';
import { runBenchmarkEvaluation } from '../engine/benchmarkEvaluator';
import { generateAlertTuningRecommendations } from '../engine/tuningEngine';
import { normalizeAlert } from '../engine/deduplicator';

// In-browser fallback state if server API is unavailable
let localData = generateFullDayProductionDataset();
let localAlerts: Alert[] = [...localData.alerts];
let localCorrelation = correlateAlertsIntoIncidents(localAlerts);
let localIncidents: Incident[] = localCorrelation.incidents;

export async function fetchTopology(): Promise<{
  services: ServiceNode[];
  totalServices: number;
  tiers: { tier: number; name: string; count: number }[];
}> {
  try {
    const res = await fetch('/api/topology');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }

  // Fallback
  return {
    services: SERVICES_TOPOLOGY,
    totalServices: SERVICES_TOPOLOGY.length,
    tiers: [
      { tier: 0, name: 'Edge & Ingress', count: SERVICES_TOPOLOGY.filter(s => s.tier === 0).length },
      { tier: 1, name: 'Core Business', count: SERVICES_TOPOLOGY.filter(s => s.tier === 1).length },
      { tier: 2, name: 'Application & Workers', count: SERVICES_TOPOLOGY.filter(s => s.tier === 2).length },
      { tier: 3, name: 'Data Layer & Brokers', count: SERVICES_TOPOLOGY.filter(s => s.tier === 3).length },
    ],
  };
}

export async function fetchIncidents(params?: {
  status?: string;
  severity?: string;
}): Promise<{
  incidents: Incident[];
  totalIncidents: number;
  activeIncidents: number;
  deduplicationStats: { rawCount: number; dedupCount: number; suppressionRatio: number };
}> {
  try {
    const query = new URLSearchParams();
    if (params?.status) query.set('status', params.status);
    if (params?.severity) query.set('severity', params.severity);

    const res = await fetch(`/api/incidents?${query.toString()}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }

  let list = [...localIncidents];
  if (params?.status) list = list.filter(i => i.status === params.status);
  if (params?.severity) list = list.filter(i => i.severity === params.severity);

  return {
    incidents: list,
    totalIncidents: list.length,
    activeIncidents: list.filter(i => i.status !== 'RESOLVED').length,
    deduplicationStats: localCorrelation.deduplicationStats,
  };
}

export async function fetchIncidentById(id: string): Promise<Incident | null> {
  try {
    const res = await fetch(`/api/incidents/${id}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }
  return localIncidents.find(i => i.id === id) || null;
}

export async function updateIncidentStatus(
  id: string,
  status: 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED'
): Promise<Incident | null> {
  try {
    const res = await fetch(`/api/incidents/${id}/status`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ status }),
    });
    if (res.ok) {
      const data = await res.json();
      return data.incident;
    }
  } catch (err) {
    console.warn('API error, updating locally:', err);
  }

  const inc = localIncidents.find(i => i.id === id);
  if (inc) {
    inc.status = status;
    return inc;
  }
  return null;
}

export async function explainIncidentWithGemini(
  incidentId: string,
  noLLM: boolean = false
): Promise<{ success: boolean; explanation: any; bundle?: any; metrics?: any }> {
  try {
    const res = await fetch('/api/gemini/explain-incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId, noLLM }),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Explain incident API error:', err);
  }
  return { success: false, explanation: null };
}

export async function analyzeIncidentWithGemini(incidentId: string): Promise<{
  success: boolean;
  aiSummary: any;
  source: string;
}> {
  try {
    const res = await fetch('/api/gemini/analyze-incident', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ incidentId }),
    });
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Gemini endpoint error, using local fallback:', err);
  }

  // Fallback
  const inc = localIncidents.find(i => i.id === incidentId);
  const rootSvc = inc?.rootCauseAnalysis.candidateServiceName || 'Upstream Data Layer';
  const summary = {
    narrative: `Deterministic analysis: ${rootSvc} cascade caused propagation timeouts across ${inc?.blastRadius.affectedServices.length || 3} services.`,
    impactAssessment: `Elevated error rate at public ingress. Transactions degraded.`,
    blastRadiusExplanation: `Direct dependency path: ${inc?.rootCauseAnalysis.propagationPath.join(' -> ')}.`,
    recommendedRunbook: [
      `Inspect connection limits and thread pool queue on ${rootSvc}`,
      `Verify error rates on edge API gateway endpoints`,
      `Drain and restart unhealthy replica instances`,
    ],
    mitigationAction: `Scale active connections or trigger graceful database failover.`,
    isFromGemini: false,
    generatedAt: new Date().toISOString(),
  };

  if (inc) inc.aiSummary = summary;
  return { success: true, aiSummary: summary, source: 'local_deterministic' };
}

export async function fetchAlerts(params?: {
  serviceId?: string;
  severity?: string;
  search?: string;
  limit?: number;
}): Promise<{
  alerts: Alert[];
  total: number;
  deduplicationStats: { rawCount: number; dedupCount: number; suppressionRatio: number };
}> {
  try {
    const query = new URLSearchParams();
    if (params?.serviceId) query.set('serviceId', params.serviceId);
    if (params?.severity) query.set('severity', params.severity);
    if (params?.search) query.set('search', params.search);
    if (params?.limit) query.set('limit', params.limit.toString());

    const res = await fetch(`/api/alerts?${query.toString()}`);
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }

  return {
    alerts: localAlerts.slice(0, params?.limit || 100),
    total: localAlerts.length,
    deduplicationStats: localCorrelation.deduplicationStats,
  };
}

export async function fetchBenchmarks(): Promise<BenchmarkResult> {
  try {
    const res = await fetch('/api/benchmarks');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }
  return runBenchmarkEvaluation();
}

export async function fetchTuningRecommendations(): Promise<{
  recommendations: AlertTuningRecommendation[];
  totalCount: number;
  highConfidenceCount: number;
}> {
  try {
    const res = await fetch('/api/tuning');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }

  const recs = generateAlertTuningRecommendations(localAlerts, localIncidents);
  return {
    recommendations: recs,
    totalCount: recs.length,
    highConfidenceCount: recs.filter(r => r.confidence === 'HIGH').length,
  };
}

export async function resetSimulation(): Promise<boolean> {
  try {
    const res = await fetch('/api/simulation/reset', { method: 'POST' });
    if (res.ok) return true;
  } catch (err) {
    console.warn('API error, resetting local:', err);
  }

  localData = generateFullDayProductionDataset();
  localAlerts = [...localData.alerts];
  localCorrelation = correlateAlertsIntoIncidents(localAlerts);
  localIncidents = localCorrelation.incidents;
  return true;
}

export async function injectChaosScenario(scenarioId: string): Promise<boolean> {
  try {
    const res = await fetch('/api/simulation/inject-scenario', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ scenarioId }),
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn('API error, injecting local:', err);
  }

  const sc = getGroundTruthScenarios().find(s => s.id === scenarioId);
  if (sc) {
    const now = Date.now();
    const fresh = sc.alerts.map((a, i) => ({
      ...a,
      id: `local_sim_${a.id}_${now}`,
      timestamp: new Date(now - (sc.alerts.length - i) * 10000).toISOString(),
    }));
    localAlerts = [...fresh, ...localAlerts];
    localCorrelation = correlateAlertsIntoIncidents(localAlerts);
    localIncidents = localCorrelation.incidents;
    return true;
  }
  return false;
}

export async function fetchAuditLog(): Promise<{
  auditLog: any[];
  feedback: any[];
  totalEvents: number;
  totalFeedback: number;
}> {
  try {
    const res = await fetch('/api/audit');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('API error, using local fallback:', err);
  }
  return { auditLog: [], feedback: [], totalEvents: 0, totalFeedback: 0 };
}

export async function submitReviewerFeedback(feedback: {
  incidentId: string;
  verdict: 'CORRECT' | 'INCORRECT' | 'UNCERTAIN';
  suggestedAction: 'KEEP' | 'SUGGEST_SPLIT' | 'SUGGEST_MERGE';
  suggestedRelatedIncidentId?: string;
  notes: string;
  reviewer?: string;
}): Promise<boolean> {
  try {
    const res = await fetch('/api/audit/feedback', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(feedback),
    });
    if (res.ok) return true;
  } catch (err) {
    console.warn('Feedback submit error:', err);
  }
  return false;
}

export async function fetchSystemSettings(): Promise<any> {
  try {
    const res = await fetch('/api/settings');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Settings fetch error:', err);
  }
  return {
    engineVersion: 'v2.4.0-deterministic',
    datasetSeed: 42,
    timeWindowSeconds: 900,
    linkDensityThreshold: 0.6,
    maxClusterDiameter: 3,
    modelName: 'gemini-3.8-flash',
    geminiEnabled: true,
    activeSplit: 'test',
    lateArrivalWindowSeconds: 120,
  };
}

export async function updateSystemSettings(settings: any): Promise<boolean> {
  try {
    const res = await fetch('/api/settings', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(settings),
    });
    return res.ok;
  } catch (err) {
    console.warn('Settings update error:', err);
    return false;
  }
}

export async function fetchReplayData(): Promise<{
  replayEvents: any[];
  totalEvents: number;
  timeSpan: { startTime: string; endTime: string };
  lateArrivalPolicy: string;
  config: { seed: number; split: string; engineVersion: string };
}> {
  try {
    const res = await fetch('/api/replay/dataset');
    if (res.ok) return await res.json();
  } catch (err) {
    console.warn('Replay dataset error, using local fallback:', err);
  }

  // Fallback replay synthesis
  const sorted = [...localAlerts].sort(
    (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
  );
  const replayEvents = sorted.map((a, i) => {
    const evTime = new Date(a.timestamp).getTime();
    const lagSec = 2 + (i % 7) * 4;
    return {
      id: a.id,
      serviceId: a.serviceId,
      serviceName: a.serviceName,
      severity: a.severity,
      title: a.title,
      metricName: a.metricName,
      metricValue: a.metricValue,
      threshold: a.threshold,
      sourceMonitor: a.sourceMonitor,
      eventTimestamp: a.timestamp,
      ingestedTimestamp: new Date(evTime + lagSec * 1000).toISOString(),
      ingestLagSeconds: lagSec,
      isLate: lagSec > 120,
      dedupCount: a.dedupCount,
      fingerprint: a.fingerprint,
    };
  });

  return {
    replayEvents,
    totalEvents: replayEvents.length,
    timeSpan: {
      startTime: replayEvents[0]?.eventTimestamp || new Date().toISOString(),
      endTime: replayEvents[replayEvents.length - 1]?.eventTimestamp || new Date().toISOString(),
    },
    lateArrivalPolicy: 'Late arrival threshold: 120s. Late alerts trigger retro-correlation without mutating resolved states.',
    config: { seed: 42, split: 'test', engineVersion: 'v2.4.0-deterministic' },
  };
}
