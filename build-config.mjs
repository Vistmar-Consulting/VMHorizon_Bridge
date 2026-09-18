// build-config.mjs — writes public/config.js, the Firebase web config the page starts with.
//
// What:    Vercel runs this as the build step. It reads the six VITE_FIREBASE_* variables from the
//          Vercel project's environment (the same values the Management app uses) and writes them
//          into public/config.js. Firebase web config is public by design; it is kept out of git
//          only so there is one place to change it.
// Input:   VITE_FIREBASE_API_KEY, _AUTH_DOMAIN, _PROJECT_ID, _STORAGE_BUCKET, _MESSAGING_SENDER_ID,
//          _APP_ID. BRIDGE_EMULATOR=1 instead writes the local-emulator config (project demo-horizon).
// Output:  public/config.js (gitignored).
// Run:     node build-config.mjs        (Vercel: Build Command)
// Cost:    Free.
// Changelog
//   0.1.0 · 2026-09-18 · AD · First version.

import { writeFileSync } from "node:fs";

const KEYS = {
  apiKey: "VITE_FIREBASE_API_KEY", authDomain: "VITE_FIREBASE_AUTH_DOMAIN",
  projectId: "VITE_FIREBASE_PROJECT_ID", storageBucket: "VITE_FIREBASE_STORAGE_BUCKET",
  messagingSenderId: "VITE_FIREBASE_MESSAGING_SENDER_ID", appId: "VITE_FIREBASE_APP_ID",
};

const emulator = process.env.BRIDGE_EMULATOR === "1";
let firebase;
if (emulator) {
  firebase = { apiKey: "demo", authDomain: "localhost", projectId: "demo-horizon", storageBucket: "", messagingSenderId: "", appId: "demo" };
} else {
  const missing = Object.values(KEYS).filter((k) => !process.env[k]);
  // Fail the build loudly rather than deploy a page that cannot sign in.
  if (missing.length) throw new Error(`build-config: missing env vars: ${missing.join(", ")}`);
  firebase = Object.fromEntries(Object.entries(KEYS).map(([k, v]) => [k, process.env[v]]));
}
writeFileSync("public/config.js", `window.BRIDGE = ${JSON.stringify({ firebase, emulator })};\n`);
console.log(`config.js written (${emulator ? "emulator" : firebase.projectId})`);
