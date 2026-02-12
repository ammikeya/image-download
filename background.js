/* global chrome */

const blobUrlByDownloadId = new Map();

let creatingOffscreen = null;

async function setupOffscreenDocument(path) {
  const offscreenUrl = chrome.runtime.getURL(path);

  if ("getContexts" in chrome.runtime) {
    const contexts = await chrome.runtime.getContexts({
      contextTypes: ["OFFSCREEN_DOCUMENT"],
      documentUrls: [offscreenUrl],
    });
    if (contexts.length) return;
  }

  // Fallback for older Chrome: best-effort check via clients.matchAll().
  // Note: In MV3 service worker, clients is available.
  if (!("getContexts" in chrome.runtime)) {
    const matched = await clients.matchAll();
    const has = matched.some((c) => c.url === offscreenUrl);
    if (has) return;
  }

  if (creatingOffscreen) {
    await creatingOffscreen;
    return;
  }
  creatingOffscreen = chrome.offscreen.createDocument({
    url: path,
    reasons: ["BLOBS"],
    justification: "Create blob URLs for zip downloads in MV3 service worker.",
  });
  await creatingOffscreen;
  creatingOffscreen = null;
}

async function buildZipUrlInOffscreen(urls) {
  await setupOffscreenDocument("offscreen.html");
  const res = await chrome.runtime.sendMessage({
    target: "offscreen",
    type: "BUILD_ZIP_URL",
    urls,
  });
  if (!res?.ok || !res?.url) throw new Error(res?.error || "生成 zip 失败");
  return res;
}

async function revokeBlobUrlInOffscreen(url) {
  try {
    await chrome.runtime.sendMessage({
      target: "offscreen",
      type: "REVOKE_BLOB_URL",
      url,
    });
  } catch {
    // ignore
  }
}

chrome.downloads.onChanged.addListener((delta) => {
  if (!delta?.id) return;
  const url = blobUrlByDownloadId.get(delta.id);
  if (!url) return;
  if (delta.state?.current === "complete" || delta.error?.current) {
    blobUrlByDownloadId.delete(delta.id);
    revokeBlobUrlInOffscreen(url);
  }
});

// Open side panel when user clicks the extension icon.
chrome.runtime.onInstalled.addListener(() => {
  // Newer Chrome: let the browser open side panel on action click.
  if (chrome.sidePanel?.setPanelBehavior) {
    chrome.sidePanel.setPanelBehavior({ openPanelOnActionClick: true });
  }
});

chrome.action.onClicked.addListener(async (tab) => {
  try {
    if (!tab?.id) return;
    if (chrome.sidePanel?.setOptions) {
      await chrome.sidePanel.setOptions({
        tabId: tab.id,
        path: "sidepanel.html",
        enabled: true,
      });
    }
    if (chrome.sidePanel?.open) {
      await chrome.sidePanel.open({ tabId: tab.id });
    }
  } catch {
    // ignore
  }
});

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.type !== "DOWNLOAD_ZIP") return;

  (async () => {
    const urls = Array.isArray(msg.urls) ? msg.urls : [];
    if (!urls.length) throw new Error("urls 不能为空");
    const res = await buildZipUrlInOffscreen(urls);
    const blobUrl = res.url;
    const filename = res.filename || "images.zip";

    await new Promise((resolve, reject) => {
      chrome.downloads.download(
        { url: blobUrl, filename, saveAs: true },
        (downloadId) => {
          const err = chrome.runtime.lastError;
          if (err || !downloadId) {
            revokeBlobUrlInOffscreen(blobUrl);
            reject(new Error(err?.message || "下载失败"));
            return;
          }
          blobUrlByDownloadId.set(downloadId, blobUrl);
          resolve(downloadId);
        }
      );
    });

    sendResponse({ ok: true, count: res.count, failed: res.failed });
  })().catch((e) => {
    sendResponse({ ok: false, error: String(e?.message || e) });
  });

  return true; // keep SW alive for async sendResponse
});

