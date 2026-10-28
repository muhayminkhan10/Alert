import React, { useState, useEffect, useRef } from 'react';
import { 
  Play, 
  Pause, 
  SkipBack, 
  SkipForward, 
  RotateCcw, 
  Clock, 
  ShieldAlert, 
  Layers, 
  Download, 
  AlertTriangle,
  CheckCircle2,
  Activity,
  ArrowRight,
  Info,
  Server
} from 'lucide-react';
import { fetchReplayData } from '../api/client';

interface ReplayEvent {
  id: string;
  serviceId: string;
  serviceName: string;
  severity: string;
  title: string;
  metricName: string;
  metricValue: number;
  threshold: number;
  sourceMonitor: string;
  eventTimestamp: string;
  ingestedTimestamp: string;
  ingestLagSeconds: number;
  isLate: boolean;
  dedupCount: number;
  fingerprint: string;
}

export const TimelineReplayView: React.FC = () => {
  const [events, setEvents] = useState<ReplayEvent[]>([]);
  const [currentIndex, setCurrentIndex] = useState<number>(0);
  const [isPlaying, setIsPlaying] = useState<boolean>(false);
  const [speedMultiplier, setSpeedMultiplier] = useState<number>(5);
  const [loading, setLoading] = useState<boolean>(true);
  const [lateArrivalPolicy, setLateArrivalPolicy] = useState<string>('');
  const [replayConfig, setReplayConfig] = useState<{ seed: number; split: string; engineVersion: string }>({
    seed: 42,
    split: 'test',
    engineVersion: 'v2.4.0-deterministic',
  });

  const timerRef = useRef<NodeJS.Timeout | null>(null);

  useEffect(() => {
    async function load() {
      setLoading(true);
      const data = await fetchReplayData();
      setEvents(data.replayEvents || []);
      setLateArrivalPolicy(data.lateArrivalPolicy || 'Late arrival threshold: 120s.');
      if (data.config) setReplayConfig(data.config);
      setLoading(false);
    }
    load();
  }, []);

  // Step playback loop
  useEffect(() => {
    if (isPlaying && events.length > 0) {
      const intervalMs = Math.max(50, Math.round(1000 / speedMultiplier));
      timerRef.current = setInterval(() => {
        setCurrentIndex(prev => {
          if (prev >= events.length - 1) {
            setIsPlaying(false);
            return prev;
          }
          return prev + 1;
        });
      }, intervalMs);
    } else if (timerRef.current) {
      clearInterval(timerRef.current);
    }

    return () => {
      if (timerRef.current) clearInterval(timerRef.current);
    };
  }, [isPlaying, speedMultiplier, events.length]);

  const handlePlayPause = () => {
    if (currentIndex >= events.length - 1) {
      setCurrentIndex(0);
    }
    setIsPlaying(!isPlaying);
  };

  const handleStepForward = () => {
    setIsPlaying(false);
    setCurrentIndex(prev => Math.min(events.length - 1, prev + 1));
  };

  const handleStepBackward = () => {
    setIsPlaying(false);
    setCurrentIndex(prev => Math.max(0, prev - 1));
  };

  const handleReset = () => {
    setIsPlaying(false);
    setCurrentIndex(0);
  };

  // Visible alerts strictly up to currentIndex (Zero future knowledge!)
  const visibleEvents = events.slice(0, currentIndex + 1);
  const currentEvent = events[currentIndex];

  // Dynamically compute incremental incidents surfaced strictly from alerts <= currentIndex
  const serviceAlertMap = new Map<string, number>();
  visibleEvents.forEach(e => {
    serviceAlertMap.set(e.serviceId, (serviceAlertMap.get(e.serviceId) || 0) + 1);
  });

  // Top impacted services up to current simulation step
  const activeImpactedServices = Array.from(serviceAlertMap.entries())
    .sort((a, b) => b[1] - a[1])
    .slice(0, 6);

  // Late arriving alerts up to current step
  const lateArrivedCount = visibleEvents.filter(e => e.isLate).length;

  const handleExportTrace = () => {
    const payload = {
      replayMetadata: {
        exportedAt: new Date().toISOString(),
        engineVersion: replayConfig.engineVersion,
        seed: replayConfig.seed,
        split: replayConfig.split,
        totalEventsReplayed: currentIndex + 1,
        totalDatasetEvents: events.length,
        currentStepEventTime: currentEvent?.eventTimestamp,
        currentStepIngestedTime: currentEvent?.ingestedTimestamp,
        lateArrivalPolicy,
      },
      eventsUpToStep: visibleEvents,
    };

    const blob = new Blob([JSON.stringify(payload, null, 2)], { type: 'application/json' });
    const url = URL.createObjectURL(blob);
    const a = document.createElement('a');
    a.href = url;
    a.download = `acuity-replay-trace-step${currentIndex}-${Date.now()}.json`;
    a.click();
    URL.revokeObjectURL(url);
  };

  if (loading) {
    return (
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-12 text-center text-slate-400 text-xs">
        <Clock className="w-8 h-8 text-cyan-400 mx-auto mb-2 animate-spin" />
        <p>Loading chronological event telemetry and replay engine...</p>
      </div>
    );
  }

  return (
    <div className="space-y-6">
      {/* Replay Header & Configuration Banner */}
      <div className="bg-slate-900 border border-slate-800 rounded-xl p-5 space-y-4">
        <div className="flex flex-col md:flex-row md:items-center justify-between gap-4">
          <div>
            <div className="flex items-center gap-2">
              <span className="px-2 py-0.5 rounded text-xs font-bold uppercase tracking-wider bg-indigo-950 text-indigo-300 border border-indigo-800">
                Deterministic Event Replay
              </span>
              <span className="text-xs text-slate-400 font-mono">
                Engine: {replayConfig.engineVersion} • Seed: {replayConfig.seed} • Split: {replayConfig.split}
              </span>
            </div>
            <h2 className="text-xl font-bold text-white mt-1">
              Event-Time Telemetry Progression & Incident Replay
            </h2>
            <p className="text-xs text-slate-400 mt-0.5">
              Strict causal event replay: decision state at step T utilizes ONLY telemetry ingested at or prior to T. Future alerts and ground-truth root causes are forbidden.
            </p>
          </div>

          <div className="flex items-center gap-2.5">
            <button
              onClick={handleExportTrace}
              className="flex items-center gap-1.5 px-3 py-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-200 text-xs font-semibold border border-slate-700 transition-colors"
              title="Export reproducible trace JSON"
            >
              <Download className="w-3.5 h-3.5" />
              <span>Export Replay Trace</span>
            </button>
          </div>
        </div>

        {/* Policy Box */}
        <div className="p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs flex items-start gap-2.5">
          <Info className="w-4 h-4 text-cyan-400 shrink-0 mt-0.5" />
          <div className="space-y-0.5">
            <span className="font-semibold text-slate-300">Late-Arriving Alert Policy:</span>
            <p className="text-slate-400">
              {lateArrivalPolicy} Incoming alerts delayed past threshold trigger retroactive candidate link evaluation without destabilizing completed incident postmortems.
            </p>
          </div>
        </div>

        {/* Primary Controls Bar */}
        <div className="pt-2 border-t border-slate-800 flex flex-col md:flex-row items-center justify-between gap-4">
          {/* Playback Buttons */}
          <div className="flex items-center gap-2">
            <button
              onClick={handleReset}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors"
              title="Reset to beginning"
            >
              <RotateCcw className="w-4 h-4" />
            </button>
            <button
              onClick={handleStepBackward}
              disabled={currentIndex === 0}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
              title="Step backward (-1 event)"
            >
              <SkipBack className="w-4 h-4" />
            </button>
            <button
              onClick={handlePlayPause}
              className="flex items-center gap-1.5 px-4 py-2 rounded-lg bg-cyan-600 hover:bg-cyan-500 text-white font-semibold text-xs shadow-md shadow-cyan-900/30 transition-colors"
            >
              {isPlaying ? (
                <>
                  <Pause className="w-4 h-4" />
                  <span>Pause</span>
                </>
              ) : (
                <>
                  <Play className="w-4 h-4" />
                  <span>Play Replay</span>
                </>
              )}
            </button>
            <button
              onClick={handleStepForward}
              disabled={currentIndex >= events.length - 1}
              className="p-2 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 disabled:opacity-40 transition-colors"
              title="Step forward (+1 event)"
            >
              <SkipForward className="w-4 h-4" />
            </button>
          </div>

          {/* Speed Multiplier */}
          <div className="flex items-center gap-1 bg-slate-950 p-1 rounded-lg border border-slate-800 text-xs">
            <span className="text-[10px] text-slate-500 px-1 font-semibold uppercase">Speed:</span>
            {[1, 5, 10, 25, 50].map(s => (
              <button
                key={s}
                onClick={() => setSpeedMultiplier(s)}
                className={`px-2.5 py-1 rounded text-xs font-mono font-semibold transition-colors ${
                  speedMultiplier === s
                    ? 'bg-indigo-600 text-white'
                    : 'text-slate-400 hover:text-slate-200'
                }`}
              >
                {s}x
              </button>
            ))}
          </div>

          {/* Simulation Progress Counter */}
          <div className="text-right text-xs">
            <span className="text-slate-400 block font-mono">
              Step <strong className="text-white">{currentIndex + 1}</strong> of {events.length} events
            </span>
            <span className="text-[11px] text-cyan-400 font-mono">
              {Math.round(((currentIndex + 1) / events.length) * 100)}% Replayed
            </span>
          </div>
        </div>

        {/* Timeline Scrubber Slider */}
        <div className="space-y-1 pt-1">
          <input
            type="range"
            min={0}
            max={events.length - 1}
            value={currentIndex}
            onChange={e => {
              setIsPlaying(false);
              setCurrentIndex(Number(e.target.value));
            }}
            className="w-full accent-cyan-500 bg-slate-800 h-2 rounded-lg cursor-pointer"
          />
          <div className="flex items-center justify-between text-[11px] font-mono text-slate-500">
            <span>Start: {new Date(events[0]?.eventTimestamp || Date.now()).toLocaleTimeString()}</span>
            <span className="text-amber-300 font-bold">
              Current Replay Clock: {new Date(currentEvent?.eventTimestamp || Date.now()).toLocaleTimeString()}
            </span>
            <span>End: {new Date(events[events.length - 1]?.eventTimestamp || Date.now()).toLocaleTimeString()}</span>
          </div>
        </div>
      </div>

      {/* Replay State Split: Current Step Evidence vs Incremental Incidents */}
      <div className="grid grid-cols-1 lg:grid-cols-3 gap-6">
        {/* Left 2 Cols: Incoming Telemetry Stream up to Step T */}
        <div className="lg:col-span-2 space-y-4">
          {/* Current Step Event Card */}
          {currentEvent && (
            <div className="bg-slate-900 border border-cyan-800/80 rounded-xl p-5 shadow-lg space-y-3">
              <div className="flex items-center justify-between">
                <span className="text-xs font-bold text-cyan-400 uppercase tracking-wider flex items-center gap-1.5">
                  <Activity className="w-4 h-4" />
                  <span>Latest Alert Ingested at Step T={currentIndex + 1}</span>
                </span>
                <div className="flex items-center gap-2">
                  {currentEvent.isLate ? (
                    <span className="px-2 py-0.5 rounded text-[10px] font-bold bg-amber-950 text-amber-300 border border-amber-800 flex items-center gap-1">
                      <AlertTriangle className="w-3 h-3" />
                      <span>Late Ingestion (+{currentEvent.ingestLagSeconds}s lag)</span>
                    </span>
                  ) : (
                    <span className="px-2 py-0.5 rounded text-[10px] font-mono bg-slate-800 text-slate-300">
                      Normal Ingestion (+{currentEvent.ingestLagSeconds}s lag)
                    </span>
                  )}
                  <span className={`px-2 py-0.5 rounded text-[10px] font-bold ${
                    currentEvent.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'
                  }`}>
                    {currentEvent.severity}
                  </span>
                </div>
              </div>

              <div>
                <h4 className="text-base font-bold text-white">
                  {currentEvent.title}
                </h4>
                <div className="flex items-center gap-3 text-xs text-slate-400 font-mono mt-1">
                  <span>Service: <strong className="text-white">{currentEvent.serviceName}</strong> ({currentEvent.serviceId})</span>
                  <span>•</span>
                  <span>Metric: <strong className="text-cyan-300">{currentEvent.metricName}</strong> = {currentEvent.metricValue} (Threshold: {currentEvent.threshold})</span>
                </div>
              </div>

              {/* Timestamp Comparison */}
              <div className="grid grid-cols-2 gap-3 p-3 rounded-lg bg-slate-950 border border-slate-800 text-xs font-mono">
                <div>
                  <span className="text-slate-400 text-[10px] uppercase block">Event Occurrence Time</span>
                  <strong className="text-white">{new Date(currentEvent.eventTimestamp).toLocaleTimeString()}</strong>
                </div>
                <div>
                  <span className="text-slate-400 text-[10px] uppercase block">Engine Ingestion Time</span>
                  <strong className="text-amber-300">{new Date(currentEvent.ingestedTimestamp).toLocaleTimeString()}</strong>
                </div>
              </div>
            </div>
          )}

          {/* Chronological Stream History */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl overflow-hidden shadow-sm">
            <div className="p-4 border-b border-slate-800 flex items-center justify-between text-xs">
              <span className="font-bold text-slate-200 uppercase tracking-wider">
                Telemetry Log up to T ({visibleEvents.length} events processed)
              </span>
              <span className="text-slate-400 font-mono text-[11px]">
                {lateArrivedCount} late-arriving events handled
              </span>
            </div>

            <div className="max-h-[360px] overflow-y-auto divide-y divide-slate-800 text-xs font-mono">
              {visibleEvents.slice(-15).reverse().map((ev, idx) => (
                <div key={ev.id + idx} className="p-3 hover:bg-slate-800/40 flex items-center justify-between gap-3">
                  <div className="space-y-0.5 truncate">
                    <div className="flex items-center gap-2">
                      <span className={`px-1.5 py-0.2 rounded text-[9px] font-bold ${
                        ev.severity === 'CRITICAL' ? 'bg-rose-950 text-rose-300' : 'bg-amber-950 text-amber-300'
                      }`}>
                        {ev.severity}
                      </span>
                      <strong className="text-white truncate">{ev.serviceId}</strong>
                      <span className="text-slate-400 text-[11px] truncate">{ev.title}</span>
                    </div>
                  </div>
                  <div className="text-right shrink-0 text-slate-400 text-[11px]">
                    <span>T={new Date(ev.eventTimestamp).toLocaleTimeString()}</span>
                    {ev.isLate && <span className="text-amber-400 ml-1.5">[LATE]</span>}
                  </div>
                </div>
              ))}
            </div>
          </div>
        </div>

        {/* Right 1 Col: Incremental State & Blast Radius at Step T */}
        <div className="space-y-4">
          {/* Active Services Affected at Step T */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 space-y-3">
            <h3 className="text-xs font-bold text-slate-300 uppercase tracking-wider flex items-center gap-1.5">
              <Server className="w-4 h-4 text-indigo-400" />
              <span>Services Impacted at T ({serviceAlertMap.size})</span>
            </h3>

            <div className="space-y-2">
              {activeImpactedServices.map(([svcId, count]) => (
                <div key={svcId} className="p-2.5 rounded-lg bg-slate-800/60 border border-slate-700/80 flex items-center justify-between text-xs font-mono">
                  <span className="font-semibold text-white">{svcId}</span>
                  <span className="px-2 py-0.5 rounded bg-slate-900 text-cyan-400 font-bold">
                    {count} alerts
                  </span>
                </div>
              ))}
            </div>
          </div>

          {/* Causal Isolation Guarantee */}
          <div className="bg-slate-900 border border-slate-800 rounded-xl p-4 text-xs space-y-2 text-slate-300">
            <div className="flex items-center gap-1.5 text-emerald-400 font-semibold">
              <CheckCircle2 className="w-4 h-4" />
              <span>Temporal Anti-Lookahead Guarantee</span>
            </div>
            <p className="text-[11px] text-slate-400 leading-relaxed">
              In this replay step, zero future alerts, future log outputs, or evaluation ground-truth root causes were accessible to the correlation engine.
            </p>
          </div>
        </div>
      </div>
    </div>
  );
};
