// bridge.js — HorizonBridge page logic. v0.1.0 · 2026-09-18 · AD
// Reads and writes VMManagement's Firestore directly as the signed-in user (same rules as the app).
// Tickets = items with categoryId "horizon", org "vistamar". History = comments on the item.
// Changelog
//   0.2.0 · 2026-09-18 · AD · Hosted on Vercel (VMHorizon_Bridge): no local server, so the page no longer
//                            hands a sign-in to Claude — Claude signs in with `tickets.py login`.
//   0.1.2 · 2026-09-18 · AD · Delete (ticket + its subitems, or one subitem), confirmed, as on the Task Board.
//   0.1.1 · 2026-09-18 · AD · Subitems labelled SI-N, as on the Task Board.
//   0.1.0 · 2026-09-18 · AD · First version: sign-in, Mine view, status, subitems, history, new ticket.

import { initializeApp } from "https://www.gstatic.com/firebasejs/11.0.2/firebase-app.js";
import {
  getAuth, connectAuthEmulator, GoogleAuthProvider, signInWithPopup, signInWithEmailAndPassword,
  onAuthStateChanged, signOut,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-auth.js";
import {
  getFirestore, connectFirestoreEmulator, collection, doc, query, where, orderBy, limit, onSnapshot,
  getDoc, getDocs, runTransaction, writeBatch, serverTimestamp, addDoc,
} from "https://www.gstatic.com/firebasejs/11.0.2/firebase-firestore.js";
import { generateKeyBetween } from "https://cdn.jsdelivr.net/npm/fractional-indexing@3.2.0/+esm";

// VMManagement statuses (src/constants/itemStatuses.js) + Blocked 9.
const STATUSES = [
  { id: 9, name: "Blocked", color: "var(--s-blocked)" },
  { id: 2, name: "In Progress", color: "var(--s-progress)" },
  { id: 1, name: "Assigned", color: "var(--s-assigned)" },
  { id: 4, name: "Review", color: "var(--s-review)" },
  { id: 6, name: "Pending", color: "var(--s-pending)" },
  { id: 8, name: "AI Gen", color: "var(--s-aigen)" },
  { id: 5, name: "Done", color: "var(--s-done)" },
  { id: 7, name: "Archive", color: "var(--muted)" },
];
const OPEN = [9, 2, 1, 4, 6, 8];
const STATUS_BY_ID = Object.fromEntries(STATUSES.map((s) => [s.id, s]));
const PRIORITY = { 1: "Critical", 2: "High", 3: "Medium", 4: "Low" };
const ORG = "vistamar";

const cfg = window.BRIDGE;
const app = initializeApp(cfg.firebase);
const auth = getAuth(app);
const db = getFirestore(app);
if (cfg.emulator) {
  connectAuthEmulator(auth, "http://127.0.0.1:9099", { disableWarnings: true });
  connectFirestoreEmulator(db, "127.0.0.1", 8085);
}

const $ = (id) => document.getElementById(id);
const state = { me: null, users: {}, items: [], open: new Set(), subs: {}, comments: {}, unsub: [] };

/** Escape text for HTML insertion. */
function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]));
}

/** Show an error where the user will see it; never swallow it. */
function fail(where, e) {
  console.error(where, e);
  $("err").textContent = `${where}: ${e.message || e}`;
}

/** Display name for a uid. */
const nameOf = (uid) => state.users[uid]?.displayName || state.users[uid]?.email || uid || "—";

/** One-line history comment, authored by the signed-in user (rules require authorId == uid). */
function historyWrite(batch, itemId, text) {
  const ref = doc(collection(db, "items", itemId, "comments"));
  batch.set(ref, { itemId, authorId: state.me.uid, body: `[Horizon] ${text} · Bridge`, parentCommentId: null, createdAt: serverTimestamp() });
}

// ── Sign-in ──────────────────────────────────────────────────────────────────────────────────────

$("env").textContent = cfg.emulator ? "EMULATOR · demo-horizon" : cfg.firebase.projectId;
if (cfg.emulator) $("env").classList.add("emu");
$("google").hidden = cfg.emulator;
$("emuform").hidden = !cfg.emulator;

$("google").onclick = async () => {
  const p = new GoogleAuthProvider();
  p.setCustomParameters({ hd: "vistamarconsulting.com" });
  try { await signInWithPopup(auth, p); } catch (e) { $("signinerr").textContent = e.message; }
};
$("emuform").onsubmit = async (ev) => {
  ev.preventDefault();
  try { await signInWithEmailAndPassword(auth, $("emuemail").value, $("emupass").value); }
  catch (e) { $("signinerr").textContent = e.message; }
};
$("signout").onclick = () => signOut(auth);

