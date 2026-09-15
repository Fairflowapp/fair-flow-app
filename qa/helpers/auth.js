"use strict";

const { appUrl, requireStagingCredentials, REQUIRED_PROJECT_ID, safetyError } = require("./env");
const {
  EXPECTED_QA_EMAIL,
  EXPECTED_QA_UID,
  EXPECTED_QA_SALON,
  wipeCredentialFields,
} = require("./auth-state");
const { assertLocalAppUnderTest } = require("./local-app-route");

async function readFirebaseEnv(page) {
  return page.evaluate(() => {
    const cfg = window.firebaseConfig || {};
    return {
      projectId: cfg.projectId || "",
      authDomain: cfg.authDomain || "",
      ffEnv: window.FF_ENV || "",
      href: String(location.href || ""),
      search: String(location.search || ""),
      origin: String(location.origin || ""),
    };
  });
}

async function assertStagingFirebase(page) {
  await page.waitForFunction(() => {
    return !!(window.firebaseConfig && window.firebaseConfig.projectId) || typeof window.FF_ENV === "string";
  }, null, { timeout: 20000 }).catch(() => {});

  const info = await readFirebaseEnv(page);
  const detail =
    " URL=" + info.href +
    " FF_ENV=" + JSON.stringify(info.ffEnv) +
    " authDomain=" + JSON.stringify(info.authDomain);

  if (info.projectId !== REQUIRED_PROJECT_ID) {
    throw new Error(safetyError(info.projectId, detail));
  }
  if (info.ffEnv !== "staging") {
    throw new Error(
      safetyError(info.projectId, detail + " window.FF_ENV must be staging before login.")
    );
  }
  if (!/[?&]env=staging(?:&|$)/.test(info.search) && !info.href.includes("env=staging")) {
    throw new Error(
      safetyError(info.projectId, detail + " Page URL is missing ?env=staging.")
    );
  }
  return info;
}

async function gotoStagingApp(page) {
  const url = appUrl();
  await page.goto(url, { waitUntil: "domcontentloaded" });
  const info = await assertStagingFirebase(page);
  const local = await assertLocalAppUnderTest(page);
  return Object.assign({}, info, { local });
}

async function readLoginFailure(page) {
  return page.evaluate(() => {
    const err = document.getElementById("login-error");
    const errText = err ? String(err.textContent || "").trim() : "";
    const body = document.body;
    return {
      error: errText,
      loggedOut: !!(body && body.classList.contains("ff-logged-out")),
      hasUser: !!(window.ffAuth && window.ffAuth.currentUser),
    };
  });
}

async function loginWithEmail(page) {
  const { email, password } = requireStagingCredentials();
  await assertStagingFirebase(page);
  await assertLocalAppUnderTest(page);

  const login = page.locator("#login-email");
  await login.waitFor({ state: "visible", timeout: 30000 });

  try {
    await page.evaluate(({ emailValue, passwordValue }) => {
      const emailEl = document.getElementById("login-email");
      const passwordEl = document.getElementById("login-password");
      if (!emailEl || !passwordEl) {
        throw new Error("login fields missing");
      }
      emailEl.value = emailValue;
      passwordEl.value = passwordValue;
      emailEl.dispatchEvent(new Event("input", { bubbles: true }));
      passwordEl.dispatchEvent(new Event("input", { bubbles: true }));
    }, { emailValue: email, passwordValue: password });

    await page.locator("#login-button").click();
    await wipeCredentialFields(page);

    const outcome = await page.waitForFunction(() => {
      const err = document.getElementById("login-error");
      const errText = err ? String(err.textContent || "").trim() : "";
      if (errText) return { ok: false, error: errText };
      const body = document.body;
      if (!body || body.classList.contains("ff-logged-out")) return null;
      const main = document.getElementById("main-app-content");
      if (!main || window.getComputedStyle(main).display === "none") return null;
      if (!(window.ffAuth && window.ffAuth.currentUser)) return null;
      return { ok: true };
    }, null, { timeout: 60000 });

    const result = await outcome.jsonValue();
    if (!result || result.ok !== true) {
      const extra = await readLoginFailure(page);
      throw new Error(
        "QA LOGIN FAILED: " +
          ((result && result.error) || extra.error || "unknown login error")
      );
    }

    await page.waitForFunction(() => {
      try {
        return !!(window.currentSalonId && String(window.currentSalonId).trim());
      } catch (_) {
        return false;
      }
    }, null, { timeout: 45000 });
  } finally {
    await wipeCredentialFields(page);
  }
}

async function waitForAppReady(page) {
  await page.waitForFunction(() => {
    const body = document.body;
    if (!body || body.classList.contains("ff-logged-out")) return false;
    const main = document.getElementById("main-app-content");
    if (!main || window.getComputedStyle(main).display === "none") return false;
    return !!(window.ffAuth && window.ffAuth.currentUser && window.currentSalonId);
  }, null, { timeout: 30000 });
}

async function readSignedInIdentity(page) {
  return page.evaluate(() => {
    const user = window.ffAuth && window.ffAuth.currentUser;
    let locationId = "";
    try {
      if (typeof window.ffGetActiveLocationId === "function") {
        locationId = String(window.ffGetActiveLocationId() || "").trim();
      }
    } catch (_) {}
    if (!locationId) {
      try {
        locationId = String(window.__ff_active_location_id || "").trim();
      } catch (_) {}
    }
    return {
      email: user && user.email ? String(user.email) : "",
      uid: user && user.uid ? String(user.uid) : "",
      salonId: String(window.currentSalonId || "").trim(),
      locationId,
    };
  });
}

async function assertDedicatedQaIdentity(page) {
  const identity = await readSignedInIdentity(page);
  if (identity.email !== EXPECTED_QA_EMAIL) {
    throw new Error(
      "QA SAFETY STOP: Authenticated email is not the dedicated QA user. Saw " +
        JSON.stringify(identity.email)
    );
  }
  if (identity.uid !== EXPECTED_QA_UID) {
    throw new Error(
      "QA SAFETY STOP: Authenticated UID is not ff-booking-qa-user. Saw " +
        JSON.stringify(identity.uid)
    );
  }
  if (identity.salonId !== EXPECTED_QA_SALON) {
    throw new Error(
      "QA SAFETY STOP: currentSalonId is not ffBookingQa. Saw " +
        JSON.stringify(identity.salonId)
    );
  }
  return identity;
}

module.exports = {
  readFirebaseEnv,
  assertStagingFirebase,
  gotoStagingApp,
  loginWithEmail,
  waitForAppReady,
  readSignedInIdentity,
  assertDedicatedQaIdentity,
};
