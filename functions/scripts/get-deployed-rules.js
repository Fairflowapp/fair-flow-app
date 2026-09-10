/*
 * READ-ONLY: fetch the currently deployed Firestore security rules for prod
 * and print the sections relevant to passwordResetRequests. No writes.
 * Usage: node scripts/get-deployed-rules.js
 */

const fs = require("fs");
const os = require("os");
const path = require("path");
const { GoogleAuth } = require("google-auth-library");

const cfg = JSON.parse(fs.readFileSync(path.join(os.homedir(), ".config", "configstore", "firebase-tools.json"), "utf8"));
const au = { type: "authorized_user", client_id: "563584335869-fgrhgmd47bqnekij5i8b5pr03ho849e6.apps.googleusercontent.com", client_secret: "j9iVZfS8kkCEFUPaAeJV0sAi", refresh_token: cfg.tokens.refresh_token };
const tmp = fs.mkdtempSync(path.join(os.tmpdir(), "ff-adc-"));
fs.writeFileSync(path.join(tmp, "adc.json"), JSON.stringify(au));
process.env.GOOGLE_APPLICATION_CREDENTIALS = path.join(tmp, "adc.json");

const PROJECT = "fairflowapp-db841";

(async () => {
  const auth = new GoogleAuth({ scopes: ["https://www.googleapis.com/auth/cloud-platform"] });
  const client = await auth.getClient();
  const { token } = await client.getAccessToken();
  const headers = { Authorization: `Bearer ${token}` };

  const relRes = await fetch(`https://firebaserules.googleapis.com/v1/projects/${PROJECT}/releases`, { headers });
  const releases = (await relRes.json()).releases || [];
  const fsRelease = releases.find((r) => r.name.includes("cloud.firestore"));
  if (!fsRelease) { console.log("No cloud.firestore release found. Releases:", releases.map((r) => r.name)); process.exit(1); }
  console.log("Release:", fsRelease.name, "updated:", fsRelease.updateTime, "ruleset:", fsRelease.rulesetName);

  const rsRes = await fetch(`https://firebaserules.googleapis.com/v1/${fsRelease.rulesetName}`, { headers });
  const ruleset = await rsRes.json();
  const src = (ruleset.source.files || []).map((f) => f.content).join("\n");

  const lines = src.split("\n");
  const hits = [];
  lines.forEach((l, i) => { if (/passwordReset/i.test(l)) hits.push(i); });
  if (!hits.length) {
    console.log("\nNO 'passwordReset' match in deployed rules.");
  } else {
    hits.forEach((i) => {
      console.log(`\n--- context around line ${i + 1} ---`);
      console.log(lines.slice(Math.max(0, i - 2), i + 10).join("\n"));
    });
  }

  fs.writeFileSync(path.join(tmp, "deployed.rules"), src);
  console.log(`\nFull deployed rules saved to ${path.join(tmp, "deployed.rules")} (${lines.length} lines)`);
  process.exit(0);
})().catch((err) => { console.error("Failed:", err); process.exit(1); });
