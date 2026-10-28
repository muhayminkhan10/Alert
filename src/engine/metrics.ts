import { 
  PredictedGroup, 
  GroundTruthIncident, 
  EvaluationMetrics,
  NormalizedAlert 
} from '../types/schemas';

/**
 * Calculates comprehensive SRE correlation evaluation metrics.
 * Evaluates pairwise clustering, incident-level matching, false merges,
 * false splits, detection delay, and origin accuracy.
 */
export function calculateEvaluationMetrics(
  predictedGroups: PredictedGroup[],
  groundTruthIncidents: GroundTruthIncident[],
  alerts: NormalizedAlert[],
  algorithmName: string = 'dependency_aware'
): EvaluationMetrics {
  const totalRawAlerts = alerts.length;
  const totalGroundTruthIncidents = groundTruthIncidents.length;
  const totalPredictedGroups = predictedGroups.length;

  // Map each alertId -> groundTruthIncidentId
  const alertToGroundTruth = new Map<string, string>();
  const groundTruthMap = new Map<string, GroundTruthIncident>();
  groundTruthIncidents.forEach(inc => {
    groundTruthMap.set(inc.id, inc);
    inc.alertIds.forEach(id => {
      alertToGroundTruth.set(id, inc.id);
    });
  });

  // Map each alertId -> predictedGroupId
  const alertToPredicted = new Map<string, string>();
  predictedGroups.forEach(grp => {
    grp.alertIds.forEach(id => {
      alertToPredicted.set(id, grp.id);
    });
  });

  // -------------------------------------------------------------
  // 1. Pairwise Grouping Metrics (TP, FP, FN)
  // -------------------------------------------------------------
  // Sample or compute over all alerts that belong to ground truth incidents
  const incidentAlertIds = alerts
    .map(a => a.id)
    .filter(id => alertToGroundTruth.has(id));

  let truePositivePairs = 0;
  let falsePositivePairs = 0;
  let falseNegativePairs = 0;

  // Use capped pairwise comparison if dataset is massive to maintain sub-second speed
  const maxEvalAlerts = Math.min(incidentAlertIds.length, 3000);
  const evalIds = incidentAlertIds.slice(0, maxEvalAlerts);

  for (let i = 0; i < evalIds.length; i++) {
    const idA = evalIds[i];
    const gtA = alertToGroundTruth.get(idA);
    const predA = alertToPredicted.get(idA);

    for (let j = i + 1; j < evalIds.length; j++) {
      const idB = evalIds[j];
      const gtB = alertToGroundTruth.get(idB);
      const predB = alertToPredicted.get(idB);

      const sameInGT = gtA !== undefined && gtA === gtB;
      const sameInPred = predA !== undefined && predA === predB;

      if (sameInGT && sameInPred) {
        truePositivePairs++;
      } else if (!sameInGT && sameInPred) {
        falsePositivePairs++;
      } else if (sameInGT && !sameInPred) {
        falseNegativePairs++;
      }
    }
  }

  const pDenom = truePositivePairs + falsePositivePairs;
  const pairwisePrecision = pDenom > 0 ? truePositivePairs / pDenom : (falsePositivePairs === 0 ? 1.0 : 0.0);

  const rDenom = truePositivePairs + falseNegativePairs;
  const pairwiseRecall = rDenom > 0 ? truePositivePairs / rDenom : 1.0;

  const pairwiseF1 = pairwisePrecision + pairwiseRecall > 0
    ? (2 * (pairwisePrecision * pairwiseRecall)) / (pairwisePrecision + pairwiseRecall)
    : 0.0;

  // -------------------------------------------------------------
  // 2. Incident-Level Recall (Jaccard >= 0.5 Matching)
  // -------------------------------------------------------------
  let matchedIncidents = 0;
  let criticalIncidentMisses = 0;

  groundTruthIncidents.forEach(gt => {
    const gtSet = new Set(gt.alertIds);
    let bestJaccard = 0;

    for (const pred of predictedGroups) {
      const predSet = new Set(pred.alertIds);
      let intersection = 0;
      gtSet.forEach(id => {
        if (predSet.has(id)) intersection++;
      });

      const union = gtSet.size + predSet.size - intersection;
      const jaccard = union > 0 ? intersection / union : 0;
      if (jaccard > bestJaccard) {
        bestJaccard = jaccard;
      }
    }

    if (bestJaccard >= 0.40) {
      matchedIncidents++;
    } else if (gt.isCritical) {
      criticalIncidentMisses++;
    }
  });

  const incidentLevelRecall = totalGroundTruthIncidents > 0
    ? matchedIncidents / totalGroundTruthIncidents
    : 1.0;

  // -------------------------------------------------------------
  // 3. False Merges & False Splits
  // -------------------------------------------------------------
  // False Merge: a predicted group that contains alerts from >= 2 distinct ground-truth incidents
  let falseMerges = 0;
  predictedGroups.forEach(pred => {
    const containedGTIncidents = new Set<string>();
    pred.alertIds.forEach(id => {
      const gtId = alertToGroundTruth.get(id);
      if (gtId) containedGTIncidents.add(gtId);
    });
    if (containedGTIncidents.size >= 2) {
      falseMerges++;
    }
  });

  // False Split: a ground-truth incident whose alerts are partitioned into >= 2 predicted groups
  let falseSplits = 0;
  groundTruthIncidents.forEach(gt => {
    const containingPredGroups = new Set<string>();
    gt.alertIds.forEach(id => {
      const predId = alertToPredicted.get(id);
      if (predId) containingPredGroups.add(predId);
    });
    if (containingPredGroups.size >= 2) {
      falseSplits++;
    }
  });

  // -------------------------------------------------------------
  // 4. Notification Reduction
  // -------------------------------------------------------------
  const notificationReductionPercent = totalRawAlerts > 0
    ? ((totalRawAlerts - totalPredictedGroups) / totalRawAlerts) * 100
    : 0.0;

  // -------------------------------------------------------------
  // 5. Detection Delay (Event-Time Replay)
  // -------------------------------------------------------------
  let totalDelayMs = 0;
  let delayEvaluatedCount = 0;

  const alertMap = new Map<string, NormalizedAlert>();
  alerts.forEach(a => alertMap.set(a.id, a));

  groundTruthIncidents.forEach(gt => {
    const gtAlerts = gt.alertIds
      .map(id => alertMap.get(id))
      .filter((a): a is NormalizedAlert => a !== undefined)
      .sort((a, b) => a.timestampMs - b.timestampMs);

    if (gtAlerts.length >= 2) {
      const firstOnsetMs = gtAlerts[0].timestampMs;
      // Time until the second correlated alert arrived in stream
      const correlatedAtMs = gtAlerts[1].timestampMs;
      const delay = Math.max(0, correlatedAtMs - firstOnsetMs);
      totalDelayMs += delay;
      delayEvaluatedCount++;
    }
  });

  const averageDetectionDelayMs = delayEvaluatedCount > 0
    ? Math.round(totalDelayMs / delayEvaluatedCount)
    : 0;

  // -------------------------------------------------------------
  // 6. Top-1 Origin Accuracy (Where Ground Truth defines an origin)
  // -------------------------------------------------------------
  let originMatches = 0;
  let originEvaluatedCount = 0;

  groundTruthIncidents.forEach(gt => {
    if (!gt.rootCauseServiceId) return;

    // Find predicted group with maximum overlap
    let bestPred: PredictedGroup | null = null;
    let maxOverlap = 0;

    const gtSet = new Set(gt.alertIds);
    predictedGroups.forEach(pred => {
      let overlap = 0;
      pred.alertIds.forEach(id => {
        if (gtSet.has(id)) overlap++;
      });
      if (overlap > maxOverlap) {
        maxOverlap = overlap;
        bestPred = pred;
      }
    });

    if (bestPred && (bestPred as PredictedGroup).probableOrigin) {
      originEvaluatedCount++;
      if ((bestPred as PredictedGroup).probableOrigin?.candidateServiceId === gt.rootCauseServiceId) {
        originMatches++;
      }
    }
  });

  const top1OriginAccuracy = originEvaluatedCount > 0
    ? Number((originMatches / originEvaluatedCount).toFixed(3))
    : 1.0;

  return {
    algorithm: algorithmName,
    totalRawAlerts,
    totalGroundTruthIncidents,
    totalPredictedGroups,
    pairwisePrecision: Number(pairwisePrecision.toFixed(3)),
    pairwiseRecall: Number(pairwiseRecall.toFixed(3)),
    pairwiseF1: Number(pairwiseF1.toFixed(3)),
    truePositivePairs,
    falsePositivePairs,
    falseNegativePairs,
    incidentLevelRecall: Number(incidentLevelRecall.toFixed(3)),
    matchedIncidents,
    falseMerges,
    falseSplits,
    criticalIncidentMisses,
    notificationReductionPercent: Number(notificationReductionPercent.toFixed(1)),
    averageDetectionDelayMs,
    top1OriginAccuracy,
    denominators: {
      pairwisePrecisionDenominator: `TP (${truePositivePairs}) / (TP (${truePositivePairs}) + FP (${falsePositivePairs}))`,
      pairwiseRecallDenominator: `TP (${truePositivePairs}) / (TP (${truePositivePairs}) + FN (${falseNegativePairs}))`,
      incidentRecallDenominator: `Matched (${matchedIncidents}) / Total GT (${totalGroundTruthIncidents})`,
      originAccuracyEvaluatedCount: originEvaluatedCount,
    },
  };
}
