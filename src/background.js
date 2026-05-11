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
 * 生成资源去重 key。
 * 图片常见同一资源携带 cache/signature/size query，完整 URL 去重会导致列表重复。
 */
function getResourceKey(url, type) {
  try {
    const u = new URL(url);
    u.hash = '';
    if (type === 'image') {
      const parts = u.pathname.split('/').filter(Boolean);
      const last = parts[parts.length - 1] || '';
      const stableName = /^[a-z0-9_-]+(\.[a-z0-9]+)?$/i.test(last);
      const hasImageExt = /\.(jpg|jpeg|png|gif|webp|svg|bmp|tiff|tif|avif|ico)$/i.test(last);
      const genericName = /^(image|img|photo|avatar|media|download|file|preview|thumbnail|thumb)$/i.test(last);
      const stablePath = parts.length > 1 && stableName && !genericName;
      if (stablePath || hasImageExt) {
        u.search = '';
      }
    }
    return `${type}:${u.origin}${u.pathname}${u.search}`;
  } catch {
    return `${type}:${url}`;
  }
}

function mergeResource(existing, next) {
  const merged = { ...existing };
  if (!merged.mimeType && next.mimeType) merged.mimeType = next.mimeType;
  if ((next.size || 0) > (merged.size || 0)) {
    merged.size = next.size;
    merged.url = next.url;
    merged.filename = next.filename;
  }
  return merged;
}

/**
 * 保存资源到 store
 */
function saveResource(tabId, url, type, mimeType, size) {
  if (!resourceStore.has(tabId)) {
    resourceStore.set(tabId, new Map());
  }
  const tabResources = resourceStore.get(tabId);
  const key = getResourceKey(url, type);
  const item = {
    url,
    type,
    mimeType: mimeType || '',
    filename: getFilename(url),
    size: size || 0,
    timestamp: Date.now(),
    key
  };

  if (tabResources.has(key)) {
    const merged = mergeResource(tabResources.get(key), item);
    tabResources.set(key, merged);
    chrome.runtime.sendMessage({ action: 'RESOURCE_UPDATED', tabId, item: merged }).catch(() => {});
    return;
  }

  tabResources.set(key, item);

  // 通知 popup（如果打开）
  chrome.runtime.sendMessage({ action: 'NEW_RESOURCE', tabId, item }).catch(() => {});
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
      const entry = tabMap.get(url) || Array.from(tabMap.values()).find(item => item.url === url);
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

  // ======= 注入下载 & Blob 下载（转发到 content script）=======
  if (message.action === 'INJECT_DOWNLOAD' || message.action === 'FETCH_BLOB_DOWNLOAD') {
    const { url, filename, tabId } = message;
    // 转发到 content script 在页面上下文执行下载
    chrome.tabs.sendMessage(tabId, { action: message.action, url, filename })
      .then(result => sendResponse(result || { ok: false, error: 'content script 无响应' }))
      .catch(err => sendResponse({ ok: false, error: err.message }));
    return true;
  }

  // ======= YouTube 下载（通过第三方 API）=======
  if (message.action === 'YT_DOWNLOAD_START') {
    const { videoUrl, format } = message;
    ytDownloadStart(videoUrl, format, sendResponse);
    return true;
  }

  if (message.action === 'YT_DOWNLOAD_STATUS') {
    sendResponse(ytDownloadStatus);
    return false;
  }

  if (message.action === 'YT_DOWNLOAD_CANCEL') {
    ytDownloadCancel();
    sendResponse({ ok: true });
    return false;
  }

  return false;
});

// ======= YouTube 下载状态管理 =======
let ytDownloadStatus = { phase: 'idle' }; // idle | pending | converting | done | error
let ytTaskSeq = 0;
let ytCurrentTask = null;

const YT_API_CONFIG = {
  key: 'dfcb6d76f2f6a9894gjkege8a4ab232222',
  // format 映射：id → API format 参数
  formats: {
    '144p': '144',
    '240p': '240',
    '360p': '360',
    '480p': '480',
    '720p': '720',
    '1080p': '1080',
    '4k': '4k',
    '8k': '8k',
    'flac': 'flac',
    'wav': 'wav',
    'webm': 'webm',
    'mp3': 'mp3',
    'm4a': 'm4a',
    'aac': 'aac',
    'opus': 'opus',
    'ogg': 'ogg',
  },
  formatLabels: {
    '144p': 'MP4 144p',
    '240p': 'MP4 240p',
    '360p': 'MP4 360p',
    '480p': 'MP4 480p',
    '720p': 'MP4 720p',
    '1080p': 'MP4 1080p',
    '4k': 'WEBM 4K',
    '8k': 'WEBM 8K',
    'flac': 'FLAC 音频',
    'wav': 'WAV 音频',
    'webm': 'WEBM 音频',
    'mp3': 'MP3 音频',
    'm4a': 'M4A 音频',
    'aac': 'AAC 音频',
    'opus': 'OPUS 音频',
    'ogg': 'OGG 音频',
  },
  formatExts: {
    '144p': '.mp4',
    '240p': '.mp4',
    '360p': '.mp4',
    '480p': '.mp4',
    '720p': '.mp4',
    '1080p': '.mp4',
    '4k': '.webm',
    '8k': '.webm',
    'flac': '.flac',
    'wav': '.wav',
    'webm': '.webm',
    'mp3': '.mp3',
    'm4a': '.m4a',
    'aac': '.aac',
    'opus': '.opus',
    'ogg': '.ogg',
  },
  // API 端点列表（故障转移）
  endpoints: [
    'https://p.savenow.to/ajax/download.php',
    'https://p.lbserver.xyz/ajax/download.php',
  ],
  // Dubs.io 备用端点
  dubsStart: 'https://dubs.io/wp-json/tools/v1/download-video',
  dubsStatus: 'https://dubs.io/wp-json/tools/v1/status-video',
};

