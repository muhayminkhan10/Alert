import { 
  NormalizedAlert, 
  CanonicalAlert, 
  CandidateRelationship, 
  CandidateOutcome, 
  PredictedGroup, 
  ProbableOriginRanking,
  AlertSeverity
} from '../types/schemas';
import { getService, getTopologyDistance, getDownstreamBlastRadius, SERVICES_TOPOLOGY } from './topologyData';
import { deduplicateStream } from './deduplicator';

export interface CorrelationEngineConfig {
  temporalWindowMinutes: number;
  maxTopologyDistance: number;
  acceptScoreThreshold: number;
  uncertainScoreThreshold: number;
  minClusterDensity: number; // Minimum edge density to avoid weak transitive chaining
  maxClusterDiameter: number; // Maximum graph hops between any two members
}

export const DEFAULT_CORRELATION_CONFIG: CorrelationEngineConfig = {
  temporalWindowMinutes: 20,
  maxTopologyDistance: 3,
  acceptScoreThreshold: 0.65,
  uncertainScoreThreshold: 0.42,
  minClusterDensity: 0.35,
  maxClusterDiameter: 3,
};

/**
 * Computes transparent pairwise correlation with detailed individual evidence contributions.
 */
export function evaluatePairwiseEvidence(
  a: NormalizedAlert,
  b: NormalizedAlert,
  config: CorrelationEngineConfig = DEFAULT_CORRELATION_CONFIG
): CandidateRelationship {
  const reasons: string[] = [];

  // 1. Temporal Proximity
  const deltaMs = Math.abs(a.timestampMs - b.timestampMs);
  const deltaMinutes = deltaMs / 60000;

  let temporalScore = 0;
  if (deltaMinutes <= config.temporalWindowMinutes) {
    temporalScore = Math.exp(-deltaMinutes / (config.temporalWindowMinutes / 2));
    if (temporalScore > 0.7) {
      reasons.push(`Close onset proximity (Δ${deltaMinutes.toFixed(1)}m)`);
    }
  } else {
    reasons.push(`Outside temporal window (Δ${deltaMinutes.toFixed(1)}m > ${config.temporalWindowMinutes}m)`);
  }

  // 2. Topological Dependency Distance & Direction
  const distance = getTopologyDistance(a.serviceId, b.serviceId);
  let topologicalScore = 0;

  if (distance === 0) {
    topologicalScore = 1.0;
    reasons.push(`Identical service: ${a.serviceName}`);
  } else if (distance === 1) {
    topologicalScore = 0.90;
    reasons.push(`Direct dependency link between ${a.serviceId} and ${b.serviceId}`);
  } else if (distance === 2) {
    topologicalScore = 0.55;
    reasons.push(`2-hop dependency between ${a.serviceId} and ${b.serviceId}`);
  } else if (distance === 3) {
    topologicalScore = 0.25;
    reasons.push(`3-hop dependency between ${a.serviceId} and ${b.serviceId}`);
  } else {
    topologicalScore = 0.0;
    reasons.push(`No topology dependency connection (distance: ${distance === Infinity ? 'disconnected' : distance})`);
  }

  // Directional cascade bonus: if alert A is upstream of B and A fired first
  if (distance === 1) {
    const isADownstreamOfB = getDownstreamBlastRadius(b.serviceId, 1).includes(a.serviceId);
    const isBDownstreamOfA = getDownstreamBlastRadius(a.serviceId, 1).includes(b.serviceId);
    if ((isBDownstreamOfA && a.timestampMs <= b.timestampMs) || (isADownstreamOfB && b.timestampMs <= a.timestampMs)) {
      topologicalScore = Math.min(1.0, topologicalScore + 0.10);
      reasons.push('Directional causality: upstream failure preceded downstream event');
    }
  }

  // 3. Semantic & Failure Pattern Synergy
  let semanticScore = 0.40;
  const aText = `${a.metricName} ${a.title}`.toLowerCase();
  const bText = `${b.metricName} ${b.title}`.toLowerCase();

  const isRootSymptom = (text: string) =>
    text.includes('connection') ||
    text.includes('saturation') ||
    text.includes('oom') ||
    text.includes('memory') ||
    text.includes('disk') ||
    text.includes('circuit_breaker') ||
    text.includes('servfail');

  const isCascadeSymptom = (text: string) =>
    text.includes('504') ||
    text.includes('timeout') ||
    text.includes('latency') ||
    text.includes('drop') ||
    text.includes('aborted') ||
    text.includes('backpressure') ||
    text.includes('error');

  if ((isRootSymptom(aText) && isCascadeSymptom(bText)) || (isRootSymptom(bText) && isCascadeSymptom(aText))) {
    semanticScore = 0.90;
    reasons.push('Root-cause to downstream timeout/error cascade pattern detected');
  } else if (isCascadeSymptom(aText) && isCascadeSymptom(bText)) {
    semanticScore = 0.70;
    reasons.push('Co-occurring downstream cascade degradation symptoms');
  }

  // 4. Locality
  let localityScore = 0.0;
  if (a.region === b.region) localityScore += 0.05;
  if (a.cluster === b.cluster) localityScore += 0.05;

  // If services are completely disconnected topologically, strictly zero out unless same service
  let totalScore = 0;
  if (topologicalScore > 0) {
    totalScore = Math.min(
      1.0,
      temporalScore * 0.40 +
      topologicalScore * 0.45 +
      semanticScore * 0.15 +
      localityScore
    );
  }

  let outcome: CandidateOutcome = 'REJECTED';
  if (totalScore >= config.acceptScoreThreshold) {
    outcome = 'ACCEPTED';
  } else if (totalScore >= config.uncertainScoreThreshold) {
    outcome = 'UNCERTAIN';
  }

  return {
    alertAId: a.id,
    alertBId: b.id,
    evidence: {
      temporalScore: Number(temporalScore.toFixed(3)),
      topologicalScore: Number(topologicalScore.toFixed(3)),
      semanticScore: Number(semanticScore.toFixed(3)),
      localityScore: Number(localityScore.toFixed(3)),
      totalScore: Number(totalScore.toFixed(3)),
      reasons,
    },
    outcome,
  };
}

