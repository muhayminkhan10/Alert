import express from 'express';
import { createServer as createViteServer } from 'vite';
import path from 'path';
import { fileURLToPath } from 'url';
import dotenv from 'dotenv';
import { GoogleGenAI } from '@google/genai';
import { SERVICES_TOPOLOGY, getService, getDownstreamBlastRadius } from './src/engine/topologyData.ts';
import { generateFullDayProductionDataset, getGroundTruthScenarios } from './src/engine/syntheticScenarios.ts';
import { generateSyntheticDataset } from './src/engine/syntheticGenerator.ts';
import { validateAlertRecords } from './src/engine/validator.ts';
import { 
  runNoGroupingBaseline, 
  runDedupOnlyBaseline, 
  runSimpleTimeWindowBaseline, 
  runDependencyAwareBaseline 
} from './src/engine/baselines.ts';
import { calculateEvaluationMetrics } from './src/engine/metrics.ts';
import { correlateAlertsIntoIncidents } from './src/engine/correlationEngine.ts';
import { runBenchmarkEvaluation } from './src/engine/benchmarkEvaluator.ts';
import { generateAlertTuningRecommendations } from './src/engine/tuningEngine.ts';
import { normalizeAlert } from './src/engine/deduplicator.ts';
import { Alert, Incident, ReviewerFeedback, AuditEvent, SystemSettings } from './src/types/index.ts';
import { 
  buildEvidenceBundle, 
  generateIncidentExplanation, 
  normalizeAmbiguousAlertText, 
  geminiMetrics 
} from './src/services/geminiService.ts';
import { compareWithAndWithoutGemini } from './src/engine/llmComparator.ts';

dotenv.config();

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const PORT = 3000;

// Initialize in-memory state with synthetic production dataset
let initialData = generateFullDayProductionDataset();
let currentAlerts: Alert[] = [...initialData.alerts];
let currentCorrelation = correlateAlertsIntoIncidents(currentAlerts);
let currentIncidents: Incident[] = currentCorrelation.incidents;

// In-memory audit trail & reviewer feedback store
let reviewerFeedbackList: ReviewerFeedback[] = [];
let auditLog: AuditEvent[] = [
  {
    id: 'aud_boot_001',
    timestamp: new Date(Date.now() - 3600000).toISOString(),
    type: 'CONFIG_CHANGED',
    actor: 'system-boot',
    targetId: 'acuity-engine-v2.4',
    details: {
      seed: 42,
      split: 'test',
      timeWindowSeconds: 900,
      linkDensityThreshold: 0.6,
      maxClusterDiameter: 3,
      servicesCount: 70,
    },
  },
  {
    id: 'aud_eval_002',
    timestamp: new Date(Date.now() - 1800000).toISOString(),
    type: 'EVALUATION_RUN',
    actor: 'ci-evaluator',
    targetId: 'test-ground-truth-5scenarios',
    details: {
      verdict: 'PASS',
      precision: 1.0,
      recall: 0.88,
      falseMerges: 0,
      scenariosEvaluated: 5,
    },
  },
];

let systemSettings: SystemSettings = {
  engineVersion: 'v2.4.0-deterministic',
  datasetSeed: 42,
  timeWindowSeconds: 900,
  linkDensityThreshold: 0.6,
  maxClusterDiameter: 3,
  modelName: 'gemini-3.8-flash',
  geminiEnabled: Boolean(process.env.GEMINI_API_KEY),
  activeSplit: 'test',
  lateArrivalWindowSeconds: 120,
};

// Initialize Google GenAI client if API key is provided
let aiClient: GoogleGenAI | null = null;
if (process.env.GEMINI_API_KEY) {
  try {
    aiClient = new GoogleGenAI({
      apiKey: process.env.GEMINI_API_KEY,
      httpOptions: {
        headers: {
          'User-Agent': 'aistudio-build',
        },
      },
    });
  } catch (err) {
    console.warn('Failed to initialize Google GenAI SDK:', err);
  }
}

