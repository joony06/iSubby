// iSubby — Copyright (c) 2026 AePhroDeChi. MIT License.
// iSubby 공유 자막: 콘텐츠 ID 기반 파일명 해시 + AES-GCM 암호화
// 주의: 아래 "icamsub:" 접두어는 이미 올린 자막 파일과 호환되도록 바꾸지 마세요.
(function (global) {
  // ▼ 자막 저장소 주소
  const REPO = "joony06/iSubby";
  const SUBS_BASE = `https://raw.githubusercontent.com/${REPO}/main/subs/`;

  const enc = new TextEncoder();
  const dec = new TextDecoder();

  async function sha256(text) {
    return new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(text)));
  }
  const hex = (b) => [...b].map((x) => x.toString(16).padStart(2, "0")).join("");
  const b64 = (b) => btoa(String.fromCharCode(...b));
  const unb64 = (s) => Uint8Array.from(atob(s), (c) => c.charCodeAt(0));

  // 저장소에 올라갈 파일명 (콘텐츠 ID를 몰라서는 어떤 강의인지 알 수 없음)
  async function fileNameFor(contentId) {
    return hex(await sha256("icamsub:name:" + contentId)).slice(0, 32) + ".json";
  }

  async function keyFor(contentId) {
    return keyFrom("icamsub:key:" + contentId);
  }
  async function keyFrom(seed) {
    return crypto.subtle.importKey("raw", await sha256(seed), "AES-GCM", false, ["encrypt", "decrypt"]);
  }

  // 분반 자동 연결: 같은 녹화본은 분반이 달라도 제목과 영상 길이가 같음.
  // "제목|길이(0.1초)"로 파일명과 키를 만들어, 그 영상을 가진 사람만 찾고 열 수 있게 함.
  const fpSeed = (title, duration) => String(title || "").trim().toLowerCase().replace(/\s+/g, " ") + "|" + (Number(duration) || 0).toFixed(1);
  async function fpFileName(title, duration) {
    return hex(await sha256("icamsub:fp:" + fpSeed(title, duration))).slice(0, 32) + ".json";
  }

  // 콘텐츠 ID로 만든 키로 JSON 객체를 암호화/복호화
  async function encryptJSON(contentId, obj, key) {
    const iv = crypto.getRandomValues(new Uint8Array(12));
    const data = await crypto.subtle.encrypt(
      { name: "AES-GCM", iv },
      key || (await keyFor(contentId)),
      enc.encode(JSON.stringify(obj))
    );
    // b64 변환 시 큰 배열로 인한 스택 초과 방지
    const bytes = new Uint8Array(data);
    let s = "";
    for (let i = 0; i < bytes.length; i += 0x8000) s += String.fromCharCode(...bytes.subarray(i, i + 0x8000));
    return JSON.stringify({ v: 1, iv: b64(iv), data: btoa(s) });
  }

  async function decryptJSON(contentId, json, key) {
    const { iv, data } = JSON.parse(json);
    const plain = await crypto.subtle.decrypt(
      { name: "AES-GCM", iv: unb64(iv) },
      key || (await keyFor(contentId)),
      unb64(data)
    );
    return JSON.parse(dec.decode(plain));
  }

  // 자막 파일: { cues }
  const encryptCues = (contentId, cues) => encryptJSON(contentId, { cues });
  const decryptCues = async (contentId, json) => (await decryptJSON(contentId, json)).cues;

  // 분반 연결 파일: 같은 녹화본인데 분반마다 콘텐츠 ID가 다른 영상을 원래 자막에 연결.
  // 이 영상의 ID로 암호화돼 있어서 그 분반 수강생만 열 수 있고, 열면 원래 영상의 ID가 나옴.
  const encryptAlias = (aliasId, targetId) => encryptJSON(aliasId, { alias: targetId });

  // 공유 자막 조회. 없으면 null. 연결 파일이면 원래 자막을 한 번 따라가서 가져옴
  async function fetchShared(contentId, hop = 0) {
    if (SUBS_BASE.includes("YOUR_GITHUB_ID")) return null;
    try {
      const res = await fetch(SUBS_BASE + (await fileNameFor(contentId)), { cache: "no-cache" });
      if (!res.ok) return null;
      const obj = await decryptJSON(contentId, await res.text());
      if (obj.alias && hop === 0 && obj.alias !== contentId) return await fetchShared(obj.alias, 1);
      return Array.isArray(obj.cues) ? obj.cues : null;
    } catch {
      return null;
    }
  }

  // 분반 자동 연결 파일 만들기: { name, data }
  async function makeFingerprint(title, duration, targetId) {
    const key = await keyFrom("icamsub:fpkey:" + fpSeed(title, duration));
    return { name: await fpFileName(title, duration), data: await encryptJSON(null, { alias: targetId }, key) };
  }

  // 자기 영상 ID로 된 자막이 없을 때, 제목·길이가 같은 다른 분반 영상의 자막을 찾아옴
  async function fetchByFingerprint(title, duration) {
    if (!title || !duration) return null;
    try {
      const res = await fetch(SUBS_BASE + (await fpFileName(title, duration)), { cache: "no-cache" });
      if (!res.ok) return null;
      const key = await keyFrom("icamsub:fpkey:" + fpSeed(title, duration));
      const obj = await decryptJSON(null, await res.text(), key);
      return obj.alias ? await fetchShared(obj.alias, 1) : null;
    } catch {
      return null;
    }
  }

  async function headExists(name) {
    try {
      const res = await fetch(SUBS_BASE + name, { method: "HEAD", cache: "no-cache" });
      if (res.ok) return "found";
      if (res.status === 404) return "none";
      return "error";
    } catch {
      return "error";
    }
  }
  const checkFingerprint = async (title, duration) => headExists(await fpFileName(title, duration));

  // 관리자용: 공유 자막이 저장소에 올라가 있는지 확인 → "found" | "none" | "error"
  async function checkShared(contentId) {
    try {
      const res = await fetch(SUBS_BASE + (await fileNameFor(contentId)), { method: "HEAD", cache: "no-cache" });
      if (res.ok) return "found";
      if (res.status === 404) return "none";
      return "error";
    } catch {
      return "error";
    }
  }

  const uploadUrl = () => `https://github.com/${REPO}/upload/main/subs`;
  const fileUrl = async (contentId) => `https://github.com/${REPO}/blob/main/subs/${await fileNameFor(contentId)}`;

  global.ICS = { fileNameFor, encryptCues, decryptCues, encryptAlias, fetchShared, checkShared,
    makeFingerprint, fetchByFingerprint, checkFingerprint, uploadUrl, fileUrl };
})(typeof window !== "undefined" ? window : globalThis);
