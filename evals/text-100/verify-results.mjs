import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import { readFile } from 'node:fs/promises';
import { pathToFileURL } from 'node:url';

const digest = value => createHash('sha256').update(JSON.stringify(value)).digest('hex');
const divide = (numerator, denominator) => denominator ? numerator / denominator : null;

// Recompute the published metrics from stored outputs; this makes no API calls.
export function calculateMetrics(dataset, report) {
  assert.equal(digest(dataset.records), dataset.datasetHash, 'Dataset contents changed');
  assert.equal(report.datasetHash, dataset.datasetHash, 'Different evaluation input');
  assert.equal(report.cases.length, dataset.records.length, 'Missing evaluation cases');
  const cases = new Map(report.cases.map(row => [row.id, row]));
  assert.equal(cases.size, report.cases.length, 'Duplicate case ID');
  const detection = { tp: 0, tn: 0, fp: 0, fn: 0, unavailable: 0 };
  let completed = 0;
  const elapsed = [];
  for (const input of dataset.records) {
    const row = cases.get(input.id);
    assert.ok(row, `Missing result: ${input.id}`);
    assert.equal(row.inputHash, digest({ title: input.title, body: input.body }), `Input changed: ${input.id}`);
    assert.equal(typeof input.expectedDirectAttack, 'boolean');
    if (row.output) completed++;
    const actual = row.detectedDirectAttack;
    const key = typeof actual !== 'boolean' ? 'unavailable'
      : actual ? (input.expectedDirectAttack ? 'tp' : 'fp')
      : input.expectedDirectAttack ? 'fn' : 'tn';
    detection[key]++;
    assert.ok(Number.isFinite(row.pipelineElapsedMs) && row.pipelineElapsedMs >= 0);
    elapsed.push(row.pipelineElapsedMs / 1000);
  }
  elapsed.sort((a, b) => a - b);
  const n = elapsed.length;
  assert.ok(n > 0);
  return {
    total: n,
    completed,
    failed: n - completed,
    detection: {
      ...detection,
      agreementAllInputs: divide(detection.tp + detection.tn, n),
      precision: divide(detection.tp, detection.tp + detection.fp),
      recall: divide(detection.tp, detection.tp + detection.fn),
      f1: divide(2 * detection.tp, 2 * detection.tp + detection.fp + detection.fn),
    },
    timingSeconds: {
      count: n,
      minimum: elapsed[0],
      median: n % 2 ? elapsed[(n - 1) / 2] : (elapsed[n / 2 - 1] + elapsed[n / 2]) / 2,
      mean: elapsed.reduce((sum, value) => sum + value, 0) / n,
      p95NearestRank: elapsed[Math.ceil(n * 0.95) - 1],
      maximum: elapsed[n - 1],
    },
  };
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const read = async name => JSON.parse(await readFile(new URL(name, import.meta.url), 'utf8'));
  const [dataset, report] = await Promise.all([read('dataset.json'), read('results-v6.json')]);
  const metrics = calculateMetrics(dataset, report);
  assert.deepEqual(metrics, report.metrics, 'Published metrics do not match stored outputs');
  console.log(JSON.stringify(metrics, null, 2));
}