function ytDownloadCancel() {
  ytClearTask(ytCurrentTask);
  ytCurrentTask = null;
  ytDownloadStatus = { phase: 'idle' };
}

function ytExtractVideoId(url) {
  try {
    const u = new URL(url);
    const host = u.hostname;
    if (host === 'youtu.be') return u.pathname.split('/').filter(Boolean)[0] || '';
    if (host === 'youtube.com' || host.endsWith('.youtube.com')) {
      const watchId = u.searchParams.get('v');
      if (watchId) return watchId;
      const parts = u.pathname.split('/').filter(Boolean);
      if ((parts[0] === 'shorts' || parts[0] === 'embed') && parts[1]) return parts[1];
    }
  } catch { return ''; }
  return '';
}

function ytCreateTask(videoUrl, formatId) {
  const task = {
    id: ++ytTaskSeq,
    videoUrl,
    videoId: ytExtractVideoId(videoUrl),
    formatId,
    controller: new AbortController(),
    timers: new Set(),
  };
  ytCurrentTask = task;
  return task;
}

function ytIsTaskActive(task) {
  return !!task && ytCurrentTask?.id === task.id && !task.controller.signal.aborted;
}

function ytTrackTimer(task, timerId) {
  task.timers.add(timerId);
  return timerId;
}

function ytClearTask(task) {
  if (!task) return;
  task.controller.abort();
  for (const timerId of task.timers) {
    clearInterval(timerId);
    clearTimeout(timerId);
  }
  task.timers.clear();
}

function ytSetStatus(task, status, broadcast = true) {
  if (task && !ytIsTaskActive(task)) return false;
  ytDownloadStatus = { ...status };
  if (task) {
    ytDownloadStatus.taskId = task.id;
    ytDownloadStatus.videoUrl = task.videoUrl;
    ytDownloadStatus.videoId = task.videoId;
    ytDownloadStatus.format = task.formatId;
  }
  if (broadcast) {
    chrome.runtime.sendMessage({ action: 'YT_DOWNLOAD_STATUS', ...ytDownloadStatus }).catch(() => {});
  }
  return true;
}

async function ytDownloadStart(videoUrl, formatId, sendResponse) {
  ytDownloadCancel();
  const task = ytCreateTask(videoUrl, formatId);
  const formatCode = YT_API_CONFIG.formats[formatId];
  if (!task.videoId) {
    ytSetStatus(task, { phase: 'error', error: '无法提取视频 ID' }, false);
    ytClearTask(task);
    sendResponse(ytDownloadStatus);
    return;
  }
  if (formatCode === undefined) {
    ytSetStatus(task, { phase: 'error', error: '不支持的格式' }, false);
    ytClearTask(task);
    sendResponse(ytDownloadStatus);
    return;
  }

  ytSetStatus(task, { phase: 'pending', progress: 0 }, false);
  sendResponse(ytDownloadStatus);

  let lastError = null;

  // 依次尝试 savenow / lbserver
  for (const endpoint of YT_API_CONFIG.endpoints) {
    if (!ytIsTaskActive(task)) return;
    try {
      const api = new URL(endpoint);
      api.searchParams.set('copyright', '0');
      api.searchParams.set('allow_extended_duration', '1');
      api.searchParams.set('format', String(formatCode));
      api.searchParams.set('url', videoUrl);
      api.searchParams.set('api', YT_API_CONFIG.key);

      const resp = await ytFetch(task, api.toString(), 25000);
      if (!ytIsTaskActive(task)) return;
      if (!resp.ok) {
        lastError = new Error(`HTTP ${resp.status}`);
        continue;
      }

      const data = await resp.json();
      if (!ytIsTaskActive(task)) return;
      if (data.success && data.progress_url) {
        ytPollProgress(task, data.progress_url);
        return;
      }
      lastError = new Error(data?.error || '下载服务返回异常');
    } catch (e) {
      lastError = e;
    }
  }

  // savenow 全失败 → 尝试 dubs.io
  try {
    await ytTryDubs(task, formatCode);
    return;
  } catch (e) {
    lastError = e;
  }

  if (ytIsTaskActive(task)) {
    ytSetStatus(task, { phase: 'error', error: lastError?.message || '所有下载服务均不可用' });
    ytClearTask(task);
  }
}

