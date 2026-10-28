import { NormalizedAlert, CanonicalAlert } from '../types/schemas';

export interface DeduplicationConfig {
  windowMinutes: number;
  maskVolatileTokens: boolean;
  fingerprintFields: ('serviceId' | 'metricName' | 'normalizedTitle' | 'cluster' | 'region')[];
}

export const DEFAULT_DEDUP_CONFIG: DeduplicationConfig = {
  windowMinutes: 15,
  maskVolatileTokens: true,
  fingerprintFields: ['serviceId', 'metricName', 'normalizedTitle', 'cluster', 'region'],
};

/**
 * Strips volatile request IDs, UUIDs, IP addresses, and trace tokens
 * from alert titles so identical failure patterns with transient IDs
 * deduplicate cleanly.
 */
export function sanitizeVolatileTokens(title: string): string {
  return title
    // UUIDs: e.g. 123e4567-e89b-12d3-a456-426614174000
    .replace(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/gi, '<UUID>')
    // Request IDs: req-12345, request_id: abc-xyz, tx-982173
    .replace(/\b(req|request|tx|trace|span|session)[-_:][a-z0-9_-]+/gi, '<REQ_ID>')
    // IPv4 addresses
    .replace(/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '<IP>')
    // Hex hash strings >= 8 characters
    .replace(/\b[0-9a-f]{8,64}\b/gi, '<HASH>')
    // Trailing/leading whitespace
    .trim()
    .toLowerCase();
}

/**
 * Generates deterministic 32-bit integer string hash.
 */
export function computeStableFingerprint(
  alert: NormalizedAlert,
  config: DeduplicationConfig = DEFAULT_DEDUP_CONFIG
): string {
  const parts: string[] = [];

  for (const field of config.fingerprintFields) {
    if (field === 'serviceId') {
      parts.push(alert.serviceId.toLowerCase());
    } else if (field === 'metricName') {
      parts.push(alert.metricName.toLowerCase());
    } else if (field === 'normalizedTitle') {
      const sanitized = config.maskVolatileTokens
        ? sanitizeVolatileTokens(alert.title)
        : alert.title.toLowerCase().trim();
      parts.push(sanitized);
    } else if (field === 'cluster') {
      parts.push((alert.cluster || 'default').toLowerCase());
    } else if (field === 'region') {
      parts.push((alert.region || 'default').toLowerCase());
    }
  }

  const combined = parts.join('||');
  let hash = 0;
  for (let i = 0; i < combined.length; i++) {
    hash = (hash << 5) - hash + combined.charCodeAt(i);
    hash |= 0;
  }

  return `fp_${Math.abs(hash).toString(16)}`;
}

/**
 * Sliding time-window deduplication without deleting raw source records.
 * Returns canonical alerts with full list of mapped raw alert IDs.
 */
export function deduplicateStream(
  alerts: NormalizedAlert[],
  config: DeduplicationConfig = DEFAULT_DEDUP_CONFIG
): {
  canonicalAlerts: CanonicalAlert[];
  rawCount: number;
  dedupCount: number;
  suppressionRatio: number;
  rawToCanonicalMap: Map<string, string>;
} {
  const windowMs = config.windowMinutes * 60 * 1000;
  const rawToCanonicalMap = new Map<string, string>();

  // Ensure chronological order for sliding window
  const sorted = [...alerts].sort((a, b) => a.timestampMs - b.timestampMs);

  // Active windows keyed by fingerprint
  const activeWindows = new Map<string, CanonicalAlert>();
  const canonicalAlerts: CanonicalAlert[] = [];

  for (const alert of sorted) {
    const fp = computeStableFingerprint(alert, config);
    alert.fingerprint = fp;

    const existing = activeWindows.get(fp);

    if (existing) {
      const existingLastSeenMs = new Date(existing.lastSeen).getTime();
      // If within sliding window: accumulate into existing canonical state
      if (alert.timestampMs - existingLastSeenMs <= windowMs) {
        existing.rawAlertIds.push(alert.id);
        existing.dedupCount += (alert.dedupCount || 1);
        existing.suppressedCount += 1;
        existing.lastSeen = alert.timestamp;

        // Escalate severity if incoming alert is more severe
        if (severityRank(alert.severity) > severityRank(existing.severity)) {
          existing.severity = alert.severity;
          existing.title = alert.title;
        }

        rawToCanonicalMap.set(alert.id, existing.id);
        continue;
      }
    }

    // New window started (either first seen or window expired)
    const canonical: CanonicalAlert = {
      ...alert,
      fingerprint: fp,
      rawAlertIds: [alert.id],
      suppressedCount: 0,
      dedupCount: alert.dedupCount || 1,
      firstSeen: alert.timestamp,
      lastSeen: alert.timestamp,
    };

    activeWindows.set(fp, canonical);
    canonicalAlerts.push(canonical);
    rawToCanonicalMap.set(alert.id, canonical.id);
  }

  const rawCount = alerts.length;
  const dedupCount = canonicalAlerts.length;
  const suppressionRatio = rawCount > 0 ? (rawCount - dedupCount) / rawCount : 0;

  return {
    canonicalAlerts,
    rawCount,
    dedupCount,
    suppressionRatio,
    rawToCanonicalMap,
  };
}