/**
 * Conservative grouping algorithm.
 * Rejects unrestricted transitive connected-components that could bridge unrelated incidents
 * via weak links. Enforces maximum cluster diameter and minimum internal link cohesion.
 */
export function runConservativeCorrelation(
  alerts: NormalizedAlert[],
  config: CorrelationEngineConfig = DEFAULT_CORRELATION_CONFIG
): {
  predictedGroups: PredictedGroup[];
  relationships: CandidateRelationship[];
  acceptedCount: number;
  uncertainCount: number;
} {
  if (alerts.length === 0) {
    return {
      predictedGroups: [],
      relationships: [],
      acceptedCount: 0,
      uncertainCount: 0,
    };
  }

  // Step 1: Deduplicate repetitious alert events first
  const { canonicalAlerts } = deduplicateStream(alerts);
  // Sort chronologically for sliding-window fast candidate generation
  canonicalAlerts.sort((a, b) => a.timestampMs - b.timestampMs);
  const n = canonicalAlerts.length;
  const windowMs = config.temporalWindowMinutes * 60 * 1000;

  // Step 2: Generate candidate relationships
  const relationships: CandidateRelationship[] = [];
  const acceptedAdj = new Map<number, Set<number>>();
  const uncertainEdges = new Map<number, Set<number>>();

  for (let i = 0; i < n; i++) {
    acceptedAdj.set(i, new Set());
    uncertainEdges.set(i, new Set());
  }

  let acceptedCount = 0;
  let uncertainCount = 0;

  for (let i = 0; i < n; i++) {
    const alertI = canonicalAlerts[i];
    for (let j = i + 1; j < n; j++) {
      const alertJ = canonicalAlerts[j];
      // Since alerts are sorted chronologically, break early once outside window
      if (alertJ.timestampMs - alertI.timestampMs > windowMs) {
        break;
      }

      const rel = evaluatePairwiseEvidence(alertI, alertJ, config);
      relationships.push(rel);

      if (rel.outcome === 'ACCEPTED') {
        acceptedAdj.get(i)!.add(j);
        acceptedAdj.get(j)!.add(i);
        acceptedCount++;
      } else if (rel.outcome === 'UNCERTAIN') {
        uncertainEdges.get(i)!.add(j);
        uncertainEdges.get(j)!.add(i);
        uncertainCount++;
      }
    }
  }

  // Step 3: Conservative Community / Cluster Formation
  // Instead of unbounded connected-components, we partition components
  // that violate maximum diameter or cohesion constraints.
  const visited = new Set<number>();
  const rawClusters: number[][] = [];

  for (let i = 0; i < n; i++) {
    if (!visited.has(i)) {
      const component: number[] = [];
      const queue = [i];
      visited.add(i);

      while (queue.length > 0) {
        const curr = queue.shift()!;
        component.push(curr);

        for (const neighbor of acceptedAdj.get(curr)!) {
          if (!visited.has(neighbor)) {
            visited.add(neighbor);
            queue.push(neighbor);
          }
        }
      }

      // Conservative Check: If component is large, verify cohesion
      const refinedClusters = splitWeaklyConnectedClusters(
        component,
        canonicalAlerts,
        acceptedAdj,
        config
      );

      rawClusters.push(...refinedClusters);
    }
  }

  // Step 4: Construct Predicted Groups with Probable Origin Ranking
  const predictedGroups: PredictedGroup[] = rawClusters.map((clusterIndices, idx) => {
    const clusterAlerts = clusterIndices.map(i => canonicalAlerts[i]);
    // Sort chronologically
    clusterAlerts.sort((a, b) => a.timestampMs - b.timestampMs);

    // Collect all original raw alert IDs mapped to canonical members
    const allRawAlertIds: string[] = [];
    clusterAlerts.forEach(c => {
      allRawAlertIds.push(...c.rawAlertIds);
    });

    // Check for uncertain relationships on the periphery
    const uncertainAlertIds: string[] = [];
    clusterIndices.forEach(memberIdx => {
      for (const uncNeighbor of uncertainEdges.get(memberIdx)!) {
        if (!clusterIndices.includes(uncNeighbor)) {
          const uncAlert = canonicalAlerts[uncNeighbor];
          if (!uncertainAlertIds.includes(uncAlert.id)) {
            uncertainAlertIds.push(uncAlert.id);
          }
        }
      }
    });

    const highestSeverity = clusterAlerts.reduce<AlertSeverity>((highest, cur) => {
      const rank = (s: string) => s === 'CRITICAL' ? 4 : s === 'HIGH' ? 3 : s === 'MEDIUM' ? 2 : 1;
      return rank(cur.severity) > rank(highest) ? cur.severity : highest;
    }, 'LOW');

    const probableOrigin = rankProbableOrigin(clusterAlerts);

    return {
      id: `pred_grp_dep_${Date.now().toString(36)}_${idx + 1}`,
      algorithm: 'dependency_aware',
      alertIds: allRawAlertIds,
      rawAlertCount: allRawAlertIds.length,
      startTime: clusterAlerts[0].timestamp,
      lastAlertTime: clusterAlerts[clusterAlerts.length - 1].timestamp,
      probableOrigin,
      uncertainAlertIds: uncertainAlertIds.length > 0 ? uncertainAlertIds : undefined,
      severity: highestSeverity,
    };
  });

  return {
    predictedGroups,
    relationships,
    acceptedCount,
    uncertainCount,
  };
}

