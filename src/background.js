/**
 * Media Sniffer - Background Service Worker
 * 负责拦截网络请求，嗅探媒体资源
 */

// ======= 资源类型识别规则 =======
const RULES = {
  video: {
    mimeTypes: [
      'video/mp4', 'video/webm', 'video/ogg', 'video/mpeg',
      'video/quicktime', 'video/x-flv', 'video/x-msvideo',
      'video/3gpp', 'video/x-ms-wmv',
      // DASH / HLS / streaming
      'application/dash+xml',
      'application/x-shockwave-flash',
      'video/mp2t',
      'video/iso.segment',
      'video/mp4.segment'
    ],
    extensions: ['.mp4', '.webm', '.ogv', '.mpeg', '.mpg', '.mov',
      '.flv', '.avi', '.3gp', '.wmv', '.mkv', '.ts', '.m2ts',
      // DASH segments
      '.m4s', '.m4f', '.m4v',
      // HLS segments
      '.ts', '.m2ts',
      // YouTube / streaming
      '.f4v', '.f4f', '.ismv', '.isma'
    ]
  },
  audio: {
    mimeTypes: [
      'audio/mpeg', 'audio/ogg', 'audio/wav', 'audio/aac',
      'audio/flac', 'audio/mp4', 'audio/webm', 'audio/x-ms-wma'
    ],
    extensions: ['.mp3', '.ogg', '.wav', '.aac', '.flac', '.m4a', '.wma', '.opus']
  },
  image: {
    mimeTypes: [
      'image/jpeg', 'image/png', 'image/gif', 'image/webp',
      'image/svg+xml', 'image/bmp', 'image/tiff', 'image/avif'
    ],
    extensions: ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.svg',
      '.bmp', '.tiff', '.tif', '.avif', '.ico']
  },
  m3u8: {
    mimeTypes: [
      'application/vnd.apple.mpegurl',
      'application/x-mpegurl',
      'audio/mpegurl',
      'audio/x-mpegurl',
      'application/x-mpegurl'
    ],
    extensions: ['.m3u8', '.m3u']
  }
};

// webRequest 请求类型中属于媒体的（详见 Chrome docs: webRequest RequestFilter）
const MEDIA_REQUEST_TYPES = new Set(['media', 'xmlhttprequest']);

// ======= MIME → 文件扩展名映射（用于下载时补后缀）=======
const MIME_TO_EXT = {
  'video/mp4': '.mp4',
  'video/webm': '.webm',
  'video/ogg': '.ogv',
  'video/mpeg': '.mpeg',
  'video/quicktime': '.mov',
  'video/x-flv': '.flv',
  'video/x-msvideo': '.avi',
  'video/3gpp': '.3gp',
  'video/x-ms-wmv': '.wmv',
  'video/mp2t': '.ts',
  'audio/mpeg': '.mp3',
  'audio/ogg': '.ogg',
  'audio/wav': '.wav',
  'audio/aac': '.aac',
  'audio/flac': '.flac',
  'audio/mp4': '.m4a',
  'audio/webm': '.weba',
  'audio/x-ms-wma': '.wma',
  'image/jpeg': '.jpg',
  'image/png': '.png',
  'image/gif': '.gif',
  'image/webp': '.webp',
  'image/svg+xml': '.svg',
  'image/bmp': '.bmp',
  'image/tiff': '.tiff',
  'image/avif': '.avif',
  'application/vnd.apple.mpegurl': '.m3u8',
  'application/x-mpegurl': '.m3u8',
  'application/dash+xml': '.mpd',
  'application/octet-stream': '.mp4',  // 兜底：流式视频归为 mp4
};

/**
 * 根据 MIME type 和资源类型推断合适的文件扩展名
 */
function inferExtension(url, mimeType, resourceType) {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  if (MIME_TO_EXT[mime]) return MIME_TO_EXT[mime];

  // 从 URL path 提取已有扩展名
  try {
    const path = new URL(url).pathname.toLowerCase();
    const dotExt = path.includes('.') ? path.substring(path.lastIndexOf('.')) : '';
    if (['.mp4','.webm','.mov','.avi','.flv','.mkv','.ts','.m2ts','.m4s',
         '.mp3','.ogg','.wav','.aac','.flac','.m4a','.opus',
         '.jpg','.jpeg','.png','.gif','.webp','.svg','.bmp','.avif','.ico'].includes(dotExt)) {
      return dotExt;
    }
  } catch {}

  // 兜底：按资源类型给默认扩展名
  const typeExt = { video: '.mp4', audio: '.mp3', image: '.jpg', m3u8: '.m3u8' };
  return typeExt[resourceType] || '.bin';
}

/**
 * 确保文件名带正确的扩展名（如果没有的话）
 */
function ensureExtension(filename, url, mimeType, resourceType) {
  const ext = inferExtension(url, mimeType, resourceType);
  if (!filename.toLowerCase().endsWith(ext)) {
    return filename + ext;
  }
  return filename;
}
// ======= end extension helper =======

// ======= 资源存储 key: tabId → Map<url, ResourceItem> =======
const resourceStore = new Map();

/**
 * 从 URL 提取纯路径（去掉 query/hash）用于扩展名判断
 */
function getUrlPath(url) {
  try {
    return new URL(url).pathname.toLowerCase();
  } catch {
    return url.toLowerCase();
  }
}

/**
 * 判断资源类型
 * @param {string} url
 * @param {string} mimeType
 * @param {string} [reqType] - webRequest details.type
 * @returns {'video'|'audio'|'image'|'m3u8'|null}
 */
