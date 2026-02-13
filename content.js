(() => {
  if (globalThis.__imgdl_inited) return;
  globalThis.__imgdl_inited = true;

  const HIGHLIGHT_ATTR = "data-imgdl-highlight";
  const PICK_SELECTED_ATTR = "data-imgdl-picked";
  const PICK_HOVER_ATTR = "data-imgdl-hover";
  const OUTLINE_STYLE = "2px solid #d1242f";
  const OUTLINE_OFFSET = "2px";
  const HOVER_OUTLINE_STYLE = "2px solid #0969da";

  let pickModeEnabled = false;
  let currentSelector = "";
  let groupPickEnabled = true;
  const pickedUrlSet = new Set();
  const pickedImgSet = new Set();
  let hoverEl = null;

  function setHover(el) {
    if (hoverEl === el) return;
    if (hoverEl && hoverEl instanceof Element) {
      hoverEl.removeAttribute(PICK_HOVER_ATTR);
      hoverEl.style.outline = "";
      hoverEl.style.outlineOffset = "";
    }
    hoverEl = el;
    if (hoverEl && hoverEl instanceof Element) {
      hoverEl.setAttribute(PICK_HOVER_ATTR, "1");
      hoverEl.style.outline = HOVER_OUTLINE_STYLE;
      hoverEl.style.outlineOffset = OUTLINE_OFFSET;
    }
  }

  function clearHighlights() {
    const highlighted = document.querySelectorAll(`img[${HIGHLIGHT_ATTR}="1"]`);
    highlighted.forEach((img) => {
      img.removeAttribute(HIGHLIGHT_ATTR);
      img.style.outline = "";
      img.style.outlineOffset = "";
    });
  }

  function clearPicked() {
    pickedUrlSet.clear();
    pickedImgSet.forEach((img) => {
      if (!(img instanceof HTMLImageElement)) return;
      img.removeAttribute(PICK_SELECTED_ATTR);
      // Don't clobber selector highlight if present.
      if (img.getAttribute(HIGHLIGHT_ATTR) === "1") {
        img.style.outline = OUTLINE_STYLE;
        img.style.outlineOffset = OUTLINE_OFFSET;
      } else {
        img.style.outline = "";
        img.style.outlineOffset = "";
      }
    });
    pickedImgSet.clear();
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

  function collectImgsFromElement(el) {
    if (el instanceof HTMLImageElement) return [el];
    if (!(el instanceof Element)) return [];
    return Array.from(el.querySelectorAll("img"));
  }

  function safeSendMessage(message) {
    try {
      // If the extension was reloaded/updated, this context becomes invalid.
      if (!chrome?.runtime?.id) return;
      chrome.runtime.sendMessage(message, () => {
        // No receiver / context issues show up here; swallow them.
        void chrome.runtime.lastError;
      });
    } catch {
      // Extension context invalidated (e.g. after reload). Ignore.
    }
  }

  function emitSelectionUpdated() {
    safeSendMessage({
      type: "SELECTION_UPDATED",
      count: pickedUrlSet.size,
      urls: Array.from(pickedUrlSet),
    });
  }

  function pickFromElement(el) {
    const imgs = collectImgsFromElement(el);
    for (const img of imgs) {
      if (!(img instanceof HTMLImageElement)) continue;
      const url = getImageUrl(img);
      if (url) pickedUrlSet.add(url);
      pickedImgSet.add(img);
      img.setAttribute(PICK_SELECTED_ATTR, "1");
      // picked highlight: red dashed (same as selector highlight)
      img.style.outline = OUTLINE_STYLE;
      img.style.outlineOffset = OUTLINE_OFFSET;
    }
    emitSelectionUpdated();
    return imgs.length;
  }

  function onPointerOver(ev) {
    if (!pickModeEnabled) return;
    const t = ev.target;
    if (!(t instanceof Element)) return;
    setHover(t);
  }

  function onPointerOut() {
    if (!pickModeEnabled) return;
    setHover(null);
  }

  function onClickCapture(ev) {
    if (!pickModeEnabled) return;
    if (ev.button !== 0) return; // left click only

    const t = ev.target;
    if (!(t instanceof Element)) return;

    // prevent navigation / page handlers while picking
    ev.preventDefault();
    ev.stopPropagation();

    let targetEl = t;
    if (groupPickEnabled) {
      const group = findBestGroupContainer(t);
      if (group) targetEl = group;
    }
    pickFromElement(targetEl);
  }

  function findBestGroupContainer(startEl) {
    const MAX_DEPTH = 12;
    const MAX_GROUP_IMGS = 50;
    const viewportArea = Math.max(1, window.innerWidth * window.innerHeight);

    const keywordRe = /(swiper|slick|carousel|slider|gallery)/i;

    let best = null;
    let bestKeyword = null;

    let el = startEl;
    for (let depth = 0; depth < MAX_DEPTH; depth++) {
      if (!(el instanceof Element)) break;
      if (el === document.body || el === document.documentElement) break;

      const imgs = el.querySelectorAll("img");
      const imgCount = imgs.length;
      if (imgCount >= 2 && imgCount <= MAX_GROUP_IMGS) {
        const rect = el.getBoundingClientRect();
        const area = Math.max(0, rect.width) * Math.max(0, rect.height);
        const areaRatio = area / viewportArea;
        if (areaRatio <= 0.9) {
          // nearest acceptable container
          if (!best) best = el;
          const hint = `${el.id || ""} ${el.className || ""}`;
          if (!bestKeyword && keywordRe.test(hint)) {
            bestKeyword = el;
          }
        }
      }

      el = el.parentElement;
      if (!el) break;
    }

    return bestKeyword || best;
  }

  function startPickMode() {
    if (pickModeEnabled) return;
    pickModeEnabled = true;
    document.addEventListener("pointerover", onPointerOver, true);
    document.addEventListener("pointerout", onPointerOut, true);
    document.addEventListener("click", onClickCapture, true);
    emitSelectionUpdated();
  }

  function stopPickMode() {
    if (!pickModeEnabled) return;
    pickModeEnabled = false;
    document.removeEventListener("pointerover", onPointerOver, true);
    document.removeEventListener("pointerout", onPointerOut, true);
    document.removeEventListener("click", onClickCapture, true);
    setHover(null);
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
    if (msg?.type === "START_PICK_MODE") {
      currentSelector = String(msg.selector || "").trim();
      startPickMode();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "STOP_PICK_MODE") {
      stopPickMode();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "CLEAR_SELECTION") {
      clearPicked();
      emitSelectionUpdated();
      sendResponse({ ok: true });
      return;
    }
    if (msg?.type === "GET_SELECTION") {
      sendResponse({ ok: true, count: pickedUrlSet.size, urls: Array.from(pickedUrlSet) });
      return;
    }
    if (msg?.type === "SET_PICK_OPTIONS") {
      groupPickEnabled = Boolean(msg.groupPickEnabled);
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