/**
 * Splits a candidate component if it contains weak transitive chains or exceeds diameter.
 */
function splitWeaklyConnectedClusters(
  component: number[],
  alerts: CanonicalAlert[],
  adj: Map<number, Set<number>>,
  config: CorrelationEngineConfig
): number[][] {
  if (component.length <= 2) return [component];

  // Check maximum pairwise topological distance inside component
  let maxDist = 0;
  for (let i = 0; i < component.length; i++) {
    for (let j = i + 1; j < component.length; j++) {
      const dist = getTopologyDistance(
        alerts[component[i]].serviceId,
        alerts[component[j]].serviceId
      );
      if (dist > maxDist) maxDist = dist;
    }
  }

  // If diameter satisfies constraint, keep together
  if (maxDist <= config.maxClusterDiameter) {
    return [component];
  }

  // Otherwise, partition by topological clusters (e.g., shortest-path sub-communities)
  const subClusters: number[][] = [];
  const assigned = new Set<number>();

  for (const node of component) {
    if (!assigned.has(node)) {
      const sub = [node];
      assigned.add(node);

      for (const other of component) {
        if (!assigned.has(other)) {
          const dist = getTopologyDistance(
            alerts[node].serviceId,
            alerts[other].serviceId
          );
          if (dist <= 2 && adj.get(node)?.has(other)) {
            sub.push(other);
            assigned.add(other);
          }
        }
      }
      subClusters.push(sub);
    }
  }

  return subClusters;
}

