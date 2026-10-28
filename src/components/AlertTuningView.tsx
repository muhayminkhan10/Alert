import React, { useState, useEffect } from 'react';
import { 
  Sliders, 
  Check, 
  X, 
  Copy, 
  Code2, 
  AlertTriangle, 
  TrendingDown, 
  CheckCircle2,
  Info,
  ShieldCheck,
  RotateCw,
  Clock,
  ShieldAlert
} from 'lucide-react';
import { AlertTuningRecommendation } from '../types';
import { fetchTuningRecommendations } from '../api/client';

export const AlertTuningView: React.FC = () => {
  const [recommendations, setRecommendations] = useState<AlertTuningRecommendation[]>([]);
  const [loading, setLoading] = useState(false);
  const [statusFilter, setStatusFilter] = useState<'ALL' | 'pending' | 'accepted' | 'dismissed'>('pending');
  const [copiedId, setCopiedId] = useState<string | null>(null);

  const loadTuning = async () => {
    setLoading(true);
    const data = await fetchTuningRecommendations();
    setRecommendations(data.recommendations || []);
    setLoading(false);
  };

  useEffect(() => {
    loadTuning();
  }, []);

  const handleAction = (id: string, newStatus: 'accepted' | 'dismissed') => {
    setRecommendations(prev =>
      prev.map(r => (r.id === id ? { ...r, status: newStatus } : r))
    );
  };

  const copyPatch = (code: string, id: string) => {
    navigator.clipboard.writeText(code);
    setCopiedId(id);
    setTimeout(() => setCopiedId(null), 2000);
  };

  const filtered = recommendations.filter(r => {
    if (statusFilter !== 'ALL' && r.status !== statusFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-amber-950 text-amber-300 border border-amber-800">
                Alert Tuning Review Board
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Human-in-the-Loop SRE Review
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              Alert Rule Tuning & Flapping Recommendations
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
              Identifies high-repetition monitors and low-incident correlation noise. Reviews are advisory and never mutate or suppress production alerts automatically.
            </p>
          </div>

          <div className="flex items-center gap-2">
            <button
              onClick={loadTuning}
              disabled={loading}
              className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
            >
              <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
              <span>Refresh Candidates</span>
            </button>
          </div>
        </div>

        {/* Safety Principle Banner (Section 6 Requirement) */}
        <div className="p-3.5 rounded-lg bg-slate-950 border border-amber-800/60 text-xs flex items-start gap-3">
          <ShieldAlert className="w-4 h-4 text-amber-400 shrink-0 mt-0.5" />
          <div className="space-y-1">
            <span className="font-bold text-amber-300 uppercase tracking-wider text-[10px]">
              Non-Negotiable Safety Principle:
            </span>
            <p className="text-slate-300 leading-relaxed">
              Never infer that an alert is safe to suppress simply because it has not previously appeared in a known incident. Rare or critical safety signals must remain active. Automatic suppression is strictly prohibited.
            </p>
          </div>
        </div>

        {/* Status Filter */}
        <div className="flex items-center justify-between pt-2 border-t border-slate-800">
          <span className="text-xs text-slate-400">
            Showing {filtered.length} recommendations
          </span>
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1 text-xs">
            {(['pending', 'accepted', 'dismissed', 'ALL'] as const).map(st => (
              <button
                key={st}
                onClick={() => setStatusFilter(st)}
                className={`px-3 py-1 rounded-md font-medium capitalize transition-colors ${
                  statusFilter === st
                    ? 'bg-slate-800 text-cyan-400 font-semibold'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {st}
              </button>
            ))}
          </div>
        </div>
      </div>

      {/* Recommendations Cards */}
      <div className="space-y-4">
        {filtered.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-base font-semibold text-white">No Tuning Recommendations Found</h3>
            <p className="text-xs text-slate-400 mt-1">
              All active monitors meet the required signal-to-noise and correlation criteria.
            </p>
          </div>
        ) : (
          filtered.map(rec => {
            const isFlap = rec.issueType === 'high_flapping';
            const isAccepted = rec.status === 'accepted';
            const isDismissed = rec.status === 'dismissed';

            return (
              <div
                key={rec.id}
                className={`bg-slate-900 border rounded-xl p-5 space-y-4 transition-all ${
                  isAccepted
                    ? 'border-emerald-800/80 bg-emerald-950/10'
                    : isDismissed
                    ? 'border-slate-800/60 opacity-60'
                    : 'border-slate-800 hover:border-slate-700'
                }`}
              >
                <div className="flex flex-col sm:flex-row sm:items-start justify-between gap-3">
                  <div className="space-y-1">
                    <div className="flex items-center gap-2 flex-wrap">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold uppercase tracking-wider ${
                        isFlap
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                      }`}>
                        {rec.issueType.replace('_', ' ').toUpperCase()}
                      </span>
                      <span className="text-xs font-semibold text-white">
                        Family: <code className="text-cyan-300 font-mono">{rec.metricName}</code>
                      </span>
                      <span className="text-xs text-slate-400 font-mono">
                        ({rec.serviceId})
                      </span>
                      <span className="px-1.5 py-0.2 rounded text-[10px] bg-slate-800 text-slate-300 font-mono">
                        Confidence: {rec.confidence}
                      </span>
                    </div>

                    <h4 className="text-base font-bold text-white">
                      {rec.alertTitle}
                    </h4>
                  </div>

                  {/* Manual Review Actions (NO AUTO MUTATION!) */}
                  <div className="flex items-center gap-2 shrink-0">
                    {rec.status === 'pending' ? (
                      <>
                        <button
                          onClick={() => handleAction(rec.id, 'accepted')}
                          className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-emerald-600 hover:bg-emerald-500 text-white text-xs font-semibold transition-colors"
                          title="Approve suggested PromQL/Datadog configuration patch for manual commit"
                        >
                          <Check className="w-3.5 h-3.5" />
                          <span>Mark Reviewed</span>
                        </button>
                        <button
                          onClick={() => handleAction(rec.id, 'dismissed')}
                          className="flex items-center gap-1 px-2.5 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
                          title="Dismiss recommendation and keep active rule as-is"
                        >
                          <X className="w-3.5 h-3.5" />
                          <span>Dismiss</span>
                        </button>
                      </>
                    ) : (
                      <span className={`px-2.5 py-1 rounded text-xs font-bold uppercase ${
                        isAccepted
                          ? 'bg-emerald-950 text-emerald-300 border border-emerald-800'
                          : 'bg-slate-800 text-slate-400'
                      }`}>
                        {rec.status}
                      </span>
                    )}
                  </div>
                </div>

                {/* Section 6 Requirements: Frequency, Period, Supporting Evidence, Associated Incidents */}
                <div className="grid grid-cols-1 sm:grid-cols-4 gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs">
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Frequency & Time Period</span>
                    <strong className="text-white font-mono text-sm">{rec.occurrences} firings / 24h</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Known Associated Incidents</span>
                    <strong className="text-cyan-400 font-mono text-sm">{rec.incidentsCorrelated} incident(s)</strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Signal-to-Noise Ratio</span>
                    <strong className={`font-mono text-sm ${rec.correlationRate < 10 ? 'text-rose-400' : 'text-emerald-400'}`}>
                      {rec.correlationRate}% correlated
                    </strong>
                  </div>
                  <div>
                    <span className="text-slate-400 block text-[10px] uppercase font-semibold">Supporting Evidence</span>
                    <span className="text-slate-300 text-[11px] block mt-0.5">Rapid flap recovery within 60s window.</span>
                  </div>
                </div>

                {/* Uncertainty & Possible Consequences (Section 6 Requirement) */}
                <div className="p-3 rounded-lg bg-slate-950/60 border border-slate-800 text-xs space-y-1">
                  <span className="font-bold text-amber-400 uppercase tracking-wider text-[10px] block">
                    Uncertainty & Consequence Risk Assessment:
                  </span>
                  <p className="text-slate-300 text-[11px]">
                    Extending the evaluation window to 3m reduces flap noise, but may delay alert dispatch by up to 120s if a genuine continuous resource exhaustion condition develops.
                  </p>
                </div>

                {/* Suggested Action */}
                <div className="text-xs space-y-1">
                  <span className="font-semibold text-slate-300 uppercase tracking-wider text-[10px]">
                    Suggested Manual Review Action:
                  </span>
                  <p className="text-slate-200">
                    {rec.suggestedAction}
                  </p>
                </div>

                {/* Code Patch Snippet */}
                {rec.codePatchRecommendation && (
                  <div className="space-y-1.5 pt-1">
                    <div className="flex items-center justify-between text-xs text-slate-400">
                      <span className="flex items-center gap-1.5 font-mono text-[11px] text-cyan-300">
                        <Code2 className="w-3.5 h-3.5" />
                        <span>Proposed Configuration Patch (Manual SRE Review):</span>
                      </span>
                      <button
                        onClick={() => copyPatch(rec.codePatchRecommendation!, rec.id)}
                        className="flex items-center gap-1 text-[11px] text-slate-300 hover:text-white"
                      >
                        {copiedId === rec.id ? <Check className="w-3.5 h-3.5 text-emerald-400" /> : <Copy className="w-3.5 h-3.5" />}
                        <span>{copiedId === rec.id ? 'Copied' : 'Copy Patch'}</span>
                      </button>
                    </div>
                    <pre className="p-3 rounded-lg bg-slate-950 text-slate-300 font-mono text-[11px] overflow-x-auto border border-slate-800/80">
                      {rec.codePatchRecommendation}
                    </pre>
                  </div>
                )}
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
