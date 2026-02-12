(() => {
  if (globalThis.__imgdl_inited) return;
  globalThis.__imgdl_inited = true;

  const HIGHLIGHT_ATTR = "data-imgdl-highlight";
  const OUTLINE_STYLE = "3px dashed #d1242f";
  const OUTLINE_OFFSET = "2px";

  function clearHighlights() {
    const highlighted = document.querySelectorAll(`img[${HIGHLIGHT_ATTR}="1"]`);
    highlighted.forEach((img) => {
      img.removeAttribute(HIGHLIGHT_ATTR);
      img.style.outline = "";
      img.style.outlineOffset = "";
    });
  }

  function getImageUrl(img) {
    const src = img.currentSrc || img.src || "";
    if (!src) return "";
    try {
      return new URL(src, document.baseURI).toString();
    } catch {
      return src;
    }
  }

  function highlightImages(selector) {
    clearHighlights();

    let nodes;
    try {
      nodes = document.querySelectorAll(selector);
    } catch (e) {
      return { ok: false, error: "CSS 选择器语法错误" };
    }

    // 支持两种情况：
    // 1) selector 直接命中 <img>
    // 2) selector 命中容器元素（如 .gallery），则遍历其后代的所有 <img>
    const imgSet = new Set();
    for (const n of Array.from(nodes)) {
      if (n instanceof HTMLImageElement) {
        imgSet.add(n);
        continue;
      }
      if (n instanceof Element) {
        n.querySelectorAll("img").forEach((img) => imgSet.add(img));
      }
    }
    const imgs = Array.from(imgSet);
    const urls = [];
    const seen = new Set();

    for (const img of imgs) {
      img.setAttribute(HIGHLIGHT_ATTR, "1");
      img.style.outline = OUTLINE_STYLE;
      img.style.outlineOffset = OUTLINE_OFFSET;

      const url = getImageUrl(img);
      if (url && !seen.has(url)) {
        seen.add(url);
        urls.push(url);
      }
    }

    return { ok: true, count: imgs.length, urls };
  }

  chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
    if (msg?.type === "PING") {
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "HIGHLIGHT_IMAGES") {
      const selector = String(msg.selector || "").trim();
      if (!selector) {
        sendResponse({ ok: false, error: "请选择器不能为空" });
        return;
      }
      sendResponse(highlightImages(selector));
      return;
    }
    if (msg?.type === "CLEAR_HIGHLIGHT") {
      clearHighlights();
      sendResponse({ ok: true });
    }
  });
})();

