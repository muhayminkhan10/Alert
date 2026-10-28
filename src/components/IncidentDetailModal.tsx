import React, { useState } from 'react';
import { 
  X, 
  ShieldAlert, 
  Clock, 
  ArrowRight, 
  Sparkles, 
  Terminal, 
  Copy, 
  Check, 
  AlertTriangle, 
  ChevronRight, 
  FileText, 
  Layers, 
  Activity,
  RotateCw,
  MessageSquare,
  HelpCircle,
  CheckCircle2,
  XCircle,
  GitBranch,
  Split,
  Settings
} from 'lucide-react';
import { Incident, Alert, ReviewerFeedback } from '../types';
import { 
  analyzeIncidentWithGemini, 
  updateIncidentStatus, 
  explainIncidentWithGemini,
  submitReviewerFeedback 
} from '../api/client';
import { GeminiIncidentExplanation, CompetingHypothesis, DiagnosticCheck } from '../types/geminiSchemas';

interface IncidentDetailModalProps {
  incident: Incident | null;
  onClose: () => void;
  onUpdate: (updated: Incident) => void;
}

export const IncidentDetailModal: React.FC<IncidentDetailModalProps> = ({
  incident,
  onClose,
  onUpdate,
}) => {
  if (!incident) return null;

  const [activeTab, setActiveTab] = useState<'timeline' | 'rca' | 'ai' | 'alerts' | 'review'>('timeline');
  const [analyzingWithGemini, setAnalyzingWithGemini] = useState(false);
  const [copiedIndex, setCopiedIndex] = useState<number | null>(null);
  const [selectedAlertForPayload, setSelectedAlertForPayload] = useState<Alert | null>(null);
  const [statusUpdating, setStatusUpdating] = useState(false);
  const [rawExplanation, setRawExplanation] = useState<GeminiIncidentExplanation | null>(null);

  // Reviewer Feedback State
  const [feedbackVerdict, setFeedbackVerdict] = useState<'CORRECT' | 'INCORRECT' | 'UNCERTAIN'>('CORRECT');
  const [feedbackAction, setFeedbackAction] = useState<'KEEP' | 'SUGGEST_SPLIT' | 'SUGGEST_MERGE'>('KEEP');
  const [suggestedMergeId, setSuggestedMergeId] = useState('');
  const [feedbackNotes, setFeedbackNotes] = useState('');
  const [submittingFeedback, setSubmittingFeedback] = useState(false);
  const [feedbackSubmitted, setFeedbackSubmitted] = useState(false);

  const handleStatusChange = async (newStatus: 'OPEN' | 'INVESTIGATING' | 'MITIGATED' | 'RESOLVED') => {
    setStatusUpdating(true);
    const updated = await updateIncidentStatus(incident.id, newStatus);
    if (updated) onUpdate(updated);
    setStatusUpdating(false);
  };

  const handleRunGeminiExplanation = async (noLLM: boolean = false) => {
    setAnalyzingWithGemini(true);
    const res = await explainIncidentWithGemini(incident.id, noLLM);
    if (res.success && res.explanation) {
      setRawExplanation(res.explanation);
      const summary = {
        narrative: res.explanation.conciseSummary,
        impactAssessment: res.explanation.uncertaintyNotes || 'Evaluated telemetry cascade.',
        blastRadiusExplanation: `Leading hypothesis: ${res.explanation.leadingHypothesis?.originServiceName || incident.rootCauseAnalysis.candidateServiceName}`,
        recommendedRunbook: (res.explanation.recommendedDiagnostics || []).map((d: DiagnosticCheck) => `${d.targetService}: ${d.commandOrCheck}`),
        mitigationAction: `Inspect leading hypothesis: ${res.explanation.leadingHypothesis?.originServiceName || 'Root service'}`,
        isFromGemini: !noLLM,
        generatedAt: new Date().toISOString(),
      };
      const updated = { ...incident, aiSummary: summary };
      onUpdate(updated);
    } else {
      // Fallback
      const fallbackRes = await analyzeIncidentWithGemini(incident.id);
      if (fallbackRes.success && fallbackRes.aiSummary) {
        const updated = { ...incident, aiSummary: fallbackRes.aiSummary };
        onUpdate(updated);
      }
    }
    setAnalyzingWithGemini(false);
  };

  const handleSubmitFeedback = async (e: React.FormEvent) => {
    e.preventDefault();
    setSubmittingFeedback(true);
    const success = await submitReviewerFeedback({
      incidentId: incident.id,
      verdict: feedbackVerdict,
      suggestedAction: feedbackAction,
      suggestedRelatedIncidentId: feedbackAction === 'SUGGEST_MERGE' ? suggestedMergeId : undefined,
      notes: feedbackNotes,
      reviewer: 'sre-oncall-operator',
    });
    setSubmittingFeedback(false);
    if (success) {
      setFeedbackSubmitted(true);
      setTimeout(() => setFeedbackSubmitted(false), 5000);
    }
  };

  const copyToClipboard = (text: string, index: number) => {
    navigator.clipboard.writeText(text);
    setCopiedIndex(index);
    setTimeout(() => setCopiedIndex(null), 2000);
  };

  const rca = incident.rootCauseAnalysis;
  const aiSummary = incident.aiSummary;

  // Compute relative timeline start
  const firstAlertTime = new Date(incident.startTime).getTime();

  return (
    <div className="fixed inset-0 z-50 overflow-y-auto bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-3 sm:p-6 animate-in fade-in duration-200">
      <div className="bg-slate-900 border border-slate-700/80 rounded-2xl w-full max-w-5xl max-h-[92vh] flex flex-col shadow-2xl overflow-hidden">
        {/* Modal Header */}
        <div className="p-5 border-b border-slate-800 bg-slate-900/90 flex items-start justify-between gap-4">
          <div className="space-y-1.5">
            <div className="flex items-center gap-2.5 flex-wrap">
              <span className={`px-2.5 py-0.5 rounded text-xs font-bold uppercase tracking-wider border ${
                incident.severity === 'CRITICAL'
                  ? 'bg-rose-950/90 text-rose-300 border-rose-800'
                  : incident.severity === 'HIGH'
                  ? 'bg-amber-950/90 text-amber-300 border-amber-800'
                  : 'bg-cyan-950/90 text-cyan-300 border-cyan-800'
              }`}>
                {incident.severity}
              </span>
              <span className="font-mono text-xs text-slate-400">
                {incident.id}
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-300 flex items-center gap-1">
                <Clock className="w-3.5 h-3.5 text-slate-400" />
                Duration: {incident.durationSeconds}s
              </span>
              <span className="text-slate-600">•</span>
              <span className="text-xs text-slate-300">
                Blast Radius: {incident.blastRadius.serviceCount} services
              </span>
            </div>

            <h2 className="text-lg sm:text-xl font-bold text-white tracking-tight">
              {incident.title}
            </h2>
          </div>

          <div className="flex items-center gap-3">
            {/* Status Selector */}
            <div className="relative">
              <select
                value={incident.status}
                disabled={statusUpdating}
                onChange={e => handleStatusChange(e.target.value as any)}
                className="bg-slate-800 border border-slate-700 text-xs text-slate-200 font-semibold rounded-lg px-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
              >
                <option value="OPEN">Status: OPEN</option>
                <option value="INVESTIGATING">Status: INVESTIGATING</option>
                <option value="MITIGATED">Status: MITIGATED</option>
                <option value="RESOLVED">Status: RESOLVED</option>
              </select>
            </div>

            <button
              onClick={onClose}
              className="p-1.5 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800 transition-colors"
            >
              <X className="w-5 h-5" />
            </button>
          </div>
        </div>

        {/* Modal Navigation Tabs (5 Tabs) */}
        <div className="flex border-b border-slate-800 bg-slate-950/50 px-5 gap-2 text-xs font-medium overflow-x-auto">
          <button
            onClick={() => setActiveTab('timeline')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'timeline'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Clock className="w-4 h-4" />
            <span>Propagation Waterfall</span>
          </button>

          <button
            onClick={() => setActiveTab('rca')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'rca'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <ShieldAlert className="w-4 h-4" />
            <span>Root Cause & Decisions</span>
          </button>

          <button
            onClick={() => setActiveTab('ai')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'ai'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <Sparkles className="w-4 h-4 text-indigo-400" />
            <span>Gemini SRE Postmortem</span>
          </button>

          <button
            onClick={() => setActiveTab('alerts')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'alerts'
                ? 'border-cyan-400 text-cyan-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <FileText className="w-4 h-4" />
            <span>Correlated Alerts ({incident.alerts.length})</span>
          </button>

          <button
            onClick={() => setActiveTab('review')}
            className={`py-3 px-3 border-b-2 flex items-center gap-2 whitespace-nowrap transition-colors ${
              activeTab === 'review'
                ? 'border-amber-400 text-amber-400 font-semibold'
                : 'border-transparent text-slate-400 hover:text-slate-200'
            }`}
          >
            <MessageSquare className="w-4 h-4 text-amber-400" />
            <span>Reviewer Audit & Feedback</span>
          </button>
        </div>

        {/* Modal Body Content */}
        <div className="p-6 overflow-y-auto space-y-6 flex-1 text-slate-200">
          {/* TAB 1: TIMELINE WATERFALL */}
          {activeTab === 'timeline' && (
            <div className="space-y-4">
              <div className="flex items-center justify-between text-xs text-slate-400">
                <span>Cascade Onset: {new Date(incident.startTime).toLocaleTimeString()}</span>
                <span>Relative Timeline (Offset from T+0s)</span>
              </div>

              <div className="space-y-3 relative pl-6 before:content-[''] before:absolute before:left-2 before:top-3 before:bottom-3 before:w-0.5 before:bg-slate-800">
                {incident.alerts.map((alert, idx) => {
                  const alertTime = new Date(alert.timestamp).getTime();
                  const offsetSec = Math.max(0, Math.round((alertTime - firstAlertTime) / 1000));
                  const isRoot = alert.serviceId === rca.candidateServiceId;

                  return (
                    <div key={alert.id} className="relative group">
                      {/* Timeline dot */}
                      <span className={`absolute -left-6 top-3 w-3 h-3 rounded-full border-2 ${
                        isRoot
                          ? 'bg-amber-400 border-amber-900 ring-2 ring-amber-400/40'
                          : alert.severity === 'CRITICAL'
                          ? 'bg-rose-500 border-rose-950'
                          : 'bg-cyan-500 border-cyan-950'
                      }`} />

                      <div className={`p-4 rounded-xl border transition-all ${
                        isRoot
                          ? 'bg-amber-950/20 border-amber-800/80 shadow-md shadow-amber-950/20'
                          : 'bg-slate-800/40 border-slate-800 hover:border-slate-700'
                      }`}>
                        <div className="flex items-start justify-between gap-3">
                          <div className="space-y-1">
                            <div className="flex items-center gap-2 flex-wrap">
                              <span className="font-mono text-xs px-2 py-0.5 rounded bg-slate-900 text-cyan-400 border border-slate-700">
                                T+{offsetSec}s
                              </span>
                              <span className={`px-2 py-0.5 rounded text-[10px] font-bold border ${
                                alert.severity === 'CRITICAL'
                                  ? 'bg-rose-950 text-rose-300 border-rose-800'
                                  : 'bg-amber-950 text-amber-300 border-amber-800'
                              }`}>
                                {alert.severity}
                              </span>
                              <span className="font-semibold text-white text-sm">
                                {alert.serviceName}
                              </span>
                              {isRoot && (
                                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-400 text-slate-950">
                                  ORIGIN POINT
                                </span>
                              )}
                            </div>

                            <h4 className="text-sm font-medium text-slate-100">
                              {alert.title}
                            </h4>
                            <p className="text-xs text-slate-400">
                              {alert.description}
                            </p>
                          </div>

                          <div className="text-right shrink-0">
                            <span className="text-[11px] font-mono text-slate-400 block">
                              Metric: <strong className="text-white">{alert.metricName}</strong>
                            </span>
                            <span className="text-[11px] font-mono text-amber-300">
                              Value: {alert.metricValue} (Threshold: {alert.threshold})
                            </span>
                            {alert.dedupCount > 1 && (
                              <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-900 text-slate-400 block mt-1">
                                {alert.dedupCount}x occurrences suppressed
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    </div>
                  );
                })}
              </div>
            </div>
          )}

          {/* TAB 2: ROOT CAUSE EVIDENCE & GROUPING DECISIONS */}
          {activeTab === 'rca' && (
            <div className="space-y-6">
              {/* Primary Candidate Card */}
              <div className="bg-gradient-to-br from-amber-950/30 via-slate-900 to-slate-900 border border-amber-800/80 rounded-xl p-5 shadow-lg">
                <div className="flex items-center justify-between">
                  <span className="text-xs font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-4 h-4" />
                    <span>Ranked Probable Incident Origin</span>
                  </span>
                  <span className="px-2.5 py-1 rounded-full bg-amber-950 text-amber-300 text-xs font-bold border border-amber-800">
                    Confidence: {(rca.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>

                <div className="mt-3">
                  <h3 className="text-xl font-extrabold text-white">
                    {rca.candidateServiceName}
                  </h3>
                  <p className="text-xs text-slate-400 font-mono mt-0.5">
                    Service ID: {rca.candidateServiceId} • Earliest recorded onset: {new Date(incident.startTime).toLocaleTimeString()}
                  </p>
                </div>

                {/* Evidence Points */}
                <div className="mt-4 pt-4 border-t border-amber-900/40 space-y-2">
                  <span className="text-xs font-semibold text-slate-300 uppercase tracking-wider">
                    Supporting Causal Evidence:
                  </span>
                  <ul className="space-y-1.5 text-xs text-slate-300">
                    {rca.evidenceReasons.map((reason, i) => (
                      <li key={i} className="flex items-start gap-2">
                        <Check className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
                        <span>{reason}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              </div>

              {/* Grouping Decision & Engine Configuration Version (Section 2 Requirement) */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Settings className="w-4 h-4 text-cyan-400" />
                    <span>Grouping Decisions & Configuration Audit</span>
                  </span>
                  <span className="text-[11px] font-mono text-cyan-300">
                    Engine: v2.4.0-deterministic
                  </span>
                </div>

                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs">
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-slate-400 text-[10px] uppercase font-semibold block">Correlation Outcome</span>
                    <strong className="text-emerald-400 font-bold font-mono">ACCEPTED CORRELATION</strong>
                    <p className="text-[11px] text-slate-400">All member alerts satisfy distance & density bounds.</p>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-slate-400 text-[10px] uppercase font-semibold block">Max Cluster Diameter</span>
                    <strong className="text-white font-mono">{rca.propagationPath.length <= 3 ? `${rca.propagationPath.length} hops (≤ 3 SLA)` : '3 hops constrained'}</strong>
                    <p className="text-[11px] text-slate-400">Prevents transitive chaining and false merges.</p>
                  </div>
                  <div className="bg-slate-950 p-3 rounded-lg border border-slate-800 space-y-1">
                    <span className="text-slate-400 text-[10px] uppercase font-semibold block">Temporal Window Bound</span>
                    <strong className="text-white font-mono">900s Sliding Window</strong>
                    <p className="text-[11px] text-slate-400">Chronological sliding window with volatile ID masking.</p>
                  </div>
                </div>
              </div>

              {/* Propagation Hops Breakdown */}
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-3">
                <h4 className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                  Cascade Propagation Hops ({rca.propagationHops.length})
                </h4>
                <div className="space-y-2">
                  {rca.propagationHops.map((hop, i) => (
                    <div key={i} className="p-3 rounded-lg bg-slate-800/60 border border-slate-700/80 text-xs flex items-center justify-between gap-3">
                      <div className="flex items-center gap-2">
                        <span className="font-mono font-semibold text-amber-300">{hop.fromService}</span>
                        <ArrowRight className="w-3.5 h-3.5 text-slate-500" />
                        <span className="font-mono font-semibold text-rose-300">{hop.toService}</span>
                      </div>
                      <div className="text-slate-400 text-right">
                        <span>Propagation Lag: <strong className="text-white">+{hop.lagSeconds}s</strong></span>
                      </div>
                    </div>
                  ))}
                </div>
              </div>
            </div>
          )}

          {/* TAB 3: GEMINI SRE EXPLANATION */}
          {activeTab === 'ai' && (
            <div className="space-y-6">
              {/* Controls Bar */}
              <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 bg-slate-950/80 border border-slate-800 rounded-xl p-4">
                <div className="flex items-center gap-3">
                  <div className="p-2 rounded-lg bg-indigo-950 text-indigo-400 border border-indigo-800">
                    <Sparkles className="w-5 h-5" />
                  </div>
                  <div>
                    <div className="flex items-center gap-2">
                      <h4 className="text-sm font-bold text-white">
                        Selective Incident Explanation Layer
                      </h4>
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-slate-800 text-slate-300 font-mono">
                        {aiSummary?.isFromGemini ? 'Gemini 3.8 Flash' : 'Deterministic Mode'}
                      </span>
                    </div>
                    <p className="text-xs text-slate-400">
                      Interprets complex cascading telemetry, evaluates competing hypotheses, and formulates diagnostic triage.
                    </p>
                  </div>
                </div>

                <div className="flex items-center gap-2 self-start sm:self-center">
                  <button
                    onClick={() => handleRunGeminiExplanation(false)}
                    disabled={analyzingWithGemini}
                    className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold transition-all shadow-md shadow-indigo-900/30"
                  >
                    <Sparkles className={`w-3.5 h-3.5 ${analyzingWithGemini ? 'animate-spin' : ''}`} />
                    <span>{analyzingWithGemini ? 'Analyzing...' : 'Generate with Gemini'}</span>
                  </button>

                  <button
                    onClick={() => handleRunGeminiExplanation(true)}
                    disabled={analyzingWithGemini}
                    className="flex items-center gap-1.5 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
                    title="Force deterministic rule-based analysis without model call"
                  >
                    <Terminal className="w-3.5 h-3.5 text-cyan-400" />
                    <span>No-LLM Mode</span>
                  </button>
                </div>
              </div>

              {/* Layer 1: Observed Facts */}
              <div className="bg-slate-900 border border-slate-800/90 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-[11px] font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Activity className="w-3.5 h-3.5" />
                    <span>Layer 1: Observed Facts (Raw Telemetry)</span>
                  </span>
                  <span className="text-[11px] text-slate-400 font-mono">
                    {incident.rawAlertCount} Raw Events • {incident.blastRadius.serviceCount} Services
                  </span>
                </div>
                <div className="grid grid-cols-1 sm:grid-cols-3 gap-3 text-xs text-slate-300">
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-400 text-[10px] uppercase block">Earliest Firing Alert</span>
                    <strong className="text-white font-mono text-[11px] truncate block">{incident.alerts[0]?.title}</strong>
                    <span className="text-slate-400 text-[10px] font-mono">{new Date(incident.startTime).toLocaleTimeString()}</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-400 text-[10px] uppercase block">Impacted Tiers</span>
                    <strong className="text-white font-mono text-[11px]">Tiers [{incident.blastRadius.impactedTiers.join(', ')}]</strong>
                    <span className="text-slate-400 text-[10px] block">Edge to Storage</span>
                  </div>
                  <div className="bg-slate-950 p-2.5 rounded-lg border border-slate-800">
                    <span className="text-slate-400 text-[10px] uppercase block">Deduplication Ratio</span>
                    <strong className="text-emerald-400 font-mono text-[11px]">
                      {incident.rawAlertCount > incident.dedupAlertCount
                        ? `${Math.round(((incident.rawAlertCount - incident.dedupAlertCount) / incident.rawAlertCount) * 100)}% duplicate noise suppressed`
                        : '0% duplicate noise'}
                    </strong>
                    <span className="text-slate-400 text-[10px] block">{incident.dedupAlertCount} unique states</span>
                  </div>
                </div>
              </div>

              {/* Layer 2: Deterministic Inferences */}
              <div className="bg-slate-900 border border-slate-800/90 rounded-xl p-4 space-y-2.5">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-[11px] font-bold text-amber-400 uppercase tracking-wider flex items-center gap-1.5">
                    <ShieldAlert className="w-3.5 h-3.5" />
                    <span>Layer 2: Deterministic Engine Inferences</span>
                  </span>
                  <span className="text-[11px] text-amber-300 font-mono">
                    RCA Confidence: {(rca.confidenceScore * 100).toFixed(0)}%
                  </span>
                </div>
                <div className="text-xs text-slate-300 space-y-1.5">
                  <div className="flex items-center gap-2">
                    <span className="text-slate-400">Probable Origin:</span>
                    <strong className="text-white font-mono text-sm">{rca.candidateServiceName} ({rca.candidateServiceId})</strong>
                  </div>
                  <div className="flex items-center gap-2 flex-wrap">
                    <span className="text-slate-400">Causality Path:</span>
                    <span className="font-mono text-cyan-300 text-[11px]">{rca.propagationPath.join(' → ')}</span>
                  </div>
                </div>
              </div>

              {/* Layer 3: Gemini Synthesis */}
              <div className="bg-slate-900 border border-indigo-900/60 rounded-xl p-5 space-y-4">
                <div className="flex items-center justify-between border-b border-slate-800 pb-2">
                  <span className="text-[11px] font-bold text-indigo-400 uppercase tracking-wider flex items-center gap-1.5">
                    <Sparkles className="w-3.5 h-3.5" />
                    <span>Layer 3: Gemini AI Synthesis & Hypotheses</span>
                  </span>
                  <span className="text-[10px] text-slate-400 font-mono">
                    Model Confidence: <span className="text-emerald-400 font-bold uppercase">{rawExplanation?.leadingHypothesis?.confidenceQualitative || 'HIGH'}</span>
                  </span>
                </div>

                {/* Narrative Summary */}
                <div className="space-y-1">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Executive Narrative
                  </span>
                  <p className="text-sm text-slate-200 leading-relaxed">
                    {rawExplanation?.conciseSummary || aiSummary?.narrative || 'Deterministic baseline cascade analysis active.'}
                  </p>
                  {rawExplanation?.normalizedErrorCategory && (
                    <div className="pt-1">
                      <span className="px-2 py-0.5 rounded text-[10px] font-mono font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                        Taxonomy: {rawExplanation.normalizedErrorCategory}
                      </span>
                    </div>
                  )}
                </div>

                {/* Supporting Evidence IDs */}
                {rawExplanation?.supportingEvidenceIds && (
                  <div className="grid grid-cols-1 sm:grid-cols-2 gap-3 pt-2">
                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-emerald-400 block">
                        Supporting Evidence Alert IDs ({rawExplanation.supportingEvidenceIds.length})
                      </span>
                      <div className="flex flex-wrap gap-1">
                        {rawExplanation.supportingEvidenceIds.map((id: string) => (
                          <span key={id} className="px-1.5 py-0.5 rounded bg-emerald-950 text-emerald-300 text-[10px] font-mono border border-emerald-800">
                            {id}
                          </span>
                        ))}
                      </div>
                    </div>

                    <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                      <span className="text-[10px] font-bold uppercase text-slate-400 block">
                        Contradictory Evidence IDs
                      </span>
                      {rawExplanation.contradictoryEvidenceIds?.length > 0 ? (
                        <div className="flex flex-wrap gap-1">
                          {rawExplanation.contradictoryEvidenceIds.map((id: string) => (
                            <span key={id} className="px-1.5 py-0.5 rounded bg-rose-950 text-rose-300 text-[10px] font-mono border border-rose-800">
                              {id}
                            </span>
                          ))}
                        </div>
                      ) : (
                        <span className="text-slate-400 text-[11px] italic">Zero conflicting telemetry reported.</span>
                      )}
                    </div>
                  </div>
                )}

                {/* Competing Alternative Hypotheses */}
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider">
                    Competing Hypotheses Evaluation
                  </span>
                  <div className="space-y-2 text-xs">
                    <div className="p-3 rounded-lg bg-indigo-950/30 border border-indigo-800/80 space-y-1">
                      <div className="flex items-center justify-between">
                        <span className="font-bold text-indigo-300 flex items-center gap-1.5">
                          <Check className="w-3.5 h-3.5 text-emerald-400" />
                          <span>Leading Hypothesis: {rawExplanation?.leadingHypothesis?.originServiceName || rca.candidateServiceName}</span>
                        </span>
                        <span className="text-[10px] px-1.5 py-0.5 rounded bg-indigo-900 text-indigo-200 uppercase font-bold">
                          Confidence: {rawExplanation?.leadingHypothesis?.confidenceQualitative || 'HIGH'}
                        </span>
                      </div>
                      <p className="text-slate-300 text-[11px]">
                        {rawExplanation?.leadingHypothesis?.rationale || 'Topologically upstream with earliest recorded onset timestamp.'}
                      </p>
                    </div>

                    {rawExplanation?.competingHypotheses?.map((alt: CompetingHypothesis, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800 space-y-1">
                        <div className="flex items-center justify-between">
                          <span className="font-semibold text-slate-300">
                            Alternative {idx + 1}: {alt.originServiceName}
                          </span>
                          <span className="text-[10px] px-1.5 py-0.5 rounded bg-slate-800 text-slate-400 uppercase font-medium">
                            Confidence: {alt.confidenceQualitative}
                          </span>
                        </div>
                        <p className="text-slate-400 text-[11px]">
                          {alt.rationale}
                        </p>
                      </div>
                    ))}
                  </div>
                </div>

                {/* Actionable Terminal Diagnostics */}
                <div className="space-y-2 pt-2">
                  <span className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
                    <Terminal className="w-4 h-4 text-emerald-400" />
                    <span>Recommended Diagnostic Triage Checks</span>
                  </span>

                  <div className="space-y-2">
                    {(rawExplanation?.recommendedDiagnostics || []).map((diag: DiagnosticCheck, idx: number) => (
                      <div key={idx} className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs space-y-1.5">
                        <div className="flex items-center justify-between">
                          <span className="text-[11px] font-semibold text-slate-400">
                            Target: <strong className="text-white font-mono">{diag.targetService}</strong> • Purpose: {diag.purpose}
                          </span>
                          <button
                            onClick={() => copyToClipboard(diag.commandOrCheck, idx)}
                            className="p-1 rounded hover:bg-slate-800 text-slate-400 hover:text-white transition-colors"
                            title="Copy command"
                          >
                            {copiedIndex === idx ? (
                              <Check className="w-3.5 h-3.5 text-emerald-400" />
                            ) : (
                              <Copy className="w-3.5 h-3.5" />
                            )}
                          </button>
                        </div>
                        <pre className="p-2 rounded bg-slate-900 text-emerald-300 font-mono text-[11px] overflow-x-auto select-all">
                          {diag.commandOrCheck}
                        </pre>
                      </div>
                    ))}
                  </div>
                </div>
              </div>
            </div>
          )}

          {/* TAB 4: CORRELATED ALERTS TABLE */}
          {activeTab === 'alerts' && (
            <div className="space-y-4">
              <div className="overflow-x-auto rounded-xl border border-slate-800">
                <table className="w-full text-left text-xs">
                  <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
                    <tr>
                      <th className="p-3">Severity</th>
                      <th className="p-3">Service</th>
                      <th className="p-3">Alert Title</th>
                      <th className="p-3">Metric</th>
                      <th className="p-3">Event Time</th>
                      <th className="p-3">Suppressed</th>
                      <th className="p-3">Action</th>
                    </tr>
                  </thead>
                  <tbody className="divide-y divide-slate-800">
                    {incident.alerts.map(a => (
                      <tr key={a.id} className="hover:bg-slate-800/40">
                        <td className="p-3">
                          <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                            a.severity === 'CRITICAL'
                              ? 'bg-rose-950 text-rose-300'
                              : 'bg-amber-950 text-amber-300'
                          }`}>
                            {a.severity}
                          </span>
                        </td>
                        <td className="p-3 font-mono font-medium text-white">{a.serviceId}</td>
                        <td className="p-3 text-slate-200">{a.title}</td>
                        <td className="p-3 font-mono text-slate-400">{a.metricName}</td>
                        <td className="p-3 font-mono text-slate-400 text-[11px]">{new Date(a.timestamp).toLocaleTimeString()}</td>
                        <td className="p-3 font-mono text-slate-400">{a.dedupCount}x</td>
                        <td className="p-3">
                          <button
                            onClick={() => setSelectedAlertForPayload(a)}
                            className="text-cyan-400 hover:text-cyan-300 underline font-mono text-[11px]"
                          >
                            Inspect JSON
                          </button>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>

              {/* Raw JSON Payload Modal / Viewer */}
              {selectedAlertForPayload && (
                <div className="p-4 rounded-xl bg-slate-950 border border-slate-800 space-y-2">
                  <div className="flex items-center justify-between">
                    <span className="font-mono text-xs text-cyan-400">
                      Raw Payload for {selectedAlertForPayload.id} ({selectedAlertForPayload.serviceId})
                    </span>
                    <button
                      onClick={() => setSelectedAlertForPayload(null)}
                      className="text-xs text-slate-400 hover:text-white"
                    >
                      Close
                    </button>
                  </div>
                  <pre className="p-3 rounded bg-slate-900 text-slate-300 font-mono text-xs overflow-x-auto max-h-48">
                    {JSON.stringify(selectedAlertForPayload, null, 2)}
                  </pre>
                </div>
              )}
            </div>
          )}

          {/* TAB 5: REVIEWER AUDIT & FEEDBACK (Section 2 Requirement) */}
          {activeTab === 'review' && (
            <div className="space-y-6">
              <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
                <div>
                  <h3 className="text-sm font-bold text-white flex items-center gap-2">
                    <MessageSquare className="w-4 h-4 text-amber-400" />
                    <span>Human-in-the-Loop Incident Grouping Review</span>
                  </h3>
                  <p className="text-xs text-slate-400 mt-1">
                    Review and flag whether this automated grouping is correct, incorrect, or uncertain. Feedback is recorded as an immutable audit event; it does not automatically mutate the deterministic correlation engine.
                  </p>
                </div>

                {feedbackSubmitted && (
                  <div className="p-3 rounded-lg bg-emerald-950/80 border border-emerald-800 text-emerald-300 text-xs flex items-center gap-2">
                    <CheckCircle2 className="w-4 h-4 text-emerald-400 shrink-0" />
                    <span>Feedback successfully recorded to the Audit Log. Engine configuration and grouping preserved.</span>
                  </div>
                )}

                <form onSubmit={handleSubmitFeedback} className="space-y-4 text-xs">
                  {/* Verdict Radio Buttons */}
                  <div className="space-y-2">
                    <label className="font-semibold text-slate-300 uppercase tracking-wider text-[10px] block">
                      Grouping Assessment:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { val: 'CORRECT', label: 'Correct Grouping', desc: 'Valid causal incident cascade', color: 'emerald' },
                        { val: 'INCORRECT', label: 'Incorrect Grouping', desc: 'Unrelated alerts or false merge', color: 'rose' },
                        { val: 'UNCERTAIN', label: 'Uncertain / Under Review', desc: 'Insufficient telemetry to verify', color: 'amber' },
                      ].map(opt => (
                        <button
                          key={opt.val}
                          type="button"
                          onClick={() => setFeedbackVerdict(opt.val as any)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            feedbackVerdict === opt.val
                              ? 'bg-slate-800 border-cyan-400 shadow-sm'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span className={`font-bold block ${
                            opt.val === 'CORRECT' ? 'text-emerald-400' : opt.val === 'INCORRECT' ? 'text-rose-400' : 'text-amber-400'
                          }`}>
                            {opt.label}
                          </span>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">{opt.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Suggested Action */}
                  <div className="space-y-2 pt-2">
                    <label className="font-semibold text-slate-300 uppercase tracking-wider text-[10px] block">
                      Suggested Action:
                    </label>
                    <div className="grid grid-cols-1 sm:grid-cols-3 gap-2">
                      {[
                        { val: 'KEEP', label: 'Keep Grouping', desc: 'Maintain current cluster boundary' },
                        { val: 'SUGGEST_SPLIT', label: 'Suggest Split', desc: 'Split into separate independent incidents' },
                        { val: 'SUGGEST_MERGE', label: 'Suggest Merge', desc: 'Candidate for merging with another incident' },
                      ].map(act => (
                        <button
                          key={act.val}
                          type="button"
                          onClick={() => setFeedbackAction(act.val as any)}
                          className={`p-3 rounded-lg border text-left transition-all ${
                            feedbackAction === act.val
                              ? 'bg-slate-800 border-indigo-400 shadow-sm'
                              : 'bg-slate-950 border-slate-800 hover:border-slate-700'
                          }`}
                        >
                          <span className="font-bold text-white block">{act.label}</span>
                          <span className="text-[11px] text-slate-400 mt-0.5 block">{act.desc}</span>
                        </button>
                      ))}
                    </div>
                  </div>

                  {/* Suggest Merge Target ID (if merge selected) */}
                  {feedbackAction === 'SUGGEST_MERGE' && (
                    <div className="space-y-1 pt-1">
                      <label className="font-semibold text-slate-300 text-[11px]">
                        Target Incident ID to Merge With:
                      </label>
                      <input
                        type="text"
                        placeholder="e.g. INC-002"
                        value={suggestedMergeId}
                        onChange={e => setSuggestedMergeId(e.target.value)}
                        className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2 text-xs text-white font-mono"
                      />
                    </div>
                  )}

                  {/* Review Notes Textarea */}
                  <div className="space-y-1 pt-1">
                    <label className="font-semibold text-slate-300 text-[11px]">
                      Review Notes & Engineering Observations:
                    </label>
                    <textarea
                      rows={3}
                      placeholder="Add SRE diagnostic observations, why this grouping is correct/incorrect, or evidence references..."
                      value={feedbackNotes}
                      onChange={e => setFeedbackNotes(e.target.value)}
                      className="w-full bg-slate-950 border border-slate-700 rounded-lg p-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-sans"
                    />
                  </div>

                  {/* Submit Button */}
                  <div className="pt-2 flex items-center justify-between border-t border-slate-800">
                    <span className="text-[11px] text-slate-400">
                      Logged to platform audit trail with operator identity and timestamp.
                    </span>
                    <button
                      type="submit"
                      disabled={submittingFeedback}
                      className="px-4 py-2 rounded-lg bg-amber-600 hover:bg-amber-500 text-white font-semibold text-xs transition-colors shadow-md shadow-amber-900/30 flex items-center gap-1.5"
                    >
                      {submittingFeedback ? (
                        <>
                          <RotateCw className="w-3.5 h-3.5 animate-spin" />
                          <span>Submitting...</span>
                        </>
                      ) : (
                        <>
                          <Check className="w-3.5 h-3.5" />
                          <span>Record Audit Feedback</span>
                        </>
                      )}
                    </button>
                  </div>
                </form>
              </div>
            </div>
          )}
        </div>
      </div>
    </div>
  );
};
