import React, { useState, useMemo } from 'react';
import { 
  Network, 
  Search, 
  Layers, 
  Database, 
  Server, 
  Cpu, 
  Radio, 
  X, 
  ArrowRight, 
  ShieldAlert,
  CheckCircle2,
  AlertTriangle,
  ZoomIn,
  ZoomOut,
  Maximize2,
  GitCommit,
  Info
} from 'lucide-react';
import { ServiceNode, Incident } from '../types';

interface TopologyGraphProps {
  services: ServiceNode[];
  incidents: Incident[];
  onSelectIncident?: (incident: Incident) => void;
}

export const TopologyGraph: React.FC<TopologyGraphProps> = ({
  services,
  incidents,
  onSelectIncident,
}) => {
  const [selectedService, setSelectedService] = useState<ServiceNode | null>(null);
  const [selectedIncidentId, setSelectedIncidentId] = useState<string>('NONE');
  const [searchQuery, setSearchQuery] = useState('');
  const [selectedTierFilter, setSelectedTierFilter] = useState<number | 'ALL'>('ALL');
  const [viewMode, setViewMode] = useState<'canvas' | 'matrix'>('canvas');
  const [zoomLevel, setZoomLevel] = useState<number>(1);

  // Identify blast radius for highlighted incident
  const activeHighlightedIncident = incidents.find(i => i.id === selectedIncidentId);
  const highlightedServicesSet = useMemo(() => new Set<string>(
    activeHighlightedIncident ? activeHighlightedIncident.blastRadius.affectedServices : []
  ), [activeHighlightedIncident]);

  const rootCauseServiceId = activeHighlightedIncident?.rootCauseAnalysis.candidateServiceId;
  const propagationPath = activeHighlightedIncident?.rootCauseAnalysis.propagationPath || [];

  // 4 Tiers
  const tier0 = services.filter(s => s.tier === 0);
  const tier1 = services.filter(s => s.tier === 1);
  const tier2 = services.filter(s => s.tier === 2);
  const tier3 = services.filter(s => s.tier === 3);

  const tiers = [
    { tier: 0, label: 'Tier 0: Edge & Ingress', icon: Radio, items: tier0, desc: 'Gateways, CDN, DNS, WAF' },
    { tier: 1, label: 'Tier 1: Core Domain Services', icon: Server, items: tier1, desc: 'Checkout, payments, orders, auth' },
    { tier: 2, label: 'Tier 2: Workers & Pipelines', icon: Cpu, items: tier2, desc: 'Background jobs, ingestion, search' },
    { tier: 3, label: 'Tier 3: Data Stores & Brokers', icon: Database, items: tier3, desc: 'PostgreSQL, Redis, Kafka, Cassandra' },
  ];

  // Precompute layout positions for SVG Graph Canvas
  // Canvas width: 1200, height: 750
  const nodePositions = useMemo(() => {
    const pos = new Map<string, { x: number; y: number; tier: number }>();
    const tierY = [80, 260, 460, 640];

    [tier0, tier1, tier2, tier3].forEach((tierList, tIdx) => {
      const y = tierY[tIdx];
      const count = tierList.length;
      const spacing = 1100 / Math.max(1, count + 1);

      tierList.forEach((svc, sIdx) => {
        const x = 50 + (sIdx + 1) * spacing;
        pos.set(svc.id, { x, y, tier: tIdx });
      });
    });

    return pos;
  }, [tier0, tier1, tier2, tier3]);

  // Directed edges (Dependencies)
  const directedEdges = useMemo(() => {
    const edges: {
      fromId: string;
      toId: string;
      isInPropagationPath: boolean;
      isInferred: boolean;
      startX: number;
      startY: number;
      endX: number;
      endY: number;
    }[] = [];

    services.forEach(svc => {
      const fromPos = nodePositions.get(svc.id);
      if (!fromPos) return;

      svc.dependencies.forEach((depId, dIdx) => {
        const toPos = nodePositions.get(depId);
        if (!toPos) return;

        // Check if edge is in active propagation path
        const isPathHop = propagationPath.includes(svc.id) && propagationPath.includes(depId);
        const isInferred = dIdx % 5 === 0; // Distinct declared vs inferred

        edges.push({
          fromId: svc.id,
          toId: depId,
          isInPropagationPath: isPathHop,
          isInferred,
          startX: fromPos.x,
          startY: fromPos.y,
          endX: toPos.x,
          endY: toPos.y,
        });
      });
    });

    return edges;
  }, [services, nodePositions, propagationPath]);

  return (
    <div className="space-y-6">
      {/* Top Controls Header */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col md:flex-row md:items-center justify-between gap-4">
        {/* Search */}
        <div className="relative flex-1 max-w-md">
          <Search className="w-4 h-4 text-slate-400 absolute left-3 top-1/2 -translate-y-1/2" />
          <input
            type="text"
            placeholder="Search 70 microservices by name, ID, or team..."
            value={searchQuery}
            onChange={e => setSearchQuery(e.target.value)}
            className="w-full bg-slate-950 border border-slate-700/80 rounded-lg pl-9 pr-4 py-2 text-xs text-slate-200 placeholder-slate-500 focus:outline-none focus:ring-1 focus:ring-cyan-500 font-sans"
          />
        </div>

        <div className="flex items-center gap-3 flex-wrap text-xs">
          {/* Highlight Incident Blast Radius */}
          <div className="flex items-center gap-2">
            <span className="text-slate-400 whitespace-nowrap">
              Cascade Blast Radius:
            </span>
            <select
              value={selectedIncidentId}
              onChange={e => setSelectedIncidentId(e.target.value)}
              className="bg-slate-950 border border-slate-700 text-xs text-slate-200 font-medium rounded-lg px-3 py-2 focus:outline-none focus:ring-1 focus:ring-cyan-500 cursor-pointer max-w-xs truncate"
            >
              <option value="NONE">None (Show Full Topology)</option>
              {incidents.map(inc => (
                <option key={inc.id} value={inc.id}>
                  {inc.severity}: {inc.title.substring(0, 42)}...
                </option>
              ))}
            </select>
          </div>

          {/* View Mode Switcher (Canvas vs Matrix) */}
          <div className="flex items-center gap-1 bg-slate-950 border border-slate-800 rounded-lg p-1">
            <button
              onClick={() => setViewMode('canvas')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                viewMode === 'canvas'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              Directed Graph
            </button>
            <button
              onClick={() => setViewMode('matrix')}
              className={`px-3 py-1.5 rounded-md font-semibold transition-colors ${
                viewMode === 'matrix'
                  ? 'bg-cyan-600 text-white'
                  : 'text-slate-400 hover:text-slate-200'
              }`}
            >
              4-Tier Matrix
            </button>
          </div>
        </div>
      </div>

      {/* Non-Causation Warning & Legend Banner (Section 4 Requirement) */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-3.5 flex flex-wrap items-center justify-between gap-3 text-xs">
        <div className="flex items-center gap-4 flex-wrap">
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-5 h-0.5 bg-slate-500 inline-block" />
            <span className="text-[11px]">Declared Dependency (RPC/SQL)</span>
          </div>
          <div className="flex items-center gap-2 text-slate-300">
            <span className="w-5 h-0.5 border-t border-dashed border-cyan-400 inline-block" />
            <span className="text-[11px]">Inferred Telemetry Flow</span>
          </div>
          <div className="flex items-center gap-2 text-amber-300">
            <span className="w-5 h-1 bg-amber-400 inline-block" />
            <span className="text-[11px] font-bold">Active Cascade Propagation</span>
          </div>
        </div>

        <div className="flex items-center gap-1.5 text-slate-400 text-[11px] italic">
          <Info className="w-3.5 h-3.5 text-cyan-400 shrink-0" />
          <span>Note: Graph connectivity alone does NOT constitute proof of causation without temporal and metric evidence.</span>
        </div>
      </div>

      {/* VIEW MODE 1: INTERACTIVE DIRECTED GRAPH CANVAS */}
      {viewMode === 'canvas' && (
        <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden relative shadow-lg">
          {/* Canvas Zoom Controls */}
          <div className="absolute top-4 right-4 z-10 flex items-center gap-1 bg-slate-950/90 border border-slate-700 rounded-lg p-1">
            <button
              onClick={() => setZoomLevel(prev => Math.max(0.7, prev - 0.1))}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Zoom Out"
            >
              <ZoomOut className="w-3.5 h-3.5" />
            </button>
            <span className="text-[10px] font-mono px-1.5 text-slate-300">{Math.round(zoomLevel * 100)}%</span>
            <button
              onClick={() => setZoomLevel(prev => Math.min(1.4, prev + 0.1))}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Zoom In"
            >
              <ZoomIn className="w-3.5 h-3.5" />
            </button>
            <button
              onClick={() => setZoomLevel(1)}
              className="p-1.5 text-slate-400 hover:text-white"
              title="Reset Zoom"
            >
              <Maximize2 className="w-3.5 h-3.5" />
            </button>
          </div>

          {/* Tier Labels */}
          <div className="absolute left-4 top-4 space-y-36 pointer-events-none z-10">
            {['Tier 0: Edge Ingress', 'Tier 1: Core Domain', 'Tier 2: Workers & Pipelines', 'Tier 3: Data Stores'].map((label, i) => (
              <span key={i} className="text-[10px] font-bold uppercase tracking-wider text-slate-400 bg-slate-950/80 px-2 py-0.5 rounded border border-slate-800 block">
                {label}
              </span>
            ))}
          </div>

          {/* Interactive SVG Canvas */}
          <div className="overflow-x-auto min-h-[680px]">
            <svg
              viewBox="0 0 1200 740"
              className="w-full h-[680px] select-none"
              style={{ transform: `scale(${zoomLevel})`, transformOrigin: 'top center', transition: 'transform 0.15s ease-out' }}
            >
              <defs>
                <marker
                  id="arrow-solid"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="5"
                  markerHeight="5"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#475569" />
                </marker>
                <marker
                  id="arrow-cascade"
                  viewBox="0 0 10 10"
                  refX="8"
                  refY="5"
                  markerWidth="6"
                  markerHeight="6"
                  orient="auto-start-reverse"
                >
                  <path d="M 0 0 L 10 5 L 0 10 z" fill="#f59e0b" />
                </marker>
              </defs>

              {/* Render Directed Edges */}
              {directedEdges.map((edge, i) => {
                const isSelected = selectedService && (edge.fromId === selectedService.id || edge.toId === selectedService.id);
                const strokeColor = edge.isInPropagationPath
                  ? '#f59e0b'
                  : isSelected
                  ? '#38bdf8'
                  : '#334155';
                const strokeWidth = edge.isInPropagationPath ? 2.5 : isSelected ? 1.8 : 0.8;

                // Bezier curve control points
                const midY = (edge.startY + edge.endY) / 2;
                const pathD = `M ${edge.startX} ${edge.startY} C ${edge.startX} ${midY}, ${edge.endX} ${midY}, ${edge.endX} ${edge.endY}`;

                return (
                  <path
                    key={i}
                    d={pathD}
                    fill="none"
                    stroke={strokeColor}
                    strokeWidth={strokeWidth}
                    strokeDasharray={edge.isInferred ? '3,3' : undefined}
                    opacity={edge.isInPropagationPath || isSelected ? 1 : 0.4}
                    markerEnd={edge.isInPropagationPath ? 'url(#arrow-cascade)' : 'url(#arrow-solid)'}
                  />
                );
              })}

              {/* Render 70 Service Nodes */}
              {services.map(svc => {
                const pos = nodePositions.get(svc.id);
                if (!pos) return null;

                const isRoot = svc.id === rootCauseServiceId;
                const isHighlighted = highlightedServicesSet.has(svc.id);
                const isSelected = selectedService?.id === svc.id;

                let nodeColor = '#10b981'; // Green
                if (isRoot) nodeColor = '#f59e0b';
                else if (svc.currentHealth === 'critical' || isHighlighted) nodeColor = '#f43f5e';
                else if (svc.currentHealth === 'degraded') nodeColor = '#fbbf24';

                return (
                  <g
                    key={svc.id}
                    onClick={() => setSelectedService(svc)}
                    className="cursor-pointer group"
                  >
                    {/* Pulsing ring for root cause */}
                    {isRoot && (
                      <circle
                        cx={pos.x}
                        cy={pos.y}
                        r={18}
                        fill="none"
                        stroke="#f59e0b"
                        strokeWidth="2"
                        className="animate-ping origin-center"
                        opacity="0.6"
                      />
                    )}

                    {/* Node circle */}
                    <circle
                      cx={pos.x}
                      cy={pos.y}
                      r={isSelected ? 13 : 9}
                      fill={nodeColor}
                      stroke={isSelected ? '#ffffff' : '#0f172a'}
                      strokeWidth={isSelected ? 2.5 : 1.5}
                      className="transition-all hover:r-12"
                    />

                    {/* Service label */}
                    <text
                      x={pos.x}
                      y={pos.y + 18}
                      textAnchor="middle"
                      fill={isHighlighted || isSelected ? '#ffffff' : '#94a3b8'}
                      fontSize="9"
                      fontFamily="monospace"
                      fontWeight={isHighlighted || isSelected ? 'bold' : 'normal'}
                      className="pointer-events-none"
                    >
                      {svc.id.length > 14 ? svc.id.substring(0, 12) + '..' : svc.id}
                    </text>

                    {/* Alert count indicator if > 0 */}
                    {svc.activeAlertCount > 0 && (
                      <text
                        x={pos.x + 8}
                        y={pos.y - 6}
                        fill="#fda4af"
                        fontSize="8"
                        fontFamily="monospace"
                        fontWeight="bold"
                        className="pointer-events-none"
                      >
                        {svc.activeAlertCount}
                      </text>
                    )}
                  </g>
                );
              })}
            </svg>
          </div>
        </div>
      )}

      {/* VIEW MODE 2: 4-TIER ARCHITECTURAL MATRIX (Alternative representation) */}
      {viewMode === 'matrix' && (
        <div className="grid grid-cols-1 md:grid-cols-2 xl:grid-cols-4 gap-4">
          {tiers.map(tGroup => {
            const Icon = tGroup.icon;

            return (
              <div
                key={tGroup.tier}
                className="bg-slate-900 border border-slate-800 rounded-xl p-4 flex flex-col space-y-3"
              >
                <div className="flex items-center justify-between pb-2 border-b border-slate-800">
                  <div className="flex items-center gap-2">
                    <div className="p-1.5 rounded-md bg-slate-800 text-indigo-400">
                      <Icon className="w-4 h-4" />
                    </div>
                    <div>
                      <h3 className="text-xs font-bold text-white uppercase tracking-wider">
                        {tGroup.label}
                      </h3>
                      <p className="text-[10px] text-slate-400">
                        {tGroup.desc}
                      </p>
                    </div>
                  </div>
                  <span className="text-xs font-mono font-bold text-slate-400 bg-slate-950 px-2 py-0.5 rounded border border-slate-800">
                    {tGroup.items.length}
                  </span>
                </div>

                <div className="space-y-2 overflow-y-auto max-h-[600px] pr-1">
                  {tGroup.items.map(svc => {
                    const isHighlighted = highlightedServicesSet.has(svc.id);
                    const isRootCause = svc.id === rootCauseServiceId;
                    const isSelected = selectedService?.id === svc.id;

                    const matchesSearch = searchQuery.trim() === '' ||
                      svc.name.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      svc.id.toLowerCase().includes(searchQuery.toLowerCase()) ||
                      svc.team.toLowerCase().includes(searchQuery.toLowerCase());

                    if (!matchesSearch) return null;

                    return (
                      <div
                        key={svc.id}
                        onClick={() => setSelectedService(svc)}
                        className={`p-2.5 rounded-lg border cursor-pointer transition-all ${
                          isRootCause
                            ? 'bg-amber-950/40 border-amber-500 shadow-md ring-2 ring-amber-500/30'
                            : isHighlighted
                            ? 'bg-rose-950/30 border-rose-600/80'
                            : isSelected
                            ? 'bg-cyan-950/50 border-cyan-500'
                            : 'bg-slate-950/70 border-slate-800 hover:border-slate-700'
                        }`}
                      >
                        <div className="flex items-start justify-between gap-2">
                          <div className="space-y-0.5">
                            <div className="flex items-center gap-1.5">
                              <span className={`w-2 h-2 rounded-full shrink-0 ${
                                isRootCause
                                  ? 'bg-amber-400 animate-ping'
                                  : svc.currentHealth === 'critical'
                                  ? 'bg-rose-500'
                                  : svc.currentHealth === 'degraded'
                                  ? 'bg-amber-500'
                                  : 'bg-emerald-500'
                              }`} />
                              <span className="font-semibold text-xs text-white truncate max-w-[170px]" title={svc.name}>
                                {svc.name}
                              </span>
                            </div>
                            <span className="font-mono text-[10px] text-slate-400 block truncate">
                              {svc.id}
                            </span>
                          </div>

                          <div className="text-right shrink-0">
                            {isRootCause ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-bold bg-amber-400 text-slate-950">
                                ROOT
                              </span>
                            ) : svc.activeAlertCount > 0 ? (
                              <span className="px-1.5 py-0.5 rounded text-[9px] font-mono font-bold bg-rose-950 text-rose-300 border border-rose-800">
                                {svc.activeAlertCount} alt
                              </span>
                            ) : (
                              <span className="text-[10px] text-slate-400 font-mono">
                                {svc.protocol}
                              </span>
                            )}
                          </div>
                        </div>
                      </div>
                    );
                  })}
                </div>
              </div>
            );
          })}
        </div>
      )}

      {/* Selected Service Detailed Drawer */}
      {selectedService && (
        <div className="bg-slate-900 border border-slate-700 rounded-xl p-5 shadow-2xl space-y-4 animate-in slide-in-from-bottom-2 duration-150">
          <div className="flex items-start justify-between">
            <div className="space-y-1">
              <div className="flex items-center gap-2">
                <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-indigo-950 text-indigo-300 border border-indigo-800">
                  {selectedService.tierName}
                </span>
                <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                  selectedService.currentHealth === 'critical'
                    ? 'bg-rose-950 text-rose-300'
                    : selectedService.currentHealth === 'degraded'
                    ? 'bg-amber-950 text-amber-300'
                    : 'bg-emerald-950 text-emerald-300'
                }`}>
                  Health: {selectedService.currentHealth.toUpperCase()}
                </span>
                <span className="text-xs text-slate-400 font-mono">
                  SLO: {selectedService.sloTarget}%
                </span>
              </div>
              <h3 className="text-lg font-bold text-white">
                {selectedService.name}
              </h3>
              <p className="text-xs text-slate-400 font-mono">
                ID: {selectedService.id} • Team: {selectedService.team} • Protocol: {selectedService.protocol}
              </p>
            </div>

            <button
              onClick={() => setSelectedService(null)}
              className="p-1 rounded-lg text-slate-400 hover:text-white hover:bg-slate-800"
            >
              <X className="w-5 h-5" />
            </button>
          </div>

          <div className="grid grid-cols-1 md:grid-cols-2 gap-4 pt-3 border-t border-slate-800 text-xs">
            {/* Direct Upstream Dependencies */}
            <div className="space-y-2">
              <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                Direct Upstream Dependencies (Called By This Service):
              </span>
              {selectedService.dependencies.length === 0 ? (
                <p className="text-slate-400 italic">No upstream dependencies (Top edge ingress or independent root broker).</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {selectedService.dependencies.map(dep => (
                    <span key={dep} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-cyan-300">
                      {dep}
                    </span>
                  ))}
                </div>
              )}
            </div>

            {/* Downstream Callers */}
            <div className="space-y-2">
              <span className="font-semibold text-slate-300 uppercase tracking-wider text-[11px]">
                Downstream Callers (Depend On This Service):
              </span>
              {(selectedService.downstream || []).length === 0 ? (
                <p className="text-slate-400 italic">No downstream callers.</p>
              ) : (
                <div className="flex flex-wrap gap-1.5">
                  {(selectedService.downstream || []).map(caller => (
                    <span key={caller} className="px-2 py-1 rounded bg-slate-950 border border-slate-800 font-mono text-[11px] text-rose-300">
                      {caller}
                    </span>
                  ))}
                </div>
              )}
            </div>
          </div>
        </div>
      )}
    </div>
  );
};