function detectType(url, mimeType, reqType) {
  const mime = (mimeType || '').toLowerCase().split(';')[0].trim();
  const path = getUrlPath(url);
  const urlLower = url.toLowerCase();

  // 1) 精确 MIME 匹配（最高优先级）
  for (const [type, rule] of Object.entries(RULES)) {
    if (mime && rule.mimeTypes.some(m => mime.startsWith(m.toLowerCase()))) return type;
    if (rule.extensions.some(ext => path.endsWith(ext))) return type;
  }

  // 2) webRequest 请求类型为 media → 很可能是视频/音频
  if (reqType === 'media') {
    // 用 URL 关键词进一步判断
    if (/\.(m4s|m4f|mp4|webm|mkv|avi|flv|mov|ts|m2ts|f4v)(\?|$)/.test(urlLower)) return 'video';
    if (/\.(mp3|ogg|wav|aac|flac|m4a|opus)(\?|$)/.test(urlLower)) return 'audio';
    // 无法判断扩展名时默认归为 video（媒体请求大概率是视频）
    return 'video';
  }

  // 3) application/octet-stream：通过 URL 关键词判断是否为视频分片
  if (mime === 'application/octet-stream' || mime === 'binary/octet-stream') {
    // YouTube / 通用 streaming 分片特征
    if (/videoplayback|m4s|m4f|segment|init\.mp4|frag/.test(urlLower)) return 'video';
    if (/\.(m4s|m4f|ts|m2ts|ismv)(\?|$)/.test(urlLower)) return 'video';
  }

  return null;
}

/**
 * 提取文件名
 */
function getFilename(url) {
  try {
    const u = new URL(url);
    const parts = u.pathname.split('/').filter(Boolean);
    const last = parts[parts.length - 1] || 'media';
    // 去掉参数
    return last.split('?')[0] || 'media';
  } catch {
    return 'media';
  }
}

/**
 * 保存资源到 store
 */
function saveResource(tabId, url, type, mimeType, size) {
  if (!resourceStore.has(tabId)) {
    resourceStore.set(tabId, new Map());
  }
  const tabResources = resourceStore.get(tabId);
  if (!tabResources.has(url)) {
    const item = {
      url,
      type,
      mimeType: mimeType || '',
      filename: getFilename(url),
      size: size || 0,
      timestamp: Date.now()
    };
    tabResources.set(url, item);

    // 通知 popup（如果打开）
    chrome.runtime.sendMessage({ action: 'NEW_RESOURCE', tabId, item }).catch(() => {});
  }
}

// ======= 监听 webRequest =======
chrome.webRequest.onResponseStarted.addListener(
  (details) => {
    const { tabId, url, responseHeaders, type: reqType } = details;
    if (tabId < 0) return; // 忽略扩展自身请求

    // 跳过 chrome-extension:// 等
    if (!url.startsWith('http://') && !url.startsWith('https://')) return;

    let mimeType = '';
    let contentLength = 0;

    if (responseHeaders) {
      for (const h of responseHeaders) {
        const name = h.name.toLowerCase();
        if (name === 'content-type') mimeType = h.value || '';
        if (name === 'content-length') contentLength = parseInt(h.value) || 0;
      }
    }

    const resourceType = detectType(url, mimeType, reqType);
    if (resourceType) {
      saveResource(tabId, url, resourceType, mimeType, contentLength);
    }
  },
  { urls: ['<all_urls>'] },
  ['responseHeaders', 'extraHeaders']
);

// ======= 监听 content script 上报的 DOM 媒体资源 =======
chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
  if (message.action === 'DOM_RESOURCES' && sender.tab) {
    const tabId = sender.tab.id;
    for (const item of (message.resources || [])) {
      const type = detectType(item.url, item.mimeType);
      if (type) {
        saveResource(tabId, item.url, type, item.mimeType, 0);
      } else if (item.tagType) {
        // 由 tag 类型直接给出
        saveResource(tabId, item.url, item.tagType, item.mimeType, 0);
      }
    }
    sendResponse?.({ ok: true });
    return false;
  }

  if (message.action === 'GET_RESOURCES') {
    const tabId = message.tabId;
    const map = resourceStore.get(tabId);
    sendResponse(map ? Array.from(map.values()) : []);
    return false;
  }

  if (message.action === 'CLEAR_RESOURCES') {
    const tabId = message.tabId;
    resourceStore.delete(tabId);
    sendResponse({ ok: true });
    return false;
  }

  if (message.action === 'DOWNLOAD') {
    const { url, filename, tabId } = message;
    // 从 store 查找对应的资源，获取 mimeType 和 type 用于补后缀
    let mimeType = '';
    let resourceType = '';
    const tabMap = resourceStore.get(tabId);
    if (tabMap) {
      const entry = tabMap.get(url);
      if (entry) {
        mimeType = entry.mimeType || '';
        resourceType = entry.type || '';
      }
    }
    const finalFilename = ensureExtension(filename, url, mimeType, resourceType);
    chrome.downloads.download({ url, filename: finalFilename, saveAs: false }, (downloadId) => {
      if (chrome.runtime.lastError) {
        sendResponse({ ok: false, error: chrome.runtime.lastError.message });
        return;
      }
      sendResponse({ ok: true, downloadId });
    });
    return true;
  }

  return false;
});

// ======= 标签关闭时清理 =======
chrome.tabs.onRemoved.addListener((tabId) => {
  resourceStore.delete(tabId);
});

// ======= 标签导航时清理旧资源 =======
chrome.webNavigation?.onCommitted?.addListener((details) => {
  if (details.frameId === 0) {
    resourceStore.delete(details.tabId);
  }
});

console.log('[MediaSniffer] Background service worker started');