onAuthStateChanged(auth, async (user) => {
  state.unsub.forEach((u) => u()); state.unsub = [];
  if (!user) {
    state.me = null; $("signin").hidden = false; $("app").hidden = true; $("signout").hidden = true; $("who").textContent = "";
    return;
  }
  state.me = user;
  $("who").textContent = user.email; $("signout").hidden = false;
  try {
    const mine = await getDoc(doc(db, "users", user.uid));
    if (!mine.exists() || mine.data().active !== true) {
      $("signinerr").textContent = "Your Management account is not active. Sign in to the Management app first, or ask an admin.";
      $("signin").hidden = false; $("app").hidden = true; return;
    }
    const us = await getDocs(collection(db, "users"));
    state.users = Object.fromEntries(us.docs.map((d) => [d.id, d.data()]));
    fillAssignees();
  } catch (e) { return fail("Loading users", e); }
  $("signin").hidden = true; $("app").hidden = false;
  state.unsub.push(onSnapshot(query(collection(db, "items"), where("categoryId", "==", "horizon")),
    (snap) => { state.items = snap.docs.map((d) => ({ id: d.id, ...d.data() })); render(); },
    (e) => fail("Listening to tickets", e)));
});

// ── Rendering ────────────────────────────────────────────────────────────────────────────────────

/** Status dropdown for an item. */
function statusSelect(item) {
  const opts = STATUSES.map((s) => `<option value="${s.id}" ${s.id === item.statusId ? "selected" : ""}>${s.name}</option>`).join("");
  return `<select class="status" data-status="${item.id}" aria-label="Status">${opts}</select>`;
}

/** Label like I-12 for a top-level ticket. */
const label = (i) => `I-${i.itemNumber}`;

/** Re-render without losing what the user is typing: live updates replace the ticket list's HTML,
 *  so draft text and focus in the add-subitem / note boxes are carried across. */
function render() {
  const drafts = [...document.querySelectorAll("#groups form[data-addsub], #groups form[data-addnote]")]
    .map((f) => [f.dataset.addsub ? `s:${f.dataset.addsub}` : `n:${f.dataset.addnote}`, f.querySelector("input").value]);
  const active = document.activeElement?.closest("#groups form");
  const activeKey = active && (active.dataset.addsub ? `s:${active.dataset.addsub}` : `n:${active.dataset.addnote}`);
  renderList();
  for (const [key, value] of drafts) {
    const [kind, id] = key.split(":");
    const f = document.querySelector(`#groups form[data-add${kind === "s" ? "sub" : "note"}="${id}"]`);
    if (!f) continue;
    f.querySelector("input").value = value;
    if (key === activeKey) f.querySelector("input").focus();
  }
}

function renderList() {
  const byId = Object.fromEntries(state.items.map((i) => [i.id, i]));
  const mine = state.items.filter((i) => !i.parentId && (i.assigneeIds || []).includes(state.me.uid) && OPEN.includes(i.statusId));
  const blocked = mine.filter((i) => i.statusId === 9).length;
  $("summary").textContent = `${mine.length} open` + (blocked ? ` · ${blocked} blocked` : "");
  if (!mine.length) { $("groups").innerHTML = `<div class="empty">No open Horizon tickets assigned to you.</div>`; return; }
  $("groups").innerHTML = OPEN.map((sid) => {
    const list = mine.filter((i) => i.statusId === sid).sort((a, b) => (a.order > b.order ? 1 : -1));
    if (!list.length) return "";
    const s = STATUS_BY_ID[sid];
    return `<div class="group"><h2><span class="dot" style="background:${s.color}"></span>${s.name} · ${list.length}</h2>
      ${list.map((i) => ticketHtml(i, byId)).join("")}</div>`;
  }).join("");
}

function ticketHtml(i, byId) {
  const blockers = (i.horizon?.blockedBy || []).map((id) => byId[id]).filter(Boolean);
  const chips = [
    i.horizon?.entity ? `<span class="chip">${esc(i.horizon.entity)}</span>` : "",
    i.priorityId ? `<span class="chip">${PRIORITY[i.priorityId]}</span>` : "",
    ...blockers.map((b) => `<span class="chip ${b.statusId === 5 ? "ok" : "warn"}">${b.statusId === 5 ? "blocker done" : "blocked by"} ${label(b)} · ${esc(nameOf((b.assigneeIds || [])[0]))}</span>`),
    i.hasChildren ? `<span class="chip">subitems</span>` : "",
  ].join("");
  const open = state.open.has(i.id);
  return `<div class="ticket ${i.statusId === 9 ? "blocked" : ""}">
    <div class="row">
      <span class="num">${label(i)}</span>
      <div><div class="title" data-toggle="${i.id}">${esc(i.title) || "<em>untitled</em>"}</div><div class="meta">${chips}</div></div>
      ${statusSelect(i)}
      <button class="ghost del" data-delete="${i.id}" title="Delete ${label(i)}">Delete</button>
    </div>
    ${open ? detailHtml(i) : ""}
  </div>`;
}

