#!/usr/bin/env node
/**
 * simulate-sandbox-run.js
 * ---------------------------------------------------------------------------
 * Offline simulator for n8n-apify-hubspot-competitor-pricing-page-diff-tracker.
 *
 * It reads workflow.json (the exact file you import into n8n), walks the node
 * graph from "Manual Test Trigger", and executes every Code node in plain
 * Node.js with n8n-compatible globals ($input, $env, $(), $execution).
 * IF nodes are evaluated from their boolean expressions. HTTP Request nodes
 * NEVER touch the network: by default reaching one is a test failure; with
 * --mock-live they are answered by deterministic in-memory mocks built from
 * the synthetic fixture.
 *
 * Usage:
 *   node scripts/simulate-sandbox-run.js                    # sandbox defaults (no env)
 *   node scripts/simulate-sandbox-run.js --mock-live        # exercise live branch with mocks
 *   node scripts/simulate-sandbox-run.js --block-env        # simulate N8N_BLOCK_ENV_ACCESS_IN_NODE=true
 *   node scripts/simulate-sandbox-run.js --env-file .env    # load a dotenv file (secrets masked)
 *   node scripts/simulate-sandbox-run.js --set PRICE_CHANGE_THRESHOLD_PCT=10
 *   node scripts/simulate-sandbox-run.js --fixture path/to/fixture.json
 *   node scripts/simulate-sandbox-run.js --mock-live --fail-writes   # HubSpot 429 path
 *   Options: --json (print full audit JSON), --quiet, --no-checks, --out <file>
 *
 * Requires Node.js >= 18. No dependencies.
 * ---------------------------------------------------------------------------
 */
'use strict';

const fs = require('fs');
const path = require('path');

const ROOT = path.resolve(__dirname, '..');
const WORKFLOW_PATH = path.join(ROOT, 'workflow.json');
const DEFAULT_FIXTURE = path.join(ROOT, 'sample-payloads', 'competitor-pricing-fixture.json');
const SECRET_KEYS = ['HUBSPOT_ACCESS_TOKEN', 'APIFY_API_TOKEN', 'SLACK_PRICING_ALERT_WEBHOOK_URL', 'ALERT_WEBHOOK_URL'];

// ── CLI ─────────────────────────────────────────────────────────────────────
const args = process.argv.slice(2);
const opt = { set: [], envFile: null, fixture: null, mockLive: false, failWrites: false, blockEnv: false, json: false, quiet: false, checks: true, out: path.join(ROOT, 'sim-output', 'last-run.json') };
for (let i = 0; i < args.length; i++) {
  const a = args[i];
  if (a === '--mock-live') opt.mockLive = true;
  else if (a === '--fail-writes') opt.failWrites = true;
  else if (a === '--block-env') opt.blockEnv = true;
  else if (a === '--json') opt.json = true;
  else if (a === '--quiet') opt.quiet = true;
  else if (a === '--no-checks') opt.checks = false;
  else if (a === '--env-file') opt.envFile = args[++i];
  else if (a === '--fixture') opt.fixture = args[++i];
  else if (a === '--out') opt.out = path.resolve(args[++i]);
  else if (a === '--set') opt.set.push(args[++i]);
  else if (a === '--help' || a === '-h') { console.log(fs.readFileSync(__filename, 'utf8').split('\n').slice(1, 28).join('\n')); process.exit(0); }
  else { console.error(`Unknown argument: ${a}`); process.exit(2); }
}

const color = (c, s) => (process.stdout.isTTY ? `\x1b[${c}m${s}\x1b[0m` : s);
const ok = (s) => color('32', s); const bad = (s) => color('31', s); const dim = (s) => color('2', s); const bold = (s) => color('1', s);
const log = (...a) => { if (!opt.quiet) console.log(...a); };

// ── Load workflow + fixture ────────────────────────────────────────────────
const workflow = JSON.parse(fs.readFileSync(WORKFLOW_PATH, 'utf8'));
const fixturePath = opt.fixture ? path.resolve(opt.fixture) : DEFAULT_FIXTURE;
const fixtureText = fs.readFileSync(fixturePath, 'utf8');
const fixture = JSON.parse(fixtureText);
const usingDefaultFixture = fixturePath === DEFAULT_FIXTURE;
const nodesByName = new Map(workflow.nodes.map((n) => [n.name, n]));

