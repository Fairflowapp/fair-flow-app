    (function () {
      var scripts = [
        { src: "/billing-guard.js?v=20260604_staging_billing_bypass", type: "module", delay: 600 }, // global account-state enforcement (banner / lock overlay)
        { src: "/staff-cloud.js?v=20260509_hydrate_session_fix", type: "module", delay: 700 },
        { src: "/locations-cloud.js?v=20260501_points", type: "module", delay: 900 },
        { src: "/location-helpers.js?v=20260603_owner_primary_location", delay: 1050 },
        { src: "/location-switcher.js?v=20260514_location_fallback", type: "module", delay: 1200 },
        { src: "/queue-cloud.js?v=20260609_merge_base_consistency", type: "module", delay: 1350 },
        { src: "/tickets.js?v=20260708_ticket_list_fix", type: "module", delay: 1400 },
        { src: "/tasks-cloud.js?v=20260610_tasks_rules_direct_sync", type: "module", delay: 1500 },
        { src: "/points-engine.js?v=20260625_points_split", type: "module", delay: 1650 },
        { src: "/schedule-helpers.js?v=20260625_loc_fallback", type: "module", delay: 1800 },
        { src: "/schedule-availability.js?v=20260501_points", type: "module", delay: 1900 },
        { src: "/schedule-generator.js?v=20260501_points", type: "module", delay: 2000 },
        { src: "/schedule-validator.js?v=20260501_points", type: "module", delay: 2100 },
        { src: "/schedule-ui.js?v=20260704_schedule_nav_runtime_viewtabs_fix", type: "module", delay: 2300 },
        { src: "/dashboard.js?v=20260626_dashboard_split", type: "module", delay: 2500 },
        { src: "/onboarding-wizard.js?v=20260625_onboarding_split", type: "module", delay: 1800 },
        { src: "/inbox.js?v=20260630_inbox_cleanup", type: "module", delay: 2700 },
        { src: "/media-upload.js?v=20260719_media_lightbox", type: "module", delay: 2780 },
        { src: "/chat.js?v=20260701_chat_compose_split", type: "module", delay: 2900 },
        { src: "/floor-flows.js?v=20260616_floor_flow_save_state_fix", type: "module", delay: 3050 },
        { src: "/floor-cloud.js?v=20260618_live_floor_realtime_refresh", type: "module", delay: 3120 },
        { src: "/staff-documents.js?v=20260516_ios_document_viewer", type: "module", delay: 3200 },
        { src: "/staff-call-cloud.js?v=20260505_member_presence", type: "module", delay: 3400 },
        { src: "/push-notifications.js?v=20260524_ios_fcm_bridge_retry", type: "module", delay: 3500 },
        { src: "/settings-cloud.js?v=20260618_ticket_customer_required_fix", type: "module", delay: 3600 },
        { src: "/billing-cloud.js?v=20260609_native_readonly_billing", type: "module", delay: 3650 }, // bumped: native (mobile) read-only billing — payment-method last-4 + blocked payment actions
        { src: "/time-clock-engine.js?v=20260501_points", delay: 3800 },
        { src: "/time-clock-entries.js?v=20260512_manage_wait", type: "module", delay: 3000 },
        { src: "/inventory.js?v=20260702_inventory_catalog_split", type: "module", delay: 4900 },
        { src: "/locations-manage.js?v=20260609_native_web_app_wording", type: "module", delay: 5400 }
      ];
      function wait(ms) {
        return new Promise(function (resolve) { setTimeout(resolve, ms); });
      }
      function loadScript(item) {
        return new Promise(function (resolve) {
          var s = document.createElement("script");
          if (item.type) s.type = item.type;
          s.src = item.src;
          s.onload = resolve;
          s.onerror = function () {
            console.warn("[SafeLoader] Failed to load", item.src);
            resolve();
          };
          document.body.appendChild(s);
        });
      }
      // Wait until the user is authenticated AND a salon is selected before
      // loading the heavy module scripts. Loading 29 modules during the login
      // flow attached 29 onAuthStateChanged listeners that all fired in parallel
      // when the user signed in, blocking Chrome's main thread long enough to
      // trigger the "This page isn't responding" dialog. By gating the loader
      // on currentSalonId we guarantee subscriptions only run for the chosen
      // salon and never race the auth resolution.
      function waitForSalonReady() {
        return new Promise(function (resolve) {
          function ready() {
            try {
              if (typeof window === "undefined") return false;
              if (window.__ff_waiting_for_salon_choice === true) return false;
              if (!window.ffAuth || !window.ffAuth.currentUser) return false;
              if (!window.currentSalonId) return false;
              return true;
            } catch (_) { return false; }
          }
          if (ready()) { resolve(); return; }
          var poll = setInterval(function () {
            if (ready()) {
              clearInterval(poll);
              resolve();
            }
          }, 200);
          // Hard cap at 10 minutes so a stalled session can't leak the interval.
          setTimeout(function () { clearInterval(poll); resolve(); }, 600000);
        });
      }
      (async function loadSafely() {
        try { await waitForSalonReady(); } catch (_) {}
        // Once salon is ready, load all modules with the original sequential
        // delays preserved so we don't overload the browser with 29 simultaneous
        // module evaluations.
        var lastDelay = 0;
        for (var i = 0; i < scripts.length; i += 1) {
          var item = scripts[i];
          await wait(Math.max(0, (item.delay || 0) - lastDelay));
          lastDelay = item.delay || lastDelay;
          await loadScript(item);
        }
        if (typeof window.ffRunAnalyticsLoader === 'function') {
          lastDelay = await window.ffRunAnalyticsLoader(wait, loadScript, lastDelay);
        }
      })();
    })();