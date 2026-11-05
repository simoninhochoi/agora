// 학생 화면: 익명 로그인 → 방 코드 → 닉네임 → 지금 뜬 질문에 응답
import {
  initializeApp, getAuth, onAuthStateChanged, signInAnonymously,
  getFirestore, doc, getDoc, setDoc, onSnapshot, serverTimestamp,
} from "./sdk.js";
import { firebaseConfig } from "./firebase-config.js";
import { $, esc, show, normalizeWord, wordKey, prettyCode } from "./common.js";

// 강사 화면과 같은 브라우저에서 열어도 로그인이 섞이지 않도록 앱 이름을 따로 둔다.
const app = initializeApp(firebaseConfig, "student");
const auth = getAuth(app);
const db = getFirestore(app);

const NICK_KEY = "agora.nickname";
const ROOM_KEY = "agora.room";
const store = {
  get(k) { try { return localStorage.getItem(k); } catch { return null; } },
  set(k, v) { try { localStorage.setItem(k, v); } catch { /* 저장 못 해도 진행 */ } },
};

let uid = null;
let code = null;
let room = null;
let nickname = store.get(NICK_KEY) || "";
let unsubRoom = null;
let unsubQ = null;
let currentQid;          // undefined = 아직 모름, null = 뜬 질문 없음
let question = null;
let mine = null;         // 내가 낸 응답
let draft = null;        // 아직 내지 않은 입력
let note = { text: "", kind: "" };
let busy = false;

show("v-loading");

onAuthStateChanged(auth, async (user) => {
  if (!user) {
    try { await signInAnonymously(auth); } catch (e) { fail(e); }
    return;
  }
  if (uid) return;
  uid = user.uid;
  const fromUrl = (new URLSearchParams(location.search).get("room") || "").replace(/\D/g, "");
  if (fromUrl.length === 6) enterRoom(fromUrl);
  else showCode();
});

function fail(e) {
  console.error(e);
  $("#error-msg").textContent = e?.code === "auth/operation-not-allowed"
    ? "익명 로그인이 꺼져 있습니다. 강사에게 알려 주세요."
    : "인터넷 연결을 확인한 뒤 다시 시도해 주세요.";
  show("v-error");
}

// ── 방 코드 ─────────────────────────────────
function showCode(msg = "") {
  stopLive();
  $("#btn-nick").hidden = true;
  $("#me").textContent = "";
  show("v-code");
  const inp = $("#code");
  if (!inp.value) inp.value = store.get(ROOM_KEY) ? prettyCode(store.get(ROOM_KEY)) : "";
  $("#code-err").textContent = msg;
  inp.focus();
}

$("#f-code").addEventListener("submit", (e) => {
  e.preventDefault();
  const c = $("#code").value.replace(/\D/g, "");
  if (c.length !== 6) { $("#code-err").textContent = "숫자 6자리를 입력하세요."; return; }
  enterRoom(c);
});

async function enterRoom(c) {
  show("v-loading");
  try {
    const snap = await getDoc(doc(db, "rooms", c));
    if (!snap.exists()) { showCode("그런 방이 없습니다. 코드를 다시 확인해 주세요."); return; }
    code = c;
    room = snap.data();
    store.set(ROOM_KEY, c);
    const u = new URL(location.href);
    u.searchParams.set("room", c);
    history.replaceState(null, "", u);
    if (nickname) join();
    else showNick();
  } catch (e) {
    showCode("방을 불러오지 못했습니다. 연결을 확인해 주세요.");
    console.error(e);
  }
}

$("#btn-leave").addEventListener("click", () => {
  const u = new URL(location.href);
  u.searchParams.delete("room");
  history.replaceState(null, "", u);
  $("#code").value = "";
  showCode();
});

// ── 닉네임 ─────────────────────────────────
function showNick() {
  show("v-nick");
  $("#nick-room").textContent = room?.title || "";
  $("#nick").value = nickname;
  $("#nick-err").textContent = "";
  $("#nick").focus();
}

