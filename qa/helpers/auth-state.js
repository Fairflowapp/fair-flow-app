"use strict";

const fs = require("fs");
const path = require("path");
const { CHECKPOINT_SHA, QA_ROOT, REQUIRED_PROJECT_ID } = require("./env");

const AUTH_STATE_DIR = path.join(QA_ROOT, ".auth");
const AUTH_STATE_PATH = path.join(AUTH_STATE_DIR, "staging-user.json");
const STORAGE_STATE_PATH = path.join(AUTH_STATE_DIR, "storage-state.json");

const EXPECTED_QA_EMAIL = "ff-booking-qa@fair-flow-staging.test";
const EXPECTED_QA_UID = "ff-booking-qa-user";
const EXPECTED_QA_SALON = "ffBookingQa";
const EXPECTED_QA_LOCATION = "qaLoc1";

async function exportIndexedDB(page) {
  return page.evaluate(async () => {
    const listed = indexedDB.databases ? await indexedDB.databases() : [];
    const names = listed
      .map((row) => row && row.name)
      .filter(Boolean)
      .filter((name) => /firebase/i.test(name));
    const databases = [];
    for (const name of names) {
      const db = await new Promise((resolve, reject) => {
        const open = indexedDB.open(name);
        open.onsuccess = () => resolve(open.result);
        open.onerror = () => reject(open.error);
      });
      const stores = [];
      for (const storeName of Array.from(db.objectStoreNames || [])) {
        const meta = await new Promise((resolve, reject) => {
          const tx = db.transaction(storeName, "readonly");
          const store = tx.objectStore(storeName);
          const req = store.openCursor();
          const rows = [];
          req.onsuccess = () => {
            const cursor = req.result;
            if (!cursor) {
              resolve({
                keyPath: store.keyPath || null,
                autoIncrement: !!store.autoIncrement,
                records: rows,
              });
              return;
            }
            rows.push({ key: cursor.key, value: cursor.value });
            cursor.continue();
          };
          req.onerror = () => reject(req.error);
        });
        stores.push({
          name: storeName,
          keyPath: meta.keyPath,
          autoIncrement: meta.autoIncrement,
          records: meta.records,
        });
      }
      const version = db.version;
      db.close();
      databases.push({ name, version, stores });
    }
    return { databases };
  });
}

async function restoreIndexedDBPayload(payload) {
  if (!payload || !Array.isArray(payload.databases)) return;
  if (!location.origin || location.origin === "null" || location.hostname !== "fair-flow-staging.web.app") {
    return;
  }
  try {
    for (const dbInfo of payload.databases) {
      await Promise.race([
        new Promise((resolve) => {
          const del = indexedDB.deleteDatabase(dbInfo.name);
          del.onsuccess = () => resolve();
          del.onerror = () => resolve();
          del.onblocked = () => resolve();
        }),
        new Promise((resolve) => setTimeout(resolve, 2000)),
      ]);
      await new Promise((resolve, reject) => {
        const open = indexedDB.open(dbInfo.name, dbInfo.version || 1);
        open.onupgradeneeded = () => {
          const db = open.result;
          (dbInfo.stores || []).forEach((store) => {
            if (!store || !store.name || db.objectStoreNames.contains(store.name)) return;
            const options = {};
            if (store.keyPath) options.keyPath = store.keyPath;
            if (store.autoIncrement) options.autoIncrement = true;
            db.createObjectStore(store.name, options);
          });
        };
        open.onsuccess = () => {
          const db = open.result;
          const names = (dbInfo.stores || [])
            .map((store) => store.name)
            .filter((name) => db.objectStoreNames.contains(name));
          if (!names.length) {
            db.close();
            resolve();
            return;
          }
          const tx = db.transaction(names, "readwrite");
          (dbInfo.stores || []).forEach((store) => {
            if (!store || !db.objectStoreNames.contains(store.name)) return;
            const os = tx.objectStore(store.name);
            (store.records || []).forEach((row) => {
              if (!row) return;
              if (os.keyPath) os.put(row.value);
              else if (row.key != null) os.put(row.value, row.key);
              else os.put(row.value);
            });
          });
          tx.oncomplete = () => {
            db.close();
            resolve();
          };
          tx.onerror = () => {
            db.close();
            reject(tx.error);
          };
        };
        open.onerror = () => reject(open.error);
      });
    }
  } catch (_) {
    /* about:blank and some isolated contexts deny IndexedDB. */
  }
}

async function wipeCredentialFields(page) {
  await page.evaluate(() => {
    const pass = document.getElementById("login-password");
    if (pass) {
      pass.value = "";
      pass.defaultValue = "";
      pass.removeAttribute("value");
    }
  }).catch(() => {});
}

function saveAuthState(payload) {
  fs.mkdirSync(AUTH_STATE_DIR, { recursive: true });
  const playwrightStorageState = payload.playwrightStorageState || { cookies: [], origins: [] };
  const safe = {
    savedAt: new Date().toISOString(),
    checkpointSha: CHECKPOINT_SHA,
    projectId: REQUIRED_PROJECT_ID,
    email: payload.email,
    uid: payload.uid,
    salonId: payload.salonId,
    locationId: payload.locationId || "",
    playwrightStorageState,
    indexedDB: payload.indexedDB,
  };
  fs.writeFileSync(AUTH_STATE_PATH, JSON.stringify(safe) + "\n", { mode: 0o600 });
  fs.writeFileSync(STORAGE_STATE_PATH, JSON.stringify(playwrightStorageState) + "\n", { mode: 0o600 });
}

function loadAuthState() {
  if (!fs.existsSync(AUTH_STATE_PATH)) {
    throw new Error(
      "QA SETUP: Missing gitignored auth state at qa/.auth/staging-user.json. " +
        "Run the Playwright setup project first."
    );
  }
  const raw = JSON.parse(fs.readFileSync(AUTH_STATE_PATH, "utf8"));
  if (!raw || !raw.playwrightStorageState || !raw.indexedDB) {
    throw new Error("QA SETUP: Auth state file is incomplete. Re-run auth setup.");
  }
  if (raw.projectId !== REQUIRED_PROJECT_ID) {
    throw new Error("QA SAFETY STOP: Auth state projectId is not fair-flow-staging.");
  }
  if (raw.email !== EXPECTED_QA_EMAIL || raw.uid !== EXPECTED_QA_UID) {
    throw new Error("QA SAFETY STOP: Auth state is not the dedicated ff-booking-qa user.");
  }
  if (raw.salonId !== EXPECTED_QA_SALON) {
    throw new Error("QA SAFETY STOP: Auth state salon is not ffBookingQa.");
  }
  return raw;
}

async function applyIndexedDBInitScript(context, indexedDBPayload) {
  await context.addInitScript(restoreIndexedDBPayload, indexedDBPayload);
}

module.exports = {
  AUTH_STATE_DIR,
  AUTH_STATE_PATH,
  STORAGE_STATE_PATH,
  EXPECTED_QA_EMAIL,
  EXPECTED_QA_UID,
  EXPECTED_QA_SALON,
  EXPECTED_QA_LOCATION,
  exportIndexedDB,
  wipeCredentialFields,
  saveAuthState,
  loadAuthState,
  applyIndexedDBInitScript,
};
