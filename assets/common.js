// 학생·강사 화면이 함께 쓰는 도구: 이스케이프, 주소·QR, 결과 그리기(막대·워드클라우드).

export const $ = (sel, root = document) => root.querySelector(sel);

export function esc(s) {
  return String(s ?? "").replace(/[&<>"']/g, (c) => (
    { "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" }[c]
  ));
}

export function show(id) {
  document.querySelectorAll("[data-view]").forEach((el) => {
    el.hidden = el.id !== id;
  });
}

// 학생 입장 주소: host.html과 같은 폴더의 index.html
export function joinUrl(code) {
  const u = new URL("./", location.href);
  if (code) u.searchParams.set("room", code);
  return u.href;
}
export function shortJoinUrl() {
  const u = new URL("./", location.href);
  return (u.host + u.pathname).replace(/\/$/, "");
}
export function prettyCode(code) {
  return String(code).replace(/^(\d{3})(\d{3})$/, "$1 $2");
}

export function qrSvg(text) {
  /* global qrcode */
  const qr = qrcode(0, "M");
  qr.addData(text);
  qr.make();
  return qr.createSvgTag({ cellSize: 4, margin: 8, scalable: true, title: "입장 QR 코드" });
}

export function normalizeWord(w) {
  return String(w ?? "").normalize("NFC").replace(/\s+/g, " ").trim();
}
// 같은 말로 셀 기준: 대소문자·공백 차이는 무시
export function wordKey(w) {
  return normalizeWord(w).toLowerCase();
}

export function startOfToday() {
  const d = new Date();
  d.setHours(0, 0, 0, 0);
  return d;
}

// ── 막대그래프 ─────────────────────────────────────────────
export function renderBars(el, options, counts, { highlight = false } = {}) {
  const total = counts.reduce((a, b) => a + b, 0);
  const max = Math.max(0, ...counts);
  let rows = el.querySelectorAll(".bar-row");
  if (rows.length !== options.length || el.dataset.sig !== options.join("\u0001")) {
    el.innerHTML = options.map((o, i) => `
      <div class="bar-row">
        <div class="bar-label"><span class="bar-key">${i + 1}</span>${esc(o)}</div>
        <div class="bar-track"><div class="bar-fill" style="width:0%"></div></div>
        <div class="bar-num"><b>0</b><small>0%</small></div>
      </div>`).join("");
    el.dataset.sig = options.join("\u0001");
    rows = el.querySelectorAll(".bar-row");
  }
  rows.forEach((row, i) => {
    const c = counts[i] || 0;
    const pct = total ? Math.round((c / total) * 100) : 0;
    row.querySelector(".bar-fill").style.width = `${total ? (c / total) * 100 : 0}%`;
    row.querySelector(".bar-num b").textContent = c;
    row.querySelector(".bar-num small").textContent = `${pct}%`;
    row.classList.toggle("lead", highlight && c > 0 && c === max);
  });
}

// ── 워드클라우드 ───────────────────────────────────────────
// entries: [{ text, count }]. 많이 나온 말부터 가운데에서 나선형으로 빈자리를 찾아 놓는다.
const measureCtx = document.createElement("canvas").getContext("2d");