function detailHtml(i) {
  const subs = (state.subs[i.id] || []);
  const notes = (state.comments[i.id] || []);
  return `<div class="detail">
    ${i.description ? `<div>${esc(i.description)}</div>` : ""}
    <div class="subs"><h3>Subitems</h3>
      ${subs.map((s) => `<div class="row"><span class="num">SI-${s.itemNumber}</span><span>${esc(s.title)}</span>${statusSelect(s)}<button class="ghost del" data-delete="${s.id}" data-sub="1" title="Delete SI-${s.itemNumber}">Delete</button></div>`).join("") || `<p class="muted">None yet.</p>`}
      <form class="add" data-addsub="${i.id}"><input placeholder="Add a subitem" aria-label="New subitem"><button>Add</button></form>
    </div>
    <div><h3>History</h3>
      <ul class="history">${notes.map((n) => `<li><span class="by">${esc(nameOf(n.authorId))}</span>${esc(n.body)}</li>`).join("") || `<li class="muted">No history yet.</li>`}</ul>
      <form class="add" data-addnote="${i.id}"><input placeholder="Add a note" aria-label="New note"><button>Post</button></form>
    </div>
  </div>`;
}

/** Open a ticket: listen to its subitems and history while it is open. */
function toggle(id) {
  if (state.open.has(id)) { state.open.delete(id); state[`off_${id}`]?.forEach((u) => u()); render(); return; }
  state.open.add(id);
  state[`off_${id}`] = [
    onSnapshot(query(collection(db, "items"), where("parentId", "==", id)),
      (s) => { state.subs[id] = s.docs.map((d) => ({ id: d.id, ...d.data() })).sort((a, b) => (a.order > b.order ? 1 : -1)); render(); },
      (e) => fail("Loading subitems", e)),
    onSnapshot(query(collection(db, "items", id, "comments"), orderBy("createdAt")),
      (s) => { state.comments[id] = s.docs.map((d) => d.data()); render(); },
      (e) => fail("Loading history", e)),
  ];
  render();
}

// ── Writes ───────────────────────────────────────────────────────────────────────────────────────

/** Change status + write the history line in one batch; Done stamps completedAt, others clear it. */
async function setStatus(itemId, statusId) {
  const item = state.items.find((i) => i.id === itemId) || Object.values(state.subs).flat().find((i) => i.id === itemId);
  const batch = writeBatch(db);
  batch.update(doc(db, "items", itemId), {
    statusId, updatedAt: serverTimestamp(), completedAt: statusId === 5 ? serverTimestamp() : null,
  });
  historyWrite(batch, itemId, `status ${STATUS_BY_ID[item?.statusId]?.name || item?.statusId} → ${STATUS_BY_ID[statusId].name}`);
  await batch.commit();
}

/** Delete exactly as the Task Board does (TaskBoard.jsx:361-374): confirm, then the ticket and all
 *  its subitems in one atomic batch. A person's action only — Claude never deletes. */
async function deleteItem(id, isSub) {
  const item = state.items.find((i) => i.id === id) || Object.values(state.subs).flat().find((i) => i.id === id);
  const subs = isSub ? [] : (await getDocs(query(collection(db, "items"), where("parentId", "==", id)))).docs;
  const name = `${isSub ? "SI" : "I"}-${item?.itemNumber} "${item?.title || ""}"`;
  const extra = subs.length ? ` and its ${subs.length} subitem${subs.length > 1 ? "s" : ""}` : "";
  if (!confirm(`Delete ${name}${extra}? This cannot be undone.`)) return;
  const batch = writeBatch(db);
  subs.forEach((d) => batch.delete(d.ref));
  batch.delete(doc(db, "items", id));
  await batch.commit();
}

/** Rank after the largest existing key (same rule as tickets.py / TaskBoard.jsx). */
async function nextOrder(parentId) {
  if (!parentId) {
    const last = await getDocs(query(collection(db, "items"), orderBy("order", "desc"), limit(1)));
    return generateKeyBetween(last.empty ? null : last.docs[0].data().order, null);
  }
  const subs = await getDocs(query(collection(db, "items"), where("parentId", "==", parentId)));
  const keys = subs.docs.map((d) => d.data().order).filter(Boolean).sort();
  return generateKeyBetween(keys.pop() || null, null);
}

