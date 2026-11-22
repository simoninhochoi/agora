// 발표 화면(프로젝터용). 데이터는 호출하는 쪽(host.js·demo.js)이 state로 넘긴다.
import {
  $, esc, qrSvg, joinUrl, shortJoinUrl, prettyCode,
  renderBars, renderCloud, tallyWords, tallyChoices,
} from "./common.js";

let H = {};
let S = null;
let cloudTimer = null;
const root = () => $("#present");

export function initPresent(handlers) {
  H = handlers;
  root().addEventListener("click", (e) => {
    const b = e.target.closest("[data-p]");
    if (b && !b.disabled) H[b.dataset.p]?.();
  });
  document.addEventListener("keydown", (e) => {
    if (root().hidden || e.target.closest("input, textarea, select, dialog")) return;
    if (e.ctrlKey || e.metaKey || e.altKey) return;
    const k = e.key;
    if (["ArrowRight", "PageDown", "n", "N"].includes(k)) { e.preventDefault(); H.next?.(); }
    else if (["ArrowLeft", "PageUp", "p", "P"].includes(k)) { e.preventDefault(); H.prev?.(); }
    else if (k === "c" || k === "C") H.toggle?.();
    else if (k === "h" || k === "H") H.hide?.();
    else if (k === "l" || k === "L") H.view?.();
    else if ((k === "ArrowDown" || k === "ArrowUp") && !$("#p-list").hidden) {
      e.preventDefault();
      const el = $("#p-list");
      el.scrollBy({ top: (k === "ArrowDown" ? 1 : -1) * el.clientHeight * 0.7, behavior: "auto" });
    }
    else if (k === "q" || k === "Q") H.qr?.();
    else if (k === "f" || k === "F") toggleFullscreen();
    else if (k === "Escape" && !document.fullscreenElement) H.exit?.();
  });
  window.addEventListener("resize", () => scheduleCloud(true));
}

export function openPresent() {
  root().hidden = false;
  document.body.classList.add("presenting");
}
export function closePresent() {
  root().hidden = true;
  document.body.classList.remove("presenting");
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
}
export function isPresenting() {
  return !root().hidden;
}
export function toggleFullscreen() {
  if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
  else root().requestFullscreen?.().catch(() => {});
}

// s = { code, room, question, responses, joined, idx, total, hide, showJoin, view("cloud" | "list" | null) }
export function renderPresent(s) {
  S = s;
  const r = root();
  if (r.dataset.qr !== s.code) {
    const svg = qrSvg(joinUrl(s.code));
    $(".p-qr-sm", r).innerHTML = svg;
    $(".pj-qr", r).innerHTML = svg;
    r.dataset.qr = s.code;
  }
  r.querySelectorAll(".p-url").forEach((el) => { el.textContent = shortJoinUrl(); });
  r.querySelectorAll(".p-code").forEach((el) => { el.textContent = prettyCode(s.code); });
  $(".pj-title", r).textContent = s.room?.title || "";

  const q = s.question;
  const joinMode = !q || s.showJoin;
  $("#p-joinscreen").hidden = !joinMode;
  $("#p-question").hidden = joinMode;
  $(".p-top", r).hidden = joinMode; // 참여 화면에서는 같은 안내가 가운데에 크게 나온다

  $("#p-count").innerHTML = q ? `응답 <b>${s.responses.length}</b>명` : "";
  $("#p-joined").innerHTML = `오늘 입장 <b>${s.joined}</b>명`;
  $("#p-sep").hidden = !q;

  const btn = (k) => r.querySelector(`[data-p="${k}"]`);
  btn("prev").disabled = !q;
  btn("next").disabled = s.total === 0 || (q && s.idx >= s.total - 1);
  btn("toggle").disabled = !q;
  btn("toggle").textContent = q && !q.open ? "응답 다시 열기" : "응답 마감";
  btn("hide").textContent = s.hide ? "결과 보이기" : "결과 가리기";
  btn("qr").textContent = s.showJoin ? "QR 닫기" : "QR 크게";
  btn("qr").disabled = !q;
  const asList = !!q && q.type === "text" && s.view === "list";
  btn("view").disabled = !q || q.type !== "text";
  btn("view").textContent = asList ? "워드클라우드 보기" : "목록 보기";

  if (!q) return;
  $("#p-num").textContent = `${s.idx + 1} / ${s.total}`;
  const st = $("#p-status");
  st.textContent = q.open ? "응답 받는 중" : "응답 마감";
  st.classList.toggle("closed", !q.open);
  const pr = $("#p-prompt");
  pr.textContent = q.prompt || "";
  pr.classList.toggle("long", (q.prompt || "").length > 60);

  const bars = $("#p-bars");
  const cloud = $("#p-cloud");
  const list = $("#p-list");
  $("#p-hidden").hidden = !s.hide;
  bars.hidden = s.hide || q.type !== "choice";
  cloud.hidden = s.hide || q.type !== "text" || asList;
  list.hidden = s.hide || !asList;
  if (s.hide) return;
  if (q.type === "choice") {
    const opts = q.options || [];
    renderBars(bars, opts, tallyChoices(s.responses, opts.length), { highlight: !q.open });
  } else if (asList) {
    // 닉네임은 「목록」으로 만든 질문에서만 — 학생 화면이 그 질문에서만 「닉네임과 함께 나온다」고 알린다.
    renderList(list, s.responses, q.id, q.view === "list");
  } else {
    scheduleCloud();
  }
}

