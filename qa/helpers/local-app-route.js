"use strict";

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const { REQUIRED_PROJECT_ID, appRoot, autIdentity, targetDirty } = require("./env");

const STAGING_APP_HOST = "fair-flow-staging.web.app";
const STAGING_APP_ORIGIN = "https://fair-flow-staging.web.app";
const LOCAL_PROOF_ASSET = "booking/shell.js";
const QA_CHECKPOINT_META = "ff-qa-local-checkpoint";
const QA_SERVED_META = "ff-qa-served-from";
const QA_SERVED_VALUE = "local-worktree-public";
const QA_APP_ROOT_META = "ff-qa-app-root";
const QA_DIRTY_META = "ff-qa-target-dirty";

function publicRoot() {
  return path.resolve(appRoot(), "public");
}

const TYPES = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".mjs": "application/javascript; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".svg": "image/svg+xml",
  ".png": "image/png",
  ".jpg": "image/jpeg",
  ".jpeg": "image/jpeg",
  ".webp": "image/webp",
  ".gif": "image/gif",
  ".ico": "image/x-icon",
  ".woff": "font/woff",
  ".woff2": "font/woff2",
  ".ttf": "font/ttf",
  ".map": "application/json; charset=utf-8",
  ".txt": "text/plain; charset=utf-8",
};

function sha256Hex(buffer) {
  return crypto.createHash("sha256").update(buffer).digest("hex");
}

function localAssetHash(relPath) {
  const abs = resolveExistingFile(relPath);
  if (!abs) {
    throw new Error("QA LOCAL ASSET MISSING: cannot hash " + relPath);
  }
  return sha256Hex(fs.readFileSync(abs));
}

function resolveExistingFile(relPath) {
  const rel = String(relPath || "").replace(/^\/+/, "");
  if (!rel || rel.includes("\0")) return null;
  const root = publicRoot();
  const abs = path.normalize(path.join(root, rel));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) return null;
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) return abs;
  return null;
}

function resolveAppRequest(urlPath) {
  let decoded;
  try {
    decoded = decodeURIComponent(String(urlPath || "/").split("?")[0]);
  } catch (_) {
    return { kind: "invalid", reason: "malformed-url" };
  }
  if (!decoded || decoded.includes("\0")) {
    return { kind: "invalid", reason: "nul-path" };
  }
  const rel = decoded === "/" ? "index.html" : decoded.replace(/^\/+/, "");
  const root = publicRoot();
  const abs = path.normalize(path.join(root, rel));
  const rootWithSep = root.endsWith(path.sep) ? root : root + path.sep;
  if (abs !== root && !abs.startsWith(rootWithSep)) {
    return { kind: "invalid", reason: "path-traversal" };
  }
  if (fs.existsSync(abs) && fs.statSync(abs).isFile()) {
    return { kind: "file", abs, rel: path.relative(root, abs) };
  }
  const ext = path.extname(rel);
  if (!ext) {
    const indexAbs = path.join(root, "index.html");
    return { kind: "spa", abs: indexAbs, rel: "index.html" };
  }
  return { kind: "missing", rel };
}

function injectLocalProof(htmlBuffer) {
  const html = htmlBuffer.toString("utf8");
  const tags =
    '<meta name="' + QA_CHECKPOINT_META + '" content="' + autIdentity() + '">' +
    '<meta name="' + QA_SERVED_META + '" content="' + QA_SERVED_VALUE + '">' +
    '<meta name="' + QA_APP_ROOT_META + '" content="' + publicRoot() + '">' +
    '<meta name="' + QA_DIRTY_META + '" content="' + (targetDirty() ? "1" : "0") + '">';
  if (/<head[^>]*>/i.test(html)) {
    return Buffer.from(html.replace(/<head[^>]*>/i, (open) => open + tags), "utf8");
  }
  return Buffer.from(tags + html, "utf8");
}

async function fulfillLocalAppRequest(route, parsedUrl) {
  const resolved = resolveAppRequest(parsedUrl.pathname);
  if (resolved.kind === "invalid") {
    await route.fulfill({
      status: 400,
      contentType: "text/plain; charset=utf-8",
      headers: { "cache-control": "no-store", "x-ff-qa-local-asset": "rejected" },
      body: "QA LOCAL ASSET REJECTED: " + resolved.reason + "\n",
    });
    return;
  }
  if (resolved.kind === "missing") {
    await route.fulfill({
      status: 404,
      contentType: "text/plain; charset=utf-8",
      headers: { "cache-control": "no-store", "x-ff-qa-local-asset": "missing" },
      body: "QA LOCAL ASSET MISSING: " + resolved.rel + "\n",
    });
    return;
  }

  let body = fs.readFileSync(resolved.abs);
  const ext = path.extname(resolved.abs).toLowerCase();
  if (resolved.rel === "index.html") {
    body = injectLocalProof(body);
  }
  await route.fulfill({
    status: 200,
    contentType: TYPES[ext] || "application/octet-stream",
    headers: {
      "cache-control": "no-store",
      "x-ff-qa-local-asset": "1",
      "x-ff-qa-local-rel": resolved.rel,
    },
    body,
  });
}

