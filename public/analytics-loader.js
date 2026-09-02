(function () {
  // Sequential after the main chain (stage-2 parallel batch reverted).
  // delays follow the main chain, which ends at 4000.
  var scripts = [
    { src: "/queue-analytics.js?v=20260816_dash_live", type: "module", delay: 4300 },
    { src: "/tickets-analytics.js?v=20260816_dash_range", type: "module", delay: 4600 },
    { src: "/time-analytics.js?v=20260626_time_analytics_split", type: "module", delay: 4900 },
    { src: "/tasks-analytics.js?v=20260816_tasks_week", type: "module", delay: 5200 }
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
