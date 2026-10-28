import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Search, 
  Filter, 
  ArrowRight, 
  Clock, 
  CheckCircle2, 
  AlertTriangle,
  Layers,
  ChevronRight,
  Sparkles,
  RotateCcw,
  HelpCircle,
  Activity
} from 'lucide-react';
import { Incident } from '../types';
import { SERVICES_TOPOLOGY } from '../engine/topologyData';

interface IncidentListProps {
  incidents: Incident[];
  onSelectIncident: (incident: Incident) => void;
}

export const IncidentList: React.FC<IncidentListProps> = ({
  incidents,
  onSelectIncident,
}) => {
  const [search, setSearch] = useState('');
  const [severityFilter, setSeverityFilter] = useState<string>('ALL');
  const [statusFilter, setStatusFilter] = useState<string>('ALL');
  const [serviceFilter, setServiceFilter] = useState<string>('ALL');
  const [timeRangeFilter, setTimeRangeFilter] = useState<string>('ALL');
  const [confidenceFilter, setConfidenceFilter] = useState<string>('ALL');
  const [aiFilter, setAiFilter] = useState<string>('ALL');

  const resetFilters = () => {
    setSearch('');
    setSeverityFilter('ALL');
    setStatusFilter('ALL');
    setServiceFilter('ALL');
    setTimeRangeFilter('ALL');
    setConfidenceFilter('ALL');
    setAiFilter('ALL');
  };

  const filtered = incidents.filter(inc => {
    // 1. Severity filter
    if (severityFilter !== 'ALL' && inc.severity !== severityFilter) return false;

    // 2. Status filter
    if (statusFilter !== 'ALL' && inc.status !== statusFilter) return false;

    // 3. Affected service filter
    if (serviceFilter !== 'ALL') {
      const matchSvc = inc.blastRadius.affectedServices.includes(serviceFilter) || 
                       inc.rootCauseAnalysis.candidateServiceId === serviceFilter;
      if (!matchSvc) return false;
    }

    // 4. Time range filter
    if (timeRangeFilter !== 'ALL') {
      const incTime = new Date(inc.startTime).getTime();
      const now = Date.now();
      const diffMinutes = (now - incTime) / (1000 * 60);

      if (timeRangeFilter === '15m' && diffMinutes > 15) return false;
      if (timeRangeFilter === '1h' && diffMinutes > 60) return false;
      if (timeRangeFilter === '4h' && diffMinutes > 240) return false;
      if (timeRangeFilter === '24h' && diffMinutes > 1440) return false;
    }

    // 5. Correlation confidence / score range
    if (confidenceFilter !== 'ALL') {
      const score = inc.rootCauseAnalysis.confidenceScore;
      if (confidenceFilter === 'HIGH' && score < 0.8) return false;
      if (confidenceFilter === 'MEDIUM' && (score < 0.5 || score >= 0.8)) return false;
      if (confidenceFilter === 'LOW' && score >= 0.5) return false;
    }

    // 6. Presence of AI explanation
    if (aiFilter !== 'ALL') {
      const hasAi = Boolean(inc.aiSummary && inc.aiSummary.isFromGemini);
      if (aiFilter === 'AI_ONLY' && !hasAi) return false;
      if (aiFilter === 'DETERMINISTIC_ONLY' && hasAi) return false;
    }

    // 7. Text search query
    if (search.trim()) {
      const q = search.toLowerCase();
      const matchId = inc.id.toLowerCase().includes(q);
      const matchTitle = inc.title.toLowerCase().includes(q);
      const matchRoot = inc.rootCauseAnalysis.candidateServiceName.toLowerCase().includes(q);
      const matchSvc = inc.blastRadius.affectedServices.some(s => s.toLowerCase().includes(q));
      if (!matchId && !matchTitle && !matchRoot && !matchSvc) return false;
    }

    return true;
  });

  const hasActiveFilters = 
    severityFilter !== 'ALL' || 
    statusFilter !== 'ALL' || 
    serviceFilter !== 'ALL' || 
    timeRangeFilter !== 'ALL' || 
    confidenceFilter !== 'ALL' || 
    aiFilter !== 'ALL' || 
    search.trim() !== '';

  return (
    <div className="space-y-6">
      {/* Header and Search */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col sm:flex-row sm:items-center justify-between gap-4">
          <div>
            <h2 className="text-xl font-bold text-white tracking-tight">
              Incident Explorer
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Showing {filtered.length} of {incidents.length} correlated incident clusters across 70 microservices.
            </p>
          </div>

          <div className="flex items-center gap-2">
            {hasActiveFilters && (
              <button
                onClick={resetFilters}
                className="flex items-center gap-1.5 px-3 py-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 text-xs font-medium transition-colors border border-slate-700"
              >
                <RotateCcw className="w-3.5 h-3.5" />
                <span>Reset Filters</span>
              </button>
            )}
          </div>
        </div>

        {/* Search Input */}
        <div className="relative">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search by incident ID (e.g. INC-), title, root cause service, or affected microservice..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-4 py-2.5 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-sans"
          />
        </div>

        {/* Comprehensive Filters Bar (6 Dropdowns) */}
        <div className="grid grid-cols-2 sm:grid-cols-3 lg:grid-cols-6 gap-2 text-xs">
          {/* 1. Severity Filter */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Severity</label>
            <select
              value={severityFilter}
              onChange={e => setSeverityFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Severities</option>
              <option value="CRITICAL">Critical</option>
              <option value="HIGH">High</option>
              <option value="MEDIUM">Medium</option>
              <option value="LOW">Low</option>
            </select>
          </div>

          {/* 2. Status Filter */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Status</label>
            <select
              value={statusFilter}
              onChange={e => setStatusFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Statuses</option>
              <option value="OPEN">Open</option>
              <option value="INVESTIGATING">Investigating</option>
              <option value="MITIGATED">Mitigated</option>
              <option value="RESOLVED">Resolved</option>
            </select>
          </div>

          {/* 3. Affected Service Filter */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Affected Service</label>
            <select
              value={serviceFilter}
              onChange={e => setServiceFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer truncate"
            >
              <option value="ALL">All 70 Services</option>
              {SERVICES_TOPOLOGY.map(s => (
                <option key={s.id} value={s.id}>
                  {s.id} ({s.tierName.split(':')[0]})
                </option>
              ))}
            </select>
          </div>

          {/* 4. Time Range Filter */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Time Range</label>
            <select
              value={timeRangeFilter}
              onChange={e => setTimeRangeFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Time</option>
              <option value="15m">Last 15 minutes</option>
              <option value="1h">Last 1 hour</option>
              <option value="4h">Last 4 hours</option>
              <option value="24h">Last 24 hours</option>
            </select>
          </div>

          {/* 5. Correlation Confidence Range */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">Causal Confidence</label>
            <select
              value={confidenceFilter}
              onChange={e => setConfidenceFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Scores</option>
              <option value="HIGH">High (≥ 80%)</option>
              <option value="MEDIUM">Medium (50% - 79%)</option>
              <option value="LOW">Low (&lt; 50%)</option>
            </select>
          </div>

          {/* 6. AI Explanation Presence */}
          <div>
            <label className="text-[10px] text-slate-400 uppercase font-semibold block mb-1">AI Explanation</label>
            <select
              value={aiFilter}
              onChange={e => setAiFilter(e.target.value)}
              className="w-full bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg p-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
            >
              <option value="ALL">All Incidents</option>
              <option value="AI_ONLY">Gemini AI Enhanced</option>
              <option value="DETERMINISTIC_ONLY">Deterministic Only</option>
            </select>
          </div>
        </div>
      </div>

      {/* Incidents List */}
      <div className="space-y-3">
        {filtered.length === 0 ? (
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400">
            <CheckCircle2 className="w-10 h-10 text-emerald-400 mx-auto mb-3 opacity-80" />
            <h3 className="text-base font-semibold text-white">No Matching Incidents Found</h3>
            <p className="text-xs text-slate-400 mt-1">
              No incidents meet the current filter criteria. Try resetting filters or choosing another service.
            </p>
            <button
              onClick={resetFilters}
              className="mt-4 px-3 py-1.5 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-medium"
            >
              Clear All Filters
            </button>
          </div>
        ) : (
          filtered.map(incident => {
            const isCritical = incident.severity === 'CRITICAL';
            const isResolved = incident.status === 'RESOLVED';
            const hasGemini = Boolean(incident.aiSummary?.isFromGemini);

            return (
              <div
                key={incident.id}
                onClick={() => onSelectIncident(incident)}
                className="bg-slate-900 border border-slate-800 hover:border-slate-700 rounded-xl p-5 cursor-pointer transition-all hover:bg-slate-850/60 group shadow-sm"
              >
                <div className="flex flex-col lg:flex-row lg:items-center justify-between gap-4">
                  <div className="space-y-2 flex-1">
                    <div className="flex items-center gap-2.5 flex-wrap">
                      <span className={`px-2.5 py-0.5 rounded text-[11px] font-bold uppercase tracking-wider border ${
                        isCritical
                          ? 'bg-rose-950/90 text-rose-300 border-rose-800'
                          : incident.severity === 'HIGH'
                          ? 'bg-amber-950/90 text-amber-300 border-amber-800'
                          : 'bg-cyan-950/90 text-cyan-300 border-cyan-800'
                      }`}>
                        {incident.severity}
                      </span>
                      <span className={`px-2 py-0.5 rounded text-[10px] font-medium border ${
                        isResolved
                          ? 'bg-emerald-950 text-emerald-300 border-emerald-800'
                          : 'bg-slate-800 text-slate-300 border-slate-700'
                      }`}>
                        {incident.status}
                      </span>
                      <span className="text-xs font-mono text-slate-400">
                        {incident.id}
                      </span>
                      <span className="text-slate-600">•</span>
                      <span className="text-xs text-slate-400 flex items-center gap-1">
                        <Clock className="w-3.5 h-3.5 text-slate-500" />
                        Duration: {incident.durationSeconds}s
                      </span>
                      {hasGemini && (
                        <span className="flex items-center gap-1 text-[10px] px-2 py-0.5 rounded bg-indigo-950 text-indigo-300 border border-indigo-800 font-mono">
                          <Sparkles className="w-3 h-3 text-indigo-400" />
                          <span>Gemini SRE</span>
                        </span>
                      )}
                    </div>

                    <h3 className="text-base font-bold text-white group-hover:text-cyan-300 transition-colors">
                      {incident.title}
                    </h3>

                    {/* Blast Radius Affected Services Preview */}
                    <div className="flex items-center gap-2 flex-wrap text-xs text-slate-400">
                      <span className="font-semibold text-slate-300">
                        Blast Radius ({incident.blastRadius.serviceCount} services):
                      </span>
                      {incident.blastRadius.affectedServices.slice(0, 5).map(svc => (
                        <span key={svc} className="px-2 py-0.5 rounded bg-slate-800 text-slate-300 font-mono text-[11px]">
                          {svc}
                        </span>
                      ))}
                      {incident.blastRadius.affectedServices.length > 5 && (
                        <span className="text-slate-500 text-[11px]">
                          +{incident.blastRadius.affectedServices.length - 5} more
                        </span>
                      )}
                    </div>
                  </div>

                  {/* Right Column: Probable Origin & Action */}
                  <div className="flex lg:flex-col items-center lg:items-end justify-between border-t lg:border-t-0 pt-3 lg:pt-0 border-slate-800 text-right gap-2 shrink-0">
                    <div>
                      <span className="text-xs text-slate-400 font-mono block">
                        Origin: <strong className="text-amber-300 font-semibold">{incident.rootCauseAnalysis.candidateServiceName}</strong>
                      </span>
                      <span className="text-[11px] text-slate-400 font-mono block">
                        Confidence: {(incident.rootCauseAnalysis.confidenceScore * 100).toFixed(0)}% • {incident.rawAlertCount} alerts ({incident.dedupAlertCount} unique)
                      </span>
                    </div>

                    <span className="text-cyan-400 font-medium group-hover:translate-x-0.5 transition-transform flex items-center gap-1 text-xs">
                      Investigate <ArrowRight className="w-3.5 h-3.5" />
                    </span>
                  </div>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
};
