import React, { useState, useEffect } from 'react';
import { 
  FileText, 
  Download, 
  Settings, 
  CheckCircle2, 
  ShieldCheck, 
  Clock, 
  Search, 
  RotateCw,
  Layers,
  Database,
  Sparkles,
  GitCommit,
  UserCheck
} from 'lucide-react';
import { fetchAuditLog, fetchSystemSettings } from '../api/client';
import { AuditEvent, ReviewerFeedback, SystemSettings } from '../types';

export const AuditSettingsView: React.FC = () => {
  const [auditEvents, setAuditEvents] = useState<AuditEvent[]>([]);
  const [feedbackList, setFeedbackList] = useState<ReviewerFeedback[]>([]);
  const [settings, setSettings] = useState<SystemSettings | null>(null);
  const [loading, setLoading] = useState<boolean>(true);
  const [search, setSearch] = useState<string>('');
  const [typeFilter, setTypeFilter] = useState<string>('ALL');

  const loadData = async () => {
    setLoading(true);
    const [auditRes, settRes] = await Promise.all([
      fetchAuditLog(),
      fetchSystemSettings(),
    ]);
    setAuditEvents(auditRes.auditLog || []);
    setFeedbackList(auditRes.feedback || []);
    setSettings(settRes);
    setLoading(false);
  };

  useEffect(() => {
    loadData();
  }, []);

  const handleDownloadExport = (endpoint: string, filename: string) => {
    const a = document.createElement('a');
    a.href = endpoint;
    a.download = filename;
    a.click();
  };

  const filteredEvents = auditEvents.filter(ev => {
    if (typeFilter !== 'ALL' && ev.type !== typeFilter) return false;
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchActor = ev.actor.toLowerCase().includes(q);
      const matchTarget = ev.targetId.toLowerCase().includes(q);
      const matchType = ev.type.toLowerCase().includes(q);
      const matchDetails = JSON.stringify(ev.details).toLowerCase().includes(q);
      if (!matchActor && !matchTarget && !matchType && !matchDetails) return false;
    }
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Header Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-800">
                Governance & Compliance
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Immutable Audit Trail & Reproducible Data Exports
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              Audit Log, Platform Configuration & Data Exports
            </h2>
            <p className="text-xs text-slate-400 mt-0.5 max-w-2xl">
              Preserves grouping decisions, human feedback submissions, correlation thresholds, evaluation metadata, and one-click JSON/CSV exports.
            </p>
          </div>

          <button
            onClick={loadData}
            disabled={loading}
            className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-semibold border border-slate-700 transition-colors"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh Audit Trail</span>
          </button>
        </div>
      </div>

      {/* 1. System Settings & Active Engine Parameters (Section 7 Requirement) */}
      {settings && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
          <div className="flex items-center justify-between border-b border-slate-800 pb-2">
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
              <Settings className="w-4 h-4 text-cyan-400" />
              <span>Active Engine Configuration & Hyperparameters</span>
            </h3>
            <span className="text-xs font-mono text-cyan-300">
              Version: {settings.engineVersion}
            </span>
          </div>

          <div className="grid grid-cols-2 sm:grid-cols-4 gap-3 text-xs font-mono">
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">PRNG Dataset Seed</span>
              <strong className="text-white text-sm">{settings.datasetSeed}</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Deterministic generator</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Correlation Window</span>
              <strong className="text-white text-sm">{settings.timeWindowSeconds}s</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Sliding window bound</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Cluster Diameter</span>
              <strong className="text-white text-sm">≤ {settings.maxClusterDiameter} hops</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">False merge safeguard</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Link Density Floor</span>
              <strong className="text-white text-sm">≥ {settings.linkDensityThreshold}</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Minimum edge connectivity</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Model Config</span>
              <strong className="text-indigo-300 text-sm">{settings.modelName}</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Gemini explanation layer</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Active Split</span>
              <strong className="text-cyan-300 text-sm uppercase">{settings.activeSplit}</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Held-out scenario split</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Late-Arrival SLA</span>
              <strong className="text-amber-300 text-sm">{settings.lateArrivalWindowSeconds}s</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Retro-correlation window</span>
            </div>
            <div className="bg-slate-950 p-3 rounded-lg border border-slate-800">
              <span className="text-slate-500 text-[10px] uppercase font-semibold block">Monitored Services</span>
              <strong className="text-emerald-400 text-sm">70 Services</strong>
              <span className="text-slate-500 text-[10px] block mt-0.5">Full topology coverage</span>
            </div>
          </div>
        </div>
      )}

      {/* 2. One-Click Valid Data Export Hub (Section 7 Requirement) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4 shadow-sm">
        <div className="flex items-center justify-between border-b border-slate-800 pb-2">
          <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider flex items-center gap-2">
            <Download className="w-4 h-4 text-emerald-400" />
            <span>Traceable Data Exports (JSON & CSV)</span>
          </h3>
          <span className="text-xs text-slate-400">
            Preserves IDs, timestamps, and causal evidence
          </span>
        </div>

        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-4 gap-3 text-xs">
          {/* Export 1: Incidents */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Correlated Incidents</span>
              <span className="text-[10px] font-mono text-cyan-400">Live State</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Includes Root Cause service, confidence, duration, blast radius, and alert IDs.
            </p>
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => handleDownloadExport('/api/exports/incidents?format=csv', 'acuity-incidents.csv')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-center transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleDownloadExport('/api/exports/incidents?format=json', 'acuity-incidents.json')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-center transition-colors"
              >
                JSON
              </button>
            </div>
          </div>

          {/* Export 2: Raw & Canonical Alerts */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Validated Alerts</span>
              <span className="text-[10px] font-mono text-cyan-400">Telemetry</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Includes original IDs, fingerprints, masked tokens, metrics, and deduplication counts.
            </p>
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => handleDownloadExport('/api/exports/alerts?format=csv', 'acuity-alerts.csv')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-center transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleDownloadExport('/api/exports/alerts?format=json', 'acuity-alerts.json')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-center transition-colors"
              >
                JSON
              </button>
            </div>
          </div>

          {/* Export 3: Audit Trail */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Audit Trail Events</span>
              <span className="text-[10px] font-mono text-cyan-400">{auditEvents.length} Events</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Full log of reviewer feedback, status changes, and engine parameter updates.
            </p>
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => handleDownloadExport('/api/exports/audit?format=csv', 'acuity-audit.csv')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-center transition-colors"
              >
                CSV
              </button>
              <button
                onClick={() => handleDownloadExport('/api/exports/audit?format=json', 'acuity-audit.json')}
                className="flex-1 px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-indigo-300 font-semibold text-center transition-colors"
              >
                JSON
              </button>
            </div>
          </div>

          {/* Export 4: Replay Run Trace */}
          <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 space-y-2">
            <div className="flex items-center justify-between">
              <span className="font-bold text-white">Benchmark Report</span>
              <span className="text-[10px] font-mono text-cyan-400">Evaluation</span>
            </div>
            <p className="text-[11px] text-slate-400">
              Precision, Recall, F1, False Merges, and 4-baseline comparative metrics scorecard.
            </p>
            <div className="pt-2 flex items-center gap-2">
              <button
                onClick={() => handleDownloadExport('/api/baselines?split=test&size=600', 'acuity-benchmarks-test.json')}
                className="w-full px-2.5 py-1.5 rounded bg-slate-800 hover:bg-slate-700 text-slate-200 font-semibold text-center transition-colors"
              >
                Download Evaluation Scorecard
              </button>
            </div>
          </div>
        </div>
      </div>

      {/* 3. Immutable Audit Trail Table (Section 7 Requirement) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm space-y-3 p-5">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-3 pb-3 border-b border-slate-800">
          <div className="flex items-center gap-2">
            <ShieldCheck className="w-4 h-4 text-cyan-400" />
            <h3 className="text-xs font-bold text-slate-200 uppercase tracking-wider">
              Immutable Platform Audit Log ({filteredEvents.length} events)
            </h3>
          </div>

          {/* Search and Type Filter */}
          <div className="flex items-center gap-2">
            <div className="relative">
              <Search className="w-3.5 h-3.5 text-slate-500 absolute left-2.5 top-1/2 -translate-y-1/2" />
              <input
                type="text"
                placeholder="Search audit events..."
                value={search}
                onChange={e => setSearch(e.target.value)}
                className="bg-slate-950 border border-slate-700 text-xs text-white rounded-lg pl-8 pr-3 py-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500"
              />
            </div>

            <select
              value={typeFilter}
              onChange={e => setTypeFilter(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-1.5 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Event Types</option>
              <option value="FEEDBACK_SUBMITTED">Feedback Submitted</option>
              <option value="STATUS_CHANGED">Status Changed</option>
              <option value="CONFIG_CHANGED">Config Changed</option>
              <option value="EVALUATION_RUN">Evaluation Run</option>
            </select>
          </div>
        </div>

        {/* Audit Log Table */}
        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Type</th>
                <th className="p-3">Actor</th>
                <th className="p-3">Target ID</th>
                <th className="p-3">Audit Details</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800 font-mono">
              {filteredEvents.length === 0 ? (
                <tr>
                  <td colSpan={5} className="p-6 text-center text-slate-500 font-sans">
                    No matching audit events found.
                  </td>
                </tr>
              ) : (
                filteredEvents.map(ev => (
                  <tr key={ev.id} className="hover:bg-slate-800/40">
                    <td className="p-3 text-slate-400 whitespace-nowrap">
                      {new Date(ev.timestamp).toLocaleString()}
                    </td>
                    <td className="p-3">
                      <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                        ev.type === 'FEEDBACK_SUBMITTED'
                          ? 'bg-amber-950 text-amber-300 border border-amber-800'
                          : ev.type === 'CONFIG_CHANGED'
                          ? 'bg-indigo-950 text-indigo-300 border border-indigo-800'
                          : 'bg-cyan-950 text-cyan-300 border border-cyan-800'
                      }`}>
                        {ev.type}
                      </span>
                    </td>
                    <td className="p-3 text-white font-semibold">{ev.actor}</td>
                    <td className="p-3 text-cyan-300">{ev.targetId}</td>
                    <td className="p-3 text-slate-400 text-[11px] font-sans max-w-md truncate" title={JSON.stringify(ev.details)}>
                      {JSON.stringify(ev.details)}
                    </td>
                  </tr>
                ))
              )}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
};