/**
 * Ranks probable origin services using dependency and timing evidence.
 * Explicitly marks as a ranked probable hypothesis, NOT a confirmed truth.
 */
export function rankProbableOrigin(alerts: CanonicalAlert[]): ProbableOriginRanking {
  const serviceAlerts = new Map<string, CanonicalAlert[]>();
  alerts.forEach(a => {
    const list = serviceAlerts.get(a.serviceId) || [];
    list.push(a);
    serviceAlerts.set(a.serviceId, list);
  });

  const uniqueServices = Array.from(serviceAlerts.keys());
  const earliestOverall = alerts[0];

  let bestSvcId = earliestOverall.serviceId;
  let highestScore = -1;
  let bestReasons: string[] = [];

  for (const svcId of uniqueServices) {
    const list = serviceAlerts.get(svcId)!;
    const earliestForSvc = list.reduce((earliest, cur) =>
      cur.timestampMs < earliest.timestampMs ? cur : earliest
    );

    let score = 0;
    const reasons: string[] = [];

    // Temporal precedence
    const deltaMs = earliestForSvc.timestampMs - earliestOverall.timestampMs;
    if (deltaMs === 0) {
      score += 45;
      reasons.push('Earliest firing alert in the incident cascade');
    } else if (deltaMs <= 30000) {
      score += 30;
      reasons.push(`Triggered within ${(deltaMs / 1000).toFixed(0)}s of initial cascade onset`);
    } else {
      score += 10;
    }

    // Topological upstream depth
    const downstream = getDownstreamBlastRadius(svcId, 3);
    const affectedDownstream = uniqueServices.filter(s => s !== svcId && downstream.includes(s));
    if (affectedDownstream.length > 0) {
      score += affectedDownstream.length * 15;
      reasons.push(`Topologically upstream of ${affectedDownstream.length} affected service(s): ${affectedDownstream.join(', ')}`);
    }

    // Infrastructure / data store tier bonus
    const svcNode = getService(svcId);
    if (svcNode?.tier === 3) {
      score += 20;
      reasons.push('Data store or message broker infrastructure layer (Tier 3)');
    } else if (svcNode?.tier === 1) {
      score += 10;
      reasons.push('Core business domain service layer (Tier 1)');
    }

    // Metric type
    const m = `${earliestForSvc.metricName} ${earliestForSvc.title}`.toLowerCase();
    if (m.includes('connection') || m.includes('oom') || m.includes('saturation') || m.includes('servfail')) {
      score += 15;
      reasons.push(`Primary failure signature: ${earliestForSvc.metricName}`);
    }

    if (score > highestScore) {
      highestScore = score;
      bestSvcId = svcId;
      bestReasons = reasons;
    }
  }

  const candidateService = getService(bestSvcId);
  const confidenceScore = Math.min(0.95, Math.max(0.55, highestScore / 100));

  // Build propagation path
  const propagationPath = [bestSvcId, ...uniqueServices.filter(s => s !== bestSvcId)];

  return {
    candidateServiceId: bestSvcId,
    candidateServiceName: candidateService?.name || bestSvcId,
    confidenceScore: Number(confidenceScore.toFixed(2)),
    propagationPath,
    evidenceReasons: bestReasons,
  };
}