$("#btn-nick").addEventListener("click", showNick);

$("#f-nick").addEventListener("submit", (e) => {
  e.preventDefault();
  const n = normalizeWord($("#nick").value).slice(0, 16);
  if (!n) { $("#nick-err").textContent = "닉네임을 입력하세요."; return; }
  nickname = n;
  store.set(NICK_KEY, n);
  join();
});

async function join() {
  show("v-loading");
  try {
    await setDoc(doc(db, "rooms", code, "participants", uid), { nickname, lastSeen: serverTimestamp() });
  } catch (e) {
    console.error(e);
    showCode("입장하지 못했습니다. 코드를 다시 확인해 주세요.");
    return;
  }
  goLive();
}

// ── 실시간 화면 ─────────────────────────────
function stopLive() {
  unsubRoom?.(); unsubRoom = null;
  unsubQ?.(); unsubQ = null;
  currentQid = undefined;
}

function goLive() {
  stopLive();
  show("v-live");
  $("#me").textContent = nickname;
  $("#btn-nick").hidden = false;
  $("#room-title").textContent = room?.title || "";
  renderWaiting();
  unsubRoom = onSnapshot(doc(db, "rooms", code), (s) => {
    if (!s.exists()) { showCode("이 방은 닫혔습니다."); return; }
    room = s.data();
    $("#room-title").textContent = room.title || "";
    const qid = room.activeQuestionId || null;
    if (qid !== currentQid) switchQuestion(qid);
  }, (e) => { console.error(e); fail(e); });
}

function switchQuestion(qid) {
  unsubQ?.(); unsubQ = null;
  currentQid = qid;
  question = null; mine = null; draft = null; note = { text: "", kind: "" };
  if (!qid) { renderWaiting(); return; }
  $("#q").innerHTML = `<p class="muted center">질문을 불러오는 중…</p>`;
  getDoc(doc(db, "rooms", code, "questions", qid, "responses", uid))
    .then((s) => { if (currentQid === qid) { mine = s.exists() ? s.data() : null; render(); } })
    .catch(() => {});
  unsubQ = onSnapshot(doc(db, "rooms", code, "questions", qid), (s) => {
    if (currentQid !== qid) return;
    question = s.exists() ? { id: s.id, ...s.data() } : null;
    if (!question) { renderWaiting(); return; }
    render();
  }, (e) => console.error(e));
}

function renderWaiting() {
  $("#q").innerHTML = `
    <div class="card waiting">
      <p><span class="dot"></span><span class="dot"></span><span class="dot"></span></p>
      <p>질문이 뜨면 여기에 바로 나타납니다.</p>
    </div>`;
}

function captureDraft() {
  if (!question) return;
  if (question.type === "text") {
    const vals = [...document.querySelectorAll("#q .word")].map((i) => i.value);
    if (!vals.length) return;
    const saved = mine?.words || [];
    const same = vals.every((v, i) => normalizeWord(v) === normalizeWord(saved[i] || ""));
    if (!same) draft = { words: vals };
  }
}

