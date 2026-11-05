// 강사 화면: Google 로그인 → 방·질문 관리 → 발표 화면
import {
  initializeApp, getAuth, onAuthStateChanged, GoogleAuthProvider, signInWithPopup, signOut,
  getFirestore, doc, collection, query, where, orderBy,
  getDoc, getDocs, setDoc, updateDoc, deleteDoc, writeBatch, runTransaction,
  onSnapshot, serverTimestamp, Timestamp,
} from "./sdk.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, esc, show, qrSvg, joinUrl, prettyCode, startOfToday, confirmBox, toast } from "./common.js";
import {
  initPresent, openPresent, closePresent, isPresenting, renderPresent, toggleFullscreen,
} from "./present.js";

const DEMO = new URLSearchParams(location.search).has("demo");
let auth;
let db;

const ROOM_PREF = "agora.host.room";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 무시 */ } },
  del(k) { try { localStorage.removeItem(k); } catch { /* 무시 */ } },
};

let user = null;
let rooms = [];
let code = null;
let room = null;
let questions = [];
let editingId = null;
let unsubRooms = null;
let unsubRoom = null;
let unsubQs = null;
// 발표 화면용
let unsubResp = null;
let unsubJoined = null;
let respQid;
let responses = [];
let joined = 0;
let hide = false;
let showJoin = false;
let moving = false;

const roomRef = (c = code) => doc(db, "rooms", c);
const qCol = (c = code) => collection(db, "rooms", c, "questions");
const qRef = (id, c = code) => doc(db, "rooms", c, "questions", id);
const respCol = (id, c = code) => collection(db, "rooms", c, "questions", id, "responses");
const short = (s, n = 30) => (s.length > n ? `${s.slice(0, n)}…` : s);

function err(e) {
  console.error(e);
  const msg = e?.code === "permission-denied" ? "권한이 없습니다. 다시 로그인해 보세요." : (e?.message || String(e));
  toast(msg, "bad");
}

// ── 로그인 ─────────────────────────────────
function boot() {
  show("v-loading");
  $("#btn-login").addEventListener("click", async () => {
    $("#login-err").textContent = "";
    try {
      await signInWithPopup(auth, new GoogleAuthProvider());
    } catch (e) {
      if (!["auth/popup-closed-by-user", "auth/cancelled-popup-request"].includes(e.code)) {
        $("#login-err").textContent = `로그인하지 못했습니다 (${e.code || e.message})`;
      }
    }
  });
  $("#btn-signout").addEventListener("click", () => { stopAll(); signOut(auth); });
  $("#btn-claim").addEventListener("click", claim);
  wireDash();
  initPresent({
    prev, next,
    toggle: () => { const q = activeQ(); if (q) toggleOpen(q).catch(err); },
    hide: () => { hide = !hide; paint(); },
    qr: () => { showJoin = !showJoin; paint(); },
    full: toggleFullscreen,
    exit: exitPresent,
  });

  onAuthStateChanged(auth, async (u) => {
    user = u;
    stopAll();
    const real = u && !u.isAnonymous;
    $("#btn-signout").hidden = !real;
    $("#who").textContent = real ? (u.email || "") : "";
    if (!real) { show("v-login"); return; }
    show("v-loading");
    try {
      const o = await getDoc(doc(db, "meta", "owner"));
      if (!o.exists()) { $("#claim-email").textContent = u.email || ""; show("v-claim"); return; }
      if (o.data().uid !== u.uid) { show("v-denied"); return; }
      startDash();
    } catch (e) {
      console.error(e);
      $("#login-err").textContent = "강사 권한을 확인하지 못했습니다.";
      show("v-login");
    }
  });
}

async function claim() {
  $("#btn-claim").disabled = true;
  $("#claim-err").textContent = "";
  try {
    await setDoc(doc(db, "meta", "owner"), { uid: user.uid, claimedAt: serverTimestamp() });
    startDash();
  } catch (e) {
    console.error(e);
    $("#claim-err").textContent = "등록하지 못했습니다. 이미 다른 계정이 등록되어 있을 수 있습니다.";
    $("#btn-claim").disabled = false;
  }
}

function stopAll() {
  unsubRooms?.(); unsubRooms = null;
  unsubRoom?.(); unsubRoom = null;
  unsubQs?.(); unsubQs = null;
  stopPresentData();
  if (!DEMO && isPresenting()) closePresent();
  code = null; room = null; questions = []; rooms = [];
}

