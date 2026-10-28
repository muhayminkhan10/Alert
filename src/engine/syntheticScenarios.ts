import { Alert, GroundTruthScenario } from '../types';
import { SERVICES_TOPOLOGY, getService } from './topologyData';
import { generateFingerprint, normalizeAlert } from './deduplicator';

/**
 * Creates 5 comprehensive ground truth failure scenarios with known causal relationships.
 */
export function getGroundTruthScenarios(): GroundTruthScenario[] {
  const baseTime = Date.now() - 3600 * 1000 * 4; // 4 hours ago

  // =========================================================================
  // SCENARIO 1: PostgreSQL Connection Pool Exhaustion (High-Impact Cascade)
  // =========================================================================
  const s1Alerts: Alert[] = [];
  const s1Time = baseTime;

  // Root Cause: postgres-orders-primary
  for (let i = 0; i < 35; i++) {
    const ts = new Date(s1Time + i * 15000).toISOString();
    s1Alerts.push(
      normalizeAlert({
        id: `sc1_pg_${i}`,
        serviceId: 'postgres-orders-primary',
        serviceName: 'PostgreSQL Orders Primary DB (Aurora)',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'pg.connections.active_ratio',
        metricValue: 98.4 + (i % 3) * 0.5,
        threshold: 85.0,
        title: 'Aurora PostgreSQL Max Active Connections Exceeded (100% Saturation)',
        description: 'Connection pool exhausted (active_connections=498/500). Incoming queries are queued or timing out.',
        sourceMonitor: 'cloudwatch',
        timestamp: ts,
        cluster: 'db-cluster-orders',
        region: 'us-east-1',
        scenarioId: 'scenario-db-exhaustion',
      })
    );
  }

  // 1st downstream hop: order-processing-engine (lag ~20s)
  for (let i = 0; i < 28; i++) {
    const ts = new Date(s1Time + 20000 + i * 20000).toISOString();
    s1Alerts.push(
      normalizeAlert({
        id: `sc1_ord_${i}`,
        serviceId: 'order-processing-engine',
        serviceName: 'Order Processing & State Machine',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'db.query.p99_latency_ms',
        metricValue: 8400,
        threshold: 500,
        title: 'PostgreSQL Query Latency Spike (>8.4s p99)',
        description: 'Order state transitions failing due to DB acquisition timeout.',
        sourceMonitor: 'datadog',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-db-exhaustion',
      })
    );
  }

  // 1st downstream hop: inventory-management (lag ~35s)
  for (let i = 0; i < 20; i++) {
    const ts = new Date(s1Time + 35000 + i * 25000).toISOString();
    s1Alerts.push(
      normalizeAlert({
        id: `sc1_inv_${i}`,
        serviceId: 'inventory-management',
        serviceName: 'Realtime Inventory Management',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'inventory.reserve_lock.timeout_rate',
        metricValue: 24.5,
        threshold: 2.0,
        title: 'Inventory Stock Reservation Lock Timeouts',
        description: 'Unable to commit stock allocation locks due to blocking order DB transaction.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-db-exhaustion',
      })
    );
  }

  // 2nd downstream hop: checkout-service (lag ~50s)
  for (let i = 0; i < 30; i++) {
    const ts = new Date(s1Time + 50000 + i * 20000).toISOString();
    s1Alerts.push(
      normalizeAlert({
        id: `sc1_chk_${i}`,
        serviceId: 'checkout-service',
        serviceName: 'Checkout Orchestration Service',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'http.504.rate_percentage',
        metricValue: 42.1,
        threshold: 1.0,
        title: 'Checkout Gateway Timeout (504 Rate Spike)',
        description: 'Downstream call to order-processing-engine exceeded deadline of 5000ms.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-db-exhaustion',
      })
    );
  }

  // 3rd downstream hop: api-gateway-edge (lag ~75s)
  for (let i = 0; i < 40; i++) {
    const ts = new Date(s1Time + 75000 + i * 15000).toISOString();
    s1Alerts.push(
      normalizeAlert({
        id: `sc1_gw_${i}`,
        serviceId: 'api-gateway-edge',
        serviceName: 'Public API Gateway Edge',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'edge.http_5xx.count',
        metricValue: 1250,
        threshold: 50,
        title: 'Public Edge Ingress 5xx Spike on /v2/checkout',
        description: 'Customer facing transactions failing at edge with HTTP 504 and 502.',
        sourceMonitor: 'datadog',
        timestamp: ts,
        cluster: 'k8s-ingress-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-db-exhaustion',
      })
    );
  }

  // =========================================================================
  // SCENARIO 2: Third-Party Payment Gateway Provider Outage
  // =========================================================================
  const s2Alerts: Alert[] = [];
  const s2Time = baseTime + 45 * 60 * 1000; // 45m later

  // Root: payment-gateway-proxy
  for (let i = 0; i < 25; i++) {
    const ts = new Date(s2Time + i * 20000).toISOString();
    s2Alerts.push(
      normalizeAlert({
        id: `sc2_pay_${i}`,
        serviceId: 'payment-gateway-proxy',
        serviceName: 'Payment Gateway Proxy & Adapter',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'payment.external_provider.circuit_breaker',
        metricValue: 1,
        threshold: 0,
        title: 'External Payment Gateway Circuit Breaker OPEN',
        description: 'Stripe/Adyen external endpoint connection refused and 503 response rate > 90%.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-payment-provider-down',
      })
    );
  }

  // Downstream: billing-service
  for (let i = 0; i < 18; i++) {
    const ts = new Date(s2Time + 25000 + i * 25000).toISOString();
    s2Alerts.push(
      normalizeAlert({
        id: `sc2_bil_${i}`,
        serviceId: 'billing-service',
        serviceName: 'Billing & Invoice Ledger Service',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'billing.charge_attempts.failed_rate',
        metricValue: 88.2,
        threshold: 5.0,
        title: 'Billing Charge Execution Failure Surge',
        description: 'Charges failing with PAYMENT_PROVIDER_UNAVAILABLE.',
        sourceMonitor: 'datadog',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-payment-provider-down',
      })
    );
  }

  // Downstream: wallet-service
  for (let i = 0; i < 15; i++) {
    const ts = new Date(s2Time + 40000 + i * 30000).toISOString();
    s2Alerts.push(
      normalizeAlert({
        id: `sc2_wal_${i}`,
        serviceId: 'wallet-service',
        serviceName: 'Stored Value Digital Wallet',
        severity: 'MEDIUM',
        status: 'firing',
        metricName: 'wallet.topup.failure_count',
        metricValue: 140,
        threshold: 10,
        title: 'Digital Wallet Top-up Failure Count High',
        description: 'Top-ups rejected by upstream payment proxy.',
        sourceMonitor: 'sentry',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-payment-provider-down',
      })
    );
  }

  // =========================================================================
  // SCENARIO 3: Redis Session Eviction & OOM Cascade
  // =========================================================================
  const s3Alerts: Alert[] = [];
  const s3Time = baseTime + 90 * 60 * 1000; // 90m later

  // Root: redis-session-cache
  for (let i = 0; i < 30; i++) {
    const ts = new Date(s3Time + i * 15000).toISOString();
    s3Alerts.push(
      normalizeAlert({
        id: `sc3_red_${i}`,
        serviceId: 'redis-session-cache',
        serviceName: 'Redis Cluster: Sessions & Carts',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'redis.memory.used_percentage',
        metricValue: 99.8,
        threshold: 85.0,
        title: 'Redis Session Cache Memory Full (OOM Eviction Storm)',
        description: 'Key evictions spiked to 14,000 keys/sec; maxmemory reached on shard-01.',
        sourceMonitor: 'cloudwatch',
        timestamp: ts,
        cluster: 'redis-cache-cluster',
        region: 'us-east-1',
        scenarioId: 'scenario-redis-oom',
      })
    );
  }

  // Downstream: auth-gateway
  for (let i = 0; i < 22; i++) {
    const ts = new Date(s3Time + 20000 + i * 20000).toISOString();
    s3Alerts.push(
      normalizeAlert({
        id: `sc3_ath_${i}`,
        serviceId: 'auth-gateway',
        serviceName: 'Authentication & Session Edge Gateway',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'auth.session.validation_miss_rate',
        metricValue: 65.4,
        threshold: 5.0,
        title: 'User Session Cache Miss Rate Exceeded',
        description: 'Sudden invalidation of customer login tokens due to evicted sessions.',
        sourceMonitor: 'datadog',
        timestamp: ts,
        cluster: 'k8s-ingress-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-redis-oom',
      })
    );
  }

  // Downstream: cart-orchestrator
  for (let i = 0; i < 25; i++) {
    const ts = new Date(s3Time + 30000 + i * 20000).toISOString();
    s3Alerts.push(
      normalizeAlert({
        id: `sc3_crt_${i}`,
        serviceId: 'cart-orchestrator',
        serviceName: 'Shopping Cart Session Service',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'cart.redis_timeout.rate',
        metricValue: 31.8,
        threshold: 2.0,
        title: 'Cart Fetch Timeouts on Redis Cluster',
        description: 'Customer cart retrievals timing out on Redis shard-01.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-tier1-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-redis-oom',
      })
    );
  }

  // =========================================================================
  // SCENARIO 4: Two Concurrent Independent Outages (False Merge Stress Test)
  // Must be detected as 2 SEPARATE incidents despite firing at the exact same minute!
  // =========================================================================
  const s4Alerts: Alert[] = [];
  const s4Time = baseTime + 140 * 60 * 1000; // 140m later

  // Sub-Incident A: CoreDNS Internal Cluster Resolver failure in k8s-control-plane
  for (let i = 0; i < 20; i++) {
    const ts = new Date(s4Time + i * 15000).toISOString();
    s4Alerts.push(
      normalizeAlert({
        id: `sc4_dns_${i}`,
        serviceId: 'dns-internal',
        serviceName: 'CoreDNS Internal Cluster Resolver',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'coredns.dns_request_errors.rate',
        metricValue: 55.0,
        threshold: 5.0,
        title: 'CoreDNS Request Failure Rate Spike (SERVFAIL)',
        description: 'Internal kube-dns query timeouts across namespace resolution.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-control-plane',
        region: 'us-east-1',
        scenarioId: 'scenario-concurrent-outages',
      })
    );
  }

  // Sub-Incident B: Kafka Event Bus Consumer Lag Spike in analytics pipeline (unrelated domain!)
  for (let i = 0; i < 20; i++) {
    const ts = new Date(s4Time + 5000 + i * 15000).toISOString();
    s4Alerts.push(
      normalizeAlert({
        id: `sc4_kfk_${i}`,
        serviceId: 'kafka-event-bus',
        serviceName: 'Kafka Realtime Event Bus (Analytics)',
        severity: 'HIGH',
        status: 'firing',
        metricName: 'kafka.consumer_lag.records',
        metricValue: 850000,
        threshold: 50000,
        title: 'Kafka Clickstream Consumer Lag Surge (>850k msgs)',
        description: 'Partition rebalance storm blocking real-time event analytics ingestion.',
        sourceMonitor: 'kafka-lag',
        timestamp: ts,
        cluster: 'kafka-analytics-cluster',
        region: 'us-east-1',
        scenarioId: 'scenario-concurrent-outages',
      })
    );
  }

  // =========================================================================
  // SCENARIO 5: Noise Storm (Flaky worker alerts) + 1 Real HSM Certificate Alert
  // =========================================================================
  const s5Alerts: Alert[] = [];
  const s5Time = baseTime + 190 * 60 * 1000;

  // 80 flaky/flapping alerts on media-transcoder and sitemap-generator (no incident)
  for (let i = 0; i < 40; i++) {
    const ts = new Date(s5Time + i * 30000).toISOString();
    s5Alerts.push(
      normalizeAlert({
        id: `sc5_noise_media_${i}`,
        serviceId: 'media-transcoder',
        serviceName: 'Asset Media Transcoder & Resizer',
        severity: 'LOW',
        status: 'firing',
        metricName: 'node.cpu.transient_spike',
        metricValue: 82.5,
        threshold: 80.0,
        title: 'CPU Usage Exceeded 80% on media-worker pod',
        description: 'Transient video compression burst triggered threshold for 12 seconds.',
        sourceMonitor: 'prometheus',
        timestamp: ts,
        cluster: 'k8s-workers-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-noise-storm',
      })
    );
    s5Alerts.push(
      normalizeAlert({
        id: `sc5_noise_site_${i}`,
        serviceId: 'sitemap-generator',
        serviceName: 'SEO Sitemap & Feed Generator',
        severity: 'LOW',
        status: 'firing',
        metricName: 'disk.temp_usage.percent',
        metricValue: 76.0,
        threshold: 75.0,
        title: 'Ephemeral Temp Storage Above 75%',
        description: 'Nightly crawler cache build temporarily used disk space.',
        sourceMonitor: 'cloudwatch',
        timestamp: ts,
        cluster: 'k8s-workers-prod',
        region: 'us-east-1',
        scenarioId: 'scenario-noise-storm',
      })
    );
  }

  // The 1 REAL genuine alert: token-vault HSM key expiry
  for (let i = 0; i < 5; i++) {
    const ts = new Date(s5Time + 120000 + i * 20000).toISOString();
    s5Alerts.push(
      normalizeAlert({
        id: `sc5_vault_${i}`,
        serviceId: 'token-vault',
        serviceName: 'PCI-DSS Token Vault & Key Management',
        severity: 'CRITICAL',
        status: 'firing',
        metricName: 'vault.kms.certificate_days_remaining',
        metricValue: 1.0,
        threshold: 7.0,
        title: 'PCI-DSS Token Vault Master Key Expiration in <24 Hours',
        description: 'Hardware Security Module encryption key rotation required immediately.',
        sourceMonitor: 'sentry',
        timestamp: ts,
        cluster: 'k8s-secure-enclave',
        region: 'us-east-1',
        scenarioId: 'scenario-noise-storm',
      })
    );
  }

  return [
    {
      id: 'scenario-db-exhaustion',
      name: 'PostgreSQL Connection Pool Exhaustion',
      category: 'INFRASTRUCTURE_FAILURE',
      description: 'Primary Aurora DB runs out of connections, cascading into 504 gateway timeouts at the edge.',
      injectedRootCauseService: 'postgres-orders-primary',
      expectedIncidentCount: 1,
      expectedRootCause: 'postgres-orders-primary',
      expectedGroupings: [
        [
          'postgres-orders-primary',
          'order-processing-engine',
          'inventory-management',
          'checkout-service',
          'api-gateway-edge',
        ],
      ],
      alerts: s1Alerts,
    },
    {
      id: 'scenario-payment-provider-down',
      name: 'External Payment Gateway Outage',
      category: 'DEPENDENCY_OUTAGE',
      description: 'Upstream payment processor failure triggering circuit breaker and checkout failures.',
      injectedRootCauseService: 'payment-gateway-proxy',
      expectedIncidentCount: 1,
      expectedRootCause: 'payment-gateway-proxy',
      expectedGroupings: [
        ['payment-gateway-proxy', 'billing-service', 'wallet-service'],
      ],
      alerts: s2Alerts,
    },
    {
      id: 'scenario-redis-oom',
      name: 'Redis Cache OOM Eviction Storm',
      category: 'DATA_CORRUPTION',
      description: 'Redis session cache reaches maxmemory, triggering key eviction and auth session loss.',
      injectedRootCauseService: 'redis-session-cache',
      expectedIncidentCount: 1,
      expectedRootCause: 'redis-session-cache',
      expectedGroupings: [
        ['redis-session-cache', 'auth-gateway', 'cart-orchestrator'],
      ],
      alerts: s3Alerts,
    },
    {
      id: 'scenario-concurrent-outages',
      name: 'Two Concurrent Disconnected Outages (False Merge Stress Test)',
      category: 'MULTI_INCIDENT_CONCURRENT',
      description: 'CoreDNS failure in cluster control plane occurring at the exact same minute as Kafka consumer lag in analytics pipeline. Must NOT be merged into a single incident.',
      injectedRootCauseService: 'dns-internal',
      expectedIncidentCount: 2,
      expectedRootCause: 'dns-internal and kafka-event-bus',
      expectedGroupings: [
        ['dns-internal'],
        ['kafka-event-bus'],
      ],
      alerts: s4Alerts,
    },
    {
      id: 'scenario-noise-storm',
      name: 'Background Flapping Storm + Critical Vault Alert',
      category: 'NOISE_STORM',
      description: '80 low-priority flapping alerts across batch workers with 1 genuine PCI token vault expiration warning.',
      injectedRootCauseService: 'token-vault',
      expectedIncidentCount: 3, // Flapping noise states + 1 real token vault incident
      expectedRootCause: 'token-vault',
      expectedGroupings: [
        ['token-vault'],
      ],
      alerts: s5Alerts,
    },
  ];
}

