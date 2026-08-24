/**
 * Salon-scoped staging backfill for clients.phoneKeyPrefixes.
 *
 * Usage:
 *   node scripts/backfill-client-phone-key-prefixes.mjs --project fair-flow-staging --salonId <salonId>
 *
 * Refuses production. Safe to rerun. Updates only the prefixes field.
 */
import { createRequire } from "module";
import { readFileSync, writeFileSync, mkdtempSync } from "fs";
import { tmpdir } from "os";
import { join } from "path";

const ROOT = "/Users/shiriadmoni/fair-flow-booking";
const ALLOWED_PROJECT = "fair-flow-staging";
const BLOCKED = ["fairflowapp-db841", "production"];

function arg(name) {
  const idx = process.argv.indexOf(name);
  if (idx < 0 || !process.argv[idx + 1]) return "";
  return String(process.argv[idx + 1]).trim();
}

function sameList(a, b) {
  const left = (a || []).map(String).slice().sort();
  const right = (b || []).map(String).slice().sort();
  return left.length === right.length && left.every((item, i) => item === right[i]);
}

function loadModel() {
  const windowObj = {};
  new Function("window", readFileSync(join(ROOT, "public/booking/clients/model.js"), "utf8"))(windowObj);
  return windowObj.ffBookingClientModel;
}

function loadAdmin(projectId) {
  const cfg = JSON.parse(readFileSync(join(process.env.HOME, ".config/configstore/firebase-tools.json"), "utf8"));
  const tmp = mkdtempSync(join(tmpdir(), "ff-adc-"));
  writeFileSync(join(tmp, "adc.json"), JSON.stringify({
    type: "authorized_user",
    client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com",
    client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi",
    refresh_token: cfg.tokens.refresh_token,
  }));
  process.env.GOOGLE_APPLICATION_CREDENTIALS = join(tmp, "adc.json");
  const admin = createRequire("/tmp/ff-client-itest-sdk/package.json")("firebase-admin");
  if (!admin.apps.length) {
    admin.initializeApp({ projectId, credential: admin.credential.applicationDefault() });
  }
  return admin;
}

function expectedPrefixes(model, data) {
  const source = (data && (data.phone || data.phoneDigits)) || "";
  if (model.phoneDigits(source)) return model.phoneKeyPrefixes(source);
  if (Array.isArray(data && data.phoneKeys) && data.phoneKeys.length) {
    return model.phoneKeyPrefixes(data.phoneKeys[0]);
  }
  return [];
}

async function backfill(opts) {
  const projectId = String(opts.projectId || "").trim();
  const salonId = String(opts.salonId || "").trim();
  if (!projectId || !salonId) {
    throw new Error("Usage: --project fair-flow-staging --salonId <salonId>");
  }
  if (projectId !== ALLOWED_PROJECT || BLOCKED.indexOf(projectId) >= 0) {
    throw new Error("Refusing to run outside fair-flow-staging.");
  }

  const model = loadModel();
  const admin = loadAdmin(projectId);
  const snap = await admin.firestore().collection(`salons/${salonId}/clients`).get();
  const counts = { scanned: 0, updated: 0, skipped: 0, failed: 0 };

  for (const docSnap of snap.docs) {
    counts.scanned += 1;
    try {
      const data = docSnap.data() || {};
      const next = expectedPrefixes(model, data);
      const current = Array.isArray(data.phoneKeyPrefixes) ? data.phoneKeyPrefixes : null;
      if (current && sameList(current, next)) {
        counts.skipped += 1;
        continue;
      }
      await docSnap.ref.update({ phoneKeyPrefixes: next });
      counts.updated += 1;
    } catch (err) {
      counts.failed += 1;
      console.error("FAIL", docSnap.id, err && err.message);
    }
  }

  return counts;
}

if (process.argv[1] && process.argv[1].endsWith("backfill-client-phone-key-prefixes.mjs") && !process.env.FF_BACKFILL_AS_MODULE) {
  const projectId = arg("--project");
  const salonId = arg("--salonId");
  backfill({ projectId, salonId })
    .then((counts) => {
      console.log(JSON.stringify({ projectId, salonId, ...counts }));
      if (counts.failed) process.exit(1);
    })
    .catch((err) => {
      console.error(err.message || err);
      process.exit(1);
    });
}

export { backfill, expectedPrefixes, sameList };
