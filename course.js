// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// 아캠 "강의콘텐츠" 페이지
//  - 모두: 강의별 제목·길이를 이 컴퓨터에 저장(분반 자동 연결용), "목록 복사" 버튼
//  - 관리자: 주차별 공유 자막 업로드 여부, SRT 한꺼번에 올리기, 분반 연결
(() => {
  let admin = null; // 저장값을 읽기 전에는 null
  let data = null; // { courseId, items: [{ moduleItemId, title, week, weekPos, contentId, duration, videoTitle }] }
  const status = {}; // contentId → "checking" | "found" | "none" | "error"
  let card = null, observer = null, running = false, bar = null;

  // ---------- 데이터 받기 ----------
  function readData() {
    const root = document.documentElement;
    if (!root) return; // 아주 이른 시점이면 이벤트로 다시 들어옴
    const raw = root.dataset.isubbyModules;
    if (!raw) return;
    try { data = JSON.parse(raw); } catch { return; }
    saveMeta();
    if (admin === true) start();
    else if (admin === false) startBar();
  }
  document.addEventListener("isubby-modules", readData);

  chrome.storage.local.get("admin").then(({ admin: a }) => {
    admin = !!a;
    readData();
  });
  chrome.storage.onChanged.addListener((c, area) => {
    if (area !== "local" || !c.admin) return;
    admin = !!c.admin.newValue;
    teardown();
    readData();
  });

  // [자동 연결] 영상 플레이어에서 쓸 수 있게 콘텐츠 ID별 제목·길이를 저장 (이 컴퓨터에만)
  async function saveMeta() {
    const { lectureMeta = {} } = await chrome.storage.local.get("lectureMeta");
    let changed = false;
    for (const it of data.items) {
      if (!it.duration) continue;
      const v = { t: it.videoTitle || it.title, d: it.duration };
      const o = lectureMeta[it.contentId];
      if (!o || o.t !== v.t || o.d !== v.d) { lectureMeta[it.contentId] = v; changed = true; }
    }
    if (!changed) return;
    const keys = Object.keys(lectureMeta);
    for (const k of keys.slice(0, Math.max(0, keys.length - 1500))) delete lectureMeta[k]; // 오래된 것부터 정리
    chrome.storage.local.set({ lectureMeta });
  }

  // ---------- 모두: 목록 복사 막대 ----------
  function startBar() {
    if (!data || !document.body) {
      if (!document.body) document.addEventListener("DOMContentLoaded", startBar, { once: true });
      return;
    }
    if (bar && bar.isConnected) return;
    bar = document.createElement("div");
    bar.className = "isb-bar";
    bar.append(el("span", "isb-logo", "iSubby"), el("span", "isb-bar-t", "다른 분반이라 자막이 안 뜨면, 이 목록을 자막 올리는 사람에게 보내주세요."));
    const b = el("button", "isb-btn", "목록 복사");
    b.type = "button";
    b.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(listText());
        b.textContent = "복사했어요 ✓";
      } catch {
        b.textContent = "복사 실패";
      }
      setTimeout(() => (b.textContent = "목록 복사"), 2500);
    });
    bar.append(b);
    placeEl(bar);
    watchList();
  }

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
      '<button type="button" class="isb-btn isb-bulk-open">SRT 한꺼번에 올리기</button>' +
      '<button type="button" class="isb-btn isb-link-open">분반 연결</button>' +
      '<button type="button" class="isb-btn isb-copy" title="이 분반의 강의 목록">목록 복사</button>' +
      '<button type="button" class="isb-btn isb-recheck">다시 확인</button>' +
      '<button type="button" class="isb-btn isb-fold"></button>' +
      "</div>" +
      '<div class="isb-tools" hidden></div>' +
      '<div class="isb-body"></div>';
    card.querySelector(".isb-recheck").addEventListener("click", () => checkAll(true));
    card.querySelector(".isb-copy").addEventListener("click", copyList);
    card.querySelector(".isb-link-open").addEventListener("click", openLinkTool);
    card.querySelector(".isb-bulk-open").addEventListener("click", openBulkTool);
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
    placeEl(card);
  }

  // 아캠 강의콘텐츠 페이지는 주차 번호·"모두 펼치기"가 있는 상단 바가 화면 위에 고정돼 있어서,
  // 카드를 그 바 아래(주차 목록 바로 위)에 넣어야 가려지지 않음
  function placeEl(node) {
    const header = document.querySelector(".xnmb-module-list > .xnmb-header");
    if (header) {
      if (node.previousElementSibling !== header) header.after(node);
    } else if (node.parentNode !== document.body) {
      document.body.prepend(node);
    }
  }

  function renderAll() {
    if (!card || !card.isConnected || !data) return;
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
      requestAnimationFrame(() => {
        queued = false;
        // 페이지가 목록을 다시 그리면서 카드가 빠지거나 위치가 바뀌면 다시 제자리에
        const hasHeader = !!document.querySelector(".xnmb-module-list > .xnmb-header");
        for (const node of [card, bar]) {
          if (node && (!node.isConnected || (hasHeader && node.parentNode === document.body))) placeEl(node);
        }
        if (admin) renderBadges();
      });
    });
    observer.observe(document.body, { childList: true, subtree: true });
  }



  // ---------- SRT 한꺼번에 올리기 ----------
  // 여러 SRT를 골라 파일 이름으로 강의를 찾아 짝짓고, 강의별로 암호화한 파일을 zip 하나로 받음
  const key = (t) => String(t || "").toLowerCase().replace(/\.srt$/i, "").replace(/[^0-9a-z가-힣]+/g, "");
  const itemLabel = (it) => `${it.week} · ${it.title}`;

  function guessItem(fileName) {
    const f = key(fileName);
    if (!f) return null;
    let best = null, score = 0;
    for (const it of data.items) {
      for (const t of new Set([it.videoTitle, it.title])) {
        const k = key(t);
        if (!k) continue;
        let sc = 0;
        if (k === f) sc = 1000 + k.length;
        else if (f.includes(k) || k.includes(f)) sc = Math.min(k.length, f.length);
        if (sc > score) { score = sc; best = it; }
      }
    }
    return score >= 4 ? best : null;
  }

  function openBulkTool() {
    const tools = card.querySelector(".isb-tools");
    if (!tools.hidden && tools.dataset.mode === "bulk") { tools.hidden = true; return; }
    showTools();
    tools.dataset.mode = "bulk";
    tools.textContent = "";
    tools.append(el("p", "isb-note", "SRT 파일을 여러 개 골라주세요. 파일 이름(예: bizstat_w3_1.srt)으로 강의를 찾아 짝지어요. 틀린 건 목록에서 바꾸면 돼요."));
    const input = el("input");
    input.type = "file";
    input.accept = ".srt";
    input.multiple = true;
    input.hidden = true;
    const pick = el("button", "isb-btn isb-primary", "SRT 파일 고르기");
    pick.type = "button";
    pick.addEventListener("click", () => input.click());
    const out = el("div", "isb-result");
    input.addEventListener("change", () => readFiles([...input.files], out));
    // 끌어다 놓기도 됨
    tools.addEventListener("dragover", (e) => { e.preventDefault(); tools.classList.add("drag"); });
    tools.addEventListener("dragleave", () => tools.classList.remove("drag"));
    tools.addEventListener("drop", (e) => {
      e.preventDefault();
      tools.classList.remove("drag");
      if (tools.dataset.mode === "bulk") readFiles([...e.dataTransfer.files].filter((f) => /\.srt$/i.test(f.name)), out);
    });
    tools.append(input, pick, out);
  }

  async function readFiles(files, out) {
    out.textContent = "";
    if (!files.length) return;
    const rows = [];
    for (const f of files) {
      let cues = [];
      try { cues = SRT.parseSRT(await f.text()); } catch {}
      rows.push({ name: f.name, cues, item: guessItem(f.name) });
    }
    rows.sort((a, b) => a.name.localeCompare(b.name, "ko", { numeric: true }));

    const table = el("div", "isb-table");
    const sum = el("p", "isb-sumline");
    const make = el("button", "isb-btn isb-primary");
    make.type = "button";
    const update = () => {
      const ok = rows.filter((r) => r.item && r.cues.length);
      const ids = ok.map((r) => r.item.contentId);
      const dup = ids.filter((id, i) => ids.indexOf(id) !== i);
      const over = ok.filter((r) => status[r.item.contentId] === "found").length;
      sum.textContent = `${rows.length}개 중 ${ok.length}개 준비됨` + (over ? ` · 이미 올린 ${over}개는 새 자막으로 바뀜` : "") + (dup.length ? " · 같은 강의에 파일이 2개 이상 있어요" : "");
      make.textContent = `${ok.length}개 암호화해서 받기`;
      make.disabled = !ok.length || dup.length > 0;
    };
    for (const r of rows) {
      const row = el("div", "isb-row isb-brow");
      const name = el("span", "isb-t", r.name);
      const sel = el("select", "isb-sel");
      sel.append(new Option("— 강의 선택 —", ""));
      for (const it of data.items) sel.append(new Option(itemLabel(it), String(it.moduleItemId)));
      sel.value = r.item ? String(r.item.moduleItemId) : "";
      const info = el("span", "isb-i");
      const paint = () => {
        const st = r.item && status[r.item.contentId];
        info.textContent = !r.cues.length ? "자막을 읽지 못함" : `${r.cues.length}줄` + (st === "found" ? " · 덮어씀" : "");
        row.className = "isb-row isb-brow " + (!r.cues.length ? "bad" : r.item ? (st === "found" ? "len" : "link") : "none");
      };
      sel.addEventListener("change", () => {
        r.item = data.items.find((it) => String(it.moduleItemId) === sel.value) || null;
        paint();
        update();
      });
      paint();
      row.append(name, sel, info);
      table.append(row);
    }
    make.addEventListener("click", async () => {
      make.disabled = true;
      const files = [];
      for (const r of rows) {
        if (!r.item || !r.cues.length) continue;
        files.push({ name: await ICS.fileNameFor(r.item.contentId), data: await ICS.encryptCues(r.item.contentId, r.cues) });
        const fp = await fingerprintFor(r.item); // [자동 연결]
        if (fp) files.push(fp);
      }
      download(files, `isubby-subs-${rows.filter((r) => r.item && r.cues.length).length}.zip`);
      out.append(uploadNote());
      make.disabled = false;
    });
    out.append(sum, table, make);
    update();
  }

  // [자동 연결] 제목·길이가 같은 다른 분반 영상이 이 강의 자막을 찾을 수 있게 하는 파일
  async function fingerprintFor(it) {
    if (!it.duration) return null;
    return ICS.makeFingerprint(it.videoTitle || it.title, it.duration, it.contentId);
  }

  function download(files, name) {
    const a = document.createElement("a");
    a.href = URL.createObjectURL(makeZip(files));
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
  }

  function uploadNote() {
    const done = el("p", "isb-note", "");
    done.append("받은 zip을 풀고 안의 .json 파일을 모두 ");
    const up = el("a", "", "subs 폴더에 올리기");
    up.href = ICS.uploadUrl();
    up.target = "_blank";
    up.rel = "noopener";
    done.append(up, " 페이지에 한 번에 끌어다 놓고 커밋하세요. 몇 분 뒤 다시 확인을 누르면 초록색으로 바뀌어요.");
    return done;
  }

  // ---------- 분반 연결 ----------
  // 같은 녹화본인데 분반마다 콘텐츠 ID가 다른 영상을, 이 분반의 자막에 연결하는 파일을 만듦.
  const LIST_HEADER = "iSubby 강의 목록 v1";
  const fmtDur = (d) => { d = Math.round(d); return `${Math.floor(d / 60)}분 ${String(d % 60).padStart(2, "0")}초`; };
  const norm = (t) => String(t || "").trim().toLowerCase().replace(/\s+/g, " ");

  function listText() {
    const lines = [`${LIST_HEADER}\tcourse=${data.courseId}`];
    for (const it of data.items) lines.push([it.week, it.title, it.contentId, (it.duration || 0).toFixed(2), it.videoTitle || ""].map((x) => String(x).replace(/\t/g, " ")).join("\t"));
    return lines.join("\n");
  }

  async function copyList() {
    const text = listText();
    try {
      await navigator.clipboard.writeText(text);
      note(`강의 ${data.items.length}개 목록을 복사했어요.`);
    } catch {
      showTools(); // 복사가 막히면 직접 복사하도록 보여줌
      const tools = card.querySelector(".isb-tools");
      tools.textContent = "";
      const p = el("p", "isb-note", "아래 내용을 전부 선택해서 복사해 주세요.");
      const ta = el("textarea", "isb-ta");
      ta.value = text;
      ta.readOnly = true;
      tools.append(p, ta);
      ta.select();
    }
  }

  function el(tag, cls, text) {
    const e = document.createElement(tag);
    if (cls) e.className = cls;
    if (text != null) e.textContent = text;
    return e;
  }

  function note(text) {
    let n = card.querySelector(".isb-toast");
    if (!n) { n = el("div", "isb-toast"); card.querySelector(".isb-head").after(n); }
    n.textContent = text;
    clearTimeout(n._t);
    n._t = setTimeout(() => n.remove(), 4000);
  }

  function showTools() {
    card.classList.remove("folded");
    card.querySelector(".isb-tools").hidden = false;
  }

  function openLinkTool() {
    const tools = card.querySelector(".isb-tools");
    if (!tools.hidden && tools.dataset.mode === "link") { tools.hidden = true; return; }
    showTools();
    tools.dataset.mode = "link";
    tools.textContent = "";
    tools.append(
      el("p", "isb-note", "다른 분반 친구가 보내준 \"목록 복사\" 내용을 붙여넣으세요. 제목과 영상 길이가 같은 강의끼리 짝지어, 그 분반 영상에서도 이 분반 자막이 뜨도록 연결 파일을 만들어요.")
    );
    const ta = el("textarea", "isb-ta");
    ta.placeholder = LIST_HEADER + "\t…";
    const go = el("button", "isb-btn isb-primary", "비교하기");
    go.type = "button";
    const out = el("div", "isb-result");
    go.addEventListener("click", () => compare(ta.value, out));

    // [자동 연결] 이미 올린 자막에 자동 연결 파일 만들기 (목록을 못 받아도 같은 제목·길이 영상이면 자막이 뜸)
    const autoOut = el("div", "isb-result");
    const auto = el("button", "isb-btn", "자동 연결 파일 만들기");
    auto.type = "button";
    auto.addEventListener("click", async () => {
      const found = data.items.filter((it) => status[it.contentId] === "found" && it.duration);
      autoOut.textContent = "";
      if (!found.length) { autoOut.append(el("p", "isb-warn", "아직 올린 자막이 없어요.")); return; }
      const files = [];
      for (const it of found) files.push(await fingerprintFor(it));
      download(files, `isubby-auto-${files.length}.zip`);
      autoOut.append(uploadNote());
    });
    const autoP = el("p", "isb-note", "목록을 받기 어려우면: 이 분반에 올린 자막마다 '자동 연결 파일'을 만들어 두면, 다른 분반에서도 제목과 영상 길이가 같으면 자막이 떠요. (SRT 한꺼번에 올리기로 올린 자막은 이미 들어 있어요)");
    tools.append(ta, go, out, el("hr", "isb-hr"), autoP, auto, autoOut);
    ta.focus();
  }

  function parseList(text) {
    const items = [];
    let course = null;
    for (const line of String(text).split(/\r?\n/)) {
      const f = line.split("\t");
      if (f[0] === LIST_HEADER) { const m = /course=(\d+)/.exec(line); course = m && m[1]; continue; }
      if (f.length < 4 || !/^[0-9a-z]{8,}$/i.test(f[2].trim())) continue;
      items.push({ week: f[0].trim(), title: f[1].trim(), contentId: f[2].trim(), duration: parseFloat(f[3]) || 0, videoTitle: (f[4] || "").trim() });
    }
    return { course, items };
  }

  async function compare(text, out) {
    out.textContent = "";
    const other = parseList(text);
    if (!other.items.length) { out.append(el("p", "isb-warn", "목록을 읽지 못했어요. \"목록 복사\"로 받은 내용을 그대로 붙여넣어 주세요.")); return; }
    if (other.course && other.course === String(data.courseId)) { out.append(el("p", "isb-warn", "같은 분반의 목록이에요. 다른 분반 목록을 붙여넣어 주세요.")); return; }

    // 강의 제목이나 영상 제목 중 하나라도 같으면 후보
    const mine = new Map();
    const add = (k, it) => { if (!k) return; if (!mine.has(k)) mine.set(k, new Set()); mine.get(k).add(it); };
    for (const it of data.items) { add(norm(it.title), it); add(norm(it.videoTitle), it); }

    const rows = [];
    for (const o of other.items) {
      const cands = [...new Set([...(mine.get(norm(o.title)) || []), ...(mine.get(norm(o.videoTitle)) || [])])];
      const same = cands.find((m) => m.contentId === o.contentId);
      const match = cands.find((m) => m.contentId !== o.contentId && Math.abs((m.duration || 0) - o.duration) <= 1);
      if (same) rows.push({ o, kind: "same" });
      else if (match) rows.push({ o, m: match, kind: "link" });
      else if (cands.length) rows.push({ o, m: cands[0], kind: "len" });
      else rows.push({ o, kind: "none" });
    }

    // 연결 대상 영상에 이미 자막 파일이 있으면 덮어쓰지 않음
    const links = rows.filter((r) => r.kind === "link");
    out.append(el("p", "isb-note", "확인 중…"));
    await Promise.all(links.map(async (r) => { r.exists = (await ICS.checkShared(r.o.contentId)) === "found"; }));
    out.textContent = "";

    const todo = links.filter((r) => !r.exists);
    const cnt = (k) => rows.filter((r) => r.kind === k).length;
    out.append(el("p", "isb-sumline",
      `연결할 강의 ${todo.length}개 · 이미 같은 영상 ${cnt("same")}개 · 길이가 달라 제외 ${cnt("len")}개 · 이 분반에 없는 강의 ${cnt("none")}개` +
      (links.length - todo.length ? ` · 이미 자막 있음 ${links.length - todo.length}개` : "")));

    const table = el("div", "isb-table");
    const LBL = { link: "연결", same: "같은 영상", len: "길이 다름", none: "없음" };
    for (const r of rows) {
      const kind = r.kind === "link" && r.exists ? "has" : r.kind;
      const row = el("div", "isb-row " + kind);
      row.append(el("span", "isb-k", kind === "has" ? "자막 있음" : LBL[r.kind]), el("span", "isb-t", `${r.o.week} · ${r.o.title}`));
      let info = "";
      if (r.kind === "link") info = `${fmtDur(r.o.duration)} · 이 분반 자막 ${status[r.m.contentId] === "found" ? "있음" : "아직 없음 (올리면 자동 적용)"}`;
      else if (r.kind === "len") info = `길이 ${fmtDur(r.o.duration)} ↔ ${fmtDur(r.m.duration)}`;
      row.append(el("span", "isb-i", info));
      table.append(row);
    }
    out.append(table);

    if (!todo.length) return;
    const make = el("button", "isb-btn isb-primary", `연결 파일 ${todo.length}개 만들기`);
    make.type = "button";
    make.addEventListener("click", async () => {
      make.disabled = true;
      const files = [];
      for (const r of todo) files.push({ name: await ICS.fileNameFor(r.o.contentId), data: await ICS.encryptAlias(r.o.contentId, r.m.contentId) });
      download(files, `isubby-link-${todo.length}.zip`);
      make.disabled = false;
      out.append(uploadNote());
    });
    out.append(make);
  }

  // 압축 없이 파일만 묶는 간단한 zip
  function makeZip(files) {
    const crcTable = makeZip.t || (makeZip.t = Array.from({ length: 256 }, (_, n) => { let c = n; for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1; return c >>> 0; }));
    const crc32 = (b) => { let c = 0xffffffff; for (const x of b) c = crcTable[(c ^ x) & 0xff] ^ (c >>> 8); return (c ^ 0xffffffff) >>> 0; };
    const te = new TextEncoder();
    const parts = [], central = [];
    let offset = 0;
    for (const f of files) {
      const name = te.encode(f.name), body = te.encode(f.data), crc = crc32(body);
      const h = new DataView(new ArrayBuffer(30));
      h.setUint32(0, 0x04034b50, true); h.setUint16(4, 20, true); h.setUint32(14, crc, true);
      h.setUint32(18, body.length, true); h.setUint32(22, body.length, true); h.setUint16(26, name.length, true);
      parts.push(h, name, body);
      const c = new DataView(new ArrayBuffer(46));
      c.setUint32(0, 0x02014b50, true); c.setUint16(4, 20, true); c.setUint16(6, 20, true); c.setUint32(16, crc, true);
      c.setUint32(20, body.length, true); c.setUint32(24, body.length, true); c.setUint16(28, name.length, true); c.setUint32(42, offset, true);
      central.push(c, name);
      offset += 30 + name.length + body.length;
    }
    const size = central.reduce((n, p) => n + p.byteLength, 0);
    const e = new DataView(new ArrayBuffer(22));
    e.setUint32(0, 0x06054b50, true); e.setUint16(8, files.length, true); e.setUint16(10, files.length, true);
    e.setUint32(12, size, true); e.setUint32(16, offset, true);
    return new Blob([...parts, ...central, e], { type: "application/zip" });
  }

  function teardown() {
    if (observer) { observer.disconnect(); observer = null; }
    if (card) { card.remove(); card = null; }
    if (bar) { bar.remove(); bar = null; }
    document.querySelectorAll(".isb-badge").forEach((b) => b.remove());
  }
})();
