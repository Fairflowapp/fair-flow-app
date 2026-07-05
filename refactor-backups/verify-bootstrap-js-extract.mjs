#!/usr/bin/env node
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-bootstrap-js-extract.bak');
const INDEX = path.join(ROOT, 'public/index.html');
const TOKEN = '20260704_bootstrap_js_extract';

const backup = fs.readFileSync(BACKUP, 'utf8');
const index = fs.readFileSync(INDEX, 'utf8');
const invStub = fs.readFileSync(path.join(ROOT, 'public/inventory-nav-stub.js'), 'utf8');
const safeLoader = fs.readFileSync(path.join(ROOT, 'public/safe-loader.js'), 'utf8');
const analyticsLoader = fs.readFileSync(path.join(ROOT, 'public/analytics-loader.js'), 'utf8');

const INV_CORE = `window.goToInventory = window.goToInventory || async function ffInvMockStub()`;
const analyticsModules = [
  'queue-analytics.js',
  'tickets-analytics.js',
  'time-analytics.js',
  'tasks-analytics.js',
];

const backupLines = backup.split('\n');
const safeInnerOrig = backupLines.slice(56617, 56715).join('\n').replace(/^  <script>\n/, '').replace(/\n  <\/script>$/, '');

const checks = {
  backupExists: fs.existsSync(BACKUP),
  invStubHasFfInvMockStub: invStub.includes('ffInvMockStub'),
  invStubNotInHeadBlock: !index.includes(INV_CORE) || index.indexOf(INV_CORE) > index.indexOf('inventory-nav-stub.js'),
  invStubLinkInHead: index.includes(`<script src="/inventory-nav-stub.js?v=${TOKEN}">`),
  ffToastInHead: index.indexOf(`href="/main.css`) < index.indexOf(`ff-toast.js?v=${TOKEN}`),
  ffToastSingleScriptTag: (index.match(/<script src="\/ff-toast\.js/g) || []).length === 1,
  oldToastTokenGone: !index.includes('20260523_ios_resubmit'),
  safeLoaderExternal: index.includes(`<script src="/safe-loader.js?v=${TOKEN}">`),
  analyticsLoaderExternal: index.includes(`<script src="/analytics-loader.js?v=${TOKEN}">`),
  noInlineSafeLoader: !index.includes('billing-guard.js?v=20260604_staging_billing_bypass", type: "module", delay: 600'),
  safeLoaderHasBillingGuard: safeLoader.includes('billing-guard.js'),
  safeLoaderNoAnalyticsInArray: !safeLoader.includes('queue-analytics.js'),
  safeLoaderCallsAnalytics: safeLoader.includes('ffRunAnalyticsLoader'),
  analyticsHasAllFour: analyticsModules.every((m) => analyticsLoader.includes(m)),
  analyticsDefinesRunner: analyticsLoader.includes('window.ffRunAnalyticsLoader'),
  safeLoaderPreservesWaitForSalon: safeLoader.includes('waitForSalonReady'),
  safeInnerMinusAnalyticsInSafeLoader: safeLoader.includes('locations-manage.js') && safeLoader.includes('[SafeLoader]'),
};

let ok = true;
for (const [k, v] of Object.entries(checks)) {
  if (!v) {
    console.error('FAIL:', k);
    ok = false;
  }
}

// Syntax check
import { execSync } from 'child_process';
for (const f of ['inventory-nav-stub.js', 'safe-loader.js', 'analytics-loader.js']) {
  try {
    execSync(`node --check public/${f}`, { cwd: ROOT, stdio: 'pipe' });
  } catch (e) {
    console.error('FAIL: syntax', f, e.stderr?.toString());
    ok = false;
  }
}

console.log(JSON.stringify({ token: TOKEN, checks, indexLines: index.split('\n').length, lineReduction: backup.split('\n').length - index.split('\n').length }, null, 2));
if (!ok) process.exit(1);
console.log('OK: verification passed');