// ── 방 ─────────────────────────────────────
function startDash() {
  show("v-dash");
  unsubRooms?.();
  unsubRooms = onSnapshot(query(collection(db, "rooms"), orderBy("createdAt", "desc")), (s) => {
    rooms = s.docs.map((d) => ({ code: d.id, ...d.data() }));
    renderRooms();
    if (!code) {
      const pref = store.get(ROOM_PREF);
      const pick = rooms.find((r) => r.code === pref) || rooms[0];
      if (pick) selectRoom(pick.code);
    }
  }, err);
}

function renderRooms() {
  $("#room-list").innerHTML = rooms.length
    ? rooms.map((r) => `
      <li><button type="button" class="room-item ${r.code === code ? "on" : ""}" data-code="${r.code}">
        <span class="t">${esc(r.title)}</span><span class="c">${prettyCode(r.code)}</span>
      </button></li>`).join("")
    : `<li class="muted">아직 방이 없습니다.</li>`;
}

function selectRoom(c) {
  unsubRoom?.(); unsubRoom = null;
  unsubQs?.(); unsubQs = null;
  stopPresentData();
  code = c; room = null; questions = [];
  cancelEdit();
  renderRooms();
  $("#room-none").hidden = !!c;
  $("#room-body").hidden = !c;
  if (!c) {
    if (isPresenting()) closePresent();
    return;
  }
  store.set(ROOM_PREF, c);
  const url = joinUrl(c);
  $("#rp-title").textContent = rooms.find((r) => r.code === c)?.title || "";
  $("#rp-code").textContent = prettyCode(c);
  $("#rp-link").href = url;
  $("#rp-link").textContent = url;
  $("#rp-qr").innerHTML = qrSvg(url);
  $("#q-list").innerHTML = "";

  unsubRoom = onSnapshot(roomRef(c), (s) => {
    if (code !== c) return;
    if (!s.exists()) {
      if (!s.metadata.fromCache) { store.del(ROOM_PREF); selectRoom(null); }
      return;
    }
    room = s.data();
    $("#rp-title").textContent = room.title;
    renderQs();
    paint();
  }, err);
  unsubQs = onSnapshot(query(qCol(c), orderBy("order")), (s) => {
    if (code !== c) return;
    questions = s.docs.map((d) => ({ id: d.id, ...d.data() }));
    renderQs();
    paint();
  }, err);
}

async function createRoom(title) {
  for (let i = 0; i < 10; i++) {
    const c = String(100000 + Math.floor(Math.random() * 900000));
    const ref = roomRef(c);
    const ok = await runTransaction(db, async (tx) => {
      const s = await tx.get(ref);
      if (s.exists()) return false;
      tx.set(ref, { title, createdAt: serverTimestamp(), activeQuestionId: null });
      return true;
    });
    if (ok) return c;
  }
  throw new Error("비어 있는 코드를 찾지 못했습니다. 다시 눌러 주세요.");
}

async function deleteAll(colRef) {
  const snap = await getDocs(colRef);
  const docs = snap.docs;
  for (let i = 0; i < docs.length; i += 400) {
    const b = writeBatch(db);
    docs.slice(i, i + 400).forEach((d) => b.delete(d.ref));
    await b.commit();
  }
  return docs.length;
}

async function deleteRoom() {
  const c = code;
  const title = room?.title || "";
  const ok = await confirmBox(`「${title}」 방과 모든 질문·응답을 삭제할까요? 되돌릴 수 없습니다.`, { ok: "방 삭제", danger: true });
  if (!ok) return;
  const qs = await getDocs(qCol(c));
  for (const q of qs.docs) await deleteAll(respCol(q.id, c));
  await deleteAll(qCol(c));
  await deleteAll(collection(db, "rooms", c, "participants"));
  selectRoom(null);
  store.del(ROOM_PREF);
  await deleteDoc(roomRef(c));
  toast("방을 삭제했습니다.");
}

function promptBox(label, value) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "promptbox";
    dlg.innerHTML = `
      <form class="stack">
        <label>${esc(label)}<input maxlength="40" value="${esc(value)}"></label>
        <div class="row end">
          <button type="button" class="btn ghost" data-v="0">취소</button>
          <button class="btn primary">저장</button>
        </div>
      </form>`;
    document.body.appendChild(dlg);
    const inp = dlg.querySelector("input");
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.querySelector('[data-v="0"]').addEventListener("click", () => done(null));
    dlg.querySelector("form").addEventListener("submit", (e) => { e.preventDefault(); done(inp.value.trim() || null); });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(null); });
    dlg.showModal();
    inp.select();
  });
}