// ── Environment (isolated: host process.env is NEVER passed through) ────────
const env = {};
const parseDotenv = (text) => {
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^\s*([A-Z0-9_]+)\s*=\s*(.*)\s*$/);
    if (!m) continue;
    let v = m[2];
    if (/^'.*'$/.test(v) || /^".*"$/.test(v)) v = v.slice(1, -1);
    else v = v.replace(/\s+#.*$/, '');
    env[m[1]] = v;
  }
};
if (opt.envFile) parseDotenv(fs.readFileSync(path.resolve(opt.envFile), 'utf8'));
if (opt.mockLive) {
  Object.assign(env, {
    SANDBOX_MODE: 'false', DRY_RUN: 'false', HUBSPOT_LOGGING_ENABLED: 'true', SEND_SLACK_ALERTS: 'true', SEND_OPS_ALERTS: 'true',
    HUBSPOT_ACCESS_TOKEN: 'mock-hubspot-token-not-real', APIFY_API_TOKEN: 'mock-apify-token-not-real',
    SLACK_PRICING_ALERT_WEBHOOK_URL: 'https://hooks.example.com/mock/slack-pricing-alerts',
    ALERT_WEBHOOK_URL: 'https://alerts.example.com/mock/ops',
    COMPETITOR_TARGETS_JSON: JSON.stringify(fixture.competitors.map((c) => ({ competitorKey: c.competitorKey, competitorName: c.competitorName, pricingUrl: c.pricingUrl, hubspotRecordId: c.hubspotRecordId }))),
  });
}
for (const kv of opt.set) {
  const i = kv.indexOf('=');
  if (i < 1) { console.error(`--set expects KEY=VALUE, got "${kv}"`); process.exit(2); }
  env[kv.slice(0, i)] = kv.slice(i + 1);
}
const secretValues = SECRET_KEYS.map((k) => env[k]).filter((v) => v && v.length >= 6);
const mask = (s) => { let out = String(s); for (const v of secretValues) out = out.split(v).join('***'); return out; };

const $env = new Proxy({}, {
  get(_, key) {
    if (opt.blockEnv) throw new Error('access to env vars denied');
    return typeof key === 'string' ? env[key] : undefined;
  },
});

// ── Static safety audit of workflow.json ───────────────────────────────────
const checks = [];
const check = (name, pass, detail = '') => checks.push({ name, pass: Boolean(pass), detail });
const wfText = fs.readFileSync(WORKFLOW_PATH, 'utf8');