/**
 * Generates a full day of synthetic production alerts (approx 550 - 750 raw alerts)
 * representing 70 microservices, background noise, periodic maintenance, and realistic incidents.
 */
export function generateFullDayProductionDataset(): {
  alerts: Alert[];
  scenarios: GroundTruthScenario[];
} {
  const scenarios = getGroundTruthScenarios();
  const allAlerts: Alert[] = [];

  // Add all scenario alerts
  scenarios.forEach(sc => {
    allAlerts.push(...sc.alerts);
  });

  // Add ~150 random baseline background monitoring alerts spread across other services
  const baseTime = Date.now() - 3600 * 1000 * 6;
  const backgroundServices = SERVICES_TOPOLOGY.filter(
    s => !['postgres-orders-primary', 'payment-gateway-proxy', 'dns-internal'].includes(s.id)
  );

  const monitors: ('prometheus' | 'datadog' | 'cloudwatch' | 'sentry')[] = [
    'prometheus',
    'datadog',
    'cloudwatch',
    'sentry',
  ];

  for (let i = 0; i < 160; i++) {
    const svc = backgroundServices[i % backgroundServices.length];
    const timeOffset = Math.floor(Math.random() * (3600 * 1000 * 6));
    const ts = new Date(baseTime + timeOffset).toISOString();

    const isFlap = i % 5 === 0;
    const severity = isFlap ? 'LOW' : i % 8 === 0 ? 'MEDIUM' : 'INFO';

    allAlerts.push(
      normalizeAlert({
        id: `bg_alt_${i}_${Date.now().toString(36)}`,
        serviceId: svc.id,
        serviceName: svc.name,
        severity,
        status: 'firing',
        metricName: isFlap ? 'worker.cpu.transient_high' : 'system.memory.working_set_bytes',
        metricValue: isFlap ? 81.2 : 65.0,
        threshold: isFlap ? 80.0 : 80.0,
        title: isFlap
          ? `Flapping: CPU threshold breached on ${svc.id}`
          : `Routine check notification on ${svc.id}`,
        description: `Routine metric alert generated by background telemetry agent for ${svc.name}.`,
        sourceMonitor: monitors[i % monitors.length],
        timestamp: ts,
        cluster: svc.cluster,
        region: svc.region,
      })
    );
  }

  // Sort chronologically
  allAlerts.sort((a, b) => new Date(a.timestamp).getTime() - new Date(b.timestamp).getTime());

  return {
    alerts: allAlerts,
    scenarios,
  };
}
