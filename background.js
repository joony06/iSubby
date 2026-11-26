// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// 플레이어 프레임(아캠 안)에서는 새 창·클립보드가 막혀 있어서, 메일 쓰기 창은 여기서 엶.
chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg && msg.type === "openMail" && typeof msg.url === "string" && msg.url.startsWith("mailto:")) {
    chrome.tabs.create({ url: msg.url, active: true }).then(() => sendResponse({ ok: true }), () => sendResponse({ ok: false }));
    return true;
  }
});