// ── 질문 ───────────────────────────────────
function renderQs() {
  const list = $("#q-list");
  const active = room?.activeQuestionId || null;
  if (!questions.length) {
    list.innerHTML = `<li class="empty-note">아직 질문이 없습니다. 아래에서 추가하세요.</li>`;
    return;
  }
  list.innerHTML = questions.map((q, i) => {
    const on = q.id === active;
    const tags = [
      `<span class="tag">${q.type === "choice" ? "객관식" : "워드클라우드"}</span>`,
      on ? `<span class="tag live">화면에 뜸</span>` : "",
      q.open ? `<span class="tag open">응답 받는 중</span>` : (q.closedAt ? `<span class="tag">마감</span>` : ""),
    ].join("");
    const sub = q.type === "choice"
      ? (q.options || []).map(esc).join(" · ")
      : `학생 1명당 ${q.maxWords || 1}칸`;
    return `
      <li class="q-item ${on ? "active" : ""}" data-id="${q.id}">
        <div>
          <div class="q-tags">${tags}</div>
          <div class="q-prompt">${esc(q.prompt)}</div>
          <div class="q-opts">${sub}</div>
        </div>
        <div class="q-actions">
          <button type="button" class="btn small ${on ? "" : "primary"}" data-act="activate">${on ? "화면에서 내리기" : "화면에 띄우기"}</button>
          <button type="button" class="btn small" data-act="toggle">${q.open ? "응답 마감" : "응답 열기"}</button>
          <button type="button" class="btn small ghost" data-act="edit">수정</button>
          <button type="button" class="btn small ghost" data-act="reset">응답 지우기</button>
          <button type="button" class="btn small ghost" data-act="up" aria-label="위로" ${i === 0 ? "disabled" : ""}>↑</button>
          <button type="button" class="btn small ghost" data-act="down" aria-label="아래로" ${i === questions.length - 1 ? "disabled" : ""}>↓</button>
          <button type="button" class="btn small ghost danger" data-act="delete">삭제</button>
        </div>
      </li>`;
  }).join("");
}

async function activate(q) {
  const b = writeBatch(db);
  b.update(roomRef(), { activeQuestionId: q.id });
  // 한 번도 마감한 적 없는 질문은 띄우면서 바로 응답을 연다
  if (!q.open && !q.closedAt) b.update(qRef(q.id), { open: true });
  await b.commit();
}
async function deactivate() {
  await updateDoc(roomRef(), { activeQuestionId: null });
}
async function toggleOpen(q) {
  if (q.open) await updateDoc(qRef(q.id), { open: false, closedAt: serverTimestamp() });
  else await updateDoc(qRef(q.id), { open: true });
}
async function deleteQuestion(q) {
  await deleteAll(respCol(q.id));
  if (room?.activeQuestionId === q.id) await deactivate();
  await deleteDoc(qRef(q.id));
}
async function move(q, dir) {
  const i = questions.indexOf(q);
  const other = questions[i + dir];
  if (!other) return;
  const b = writeBatch(db);
  const a = q.order;
  const o = other.order === a ? a + dir : other.order;
  b.update(qRef(q.id), { order: o });
  b.update(qRef(other.id), { order: a });
  await b.commit();
}

const qType = () => document.querySelector('input[name="qtype"]:checked').value;
function syncForm() {
  const t = qType();
  $("#fq-opts-wrap").hidden = t !== "choice";
  $("#fq-max-wrap").hidden = t !== "text";
  $("#fq-warn").hidden = !(editingId && t === "choice");
}
function startEdit(q) {
  editingId = q.id;
  document.querySelector(`input[name="qtype"][value="${q.type}"]`).checked = true;
  document.querySelectorAll('input[name="qtype"]').forEach((r) => { r.disabled = true; });
  $("#fq-prompt").value = q.prompt || "";
  $("#fq-options").value = (q.options || []).join("\n");
  $("#fq-max").value = String(q.maxWords || 1);
  $("#fq-head").textContent = "질문 수정";
  $("#fq-submit").textContent = "저장";
  $("#fq-cancel").hidden = false;
  $("#fq-err").textContent = "";
  syncForm();
  $("#f-q").scrollIntoView({ behavior: "smooth", block: "center" });
  $("#fq-prompt").focus({ preventScroll: true });
}
function cancelEdit() {
  editingId = null;
  $("#f-q").reset();
  document.querySelectorAll('input[name="qtype"]').forEach((r) => { r.disabled = false; });
  $("#fq-head").textContent = "질문 추가";
  $("#fq-submit").textContent = "추가";
  $("#fq-cancel").hidden = true;
  $("#fq-err").textContent = "";
  syncForm();
}

