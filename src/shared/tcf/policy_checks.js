/**
 * IAB CMP Validator check catalogue helpers (pure, ESM).
 *
 * The catalogue itself lives in src/data/tcf_checks.json (technical #1–13,
 * policy #1–32, CMP & API sub-sections) — pass the parsed JSON in.
 */

export function getSections(data) {
  if (!data) throw new Error('tcf_checks.json not provided');
  return { technical: data.technical || [], policy: data.policy || [], cmpApi: data.cmpApi || [], summary: data.summary || {} };
}

export function resultLabel(v) {
  if (v === true) return 'Passed';
  if (v === false) return 'Failed';
  return 'Incomplete';
}

/** Effective result of one check: automated → automatedResults[id]; manual → manualResponses[id]. */
export function checkResult(check, automatedResults = {}, manualResponses = {}) {
  const v = check.automated ? automatedResults[check.id] : manualResponses[check.id];
  return v === true ? true : v === false ? false : null;
}

/**
 * @returns {{passed:number, failed:number, todo:number, total:number, label:string, status:'Passed'|'Failed'|'Incomplete'}}
 * `label` matches the IAB validator wording: "passed: X failed: Y to do: Z".
 */
export function summarize(checks, automatedResults = {}, manualResponses = {}) {
  let passed = 0, failed = 0, todo = 0;
  for (const c of checks || []) {
    const r = checkResult(c, automatedResults, manualResponses);
    if (r === true) passed++; else if (r === false) failed++; else todo++;
  }
  const total = passed + failed + todo;
  const status = failed ? 'Failed' : todo ? 'Incomplete' : (total ? 'Passed' : 'Incomplete');
  return { passed, failed, todo, total, label: 'passed: ' + passed + ' failed: ' + failed + ' to do: ' + todo, status };
}

/** Flatten CMP & API sub-sections into [{groupTitle, id, text, key}] where key = last id segment. */
export function flattenCmpApi(cmpApi) {
  const out = [];
  for (const g of cmpApi || []) for (const c of g.checks || []) out.push({ groupTitle: g.title, id: c.id, text: c.text, key: c.id.split('_').pop() });
  return out;
}

export default { getSections, resultLabel, checkResult, summarize, flattenCmpApi };
