import React, { useState, useEffect } from 'react';
import { 
  Radio, 
  Search, 
  Filter, 
  Layers, 
  Plus, 
  Clock, 
  ShieldAlert, 
  RotateCw,
  X,
  Check
} from 'lucide-react';
import { Alert, MonitorSource, AlertSeverity } from '../types';
import { fetchAlerts } from '../api/client';
import { SERVICES_TOPOLOGY } from '../engine/topologyData';

interface AlertStreamViewProps {
  onAlertIngested?: () => void;
}

export const AlertStreamView: React.FC<AlertStreamViewProps> = ({ onAlertIngested }) => {
  const [alerts, setAlerts] = useState<Alert[]>([]);
  const [loading, setLoading] = useState(false);
  const [search, setSearch] = useState('');
  const [serviceFilter, setServiceFilter] = useState('ALL');
  const [severityFilter, setSeverityFilter] = useState('ALL');
  const [monitorFilter, setMonitorFilter] = useState<string>('ALL');
  const [showDedupOnly, setShowDedupOnly] = useState(true);
  const [isModalOpen, setIsModalOpen] = useState(false);

  // Custom alert form
  const [formService, setFormService] = useState('checkout-service');
  const [formSeverity, setFormSeverity] = useState<AlertSeverity>('HIGH');
  const [formTitle, setFormTitle] = useState('Elevated P99 Latency on /api/v2/checkout');
  const [formMetric, setFormMetric] = useState('http.request.p99_latency_ms');
  const [formValue, setFormValue] = useState(3200);
  const [formThreshold, setFormThreshold] = useState(500);

  const loadAlerts = async () => {
    setLoading(true);
    const data = await fetchAlerts({
      serviceId: serviceFilter !== 'ALL' ? serviceFilter : undefined,
      severity: severityFilter !== 'ALL' ? severityFilter : undefined,
      search: search.trim() ? search : undefined,
      limit: 250,
    });
    setAlerts(data.alerts);
    setLoading(false);
  };

  useEffect(() => {
    loadAlerts();
  }, [serviceFilter, severityFilter, search]);

  const handleCustomIngest = async (e: React.FormEvent) => {
    e.preventDefault();
    try {
      await fetch('/api/alerts/ingest', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          serviceId: formService,
          severity: formSeverity,
          title: formTitle,
          metricName: formMetric,
          metricValue: Number(formValue),
          threshold: Number(formThreshold),
          sourceMonitor: 'prometheus',
        }),
      });
      setIsModalOpen(false);
      loadAlerts();
      if (onAlertIngested) onAlertIngested();
    } catch (err) {
      console.error('Ingest error:', err);
    }
  };

  const filteredAlerts = alerts.filter(a => {
    if (monitorFilter !== 'ALL' && a.sourceMonitor !== monitorFilter) return false;
    return true;
  });

  return (
    <div className="space-y-6">
      {/* Stream Controls Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search incoming alerts by keyword or metric..."
            value={search}
            onChange={e => setSearch(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500"
          />
        </div>

        {/* Filters */}
        <div className="flex items-center gap-2.5 flex-wrap">
          {/* Service Filter */}
          <select
            value={serviceFilter}
            onChange={e => setServiceFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer max-w-[150px] truncate"
          >
            <option value="ALL">All Services</option>
            {SERVICES_TOPOLOGY.map(s => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>

          {/* Severity Filter */}
          <select
            value={severityFilter}
            onChange={e => setSeverityFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
          >
            <option value="ALL">All Severities</option>
            <option value="CRITICAL">Critical</option>
            <option value="HIGH">High</option>
            <option value="MEDIUM">Medium</option>
            <option value="LOW">Low</option>
          </select>

          {/* Monitor Filter */}
          <select
            value={monitorFilter}
            onChange={e => setMonitorFilter(e.target.value)}
            className="bg-slate-950 border border-slate-700 text-xs text-slate-200 rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer"
          >
            <option value="ALL">All Monitors</option>
            <option value="prometheus">Prometheus</option>
            <option value="datadog">Datadog</option>
            <option value="cloudwatch">CloudWatch</option>
            <option value="sentry">Sentry</option>
            <option value="kafka-lag">Kafka Lag</option>
          </select>

          <button
            onClick={() => setIsModalOpen(true)}
            className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-indigo-600 hover:bg-indigo-500 text-white text-xs font-semibold shadow-sm transition-colors"
          >
            <Plus className="w-3.5 h-3.5" />
            <span>Simulate Ingest</span>
          </button>
        </div>
      </div>

      {/* Alert Stream Table */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
        <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs">
          <div className="flex items-center gap-2">
            <Radio className="w-4 h-4 text-emerald-400 animate-pulse" />
            <span className="font-bold text-slate-200 uppercase tracking-wider">
              Ingested Alert Log ({filteredAlerts.length} records)
            </span>
          </div>

          <button
            onClick={loadAlerts}
            className="text-slate-400 hover:text-white flex items-center gap-1"
          >
            <RotateCw className={`w-3.5 h-3.5 ${loading ? 'animate-spin' : ''}`} />
            <span>Refresh</span>
          </button>
        </div>

        <div className="overflow-x-auto">
          <table className="w-full text-left text-xs">
            <thead className="bg-slate-950 text-slate-400 uppercase font-semibold border-b border-slate-800">
              <tr>
                <th className="p-3">Severity</th>
                <th className="p-3">Timestamp</th>
                <th className="p-3">Service</th>
                <th className="p-3">Alert Title</th>
                <th className="p-3">Metric & Threshold</th>
                <th className="p-3">Monitor Source</th>
                <th className="p-3">Deduplication</th>
              </tr>
            </thead>
            <tbody className="divide-y divide-slate-800">
              {filteredAlerts.map(alert => (
                <tr key={alert.id} className="hover:bg-slate-800/40">
                  <td className="p-3">
                    <span className={`px-2 py-0.5 rounded font-bold text-[10px] ${
                      alert.severity === 'CRITICAL'
                        ? 'bg-rose-950 text-rose-300'
                        : alert.severity === 'HIGH'
                        ? 'bg-amber-950 text-amber-300'
                        : 'bg-cyan-950 text-cyan-300'
                    }`}>
                      {alert.severity}
                    </span>
                  </td>
                  <td className="p-3 font-mono text-slate-400 text-[11px] whitespace-nowrap">
                    {new Date(alert.timestamp).toLocaleTimeString()}
                  </td>
                  <td className="p-3 font-semibold text-white">
                    {alert.serviceName}
                    <span className="block font-mono text-[10px] text-slate-400">
                      {alert.serviceId}
                    </span>
                  </td>
                  <td className="p-3 text-slate-200 max-w-sm">
                    {alert.title}
                  </td>
                  <td className="p-3 font-mono text-slate-300">
                    <span className="text-amber-300 font-semibold">{alert.metricValue}</span> / {alert.threshold}
                    <span className="block text-[10px] text-slate-400">{alert.metricName}</span>
                  </td>
                  <td className="p-3 uppercase font-mono text-[10px] text-slate-400">
                    {alert.sourceMonitor}
                  </td>
                  <td className="p-3">
                    {alert.dedupCount > 1 ? (
                      <span className="px-2 py-0.5 rounded bg-slate-950 text-cyan-400 font-mono text-[11px] font-bold border border-slate-800">
                        {alert.dedupCount}x merged
                      </span>
                    ) : (
                      <span className="text-slate-400 text-[10px]">1st event</span>
                    )}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Ingest Modal */}
      {isModalOpen && (
        <div className="fixed inset-0 z-50 bg-slate-950/80 backdrop-blur-sm flex items-center justify-center p-4">
          <div className="bg-slate-900 border border-slate-700 rounded-xl p-6 w-full max-w-lg space-y-4 shadow-2xl">
            <div className="flex items-center justify-between">
              <h3 className="text-base font-bold text-white flex items-center gap-2">
                <Plus className="w-4 h-4 text-cyan-400" />
                <span>Simulate Custom Alert Ingestion</span>
              </h3>
              <button onClick={() => setIsModalOpen(false)} className="text-slate-400 hover:text-white">
                <X className="w-5 h-5" />
              </button>
            </div>

            <form onSubmit={handleCustomIngest} className="space-y-4 text-xs">
              <div>
                <label className="block text-slate-300 font-medium mb-1">Target Service</label>
                <select
                  value={formService}
                  onChange={e => setFormService(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2"
                >
                  {SERVICES_TOPOLOGY.map(s => (
                    <option key={s.id} value={s.id}>{s.name} ({s.id})</option>
                  ))}
                </select>
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Severity</label>
                  <select
                    value={formSeverity}
                    onChange={e => setFormSeverity(e.target.value as AlertSeverity)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2"
                  >
                    <option value="CRITICAL">CRITICAL</option>
                    <option value="HIGH">HIGH</option>
                    <option value="MEDIUM">MEDIUM</option>
                    <option value="LOW">LOW</option>
                  </select>
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Metric Name</label>
                  <input
                    type="text"
                    value={formMetric}
                    onChange={e => setFormMetric(e.target.value)}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div>
                <label className="block text-slate-300 font-medium mb-1">Alert Title</label>
                <input
                  type="text"
                  value={formTitle}
                  onChange={e => setFormTitle(e.target.value)}
                  className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2"
                />
              </div>

              <div className="grid grid-cols-2 gap-3">
                <div>
                  <label className="block text-slate-300 font-medium mb-1">Metric Value</label>
                  <input
                    type="number"
                    value={formValue}
                    onChange={e => setFormValue(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>

                <div>
                  <label className="block text-slate-300 font-medium mb-1">Threshold</label>
                  <input
                    type="number"
                    value={formThreshold}
                    onChange={e => setFormThreshold(Number(e.target.value))}
                    className="w-full bg-slate-950 border border-slate-700 text-slate-200 rounded-lg p-2 font-mono"
                  />
                </div>
              </div>

              <div className="pt-2 flex justify-end gap-2">
                <button
                  type="button"
                  onClick={() => setIsModalOpen(false)}
                  className="px-4 py-2 rounded-lg bg-slate-800 text-slate-300 hover:bg-slate-700"
                >
                  Cancel
                </button>
                <button
                  type="submit"
                  className="px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold shadow-md"
                >
                  Ingest Alert
                </button>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
};
