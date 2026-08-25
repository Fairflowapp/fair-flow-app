    (function () {
      // Sequential load (stage-2 full parallel batching reverted — raced
      // window globals / staff+settings UI). Order is still monotonic, but
      // delays are compressed and employee-onboarding is deferred until after
      // Queue/Schedule so first interactive screens arrive sooner.
      var scripts = [
        { src: "/billing-guard.js?v=20260604_staging_billing_bypass", type: "module", delay: 200 },
        { src: "/staff-cloud.js?v=20260509_hydrate_session_fix", type: "module", delay: 250 },
        { src: "/settings-cloud.js?v=20260816_sat_open2", type: "module", delay: 300 },
        { src: "/time-clock-entries.js?v=20260805_tc_schedule_s4", type: "module", delay: 350 },
        { src: "/locations-cloud.js?v=20260501_points", type: "module", delay: 400 },
        { src: "/location-helpers.js?v=20260603_owner_primary_location", delay: 450 },
        { src: "/location-switcher.js?v=20260514_location_fallback", type: "module", delay: 500 },
        { src: "/queue-cloud.js?v=20260813_sync_intent", type: "module", delay: 550 },
        { src: "/tickets.js?v=20260824_svc_load_fix", type: "module", delay: 600 },
        { src: "/tasks-cloud.js?v=20260727_tasks_done_60d", type: "module", delay: 650 },
        { src: "/points-engine.js?v=20260625_points_split", type: "module", delay: 700 },
        { src: "/schedule-helpers.js?v=20260816_sat_open", type: "module", delay: 750 },
        { src: "/schedule-availability.js?v=20260501_points", type: "module", delay: 800 },
        { src: "/schedule-generator.js?v=20260501_points", type: "module", delay: 850 },
        { src: "/schedule-validator.js?v=20260501_points", type: "module", delay: 900 },
        { src: "/schedule-ui.js?v=20260816_cell_notes7", type: "module", delay: 1000 },
        { src: "/dashboard.js?v=20260626_dashboard_split", type: "module", delay: 1100 },
        { src: "/onboarding-wizard.js?v=20260625_onboarding_split", type: "module", delay: 1100 },
        { src: "/inbox.js?v=20260816_od_link", type: "module", delay: 1200 },
        { src: "/media-upload.js?v=20260719_media_lightbox", type: "module", delay: 1250 },
        { src: "/chat.js?v=20260806_sched_12h_picker", type: "module", delay: 1300 },
        { src: "/floor-flows.js?v=20260616_floor_flow_save_state_fix", type: "module", delay: 1400 },
        { src: "/floor-cloud.js?v=20260618_live_floor_realtime_refresh", type: "module", delay: 1450 },
        { src: "/sticky-notes-cloud.js?v=20260727_note_colors", type: "module", delay: 1500 },
        { src: "/staff-documents.js?v=20260816_od_link", type: "module", delay: 1550 },
        // Employee onboarding (settings + staff runs) — after core staff/docs UI
        { src: "/employee-onboarding/task-registry.js?v=20260816_od_link", type: "module", delay: 1600 },
        { src: "/employee-onboarding/audience.js?v=20260808_onboarding_hardening", type: "module", delay: 1620 },
        { src: "/employee-onboarding/settings-cloud.js?v=20260816_od_del2", type: "module", delay: 1640 },
        { src: "/employee-onboarding/esign-library-cloud.js?v=20260816_od_bin", type: "module", delay: 1660 },
        { src: "/employee-onboarding/esign-field-editor.js?v=20260816_od_bin", type: "module", delay: 1680 },
        { src: "/employee-onboarding/settings-ui.js?v=20260816_od_open", type: "module", delay: 1700 },
        { src: "/employee-onboarding/run-cloud.js?v=20260815_od_s7", type: "module", delay: 1720 },
        { src: "/employee-onboarding/run-ui.js?v=20260815_od_s7b", type: "module", delay: 1740 },
        { src: "/employee-onboarding/portal-manager.js?v=20260815_od_s6", type: "module", delay: 1760 },
        { src: "/staff-writeups.js?v=20260802_writeups_phase2d", type: "module", delay: 1850 },
        { src: "/my-writeups.js?v=20260803_writeups_push", type: "module", delay: 1900 },
        { src: "/staff-call-cloud.js?v=20260505_member_presence", type: "module", delay: 1900 },
        { src: "/push-notifications.js?v=20260805_tc_schedule_push", type: "module", delay: 2000 },
        { src: "/billing-cloud.js?v=20260609_native_readonly_billing", type: "module", delay: 2100 },
        { src: "/time-clock-engine.js?v=20260501_points", delay: 2200 },
        { src: "/inventory.js?v=20260728_inv_mobile_unstick", type: "module", delay: 2300 },
        { src: "/locations-manage.js?v=20260609_native_web_app_wording", type: "module", delay: 2400 }
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
      // loading the heavy module scripts. Loading many modules during the login
      // flow attached many onAuthStateChanged listeners that all fired in
      // parallel when the user signed in, blocking Chrome's main thread.
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
