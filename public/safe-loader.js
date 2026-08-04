    (function () {
      // Stage 2: load in ordered batches of 3–4. Items inside a batch are
      // independent (or only need app.js / Firebase CDN). Batches themselves
      // stay sequential so window-global and ordering deps are preserved:
      //   locations-cloud → location-helpers → location-switcher
      //   schedule-helpers → availability → generator → validator → schedule-ui
      //   floor-flows → floor-cloud
      //   staff-documents → staff-writeups
      // settings-cloud statically imports schedule-helpers, so its module graph
      // pulls those files early — the later schedule-* entries stay cached.
      var batches = [
        [
          { src: "/billing-guard.js?v=20260604_staging_billing_bypass", type: "module" },
          { src: "/staff-cloud.js?v=20260509_hydrate_session_fix", type: "module" },
          { src: "/settings-cloud.js?v=20260719_queue_client_autoreset_off", type: "module" },
          { src: "/time-clock-entries.js?v=20260512_manage_wait", type: "module" }
        ],
        [
          { src: "/locations-cloud.js?v=20260501_points", type: "module" }
        ],
        [
          { src: "/location-helpers.js?v=20260603_owner_primary_location" }
        ],
        [
          { src: "/location-switcher.js?v=20260514_location_fallback", type: "module" },
          { src: "/queue-cloud.js?v=20260728_cloud_wins_guard", type: "module" },
          { src: "/tickets.js?v=20260721_ticket_soft_delete", type: "module" },
          { src: "/tasks-cloud.js?v=20260727_tasks_done_60d", type: "module" }
        ],
        [
          { src: "/points-engine.js?v=20260625_points_split", type: "module" },
          { src: "/schedule-helpers.js?v=20260625_loc_fallback", type: "module" }
        ],
        [
          { src: "/schedule-availability.js?v=20260501_points", type: "module" },
          { src: "/schedule-generator.js?v=20260501_points", type: "module" },
          { src: "/schedule-validator.js?v=20260501_points", type: "module" }
        ],
        [
          { src: "/schedule-ui.js?v=20260704_schedule_nav_runtime_viewtabs_fix", type: "module" },
          { src: "/dashboard.js?v=20260626_dashboard_split", type: "module" },
          { src: "/onboarding-wizard.js?v=20260625_onboarding_split", type: "module" }
        ],
        [
          { src: "/inbox.js?v=20260721_inbox_modal_stack", type: "module" },
          { src: "/media-upload.js?v=20260719_media_lightbox", type: "module" },
          { src: "/chat.js?v=20260701_chat_compose_split", type: "module" }
        ],
        [
          { src: "/floor-flows.js?v=20260616_floor_flow_save_state_fix", type: "module" }
        ],
        [
          { src: "/floor-cloud.js?v=20260618_live_floor_realtime_refresh", type: "module" },
          { src: "/sticky-notes-cloud.js?v=20260727_note_colors", type: "module" },
          { src: "/staff-documents.js?v=20260516_ios_document_viewer", type: "module" }
        ],
        [
          { src: "/staff-writeups.js?v=20260802_writeups_phase2d", type: "module" },
          { src: "/my-writeups.js?v=20260803_writeups_push", type: "module" },
          { src: "/staff-call-cloud.js?v=20260505_member_presence", type: "module" },
          { src: "/push-notifications.js?v=20260803_writeups_push", type: "module" }
        ],
        [
          { src: "/billing-cloud.js?v=20260609_native_readonly_billing", type: "module" },
          { src: "/time-clock-engine.js?v=20260501_points" },
          { src: "/inventory.js?v=20260728_inv_mobile_unstick", type: "module" },
          { src: "/locations-manage.js?v=20260609_native_web_app_wording", type: "module" }
        ]
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
      // flow attached dozens of onAuthStateChanged listeners that all fired in
      // parallel when the user signed in, blocking Chrome's main thread long
      // enough to trigger the "This page isn't responding" dialog. By gating
      // the loader on currentSalonId we guarantee subscriptions only run for
      // the chosen salon and never race the auth resolution.
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
        // Small gap after salon-ready so auth listeners settle, then run
        // batches. Within a batch: parallel (max 4). Between batches: await.
        await wait(200);
        for (var b = 0; b < batches.length; b += 1) {
          await Promise.all(batches[b].map(loadScript));
          // Brief yield between batches so a long evaluation burst can't freeze
          // the main thread the way a full parallel load used to.
          if (b < batches.length - 1) await wait(40);
        }
        if (typeof window.ffRunAnalyticsLoader === "function") {
          await window.ffRunAnalyticsLoader(wait, loadScript, 0);
        }
      })();
    })();