function isStagingAppHost(hostname) {
  return String(hostname || "").toLowerCase() === STAGING_APP_HOST;
}

async function installLocalAppRoute(context) {
  if (!fs.existsSync(path.join(publicRoot(), "index.html"))) {
    throw new Error("QA LOCAL ASSET MISSING: public/index.html is required in the application-under-test worktree.");
  }
  if (!resolveExistingFile(LOCAL_PROOF_ASSET)) {
    throw new Error("QA LOCAL ASSET MISSING: public/" + LOCAL_PROOF_ASSET);
  }

  await context.route("**/*", async (route) => {
    const req = route.request();
    let parsed;
    try {
      parsed = new URL(req.url());
    } catch (_) {
      await route.continue();
      return;
    }

    if (!isStagingAppHost(parsed.hostname)) {
      await route.continue();
      return;
    }

    await fulfillLocalAppRequest(route, parsed);
  });
}

async function assertLocalAppUnderTest(page) {
  const marker = await page.evaluate((names) => {
    const checkpoint = document.querySelector('meta[name="' + names.checkpoint + '"]');
    const served = document.querySelector('meta[name="' + names.served + '"]');
    return {
      checkpoint: checkpoint ? checkpoint.getAttribute("content") : "",
      served: served ? served.getAttribute("content") : "",
      origin: location.origin,
      projectId: (window.firebaseConfig && window.firebaseConfig.projectId) || "",
    };
  }, { checkpoint: QA_CHECKPOINT_META, served: QA_SERVED_META });

  if (marker.origin !== STAGING_APP_ORIGIN) {
    throw new Error(
      "QA SAFETY STOP: Browser origin must be " + STAGING_APP_ORIGIN + " but was " + marker.origin
    );
  }
  if (marker.projectId !== REQUIRED_PROJECT_ID) {
    throw new Error(
      "QA SAFETY STOP: Local AUT check saw projectId " + JSON.stringify(marker.projectId)
    );
  }
  const expectedId = autIdentity();
  if (marker.checkpoint !== expectedId) {
    throw new Error(
      "QA SAFETY STOP: Missing local AUT marker. This page is not the QA-served target public/. " +
        "Expected " + expectedId + " got " + JSON.stringify(marker.checkpoint)
    );
  }
  if (marker.served !== QA_SERVED_VALUE) {
    throw new Error(
      "QA SAFETY STOP: Page was not fulfilled from local public/. Possible remote staging mix."
    );
  }

  const expectedHash = localAssetHash(LOCAL_PROOF_ASSET);
  const proof = await page.evaluate(async (assetPath) => {
    const res = await fetch("/" + assetPath, { cache: "no-store" });
    const header = res.headers.get("x-ff-qa-local-asset");
    const rel = res.headers.get("x-ff-qa-local-rel");
    if (!res.ok) {
      return { ok: false, status: res.status, header, rel, hash: "" };
    }
    const buf = await res.arrayBuffer();
    const digest = await crypto.subtle.digest("SHA-256", buf);
    const hash = Array.from(new Uint8Array(digest))
      .map((b) => b.toString(16).padStart(2, "0"))
      .join("");
    return { ok: true, status: res.status, header, rel, hash };
  }, LOCAL_PROOF_ASSET);

  if (!proof.ok || proof.header !== "1" || proof.hash !== expectedHash) {
    throw new Error(
      "QA SAFETY STOP: Local asset proof failed for /" + LOCAL_PROOF_ASSET +
        " status=" + proof.status +
        " localHeader=" + JSON.stringify(proof.header) +
        " hashMatch=" + (proof.hash === expectedHash)
    );
  }

  return {
    origin: marker.origin,
    projectId: marker.projectId,
    checkpointSha: marker.checkpoint,
    appRoot: publicRoot(),
    dirty: targetDirty(),
    proofAsset: LOCAL_PROOF_ASSET,
    proofHash: expectedHash,
  };
}

module.exports = {
  STAGING_APP_HOST,
  STAGING_APP_ORIGIN,
  LOCAL_PROOF_ASSET,
  QA_CHECKPOINT_META,
  QA_SERVED_META,
  QA_SERVED_VALUE,
  publicRoot,
  installLocalAppRoute,
  assertLocalAppUnderTest,
  localAssetHash,
  resolveAppRequest,
};
