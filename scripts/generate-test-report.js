/**
 * Module-wise HTML test report with charts & analytics.
 *
 * Runs the jest suite with --json, then renders a single self-contained HTML
 * dashboard (no external deps, works offline):
 *   - summary cards + pass/fail donut + per-module stacked bars
 *   - one section per API module: every test with status, duration and message
 *   - each module's example request payload + success response (API contract)
 *
 * Usage:  npm run test:html   ->  reports/test-report.html
 */
const { spawnSync } = require('child_process');
const fs = require('fs');
const path = require('path');

const ROOT = path.join(__dirname, '..');
const REPORTS_DIR = path.join(ROOT, 'reports');
const JSON_FILE = path.join(REPORTS_DIR, 'jest-results.json');
const HTML_FILE = path.join(REPORTS_DIR, 'test-report.html');

/** Module metadata: audit ids + example request payload + success message/response. */
const MODULES = {
  'auth.service.spec': {
    module: 'auth',
    audit: 'A1',
    endpoint: 'POST /admin/v2/auth/login',
    payload: { username: 'admin@stayhopper.com', password: '••••••••' },
    success: {
      status: 1,
      message: 'Login successful',
      token: '<jwt — minimal {_id,email,role} claims, no password hash>',
      user: '{ …administrator, password/activationCode/autoLoginCode stripped }',
    },
  },
  'administrators.service.spec': {
    module: 'administrators',
    audit: 'A2',
    endpoint: 'DELETE /admin/v2/administrators/:id · POST /administrators/check_active_bookings',
    payload: { hoteladmin_id: '<administrator id>' },
    success: {
      check_active_bookings: { status: 1, count: 3 },
      delete_blocked_400: {
        status: 0,
        message: 'Administrator has properties with active bookings and cannot be deleted',
        count: 3,
      },
    },
  },
  'users.service.spec': {
    module: 'users',
    audit: 'A3',
    endpoint: 'GET /admin/v2/users/:id',
    payload: { params: { id: '<user id>' } },
    success: {
      bookings: {
        amount: 150,
        count: 3,
        bookings: '[ ≤100 latest active bookings ]',
        completedBookings: '[ ≤100 latest completed bookings ]',
      },
    },
  },
  'user-ratings.service.spec': {
    module: 'user-ratings',
    audit: 'A4',
    endpoint: 'PUT /admin/v2/user-ratings/:id/approval/:status',
    payload: { params: { id: '<rating id>', status: 'true | false' } },
    success: {
      ok: '{ …rating, approved: <boolean> } + property.user_rating recomputed',
      invalid_400: { message: "Invalid status value; expected 'true' or 'false'" },
    },
  },
  'properties.service.spec': {
    module: 'properties',
    audit: 'A5',
    endpoint: 'GET|PUT|DELETE /admin/v2/properties/:id (+ nearby / photos)',
    payload: { name: 'Hotel X', contactinfo: {}, '…': 'large nested payload preserved' },
    success: {
      ok: '{ …property } (approved/published/user_rating gated)',
      foreign_403: { message: 'You do not have permission to access this resource' },
      delete_blocked_400: { status: 0, message: 'Property has active bookings and cannot be deleted', count: 2 },
    },
  },
  'rooms.service.spec': {
    module: 'rooms',
    audit: 'A6',
    endpoint: 'GET /admin/v2/rooms · GET|PUT|DELETE /rooms/:id (+ rates / availability / photos)',
    payload: { propertyId: '<owned property id>' },
    success: {
      list: '{ list, itemCount, pageCount, pages, active_page } (owner-scoped)',
      delete_blocked_400: { status: 0, message: 'Room have active bookings, Could not delete now' },
    },
  },
  'bookings.service.spec': {
    module: 'bookings',
    audit: 'A7',
    endpoint: 'POST /admin/v2/bookings/cancel · /reject-cancellation/:id · DELETE /:id · noshow flows',
    payload: { id: '<booking id>' },
    success: {
      cancel: { message: 'Booking Cancellation Request sent successfully!' },
      reject: { message: 'Cancellation request rejected by admin' },
      foreign_403: { message: 'You do not have permission to access this resource' },
    },
  },
  'invoices.service.spec': {
    module: 'invoices',
    audit: 'A8',
    endpoint: 'POST|PUT /admin/v2/invoices',
    payload: { amount: 500, status: 'pending', property: '<property id>', hacked: '(dropped by allowlist)' },
    success: '{ …invoice } — only the 22 allowlisted fields are written',
  },
  'payments.service.spec': {
    module: 'payments',
    audit: 'A8',
    endpoint: 'GET /admin/v2/capture/:bookingId?transactionId=… · GET /admin/v2/return/:bookingId',
    payload: { params: { bookingId: '<booking id>' }, query: { transactionId: 'txn_123' } },
    success: {
      capture: '{ status: 1, url: <vcc url> } + guest & hotel confirmation emails',
      return: '{ status: 1 } + guest & hotel cancellation emails',
      already_processed: { status: 0 },
    },
  },
  'cities.crud.spec': {
    module: 'crud (cities)',
    audit: 'A16',
    endpoint: 'GET /admin/v2/cities',
    payload: { query: { country: '<country id>', page: 1, limit: 10 } },
    success: '{ list, itemCount, pageCount, pages, active_page, countries: [ …sorted ] }',
  },
  'commissions.controller.spec': {
    module: 'commissions',
    audit: 'A30',
    endpoint: 'PUT /admin/v2/commissions',
    payload: {},
    success: 'HTTP 200 { success: true }  (v2 wrongly returned 400)',
  },
  'owner-scope.spec': {
    module: 'common (owner-scope)',
    audit: 'A5/A6/A7',
    endpoint: 'internal helper used by properties / rooms / bookings by-id routes',
    payload: { user: '{ role: { permissions: [LIST_OWN_*] } }' },
    success: 'owned → passes · foreign → 403 ForbiddenException · LIST_ALL_* → unrestricted',
  },
};

