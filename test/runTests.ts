/**
 * Automated Test Runner for Acuity AI Alert Correlation & Incident Detection Platform
 * Validates data contracts, deduplication, conservative correlation, reproducibility,
 * and baseline algorithm evaluation.
 */

import { validateAlertRecords } from '../src/engine/validator';
import { computeStableFingerprint, deduplicateStream, DEFAULT_DEDUP_CONFIG } from '../src/engine/deduplicator';
import { generateSyntheticDataset } from '../src/engine/syntheticGenerator';
import { runConservativeCorrelation } from '../src/engine/correlationEngine';
import { 
  runNoGroupingBaseline, 
  runDedupOnlyBaseline, 
  runSimpleTimeWindowBaseline, 
  runDependencyAwareBaseline 
} from '../src/engine/baselines';
import { calculateEvaluationMetrics } from '../src/engine/metrics';
import { RawAlertRecord, NormalizedAlert } from '../src/types/schemas';

interface TestResult {
  name: string;
  passed: boolean;
  message: string;
  durationMs: number;
}

const results: TestResult[] = [];

function assert(condition: boolean, testName: string, failureMessage: string) {
  if (!condition) {
    throw new Error(`[FAILED] ${testName}: ${failureMessage}`);
  }
}

async function runTest(name: string, fn: () => void | Promise<void>) {
  const start = Date.now();
  try {
    await fn();
    const durationMs = Date.now() - start;
    results.push({ name, passed: true, message: 'OK', durationMs });
    console.log(`✓ PASS: ${name} (${durationMs}ms)`);
  } catch (err: any) {
    const durationMs = Date.now() - start;
    results.push({ name, passed: false, message: err.message, durationMs });
    console.error(`✗ FAIL: ${name} (${durationMs}ms)`);
    console.error(`  ${err.message}`);
  }
}

