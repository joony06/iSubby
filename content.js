// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// iSubby — lcms.skku.edu 플레이어 iframe 안에서 실행됩니다.
(() => {
  const DEFAULTS = { fontSize: 22, bottom: 12, bg: 0.6, visible: true };

  let video = null;
  let contentId = null;
  let localCues = []; // 내가 직접 불러온 자막 (우선)
  let sharedCues = []; // 저장소에서 받은 공유 자막
  let cues = []; // 실제로 표시 중인 자막
  let source = ""; // "local" | "shared" | ""
  let offset = 0; // 초 단위. +면 자막이 늦게, -면 빨리 나옴
  let fileName = "";
  let settings = { ...DEFAULTS };

  let overlay = null;
  let box = null;
  let lastKey = "";
  let nativeTrack = null; // 비디오 자체가 전체화면일 때 쓰는 대체 트랙
  let toastUntil = 0;
  let idFailed = false; // 영상은 찾았지만 강의 ID를 읽지 못함 (학교 플레이어 구조 변경 가능성)

  // 자막 목록 패널
  let panel = null, panelBtn = null, listEl = null, searchEl = null, countEl = null;
  let panelOpen = false, rows = [], activeIdx = -1, listDirty = true, userScrollUntil = 0;
  let aiNoticeSeen = true; // 저장값을 읽기 전에는 안내를 띄우지 않음

  // ---------- 콘텐츠 식별 ----------
  function detectContentId() {
    const m = location.pathname.match(/\/em\/([0-9a-z]+)/i);
    if (m) return m[1];
    const p = new URLSearchParams(location.search);
    if (p.get("content_id")) return p.get("content_id");
    const src = video && (video.currentSrc || video.src);
    const m2 = src && src.match(/skku\d+\/([0-9a-z]+)\//i);
    if (m2) return m2[1];
    return null;
  }
  const storeKey = () => "subs:" + contentId;

  function pickActive() {
    if (localCues.length) { cues = localCues; source = "local"; }
    else if (sharedCues.length) { cues = sharedCues; source = "shared"; }
    else { cues = []; source = ""; }
    lastKey = "";
    listDirty = true;
    rebuildNativeTrack();
  }

  // ---------- 저장 ----------
  async function loadSaved() {
    const data = await chrome.storage.local.get([storeKey(), "settings"]);
    settings = { ...DEFAULTS, ...(data.settings || {}) };
    const saved = data[storeKey()];
    localCues = (saved && saved.cues) || [];
    offset = (saved && saved.offset) || 0;
    fileName = (saved && saved.fileName) || "";
    applyStyle();
    pickActive();
  }
  function save() {
    return chrome.storage.local.set({
      [storeKey()]: { cues: localCues, offset, fileName, savedAt: Date.now() },
    });
  }

  async function loadShared() {
    if (!contentId) return;
    const id = contentId;
    let got = await ICS.fetchShared(id);
    // [자동 연결] 이 영상 ID로 된 자막이 없으면, 제목·길이가 같은 다른 분반 영상의 자막을 찾아봄.
    // 제목·길이는 강의콘텐츠 목록 페이지를 열 때 저장해 둔 값 (course.js)
    if (!got) {
      const { lectureMeta } = await chrome.storage.local.get("lectureMeta");
      const m = lectureMeta && lectureMeta[id];
      if (m) got = await ICS.fetchByFingerprint(m.t, m.d);
    }
    if (id !== contentId) return; // 그 사이 다른 영상으로 바뀐 경우
    sharedCues = got || [];
    pickActive();
    if (source === "shared") flash(`공유 자막 ${cues.length}개 적용됨`);
  }

  chrome.storage.onChanged.addListener((changes, area) => {
    if (area !== "local") return;
    if (changes.settings) {
      settings = { ...DEFAULTS, ...(changes.settings.newValue || {}) };
      applyStyle();
      lastKey = "";
    }
  });

  // ---------- 오버레이 ----------
  function ensureOverlay() {
    if (overlay) return;
    overlay = document.createElement("div");
    overlay.className = "srt-ov-root";
    box = document.createElement("div");
    box.className = "srt-ov-box";
    overlay.appendChild(box);
    document.body.appendChild(overlay);
    applyStyle();
  }

  function applyStyle() {
    if (!overlay) return;
    overlay.style.setProperty("--srt-font", settings.fontSize + "px");
    overlay.style.setProperty("--srt-bottom", settings.bottom + "%");
    overlay.style.setProperty("--srt-bg", `rgba(0,0,0,${settings.bg})`);
  }

  function placeOverlay() {
    const fs = document.fullscreenElement || document.webkitFullscreenElement;
    // 플레이어 컨테이너가 전체화면이면 그 안으로 옮겨야 보입니다.
    const host = fs && fs !== video && fs.contains(video) ? fs : document.body;
    if (overlay.parentNode !== host) host.appendChild(overlay);

    const r = video.getBoundingClientRect();
    overlay.style.left = r.left + "px";
    overlay.style.top = r.top + "px";
    overlay.style.width = r.width + "px";
    overlay.style.height = r.height + "px";

    // 비디오 요소 자체가 전체화면이면 DOM 오버레이는 안 보이므로 기본 트랙 사용
    const videoItselfFs = fs === video;
    overlay.style.display = videoItselfFs ? "none" : "";
    if (nativeTrack) nativeTrack.mode = videoItselfFs && settings.visible ? "showing" : "hidden";
  }

  function render() {
    const t = video.currentTime - offset;
    if (panelOpen) updateActiveRow(t);
    if (!settings.visible) {
      box.style.visibility = "hidden";
      lastKey = "";
      return;
    }
    const active = SRT.activeCues(cues, t);
    const key = active.map((c) => c.start).join("|");
    if (key === lastKey) return;
    lastKey = key;
    box.textContent = "";
    for (const c of active) {
      for (const line of c.text.split("\n")) {
        const span = document.createElement("span");
        span.className = "srt-ov-line";
        span.textContent = line;
        box.appendChild(span);
      }
    }
    box.style.visibility = active.length ? "visible" : "hidden";
  }

  function loop() {
    if (video && video.isConnected && cues.length) {
      ensureOverlay();
      ensurePanel();
      placeOverlay();
      if (listDirty) buildList();
      render();
    } else if (overlay && Date.now() > toastUntil) {
      overlay.style.display = "none";
    }
    requestAnimationFrame(loop);
  }

  // 비디오 요소 자체 전체화면 대비용 TextTrack
  function rebuildNativeTrack() {
    if (!video) return;
    if (!nativeTrack) nativeTrack = video.addTextTrack("subtitles", "iSubby", "ko");
    if (nativeTrack.cues) for (const c of [...nativeTrack.cues]) nativeTrack.removeCue(c);
    for (const c of cues) {
      const s = Math.max(0, c.start + offset);
      const e = Math.max(s + 0.01, c.end + offset);
      nativeTrack.addCue(new VTTCue(s, e, c.text));
    }
    nativeTrack.mode = "hidden";
  }

  // ---------- 비디오 찾기 ----------
  function pickVideo() {
    const vids = [...document.querySelectorAll("video")];
    if (!vids.length) return null;
    return vids.sort((a, b) => b.clientWidth * b.clientHeight - a.clientWidth * a.clientHeight)[0];
  }

  async function attach(v) {
    if (v === video) return;
    video = v;
    nativeTrack = null;
    sharedCues = [];
    contentId = detectContentId();
    if (!contentId) {
      if (v.readyState >= 1) { idFailed = true; return; } // 이미 로드됐는데도 못 읽음
      // src가 아직 없으면 로드된 뒤 다시 시도
      v.addEventListener("loadedmetadata", () => { video = null; attach(v); }, { once: true });
      return;
    }
    idFailed = false;
    await loadSaved();
    loadShared();
  }

  const mo = new MutationObserver(() => {
    const v = pickVideo();
    if (v && v !== video) attach(v);
  });
  mo.observe(document.documentElement, { childList: true, subtree: true });
  const first = pickVideo();
  if (first) attach(first);
  requestAnimationFrame(loop);

  // ---------- 공통 동작 ----------
  async function setLocal(newCues, name) {
    localCues = newCues;
    fileName = name || "";
    offset = 0;
    await save();
    pickActive();
  }
  async function shiftOffset(delta) {
    offset = Math.round((offset + delta) * 100) / 100;
    await save();
    rebuildNativeTrack();
    lastKey = "";
    listDirty = true;
  }

  // ---------- 팝업과 통신 ----------
  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (!video) return false; // 비디오 없는 프레임은 응답하지 않음
    if (!contentId) {
      sendResponse({ ok: false, reason: idFailed ? "no-id" : "loading" });
      return false;
    }

    const status = () => ({
      ok: true,
      contentId,
      fileName: source === "shared" ? "공유 자막" : fileName,
      source,
      cueCount: cues.length,
      localCount: localCues.length,
      sharedCount: sharedCues.length,
      offset,
      panelOpen,
    });

    (async () => {
      let extra = {};
      switch (msg.type) {
        case "load":
          await setLocal(SRT.parseSRT(msg.text), msg.fileName);
          break;
        case "offset":
          await shiftOffset(msg.delta);
          break;
        case "resetOffset":
          await shiftOffset(-offset);
          break;
        case "clear": // 내 자막만 지움 (공유 자막이 있으면 그걸로 돌아감)
          localCues = [];
          fileName = "";
          offset = 0;
          await chrome.storage.local.remove(storeKey());
          if (box) box.textContent = "";
          // 페이지를 연 뒤에 공유 자막이 올라왔을 수 있으니 비어 있으면 다시 받아옴
          if (sharedCues.length) pickActive();
          else await loadShared();
          break;
        case "reloadShared":
          await loadShared();
          break;
        case "export":
          extra = { cues: localCues };
          break;
        case "togglePanel":
          if (cues.length) togglePanel();
          break;
      }
      sendResponse({ ...status(), ...extra });
    })();
    return true;
  });

  // ---------- 단축키 (플레이어를 클릭해 포커스가 있을 때) ----------
  // [ / ] : 자막 0.5초 빠르게/늦게,  Shift+S : 자막 켜기/끄기
  document.addEventListener("keydown", async (e) => {
    if (!video || !cues.length) return;
    const tag = (e.target && e.target.tagName) || "";
    if (/INPUT|TEXTAREA/.test(tag)) return;
    if (e.key === "[" || e.key === "]") {
      await shiftOffset(e.key === "[" ? -0.5 : 0.5);
      flash(`자막 싱크 ${offset >= 0 ? "+" : ""}${offset.toFixed(1)}초`);
    } else if (e.key === "S" && e.shiftKey) {
      settings.visible = !settings.visible;
      chrome.storage.local.set({ settings });
    } else if (e.code === "KeyT" && !e.ctrlKey && !e.metaKey && !e.altKey && !e.shiftKey) {
      togglePanel();
    }
  });

  // ---------- 플레이어 위로 SRT 파일 끌어놓기 ----------
  const isSubFile = (f) => f && /\.(srt|vtt)$/i.test(f.name);
  document.addEventListener("dragover", (e) => {
    if (video && [...(e.dataTransfer?.items || [])].some((i) => i.kind === "file")) e.preventDefault();
  }, true);
  document.addEventListener("drop", async (e) => {
    const f = e.dataTransfer?.files?.[0];
    if (!video || !contentId || !isSubFile(f)) return;
    e.preventDefault();
    e.stopPropagation();
    const buf = await f.arrayBuffer();
    let text = new TextDecoder("utf-8").decode(buf);
    if (text.includes("�")) {
      try { text = new TextDecoder("euc-kr").decode(buf); } catch {}
    }
    const parsed = SRT.parseSRT(text);
    if (!parsed.length) return flash("자막을 읽지 못했어요");
    await setLocal(parsed, f.name);
    flash(`자막 ${cues.length}개 불러옴`);
  }, true);

  // ---------- 자막 목록 패널 ----------
  const fmtTime = (sec) => {
    sec = Math.max(0, Math.floor(sec));
    const h = Math.floor(sec / 3600), m = Math.floor((sec % 3600) / 60), x = sec % 60;
    const mm = String(m).padStart(h ? 2 : 1, "0"), ss = String(x).padStart(2, "0");
    return h ? `${h}:${mm}:${ss}` : `${mm}:${ss}`;
  };

  function ensurePanel() {
    if (panel) return;
    panelBtn = document.createElement("button");
    panelBtn.className = "srt-ov-btn";
    panelBtn.type = "button";
    panelBtn.title = "자막 목록 (T)";
    panelBtn.innerHTML = '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.2" stroke-linecap="round"><path d="M8 6h12M8 12h12M8 18h8M4 6h.01M4 12h.01M4 18h.01"/></svg>';
    panelBtn.addEventListener("click", (e) => { e.stopPropagation(); togglePanel(); });

    panel = document.createElement("div");
    panel.className = "srt-ov-panel";
    panel.innerHTML =
      '<div class="srt-ov-ph"><b>자막 목록</b><span class="srt-ov-meta"><span class="srt-ov-count"></span>' +
      '<span class="srt-ov-ai" title="AI 음성 인식으로 만든 자막이라 용어·숫자가 틀릴 수 있어요. 틀린 줄을 눌러 이동한 뒤 오류 신고를 눌러 주세요.">' +
      '<span class="srt-ov-ai-t">· AI 자막</span><span class="srt-ov-ai-i">i</span></span></span>' +
      '<button type="button" class="srt-ov-report" title="지금 강조된 줄의 시간과 자막을 담아 메일 창을 열어요. 다른 줄은 먼저 그 줄을 눌러 이동한 뒤 신고하면 돼요.">오류 신고</button>' +
      '<button type="button" class="srt-ov-x" title="닫기 (T)">✕</button></div>' +
      '<div class="srt-ov-search"><input type="search" placeholder="자막 검색" spellcheck="false" /></div>' +
      '<div class="srt-ov-notice" hidden><p>AI 음성 인식으로 만든 자막이라 용어·숫자가 틀릴 수 있어요. ' +
      '틀린 줄을 누른 뒤 위의 <b>오류 신고</b>로 알려 주세요.</p><button type="button">알겠어요</button></div>' +
      '<div class="srt-ov-list"></div>';
    listEl = panel.querySelector(".srt-ov-list");
    searchEl = panel.querySelector("input");
    countEl = panel.querySelector(".srt-ov-count");
    panel.querySelector(".srt-ov-x").addEventListener("click", () => togglePanel(false));
    panel.querySelector(".srt-ov-report").addEventListener("click", reportLine);
    // AI 자막 안내: 공유 자막을 처음 볼 때 한 번만
    panel.querySelector(".srt-ov-notice button").addEventListener("click", () => {
      aiNoticeSeen = true;
      chrome.storage.local.set({ aiNoticeSeen: true });
      updateAiHint();
    });
    chrome.storage.local.get("aiNoticeSeen").then((d) => { aiNoticeSeen = !!d.aiNoticeSeen; updateAiHint(); });

    // 패널 안에서 누른 키·클릭이 플레이어 단축키로 가지 않게
    for (const ev of ["keydown", "keyup", "keypress"]) panel.addEventListener(ev, (e) => {
      if (ev === "keydown" && e.key === "Escape") { if (searchEl.value) { searchEl.value = ""; applyFilter(); } else togglePanel(false); }
      e.stopPropagation();
    });
    for (const ev of ["click", "dblclick", "mousedown", "pointerdown", "wheel"]) panel.addEventListener(ev, (e) => e.stopPropagation());
    searchEl.addEventListener("input", applyFilter);
    listEl.addEventListener("scroll", () => { if (!listEl._auto) userScrollUntil = Date.now() + 4000; listEl._auto = false; });
    listEl.addEventListener("click", (e) => {
      const row = e.target.closest(".srt-ov-row");
      if (!row || !video) return;
      const c = cues[+row.dataset.i];
      video.currentTime = Math.max(0, c.start + offset + 0.01);
      userScrollUntil = 0;
    });
    overlay.append(panelBtn, panel);
  }

  // 자막 오류 신고: 지금 강조된 줄의 정보를 넣은 메일 쓰기 창을 엶 (이용자가 보내기를 눌러야 전달됨)
  function reportLine() {
    const c = cues[activeIdx];
    const t = c ? c.start + offset : (video ? video.currentTime : 0);
    const mail = ["joon2.1022", "gmail.com"].join("@");
    const body = [
      "어떤 점이 틀렸는지 적어 주세요:",
      "",
      "",
      "----- 아래는 자동으로 들어간 정보예요 -----",
      `강의 ID: ${contentId}`,
      `영상 시간: ${fmtTime(t)}`,
      `자막: ${c ? c.text.replace(/\s*\n\s*/g, " ") : "(이 시간에 나오는 자막 없음)"}`,
      `자막 종류: ${source === "local" ? "내 파일" : "공유 자막"}`,
      `iSubby v${chrome.runtime.getManifest().version}`,
    ].join("\n");
    const url = `mailto:${mail}?subject=${encodeURIComponent(`[iSubby 자막 오류] ${fmtTime(t)}`)}&body=${encodeURIComponent(body)}`;
    // 플레이어는 아캠 안의 프레임이라 링크·클립보드가 막혀 있어서, 확장 쪽(background.js)에서 메일 창을 엶
    chrome.runtime.sendMessage({ type: "openMail", url }).then(
      () => flash("메일 쓰기 창을 열었어요"),
      () => flash("메일 창을 열지 못했어요. 팝업 아래 '문의'로 보내 주세요")
    );
  }

  // 공유 자막일 때만 "AI 자막" 표시와 첫 안내를 보여줌
  function updateAiHint() {
    if (!panel) return;
    panel.classList.toggle("is-shared", source === "shared");
    panel.querySelector(".srt-ov-notice").hidden = source !== "shared" || aiNoticeSeen;
  }

  function buildList() {
    listDirty = false;
    updateAiHint();
    if (!listEl) return;
    listEl.textContent = "";
    rows = cues.map((c, i) => {
      const r = document.createElement("div");
      r.className = "srt-ov-row";
      r.dataset.i = i;
      const t = document.createElement("span");
      t.className = "srt-ov-time";
      t.textContent = fmtTime(c.start + offset);
      const x = document.createElement("span");
      x.className = "srt-ov-text";
      x._raw = c.text.replace(/\s*\n\s*/g, " ");
      x.textContent = x._raw;
      r.append(t, x);
      listEl.appendChild(r);
      return r;
    });
    activeIdx = -1;
    applyFilter();
  }

  function applyFilter() {
    if (!searchEl) return;
    const q = searchEl.value.trim().toLowerCase();
    let n = 0;
    for (const r of rows) {
      const x = r.lastChild, raw = x._raw;
      const hit = !q || raw.toLowerCase().includes(q);
      r.hidden = !hit;
      if (hit) n++;
      // 검색어 강조 (textContent로만 넣어서 안전하게)
      x.textContent = "";
      if (!q || !hit) { x.textContent = raw; continue; }
      let i = 0, low = raw.toLowerCase();
      while (i < raw.length) {
        const j = low.indexOf(q, i);
        if (j < 0) { x.append(raw.slice(i)); break; }
        if (j > i) x.append(raw.slice(i, j));
        const m = document.createElement("mark");
        m.textContent = raw.slice(j, j + q.length);
        x.append(m);
        i = j + q.length;
      }
    }
    countEl.textContent = q ? `${n}개 찾음` : `${rows.length}줄`;
    if (!q) { userScrollUntil = 0; scrollToActive(true); }
  }

  function updateActiveRow(t) {
    // 지금 시점 이전에 시작한 마지막 자막
    let lo = 0, hi = cues.length - 1, idx = -1;
    while (lo <= hi) { const mid = (lo + hi) >> 1; if (cues[mid].start <= t) { idx = mid; lo = mid + 1; } else hi = mid - 1; }
    if (idx === activeIdx) return;
    if (rows[activeIdx]) rows[activeIdx].classList.remove("on");
    activeIdx = idx;
    if (rows[idx]) rows[idx].classList.add("on");
    scrollToActive(false);
  }

  function scrollToActive(force) {
    const r = rows[activeIdx];
    if (!r || r.hidden || !listEl) return;
    if (!force && (Date.now() < userScrollUntil || searchEl.value.trim())) return;
    listEl._auto = true;
    listEl.scrollTop = r.offsetTop - listEl.clientHeight / 2 + r.offsetHeight / 2;
  }

  function togglePanel(force) {
    if (!cues.length) return;
    ensureOverlay();
    ensurePanel();
    if (listDirty) buildList();
    panelOpen = typeof force === "boolean" ? force : !panelOpen;
    overlay.classList.toggle("panel-open", panelOpen);
    if (panelOpen) {
      activeIdx = -1;
      userScrollUntil = 0;
      if (video) updateActiveRow(video.currentTime - offset);
    }
  }

  function flash(text) {
    ensureOverlay();
    if (video) placeOverlay();
    overlay.style.display = "";
    let n = overlay.querySelector(".srt-ov-toast");
    if (!n) {
      n = document.createElement("div");
      n.className = "srt-ov-toast";
      overlay.appendChild(n);
    }
    n.textContent = text;
    n.style.opacity = "1";
    toastUntil = Date.now() + 1800;
    clearTimeout(n._t);
    n._t = setTimeout(() => (n.style.opacity = "0"), 1500);
  }
})();
