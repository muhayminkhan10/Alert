import { RawAlertRecord, GroundTruthIncident, DatasetSplit } from '../types/schemas';
import { DeterministicPRNG } from './prng';
import { SERVICES_TOPOLOGY, getDownstreamBlastRadius, getService } from './topologyData';

export interface GeneratorOptions {
  seed?: number;
  targetAlertCount?: number; // e.g. 1000 for dev, up to 20000 for full target
  split?: DatasetSplit;
  noiseRatio?: number; // 0.20 to 0.40
  delayedAlertRatio?: number; // ratio of alerts with artificial arrival lag
}

export interface GeneratedDataset {
  seed: number;
  split: DatasetSplit;
  totalAlerts: number;
  alerts: RawAlertRecord[]; // Production-clean records with NO ground-truth labels leaked
  groundTruth: GroundTruthIncident[];
}

/**
 * Scenario blueprint templates partitioned strictly across splits
 * to avoid data leakage between Train, Validation, and Test.
 */
interface ScenarioBlueprint {
  id: string;
  category: string;
  title: string;
  rootCauseServiceId: string;
  splits: DatasetSplit[];
  severity: 'CRITICAL' | 'HIGH' | 'MEDIUM';
  cascadeMetric: string;
  rootMetric: string;
  rootTitle: string;
  downstreamTitle: string;
}

const SCENARIO_BLUEPRINTS: ScenarioBlueprint[] = [
  // --- TRAIN ONLY ---
  {
    id: 'sc_train_pg_pool',
    category: 'DATABASE_EXHAUSTION',
    title: 'PostgreSQL Aurora Primary Connection Saturation',
    rootCauseServiceId: 'postgres-orders-primary',
    splits: ['train'],
    severity: 'CRITICAL',
    rootMetric: 'pg.active_connections_ratio',
    cascadeMetric: 'http.504_gateway_timeout_rate',
    rootTitle: 'Aurora PostgreSQL Max Active Connections Exceeded (100% Saturation)',
    downstreamTitle: 'Database Acquisition Timeout Cascading to Downstream API',
  },
  {
    id: 'sc_train_redis_oom',
    category: 'CACHE_EVICTION',
    title: 'Redis Session Cache Memory Max and Eviction Storm',
    rootCauseServiceId: 'redis-session-cache',
    splits: ['train'],
    severity: 'HIGH',
    rootMetric: 'redis.memory_used_percentage',
    cascadeMetric: 'session.validation_miss_rate',
    rootTitle: 'Redis Cluster Memory Limit Breached (Aggressive Key Evictions)',
    downstreamTitle: 'Session Lookup Timeouts and State Cache Invalidation',
  },
  {
    id: 'sc_train_payment_circuit',
    category: 'THIRD_PARTY_OUTAGE',
    title: 'External Payment Gateway Proxy Circuit Breaker Tripped',
    rootCauseServiceId: 'payment-gateway-proxy',
    splits: ['train'],
    severity: 'CRITICAL',
    rootMetric: 'payment.external_503_rate',
    cascadeMetric: 'billing.charge_failed_count',
    rootTitle: 'External Payment Gateway Adapter Circuit Breaker OPEN',
    downstreamTitle: 'Billing Execution Aborted Due to Payment Gateway Refusal',
  },

  // --- VALIDATION ONLY ---
  {
    id: 'sc_val_kafka_lag',
    category: 'STREAMING_PIPELINE',
    title: 'Apache Kafka Event Bus Partition Rebalance & Consumer Lag Surge',
    rootCauseServiceId: 'kafka-cluster-main',
    splits: ['val'],
    severity: 'HIGH',
    rootMetric: 'kafka.consumer_lag_records',
    cascadeMetric: 'pipeline.ingest_delay_seconds',
    rootTitle: 'Kafka Production Cluster Consumer Lag > 900,000 Records',
    downstreamTitle: 'Async Queue Worker Starvation Due to Kafka Broker Backpressure',
  },
  {
    id: 'sc_val_waf_ratelimit',
    category: 'INGRESS_NETWORK',
    title: 'WAF & DDoS Mitigation False Positive Drop Cascade',
    rootCauseServiceId: 'waf-shield',
    splits: ['val'],
    severity: 'CRITICAL',
    rootMetric: 'waf.blocked_requests_rate',
    cascadeMetric: 'edge.http_429_surge',
    rootTitle: 'WAF Shield Heuristic False Trigger Blocking Edge Ingress',
    downstreamTitle: 'Gateway Drop Rate Elevated on Public Ingress Routers',
  },
  {
    id: 'sc_val_search_cluster',
    category: 'SEARCH_INFRASTRUCTURE',
    title: 'Elasticsearch Search Cluster JVM Heap Exhaustion',
    rootCauseServiceId: 'elasticsearch-cluster',
    splits: ['val'],
    severity: 'HIGH',
    rootMetric: 'es.jvm_heap_used_ratio',
    cascadeMetric: 'catalog.search_p99_latency_ms',
    rootTitle: 'Elasticsearch Cluster High GC Pause and Memory Pressure',
    downstreamTitle: 'Catalog Product Query Latency Elevated (>6000ms)',
  },

  // --- TEST ONLY (Includes unseen failure patterns and concurrent outages) ---
  {
    id: 'sc_test_dns_resolver',
    category: 'CONTROL_PLANE_FAILURE',
    title: 'CoreDNS Internal Cluster Resolver Timeout Outage',
    rootCauseServiceId: 'dns-internal',
    splits: ['test'],
    severity: 'CRITICAL',
    rootMetric: 'coredns.servfail_rate',
    cascadeMetric: 'net.dns_lookup_deadline_exceeded',
    rootTitle: 'CoreDNS Internal Resolution Failure (SERVFAIL Storm)',
    downstreamTitle: 'Internal Service Discovery Dial Timeout to Upstream Microservices',
  },
  {
    id: 'sc_test_vault_kms',
    category: 'SECURITY_TOKEN_EXHAUSTION',
    title: 'PCI-DSS Token Vault Hardware HSM Key Expiration',
    rootCauseServiceId: 'token-vault',
    splits: ['test'],
    severity: 'CRITICAL',
    rootMetric: 'vault.kms.certificate_days_remaining',
    cascadeMetric: 'token.encryption_refused_rate',
    rootTitle: 'PCI-DSS Master Cryptographic Key Expiration in <24 Hours',
    downstreamTitle: 'Customer Sensitive Token Encryption Blocked',
  },
  {
    id: 'sc_test_cassandra_disk',
    category: 'UNSEEN_ZERO_DAY_CASCADE',
    title: 'Cassandra Audit Store SSTable Compaction I/O Lockup',
    rootCauseServiceId: 'cassandra-audit-store',
    splits: ['test'],
    severity: 'HIGH',
    rootMetric: 'cassandra.sstable_compaction_wait_time_ms',
    cascadeMetric: 'audit.flush_timeout_rate',
    rootTitle: 'Cassandra Audit Cluster Write Queue Saturation',
    downstreamTitle: 'Audit Logging Buffer Backpressure Across Financial Services',
  },
  {
    id: 'sc_test_concurrent_clickhouse',
    category: 'CONCURRENT_INDEPENDENT_ANALYTICS',
    title: 'ClickHouse Analytics Memory Limit Exception',
    rootCauseServiceId: 'clickhouse-analytics',
    splits: ['test'],
    severity: 'MEDIUM',
    rootMetric: 'clickhouse.query_memory_limit_exceeded',
    cascadeMetric: 'analytics.query_aborted_count',
    rootTitle: 'ClickHouse Columnar Warehouse Query Memory Limit Exceeded',
    downstreamTitle: 'Merchant Reporting Service Failed Query Execution',
  },
];