/**
 * Adapter converting conservative correlation output into rich Incident models
 * for the interactive dashboard and server APIs.
 */
export function correlateAlertsIntoIncidents(rawAlerts: any[]): {
  incidents: any[];
  deduplicationStats: { rawCount: number; dedupCount: number; suppressionRatio: number };
} {
  const normAlerts = rawAlerts.map(a => ({
    ...a,
    timestampMs: a.timestampMs || new Date(a.timestamp).getTime(),
  }));

  const { predictedGroups, relationships } = runConservativeCorrelation(normAlerts);
  const dedup = deduplicateStream(normAlerts);

  const alertMap = new Map<string, any>();
  normAlerts.forEach(a => alertMap.set(a.id, a));

  const incidents = predictedGroups.map(grp => {
    const grpAlerts = grp.alertIds
      .map(id => alertMap.get(id))
      .filter(Boolean)
      .sort((a, b) => a.timestampMs - b.timestampMs);

    const firstAlert = grpAlerts[0] || normAlerts[0];
    const lastAlert = grpAlerts[grpAlerts.length - 1] || firstAlert;

    const affectedServices = Array.from(new Set(grpAlerts.map((a: any) => a.serviceId)));
    const impactedTiers = Array.from(
      new Set(
        affectedServices
          .map(id => getService(id as string)?.tier)
          .filter((t): t is 0 | 1 | 2 | 3 => t !== undefined)
      )
    ).sort();

    const rootServiceId = grp.probableOrigin?.candidateServiceId || firstAlert.serviceId;
    const rootServiceName = grp.probableOrigin?.candidateServiceName || getService(rootServiceId)?.name || rootServiceId;

    const timelineEvents = grpAlerts.map((a: any, i: number) => ({
      id: `evt_${a.id}`,
      timestamp: a.timestamp,
      serviceId: a.serviceId,
      serviceName: a.serviceName,
      severity: a.severity,
      title: a.title,
      eventType: i === 0 ? 'first_alert' : 'cascade',
      details: `${a.serviceName}: ${a.title}`,
    }));

    const durationSeconds = Math.max(
      30,
      Math.round((lastAlert.timestampMs - firstAlert.timestampMs) / 1000)
    );

    return {
      id: grp.id,
      title: grpAlerts.length === 1
        ? `${rootServiceName}: ${firstAlert.title}`
        : `${rootServiceName} Incident: ${firstAlert.title} impacting ${affectedServices.length} services`,
      severity: grp.severity,
      status: grp.severity === 'CRITICAL' ? 'OPEN' : 'INVESTIGATING',
      startTime: grp.startTime,
      lastAlertTime: grp.lastAlertTime,
      durationSeconds,
      rawAlertCount: grp.rawAlertCount,
      dedupAlertCount: grpAlerts.length,
      blastRadius: {
        serviceCount: affectedServices.length,
        affectedServices,
        impactedTiers,
        estimatedUserImpact: impactedTiers.includes(0) ? 'CRITICAL' : 'MODERATE',
      },
      rootCauseAnalysis: {
        candidateServiceId: rootServiceId,
        candidateServiceName: rootServiceName,
        confidenceScore: grp.probableOrigin?.confidenceScore || 0.85,
        propagationPath: grp.probableOrigin?.propagationPath || [rootServiceId],
        propagationHops: [],
        evidenceReasons: grp.probableOrigin?.evidenceReasons || ['Onset precedence'],
        firstFiringAlert: firstAlert,
      },
      alerts: grpAlerts,
      timelineEvents,
      scenarioId: firstAlert.scenarioId,
    };
  });

  return {
    incidents,
    deduplicationStats: {
      rawCount: dedup.rawCount,
      dedupCount: dedup.dedupCount,
      suppressionRatio: dedup.suppressionRatio,
    },
  };
}
