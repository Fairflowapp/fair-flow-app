#!/usr/bin/env node
/**
 * Extract B2 (ffToast link), B4 (SafeLoader), B6 (ffInvMockStub), B10 (analytics) from index.html.
 */
import fs from 'fs';
import path from 'path';

const ROOT = path.resolve(import.meta.dirname, '..');
const INDEX = path.join(ROOT, 'public/index.html');
const BACKUP = path.join(ROOT, 'refactor-backups/index.html.pre-bootstrap-js-extract.bak');
const TOKEN = '20260704_bootstrap_js_extract';

const INV_STUB = `  window.goToInventory = window.goToInventory || async function ffInvMockStub() {
    if (typeof window.goToInventory === 'function' && window.goToInventory !== ffInvMockStub) {
      return window.goToInventory();
    }
    try {
      await import('/inventory.js?v=20260702_inventory_catalog_split');
    } catch (e) {
      console.error('[Inventory mock] load failed', e);
      return;
    }
    if (typeof window.goToInventory === 'function' && window.goToInventory !== ffInvMockStub) {
      return window.goToInventory();
    }
  };`;

const ANALYTICS_ENTRIES = `        { src: "/queue-analytics.js?v=20260625_queue_analytics_split", type: "module", delay: 5700 },
        { src: "/tickets-analytics.js?v=20260626_tickets_analytics_split", type: "module", delay: 6000 },
        { src: "/time-analytics.js?v=20260626_time_analytics_split", type: "module", delay: 6300 },
        { src: "/tasks-analytics.js?v=20260625_tasks_analytics_split", type: "module", delay: 6600 }`;

const html = fs.readFileSync(INDEX, 'utf8');
const lines = html.split('\n');

fs.mkdirSync(path.dirname(BACKUP), { recursive: true });
fs.copyFileSync(INDEX, BACKUP);

if (!html.includes(INV_STUB)) {
  console.error('FAIL: ffInvMockStub block not found verbatim');
  process.exit(1);
}

const SAFE_OUTER = lines.slice(56617, 56615 + 1).join('\n'); // 56618-56715
// Fix: slice is 0-based: lines 56618-56715 => slice(56617, 56715)
const safeOuter = lines.slice(56617, 56715).join('\n');
if (!safeOuter.includes('[SafeLoader]') || !safeOuter.startsWith('  <script>')) {
  console.error('FAIL: SafeLoader outer block');
  process.exit(1);
}
const safeInner = safeOuter.replace(/^  <script>\n/, '').replace(/\n  <\/script>$/, '');

const inventoryNavStub = `(function () {\n${INV_STUB}\n})();\n`;
fs.writeFileSync(path.join(ROOT, 'public/inventory-nav-stub.js'), inventoryNavStub, 'utf8');

const analyticsLoader = `(function () {
  var scripts = [
${ANALYTICS_ENTRIES}
  ];

  window.ffRunAnalyticsLoader = async function ffRunAnalyticsLoader(wait, loadScript, lastDelay) {
    for (var i = 0; i < scripts.length; i += 1) {
      var item = scripts[i];
      await wait(Math.max(0, (item.delay || 0) - lastDelay));
      lastDelay = item.delay || lastDelay;
      await loadScript(item);
    }
    return lastDelay;
  };
})();
`;
fs.writeFileSync(path.join(ROOT, 'public/analytics-loader.js'), analyticsLoader, 'utf8');

const loopTail = `        for (var i = 0; i < scripts.length; i += 1) {
          var item = scripts[i];
          await wait(Math.max(0, (item.delay || 0) - lastDelay));
          lastDelay = item.delay || lastDelay;
          await loadScript(item);
        }
      })();`;

const loopTailWithAnalytics = `        for (var i = 0; i < scripts.length; i += 1) {
          var item = scripts[i];
          await wait(Math.max(0, (item.delay || 0) - lastDelay));
          lastDelay = item.delay || lastDelay;
          await loadScript(item);
        }
        if (typeof window.ffRunAnalyticsLoader === 'function') {
          lastDelay = await window.ffRunAnalyticsLoader(wait, loadScript, lastDelay);
        }
      })();`;

const safeWithoutAnalytics = safeInner
  .replace(`,\n${ANALYTICS_ENTRIES}`, '')
  .replace(loopTail, loopTailWithAnalytics);
fs.writeFileSync(path.join(ROOT, 'public/safe-loader.js'), safeWithoutAnalytics, 'utf8');

let newHtml = html;

// B6
newHtml = newHtml.replace(INV_STUB + '\n', '');

// B2: move ff-toast to head
const oldToastTag = '<script src="/ff-toast.js?v=20260523_ios_resubmit"></script>';
const newToastTag = `<script src="/ff-toast.js?v=${TOKEN}"></script>`;
if (!newHtml.includes(oldToastTag)) {
  console.error('FAIL: ff-toast tag not found');
  process.exit(1);
}
newHtml = newHtml.replace('\n\n' + oldToastTag + '\n\n', '\n\n');
newHtml = newHtml.replace('\n' + oldToastTag + '\n', '\n');

const headInjection = `${newToastTag}
<script src="/inventory-nav-stub.js?v=${TOKEN}"></script>`;
newHtml = newHtml.replace(
  '</style>\n\n<meta charset',
  `</style>\n\n${headInjection}\n\n<meta charset`
);

// B4 + B10: replace SafeLoader outer block
const safeReplacement = `<script src="/analytics-loader.js?v=${TOKEN}"></script>
  <script src="/safe-loader.js?v=${TOKEN}"></script>`;
if (!newHtml.includes(safeOuter)) {
  console.error('FAIL: safeOuter not found in html after edits');
  process.exit(1);
}
newHtml = newHtml.replace(safeOuter, safeReplacement);

fs.writeFileSync(INDEX, newHtml, 'utf8');

console.log(
  JSON.stringify(
    {
      backup: BACKUP,
      token: TOKEN,
      files: [
        'public/inventory-nav-stub.js',
        'public/safe-loader.js',
        'public/analytics-loader.js',
      ],
      ffToast: 'moved to head with bumped ?v=',
      indexLinesBefore: lines.length,
      indexLinesAfter: newHtml.split('\n').length,
    },
    null,
    2
  )
);
