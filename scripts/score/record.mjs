// A hand-copied snapshot for a consumer that no longer exists to read live.
// The only requirement is a `record` field naming where the numbers came from;
// everything else is the same snapshot shape consumer.row(), interventions.line()
// and harness.line() already read.
import { readFileSync } from 'node:fs';

export function load(path) {
  const snapshot = JSON.parse(readFileSync(path, 'utf8'));
  if (!snapshot.record) {
    throw new Error(`${path}: missing "record" field naming the record's source`);
  }
  return snapshot;
}
