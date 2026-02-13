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

let lastUrls = [];
let pickMode = false;
let groupPickEnabled = true;

function setPickMode(isOn) {
  pickMode = isOn;
  const btnPick = document.getElementById("btnPick");
  const btnStop = document.getElementById("btnStop");
  btnPick.disabled = isOn;
  btnStop.disabled = !isOn;
}

async function downloadZip() {
  // pull latest selection from content script (source of truth)
  const tab = await getActiveTab();
  await ensureContentScript(tab);
  const sel = await chrome.tabs.sendMessage(tab.id, { type: "GET_SELECTION" });
  if (!sel?.ok) throw new Error(sel?.error || "获取已选失败");
  lastUrls = Array.isArray(sel.urls) ? sel.urls : [];
  setCount(lastUrls.length);
  if (!lastUrls.length) throw new Error("没有已选图片，请先进入选择模式并点击页面元素");

  setStatus("正在打包并触发下载…");
  const res = await chrome.runtime.sendMessage({
    type: "DOWNLOAD_ZIP",
    urls: lastUrls,
  });
  if (!res?.ok) throw new Error(res?.error || "下载失败");
  setStatus("已开始下载 zip（请查看浏览器下载栏）", "ok");
}

function setBusy(isBusy) {
  const btnDownload = document.getElementById("btnDownload");
  const btnPick = document.getElementById("btnPick");
  const btnStop = document.getElementById("btnStop");
  const btnClear = document.getElementById("btnClear");
  const toggleGroupPick = document.getElementById("toggleGroupPick");
  btnDownload.disabled = isBusy;
  btnPick.disabled = isBusy || pickMode;
  btnStop.disabled = isBusy || !pickMode;
  btnClear.disabled = isBusy;
  toggleGroupPick.disabled = isBusy;
}

async function setPickOptionsOnPage(tab, opts) {
  const res = await chrome.tabs.sendMessage(tab.id, {
    type: "SET_PICK_OPTIONS",
    ...opts,
  });
  if (!res?.ok) throw new Error(res?.error || "设置选项失败");
}

async function resetToInitialState({ silent = false } = {}) {
  // Reset UI state
  lastUrls = [];
  setCount(0);
  setPickMode(false);
  groupPickEnabled = true;
  const toggleGroupPick = document.getElementById("toggleGroupPick");
  if (toggleGroupPick) toggleGroupPick.checked = true;

  // Reset page state (best-effort)
  try {
    const tab = await getActiveTab();
    await ensureContentScript(tab);
    await setPickOptionsOnPage(tab, { groupPickEnabled: true });
    await chrome.tabs.sendMessage(tab.id, { type: "STOP_PICK_MODE" });
    await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" });
  } catch (e) {
    if (!silent) setStatus(String(e?.message || e), "error");
    return;
  }

  if (!silent) setStatus("已重置为初始状态", "ok");
}

document.addEventListener("DOMContentLoaded", () => {
  const btnDownload = document.getElementById("btnDownload");
  const btnPick = document.getElementById("btnPick");
  const btnStop = document.getElementById("btnStop");
  const btnClear = document.getElementById("btnClear");
  const toggleGroupPick = document.getElementById("toggleGroupPick");

  setCount(0);
  setStatus("");
  setPickMode(false);
  toggleGroupPick.checked = true;

  // Each time the panel is opened (hidden -> visible), reset to initial state.
  let wasHidden = document.hidden;
  document.addEventListener("visibilitychange", () => {
    if (document.hidden) {
      wasHidden = true;
      return;
    }
    if (wasHidden) {
      wasHidden = false;
      // silent reset to avoid spammy status on every open
      resetToInitialState({ silent: true });
    }
  });

  // Initial open/reset.
  resetToInitialState({ silent: true });

  chrome.runtime.onMessage.addListener(async (msg, sender) => {
    if (msg?.type !== "SELECTION_UPDATED") return;
    // only accept updates from the currently active tab
    try {
      const tab = await getActiveTab();
      if (sender?.tab?.id !== tab.id) return;
    } catch {
      return;
    }
    lastUrls = Array.isArray(msg.urls) ? msg.urls : [];
    setCount(msg.count ?? lastUrls.length);
  });

  btnPick.addEventListener("click", async () => {
    setBusy(true);
    setStatus("");
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      await setPickOptionsOnPage(tab, { groupPickEnabled });
      const res = await chrome.tabs.sendMessage(tab.id, { type: "START_PICK_MODE" });
      if (!res?.ok) throw new Error(res?.error || "进入选择模式失败");
      setPickMode(true);
      setStatus("选择模式已开启：请在网页中点击元素选择图片", "ok");
    } catch (e) {
      setStatus(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  });

  toggleGroupPick.addEventListener("change", async () => {
    setBusy(true);
    setStatus("");
    const prev = groupPickEnabled;
    try {
      groupPickEnabled = Boolean(toggleGroupPick.checked);
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      await setPickOptionsOnPage(tab, { groupPickEnabled });
      setStatus(
        groupPickEnabled ? "已开启按组选择：点击轮播/图集可一次选中多张" : "已关闭按组选择",
        "ok"
      );
    } catch (e) {
      // revert UI on failure
      groupPickEnabled = prev;
      toggleGroupPick.checked = prev;
      setStatus(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  });

  btnStop.addEventListener("click", async () => {
    setBusy(true);
    setStatus("");
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      const res = await chrome.tabs.sendMessage(tab.id, { type: "STOP_PICK_MODE" });
      if (!res?.ok) throw new Error(res?.error || "退出选择模式失败");
      setPickMode(false);
      setStatus("选择模式已关闭", "ok");
    } catch (e) {
      setStatus(String(e?.message || e), "error");
    } finally {
      setBusy(false);
    }
  });

  btnClear.addEventListener("click", async () => {
    setBusy(true);
    setStatus("");
    try {
      const tab = await getActiveTab();
      await ensureContentScript(tab);
      const res = await chrome.tabs.sendMessage(tab.id, { type: "CLEAR_SELECTION" });
      if (!res?.ok) throw new Error(res?.error || "清空失败");
      lastUrls = [];
      setCount(0);
      setStatus(
        pickMode
          ? "已清空已选：请继续在网页中点击元素选择图片"
          : "已清空已选：点击“进入选择模式”后在网页中点击元素选择图片",
        "ok"
      );
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
});

