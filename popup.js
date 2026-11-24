// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
const DEFAULTS = { fontSize: 22, bottom: 12, bg: 0.6, visible: true };
const $ = (id) => document.getElementById(id);
let tabId = null;
let lastStatus = null;
let adminOn = false;

function send(msg) {
  return chrome.tabs.sendMessage(tabId, msg).catch(() => null);
}

// ---------- 토스트 ----------
let toastTimer = null;
function toast(text) {
  const t = $("toast");
  t.textContent = text;
  t.classList.add("show");
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => t.classList.remove("show"), 1800);
}

// ---------- 상태 표시 ----------
function showStatus(st) {
  const prevId = lastStatus && lastStatus.contentId;
  lastStatus = st && st.ok ? st : null;
  renderAdmin(prevId !== (lastStatus && lastStatus.contentId));
  if (!st || !st.ok) {
    $("noPlayer").hidden = false;
    $("player").hidden = true;
    $("clearRow").hidden = true;
    return;
  }
  $("noPlayer").hidden = true;
  $("player").hidden = false;

  const has = st.cueCount > 0;
  const chip = $("chip");
  chip.hidden = !has;
  if (st.source === "shared") {
    chip.textContent = "공유 자막";
    chip.className = "chip";
  } else if (st.source === "local") {
    chip.textContent = "내 파일";
    chip.className = "chip mine";
  }

  if (has) {
    $("heading").textContent = st.source === "shared" ? "자막이 준비됐어요" : stripExt(st.fileName || "내 자막");
    $("subline").textContent = `자막 ${st.cueCount.toLocaleString()}개를 보여주고 있어요`;
  } else {
    $("heading").textContent = "아직 자막이 없어요";
    $("subline").textContent = "SRT 파일을 불러오면 바로 보여드릴게요";
  }

  // 공유 자막을 보는 중에도 내 파일로 바꿀 수 있게 불러오기 버튼은 항상 노출
  $("pick").textContent = has ? "다른 자막 불러오기" : "SRT 파일 불러오기";
  $("syncCard").hidden = !has;
  $("clearRow").hidden = !st.localCount;
  $("offset").textContent = (st.offset > 0 ? "+" : st.offset < 0 ? "−" : "") + Math.abs(st.offset).toFixed(1);
}


// ---------- 관리자 카드 ----------
let checkSeq = 0;
async function renderAdmin(recheck) {
  const card = $("adminCard");
  $("adminBadge").hidden = !adminOn;
  card.hidden = !(adminOn && lastStatus);
  if (card.hidden) return;
  const st = lastStatus;
  $("cid").textContent = st.contentId;
  $("cid").title = st.contentId;
  $("uploadLink").href = ICS.uploadUrl();

  const exp = $("export");
  exp.disabled = !st.localCount;
  exp.style.opacity = st.localCount ? "1" : ".45";
  $("adminNote").textContent = st.localCount
    ? "내보낸 파일을 subs 폴더에 올리면 몇 분 안에 수강생에게 적용돼요."
    : "내보내려면 먼저 이 강의에 내 SRT 파일을 불러와 주세요.";
  if (recheck) checkShared();
}

async function checkShared() {
  const st = lastStatus;
  if (!st) return;
  const seq = ++checkSeq;
  setShared("", "확인 중…");
  $("viewLink").hidden = true;
  const r = await ICS.checkShared(st.contentId);
  if (seq !== checkSeq) return; // 그 사이 다시 확인한 경우
  if (r === "found") {
    let count = st.sharedCount;
    if (!count) {
      // 저장소에는 있는데 페이지가 아직 못 받아온 경우 → 지금 받아오게 함
      const fresh = await send({ type: "reloadShared" });
      if (seq !== checkSeq) return;
      if (fresh) { showStatus(fresh); count = fresh.sharedCount; }
    }
    setShared("ok", count ? `올라가 있어요 · ${count.toLocaleString()}줄` : "올라가 있어요");
    $("viewLink").href = await ICS.fileUrl(st.contentId);
    $("viewLink").hidden = false;
    $("uploadLink").hidden = true;
  } else {
    setShared(r === "none" ? "no" : "err", r === "none" ? "아직 없어요" : "확인하지 못했어요");
    $("uploadLink").hidden = false;
  }
}

function setShared(cls, text) {
  $("sharedDot").className = "dot" + (cls ? " " + cls : "");
  $("sharedText").textContent = text;
}

const stripExt = (n) => n.replace(/\.(srt|vtt)$/i, "");

// ---------- 파일 불러오기 ----------
async function readFile(file) {
  if (!/\.(srt|vtt)$/i.test(file.name)) return toast("SRT 또는 VTT 파일만 불러올 수 있어요");
  const buf = await file.arrayBuffer();
  // UTF-8로 먼저 읽고, 깨지면 EUC-KR(CP949)로 다시 시도
  let text = new TextDecoder("utf-8").decode(buf);
  if (text.includes("�")) {
    try { text = new TextDecoder("euc-kr").decode(buf); } catch {}
  }
  if (!SRT.parseSRT(text).length) return toast("자막을 읽지 못했어요. 파일 형식을 확인해주세요");
  const st = await send({ type: "load", text, fileName: file.name });
  if (!st) return toast("강의 영상이 열린 탭에서 다시 시도해주세요");
  showStatus(st);
  toast(`자막 ${st.cueCount.toLocaleString()}개를 불러왔어요`);
}

// ---------- 보기 설정 ----------
function paintRange(el) {
  const p = ((el.value - el.min) / (el.max - el.min)) * 100;
  el.style.setProperty("--p", p + "%");
}