export function renderCloud(el, entries) {
  const W = el.clientWidth;
  const H = el.clientHeight;
  if (!el._spans) el._spans = new Map();
  const spans = el._spans;
  let empty = el.querySelector(".cloud-empty");
  if (!entries.length) {
    spans.forEach((s) => s.remove());
    spans.clear();
    if (!empty) {
      empty = document.createElement("p");
      empty.className = "cloud-empty";
      empty.textContent = "아직 응답이 없습니다";
      el.appendChild(empty);
    }
    return;
  }
  empty?.remove();
  if (W < 50 || H < 50) return;

  const list = [...entries]
    .sort((a, b) => b.count - a.count || a.text.localeCompare(b.text, "ko"))
    .slice(0, 150);
  const maxC = list[0].count;
  const minC = list[list.length - 1].count;
  const maxF = Math.max(28, Math.min(H * 0.24, W * 0.11, 120));
  const minF = Math.max(15, maxF * 0.2);
  const family = getComputedStyle(el).fontFamily;
  const placed = [];
  const keep = new Set();
  const cx = W / 2;
  const cy = H / 2;
  const ar = Math.max(1, W / H);
  const pad = 6;

  const fits = (x, y, w, h) => {
    if (x < pad || y < pad || x + w > W - pad || y + h > H - pad) return false;
    for (const p of placed) {
      if (x < p.x + p.w + pad && x + w + pad > p.x && y < p.y + p.h + 2 && y + h + 2 > p.y) return false;
    }
    return true;
  };
  const spiral = (w, h) => {
    const limit = Math.max(W, H);
    for (let t = 0; t < 6000; t++) {
      const a = t * 0.12;
      const r = 1.6 * a;
      if (r > limit) break;
      const x = cx + r * Math.cos(a) * ar - w / 2;
      const y = cy + r * Math.sin(a) - h / 2;
      if (fits(x, y, w, h)) return { x, y };
    }
    return null;
  };

  list.forEach((e, rank) => {
    let size = maxC === minC
      ? Math.min(maxF, Math.max(minF, maxF * (list.length > 12 ? 0.5 : 0.75)))
      : minF + (maxF - minF) * Math.sqrt((e.count - minC) / (maxC - minC));
    let pos = null;
    let w = 0;
    let h = 0;
    for (let k = 0; k < 4 && !pos; k++) {
      measureCtx.font = `700 ${size}px ${family}`;
      w = Math.ceil(measureCtx.measureText(e.text).width) + 2;
      h = Math.ceil(size * 1.18);
      pos = spiral(w, h);
      if (!pos) size *= 0.78;
    }
    let s = spans.get(e.text);
    if (!pos) {
      if (s) { s.remove(); spans.delete(e.text); }
      return;
    }
    placed.push({ x: pos.x, y: pos.y, w, h });
    keep.add(e.text);
    if (!s) {
      s = document.createElement("span");
      s.className = "cw";
      s.textContent = e.text;
      s.style.left = `${cx - w / 2}px`;
      s.style.top = `${cy - h / 2}px`;
      s.style.fontSize = `${size}px`;
      s.style.opacity = "0";
      el.appendChild(s);
      spans.set(e.text, s);
      s.getBoundingClientRect(); // 처음 위치를 확정해 두어야 옮겨 가는 효과가 난다
    }
    s.style.fontSize = `${size}px`;
    s.style.left = `${pos.x}px`;
    s.style.top = `${pos.y}px`;
    s.style.opacity = "1";
    s.dataset.tone = String(rank === 0 ? 0 : (rank % 5) + 1);
    s.title = `${e.text} · ${e.count}`;
  });
  spans.forEach((s, text) => {
    if (!keep.has(text)) { s.remove(); spans.delete(text); }
  });
}

// 응답 문서들 → 워드클라우드 항목. 대소문자·공백만 다른 말은 하나로 센다.
export function tallyWords(docs) {
  const map = new Map();
  for (const d of docs) {
    const words = Array.isArray(d.words) ? d.words : [];
    const seen = new Set();
    for (const raw of words) {
      const t = normalizeWord(raw);
      if (!t) continue;
      const k = wordKey(t);
      if (seen.has(k)) continue; // 한 학생이 같은 말을 두 번 써도 한 번만
      seen.add(k);
      const cur = map.get(k);
      if (cur) cur.count += 1;
      else map.set(k, { text: t, count: 1 });
    }
  }
  return [...map.values()];
}

export function tallyChoices(docs, n) {
  const counts = Array(n).fill(0);
  for (const d of docs) {
    if (Number.isInteger(d.choice) && d.choice >= 0 && d.choice < n) counts[d.choice] += 1;
  }
  return counts;
}

// 화면 안 확인 창(브라우저 confirm 대신)
export function confirmBox(message, { ok = "확인", danger = false } = {}) {
  return new Promise((resolve) => {
    const dlg = document.createElement("dialog");
    dlg.className = "confirm";
    dlg.innerHTML = `
      <p>${esc(message)}</p>
      <div class="row end">
        <button type="button" class="btn ghost" data-v="0">취소</button>
        <button type="button" class="btn ${danger ? "danger" : "primary"}" data-v="1">${esc(ok)}</button>
      </div>`;
    document.body.appendChild(dlg);
    const done = (v) => { dlg.close(); dlg.remove(); resolve(v); };
    dlg.addEventListener("click", (e) => {
      const b = e.target.closest("button[data-v]");
      if (b) done(b.dataset.v === "1");
    });
    dlg.addEventListener("cancel", (e) => { e.preventDefault(); done(false); });
    dlg.showModal();
    dlg.querySelector('[data-v="1"]').focus();
  });
}

export function toast(msg, kind = "") {
  let box = document.getElementById("toasts");
  if (!box) {
    box = document.createElement("div");
    box.id = "toasts";
    box.setAttribute("role", "status");
    document.body.appendChild(box);
  }
  const t = document.createElement("div");
  t.className = `toast ${kind}`;
  t.textContent = msg;
  box.appendChild(t);
  setTimeout(() => t.remove(), 3200);
}
