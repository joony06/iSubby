// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// 아캠 "강의콘텐츠" 페이지가 스스로 불러오는 강의 목록을 iSubby 관리자 기능에 전달합니다.
// 페이지 쪽(MAIN world)에서 실행되며, 새 요청을 보내거나 로그인 정보를 읽지 않습니다.
// 페이지가 이미 받은 응답에서 강의 제목·주차·콘텐츠 ID만 골라 같은 페이지의 iSubby 스크립트에 넘깁니다.
(() => {
  const RE = /\/learningx\/api\/v1\/courses\/(\d+)\/modules(\?|$)/;

  function handle(url, text) {
    const m = RE.exec(url);
    if (!m) return;
    let data;
    try { data = JSON.parse(text); } catch { return; }
    if (!Array.isArray(data)) return;
    const items = [];
    for (const mod of data) {
      for (const it of mod.module_items || []) {
        const cd = it.content_data && it.content_data.item_content_data;
        if (!cd || !cd.content_id) continue;
        items.push({
          moduleItemId: it.module_item_id,
          title: it.title,
          week: mod.title,
          weekPos: mod.position,
          contentId: cd.content_id,
        });
      }
    }
    if (!items.length) return;
    document.documentElement.dataset.isubbyModules = JSON.stringify({ courseId: m[1], items });
    document.dispatchEvent(new CustomEvent("isubby-modules"));
  }

  const origFetch = window.fetch;
  window.fetch = async function (input) {
    const res = await origFetch.apply(this, arguments);
    try {
      const url = typeof input === "string" ? input : input && input.url;
      if (url && RE.test(url)) res.clone().text().then((t) => handle(url, t)).catch(() => {});
    } catch {}
    return res;
  };

  const origOpen = XMLHttpRequest.prototype.open;
  XMLHttpRequest.prototype.open = function (method, url) {
    this.__isubbyUrl = String(url);
    return origOpen.apply(this, arguments);
  };
  const origSend = XMLHttpRequest.prototype.send;
  XMLHttpRequest.prototype.send = function () {
    if (this.__isubbyUrl && RE.test(this.__isubbyUrl)) {
      this.addEventListener("load", () => {
        try {
          if (this.responseType === "" || this.responseType === "text") handle(this.__isubbyUrl, this.responseText);
          else if (this.responseType === "json") handle(this.__isubbyUrl, JSON.stringify(this.response));
        } catch {}
      });
    }
    return origSend.apply(this, arguments);
  };
})();