async function main() {
  console.log('================================================================');
  console.log('ACUITY PLATFORM: AUTOMATED TEST SUITE & BASELINE BENCHMARKS');
  console.log('================================================================\n');

  // ===================================================================
  // 1. DATA CONTRACT VALIDATION TESTS
  // ===================================================================
  await runTest('Validation: Valid records parsed and original ID preserved', () => {
    const records: RawAlertRecord[] = [
      {
        id: 'orig_alert_001',
        serviceId: 'checkout-service',
        timestamp: '2026-10-28T10:00:00Z',
        severity: 'CRITICAL',
        metricName: 'http.504_rate',
        metricValue: 42.0,
        threshold: 1.0,
        title: 'Checkout 504 Gateway Timeout Spike',
      },
    ];

    const { validAlerts, invalidErrors, report } = validateAlertRecords(records);
    assert(report.validCount === 1, 'Valid record count', `Expected 1 valid, got ${report.validCount}`);
    assert(validAlerts[0].id === 'orig_alert_001', 'Original ID preservation', 'Original ID must be preserved');
    assert(validAlerts[0].severity === 'CRITICAL', 'Severity check', 'Severity must match');
  });

  await runTest('Validation: Invalid records reported with exact field errors', () => {
    const badRecords: RawAlertRecord[] = [
      { id: '', serviceId: 'checkout-service', timestamp: 'invalid-date', severity: 'NOT_A_SEVERITY', metricName: '', title: '' },
      { id: 'ok_id', serviceId: '', timestamp: '2026-10-28T10:00:00Z', severity: 'HIGH', metricName: 'cpu', title: 'CPU high' },
    ];

    const { validAlerts, invalidErrors, report } = validateAlertRecords(badRecords);
    assert(validAlerts.length === 0, 'No valid records', 'Bad records must not pass');
    assert(invalidErrors.length >= 4, 'Multiple error details', `Expected >= 4 errors, got ${invalidErrors.length}`);

    const hasTimestampErr = invalidErrors.some(e => e.field === 'timestamp');
    const hasSeverityErr = invalidErrors.some(e => e.field === 'severity');
    const hasServiceErr = invalidErrors.some(e => e.field === 'serviceId');
    assert(hasTimestampErr && hasSeverityErr && hasServiceErr, 'Field error reporting', 'Must report timestamp, severity, and serviceId errors');
  });

  // ===================================================================
  // 2. DEDUPLICATION TESTS
  // ===================================================================
  await runTest('Deduplication: Exact duplicates suppressed into 1 canonical state', () => {
    const baseTime = Date.now();
    const alerts: NormalizedAlert[] = [
      {
        id: 'raw_1',
        fingerprint: '',
        serviceId: 'order-processing-engine',
        serviceName: 'Order Processing',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'db.query.latency',
        metricValue: 5000,
        threshold: 1000,
        title: 'PostgreSQL Query Latency High',
        description: '',
        sourceMonitor: 'prometheus',
        timestamp: new Date(baseTime).toISOString(),
        timestampMs: baseTime,
        environment: 'production',
        cluster: 'k8s-prod',
        region: 'us-east-1',
        rawPayload: {},
        dedupCount: 1,
        firstSeen: '',
        lastSeen: '',
      },
      {
        id: 'raw_2',
        fingerprint: '',
        serviceId: 'order-processing-engine',
        serviceName: 'Order Processing',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'db.query.latency',
        metricValue: 5200,
        threshold: 1000,
        title: 'PostgreSQL Query Latency High',
        description: '',
        sourceMonitor: 'prometheus',
        timestamp: new Date(baseTime + 10000).toISOString(),
        timestampMs: baseTime + 10000,
        environment: 'production',
        cluster: 'k8s-prod',
        region: 'us-east-1',
        rawPayload: {},
        dedupCount: 1,
        firstSeen: '',
        lastSeen: '',
      },
    ];

    const result = deduplicateStream(alerts);
    assert(result.canonicalAlerts.length === 1, 'Single canonical alert', `Expected 1 canonical, got ${result.canonicalAlerts.length}`);
    assert(result.canonicalAlerts[0].rawAlertIds.length === 2, 'Raw ID tracking', 'Both raw IDs must be in rawAlertIds');
    assert(result.suppressionRatio === 0.5, 'Suppression ratio', 'Expected 50% suppression');
  });

  await runTest('Deduplication: Volatile request IDs masked to identical fingerprint', () => {
    const base: any = {
      serviceId: 'checkout-service',
      metricName: 'http.500',
      cluster: 'k8s-prod',
      region: 'us-east-1',
    };

    const fp1 = computeStableFingerprint({ ...base, title: 'HTTP 500 on /checkout req-a82f-9281' });
    const fp2 = computeStableFingerprint({ ...base, title: 'HTTP 500 on /checkout req-9182-1111' });
    const fp3 = computeStableFingerprint({ ...base, title: 'HTTP 500 on /checkout req-b001-ffff' });

    assert(fp1 === fp2 && fp2 === fp3, 'Volatile token masking', `Fingerprints must match despite changing request ID. fp1=${fp1}, fp2=${fp2}`);
  });

  await runTest('Deduplication: Repeated alerts outside sliding window start new canonical window', () => {
    const baseTime = Date.now();
    const alerts: NormalizedAlert[] = [
      {
        id: 'alt_win_1',
        fingerprint: '',
        serviceId: 'auth-gateway',
        serviceName: 'Auth Gateway',
        severity: 'MEDIUM',
        status: 'firing',
        metricName: 'auth.token.expired',
        metricValue: 10,
        threshold: 5,
        title: 'Token Expiry Spike',
        description: '',
        sourceMonitor: 'prometheus',
        timestamp: new Date(baseTime).toISOString(),
        timestampMs: baseTime,
        environment: 'production',
        cluster: 'k8s-prod',
        region: 'us-east-1',
        rawPayload: {},
        dedupCount: 1,
        firstSeen: '',
        lastSeen: '',
      },
      // 25 minutes later (exceeding 15m window)
      {
        id: 'alt_win_2',
        fingerprint: '',
        serviceId: 'auth-gateway',
        serviceName: 'Auth Gateway',
        severity: 'MEDIUM',
        status: 'firing',
        metricName: 'auth.token.expired',
        metricValue: 12,
        threshold: 5,
        title: 'Token Expiry Spike',
        description: '',
        sourceMonitor: 'prometheus',
        timestamp: new Date(baseTime + 25 * 60 * 1000).toISOString(),
        timestampMs: baseTime + 25 * 60 * 1000,
        environment: 'production',
        cluster: 'k8s-prod',
        region: 'us-east-1',
        rawPayload: {},
        dedupCount: 1,
        firstSeen: '',
        lastSeen: '',
      },
    ];

    const result = deduplicateStream(alerts, { ...DEFAULT_DEDUP_CONFIG, windowMinutes: 15 });
    assert(result.canonicalAlerts.length === 2, 'Two canonical windows', `Expected 2 distinct windows, got ${result.canonicalAlerts.length}`);
  });

  // ===================================================================
  // 3. REPRODUCIBILITY TEST
  // ===================================================================
  await runTest('Reproducibility: Identical seeds produce identical datasets and engine outputs', () => {
    const seed = 4242;
    const ds1 = generateSyntheticDataset({ seed, targetAlertCount: 200, split: 'test' });
    const ds2 = generateSyntheticDataset({ seed, targetAlertCount: 200, split: 'test' });

    assert(ds1.alerts.length === ds2.alerts.length, 'Alert length match', 'Dataset lengths must match');
    assert(ds1.alerts[0].id === ds2.alerts[0].id, 'First ID match', 'First alert ID must match');
    assert(ds1.alerts[50].title === ds2.alerts[50].title, 'Title match', 'Alert 50 title must match');

    // Run correlation engine on both
    const { validAlerts: v1 } = validateAlertRecords(ds1.alerts);
    const { validAlerts: v2 } = validateAlertRecords(ds2.alerts);

    const corr1 = runConservativeCorrelation(v1);
    const corr2 = runConservativeCorrelation(v2);

    assert(corr1.predictedGroups.length === corr2.predictedGroups.length, 'Predicted groups match', 'Cluster count must match');
    assert(corr1.acceptedCount === corr2.acceptedCount, 'Accepted edge match', 'Accepted edge count must match');
  });

  // ===================================================================
  // 4. CORRELATION & CONSERVATIVE GROUPING TESTS
  // ===================================================================
  await runTest('Correlation: Unrelated simultaneous incidents NOT falsely merged', () => {
    const now = Date.now();
    // Two completely independent incidents occurring at the EXACT same minute:
    // Incident A: dns-internal in cluster control plane
    // Incident B: clickhouse-analytics in data warehouse
    const rawAlerts: RawAlertRecord[] = [
      // Incident A alerts
      {
        id: 'dns_1',
        serviceId: 'dns-internal',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'coredns.servfail',
        metricValue: 90,
        threshold: 10,
        title: 'CoreDNS Resolution Failure',
        timestamp: new Date(now).toISOString(),
      },
      {
        id: 'dns_2',
        serviceId: 'dns-internal',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'coredns.servfail',
        metricValue: 95,
        threshold: 10,
        title: 'CoreDNS Resolution Failure',
        timestamp: new Date(now + 10000).toISOString(),
      },
      // Incident B alerts (at same minute!)
      {
        id: 'ch_1',
        serviceId: 'clickhouse-analytics',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'clickhouse.mem_limit',
        metricValue: 99,
        threshold: 80,
        title: 'ClickHouse Query Memory Limit Exceeded',
        timestamp: new Date(now + 5000).toISOString(),
      },
      {
        id: 'ch_2',
        serviceId: 'clickhouse-analytics',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'clickhouse.mem_limit',
        metricValue: 100,
        threshold: 80,
        title: 'ClickHouse Query Memory Limit Exceeded',
        timestamp: new Date(now + 15000).toISOString(),
      },
    ];

    const { validAlerts } = validateAlertRecords(rawAlerts);
    const { predictedGroups } = runConservativeCorrelation(validAlerts);

    // Verify they are NOT in the same predicted group!
    const mergedGroup = predictedGroups.find(
      g => g.alertIds.includes('dns_1') && g.alertIds.includes('ch_1')
    );

    assert(!mergedGroup, 'False merge prevention', 'Unrelated DNS and ClickHouse incidents must NOT be merged!');
    assert(predictedGroups.length === 2, 'Two separate groups', `Expected 2 distinct groups, got ${predictedGroups.length}`);
  });

  await runTest('Correlation: Cascading upstream-downstream failure grouped together', () => {
    const now = Date.now();
    // Upstream DB connection exhaustion -> Downstream checkout timeout
    const rawAlerts: RawAlertRecord[] = [
      {
        id: 'pg_root',
        serviceId: 'postgres-orders-primary',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'pg.active_connections_ratio',
        metricValue: 98,
        threshold: 80,
        title: 'Aurora PostgreSQL Max Active Connections Exceeded',
        timestamp: new Date(now).toISOString(),
      },
      {
        id: 'order_mid',
        serviceId: 'order-processing-engine',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'db.query.latency',
        metricValue: 8000,
        threshold: 1000,
        title: 'PostgreSQL Query Latency High',
        timestamp: new Date(now + 15000).toISOString(),
      },
      {
        id: 'checkout_edge',
        serviceId: 'checkout-service',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'http.504_rate',
        metricValue: 40,
        threshold: 1,
        title: 'Checkout Gateway Timeout 504 Spike',
        timestamp: new Date(now + 35000).toISOString(),
      },
    ];

    const { validAlerts } = validateAlertRecords(rawAlerts);
    const { predictedGroups } = runConservativeCorrelation(validAlerts);

    const cascadeGroup = predictedGroups.find(
      g => g.alertIds.includes('pg_root') && g.alertIds.includes('checkout_edge')
    );

    assert(cascadeGroup !== undefined, 'Cascade correlation', 'Cascading DB and checkout alerts must be correlated into same incident');
    assert(cascadeGroup?.probableOrigin?.candidateServiceId === 'postgres-orders-primary', 'Root cause ranking', 'Root cause must be identified as postgres-orders-primary');
  });

  // ===================================================================
  // 5. BASELINE ALGORITHM COMPARISON ON TEST DATASET
  // ===================================================================
  await runTest('Baseline Evaluation: Run and compare all 4 baselines on Test Split', () => {
    const dataset = generateSyntheticDataset({ seed: 777, targetAlertCount: 600, split: 'test' });
    const { validAlerts } = validateAlertRecords(dataset.alerts);

    // Run 4 Baselines
    const predNoGroup = runNoGroupingBaseline(validAlerts);
    const predDedup = runDedupOnlyBaseline(validAlerts);
    const predSimpleTime = runSimpleTimeWindowBaseline(validAlerts, 15);
    const predDepAware = runDependencyAwareBaseline(validAlerts);

    // Compute Metrics for each
    const mNoGroup = calculateEvaluationMetrics(predNoGroup, dataset.groundTruth, validAlerts, 'No Grouping');
    const mDedup = calculateEvaluationMetrics(predDedup, dataset.groundTruth, validAlerts, 'Dedup Only');
    const mTime = calculateEvaluationMetrics(predSimpleTime, dataset.groundTruth, validAlerts, 'Simple Time Window');
    const mDep = calculateEvaluationMetrics(predDepAware, dataset.groundTruth, validAlerts, 'Dependency-Aware Correlation');

    console.log('\n--- BASELINE EVALUATION SCORECARD (Test Split: 600 alerts) ---');
    console.table([
      {
        Algorithm: mNoGroup.algorithm,
        Groups: mNoGroup.totalPredictedGroups,
        'Noise Red%': `${mNoGroup.notificationReductionPercent}%`,
        'Pairwise P': mNoGroup.pairwisePrecision,
        'Pairwise R': mNoGroup.pairwiseRecall,
        'Pairwise F1': mNoGroup.pairwiseF1,
        'False Merges': mNoGroup.falseMerges,
        'False Splits': mNoGroup.falseSplits,
        'Origin Acc': `${(mNoGroup.top1OriginAccuracy * 100).toFixed(0)}%`,
      },
      {
        Algorithm: mDedup.algorithm,
        Groups: mDedup.totalPredictedGroups,
        'Noise Red%': `${mDedup.notificationReductionPercent}%`,
        'Pairwise P': mDedup.pairwisePrecision,
        'Pairwise R': mDedup.pairwiseRecall,
        'Pairwise F1': mDedup.pairwiseF1,
        'False Merges': mDedup.falseMerges,
        'False Splits': mDedup.falseSplits,
        'Origin Acc': `${(mDedup.top1OriginAccuracy * 100).toFixed(0)}%`,
      },
      {
        Algorithm: mTime.algorithm,
        Groups: mTime.totalPredictedGroups,
        'Noise Red%': `${mTime.notificationReductionPercent}%`,
        'Pairwise P': mTime.pairwisePrecision,
        'Pairwise R': mTime.pairwiseRecall,
        'Pairwise F1': mTime.pairwiseF1,
        'False Merges': mTime.falseMerges,
        'False Splits': mTime.falseSplits,
        'Origin Acc': `${(mTime.top1OriginAccuracy * 100).toFixed(0)}%`,
      },
      {
        Algorithm: mDep.algorithm,
        Groups: mDep.totalPredictedGroups,
        'Noise Red%': `${mDep.notificationReductionPercent}%`,
        'Pairwise P': mDep.pairwisePrecision,
        'Pairwise R': mDep.pairwiseRecall,
        'Pairwise F1': mDep.pairwiseF1,
        'False Merges': mDep.falseMerges,
        'False Splits': mDep.falseSplits,
        'Origin Acc': `${(mDep.top1OriginAccuracy * 100).toFixed(0)}%`,
      },
    ]);

    // Validation asserts
    assert(mDep.falseMerges <= mTime.falseMerges, 'False merges', 'Dependency-aware must have fewer or equal false merges than naive time window');
    assert(mDep.pairwisePrecision > mTime.pairwisePrecision, 'Precision check', 'Dependency-aware precision must exceed naive time window');
    assert(mDep.notificationReductionPercent > mDedup.notificationReductionPercent, 'Noise reduction vs dedup', 'Dependency-aware must suppress more noise than dedup-only');
    assert(mDep.notificationReductionPercent > 80, 'Noise reduction', `Noise reduction must be > 80% (got ${mDep.notificationReductionPercent}%)`);
  });

  // ===================================================================
  // 6. SCALED TARGET BENCHMARK (10,000 ALERTS)
  // ===================================================================
  await runTest('Scale Benchmark: 10,000 alert throughput & memory stress test', () => {
    const scaleStart = Date.now();
    const targetCount = 10000;
    const dataset = generateSyntheticDataset({ seed: 999, targetAlertCount: targetCount, split: 'train' });
    const genTimeMs = Date.now() - scaleStart;

    assert(dataset.alerts.length >= 9500, '10k alert count', `Generated ${dataset.alerts.length} alerts`);

    const valStart = Date.now();
    const { validAlerts } = validateAlertRecords(dataset.alerts);
    const valTimeMs = Date.now() - valStart;

    const dedupStart = Date.now();
    const dedupResult = deduplicateStream(validAlerts);
    const dedupTimeMs = Date.now() - dedupStart;

    const corrStart = Date.now();
    const corrResult = runConservativeCorrelation(validAlerts);
    const corrTimeMs = Date.now() - corrStart;

    const totalPipelineTimeMs = Date.now() - scaleStart;

    console.log(`\n--- 10,000 ALERTS SCALE PERFORMANCE REPORT ---`);
    console.log(`- Dataset Generation (10,000 alerts): ${genTimeMs}ms`);
    console.log(`- Schema Validation: ${valTimeMs}ms (${Math.round(dataset.alerts.length / (valTimeMs / 1000))} alerts/sec)`);
    console.log(`- Sliding Window Deduplication: ${dedupTimeMs}ms (Dedup from ${dataset.alerts.length} to ${dedupResult.canonicalAlerts.length})`);
    console.log(`- Conservative Correlation Engine: ${corrTimeMs}ms (${corrResult.predictedGroups.length} incidents detected)`);
    console.log(`- Total End-to-End Pipeline Time: ${totalPipelineTimeMs}ms`);

    assert(totalPipelineTimeMs < 5000, 'Throughput SLA', `Pipeline for 10k alerts must finish under 5000ms (took ${totalPipelineTimeMs}ms)`);
  });

  // ===================================================================
  // SUMMARY
  // ===================================================================
  console.log('\n================================================================');
  console.log('TEST SUMMARY');
  console.log('================================================================');
  const passedCount = results.filter(r => r.passed).length;
  const failedCount = results.filter(r => !r.passed).length;
  console.log(`Total: ${results.length} | Passed: ${passedCount} | Failed: ${failedCount}`);

  if (failedCount > 0) {
    process.exit(1);
  }
}

main().catch(err => {
  console.error('Fatal test error:', err);
  process.exit(1);
});
