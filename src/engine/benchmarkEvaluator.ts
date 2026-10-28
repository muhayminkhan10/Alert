import { BenchmarkResult, ScenarioBreakdown } from '../types';
import { getGroundTruthScenarios } from './syntheticScenarios';
import { correlateAlertsIntoIncidents } from './correlationEngine';

/**
 * Runs evaluation suite across all 5 synthetic ground truth scenarios,
 * assessing Precision, Recall, F1, False Merges, and False Splits.
 */
export function runBenchmarkEvaluation(): BenchmarkResult {
  const startTime = Date.now();
  const scenarios = getGroundTruthScenarios();

  let totalRawAlerts = 0;
  let totalDeduplicatedAlerts = 0;
  let totalGroundTruthIncidents = 0;
  let totalDetectedIncidents = 0;

  let totalFalseMerges = 0;
  let totalFalseSplits = 0;
  let totalMissedIncidents = 0;
  let totalTruePositives = 0;

  const scenarioBreakdowns: ScenarioBreakdown[] = [];

  for (const scenario of scenarios) {
    totalRawAlerts += scenario.alerts.length;
    totalGroundTruthIncidents += scenario.expectedIncidentCount;

    // Run the correlation engine against the scenario's alerts
    const { incidents, deduplicationStats } = correlateAlertsIntoIncidents(scenario.alerts);
    totalDeduplicatedAlerts += deduplicationStats.dedupCount;

    const detectedCount = incidents.length;
    totalDetectedIncidents += detectedCount;

    let scenarioFalseMerges = 0;
    let scenarioFalseSplits = 0;
    let scenarioMissed = 0;
    let scenarioTP = 0;

    if (scenario.id === 'scenario-concurrent-outages') {
      // Stress test for False Merges: Expected 2 distinct incidents (DNS & Kafka)
      const hasDnsIncident = incidents.some((inc: any) =>
        inc.alerts.some((a: any) => a.serviceId === 'dns-internal')
      );
      const hasKafkaIncident = incidents.some((inc: any) =>
        inc.alerts.some((a: any) => a.serviceId === 'kafka-event-bus')
      );

      // Check if DNS and Kafka alerts were merged into the SAME incident
      const falseMergeFound = incidents.some(
        (inc: any) =>
          inc.alerts.some((a: any) => a.serviceId === 'dns-internal') &&
          inc.alerts.some((a: any) => a.serviceId === 'kafka-event-bus')
      );

      if (falseMergeFound) {
        scenarioFalseMerges += 1;
      } else if (hasDnsIncident && hasKafkaIncident) {
        scenarioTP += 2;
      }
    } else if (scenario.id === 'scenario-db-exhaustion') {
      // High-cascade test: Expected 1 unified incident containing all 5 services
      const majorIncident = incidents.find((inc: any) =>
        inc.alerts.some((a: any) => a.serviceId === 'postgres-orders-primary')
      );

      if (!majorIncident) {
        scenarioMissed += 1;
      } else {
        const coveredServices = new Set(majorIncident.alerts.map((a: any) => a.serviceId));
        // All 5 services should be in this single incident
        const expected = [
          'postgres-orders-primary',
          'order-processing-engine',
          'inventory-management',
          'checkout-service',
          'api-gateway-edge',
        ];
        const allPresent = expected.every(s => coveredServices.has(s));

        if (allPresent && detectedCount === 1) {
          scenarioTP += 1;
        } else if (detectedCount > 1) {
          scenarioFalseSplits += detectedCount - 1;
          scenarioTP += 1;
        } else {
          scenarioTP += 0.8;
        }
      }
    } else {
      // General scenario evaluation
      if (detectedCount === scenario.expectedIncidentCount) {
        scenarioTP += scenario.expectedIncidentCount;
      } else if (detectedCount > scenario.expectedIncidentCount) {
        scenarioFalseSplits += detectedCount - scenario.expectedIncidentCount;
        scenarioTP += scenario.expectedIncidentCount;
      } else {
        scenarioMissed += scenario.expectedIncidentCount - detectedCount;
        scenarioTP += detectedCount;
      }
    }

    totalFalseMerges += scenarioFalseMerges;
    totalFalseSplits += scenarioFalseSplits;
    totalMissedIncidents += scenarioMissed;
    totalTruePositives += scenarioTP;

    // Calculate scenario-level metrics
    const pDenom = scenarioTP + scenarioFalseMerges;
    const precision = pDenom > 0 ? Math.min(1.0, scenarioTP / pDenom) : 1.0;

    const rDenom = scenarioTP + scenarioFalseSplits + scenarioMissed;
    const recall = rDenom > 0 ? Math.min(1.0, scenarioTP / rDenom) : 1.0;

    const f1 =
      precision + recall > 0
        ? (2 * (precision * recall)) / (precision + recall)
        : 0;

    const verdict: 'PASS' | 'WARN' | 'FAIL' =
      f1 >= 0.90 && scenarioFalseMerges === 0
        ? 'PASS'
        : f1 >= 0.70
        ? 'WARN'
        : 'FAIL';

    scenarioBreakdowns.push({
      scenarioId: scenario.id,
      name: scenario.name,
      category: scenario.category,
      expectedIncidents: scenario.expectedIncidentCount,
      detectedIncidents: detectedCount,
      precision: Number(precision.toFixed(3)),
      recall: Number(recall.toFixed(3)),
      f1Score: Number(f1.toFixed(3)),
      falseMerges: scenarioFalseMerges,
      falseSplits: scenarioFalseSplits,
      verdict,
      details: `${scenario.description} Result: ${detectedCount} detected vs ${scenario.expectedIncidentCount} expected. (FM: ${scenarioFalseMerges}, FS: ${scenarioFalseSplits}).`,
    });
  }

  // Aggregate global metrics
  const globalPrecisionDenom = totalTruePositives + totalFalseMerges;
  const globalPrecision =
    globalPrecisionDenom > 0 ? totalTruePositives / globalPrecisionDenom : 1.0;

  const globalRecallDenom =
    totalTruePositives + totalFalseSplits + totalMissedIncidents;
  const globalRecall =
    globalRecallDenom > 0 ? totalTruePositives / globalRecallDenom : 1.0;

  const globalF1 =
    globalPrecision + globalRecall > 0
      ? (2 * (globalPrecision * globalRecall)) / (globalPrecision + globalRecall)
      : 0;

  const noiseReductionPercent =
    totalRawAlerts > 0
      ? ((totalRawAlerts - totalDetectedIncidents) / totalRawAlerts) * 100
      : 0;

  const durationMs = Date.now() - startTime;

  return {
    totalRawAlerts,
    totalDeduplicatedAlerts,
    noiseReductionPercent: Number(noiseReductionPercent.toFixed(1)),
    groundTruthIncidents: totalGroundTruthIncidents,
    detectedIncidents: totalDetectedIncidents,
    precision: Number(globalPrecision.toFixed(3)),
    recall: Number(globalRecall.toFixed(3)),
    f1Score: Number(globalF1.toFixed(3)),
    falseMerges: totalFalseMerges,
    falseSplits: totalFalseSplits,
    missedIncidents: totalMissedIncidents,
    scenariosEvaluated: scenarios.length,
    durationMs,
    scenarioBreakdown: scenarioBreakdowns,
  };
}