export function severityRank(sev: string): number {
  switch (sev) {
    case 'CRITICAL': return 4;
    case 'HIGH': return 3;
    case 'MEDIUM': return 2;
    case 'LOW': return 1;
    default: return 0;
  }
}

export function generateFingerprint(alert: {
  serviceId: string;
  metricName: string;
  title: string;
  cluster?: string;
  region?: string;
}): string {
  const sanitized = sanitizeVolatileTokens(alert.title || '');
  const parts = [
    (alert.serviceId || '').toLowerCase(),
    (alert.metricName || '').toLowerCase(),
    sanitized,
    (alert.cluster || 'default').toLowerCase(),
    (alert.region || 'default').toLowerCase(),
  ];
  let hash = 0;
  const str = parts.join('||');
  for (let i = 0; i < str.length; i++) {
    hash = (hash << 5) - hash + str.charCodeAt(i);
    hash |= 0;
  }
  return `fp_${Math.abs(hash).toString(16)}`;
}

export function normalizeAlert(raw: any, serviceNameLookup?: (id: string) => string): any {
  const serviceId = raw.serviceId || 'unknown-service';
  const serviceName = raw.serviceName || (serviceNameLookup ? serviceNameLookup(serviceId) : serviceId);
  const metricName = raw.metricName || 'system.status';
  const title = raw.title || `Alert on ${serviceName}`;
  const timestamp = raw.timestamp || new Date().toISOString();
  const timestampMs = new Date(timestamp).getTime();
  const cluster = raw.cluster || 'k8s-prod-us1';
  const region = raw.region || 'us-east-1';

  return {
    id: raw.id || `alt_${Math.random().toString(36).substring(2, 9)}_${Date.now()}`,
    fingerprint: raw.fingerprint || generateFingerprint({ serviceId, metricName, title, cluster, region }),
    serviceId,
    serviceName,
    severity: raw.severity || 'MEDIUM',
    status: raw.status || 'firing',
    metricName,
    metricValue: typeof raw.metricValue === 'number' ? raw.metricValue : 1,
    threshold: typeof raw.threshold === 'number' ? raw.threshold : 1,
    title,
    description: raw.description || '',
    sourceMonitor: raw.sourceMonitor || 'prometheus',
    timestamp,
    timestampMs: isNaN(timestampMs) ? Date.now() : timestampMs,
    environment: raw.environment || 'production',
    cluster,
    region,
    rawPayload: raw.rawPayload || {},
    dedupCount: raw.dedupCount || 1,
    firstSeen: raw.firstSeen || timestamp,
    lastSeen: raw.lastSeen || timestamp,
    scenarioId: raw.scenarioId,
  };
}

export function deduplicateAlerts(alerts: any[], windowMinutes: number = 15): any {
  const normAlerts = alerts.map(a => a.timestampMs ? a : { ...a, timestampMs: new Date(a.timestamp).getTime() });
  const result = deduplicateStream(normAlerts, { ...DEFAULT_DEDUP_CONFIG, windowMinutes });
  return {
    deduplicatedAlerts: result.canonicalAlerts,
    rawCount: result.rawCount,
    dedupCount: result.dedupCount,
    suppressionRatio: result.suppressionRatio,
  };
}