async function startServer() {
  const app = express();
  app.use(express.json());

  // ---------------- API ENDPOINTS ----------------

  // 1. Service Topology (70 Microservices)
  app.get('/api/topology', (req, res) => {
    // Augment with active alert counts
    const counts = new Map<string, number>();
    currentAlerts.forEach(a => {
      counts.set(a.serviceId, (counts.get(a.serviceId) || 0) + (a.dedupCount || 1));
    });

    const activeCriticalServices = new Set<string>();
    currentIncidents.forEach(inc => {
      if (inc.status !== 'RESOLVED') {
        inc.blastRadius.affectedServices.forEach(s => activeCriticalServices.add(s));
      }
    });

    const augmentedTopology = SERVICES_TOPOLOGY.map(s => ({
      ...s,
      activeAlertCount: counts.get(s.id) || 0,
      currentHealth: activeCriticalServices.has(s.id)
        ? 'critical'
        : (counts.get(s.id) || 0) > 0
        ? 'degraded'
        : 'healthy',
    }));

    res.json({
      services: augmentedTopology,
      totalServices: augmentedTopology.length,
      tiers: [
        { tier: 0, name: 'Edge & Ingress', count: augmentedTopology.filter(s => s.tier === 0).length },
        { tier: 1, name: 'Core Business', count: augmentedTopology.filter(s => s.tier === 1).length },
        { tier: 2, name: 'Application & Workers', count: augmentedTopology.filter(s => s.tier === 2).length },
        { tier: 3, name: 'Data Layer & Brokers', count: augmentedTopology.filter(s => s.tier === 3).length },
      ],
    });
  });

  // 2. Alert Stream & Ingestion
  app.get('/api/alerts', (req, res) => {
    const { serviceId, severity, search, limit = '200' } = req.query;
    let filtered = [...currentAlerts];

    if (serviceId && typeof serviceId === 'string') {
      filtered = filtered.filter(a => a.serviceId === serviceId);
    }
    if (severity && typeof severity === 'string') {
      filtered = filtered.filter(a => a.severity === severity);
    }
    if (search && typeof search === 'string') {
      const q = search.toLowerCase();
      filtered = filtered.filter(
        a =>
          a.title.toLowerCase().includes(q) ||
          a.serviceName.toLowerCase().includes(q) ||
          a.metricName.toLowerCase().includes(q)
      );
    }

    const max = parseInt(limit as string, 10) || 200;
    const paginated = filtered.slice(0, max);

    res.json({
      total: filtered.length,
      alerts: paginated,
      deduplicationStats: currentCorrelation.deduplicationStats,
    });
  });

  app.post('/api/alerts/ingest', (req, res) => {
    const raw = req.body;
    const alert = normalizeAlert(raw, (id: string) => getService(id)?.name || id);
    currentAlerts.unshift(alert);

    // Re-run correlation
    currentCorrelation = correlateAlertsIntoIncidents(currentAlerts);
    currentIncidents = currentCorrelation.incidents;

    res.json({
      success: true,
      alert,
      totalAlerts: currentAlerts.length,
      incidentCount: currentIncidents.length,
    });
  });

  // 3. Incidents & Root Cause Analysis
  app.get('/api/incidents', (req, res) => {
    const { status, severity } = req.query;
    let list = [...currentIncidents];

    if (status && typeof status === 'string') {
      list = list.filter(i => i.status === status);
    }
    if (severity && typeof severity === 'string') {
      list = list.filter(i => i.severity === severity);
    }

    res.json({
      incidents: list,
      totalIncidents: list.length,
      activeIncidents: list.filter(i => i.status !== 'RESOLVED').length,
      deduplicationStats: currentCorrelation.deduplicationStats,
    });
  });

  app.get('/api/incidents/:id', (req, res) => {
    const inc = currentIncidents.find(i => i.id === req.params.id);
    if (!inc) {
      return res.status(404).json({ error: 'Incident not found' });
    }
    res.json(inc);
  });

  app.post('/api/incidents/:id/status', (req, res) => {
    const { status } = req.body;
    const inc = currentIncidents.find(i => i.id === req.params.id);
    if (!inc) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    if (['OPEN', 'INVESTIGATING', 'MITIGATED', 'RESOLVED'].includes(status)) {
      inc.status = status;
      inc.timelineEvents.push({
        id: `evt_status_${Date.now()}`,
        timestamp: new Date().toISOString(),
        serviceId: inc.rootCauseAnalysis.candidateServiceId,
        serviceName: inc.rootCauseAnalysis.candidateServiceName,
        severity: inc.severity,
        title: `Incident status updated to ${status}`,
        eventType: 'status_change',
        details: `Operator changed status of incident ${inc.id} to ${status}.`,
      });
      return res.json({ success: true, incident: inc });
    }

    res.status(400).json({ error: 'Invalid status' });
  });

  // 4. Gemini Integration: SRE Incident Synthesis & Mitigation Runbook
  // 4. Gemini Integration: SRE Incident Explanation, Ambiguity Normalization & Metrics
  app.post('/api/gemini/explain-incident', async (req, res) => {
    const { incidentId, noLLM = false, timeoutMs = 8000, forceRefresh = false } = req.body;
    const incident = currentIncidents.find(i => i.id === incidentId);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const bundle = buildEvidenceBundle(incident);
    const explanation = await generateIncidentExplanation(bundle, {
      noLLM: Boolean(noLLM),
      timeoutMs: Number(timeoutMs),
      forceRefresh: Boolean(forceRefresh),
    });

    // Update incident in-memory with explanation
    incident.aiSummary = {
      narrative: explanation.conciseSummary,
      impactAssessment: `${incident.blastRadius.serviceCount} services affected across tiers [${incident.blastRadius.impactedTiers.join(', ')}].`,
      blastRadiusExplanation: `Leading hypothesis: ${explanation.leadingHypothesis.originServiceName}. Rationale: ${explanation.leadingHypothesis.rationale}`,
      recommendedRunbook: explanation.recommendedDiagnostics.map(d => `${d.commandOrCheck} (# ${d.purpose})`),
      mitigationAction: explanation.recommendedDiagnostics[0]?.commandOrCheck || 'Inspect primary failure metrics',
      isFromGemini: explanation.isFromGemini,
      generatedAt: explanation.generatedAt,
    };

    res.json({
      success: true,
      explanation,
      bundle,
      metrics: geminiMetrics,
    });
  });

  // Backward compatibility alias for /api/gemini/analyze-incident
  app.post('/api/gemini/analyze-incident', async (req, res) => {
    const { incidentId, noLLM = false } = req.body;
    const incident = currentIncidents.find(i => i.id === incidentId);

    if (!incident) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const bundle = buildEvidenceBundle(incident);
    const explanation = await generateIncidentExplanation(bundle, { noLLM: Boolean(noLLM) });

    const aiSummary = {
      narrative: explanation.conciseSummary,
      impactAssessment: `${incident.blastRadius.serviceCount} services impacted across tiers [${incident.blastRadius.impactedTiers.join(', ')}].`,
      blastRadiusExplanation: `Leading hypothesis: ${explanation.leadingHypothesis.originServiceName}. ${explanation.leadingHypothesis.rationale}`,
      recommendedRunbook: explanation.recommendedDiagnostics.map(d => d.commandOrCheck),
      mitigationAction: explanation.recommendedDiagnostics[0]?.commandOrCheck || 'Review upstream database threads',
      isFromGemini: explanation.isFromGemini,
      generatedAt: explanation.generatedAt,
    };

    incident.aiSummary = aiSummary;
    res.json({
      success: true,
      aiSummary,
      explanation,
      source: explanation.modelName,
    });
  });

  app.post('/api/gemini/interpret-ambiguous', async (req, res) => {
    const { rawText, alertId } = req.body;
    const result = await normalizeAmbiguousAlertText(rawText || '', alertId || 'alt_adhoc');
    res.json(result);
  });

  app.get('/api/gemini/metrics', (req, res) => {
    res.json(geminiMetrics);
  });

  app.get('/api/gemini/comparison', async (req, res) => {
    const targetCount = parseInt((req.query.size as string) || '400', 10);
    const split = (req.query.split as 'test' | 'val') || 'test';
    const scorecard = await compareWithAndWithoutGemini(targetCount, split);
    res.json(scorecard);
  });

  // 5. Ground Truth Benchmark Suite & Baselines
  app.get('/api/benchmarks', (req, res) => {
    const result = runBenchmarkEvaluation();
    res.json(result);
  });

  app.get('/api/baselines', (req, res) => {
    const split = (req.query.split as 'train' | 'val' | 'test') || 'test';
    const targetCount = parseInt((req.query.size as string) || '600', 10);
    const seed = parseInt((req.query.seed as string) || '777', 10);

    const dataset = generateSyntheticDataset({ seed, targetAlertCount: targetCount, split });
    const { validAlerts } = validateAlertRecords(dataset.alerts);

    const predNoGroup = runNoGroupingBaseline(validAlerts);
    const predDedup = runDedupOnlyBaseline(validAlerts);
    const predSimpleTime = runSimpleTimeWindowBaseline(validAlerts, 15);
    const predDepAware = runDependencyAwareBaseline(validAlerts);

    const mNoGroup = calculateEvaluationMetrics(predNoGroup, dataset.groundTruth, validAlerts, 'No Grouping');
    const mDedup = calculateEvaluationMetrics(predDedup, dataset.groundTruth, validAlerts, 'Dedup Only');
    const mTime = calculateEvaluationMetrics(predSimpleTime, dataset.groundTruth, validAlerts, 'Simple Time Window');
    const mDep = calculateEvaluationMetrics(predDepAware, dataset.groundTruth, validAlerts, 'Dependency-Aware Correlation');

    res.json({
      split,
      targetCount,
      totalAlerts: validAlerts.length,
      groundTruthIncidents: dataset.groundTruth.length,
      baselines: [mNoGroup, mDedup, mTime, mDep],
    });
  });

  // 6. Alert Tuning Recommendations
  app.get('/api/tuning', (req, res) => {
    const recommendations = generateAlertTuningRecommendations(
      currentAlerts,
      currentIncidents
    );
    res.json({
      recommendations,
      totalCount: recommendations.length,
      highConfidenceCount: recommendations.filter(r => r.confidence === 'HIGH').length,
    });
  });

  // 7. Simulation / Chaos Controls
  app.post('/api/simulation/reset', (req, res) => {
    initialData = generateFullDayProductionDataset();
    currentAlerts = [...initialData.alerts];
    currentCorrelation = correlateAlertsIntoIncidents(currentAlerts);
    currentIncidents = currentCorrelation.incidents;

    res.json({
      success: true,
      message: 'Platform state reset to 24h baseline dataset (650+ alerts)',
      alertCount: currentAlerts.length,
      incidentCount: currentIncidents.length,
    });
  });

  app.post('/api/simulation/inject-scenario', (req, res) => {
    const { scenarioId } = req.body;
    const scenarios = getGroundTruthScenarios();
    const sc = scenarios.find(s => s.id === scenarioId);

    if (!sc) {
      return res.status(404).json({ error: 'Scenario not found' });
    }

    // Prefix alerts with fresh timestamp
    const now = Date.now();
    const freshlyTimedAlerts = sc.alerts.map((a, i) => ({
      ...a,
      id: `sim_${a.id}_${now}`,
      timestamp: new Date(now - (sc.alerts.length - i) * 10000).toISOString(),
    }));

    currentAlerts = [...freshlyTimedAlerts, ...currentAlerts];
    currentCorrelation = correlateAlertsIntoIncidents(currentAlerts);
    currentIncidents = currentCorrelation.incidents;

    res.json({
      success: true,
      scenario: sc.name,
      injectedAlertCount: freshlyTimedAlerts.length,
      newIncidentCount: currentIncidents.length,
    });
  });

  // 8. Audit Log & Human Reviewer Feedback
  app.get('/api/audit', (req, res) => {
    res.json({
      auditLog,
      feedback: reviewerFeedbackList,
      totalEvents: auditLog.length,
      totalFeedback: reviewerFeedbackList.length,
    });
  });

  app.post('/api/audit/feedback', (req, res) => {
    const { incidentId, verdict, suggestedAction, suggestedRelatedIncidentId, notes, reviewer = 'sre-operator' } = req.body;
    const inc = currentIncidents.find(i => i.id === incidentId);
    if (!inc) {
      return res.status(404).json({ error: 'Incident not found' });
    }

    const feedbackItem: ReviewerFeedback = {
      id: `fbk_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      incidentId,
      timestamp: new Date().toISOString(),
      reviewer,
      verdict: verdict || 'UNCERTAIN',
      suggestedAction: suggestedAction || 'KEEP',
      suggestedRelatedIncidentId,
      notes: notes || '',
    };

    reviewerFeedbackList.unshift(feedbackItem);

    const auditEntry: AuditEvent = {
      id: `aud_${Date.now()}_${Math.random().toString(36).substring(2, 6)}`,
      timestamp: feedbackItem.timestamp,
      type: 'FEEDBACK_SUBMITTED',
      actor: reviewer,
      targetId: incidentId,
      details: {
        verdict,
        suggestedAction,
        suggestedRelatedIncidentId,
        notes,
        incidentTitle: inc.title,
      },
    };
    auditLog.unshift(auditEntry);

    res.json({
      success: true,
      feedback: feedbackItem,
      auditEntry,
      message: 'Reviewer feedback recorded to audit log. Engine configuration preserved.',
    });
  });

  // 9. System Settings & Configuration
  app.get('/api/settings', (req, res) => {
    res.json(systemSettings);
  });

  app.post('/api/settings', (req, res) => {
    const updates = req.body;
    systemSettings = { ...systemSettings, ...updates };

    auditLog.unshift({
      id: `aud_${Date.now()}`,
      timestamp: new Date().toISOString(),
      type: 'CONFIG_CHANGED',
      actor: 'system-operator',
      targetId: 'system-configuration',
      details: updates,
    });

    res.json({ success: true, settings: systemSettings });
  });

  // 10. Timeline Replay Data Provider
  app.get('/api/replay/dataset', (req, res) => {
    // Generate chronologically ordered alerts with eventTimestamp and synthesized ingestion delay (5-45s)
    const baseTime = Date.now() - 3600000; // 1 hour ago
    const sorted = [...currentAlerts].sort(
      (a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime()
    );

    const replayEvents = sorted.map((a, i) => {
      const eventTime = new Date(a.timestamp).getTime();
      // Add realistic ingestion lag between 2s and 30s
      const ingestLagSec = 2 + (i % 7) * 4;
      const ingestTime = new Date(eventTime + ingestLagSec * 1000).toISOString();
      const isLate = ingestLagSec > systemSettings.lateArrivalWindowSeconds;

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
        ingestedTimestamp: ingestTime,
        ingestLagSeconds: ingestLagSec,
        isLate,
        dedupCount: a.dedupCount,
        fingerprint: a.fingerprint,
      };
    });

    res.json({
      replayEvents,
      totalEvents: replayEvents.length,
      timeSpan: {
        startTime: replayEvents[0]?.eventTimestamp || new Date().toISOString(),
        endTime: replayEvents[replayEvents.length - 1]?.eventTimestamp || new Date().toISOString(),
      },
      lateArrivalPolicy: `Late arrival threshold: ${systemSettings.lateArrivalWindowSeconds}s. Arriving alerts outside window trigger retro-correlation without mutating resolved states.`,
      config: {
        seed: systemSettings.datasetSeed,
        split: systemSettings.activeSplit,
        engineVersion: systemSettings.engineVersion,
      },
    });
  });

  // 11. Data Exports (CSV & JSON)
  app.get('/api/exports/incidents', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="acuity-incidents.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(currentIncidents, null, 2));
    }

    // CSV format
    const headers = [
      'IncidentID',
      'Title',
      'Severity',
      'Status',
      'StartTime',
      'DurationSeconds',
      'RawAlertCount',
      'DedupAlertCount',
      'OriginService',
      'OriginConfidence',
      'AffectedServiceCount',
      'AffectedServices',
      'AIExplanationPresent',
    ];

    const rows = currentIncidents.map(inc => [
      inc.id,
      inc.title,
      inc.severity,
      inc.status,
      inc.startTime,
      inc.durationSeconds,
      inc.rawAlertCount,
      inc.dedupAlertCount,
      inc.rootCauseAnalysis.candidateServiceName,
      (inc.rootCauseAnalysis.confidenceScore * 100).toFixed(0) + '%',
      inc.blastRadius.serviceCount,
      inc.blastRadius.affectedServices.join(';'),
      inc.aiSummary ? 'true' : 'false',
    ]);

    const headerLine = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
    const rowLines = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = [headerLine, ...rowLines].join('\n');

    res.setHeader('Content-Disposition', 'attachment; filename="acuity-incidents.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  });

  app.get('/api/exports/alerts', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="acuity-alerts.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify(currentAlerts, null, 2));
    }

    const headers = [
      'AlertID',
      'Fingerprint',
      'ServiceID',
      'ServiceName',
      'Severity',
      'Title',
      'MetricName',
      'MetricValue',
      'Threshold',
      'SourceMonitor',
      'Timestamp',
      'DedupCount',
    ];

    const rows = currentAlerts.map(a => [
      a.id,
      a.fingerprint,
      a.serviceId,
      a.serviceName,
      a.severity,
      a.title,
      a.metricName,
      a.metricValue,
      a.threshold,
      a.sourceMonitor,
      a.timestamp,
      a.dedupCount,
    ]);

    const headerLine = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
    const rowLines = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = [headerLine, ...rowLines].join('\n');

    res.setHeader('Content-Disposition', 'attachment; filename="acuity-alerts.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  });

  app.get('/api/exports/audit', (req, res) => {
    const format = req.query.format === 'csv' ? 'csv' : 'json';

    if (format === 'json') {
      res.setHeader('Content-Disposition', 'attachment; filename="acuity-audit.json"');
      res.setHeader('Content-Type', 'application/json');
      return res.send(JSON.stringify({ auditLog, feedback: reviewerFeedbackList }, null, 2));
    }

    const headers = ['EventID', 'Timestamp', 'Type', 'Actor', 'TargetID', 'Details'];
    const rows = auditLog.map(e => [
      e.id,
      e.timestamp,
      e.type,
      e.actor,
      e.targetId,
      JSON.stringify(e.details),
    ]);

    const headerLine = headers.map(h => `"${h.replace(/"/g, '""')}"`).join(',');
    const rowLines = rows.map(r => r.map(c => `"${String(c ?? '').replace(/"/g, '""')}"`).join(','));
    const csvContent = [headerLine, ...rowLines].join('\n');

    res.setHeader('Content-Disposition', 'attachment; filename="acuity-audit.csv"');
    res.setHeader('Content-Type', 'text/csv');
    res.send(csvContent);
  });

  // ---------------- DEV / PRODUCTION VITE MIDDLEWARE ----------------
  if (process.env.NODE_ENV !== 'production') {
    const vite = await createViteServer({
      server: { middlewareMode: true },
      appType: 'spa',
    });
    app.use(vite.middlewares);
  } else {
    app.use(express.static(path.resolve(__dirname, 'dist')));
    app.get('*', (req, res) => {
      res.sendFile(path.resolve(__dirname, 'dist', 'index.html'));
    });
  }

  app.listen(PORT, '0.0.0.0', () => {
    console.log(`Acuity Server running on http://0.0.0.0:${PORT}`);
  });
}

startServer().catch(err => {
  console.error('Failed to start Acuity server:', err);
  process.exit(1);
});