/**
 * Generates synthetic datasets with 100% reproducibility via PRNG.
 * Completely isolates Ground Truth from inferred alerts (zero label leakage).
 */
export function generateSyntheticDataset(options: GeneratorOptions = {}): GeneratedDataset {
  const seed = options.seed ?? 1337;
  const targetCount = options.targetAlertCount ?? 650;
  const split = options.split ?? 'test';
  const noiseRatio = options.noiseRatio ?? 0.25;
  const delayedRatio = options.delayedAlertRatio ?? 0.08;

  const prng = new DeterministicPRNG(seed);
  const baseTimeMs = Date.now() - 3600 * 1000 * 8; // 8-hour timeline window

  // Filter blueprints valid for this split
  const eligibleBlueprints = SCENARIO_BLUEPRINTS.filter(b => b.splits.includes(split));
  const blueprintsToUse = eligibleBlueprints.length > 0 ? eligibleBlueprints : SCENARIO_BLUEPRINTS;

  const alerts: RawAlertRecord[] = [];
  const groundTruth: GroundTruthIncident[] = [];

  let alertSeq = 0;
  const nextAlertId = () => `alt_s${seed}_${split}_${(++alertSeq).toString().padStart(6, '0')}`;

  // 1. Generate Scenario Incidents
  const scenarioCount = Math.max(2, Math.floor(blueprintsToUse.length));
  const alertsPerScenarioBudget = Math.floor((targetCount * (1 - noiseRatio)) / scenarioCount);

  for (let sIdx = 0; sIdx < scenarioCount; sIdx++) {
    const blueprint = blueprintsToUse[sIdx % blueprintsToUse.length];
    const scenarioStartTimeMs = baseTimeMs + sIdx * 50 * 60 * 1000 + prng.nextIntInRange(0, 10 * 60 * 1000);
    const incidentId = `inc_gt_${split}_${blueprint.id}_${sIdx}`;

    const rootService = getService(blueprint.rootCauseServiceId);
    let downstreamIds = getDownstreamBlastRadius(blueprint.rootCauseServiceId, 3);
    if (downstreamIds.length === 0) {
      // Find caller services that depend on this service, or related tier-1/tier-2 callers
      downstreamIds = SERVICES_TOPOLOGY
        .filter(s => s.dependencies.includes(blueprint.rootCauseServiceId) || s.tier === 1)
        .map(s => s.id)
        .slice(0, 4);
    }
    if (downstreamIds.length === 0) {
      downstreamIds = ['api-gateway-edge', 'checkout-service'];
    }

    const affectedServiceIds = [
      blueprint.rootCauseServiceId,
      ...downstreamIds.slice(0, Math.max(1, prng.nextIntInRange(2, 5))),
    ];

    const incidentAlertIds: string[] = [];

    // Root cause alert generation (with repeats and volatile tokens)
    const rootAlertCount = Math.max(5, Math.floor(alertsPerScenarioBudget * 0.35));
    for (let r = 0; r < rootAlertCount; r++) {
      const alertId = nextAlertId();
      incidentAlertIds.push(alertId);

      const alertTimeMs = scenarioStartTimeMs + r * prng.nextIntInRange(8000, 25000);
      const isVolatileToken = prng.nextBoolean(0.6);
      const volatileToken = isVolatileToken ? ` req-${prng.nextIntInRange(10000, 99999)}` : '';

      alerts.push({
        id: alertId,
        serviceId: blueprint.rootCauseServiceId,
        serviceName: rootService?.name || blueprint.rootCauseServiceId,
        severity: blueprint.severity,
        status: 'firing',
        metricName: blueprint.rootMetric,
        metricValue: Number((85.0 + prng.next() * 14.5).toFixed(1)),
        threshold: 80.0,
        title: `${blueprint.rootTitle}${volatileToken}`,
        description: `Threshold exceeded on ${blueprint.rootCauseServiceId} (metric: ${blueprint.rootMetric}).`,
        sourceMonitor: prng.choose(['prometheus', 'datadog', 'cloudwatch']),
        timestamp: new Date(alertTimeMs).toISOString(),
        environment: 'production',
        cluster: rootService?.cluster || 'k8s-prod-us1',
        region: rootService?.region || 'us-east-1',
        rawPayload: {
          node: `node-${prng.nextIntInRange(1, 12)}`,
          incident_trace: `span-${prng.nextIntInRange(1000, 9999)}`,
        },
      });
    }

    // Downstream cascade alerts
    const cascadeAlertCount = Math.max(5, alertsPerScenarioBudget - rootAlertCount);
    const downstreamPool = affectedServiceIds.slice(1);

    for (let c = 0; c < cascadeAlertCount; c++) {
      const downstreamSvcId = downstreamPool.length > 0
        ? prng.choose(downstreamPool)
        : blueprint.rootCauseServiceId;
      const downstreamSvc = getService(downstreamSvcId);
      const alertId = nextAlertId();
      incidentAlertIds.push(alertId);

      // Downstream arrives with latency lag (15s to 90s after root onset)
      const cascadeLagMs = prng.nextIntInRange(15000, 90000) + c * prng.nextIntInRange(5000, 20000);
      let alertTimeMs = scenarioStartTimeMs + cascadeLagMs;

      // Delayed / Out-of-order event injection
      if (prng.nextBoolean(delayedRatio)) {
        alertTimeMs -= prng.nextIntInRange(30000, 120000); // Clock skew or collector lag
      }

      const isVolatile = prng.nextBoolean(0.5);
      const volatileToken = isVolatile ? ` trace-${prng.nextIntInRange(100000, 999999)}` : '';

      alerts.push({
        id: alertId,
        serviceId: downstreamSvcId,
        serviceName: downstreamSvc?.name || downstreamSvcId,
        severity: blueprint.severity === 'CRITICAL' && prng.nextBoolean(0.5) ? 'CRITICAL' : 'HIGH',
        status: 'firing',
        metricName: blueprint.cascadeMetric,
        metricValue: Number((2500 + prng.next() * 4000).toFixed(0)),
        threshold: 1000,
        title: `${blueprint.downstreamTitle}${volatileToken}`,
        description: `Downstream service ${downstreamSvcId} degraded while communicating with upstream dependencies.`,
        sourceMonitor: prng.choose(['prometheus', 'datadog', 'sentry', 'kafka-lag']),
        timestamp: new Date(alertTimeMs).toISOString(),
        environment: 'production',
        cluster: downstreamSvc?.cluster || 'k8s-tier1-prod',
        region: downstreamSvc?.region || 'us-east-1',
        rawPayload: {
          downstream_caller: downstreamSvcId,
          error_code: 'UPSTREAM_DEADLINE_EXCEEDED',
        },
      });
    }

    groundTruth.push({
      id: incidentId,
      scenarioId: blueprint.id,
      split,
      category: blueprint.category,
      title: blueprint.title,
      rootCauseServiceId: blueprint.rootCauseServiceId,
      affectedServiceIds,
      alertIds: incidentAlertIds,
      startTime: new Date(scenarioStartTimeMs).toISOString(),
      endTime: new Date(scenarioStartTimeMs + 45 * 60 * 1000).toISOString(),
      isCritical: blueprint.severity === 'CRITICAL',
    });
  }

  // 2. Generate Critical Independent Alerts (Unrelated genuine single alarms)
  const criticalIndepCount = prng.nextIntInRange(2, 5);
  for (let ci = 0; ci < criticalIndepCount; ci++) {
    const alertId = nextAlertId();
    const svc = prng.choose(SERVICES_TOPOLOGY);
    const ts = baseTimeMs + prng.nextIntInRange(0, 3600 * 1000 * 7);

    alerts.push({
      id: alertId,
      serviceId: svc.id,
      serviceName: svc.name,
      severity: 'CRITICAL',
      status: 'firing',
      metricName: 'security.tls.cert_expiry_days',
      metricValue: 1.0,
      threshold: 7.0,
      title: `Critical TLS Certificate Expiration on ${svc.name}`,
      description: 'Service TLS leaf certificate will expire in less than 24 hours.',
      sourceMonitor: 'cloudwatch',
      timestamp: new Date(ts).toISOString(),
      environment: 'production',
      cluster: svc.cluster,
      region: svc.region,
      rawPayload: { cert_id: `cert-${prng.nextIntInRange(100, 999)}` },
    });

    groundTruth.push({
      id: `inc_gt_indep_${alertId}`,
      scenarioId: 'independent_critical_tls',
      split,
      category: 'INDEPENDENT_SECURITY_ALERT',
      title: `Critical TLS Certificate Expiry on ${svc.name}`,
      rootCauseServiceId: svc.id,
      affectedServiceIds: [svc.id],
      alertIds: [alertId],
      startTime: new Date(ts).toISOString(),
      endTime: new Date(ts + 10 * 60 * 1000).toISOString(),
      isCritical: true,
    });
  }

  // 3. Generate Routine Noise & Flapping Alerts
  const remainingBudget = Math.max(20, targetCount - alerts.length);
  const backgroundServices = SERVICES_TOPOLOGY;

  for (let n = 0; n < remainingBudget; n++) {
    const svc = prng.choose(backgroundServices);
    const alertId = nextAlertId();
    const ts = baseTimeMs + prng.nextIntInRange(0, 3600 * 1000 * 8);

    const isFlap = prng.nextBoolean(0.6);
    const severity = isFlap ? 'LOW' : prng.nextBoolean(0.3) ? 'MEDIUM' : 'INFO';

    alerts.push({
      id: alertId,
      serviceId: svc.id,
      serviceName: svc.name,
      severity,
      status: 'firing',
      metricName: isFlap ? 'node.cpu.transient_high' : 'sys.memory.working_set_bytes',
      metricValue: isFlap ? Number((80.5 + prng.next() * 3).toFixed(1)) : 62.0,
      threshold: 80.0,
      title: isFlap
        ? `Transient CPU threshold breach on ${svc.name}`
        : `Routine periodic health check on ${svc.name}`,
      description: 'Background telemetry notification without customer-facing impact.',
      sourceMonitor: prng.choose(['prometheus', 'datadog', 'cloudwatch']),
      timestamp: new Date(ts).toISOString(),
      environment: 'production',
      cluster: svc.cluster,
      region: svc.region,
      rawPayload: { flap_seq: n },
    });
  }

  // Shuffle alerts slightly or sort chronologically to simulate real ingestion
  alerts.sort((a, b) => new Date(a.timestamp as string).getTime() - new Date(b.timestamp as string).getTime());

  return {
    seed,
    split,
    totalAlerts: alerts.length,
    alerts,
    groundTruth,
  };
}
