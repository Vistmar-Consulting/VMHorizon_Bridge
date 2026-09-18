# HorizonBridge

The web page for **Horizon tickets**. A Horizon ticket is a Management-app task (Firestore project
`management-db9eb`, collection `items`, category `horizon`, org `vistamar`), so this page and the
Management Task Board always show the same tickets; a change in one appears live in the other.
History is kept as comments on the task.

- **Use it:** open the Vercel URL, sign in with your Vistamar Google account.
- **Claude's side** (creating and moving tickets during a session) is `tickets.py` in the Horizon
  SharePoint folder, `Horizon/Bridge/`, not this repo.
- **Design:** `local/design/BRIDGE-TICKETS-DESIGN-2026-09-18.md` in Claude_DB_Roadmap.

## Layout

| Path | What |
|---|---|
| `public/index.html`, `bridge.css`, `bridge.js` | the page (Firebase Web SDK v11 from gstatic, no bundler) |
| `build-config.mjs` | Vercel build step: writes `public/config.js` from the `VITE_FIREBASE_*` env vars |
| `vercel.json` | build command + output folder |

## Deploy

Pushing `main` deploys (Vercel ← GitHub `Vistmar-Consulting/VMHorizon_Bridge`). The Vercel project
needs the six `VITE_FIREBASE_*` env vars (same values as the Management app), and its domain must be
in Firebase Auth → Authorized domains.

## Local, against the emulator

```
BRIDGE_EMULATOR=1 node build-config.mjs && npx serve public -l 5191
```
The emulator itself runs from `Horizon/Bridge/emulator.py` in Claude_DB_Roadmap.

## Changelog

| Date | Who | Change |
|---|---|---|
| 2026-09-18 | AD | Created from Horizon/Bridge 0.1: page hosted on Vercel; local server dropped. |
