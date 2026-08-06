/**
 * Points engine — public entry point.
 *
 * Loaded as a module script from index.html and exposes the points API on
 * window. Internals are split across:
 *   - points-keys.js     (pure period/id helpers)
 *   - points-config.js   (defaults, normalize, db handle)
 *   - points-settings.js (ffGetPointsSettings)
 *   - points-events.js   (ffCreatePointsEvent, ffVoidPointsEvent)
 *
 * The window assignments below preserve the original semantics exactly:
 * ffGetPointsSettings yields to any pre-existing global (index.html defines
 * its own inline version that wins at runtime), while the two event functions
 * are assigned unconditionally.
 */
import { ffGetPointsSettings } from "./points-settings.js?v=20260625_points_split";
import {
  ffCreatePointsEvent,
  ffVoidPointsEvent,
} from "./points-events.js?v=20260625_points_split";

export { ffGetPointsSettings, ffCreatePointsEvent, ffVoidPointsEvent };

if (typeof window !== "undefined") {
  window.ffGetPointsSettings = window.ffGetPointsSettings || ffGetPointsSettings;
  window.ffCreatePointsEvent = ffCreatePointsEvent;
  window.ffVoidPointsEvent = ffVoidPointsEvent;
}