// ---------------------------------------------------------------------------
// 1. Run jest
// ---------------------------------------------------------------------------
fs.mkdirSync(REPORTS_DIR, { recursive: true });

let jestBin;
try {
  jestBin = require.resolve('jest/bin/jest');
} catch (e) {
  jestBin = null;
}

console.log('Running jest suite (module-wise)…');
const run = jestBin
  ? spawnSync(process.execPath, [jestBin, '--json', `--outputFile=${JSON_FILE}`], {
      cwd: ROOT,
      stdio: ['ignore', 'inherit', 'inherit'],
    })
  : spawnSync('npx jest --json --outputFile="' + JSON_FILE + '"', {
      cwd: ROOT,
      shell: true,
      stdio: ['ignore', 'inherit', 'inherit'],
    });

if (!fs.existsSync(JSON_FILE)) {
  console.error('\nJest did not produce a JSON results file — is jest installed? (npm install)');
  process.exit(run.status || 1);
}

const results = JSON.parse(fs.readFileSync(JSON_FILE, 'utf8'));

// ---------------------------------------------------------------------------
// 2. Aggregate per module
// ---------------------------------------------------------------------------
const stripAnsi = (s) => String(s).replace(/\[[0-9;]*m/g, '');
const esc = (s) =>
  String(s).replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

const suites = results.testResults.map((suite) => {
  const base = path.basename(suite.name).replace(/\.ts$/, '');
  const meta = MODULES[base] || { module: base, audit: '—', endpoint: '—', payload: {}, success: '—' };
  const tests = (suite.assertionResults || []).map((t) => ({
    group: (t.ancestorTitles || []).slice(1).join(' › '),
    title: t.title,
    status: t.status,
    duration: t.duration || 0,
    message: t.failureMessages && t.failureMessages.length
      ? stripAnsi(t.failureMessages.join('\n')).split('\n').slice(0, 12).join('\n')
      : '✓ Passed',
  }));
  const passed = tests.filter((t) => t.status === 'passed').length;
  const failed = tests.filter((t) => t.status === 'failed').length;
  return { base, meta, tests, passed, failed, total: tests.length };
});
suites.sort((a, b) => a.meta.module.localeCompare(b.meta.module));

const totals = {
  suites: suites.length,
  tests: results.numTotalTests,
  passed: results.numPassedTests,
  failed: results.numFailedTests,
  pending: results.numPendingTests,
  durationMs: suites.reduce(
    (acc, s) => acc + s.tests.reduce((a, t) => a + t.duration, 0),
    0,
  ),
};
const passPct = totals.tests ? Math.round((totals.passed / totals.tests) * 100) : 0;

// ---------------------------------------------------------------------------
// 3. Render HTML (self-contained: CSS charts, no CDN)
// ---------------------------------------------------------------------------
const moduleBars = suites
  .map((s) => {
    const passW = s.total ? (s.passed / s.total) * 100 : 0;
    const failW = s.total ? (s.failed / s.total) * 100 : 0;
    return `
      <div class="bar-row">
        <div class="bar-label">${esc(s.meta.module)} <span class="audit">${esc(s.meta.audit)}</span></div>
        <div class="bar-track">
          <div class="bar pass" style="width:${passW}%"></div>
          <div class="bar fail" style="width:${failW}%"></div>
        </div>
        <div class="bar-count">${s.passed}/${s.total}</div>
      </div>`;
  })
  .join('');

const moduleSections = suites
  .map((s) => {
    const rows = s.tests
      .map(
        (t) => `
        <tr class="${t.status}">
          <td><span class="badge ${t.status}">${t.status === 'passed' ? 'PASS' : t.status.toUpperCase()}</span></td>
          <td>${t.group ? `<span class="group">${esc(t.group)}</span><br>` : ''}${esc(t.title)}</td>
          <td class="num">${t.duration} ms</td>
          <td class="msg"><pre>${esc(t.message)}</pre></td>
        </tr>`,
      )
      .join('');
    return `
      <section class="module ${s.failed ? 'has-fail' : ''}" id="${esc(s.base)}">
        <h2>${esc(s.meta.module)} <span class="audit">audit ${esc(s.meta.audit)}</span>
          <span class="pill ${s.failed ? 'fail' : 'pass'}">${s.passed}/${s.total} passed</span></h2>
        <div class="contract">
          <div><strong>Endpoint(s):</strong> ${esc(s.meta.endpoint)}</div>
          <div class="cols">
            <div><strong>Example payload</strong><pre>${esc(JSON.stringify(s.meta.payload, null, 2))}</pre></div>
            <div><strong>Success message / response</strong><pre>${esc(
              typeof s.meta.success === 'string' ? s.meta.success : JSON.stringify(s.meta.success, null, 2),
            )}</pre></div>
          </div>
        </div>
        <table>
          <thead><tr><th>Status</th><th>Test</th><th>Duration</th><th>Message</th></tr></thead>
          <tbody>${rows}</tbody>
        </table>
      </section>`;
  })
  .join('');

const html = `<!DOCTYPE html>
<html lang="en">
<head>
<meta charset="utf-8">
<title>StayHopper API — Module-wise Test Report</title>
<style>
  :root { --pass:#16a34a; --fail:#dc2626; --ink:#0f172a; --muted:#64748b; --bg:#f8fafc; --card:#fff; --line:#e2e8f0; }
  * { box-sizing:border-box; }
  body { font-family:'Segoe UI',system-ui,sans-serif; margin:0; background:var(--bg); color:var(--ink); }
  header { background:var(--ink); color:#fff; padding:24px 32px; }
  header h1 { margin:0 0 4px; font-size:22px; }
  header .sub { color:#94a3b8; font-size:13px; }
  main { max-width:1100px; margin:0 auto; padding:24px 32px 64px; }
  .cards { display:grid; grid-template-columns:repeat(auto-fit,minmax(140px,1fr)); gap:12px; margin:20px 0; }
  .card { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:14px 16px; }
  .card .v { font-size:26px; font-weight:700; }
  .card .k { font-size:12px; color:var(--muted); text-transform:uppercase; letter-spacing:.04em; }
  .card.pass .v { color:var(--pass); } .card.fail .v { color:var(--fail); }
  .charts { display:grid; grid-template-columns:220px 1fr; gap:20px; align-items:start; margin:8px 0 28px; }
  .donut-wrap { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; text-align:center; }
  .donut { width:150px; height:150px; border-radius:50%; margin:0 auto;
    background:conic-gradient(var(--pass) 0 ${passPct}%, var(--fail) ${passPct}% 100%);
    display:flex; align-items:center; justify-content:center; }
  .donut .hole { width:96px; height:96px; border-radius:50%; background:var(--card);
    display:flex; align-items:center; justify-content:center; font-weight:700; font-size:20px; }
  .bars { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px; }
  .bar-row { display:grid; grid-template-columns:230px 1fr 60px; gap:10px; align-items:center; margin:7px 0; font-size:13px; }
  .bar-track { display:flex; height:14px; background:#f1f5f9; border-radius:7px; overflow:hidden; }
  .bar.pass { background:var(--pass); } .bar.fail { background:var(--fail); }
  .bar-count { text-align:right; color:var(--muted); }
  .audit { font-size:11px; color:var(--muted); background:#f1f5f9; border-radius:6px; padding:1px 6px; margin-left:4px; }
  section.module { background:var(--card); border:1px solid var(--line); border-radius:10px; padding:18px 20px; margin:18px 0; }
  section.module.has-fail { border-color:var(--fail); }
  section.module h2 { margin:0 0 10px; font-size:17px; }
  .pill { font-size:12px; border-radius:999px; padding:2px 10px; color:#fff; margin-left:8px; vertical-align:middle; }
  .pill.pass { background:var(--pass); } .pill.fail { background:var(--fail); }
  .contract { background:#f8fafc; border:1px solid var(--line); border-radius:8px; padding:10px 14px; font-size:13px; margin-bottom:12px; }
  .contract .cols { display:grid; grid-template-columns:1fr 1fr; gap:14px; margin-top:8px; }
  pre { background:#0f172a; color:#e2e8f0; border-radius:6px; padding:8px 10px; font-size:11.5px; overflow:auto; margin:4px 0 0; white-space:pre-wrap; }
  table { width:100%; border-collapse:collapse; font-size:13px; }
  th { text-align:left; color:var(--muted); font-size:11px; text-transform:uppercase; letter-spacing:.04em; border-bottom:1px solid var(--line); padding:6px 8px; }
  td { border-bottom:1px solid var(--line); padding:7px 8px; vertical-align:top; }
  td.num { white-space:nowrap; color:var(--muted); }
  td.msg pre { background:#f1f5f9; color:#334155; max-height:180px; }
  tr.passed td.msg pre { color:var(--pass); background:#f0fdf4; }
  .badge { font-size:11px; font-weight:700; border-radius:5px; padding:2px 7px; color:#fff; }
  .badge.passed { background:var(--pass); } .badge.failed { background:var(--fail); }
  .group { color:var(--muted); font-size:11px; }
  footer { text-align:center; color:var(--muted); font-size:12px; padding:20px; }
</style>
</head>
<body>
<header>
  <h1>StayHopper API — Module-wise Test Report</h1>
  <div class="sub">Audit-fix verification suite · generated ${new Date().toLocaleString()} · ${
    totals.failed ? '❌ FAILURES PRESENT' : '✅ all green'
  }</div>
</header>
<main>
  <div class="cards">
    <div class="card"><div class="v">${totals.suites}</div><div class="k">Modules</div></div>
    <div class="card"><div class="v">${totals.tests}</div><div class="k">Tests</div></div>
    <div class="card pass"><div class="v">${totals.passed}</div><div class="k">Passed</div></div>
    <div class="card fail"><div class="v">${totals.failed}</div><div class="k">Failed</div></div>
    <div class="card"><div class="v">${totals.durationMs} ms</div><div class="k">Test time</div></div>
  </div>
  <div class="charts">
    <div class="donut-wrap">
      <div class="donut"><div class="hole">${passPct}%</div></div>
      <div style="margin-top:10px;font-size:13px;color:var(--muted)">pass rate</div>
    </div>
    <div class="bars"><strong style="font-size:13px">Per-module results</strong>${moduleBars}</div>
  </div>
  ${moduleSections}
</main>
<footer>sh-api-nest · jest unit suites over the audit fixes (docs/audit/FIX_CHANGELOG.md)</footer>
</body>
</html>`;

fs.writeFileSync(HTML_FILE, html, 'utf8');
console.log(`\nHTML report written to ${HTML_FILE}`);
console.log(
  `Summary: ${totals.passed}/${totals.tests} passed across ${totals.suites} modules (${passPct}%).`,
);
process.exit(run.status || 0);