function ytCreateRequest(task, timeoutMs) {
  const controller = new AbortController();
  const timeoutId = setTimeout(() => controller.abort(), timeoutMs);
  const onAbort = () => controller.abort();
  if (task.controller.signal.aborted) {
    controller.abort();
  } else {
    task.controller.signal.addEventListener('abort', onAbort, { once: true });
  }
  return {
    signal: controller.signal,
    cleanup() {
      clearTimeout(timeoutId);
      task.controller.signal.removeEventListener('abort', onAbort);
    }
  };
}

async function ytFetch(task, url, timeoutMs) {
  const req = ytCreateRequest(task, timeoutMs);
  try {
    return await fetch(url, { signal: req.signal });
  } finally {
    req.cleanup();
  }
}

function ytFinalizeTask(task, status) {
  if (!ytIsTaskActive(task)) return false;
  ytSetStatus(task, status);
  ytClearTask(task);
  return true;
}

function ytPollProgress(task, progressUrl) {
  ytSetStatus(task, { phase: 'converting', progress: 0 }, false);

  const timeoutId = ytTrackTimer(task, setTimeout(() => {
    if (!ytIsTaskActive(task)) return;
    ytFinalizeTask(task, { phase: 'error', error: '下载超时' });
  }, 120000));
  const intervalId = ytTrackTimer(task, setInterval(async () => {
    try {
      if (!ytIsTaskActive(task)) return;
      const resp = await ytFetch(task, progressUrl, 15000);
      if (!ytIsTaskActive(task) || !resp.ok) return;
      const data = await resp.json();
      if (!ytIsTaskActive(task)) return;

      const progress = Math.min((Number(data.progress) || 0) / 10, 100);
      ytSetStatus(task, { phase: 'converting', progress }, false);

      if (Number(data.progress) >= 1000 && data.download_url) {
        clearTimeout(timeoutId);
        clearInterval(intervalId);
        ytFinalizeTask(task, {
          phase: 'done',
          progress: 100,
          downloadUrl: data.download_url
        });
      }
    } catch (e) {
      // 轮询失败不中断，等下次重试
    }
  }, 3000));
}

async function ytTryDubs(task, formatCode) {
  const { videoUrl, formatId } = task;
  const videoId = ytExtractVideoId(videoUrl);
  if (!videoId) throw new Error('无法提取视频 ID');

  if (!ytIsTaskActive(task)) throw new Error('下载已取消');
  ytSetStatus(task, { phase: 'pending', progress: 0 }, false);

  // Step 1: 启动任务
  const startUrl = new URL(YT_API_CONFIG.dubsStart);
  startUrl.searchParams.set('id', videoId);
  startUrl.searchParams.set('format', String(formatCode));

  const startResp = await ytFetch(task, startUrl.toString(), 25000);
  if (!ytIsTaskActive(task)) throw new Error('下载已取消');
  if (!startResp.ok) throw new Error(`Dubs 启动失败: ${startResp.status}`);
  const startData = await startResp.json();

  if (!startData.success || !startData.progressId) {
    throw new Error(startData.error || 'Dubs 启动失败');
  }

  // Step 2: 轮询状态
  ytSetStatus(task, { phase: 'converting', progress: 0 }, false);
  const statusUrl = new URL(YT_API_CONFIG.dubsStatus);
  statusUrl.searchParams.set('id', startData.progressId);

  return new Promise((resolve, reject) => {
    const dubsTimer = ytTrackTimer(task, setInterval(async () => {
      try {
        if (!ytIsTaskActive(task)) return;
        const resp = await ytFetch(task, statusUrl.toString(), 15000);
        if (!ytIsTaskActive(task) || !resp.ok) return;
        const st = await resp.json();
        if (!ytIsTaskActive(task)) return;

        if (st.progress !== undefined) {
          const rawProgress = Number(st.progress) || 0;
          ytSetStatus(task, { phase: 'converting', progress: Math.min(rawProgress / 10, 100) }, false);
        }

        if (st.finished && st.downloadUrl) {
          clearInterval(dubsTimer);
          clearTimeout(timeoutId);
          ytFinalizeTask(task, {
            phase: 'done',
            progress: 100,
            downloadUrl: st.downloadUrl
          });
          resolve();
        }
      } catch (e) {
        // 轮询失败继续重试
      }
    }, 3000));

    // 超时 120 秒
    const timeoutId = ytTrackTimer(task, setTimeout(() => {
      clearInterval(dubsTimer);
      if (ytIsTaskActive(task)) {
        ytSetStatus(task, { phase: 'error', error: '下载超时' }, false);
        ytClearTask(task);
        reject(new Error('下载超时'));
      }
    }, 120000));
  });
}

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
