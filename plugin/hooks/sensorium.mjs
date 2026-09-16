// The sensorium composer (#181): loads every plugin/hooks/sensorium/*.mjs module in
// filename order and renders them into one block. session-status.mjs and
// renderStatusView (status-render.mjs) both print this block -- session-status after
// its gate health section, renderStatusView first; see each file's own comment on why.
//
// Directory discovery is the one decision that lets slices 02 to 05 (dollars, runs,
// the commitment ledger, the harness cost) each add one file under sensorium/ and
// touch no shared list. A section whose render() throws is reported as unknown, by
// name, rather than taking the rest of the block down with it.

import { readdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

const DEFAULT_DIR = path.join(path.dirname(fileURLToPath(import.meta.url)), 'sensorium');

/** Every `*.mjs` file in `dir`, sorted so `10-score.mjs` renders before a later `NN-*`. */
function moduleFiles(dir) {
  try {
    return readdirSync(dir).filter((f) => f.endsWith('.mjs')).sort();
  } catch {
    return [];
  }
}

/**
 * The sensorium block: one section's lines per module found in `dir` (defaulting to
 * this file's own `sensorium/` directory; a test seam, not a production knob), in
 * filename order. `root` is passed to every module's `render`. A module that fails to
 * import, or whose `render` throws sync or async, renders as one line naming it --
 * `<name>: unknown (<message>)` -- and every other section still prints.
 */
export async function renderSensorium(root, { dir = DEFAULT_DIR } = {}) {
  const lines = [];
  for (const file of moduleFiles(dir)) {
    let name = file.replace(/\.mjs$/, '');
    try {
      const mod = await import(pathToFileURL(path.join(dir, file)).href);
      name = mod.name ?? name;
      lines.push(...(await mod.render({ root })));
    } catch (err) {
      lines.push(`${name}: unknown (${err.message})`);
    }
  }
  return lines;
}
