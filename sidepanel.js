let lastUrls = [];

function setStatus(text, kind = "") {
  const el = document.getElementById("status");
  el.textContent = text || "";
  el.className = `status${kind ? " " + kind : ""}`;
}

function setCount(n) {
  document.getElementById("count").textContent = String(n ?? 0);
}

async function getActiveTab() {
  const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
  if (!tab?.id) throw new Error("未找到当前标签页");
  return tab;
}

function isRestrictedUrl(url) {
  return (
    !url ||
    url.startsWith("chrome://") ||
    url.startsWith("chrome-extension://") ||
    url.startsWith("edge://") ||
    url.startsWith("about:") ||
    url.startsWith("view-source:")
  );
}

async function ensureContentScript(tab) {
  if (isRestrictedUrl(tab.url)) {
    throw new Error("当前页面不支持（例如 chrome:// 或浏览器内置页面），请切换到普通网页再试");
  }

  // First try ping (fast path).
  try {
    const pong = await chrome.tabs.sendMessage(tab.id, { type: "PING" });
    if (pong?.ok) return;
  } catch {
    // ignore and try inject
  }

  try {
    await chrome.scripting.executeScript({
      target: { tabId: tab.id },
      files: ["content.js"],
    });
  } catch {
    throw new Error(
      "无法在当前页面注入脚本（可能是受限页面或权限不足）。请刷新页面后重试，或换一个普通网页"
    );
  }
}

async function highlight(selector) {
  const tab = await getActiveTab();
  await ensureContentScript(tab);
  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "HIGHLIGHT_IMAGES",
    selector,
  });
  if (!res?.ok) throw new Error(res?.error || "高亮失败");

  lastUrls = Array.isArray(res.urls) ? res.urls : [];
  setCount(lastUrls.length);
  setStatus(`已高亮：${lastUrls.length} 张图片`, "ok");
}

async function downloadZip() {
  if (!lastUrls.length) {
    throw new Error("没有可下载的图片，请先高亮或确认选择器是否匹配");
  }
  setStatus("正在打包并触发下载…");
  const res = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_ZIP",
    urls: lastUrls,
  });
  if (!res?.ok) throw new Error(res?.error || "下载失败");
  setStatus("已开始下载 zip（请查看浏览器下载栏）", "ok");
}

function normalizeSelector(s) {
  return (s || "").trim();
}

function setBusy(isBusy) {
  const btnHighlight = document.getElementById("btnHighlight");
  const btnDownload = document.getElementById("btnDownload");
  btnHighlight.disabled = isBusy;
  btnDownload.disabled = isBusy;
}

document.addEventListener("DOMContentLoaded", () => {
  const input = document.getElementById("selector");
  const btnHighlight = document.getElementById("btnHighlight");
  const btnDownload = document.getElementById("btnDownload");

  setCount(0);
  setStatus("");

  btnHighlight.addEventListener("click", async () => {
    setBusy(true);
    setStatus("");
    try {
      const selector = normalizeSelector(input.value);
      if (!selector) throw new Error("请输入 CSS 选择器");
      await highlight(selector);
    } catch (e) {
      setStatus(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  });

  btnDownload.addEventListener("click", async () => {
    setBusy(true);
    setStatus("");
    try {
      await downloadZip();
    } catch (e) {
      setStatus(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  });

  input.addEventListener("keydown", (e) => {
    if (e.key === "Enter") btnHighlight.click();
  });
});