function paintPreview(s) {
  const t = $("previewText");
  // 실제 영상보다 작은 미리보기 창에 맞춰 축소해서 보여줌
  t.style.fontSize = Math.max(9, s.fontSize * 0.5) + "px";
  t.style.bottom = s.bottom + "%";
  t.style.background = `rgba(0,0,0,${s.bg})`;
  t.style.opacity = s.visible ? "1" : "0.25";
}

async function init() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  tabId = tab && tab.id;
  showStatus(tabId ? await send({ type: "status" }) : null);

  // 파일 선택
  $("pick").addEventListener("click", () => $("file").click());
  $("file").addEventListener("change", (e) => {
    if (e.target.files[0]) readFile(e.target.files[0]);
    e.target.value = "";
  });

  // 팝업 어디에 끌어놓아도 불러오기
  let depth = 0;
  document.addEventListener("dragenter", (e) => { e.preventDefault(); depth++; document.body.classList.add("dragging"); });
  document.addEventListener("dragleave", () => { if (--depth <= 0) { depth = 0; document.body.classList.remove("dragging"); } });
  document.addEventListener("dragover", (e) => e.preventDefault());
  document.addEventListener("drop", (e) => {
    e.preventDefault();
    depth = 0;
    document.body.classList.remove("dragging");
    const f = e.dataTransfer.files[0];
    if (f) readFile(f);
  });

  // 싱크
  document.querySelectorAll("button[data-d]").forEach((b) =>
    b.addEventListener("click", async () => {
      const st = await send({ type: "offset", delta: Number(b.dataset.d) });
      if (st) showStatus(st);
    })
  );
  $("reset").addEventListener("click", async () => {
    const st = await send({ type: "resetOffset" });
    if (st) { showStatus(st); toast("싱크를 처음대로 돌렸어요"); }
  });

  // 내 자막 삭제: 한 번 누르면 확인 상태, 3초 안에 한 번 더 누르면 삭제
  let armTimer = null;
  $("clear").addEventListener("click", async () => {
    const btn = $("clear");
    if (!btn.classList.contains("armed")) {
      btn.classList.add("armed");
      btn.textContent = "한 번 더 누르면 삭제";
      armTimer = setTimeout(() => { btn.classList.remove("armed"); btn.textContent = "내 자막 삭제"; }, 3000);
      return;
    }
    clearTimeout(armTimer);
    btn.classList.remove("armed");
    btn.textContent = "내 자막 삭제";
    const st = await send({ type: "clear" });
    showStatus(st);
    toast(st && st.cueCount ? "내 자막을 지우고 공유 자막으로 돌아왔어요" : "내 자막을 지웠어요");
  });

  // 관리자 모드: 로고를 5번 연속 클릭하면 켜지고 꺼짐
  adminOn = !!(await chrome.storage.local.get("admin")).admin;
  renderAdmin(true);
  let clicks = 0, clickTimer = null;
  $("title").addEventListener("click", async () => {
    clicks++;
    clearTimeout(clickTimer);
    clickTimer = setTimeout(() => (clicks = 0), 1500);
    if (clicks < 5) return;
    clicks = 0;
    adminOn = !adminOn;
    await chrome.storage.local.set({ admin: adminOn });
    renderAdmin(true);
    toast(adminOn ? "관리자 모드를 켰어요" : "관리자 모드를 껐어요");
  });

  $("recheck").addEventListener("click", () => checkShared());
  $("copyCid").addEventListener("click", async () => {
    if (!lastStatus) return;
    try {
      await navigator.clipboard.writeText(lastStatus.contentId);
      toast("콘텐츠 ID를 복사했어요");
    } catch {
      toast("복사하지 못했어요");
    }
  });

  // 공유용 암호화 파일 내보내기 (관리자 전용)
  $("export").addEventListener("click", async () => {
    const st = await send({ type: "export" });
    if (!st || !st.cues || !st.cues.length) return toast("내보낼 내 자막이 없어요");
    const name = await ICS.fileNameFor(st.contentId);
    const blob = new Blob([await ICS.encryptCues(st.contentId, st.cues)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = name;
    a.click();
    setTimeout(() => URL.revokeObjectURL(a.href), 5000);
    toast("받은 파일을 subs 폴더에 올려주세요");
  });

  // 표시 설정 (모든 강의 공통)
  const { settings: saved } = await chrome.storage.local.get("settings");
  const s = { ...DEFAULTS, ...(saved || {}) };
  const fmt = { fontSize: (v) => v + "px", bottom: (v) => v + "%", bg: (v) => Math.round(v * 100) + "%" };
  for (const k of ["fontSize", "bottom", "bg"]) {
    const el = $(k);
    el.value = s[k];
    $(k + "V").textContent = fmt[k](s[k]);
    paintRange(el);
    el.addEventListener("input", () => {
      s[k] = Number(el.value);
      $(k + "V").textContent = fmt[k](s[k]);
      paintRange(el);
      paintPreview(s);
      chrome.storage.local.set({ settings: s });
    });
  }
  $("visible").checked = s.visible;
  $("visible").addEventListener("change", () => {
    s.visible = $("visible").checked;
    paintPreview(s);
    chrome.storage.local.set({ settings: s });
  });
  paintPreview(s);

  // 플레이어에서 Shift+S로 바꾼 경우에도 스위치가 맞춰지도록
  chrome.storage.onChanged.addListener((c, area) => {
    if (area === "local" && c.settings && c.settings.newValue) {
      s.visible = c.settings.newValue.visible;
      $("visible").checked = s.visible;
      paintPreview(s);
    }
  });
}

init();