/** Create a ticket or subitem with the Task Board's transaction (counter on org or parent). */
async function createItem({ title, entity = "horizon", assignee = null, priority = null, parentId = null }) {
  const order = await nextOrder(parentId);
  const ref = doc(collection(db, "items"));
  const counterRef = parentId ? doc(db, "items", parentId) : doc(db, "organizations", ORG);
  const counter = parentId ? "nextSubitemNumber" : "nextItemNumber";
  await runTransaction(db, async (tx) => {
    const c = await tx.get(counterRef);
    if (!c.exists()) throw new Error(`${counterRef.path} does not exist`);
    const next = c.data()[counter] ?? 1;
    const parentEntity = parentId ? (c.data().horizon?.entity || "horizon") : entity;
    tx.set(ref, {
      organizationId: ORG, parentId, hasChildren: false, type: "task", title, description: "", statusId: 1,
      priorityId: priority, categoryId: "horizon", tagIds: [], onHold: false, dueDate: null, completedAt: null,
      assigneeIds: assignee ? [assignee] : [], itemNumber: next, createdBy: state.me.uid,
      createdAt: serverTimestamp(), updatedAt: serverTimestamp(), order,
      horizon: { entity: parentEntity, blockedBy: [] },
    });
    tx.update(counterRef, parentId ? { [counter]: next + 1, hasChildren: true, updatedAt: serverTimestamp() } : { [counter]: next + 1 });
  });
  await addDoc(collection(db, "items", ref.id, "comments"),
    { itemId: ref.id, authorId: state.me.uid, body: "[Horizon] created · Bridge", parentCommentId: null, createdAt: serverTimestamp() });
}

function fillAssignees() {
  const active = Object.entries(state.users).filter(([, u]) => u.active).sort((a, b) => (a[1].displayName || "").localeCompare(b[1].displayName || ""));
  $("nassignee").innerHTML = active.map(([uid, u]) => `<option value="${uid}" ${uid === state.me.uid ? "selected" : ""}>${esc(u.displayName || u.email)}</option>`).join("");
}

/** Empty a box after its write succeeds. Looked up fresh: a live re-render may have replaced the
 *  form the user submitted, carrying the draft into the new one. */
function clearDraft(kind, id) {
  const input = document.querySelector(`#groups form[data-${kind}="${id}"] input`);
  if (input) input.value = "";
}

// ── Events ───────────────────────────────────────────────────────────────────────────────────────

document.addEventListener("click", (ev) => {
  const t = ev.target.closest("[data-toggle]");
  if (t) toggle(t.dataset.toggle);
  const d = ev.target.closest("[data-delete]");
  if (d) deleteItem(d.dataset.delete, d.dataset.sub === "1").catch((e) => fail("Deleting", e));
});
document.addEventListener("change", (ev) => {
  const s = ev.target.closest("[data-status]");
  if (s) setStatus(s.dataset.status, Number(s.value)).catch((e) => fail("Changing status", e));
});
document.addEventListener("submit", (ev) => {
  const f = ev.target;
  const input = f.querySelector("input");
  if (f.dataset.addsub) {
    ev.preventDefault();
    const title = input.value.trim();
    if (title) createItem({ title, parentId: f.dataset.addsub, assignee: state.me.uid })
      .then(() => clearDraft("addsub", f.dataset.addsub)).catch((e) => fail("Adding subitem", e));
  } else if (f.dataset.addnote) {
    ev.preventDefault();
    const text = input.value.trim();
    if (!text) return;
    const b = writeBatch(db); historyWrite(b, f.dataset.addnote, text);
    b.commit().then(() => clearDraft("addnote", f.dataset.addnote)).catch((e) => fail("Posting note", e));
  }
});
$("newbtn").onclick = () => { $("newform").hidden = false; $("ntitle").focus(); };
$("newcancel").onclick = () => { $("newform").hidden = true; };
$("newform").onsubmit = async (ev) => {
  ev.preventDefault();
  try {
    await createItem({ title: $("ntitle").value.trim(), entity: $("nentity").value.trim() || "horizon",
      assignee: $("nassignee").value || null, priority: $("npriority").value ? Number($("npriority").value) : null });
    $("newform").reset(); $("nentity").value = "horizon"; fillAssignees(); $("newform").hidden = true;
  } catch (e) { fail("Creating ticket", e); }
};