// ── CSV ───────────────────────────────────
function csvCell(v) {
  let s = String(v ?? "");
  if (/^[=+\-@\t\r]/.test(s)) s = `'${s}`; // 엑셀 수식으로 읽히지 않게
  return /[",\r\n]/.test(s) ? `"${s.replace(/"/g, '""')}"` : s;
}
async function exportCsv() {
  const c = code;
  const title = room?.title || c;
  const qs = (await getDocs(query(qCol(c), orderBy("order")))).docs.map((d) => ({ id: d.id, ...d.data() }));
  const rows = [["순서", "질문", "유형", "닉네임", "응답", "응답 시각"]];
  for (const [i, q] of qs.entries()) {
    const rs = await getDocs(respCol(q.id, c));
    const list = rs.docs.map((d) => d.data())
      .sort((a, b) => (a.updatedAt?.toMillis?.() || 0) - (b.updatedAt?.toMillis?.() || 0));
    for (const d of list) {
      const ans = q.type === "choice" ? (q.options?.[d.choice] ?? "") : (d.words || []).join(" / ");
      const when = d.updatedAt?.toDate ? d.updatedAt.toDate().toLocaleString("ko-KR") : "";
      rows.push([i + 1, q.prompt, q.type === "choice" ? "객관식" : "단답", d.nickname, ans, when]);
    }
  }
  const csv = `﻿${rows.map((r) => r.map(csvCell).join(",")).join("\r\n")}`;
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const a = document.createElement("a");
  const now = new Date();
  const day = `${now.getFullYear()}${String(now.getMonth() + 1).padStart(2, "0")}${String(now.getDate()).padStart(2, "0")}`;
  a.href = URL.createObjectURL(blob);
  a.download = `아고라_${title.replace(/[\\/:*?"<>|]/g, "_")}_${day}.csv`;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 2000);
  toast(`응답 ${rows.length - 1}건을 내려받았습니다.`);
}

// ── 화면 연결 ───────────────────────────────
function wireDash() {
  $("#room-list").addEventListener("click", (e) => {
    const b = e.target.closest("[data-code]");
    if (b && b.dataset.code !== code) selectRoom(b.dataset.code);
  });
  $("#f-room").addEventListener("submit", async (e) => {
    e.preventDefault();
    const title = $("#room-title-in").value.trim();
    if (!title) return;
    const btn = e.submitter;
    if (btn) btn.disabled = true;
    try {
      const c = await createRoom(title);
      $("#room-title-in").value = "";
      selectRoom(c);
      toast(`방을 만들었습니다. 코드 ${prettyCode(c)}`);
    } catch (er) { err(er); } finally { if (btn) btn.disabled = false; }
  });
  $("#btn-rename").addEventListener("click", async () => {
    const t = await promptBox("방 이름", room?.title || "");
    if (t && t !== room?.title) updateDoc(roomRef(), { title: t }).catch(err);
  });
  $("#btn-del-room").addEventListener("click", () => deleteRoom().catch(err));
  $("#btn-csv").addEventListener("click", async (e) => {
    e.currentTarget.disabled = true;
    try { await exportCsv(); } catch (er) { err(er); } finally { $("#btn-csv").disabled = false; }
  });
  $("#btn-present").addEventListener("click", () => {
    if (!code) return;
    hide = false;
    showJoin = false;
    openPresent();
    startPresentData();
    paint();
  });

  document.querySelectorAll('input[name="qtype"]').forEach((r) => r.addEventListener("change", syncForm));
  $("#fq-cancel").addEventListener("click", cancelEdit);
  $("#f-q").addEventListener("submit", async (e) => {
    e.preventDefault();
    $("#fq-err").textContent = "";
    const type = qType();
    const prompt = $("#fq-prompt").value.trim();
    if (!prompt) { $("#fq-err").textContent = "질문을 입력하세요."; return; }
    const data = { type, prompt };
    if (type === "choice") {
      const options = $("#fq-options").value.split(/\r?\n/).map((s) => s.trim()).filter(Boolean);
      if (options.length < 2 || options.length > 8) { $("#fq-err").textContent = "보기는 2~8개가 필요합니다."; return; }
      if (options.some((o) => o.length > 80)) { $("#fq-err").textContent = "보기는 80자 이내로 써 주세요."; return; }
      data.options = options;
      data.maxWords = 1;
    } else {
      data.options = [];
      data.maxWords = Number($("#fq-max").value) || 1;
    }
    $("#fq-submit").disabled = true;
    try {
      if (editingId) {
        await updateDoc(qRef(editingId), data);
        toast("질문을 고쳤습니다.");
      } else {
        await setDoc(doc(qCol()), { ...data, open: false, order: Date.now(), createdAt: serverTimestamp() });
      }
      cancelEdit();
    } catch (er) { err(er); } finally { $("#fq-submit").disabled = false; }
  });

  $("#q-list").addEventListener("click", async (e) => {
    const b = e.target.closest("[data-act]");
    if (!b) return;
    const q = questions.find((x) => x.id === b.closest("[data-id]")?.dataset.id);
    if (!q) return;
    const act = b.dataset.act;
    if (act === "edit") { startEdit(q); return; }
    b.disabled = true;
    try {
      if (act === "activate") {
        if (room?.activeQuestionId === q.id) await deactivate();
        else await activate(q);
      } else if (act === "toggle") {
        await toggleOpen(q);
      } else if (act === "reset") {
        if (await confirmBox(`「${short(q.prompt)}」의 응답을 모두 지울까요?`, { ok: "지우기", danger: true })) {
          const n = await deleteAll(respCol(q.id));
          toast(`응답 ${n}개를 지웠습니다.`);
        }
      } else if (act === "up" || act === "down") {
        await move(q, act === "up" ? -1 : 1);
      } else if (act === "delete") {
        if (await confirmBox(`「${short(q.prompt)}」 질문과 응답을 삭제할까요?`, { ok: "삭제", danger: true })) {
          if (editingId === q.id) cancelEdit();
          await deleteQuestion(q);
        }
      }
    } catch (er) { err(er); } finally { b.disabled = false; }
  });
}

// ── 발표 화면 ───────────────────────────────
function activeQ() {
  return questions.find((q) => q.id === room?.activeQuestionId) || null;
}
function startPresentData() {
  stopPresentData();
  const c = code;
  const since = Timestamp.fromDate(startOfToday());
  unsubJoined = onSnapshot(
    query(collection(db, "rooms", c, "participants"), where("lastSeen", ">=", since)),
    (s) => { if (code === c) { joined = s.size; paint(); } },
    err,
  );
  syncResp();
}
function stopPresentData() {
  unsubResp?.(); unsubResp = null;
  unsubJoined?.(); unsubJoined = null;
  respQid = undefined;
  responses = [];
  joined = 0;
}
function syncResp() {
  if (!isPresenting() || !code) return;
  const qid = room?.activeQuestionId || null;
  if (qid === respQid) return;
  unsubResp?.(); unsubResp = null;
  respQid = qid;
  responses = [];
  if (!qid) return;
  const c = code;
  unsubResp = onSnapshot(respCol(qid, c), (s) => {
    if (respQid !== qid || code !== c) return;
    responses = s.docs.map((d) => d.data());
    paint();
  }, err);
}
function paint() {
  if (!isPresenting() || !code) return;
  syncResp();
  const q = activeQ();
  renderPresent({
    code, room, question: q,
    responses: q ? responses : [],
    joined,
    idx: q ? questions.indexOf(q) : -1,
    total: questions.length,
    hide,
    showJoin: q ? showJoin : false,
  });
}
async function next() {
  if (moving) return;
  const q = activeQ();
  const n = questions[(q ? questions.indexOf(q) : -1) + 1];
  if (!n) return;
  moving = true;
  showJoin = false;
  try { await activate(n); } catch (e) { err(e); } finally { moving = false; }
}
async function prev() {
  if (moving) return;
  const q = activeQ();
  if (!q) return;
  const i = questions.indexOf(q);
  moving = true;
  showJoin = false;
  try {
    if (i <= 0) await deactivate();
    else await activate(questions[i - 1]);
  } catch (e) { err(e); } finally { moving = false; }
}
function exitPresent() {
  closePresent();
  stopPresentData();
}

// ── 시작 ───────────────────────────────────
if (DEMO) {
  import("./demo.js");
} else {
  const app = initializeApp(firebaseConfig);
  auth = getAuth(app);
  db = getFirestore(app);
  boot();
}
