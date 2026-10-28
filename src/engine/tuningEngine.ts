import { Alert, Incident, AlertTuningRecommendation } from '../types';
import { getService } from './topologyData';

/**
 * Analyzes alerts and incidents to recommend actionable alert rule tuning opportunities
 * for SRE review (e.g. flapping alerts, low signal-to-noise ratio, redundant monitors).
 */
export function generateAlertTuningRecommendations(
  alerts: Alert[],
  incidents: Incident[]
): AlertTuningRecommendation[] {
  const recommendations: AlertTuningRecommendation[] = [];

  // Group alerts by fingerprint
  const fingerprintMap = new Map<string, {
    firstAlert: Alert;
    occurrences: number;
    incidentIds: Set<string>;
  }>();

  alerts.forEach(alert => {
    const existing = fingerprintMap.get(alert.fingerprint);
    if (existing) {
      existing.occurrences += (alert.dedupCount || 1);
    } else {
      fingerprintMap.set(alert.fingerprint, {
        firstAlert: alert,
        occurrences: alert.dedupCount || 1,
        incidentIds: new Set<string>(),
      });
    }
  });

  // Track which incidents contain which fingerprints
  incidents.forEach(inc => {
    inc.alerts.forEach(a => {
      const entry = fingerprintMap.get(a.fingerprint);
      if (entry) {
        entry.incidentIds.add(inc.id);
      }
    });
  });

  // Rule 1: High Flapping / Low Correlation Noise Alerts
  fingerprintMap.forEach((entry, fingerprint) => {
    const alert = entry.firstAlert;
    const occurrences = entry.occurrences;
    const incidentCount = entry.incidentIds.size;
    const correlationRate = occurrences > 0 ? (incidentCount / occurrences) * 100 : 0;
    const svcName = getService(alert.serviceId)?.name || alert.serviceId;

    // If fired > 15 times but never part of any multi-service or high-severity incident
    if (occurrences >= 15 && correlationRate < 10) {
      recommendations.push({
        id: `tune_flap_${fingerprint}`,
        alertFingerprint: fingerprint,
        serviceId: alert.serviceId,
        serviceName: svcName,
        metricName: alert.metricName,
        alertTitle: alert.title,
        issueType: 'high_flapping',
        occurrences,
        incidentsCorrelated: incidentCount,
        correlationRate: Number(correlationRate.toFixed(1)),
        suggestedAction: `Increase threshold from ${alert.threshold} to ${(alert.threshold * 1.15).toFixed(1)} or extend evaluation window from 'for: 1m' to 'for: 5m' to absorb transient micro-spikes.`,
        confidence: 'HIGH',
        codePatchRecommendation: `# Prometheus AlertRule Patch for ${alert.title}\n- alert: ${alert.title.replace(/\s+/g, '')}\n  expr: ${alert.metricName}{service="${alert.serviceId}"} > ${(alert.threshold * 1.15).toFixed(1)}\n  for: 5m # Increased from 1m to suppress flapping\n  labels:\n    severity: warning\n    team: ${getService(alert.serviceId)?.team || 'sre'}`,
        status: 'pending',
      });
    }

    // Rule 2: Overly Sensitive Ephemeral Disk / Temp Storage
    if (alert.metricName.includes('temp') || alert.metricName.includes('ephemeral')) {
      if (occurrences >= 10 && correlationRate < 15) {
        recommendations.push({
          id: `tune_disk_${fingerprint}`,
          alertFingerprint: fingerprint,
          serviceId: alert.serviceId,
          serviceName: svcName,
          metricName: alert.metricName,
          alertTitle: alert.title,
          issueType: 'overly_sensitive_window',
          occurrences,
          incidentsCorrelated: incidentCount,
          correlationRate: Number(correlationRate.toFixed(1)),
          suggestedAction: 'Ephemeral /tmp volume usage self-cleans on pod reboot. Exclude non-persistent mountpoints from paging rotation.',
          confidence: 'HIGH',
          codePatchRecommendation: `# Datadog / Prometheus Mountpoint Filter\nexpr: node_filesystem_free_bytes{mountpoint!~"/tmp|/var/tmp"} / node_filesystem_size_bytes < 0.10`,
          status: 'pending',
        });
      }
    }

    // Rule 3: Redundant Downstream Cascade Alerts (Candidate for Alert Inhibition)
    if (alert.metricName.includes('504') || alert.metricName.includes('timeout')) {
      const parentSvc = getService(alert.serviceId)?.dependencies[0];
      if (parentSvc && occurrences >= 20) {
        recommendations.push({
          id: `tune_inhib_${fingerprint}`,
          alertFingerprint: fingerprint,
          serviceId: alert.serviceId,
          serviceName: svcName,
          metricName: alert.metricName,
          alertTitle: alert.title,
          issueType: 'missing_dependency_context',
          occurrences,
          incidentsCorrelated: incidentCount,
          correlationRate: Number(correlationRate.toFixed(1)),
          suggestedAction: `Implement Alertmanager Inhibition rule: Silence downstream '${alert.title}' when upstream service '${parentSvc}' is already firing critical database/connectivity alerts.`,
          confidence: 'MEDIUM',
          codePatchRecommendation: `# Alertmanager Inhibition Rule\ninhibit_rules:\n  - source_match:\n      service: "${parentSvc}"\n      severity: "CRITICAL"\n    target_match:\n      service: "${alert.serviceId}"\n    equal: ["region", "cluster"]`,
          status: 'pending',
        });
      }
    }
  });

  // Sort by highest occurrences first
  recommendations.sort((a, b) => b.occurrences - a.occurrences);

  return recommendations;
}
