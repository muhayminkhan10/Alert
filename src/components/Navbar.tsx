import React, { useState } from 'react';
import { 
  ShieldAlert, 
  Activity, 
  Network, 
  CheckCircle2, 
  Sliders, 
  Radio, 
  Zap, 
  RotateCcw, 
  ChevronDown,
  Sparkles,
  Layers
} from 'lucide-react';
import { injectChaosScenario, resetSimulation } from '../api/client';

interface NavbarProps {
  activeTab: 'overview' | 'incidents' | 'replay' | 'topology' | 'benchmark' | 'stream' | 'tuning' | 'audit';
  setActiveTab: (tab: 'overview' | 'incidents' | 'replay' | 'topology' | 'benchmark' | 'stream' | 'tuning' | 'audit') => void;
  activeIncidentsCount: number;
  noiseReductionRate: number;
  onRefresh: () => void;
}

export const Navbar: React.FC<NavbarProps> = ({
  activeTab,
  setActiveTab,
  activeIncidentsCount,
  noiseReductionRate,
  onRefresh,
}) => {
  const [chaosOpen, setChaosOpen] = useState(false);
  const [injecting, setInjecting] = useState(false);

  const handleInject = async (scenarioId: string) => {
    setInjecting(true);
    setChaosOpen(false);
    await injectChaosScenario(scenarioId);
    onRefresh();
    setInjecting(false);
  };

  const handleReset = async () => {
    setInjecting(true);
    await resetSimulation();
    onRefresh();
    setInjecting(false);
  };

  interface NavItem {
    id: 'overview' | 'incidents' | 'replay' | 'topology' | 'benchmark' | 'stream' | 'tuning' | 'audit';
    label: string;
    icon: React.ComponentType<{ className?: string }>;
    badge?: number;
  }

  const navItems: NavItem[] = [
    { id: 'overview', label: 'Overview', icon: Activity },
    { 
      id: 'incidents', 
      label: 'Incidents', 
      icon: ShieldAlert, 
      badge: activeIncidentsCount > 0 ? activeIncidentsCount : undefined 
    },
    { id: 'replay', label: 'Timeline Replay', icon: RotateCcw },
    { id: 'topology', label: '70-Svc Topology', icon: Network },
    { id: 'benchmark', label: 'Evaluation Lab', icon: CheckCircle2 },
    { id: 'tuning', label: 'Alert Tuning', icon: Sliders },
    { id: 'audit', label: 'Audit & Exports', icon: Layers },
    { id: 'stream', label: 'Live Stream', icon: Radio },
  ];

  return (
    <header className="bg-slate-900 border-b border-slate-800 text-slate-100 sticky top-0 z-50">
      <div className="max-w-7xl mx-auto px-4 sm:px-6 lg:px-8">
        <div className="flex items-center justify-between h-16">
          {/* Brand Logo & Platform Status */}
          <div className="flex items-center gap-4">
            <div 
              onClick={() => setActiveTab('overview')}
              className="flex items-center gap-3 cursor-pointer group"
            >
              <div className="w-10 h-10 rounded-xl bg-gradient-to-tr from-cyan-600 to-indigo-600 flex items-center justify-center shadow-lg shadow-indigo-500/20 group-hover:scale-105 transition-transform">
                <Layers className="w-5 h-5 text-white" />
              </div>
              <div>
                <div className="flex items-center gap-2">
                  <span className="font-bold text-lg tracking-tight bg-gradient-to-r from-white via-slate-100 to-slate-400 bg-clip-text text-transparent">
                    Acuity SRE
                  </span>
                  <span className="text-xs px-2 py-0.5 rounded-full bg-cyan-950 text-cyan-400 border border-cyan-800/80 font-mono">
                    v2.4
                  </span>
                </div>
                <p className="text-xs text-slate-400 hidden sm:block">
                  AI Alert Correlation & Incident Detection
                </p>
              </div>
            </div>

            <div className="hidden lg:flex items-center gap-2 pl-4 border-l border-slate-800 text-xs text-slate-400">
              <span className="flex h-2 w-2 relative">
                <span className="animate-ping absolute inline-flex h-full w-full rounded-full bg-emerald-400 opacity-75"></span>
                <span className="relative inline-flex rounded-full h-2 w-2 bg-emerald-500"></span>
              </span>
              <span>70 Services Monitored</span>
              <span className="text-slate-600">•</span>
              <span className="text-emerald-400 font-semibold">{noiseReductionRate}% Noise Suppressed</span>
            </div>
          </div>

          {/* Quick Chaos Simulation Controls */}
          <div className="flex items-center gap-3">
            <div className="relative">
              <button
                type="button"
                onClick={() => setChaosOpen(!chaosOpen)}
                disabled={injecting}
                className="flex items-center gap-2 px-3 py-1.5 text-xs font-medium rounded-lg bg-indigo-950/80 hover:bg-indigo-900 border border-indigo-700/60 text-indigo-200 transition-colors shadow-sm"
              >
                <Zap className="w-3.5 h-3.5 text-amber-400" />
                <span>Inject Scenario</span>
                <ChevronDown className="w-3.5 h-3.5 text-indigo-400" />
              </button>

              {chaosOpen && (
                <div className="absolute right-0 mt-2 w-72 rounded-xl bg-slate-900 border border-slate-700 shadow-2xl py-2 z-50 text-xs">
                  <div className="px-3 py-1.5 font-semibold text-slate-400 uppercase tracking-wider text-[10px] border-b border-slate-800">
                    Synthetic Failure Scenarios
                  </div>
                  <button
                    onClick={() => handleInject('scenario-db-exhaustion')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-amber-300">1. PostgreSQL Pool Exhaustion</span>
                    <span className="text-slate-400 text-[11px]">Primary DB saturation cascading to checkout & 504s</span>
                  </button>
                  <button
                    onClick={() => handleInject('scenario-payment-provider-down')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-amber-300">2. External Payment Gateway Outage</span>
                    <span className="text-slate-400 text-[11px]">Circuit breaker open on 3P provider adapter</span>
                  </button>
                  <button
                    onClick={() => handleInject('scenario-redis-oom')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-amber-300">3. Redis Cache OOM Eviction</span>
                    <span className="text-slate-400 text-[11px]">Session eviction storm causing auth drops</span>
                  </button>
                  <button
                    onClick={() => handleInject('scenario-concurrent-outages')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-indigo-300">4. Concurrent Dual Outage (Stress Test)</span>
                    <span className="text-slate-400 text-[11px]">CoreDNS & Kafka lag firing at the same minute</span>
                  </button>
                  <button
                    onClick={() => handleInject('scenario-noise-storm')}
                    className="w-full text-left px-3 py-2 hover:bg-slate-800 text-slate-200 flex flex-col gap-0.5"
                  >
                    <span className="font-medium text-slate-300">5. Flapping Noise Storm</span>
                    <span className="text-slate-400 text-[11px]">80 noisy CPU flaps + 1 critical vault expiry</span>
                  </button>
                </div>
              )}
            </div>

            <button
              type="button"
              onClick={handleReset}
              disabled={injecting}
              title="Reset simulation dataset"
              className="p-1.5 rounded-lg bg-slate-800 hover:bg-slate-700 text-slate-300 transition-colors border border-slate-700"
            >
              <RotateCcw className={`w-4 h-4 ${injecting ? 'animate-spin' : ''}`} />
            </button>
          </div>
        </div>

        {/* Navigation Tabs */}
        <div className="flex space-x-1 sm:space-x-4 border-t border-slate-800 overflow-x-auto scrollbar-none py-1">
          {navItems.map(item => {
            const Icon = item.icon;
            const isActive = activeTab === item.id;
            return (
              <button
                key={item.id}
                onClick={() => setActiveTab(item.id)}
                className={`flex items-center gap-2 py-2 px-3 text-xs sm:text-sm font-medium rounded-lg whitespace-nowrap transition-colors ${
                  isActive
                    ? 'bg-slate-800 text-cyan-400 shadow-sm border border-slate-700'
                    : 'text-slate-400 hover:text-slate-200 hover:bg-slate-800/50'
                }`}
              >
                <Icon className={`w-4 h-4 ${isActive ? 'text-cyan-400' : 'text-slate-400'}`} />
                <span>{item.label}</span>
                {item.badge !== undefined && (
                  <span className="ml-1 px-1.5 py-0.2 rounded-full text-[10px] font-bold bg-rose-950 text-rose-300 border border-rose-800">
                    {item.badge}
                  </span>
                )}
              </button>
            );
          })}
        </div>
      </div>
    </header>
  );
};
