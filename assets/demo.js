// 시연 모드(host.html?demo): Firebase 없이 가짜 응답으로 발표 화면을 돌려 본다.
import { initPresent, openPresent, renderPresent, toggleFullscreen } from "./present.js";

const code = "123456";
const room = { title: "국제관계론 (시연)" };
const questions = [
  {
    id: "d1", type: "choice", open: true,
    prompt: "미중 경쟁 속에서 한국 외교가 가장 먼저 붙들어야 할 것은?",
    options: ["한미동맹", "중국과의 경제 관계", "북핵 대응의 국제 공조", "아직 잘 모르겠다"],
  },
  { id: "d2", type: "text", view: "cloud", open: true, maxWords: 3, prompt: "「국제질서」라는 말을 들으면 떠오르는 낱말은?" },
  { id: "d3", type: "text", view: "list", open: true, maxWords: 2, prompt: "지금까지 당연하게 누려 왔지만, 사라지면 가장 아쉬울 것은?" },
];
const pool = ["규칙", "패권", "미국", "중국", "유엔", "동맹", "힘", "질서", "자유주의", "전쟁", "무역",
  "제재", "WTO", "안보", "협력", "혼란", "민주주의", "다자주의", "주권", "균형", "강대국", "국제법"];
const weights = [9, 8, 7, 7, 5, 5, 6, 4, 3, 4, 3, 2, 2, 4, 3, 2, 2, 2, 2, 3, 2, 2];
const pick = () => {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) return pool[i]; }
  return pool[0];
};
const nicks = ["별빛", "정외3", "고양이집사", "아침형인간", "수원토박이", "새벽감자", "파란우산", "익명의곰", "도서관지박령", "커피중독", "오리", "밤하늘"];
const longAns = ["미국 유학", "자유로운 해외여행", "해외 직구", "영어 하나로 통하는 세계", "값싼 수입품", "인터넷 자유", "비자 없는 여행",
  "유엔 평화유지", "케이팝의 세계 시장", "WTO 분쟁 해결", "동맹의 보호", "국제 학술 교류"];
const resp = { d1: [], d2: [], d3: [] };
let idx = -1;
let hide = false;
let showJoin = false;
let joined = 0;
let clock = Date.now();
const viewOverride = new Map();
const viewOf = (q) => (q?.type === "text" ? (viewOverride.get(q.id) || q.view || "cloud") : null);

function paint() {
  const q = questions[idx] || null;
  renderPresent({
    code, room, question: q, responses: q ? resp[q.id] : [], joined,
    idx, total: questions.length, hide, showJoin: q ? showJoin : false, view: viewOf(q),
  });
}

initPresent({
  next: () => { if (idx < questions.length - 1) { idx += 1; showJoin = false; paint(); } },
  prev: () => { if (idx >= 0) { idx -= 1; showJoin = false; paint(); } },
  toggle: () => { const q = questions[idx]; if (q) { q.open = !q.open; paint(); } },
  hide: () => { hide = !hide; paint(); },
  qr: () => { showJoin = !showJoin; paint(); },
  view: () => {
    const q = questions[idx];
    if (q?.type !== "text") return;
    viewOverride.set(q.id, viewOf(q) === "list" ? "cloud" : "list");
    paint();
  },
  full: toggleFullscreen,
  exit: () => { location.href = "host.html"; },
});
openPresent();
paint();

setInterval(() => {
  if (joined < 58) joined += 1;
  const q = questions[idx];
  if (q?.open && resp[q.id].length < joined) {
    const n = resp[q.id].length;
    const nickname = `${nicks[n % nicks.length]}${n >= nicks.length ? Math.floor(n / nicks.length) + 1 : ""}`;
    clock += 1000;
    if (q.type === "choice") {
      const r = Math.random();
      resp[q.id].push({ nickname, choice: r < 0.42 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3, updatedAt: clock });
    } else if (q.view === "list") {
      const k = 1 + Math.floor(Math.random() * 2);
      resp[q.id].push({ nickname, words: Array.from({ length: k }, () => longAns[Math.floor(Math.random() * longAns.length)]), updatedAt: clock });
    } else {
      const k = 1 + Math.floor(Math.random() * 3);
      resp[q.id].push({ nickname, words: Array.from({ length: k }, pick), updatedAt: clock });
    }
  }
  paint();
}, 450);
