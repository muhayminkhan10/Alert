import { NormalizedAlert, PredictedGroup, AlertSeverity } from '../types/schemas';
import { deduplicateStream } from './deduplicator';
import { runConservativeCorrelation } from './correlationEngine';

/**
 * Baseline 1: No Grouping
 * Every raw alert is treated as an isolated incident.
 */
export function runNoGroupingBaseline(alerts: NormalizedAlert[]): PredictedGroup[] {
  return alerts.map((alert, idx) => ({
    id: `base_none_${idx}_${alert.id}`,
    algorithm: 'no_grouping',
    alertIds: [alert.id],
    rawAlertCount: 1,
    startTime: alert.timestamp,
    lastAlertTime: alert.timestamp,
    severity: alert.severity,
  }));
}

/**
 * Baseline 2: Exact-Fingerprint Deduplication
 * Alerts sharing the exact same fingerprint in the deduplication window are grouped together.
 * No cross-service or multi-alert correlation.
 */
export function runDedupOnlyBaseline(alerts: NormalizedAlert[]): PredictedGroup[] {
  const { canonicalAlerts } = deduplicateStream(alerts);
  return canonicalAlerts.map((canonical, idx) => ({
    id: `base_dedup_${idx}_${canonical.id}`,
    algorithm: 'dedup_only',
    alertIds: [...canonical.rawAlertIds],
    rawAlertCount: canonical.rawAlertIds.length,
    startTime: canonical.firstSeen,
    lastAlertTime: canonical.lastSeen,
    severity: canonical.severity,
  }));
}

/**
 * Baseline 3: Simple Time-Window Grouping
 * Groups all alerts that occur within a sliding time window (e.g. 15 minutes),
 * completely ignoring topology or service boundaries.
 * Prone to severe False Merges when multiple incidents or noisy alerts co-occur.
 */
export function runSimpleTimeWindowBaseline(
  alerts: NormalizedAlert[],
  windowMinutes: number = 15
): PredictedGroup[] {
  if (alerts.length === 0) return [];

  const windowMs = windowMinutes * 60 * 1000;
  const sorted = [...alerts].sort((a, b) => a.timestampMs - b.timestampMs);

  const groups: NormalizedAlert[][] = [];
  let currentGroup: NormalizedAlert[] = [sorted[0]];

  for (let i = 1; i < sorted.length; i++) {
    const prev = currentGroup[currentGroup.length - 1];
    const curr = sorted[i];

    if (curr.timestampMs - prev.timestampMs <= windowMs) {
      currentGroup.push(curr);
    } else {
      groups.push(currentGroup);
      currentGroup = [curr];
    }
  }
  if (currentGroup.length > 0) {
    groups.push(currentGroup);
  }

  return groups.map((grp, idx) => {
    const rawAlertIds = grp.map(a => a.id);
    const highestSev = grp.reduce((highest, cur) => {
      const rank = (s: string) => s === 'CRITICAL' ? 4 : s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1;
      return rank(cur.severity) > rank(highest) ? cur.severity : highest;
    }, 'LOW');

    return {
      id: `base_timewin_${idx + 1}`,
      algorithm: 'simple_time_window',
      alertIds: rawAlertIds,
      rawAlertCount: rawAlertIds.length,
      startTime: grp[0].timestamp,
      lastAlertTime: grp[grp.length - 1].timestamp,
      severity: highestSev as AlertSeverity,
    };
  });
}

/**
 * Baseline 4: Dependency-Aware Correlation (Conservative Engine)
 */
export function runDependencyAwareBaseline(alerts: NormalizedAlert[]): PredictedGroup[] {
  const result = runConservativeCorrelation(alerts);
  return result.predictedGroups;
}
