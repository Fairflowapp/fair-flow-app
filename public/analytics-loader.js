(function () {
  // Independent of each other — load as one parallel batch after the main chain.
  var scripts = [
    { src: "/queue-analytics.js?v=20260625_queue_analytics_split", type: "module" },
    { src: "/tickets-analytics.js?v=20260626_tickets_analytics_split", type: "module" },
    { src: "/time-analytics.js?v=20260626_time_analytics_split", type: "module" },
    { src: "/tasks-analytics.js?v=20260625_tasks_analytics_split", type: "module" }
  ];

  window.ffRunAnalyticsLoader = async function ffRunAnalyticsLoader(wait, loadScript) {
    await Promise.all(scripts.map(loadScript));
    return 0;
  };
})();
