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
  { id: "d2", type: "text", open: true, maxWords: 3, prompt: "「국제질서」라는 말을 들으면 떠오르는 낱말은?" },
];
const pool = ["규칙", "패권", "미국", "중국", "유엔", "동맹", "힘", "질서", "자유주의", "전쟁", "무역",
  "제재", "WTO", "안보", "협력", "혼란", "민주주의", "다자주의", "주권", "균형", "강대국", "국제법"];
const weights = [9, 8, 7, 7, 5, 5, 6, 4, 3, 4, 3, 2, 2, 4, 3, 2, 2, 2, 2, 3, 2, 2];
const pick = () => {
  let r = Math.random() * weights.reduce((a, b) => a + b, 0);
  for (let i = 0; i < pool.length; i++) { r -= weights[i]; if (r < 0) return pool[i]; }
  return pool[0];
};
const resp = { d1: [], d2: [] };
let idx = -1;
let hide = false;
let showJoin = false;
let joined = 0;

function paint() {
  const q = questions[idx] || null;
  renderPresent({
    code, room, question: q, responses: q ? resp[q.id] : [], joined,
    idx, total: questions.length, hide, showJoin: q ? showJoin : false,
  });
}

initPresent({
  next: () => { if (idx < questions.length - 1) { idx += 1; showJoin = false; paint(); } },
  prev: () => { if (idx >= 0) { idx -= 1; showJoin = false; paint(); } },
  toggle: () => { const q = questions[idx]; if (q) { q.open = !q.open; paint(); } },
  hide: () => { hide = !hide; paint(); },
  qr: () => { showJoin = !showJoin; paint(); },
  full: toggleFullscreen,
  exit: () => { location.href = "host.html"; },
});
openPresent();
paint();

setInterval(() => {
  if (joined < 58) joined += 1;
  const q = questions[idx];
  if (q?.open && resp[q.id].length < joined) {
    if (q.type === "choice") {
      const r = Math.random();
      resp[q.id].push({ choice: r < 0.42 ? 0 : r < 0.7 ? 1 : r < 0.9 ? 2 : 3 });
    } else {
      const n = 1 + Math.floor(Math.random() * 3);
      resp[q.id].push({ words: Array.from({ length: n }, pick) });
    }
  }
  paint();
}, 450);