// 단답을 「닉네임 + 답」 카드로 두 열에 늘어놓는다. 낸 순서대로, 스크롤해 가며 본다.
// 맨 아래를 보고 있으면 새 답이 들어올 때 따라 내려가고, 위로 올려 읽는 중이면 자리를 지킨다.
const stamp = (d) => {
  const t = d.updatedAt;
  if (typeof t === "number") return t;
  return t?.toMillis?.() ?? Number.MAX_SAFE_INTEGER; // 막 보낸 응답은 서버 시각이 아직 없을 수 있다
};
function renderList(el, responses, qid, showNick) {
  const rows = responses
    .map((d) => ({ nick: d.nickname || "익명", words: (Array.isArray(d.words) ? d.words : []).filter(Boolean), t: stamp(d) }))
    .filter((r) => r.words.length)
    .sort((a, b) => a.t - b.t);
  const sig = qid + (showNick ? "N" : "A") + "\u0001" + rows.map((r) => r.nick + "\u0002" + r.words.join("\u0003")).join("\u0001");
  if (!el._bound) {
    // 사용자가 스크롤한 자리를 기억한다 — 맨 아래 근처면 새 답을 따라가고, 위로 올렸으면 그 자리를 지킨다.
    el.addEventListener("scroll", () => { el._stick = el.scrollHeight - el.scrollTop - el.clientHeight < 40; });
    el._bound = true;
  }
  if (el.dataset.sig === sig) return;
  const sameQ = el.dataset.qid === qid;
  const atBottom = !sameQ || el._stick !== false;
  const keep = el.scrollTop;
  el.innerHTML = rows.length
    ? rows.map((r) => `
        <li class="al-item">
          ${showNick ? `<span class="al-nick">${esc(r.nick)}</span>` : ""}
          <span class="al-ans">${r.words.map(esc).join(" · ")}</span>
        </li>`).join("")
    : `<li class="al-empty">아직 응답이 없습니다</li>`;
  el.dataset.sig = sig;
  el.dataset.qid = qid;
  if (!sameQ) { el._stick = true; el.scrollTop = el.scrollHeight; }
  else el.scrollTop = atBottom ? el.scrollHeight : keep;
}

function scheduleCloud(fast) {
  if (!S?.question || S.question.type !== "text" || S.hide || S.view === "list") return;
  clearTimeout(cloudTimer);
  cloudTimer = setTimeout(() => {
    const cloud = $("#p-cloud");
    if (cloud.hidden || !S?.question) return;
    if (cloud.dataset.qid !== S.question.id) {
      cloud._spans?.forEach((sp) => sp.remove());
      cloud._spans = new Map();
      cloud.dataset.qid = S.question.id;
    }
    const entries = tallyWords(S.responses);
    const text = entries.map((e) => e.text).join("");
    // 글꼴이 내려온 뒤에 재야 글자 폭이 맞는다
    const ready = document.fonts?.load
      ? document.fonts.load('700 32px "Pretendard Variable"', text || "가").catch(() => {})
      : Promise.resolve();
    ready.then(() => renderCloud(cloud, entries));
  }, fast ? 120 : 220);
}