function render() {
  if (!question) return;
  captureDraft();
  const q = question;
  const open = q.open === true;
  const state = `<span class="qstate ${open ? "" : "closed"}">${open ? "응답 받는 중" : "응답 마감"}</span>`;
  let body = "";
  let ready = false;

  if (q.type === "choice") {
    const sel = draft?.choice ?? mine?.choice ?? null;
    ready = sel !== null;
    body = `
      <div class="choices" role="radiogroup" aria-label="보기">
        ${(q.options || []).map((o, i) => `
          <button type="button" class="choice ${sel === i ? "on" : ""}" role="radio"
            aria-checked="${sel === i}" data-i="${i}" ${open ? "" : "disabled"}>
            <span class="ck">${i + 1}</span><span>${esc(o)}</span>
          </button>`).join("")}
      </div>`;
  } else {
    const max = Math.min(3, Math.max(1, q.maxWords || 1));
    const vals = draft?.words ?? mine?.words ?? [];
    ready = true;
    body = `
      <p class="muted" style="margin:0">${max > 1 ? `낱말이나 짧은 구절로 ${max}개까지` : "낱말이나 짧은 구절 하나로"} 답해 주세요. (칸마다 20자)</p>
      <div class="words">
        ${Array.from({ length: max }, (_, i) => `
          <input class="word" maxlength="20" data-i="${i}" value="${esc(vals[i] || "")}"
            aria-label="응답 ${i + 1}" ${open ? "" : "disabled"} enterkeyhint="${i === max - 1 ? "send" : "next"}">`).join("")}
      </div>`;
  }

  let status = note.text;
  let kind = note.kind;
  if (!status) {
    if (!open) {
      status = mine ? "응답이 마감되었습니다. 낸 응답이 집계에 들어갔어요." : "응답이 마감되었습니다.";
    } else if (mine && !draft) {
      status = "제출했습니다. 마감 전까지는 바꿀 수 있어요.";
      kind = "ok";
    }
  }

  $("#q").innerHTML = `
    <div class="card qcard">
      ${state}
      <h2 class="qprompt">${esc(q.prompt)}</h2>
      ${body}
      ${open ? `<button type="button" id="submit" class="btn primary block" ${ready && !busy ? "" : "disabled"}>${mine ? "응답 바꾸기" : "제출"}</button>` : ""}
      <p class="note ${kind}" role="status">${esc(status)}</p>
    </div>`;

  if (q.type === "choice") {
    $("#q").querySelectorAll(".choice").forEach((b) => b.addEventListener("click", () => {
      draft = { choice: Number(b.dataset.i) };
      note = { text: "", kind: "" };
      render();
    }));
  } else {
    const inputs = [...$("#q").querySelectorAll(".word")];
    inputs.forEach((inp, i) => {
      inp.addEventListener("input", () => {
        draft = { words: inputs.map((x) => x.value) };
        note = { text: "", kind: "" };
        const st = $("#q .note");
        if (st) { st.textContent = ""; st.className = "note"; }
      });
      inp.addEventListener("keydown", (e) => {
        if (e.key !== "Enter" || e.isComposing) return;
        e.preventDefault();
        if (i < inputs.length - 1) inputs[i + 1].focus();
        else submit();
      });
    });
  }
  $("#submit")?.addEventListener("click", submit);
}

async function submit() {
  const q = question;
  if (!q || q.open !== true || busy) return;
  let data;
  if (q.type === "choice") {
    const c = draft?.choice ?? mine?.choice;
    if (!Number.isInteger(c)) return;
    data = { nickname, choice: c, updatedAt: serverTimestamp() };
  } else {
    const max = Math.min(3, Math.max(1, q.maxWords || 1));
    const raw = [...document.querySelectorAll("#q .word")].map((i) => normalizeWord(i.value).slice(0, 20));
    const words = [];
    const seen = new Set();
    for (const w of raw) {
      if (w && !seen.has(wordKey(w))) { seen.add(wordKey(w)); words.push(w); }
    }
    if (!words.length) { note = { text: "한 칸 이상 써 주세요.", kind: "bad" }; render(); return; }
    data = { nickname, words: words.slice(0, max), updatedAt: serverTimestamp() };
  }
  busy = true;
  const btn = $("#submit");
  if (btn) btn.disabled = true;
  try {
    await setDoc(doc(db, "rooms", code, "questions", q.id, "responses", uid), data);
    mine = data;
    draft = null;
    note = { text: "", kind: "" };
  } catch (e) {
    console.error(e);
    note = e?.code === "permission-denied"
      ? { text: "응답이 마감되었거나 다음 질문으로 넘어갔습니다.", kind: "bad" }
      : { text: "저장하지 못했습니다. 연결을 확인하고 다시 눌러 주세요.", kind: "bad" };
  } finally {
    busy = false;
    if (question?.id === q.id) render();
  }
}
