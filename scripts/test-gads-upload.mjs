// One-off credential test for the Data Manager API conversion uploader.
// Reads GOOGLE_ADS_* from process.env, mints an access token, and sends a
// validateOnly events:ingest request (records nothing) to prove the full chain
// works: OAuth (datamanager scope) + operating/login account + conversion
// action (productDestinationId). Delete this file after running.

import crypto from "node:crypto";

const env = process.env;
const customerId = env.GOOGLE_ADS_CUSTOMER_ID.replace(/-/g, "");
const loginCustomerId = (env.GOOGLE_ADS_LOGIN_CUSTOMER_ID || "").replace(/-/g, "");
const actionId = env.GOOGLE_ADS_CONVERSION_ACTION_ID;
const sha256 = (v) => crypto.createHash("sha256").update(v, "utf8").digest("hex");

console.log("Step 1: exchanging refresh token for access token...");
const tok = await fetch("https://oauth2.googleapis.com/token", {
  method: "POST",
  headers: { "Content-Type": "application/x-www-form-urlencoded" },
  body: new URLSearchParams({
    client_id: env.GOOGLE_ADS_CLIENT_ID,
    client_secret: env.GOOGLE_ADS_CLIENT_SECRET,
    refresh_token: env.GOOGLE_ADS_REFRESH_TOKEN,
    grant_type: "refresh_token",
  }),
});
const tokJson = await tok.json();
if (!tokJson.access_token) {
  console.error("OAuth FAILED:", JSON.stringify(tokJson));
  process.exit(1);
}
console.log("  OK - access token obtained");
console.log("  granted scope:", tokJson.scope || "(not returned)\n");

const destination = {
  operatingAccount: { accountType: "GOOGLE_ADS", accountId: customerId },
  productDestinationId: actionId,
};
if (loginCustomerId) destination.loginAccount = { accountType: "GOOGLE_ADS", accountId: loginCustomerId };

const body = {
  destinations: [destination],
  encoding: "HEX",
  validateOnly: true,
  events: [{
    transactionId: "CLOSEBOOK-CREDENTIAL-TEST",
    eventTimestamp: new Date().toISOString(),
    eventSource: "WEB",
    conversionValue: 1,
    currency: "USD",
    userData: { userIdentifiers: [{ emailAddress: sha256("closebook-credential-test@example.com") }] },
  }],
};

console.log(`Step 2: validateOnly events:ingest -> operating ${customerId}, login ${loginCustomerId}, action ${actionId}...`);
const resp = await fetch("https://datamanager.googleapis.com/v1/events:ingest", {
  method: "POST",
  headers: { Authorization: `Bearer ${tokJson.access_token}`, "Content-Type": "application/json" },
  body: JSON.stringify(body),
});
console.log(`  HTTP ${resp.status}`);
console.log(await resp.text());
console.log(resp.ok
  ? "\nRESULT: VALID — the Data Manager pipeline accepts our conversions."
  : "\nRESULT: rejected — see the message above.");