check('workflow.json is inactive on import', workflow.active === false);
check('workflow timezone is UTC', workflow.settings && workflow.settings.timezone === 'UTC');
const sched = workflow.nodes.find((n) => n.type === 'n8n-nodes-base.scheduleTrigger');
check('weekly cron is Monday 06:00', sched && sched.parameters.rule.interval[0].expression === '0 6 * * 1');
check('manual test trigger present', workflow.nodes.some((n) => n.type === 'n8n-nodes-base.manualTrigger'));
const httpNodes = workflow.nodes.filter((n) => n.type === 'n8n-nodes-base.httpRequest');
for (const n of httpNodes) {
  const hdrs = (n.parameters.headerParameters && n.parameters.headerParameters.parameters) || [];
  const auth = hdrs.find((h) => h.name.toLowerCase() === 'authorization');
  const authOk = !auth || /\{\{\s*\$env\.[A-Z_]+\s*\}\}/.test(auth.value);
  const urlOk = /^=https:\/\/api\.(apify|hubapi)\.com\//.test(n.parameters.url) || /^=\{\{\s*\$env\.[A-Z_]+\s*\}\}$/.test(n.parameters.url);
  check(`HTTP "${n.name}" uses $env for auth/URL`, authOk && urlOk);
  check(`HTTP "${n.name}" has credentials: none`, !n.credentials);
}
const secretPatterns = [
  /pat-(na|eu|ap)\d-[0-9a-f]{8}-[0-9a-f]{4}/i, /apify_api_[A-Za-z0-9]{20,}/, /hooks\.slack\.com\/services\/T[A-Z0-9]{6,}/,
  /xox[abpr]-[A-Za-z0-9-]{10,}/, /Bearer\s+[A-Za-z0-9._-]{20,}/,
];
check('no hardcoded secrets in workflow.json', !secretPatterns.some((p) => p.test(wfText)));
const nonExampleDomains = (wfText.match(/https?:\/\/[a-z0-9.-]+/gi) || [])
  .map((u) => u.replace(/^https?:\/\//i, '').toLowerCase())
  .filter((h) => !/(^|\.)example\.com$/.test(h) && !['api.apify.com', 'api.hubapi.com'].includes(h));
check('only example.com + official API hosts referenced', nonExampleDomains.length === 0, [...new Set(nonExampleDomains)].join(', '));
const sandboxNode = nodesByName.get('Load Sandbox Fixture');
const embedded = sandboxNode.parameters.jsCode.match(/\/\* FIXTURE:START \*\/\s*const FIXTURE = ([\s\S]*?);\s*\/\* FIXTURE:END \*\//);
const embeddedMatchesFile = embedded && JSON.stringify(JSON.parse(embedded[1])) === JSON.stringify(JSON.parse(fs.readFileSync(DEFAULT_FIXTURE, 'utf8')));
check('embedded sandbox fixture matches sample-payloads file', embeddedMatchesFile);

// ── Graph executor ─────────────────────────────────────────────────────────
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;
const outputs = new Map();   // node name -> array of output arrays
const executed = [];
const httpCalls = [];

const nodeAccessor = (name) => {
  if (!outputs.has(name)) throw new Error(`Referenced node "${name}" is unexecuted`);
  const items = outputs.get(name).flat();
  return {
    all: () => items,
    first: () => items[0],
    last: () => items[items.length - 1],
    get item() { throw new Error('$("node").item is not supported by the simulator; use .all()[i]'); },
  };
};

const evalExpression = (template, item) => {
  if (typeof template !== 'string' || !template.startsWith('=')) return template;
  const body = template.slice(1);
  const run = (expr) => new Function('$json', '$', '$env', `return (${expr});`)(item.json, nodeAccessor, $env);
  const whole = body.match(/^\{\{([\s\S]*)\}\}$/);
  if (whole && !whole[1].includes('}}')) return run(whole[1]);
  return body.replace(/\{\{([\s\S]*?)\}\}/g, (_, expr) => String(run(expr)));
};

const normalizeReturn = (ret, name) => {
  if (!Array.isArray(ret)) throw new Error(`Code node "${name}" must return an array of items`);
  return ret.map((it) => {
    if (!it || typeof it !== 'object' || !('json' in it)) throw new Error(`Code node "${name}" returned an item without "json"`);
    return { json: JSON.parse(JSON.stringify(it.json)) };
  });
};

const runCode = async (node, input) => {
  let src = node.parameters.jsCode;
  if (node.name === 'Load Sandbox Fixture' && !usingDefaultFixture) {
    src = src.replace(/\/\* FIXTURE:START \*\/[\s\S]*?\/\* FIXTURE:END \*\//, `const FIXTURE = ${JSON.stringify(fixture)};`);
  }
  const $input = { all: () => input, first: () => input[0], last: () => input[input.length - 1] };
  const fn = new AsyncFunction('$input', '$env', '$', '$execution', '$workflow', 'console', src);
  const quietConsole = { log: () => {}, warn: () => {}, error: () => {}, info: () => {} };
  return normalizeReturn(await fn($input, $env, nodeAccessor, { id: 'sim-0001', mode: 'manual' }, { id: 'sim', name: workflow.name }, quietConsole), node.name);
};

const runIf = (node, input) => {
  const conds = node.parameters.conditions.conditions;
  const t = []; const f = [];
  for (const item of input) {
    const pass = conds.every((c) => {
      const v = evalExpression(c.leftValue, item);
      if (typeof v !== 'boolean') throw new Error(`IF "${node.name}" strict type validation: expected boolean, got ${typeof v}`);
      return v === true;
    });
    (pass ? t : f).push(item);
  }
  return [t, f];
};

// Deterministic mocks — only used with --mock-live. No sockets are ever opened.
const fixtureByKey = new Map(fixture.competitors.map((c) => [c.competitorKey, c]));
const mockHttp = (node, item, req) => {
  if (!opt.mockLive) throw new Error(`HTTP node "${node.name}" was reached in an offline run without --mock-live. Safe defaults should keep all HTTP nodes idle.`);
  const body = req.body ? JSON.parse(req.body) : {};
  switch (node.name) {
    case 'Apify: Run Pricing Scraper Actor': {
      const c = fixtureByKey.get(body.competitorKey);
      return { data: JSON.stringify(c && c.currentSnapshot ? [{ competitorKey: c.competitorKey, ...c.currentSnapshot }] : []) };
    }
    case 'HubSpot: Fetch Previous Snapshot': {
      const key = body.filterGroups[0].filters.find((x) => x.propertyName === 'competitor_key').value;
      const c = fixtureByKey.get(key);
      if (!c || !c.previousSnapshot) return { total: 0, results: [] };
      return { total: 1, results: [{ id: `mock-hs-prev-${key}`, properties: { snapshot_key: `${key}__2026-W46`, snapshot_json: JSON.stringify(c.previousSnapshot), snapshot_fingerprint: null } }] };
    }
    case 'HubSpot: Batch Upsert Snapshots':
      if (opt.failWrites) return { error: { message: 'Mock 429: secondly rate limit reached', httpCode: '429' } };
      return { status: 'COMPLETE', results: body.inputs.map((inp, k) => ({ id: `mock-hs-${k + 1}`, new: true, properties: { snapshot_key: inp.id } })) };
    case 'Slack: Post RevOps Alert':
    case 'Ops: Post Failure Alert':
      return { data: 'ok' };
    default:
      throw new Error(`No mock for HTTP node "${node.name}"`);
  }
};

const runHttp = async (node, input) => {
  const p = node.parameters;
  return input.map((item) => {
    const url = evalExpression(p.url, item);
    const headers = Object.fromEntries((p.headerParameters.parameters || []).map((h) => [h.name, evalExpression(h.value, item)]));
    const body = evalExpression(p.jsonBody, item);
    if (!/^https:\/\//.test(String(url))) throw new Error(`HTTP "${node.name}" resolved a non-https URL: ${mask(url)}`);
    if (headers.Authorization && /undefined|null/.test(headers.Authorization)) throw new Error(`HTTP "${node.name}" Authorization header did not resolve`);
    JSON.parse(body);
    httpCalls.push({ node: node.name, method: p.method, url: mask(url), bodyBytes: Buffer.byteLength(body), mocked: true });
    return { json: mockHttp(node, item, { url, headers, body }) };
  });
};

const execute = async (startName) => {
  const queue = [{ name: startName, input: [{ json: {} }] }];
  let guard = 0;
  while (queue.length) {
    if (++guard > 200) throw new Error('Execution guard tripped (possible cycle).');
    const { name, input } = queue.shift();
    const node = nodesByName.get(name);
    if (!node) throw new Error(`Connection points to unknown node "${name}"`);
    let outs;
    if (node.type === 'n8n-nodes-base.manualTrigger' || node.type === 'n8n-nodes-base.scheduleTrigger') outs = [input];
    else if (node.type === 'n8n-nodes-base.code') outs = [await runCode(node, input)];
    else if (node.type === 'n8n-nodes-base.if') outs = runIf(node, input);
    else if (node.type === 'n8n-nodes-base.httpRequest') outs = [await runHttp(node, input)];
    else throw new Error(`Simulator does not support node type ${node.type}`);
    outputs.set(name, outs);
    executed.push({ name, itemsIn: input.length, itemsOut: outs.map((o) => o.length) });
    const conn = workflow.connections[name];
    if (!conn) continue;
    conn.main.forEach((targets, outIdx) => {
      const items = outs[outIdx] || [];
      if (!items.length) return;
      for (const t of targets || []) queue.push({ name: t.node, input: items });
    });
  }
};

// ── Run ────────────────────────────────────────────────────────────────────
(async () => {
  const started = Date.now();
  let runError = null;
  try { await execute('Manual Test Trigger'); } catch (e) { runError = e; }

  const get = (n) => (outputs.has(n) ? outputs.get(n).flat()[0].json : null);
  const cfg = get('Config & Safety Gate');
  const engine = get('Pricing Diff & Intelligence Engine');
  const summary = get('Execution Summary & Audit');
  const preview = get('Dry-Run Write Preview');
  const slack = get('RevOps Slack Block Kit Builder');

  log(bold('\nCompetitor Pricing Page Diff Tracker · offline simulation'));
  log(dim(`workflow: ${path.relative(ROOT, WORKFLOW_PATH)} · fixture: ${path.relative(ROOT, fixturePath)} · ${opt.mockLive ? 'MOCK-LIVE (no network)' : 'sandbox defaults'}${opt.blockEnv ? ' · $env BLOCKED' : ''}`));

  if (cfg) {
    log(bold('\nSafety gates'));
    log(`  mode=${cfg.modeLabel}  sandbox=${cfg.sandboxMode}  dryRun=${cfg.dryRun}  hubspotLogging=${cfg.hubspotLoggingEnabled}`);
    log(`  allowHubspotWrite=${cfg.allowHubspotWrite}  allowSlackSend=${cfg.allowSlackSend}  allowOpsAlert=${cfg.allowOpsAlert}`);
    (cfg.warnings || []).forEach((w) => log(dim(`  ! ${w}`)));
  }
  if (engine) {
    log(bold('\nCompetitor results'));
    for (const r of engine.results) {
      log(`  ${r.alertWorthy ? '●' : '○'} ${r.competitorName.padEnd(20)} ${r.status.padEnd(16)} severity=${r.severity.padEnd(8)} changes=${(r.changes || []).length}`);
      for (const c of (r.changes || []).slice(0, 12)) log(dim(`      [${c.severity}] ${c.type}: ${c.message}`));
      for (const why of r.reviewReasons || []) log(dim(`      review: ${why}`));
    }
  }
  if (preview) log(bold('\nHubSpot (preview only)'), `\n  ${preview.endpoint}\n  would write ${preview.wouldWriteRecords} record(s): ${preview.recordKeys.join(', ')}  · blocked: ${preview.blockedReason}`);
  const writes = get('Collect HubSpot Write Results');
  if (writes) log(bold('\nHubSpot (mock live)'), `\n  upserted ${writes.recordsWritten}/${writes.recordsAttempted} · failures ${writes.failures.length}`);
  if (slack) log(bold('\nSlack Block Kit'), `\n  ${slack.blockCount} blocks · ${slack.alertCount} alert(s) · send=${slack.allowSend}${slack.skipReason ? ` (skipped: ${slack.skipReason})` : ''}\n  ${dim(slack.payload.text)}`);
  log(bold('\nHTTP calls'), httpCalls.length ? '' : '\n  none (zero external requests)');
  httpCalls.forEach((h) => log(`  ${h.method} ${h.url} · ${h.bodyBytes} B · mocked`));
  if (summary) log(bold('\nSummary'), `\n  status=${summary.status} · checksum=${summary.checksum} · opsAlert=${summary.needsOpsAlert}`);

  // ── Behavioural checks
  if (runError) check('workflow executed without throwing', false, runError.message);
  else check('workflow executed without throwing', true);
  if (cfg && opt.checks) {
    const outText = JSON.stringify([...outputs.values()]);
    check('no secret values leaked into any node output', secretValues.every((v) => !outText.includes(v)));
    if (!opt.mockLive && !opt.envFile && opt.set.length === 0) {
      check('safe defaults: sandbox on', cfg.sandboxMode === true);
      check('safe defaults: dry-run on', cfg.dryRun === true);
      check('safe defaults: CRM write gate closed', cfg.allowHubspotWrite === false);
      check('safe defaults: Slack gate closed', cfg.allowSlackSend === false);
      check('safe defaults: ops alert gate closed', cfg.allowOpsAlert === false);
      check('safe defaults: zero HTTP requests', httpCalls.length === 0);
    }
    if (usingDefaultFixture && engine) {
      const by = Object.fromEntries(engine.results.map((r) => [r.competitorKey, r]));
      const types = (k) => new Set((by[k].changes || []).map((c) => c.type));
      check('alpha: critical price increase detected', by['competitor-alpha'].severity === 'critical' && types('competitor-alpha').has('price_increase'));
      check('alpha: enterprise tier added + SSO gated up', types('competitor-alpha').has('tier_added') && types('competitor-alpha').has('feature_gated_up'));
      check('alpha: seat limit + annual discount shift', types('competitor-alpha').has('seat_limit_changed') && types('competitor-alpha').has('annual_discount_shift'));
      check('beta: pricing model shift + contact-sales move', types('beta-metrics').has('pricing_model_shift') && types('beta-metrics').has('moved_to_contact_sales'));
      check('beta: tier removed + free trial removed', types('beta-metrics').has('tier_removed') && types('beta-metrics').has('free_trial_changed'));
      check('gamma: no_change via fingerprint', by['gamma-ledger'].status === 'no_change' && !by['gamma-ledger'].alertWorthy);
      check('delta: baseline captured', by['delta-signal'].status === 'baseline');
      check('epsilon: broken scrape flagged for review, snapshot invalid', by['epsilon-grid'].status === 'review_required' && by['epsilon-grid'].snapshotValid === false);
      check('5 HubSpot records prepared', engine.hubspotRecords.length === 5);
      check('Slack payload within Block Kit limits', slack && slack.blockCount <= 50 && slack.payload.blocks.every((b) => !b.text || b.text.text.length <= 3000));
    }
    if (opt.mockLive) {
      check('mock-live: Apify called once per competitor', httpCalls.filter((h) => h.node.startsWith('Apify')).length === fixture.competitors.length);
      check('mock-live: HubSpot batch upsert executed', httpCalls.some((h) => h.node === 'HubSpot: Batch Upsert Snapshots'));
      if (opt.failWrites) {
        check('fail-writes: run completes with errors (no throw)', summary && summary.status === 'completed_with_errors');
        check('fail-writes: ops alert raised', summary && summary.needsOpsAlert === true && httpCalls.some((h) => h.node === 'Ops: Post Failure Alert'));
      } else check('mock-live: all records upserted', summary && summary.hubspot.recordsWritten === 5);
      check('mock-live: Slack alert sent', summary && summary.slack.status === 'sent');
      check('mock-live: secrets masked in request log', httpCalls.every((h) => !secretValues.some((v) => h.url.includes(v))));
    }
    if (opt.blockEnv) check('blocked $env falls back to sandbox + dry-run', cfg.sandboxMode && cfg.dryRun && !cfg.envAccessible);
  }

  log(bold('\nChecks'));
  for (const c of checks) log(`  ${c.pass ? ok('PASS') : bad('FAIL')} ${c.name}${c.detail ? dim(` — ${c.detail}`) : ''}`);
  const failed = checks.filter((c) => !c.pass);

  const report = { simulatedAt: new Date().toISOString(), durationMs: Date.now() - started, options: { mockLive: opt.mockLive, blockEnv: opt.blockEnv, fixture: path.relative(ROOT, fixturePath) }, executed, httpCalls, checks, audit: summary, engine, slackPayload: slack && slack.payload, hubspotPreview: preview };
  fs.mkdirSync(path.dirname(opt.out), { recursive: true });
  fs.writeFileSync(opt.out, mask(JSON.stringify(report, null, 2)));
  if (opt.json) console.log(mask(JSON.stringify(summary, null, 2)));
  log(dim(`\nFull report: ${path.relative(process.cwd(), opt.out)}`));
  log(failed.length ? bad(`\n${failed.length} check(s) failed.`) : ok(`\nAll ${checks.length} checks passed.`));
  if (runError && !opt.quiet) console.error(bad(runError.stack));
  process.exit(failed.length ? 1 : 0);
})();
