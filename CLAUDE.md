# VMHorizon_Bridge — CLAUDE.md

HorizonBridge: the hosted page for Horizon tickets. Read `README.md` first.

- **The data is production.** The page writes to the Management app's live Firestore
  (`management-db9eb`) as the signed-in user. Build and test against the emulator
  (`BRIDGE_EMULATOR=1`, emulator from `Claude_DB_Roadmap/Horizon/Bridge/emulator.py`) before any push.
- **Pushing `main` deploys to Vercel.** Ask before every commit and every push.
- **Match the Task Board.** Field names, status IDs, I-/SI- numbering, ordering keys and delete
  behaviour copy `VMManagementFrontEnd` exactly; read its code before changing any of them.
- **Never commit `public/config.js`** (generated) or any `.env`.
- Every file carries a header and changelog (what, input, output, how to run, changes).
- No files in the repo root beyond config; the page lives in `public/`.
