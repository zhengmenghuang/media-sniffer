/**
 * Media Sniffer - Content Script
 * 扫描 DOM 中的 <video> <audio> <img> <source> <track> 标签
 * 并通过 MutationObserver 持续监听新增媒体元素
 * 新增：YouTube 专用嗅探（解析 ytInitialPlayerResponse）
 */

(function () {
  'use strict';

  if (window.__MEDIA_SNIFFER_CONTENT_LOADED__) {
    return;
  }
  window.__MEDIA_SNIFFER_CONTENT_LOADED__ = true;

  let extensionContextValid = true;
  let observer = null;

  const TAG_TYPE_MAP = {
    video: 'video',
    audio: 'audio',
    img: 'image',
    source: 'video',
  };

  function getMimeFromElement(el) {
    return el.getAttribute('type') || '';
  }

  function collectFromElement(el) {
    const tag = el.tagName.toLowerCase();
    const src = el.src || el.currentSrc || el.getAttribute('src') || '';
    const dataSrc = el.getAttribute('data-src') || el.getAttribute('data-original') || '';

    const results = [];

    const addUrl = (url, tagType, mime) => {
      if (!url || !url.startsWith('http')) return;
      results.push({ url, tagType, mimeType: mime });
    };

    if (tag === 'video' || tag === 'audio') {
      const tagType = TAG_TYPE_MAP[tag];
      addUrl(src, tagType, '');
      addUrl(dataSrc, tagType, '');
      el.querySelectorAll('source').forEach(s => {
        addUrl(s.src, tagType, getMimeFromElement(s));
      });
    } else if (tag === 'img') {
      addUrl(src, 'image', '');
      addUrl(dataSrc, 'image', '');
      const srcset = el.getAttribute('srcset') || '';
      srcset.split(',').forEach(part => {
        const url = part.trim().split(/\s+/)[0];
        addUrl(url, 'image', '');
      });
    } else if (tag === 'source') {
      const parentTag = el.parentElement?.tagName?.toLowerCase() || '';
      const tagType = parentTag === 'video' ? 'video' : (parentTag === 'audio' ? 'audio' : 'video');
      addUrl(src, tagType, getMimeFromElement(el));
    }

    return results;
  }

  function scanDOM() {
    const selectors = 'video, audio, img, source';
    const elements = document.querySelectorAll(selectors);
    const resources = [];
    elements.forEach(el => {
      resources.push(...collectFromElement(el));
    });

    // 扫描 CSS background-image（仅第一层）
    document.querySelectorAll('[style*="url("]').forEach(el => {
      const style = el.getAttribute('style') || '';
      const matches = style.matchAll(/url\(['"]?(https?:\/\/[^'")\s]+)['"]?\)/g);
      for (const m of matches) {
        resources.push({ url: m[1], tagType: 'image', mimeType: '' });
      }
    });

    return resources;
  }

  // ============= YouTube 专用嗅探 =============

  function parseYouTubePlayerResponse() {
    try {
      // 从页面 script 标签中提取 ytInitialPlayerResponse
      const scripts = document.querySelectorAll('script');
      let raw = '';
      for (const s of scripts) {
        const t = s.textContent || '';
        if (t.includes('ytInitialPlayerResponse')) {
          // 用正则提取 JSON 对象
          const m = t.match(/ytInitialPlayerResponse\s*=\s*(\{[\s\S]*?\});/);
          if (m) { raw = m[1]; break; }
        }
      }
      if (!raw) return [];

      const data = JSON.parse(raw);
      const streamingData = data?.streamingData;
      if (!streamingData) return [];

      const urls = [];

      // 提取 DASH 格式中的 URL
      const formats = streamingData.formats || [];
      const adaptive = streamingData.adaptiveFormats || [];

      for (const fmt of [...formats, ...adaptive]) {
        if (fmt?.url && fmt.url.startsWith('http')) {
          urls.push({ url: fmt.url, tagType: 'video', mimeType: fmt.mimeType || 'video/mp4' });
        }
        // cipher 格式需要签名解码，这里先跳过，避免生成不可用链接
      }

      return urls;
    } catch (e) {
      return [];
    }
  }

  function tryYouTubeSniff() {
    if (!extensionContextValid) return Promise.resolve(0);
    if (!window.location.hostname.includes('youtube.com')) return Promise.resolve(0);
    const resources = parseYouTubePlayerResponse();
    if (resources.length > 0) {
      return reportResources(resources).then(() => resources.length);
    }
    return Promise.resolve(0);
  }

  // ============= 上报 =============

  function isExtensionContextError(error) {
    return String(error?.message || error).includes('Extension context invalidated');
  }

  function disableContentScript() {
    extensionContextValid = false;
    observer?.disconnect();
    clearTimeout(tryYouTubeSniff._timer);
  }

  function reportResources(resources) {
    if (!extensionContextValid || resources.length === 0) return Promise.resolve();
    try {
      return chrome.runtime.sendMessage({ action: 'DOM_RESOURCES', resources }).catch((error) => {
        if (isExtensionContextError(error)) disableContentScript();
      });
    } catch (error) {
      if (isExtensionContextError(error)) disableContentScript();
      return Promise.resolve();
    }
  }

  // 页面加载完成后扫描 + YouTube 嗅探
  function onPageReady() {
    if (!extensionContextValid) return;
    reportResources(scanDOM());
    tryYouTubeSniff();
  }

  chrome.runtime.onMessage.addListener((message, sender, sendResponse) => {
    if (message.action !== 'RESCAN_DOM') return false;
    const resources = scanDOM();
    reportResources(resources)
      .then(() => tryYouTubeSniff())
      .then((youtubeCount) => {
        sendResponse({ ok: true, count: resources.length + youtubeCount });
      })
      .catch(() => {
        sendResponse({ ok: false, count: resources.length });
      });
    return true;
  });

  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', onPageReady);
  } else {
    onPageReady();
  }

  // MutationObserver 持续监听新增节点
  observer = new MutationObserver((mutations) => {
    if (!extensionContextValid) return;
    const newResources = [];
    let hasNewScript = false;

    for (const mutation of mutations) {
      for (const node of mutation.addedNodes) {
        if (node.nodeType !== 1) continue;
        const tag = node.tagName?.toLowerCase();
        if (['video', 'audio', 'img', 'source'].includes(tag)) {
          newResources.push(...collectFromElement(node));
        }
        // 子元素
        node.querySelectorAll?.('video, audio, img, source')?.forEach(el => {
          newResources.push(...collectFromElement(el));
        });
        // 检测 YouTube 动态插入的 script（数据更新）
        if (tag === 'script') hasNewScript = true;
      }
    }

    if (newResources.length > 0) reportResources(newResources);

    // YouTube SPA：检测 script 变化，重新嗅探
    if (hasNewScript && window.location.hostname.includes('youtube.com')) {
      clearTimeout(tryYouTubeSniff._timer);
      tryYouTubeSniff._timer = setTimeout(tryYouTubeSniff, 500);
    }
  });

  observer.observe(document.documentElement, { childList: true, subtree: true });

  // 监听 YouTube SPA 导航（yt-navigate 事件）
  if (window.location.hostname.includes('youtube.com')) {
    document.addEventListener('yt-navigate-finish', () => {
      setTimeout(onPageReady, 800);
    });
  }
})();
