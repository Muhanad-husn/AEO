export function runningTotal(values, options = {}) {
  if (!Array.isArray(values)) {
    throw new TypeError(
      `runningTotal: expected 'values' to be an array, received ${typeof values === 'object' && values !== null ? Object.prototype.toString.call(values) : String(values)}`
    );
  }

  const total = values
    .filter((v) => typeof v === 'number' && !Number.isNaN(v))
    .reduce((a, b) => a + b, 0);

  const { max } = options;
  if (typeof max === 'number' && total > max) return max;

  return total;
}
