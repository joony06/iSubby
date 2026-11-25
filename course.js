// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// 관리자 전용: 아캠 "강의콘텐츠" 페이지에서 주차별 공유 자막 업로드 여부를 보여줍니다.
// 관리자 모드가 꺼져 있으면 아무것도 하지 않습니다.
(() => {
  let admin = false;
  let data = null; // { courseId, items: [{ moduleItemId, title, week, weekPos, contentId }] }
  const status = {}; // contentId → "checking" | "found" | "none" | "error"
  let card = null, observer = null, running = false;

  // ---------- 데이터 받기 ----------
  function readData() {
    const root = document.documentElement;
    if (!root) return; // 아주 이른 시점이면 이벤트로 다시 들어옴
    const raw = root.dataset.isubbyModules;
    if (!raw) return;
    try { data = JSON.parse(raw); } catch { return; }
    if (admin) start();
  }
  document.addEventListener("isubby-modules", readData);

  chrome.storage.local.get("admin").then(({ admin: a }) => {
    admin = !!a;
    if (admin) readData();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local" || !c.admin) return;
    admin = !!c.admin.newValue;
    if (admin) readData();
    else teardown();
  });

  // ---------- 업로드 여부 확인 ----------
  async function start() {
    if (!data || !document.body) {
      if (!document.body) document.addEventListener("DOMContentLoaded", start, { once: true });
      return;
    }
    ensureCard();
    watchList();
    await checkAll(false);
  }

  async function checkAll(force) {
    if (running) return;
    running = true;
    const ids = [...new Set(data.items.map((i) => i.contentId))].filter((id) => force || !status[id]);
    ids.forEach((id) => (status[id] = "checking"));
    renderAll();
    let next = 0;
    const worker = async () => {
      while (next < ids.length) {
        const id = ids[next++];
        status[id] = await ICS.checkShared(id);
        renderAll();
      }
    };
    await Promise.all(Array.from({ length: 5 }, worker));
    running = false;
    renderAll();
  }

  // ---------- 화면 ----------
  const LABEL = { found: "자막 있음", none: "자막 없음", checking: "확인 중", error: "확인 실패" };

  function ensureCard() {
    if (card && card.isConnected) return;
    card = document.createElement("section");
    card.className = "isb-card";
    card.innerHTML =
      '<div class="isb-head">' +
      '<span class="isb-logo">iSubby</span><span class="isb-tag">관리자</span>' +
      '<span class="isb-sum"></span>' +
      '<button type="button" class="isb-btn isb-recheck">다시 확인</button>' +
      '<button type="button" class="isb-btn isb-fold"></button>' +
      "</div>" +
      '<div class="isb-body"></div>';
    card.querySelector(".isb-recheck").addEventListener("click", () => checkAll(true));
    card.querySelector(".isb-fold").addEventListener("click", async () => {
      const folded = !card.classList.contains("folded");
      card.classList.toggle("folded", folded);
      card.querySelector(".isb-fold").textContent = folded ? "펼치기" : "접기";
      chrome.storage.local.set({ courseCardFolded: folded });
    });
    chrome.storage.local.get("courseCardFolded").then(({ courseCardFolded }) => {
      card.classList.toggle("folded", !!courseCardFolded);
      card.querySelector(".isb-fold").textContent = courseCardFolded ? "펼치기" : "접기";
    });
    document.body.prepend(card);
  }

  function renderAll() {
    if (!card || !data) return;
    renderCard();
    renderBadges();
  }

  function renderCard() {
    const total = new Set(data.items.map((i) => i.contentId)).size;
    const found = Object.keys(status).filter((id) => status[id] === "found").length;
    const checking = Object.values(status).some((s) => s === "checking");
    card.querySelector(".isb-sum").textContent =
      `공유 자막 ${found} / ${total}개` + (checking ? " · 확인 중…" : "");

    const body = card.querySelector(".isb-body");
    body.textContent = "";
    const weeks = new Map();
    for (const it of data.items) {
      if (!weeks.has(it.week)) weeks.set(it.week, []);
      weeks.get(it.week).push(it);
    }
    for (const [week, list] of weeks) {
      const row = document.createElement("div");
      row.className = "isb-week";
      const w = document.createElement("span");
      w.className = "isb-wname";
      w.textContent = week;
      row.appendChild(w);
      const ul = document.createElement("div");
      ul.className = "isb-items";
      for (const it of list) {
        const st = status[it.contentId] || "checking";
        const a = document.createElement("a");
        a.className = "isb-item " + st;
        a.href = `/courses/${data.courseId}/modules/items/${it.moduleItemId}`;
        a.target = "_top";
        a.title = `${it.title} · ${LABEL[st]}`;
        const dot = document.createElement("i");
        const t = document.createElement("span");
        t.textContent = it.title;
        a.append(dot, t);
        ul.appendChild(a);
      }
      row.appendChild(ul);
      body.appendChild(row);
    }
  }

  // 강의 목록의 각 강의 제목 옆에 작은 표시
  function renderBadges() {
    if (!data) return;
    const byItem = new Map(data.items.map((i) => [String(i.moduleItemId), i]));
    for (const a of document.querySelectorAll('a[href*="/modules/items/"]')) {
      if (a.closest(".isb-card")) continue;
      const m = a.getAttribute("href").match(/\/modules\/items\/(\d+)/);
      const it = m && byItem.get(m[1]);
      if (!it) continue;
      const st = status[it.contentId] || "checking";
      let b = a.nextElementSibling;
      if (!b || !b.classList.contains("isb-badge")) {
        b = document.createElement("span");
        a.after(b);
      }
      // 바뀐 경우에만 고쳐서 관찰자가 계속 다시 그리지 않게
      const cls = "isb-badge " + st, txt = st === "found" ? "자막 ✓" : LABEL[st];
      if (b.className !== cls) b.className = cls;
      if (b.textContent !== txt) b.textContent = txt;
    }
  }

  function watchList() {
    if (observer) return;
    let queued = false;
    observer = new MutationObserver(() => {
      if (queued) return;
      queued = true;
      requestAnimationFrame(() => { queued = false; renderBadges(); });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    if (card) { card.remove(); card = null; }
    document.querySelectorAll(".isb-badge").forEach((b) => b.remove());
  }
})();
