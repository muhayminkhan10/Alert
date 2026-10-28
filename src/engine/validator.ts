import { RawAlertRecord, NormalizedAlert, ValidationError, ValidationReport, AlertSeverity, MonitorSource } from '../types/schemas';
import { SERVICE_MAP } from './topologyData';

const VALID_SEVERITIES = new Set<AlertSeverity>(['CRITICAL', 'HIGH', 'MEDIUM', 'LOW', 'INFO']);
const VALID_MONITORS = new Set<MonitorSource>(['prometheus', 'datadog', 'cloudwatch', 'sentry', 'jaeger', 'kafka-lag']);

/**
 * Validates raw alert records against strict contract rules.
 * Reports all invalid records with specific field failure reasons.
 * Preserves the original alert ID.
 */
export function validateAlertRecords(
  records: RawAlertRecord[],
  topologyServiceIds?: Set<string>
): {
  validAlerts: NormalizedAlert[];
  invalidErrors: ValidationError[];
  report: ValidationReport;
} {
  const serviceSet = topologyServiceIds || new Set(SERVICE_MAP.keys());
  const validAlerts: NormalizedAlert[] = [];
  const invalidErrors: ValidationError[] = [];

  for (let idx = 0; idx < records.length; idx++) {
    const raw = records[idx];
    const recordId = typeof raw.id === 'string' && raw.id.trim() !== ''
      ? raw.id.trim()
      : `record_index_${idx}`;

    const recordErrors: ValidationError[] = [];

    // 1. Validate ID
    if (typeof raw.id !== 'string' || raw.id.trim() === '') {
      recordErrors.push({
        recordId,
        field: 'id',
        value: raw.id,
        message: 'Alert ID must be a non-empty string',
        fatal: true,
      });
    }

    // 2. Validate Service ID
    if (typeof raw.serviceId !== 'string' || raw.serviceId.trim() === '') {
      recordErrors.push({
        recordId,
        field: 'serviceId',
        value: raw.serviceId,
        message: 'serviceId is required and must be a non-empty string',
        fatal: true,
      });
    } else if (!serviceSet.has(raw.serviceId.trim())) {
      recordErrors.push({
        recordId,
        field: 'serviceId',
        value: raw.serviceId,
        message: `serviceId '${raw.serviceId}' is not found in the 70-service topology graph`,
        fatal: false, // Non-fatal warning: service is allowed but flagged
      });
    }

    // 3. Validate Timestamp
    let timestampMs = NaN;
    let isoTimestamp = '';
    if (typeof raw.timestamp !== 'string' && typeof raw.timestamp !== 'number') {
      recordErrors.push({
        recordId,
        field: 'timestamp',
        value: raw.timestamp,
        message: 'Timestamp must be an ISO 8601 string or epoch milliseconds',
        fatal: true,
      });
    } else {
      const d = new Date(raw.timestamp);
      timestampMs = d.getTime();
      if (isNaN(timestampMs)) {
        recordErrors.push({
          recordId,
          field: 'timestamp',
          value: raw.timestamp,
          message: `Unparseable timestamp: '${raw.timestamp}'`,
          fatal: true,
        });
      } else {
        isoTimestamp = d.toISOString();
      }
    }

    // 4. Validate Severity
    let severity: AlertSeverity = 'MEDIUM';
    if (typeof raw.severity !== 'string') {
      recordErrors.push({
        recordId,
        field: 'severity',
        value: raw.severity,
        message: 'Severity must be one of: CRITICAL, HIGH, MEDIUM, LOW, INFO',
        fatal: true,
      });
    } else {
      const upperSev = raw.severity.trim().toUpperCase() as AlertSeverity;
      if (!VALID_SEVERITIES.has(upperSev)) {
        recordErrors.push({
          recordId,
          field: 'severity',
          value: raw.severity,
          message: `Invalid severity '${raw.severity}'. Expected CRITICAL, HIGH, MEDIUM, LOW, or INFO`,
          fatal: true,
        });
      } else {
        severity = upperSev;
      }
    }

    // 5. Validate Metric Name & Title
    if (typeof raw.metricName !== 'string' || raw.metricName.trim() === '') {
      recordErrors.push({
        recordId,
        field: 'metricName',
        value: raw.metricName,
        message: 'metricName is required and must be a non-empty string',
        fatal: true,
      });
    }

    if (typeof raw.title !== 'string' || raw.title.trim() === '') {
      recordErrors.push({
        recordId,
        field: 'title',
        value: raw.title,
        message: 'title is required and must be a non-empty string',
        fatal: true,
      });
    }

    // Check if there were any fatal errors
    const fatalErrors = recordErrors.filter(e => e.fatal);
    if (fatalErrors.length > 0) {
      invalidErrors.push(...recordErrors);
      continue;
    }

    // Record warnings if any
    if (recordErrors.length > 0) {
      invalidErrors.push(...recordErrors);
    }

    // Construct valid normalized record with original ID preserved
    const serviceId = (raw.serviceId as string).trim();
    const serviceName = typeof raw.serviceName === 'string' && raw.serviceName.trim() !== ''
      ? raw.serviceName.trim()
      : (SERVICE_MAP.get(serviceId)?.name || serviceId);

    const sourceMonitor = typeof raw.sourceMonitor === 'string' && VALID_MONITORS.has(raw.sourceMonitor.toLowerCase() as MonitorSource)
      ? (raw.sourceMonitor.toLowerCase() as MonitorSource)
      : 'prometheus';

    const metricValue = typeof raw.metricValue === 'number' && !isNaN(raw.metricValue)
      ? raw.metricValue
      : 1;

    const threshold = typeof raw.threshold === 'number' && !isNaN(raw.threshold)
      ? raw.threshold
      : 1;

    const status = raw.status === 'resolved' ? 'resolved' : 'firing';
    const cluster = typeof raw.cluster === 'string' ? raw.cluster.trim() : 'k8s-prod-us1';
    const region = typeof raw.region === 'string' ? raw.region.trim() : 'us-east-1';

    const normalized: NormalizedAlert = {
      id: raw.id as string, // Original alert ID preserved
      fingerprint: '',      // Computed in deduplicator
      serviceId,
      serviceName,
      severity,
      status,
      metricName: (raw.metricName as string).trim(),
      metricValue,
      threshold,
      title: (raw.title as string).trim(),
      description: typeof raw.description === 'string' ? raw.description.trim() : '',
      sourceMonitor,
      timestamp: isoTimestamp,
      timestampMs,
      environment: raw.environment === 'staging' ? 'staging' : 'production',
      cluster,
      region,
      rawPayload: typeof raw.rawPayload === 'object' && raw.rawPayload !== null
        ? (raw.rawPayload as Record<string, unknown>)
        : {},
      dedupCount: typeof raw.dedupCount === 'number' && raw.dedupCount > 0 ? raw.dedupCount : 1,
      firstSeen: isoTimestamp,
      lastSeen: isoTimestamp,
    };

    validAlerts.push(normalized);
  }

  const report: ValidationReport = {
    totalProcessed: records.length,
    validCount: validAlerts.length,
    invalidCount: invalidErrors.filter(e => e.fatal).length,
    errors: invalidErrors,
  };

  return {
    validAlerts,
    invalidErrors,
    report,
  };
}
