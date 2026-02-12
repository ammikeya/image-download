/* global chrome */

const urlStore = new Set();
const encoder = new TextEncoder();

function makeCrc32Table() {
  const table = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = (c & 1) ? (0xedb88320 ^ (c >>> 1)) : (c >>> 1);
    }
    table[i] = c >>> 0;
  }
  return table;
}

const CRC32_TABLE = makeCrc32Table();

function crc32(bytes) {
  let c = 0xffffffff;
  for (let i = 0; i < bytes.length; i++) {
    c = CRC32_TABLE[(c ^ bytes[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

function u16(view, off, val) {
  view.setUint16(off, val & 0xffff, true);
}

function u32(view, off, val) {
  view.setUint32(off, val >>> 0, true);
}

function sanitizeFilename(name) {
  return name.replace(/[\\/:*?"<>|]+/g, "_").replace(/\s+/g, " ").trim();
}

function extFromContentType(ct) {
  const t = (ct || "").split(";")[0].trim().toLowerCase();
  if (t === "image/jpeg") return "jpg";
  if (t === "image/png") return "png";
  if (t === "image/gif") return "gif";
  if (t === "image/webp") return "webp";
  if (t === "image/svg+xml") return "svg";
  if (t === "image/avif") return "avif";
  if (t === "image/bmp") return "bmp";
  return "";
}

function guessFilename(urlStr, index, contentType) {
  const fallbackBase = `image_${String(index + 1).padStart(3, "0")}`;
  let base = fallbackBase;
  let ext = extFromContentType(contentType);

  try {
    const u = new URL(urlStr);
    const pathname = u.pathname || "";
    const last = pathname.split("/").filter(Boolean).pop() || "";
    if (last) base = sanitizeFilename(decodeURIComponent(last));
  } catch {
    // ignore
  }

  if (/\.[a-z0-9]{2,5}$/i.test(base)) return base;
  if (!ext) ext = "bin";
  return `${base}.${ext}`;
}

function uniqueName(name, used) {
  if (!used.has(name)) {
    used.add(name);
    return name;
  }
  const dot = name.lastIndexOf(".");
  const stem = dot >= 0 ? name.slice(0, dot) : name;
  const ext = dot >= 0 ? name.slice(dot) : "";
  for (let i = 2; i < 10000; i++) {
    const candidate = `${stem} (${i})${ext}`;
    if (!used.has(candidate)) {
      used.add(candidate);
      return candidate;
    }
  }
  const candidate = `${stem}_${Date.now()}${ext}`;
  used.add(candidate);
  return candidate;
}

function dataUrlToBytes(dataUrl) {
  const m = /^data:([^,]*?),(.*)$/i.exec(dataUrl);
  if (!m) throw new Error("Invalid data URL");
  const meta = m[1] || "";
  const data = m[2] || "";
  const isBase64 = /;base64/i.test(meta);
  const contentType = meta.split(";")[0] || "";
  if (isBase64) {
    const binary = atob(data);
    const bytes = new Uint8Array(binary.length);
    for (let i = 0; i < binary.length; i++) bytes[i] = binary.charCodeAt(i);
    return { bytes, contentType };
  }
  const text = decodeURIComponent(data.replace(/\+/g, "%20"));
  return { bytes: encoder.encode(text), contentType };
}

async function fetchAsBytes(url) {
  if (url.startsWith("data:")) {
    return dataUrlToBytes(url);
  }
  const res = await fetch(url, { credentials: "include" });
  if (!res.ok) throw new Error(`HTTP ${res.status}`);
  const contentType = res.headers.get("content-type") || "";
  const buf = await res.arrayBuffer();
  return { bytes: new Uint8Array(buf), contentType };
}

function buildZip(files) {
  const localParts = [];
  const centralParts = [];
  let offset = 0;

  for (const f of files) {
    const nameBytes = encoder.encode(f.name);
    const dataBytes = f.bytes;
    const crc = crc32(dataBytes);

    const local = new Uint8Array(30 + nameBytes.length);
    const lv = new DataView(local.buffer);
    u32(lv, 0, 0x04034b50);
    u16(lv, 4, 20);
    u16(lv, 6, 0);
    u16(lv, 8, 0);
    u16(lv, 10, 0);
    u16(lv, 12, 0);
    u32(lv, 14, crc);
    u32(lv, 18, dataBytes.length);
    u32(lv, 22, dataBytes.length);
    u16(lv, 26, nameBytes.length);
    u16(lv, 28, 0);
    local.set(nameBytes, 30);

    const localOffset = offset;
    localParts.push(local, dataBytes);
    offset += local.length + dataBytes.length;

    const central = new Uint8Array(46 + nameBytes.length);
    const cv = new DataView(central.buffer);
    u32(cv, 0, 0x02014b50);
    u16(cv, 4, 20);
    u16(cv, 6, 20);
    u16(cv, 8, 0);
    u16(cv, 10, 0);
    u16(cv, 12, 0);
    u16(cv, 14, 0);
    u32(cv, 16, crc);
    u32(cv, 20, dataBytes.length);
    u32(cv, 24, dataBytes.length);
    u16(cv, 28, nameBytes.length);
    u16(cv, 30, 0);
    u16(cv, 32, 0);
    u16(cv, 34, 0);
    u16(cv, 36, 0);
    u32(cv, 38, 0);
    u32(cv, 42, localOffset);
    central.set(nameBytes, 46);
    centralParts.push(central);
  }

  const centralOffset = offset;
  let centralSize = 0;
  for (const c of centralParts) centralSize += c.length;

  const end = new Uint8Array(22);
  const ev = new DataView(end.buffer);
  u32(ev, 0, 0x06054b50);
  u16(ev, 4, 0);
  u16(ev, 6, 0);
  u16(ev, 8, files.length);
  u16(ev, 10, files.length);
  u32(ev, 12, centralSize);
  u32(ev, 16, centralOffset);
  u16(ev, 20, 0);

  return new Blob([...localParts, ...centralParts, end], {
    type: "application/zip",
  });
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (msg?.target !== "offscreen") return;

  if (msg?.type === "BUILD_ZIP_URL") {
    try {
      const urls = Array.isArray(msg.urls) ? msg.urls : [];
      if (!urls.length) throw new Error("urls 不能为空");

      (async () => {
        const usedNames = new Set();
        const files = [];
        const failed = [];

        for (let i = 0; i < urls.length; i++) {
          const url = String(urls[i] || "").trim();
          if (!url) continue;
          try {
            const { bytes, contentType } = await fetchAsBytes(url);
            let name = guessFilename(url, i, contentType);
            name = uniqueName(name, usedNames);
            files.push({ name, bytes });
          } catch (e) {
            failed.push(`${url}\t${String(e?.message || e)}`);
          }
        }

        if (!files.length) {
          const detail = failed.slice(0, 5).join("\n");
          throw new Error(`抓取失败：0/${urls.length}\n${detail}`);
        }

        if (failed.length) {
          const txt = `Failed: ${failed.length}/${urls.length}\n\n` + failed.join("\n");
          files.push({
            name: "__failed.txt",
            bytes: encoder.encode(txt),
          });
        }

        const zipBlob = buildZip(files);
        const url = URL.createObjectURL(zipBlob);
        urlStore.add(url);

        const filename = `images_${new Date()
          .toISOString()
          .replace(/[:.]/g, "-")}.zip`;

        sendResponse({
          ok: true,
          url,
          filename,
          count: files.length,
          failed: failed.length,
        });
      })().catch((e) => {
        sendResponse({ ok: false, error: String(e?.message || e) });
      });
      return true;
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
      return;
    }
  }

  if (msg?.type === "REVOKE_BLOB_URL") {
    try {
      const url = String(msg.url || "");
      if (url && urlStore.has(url)) {
        urlStore.delete(url);
        URL.revokeObjectURL(url);
      }
      sendResponse({ ok: true });
    } catch (e) {
      sendResponse({ ok: false, error: String(e?.message || e) });
    }
    return;
  }
});

