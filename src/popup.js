/**
 * Media Sniffer - Popup Script
 */

const TYPE_ICONS = {
  video: '🎬',
  audio: '🎵',
  image: '🖼',
  m3u8: '📡'
};

const TYPE_LABELS = {
  video: '视频',
  audio: '音频',
  image: '图片',
  m3u8: 'M3U8'
};

// ======= 状态 =======
let allResources = [];
let currentType = 'all';
let searchQuery = '';
let currentTabId = null;

// ======= 图片大图预览（position:fixed 避免被滚动裁剪）=======
let previewEl = null;
let previewHideTimer = null;
let activePreviewWrap = null;
let activePreviewUrl = '';

function initPreview() {
  previewEl = document.createElement('div');
  previewEl.className = 'img-preview-popup';
  previewEl.id = 'img-preview-global';
  previewEl.style.display = 'none';
  document.body.appendChild(previewEl);
}

function positionImagePreview(targetEl) {
  if (!previewEl || !targetEl) return;
  const rect = targetEl.getBoundingClientRect();
  const pw = previewEl.offsetWidth || 240;
  const ph = previewEl.offsetHeight || 180;
  let left = rect.right + 10;
  if (left + pw > window.innerWidth - 8) {
    left = rect.left - pw - 10;
  }
  if (left < 8) left = 8;
  let top = rect.top + rect.height / 2 - ph / 2;
  if (top < 8) top = 8;
  if (top + ph > window.innerHeight - 8) top = window.innerHeight - ph - 8;
  previewEl.style.left = left + 'px';
  previewEl.style.top = top + 'px';
}

function showImagePreview(url, targetEl) {
  if (!previewEl) initPreview();
  clearTimeout(previewHideTimer);
  activePreviewWrap = targetEl;

  if (activePreviewUrl !== url) {
    activePreviewUrl = url;
    previewEl.replaceChildren();
    const img = document.createElement('img');
    img.src = url;
    img.alt = '';
    previewEl.appendChild(img);
  }

  previewEl.style.display = 'flex';
  requestAnimationFrame(() => {
    if (activePreviewWrap !== targetEl) return;
    positionImagePreview(targetEl);
    previewEl.style.opacity = '1';
  });
}

function hideImagePreview(targetEl) {
  if (!previewEl) return;
  if (targetEl && activePreviewWrap !== targetEl) return;
  activePreviewWrap = null;
  activePreviewUrl = '';
  clearTimeout(previewHideTimer);
  previewEl.style.opacity = '0';
  previewHideTimer = setTimeout(() => {
    if (!previewEl || activePreviewWrap) return;
    previewEl.style.display = 'none';
    previewEl.replaceChildren();
  }, 120);
}

// ======= DOM 引用 =======
const listContainer = document.getElementById('list-container');
const totalBadge = document.getElementById('total-badge');
const statusText = document.getElementById('status-text');
const searchInput = document.getElementById('search-input');
const toast = document.getElementById('toast');

// ======= Toast 提示 =======
let toastTimer;
function showToast(msg, duration = 1800) {
  toast.textContent = msg;
  toast.classList.add('show');
  clearTimeout(toastTimer);
  toastTimer = setTimeout(() => toast.classList.remove('show'), duration);
}

// ======= 格式化文件大小 =======
function formatSize(bytes) {
  if (!bytes || bytes === 0) return '';
  if (bytes < 1024) return bytes + ' B';
  if (bytes < 1024 * 1024) return (bytes / 1024).toFixed(1) + ' KB';
  return (bytes / 1024 / 1024).toFixed(2) + ' MB';
}

// ======= 渲染资源列表 =======
function renderList() {
  hideImagePreview();
  const filtered = allResources.filter(item => {
    if (currentType !== 'all' && item.type !== currentType) return false;
    if (searchQuery) {
      const q = searchQuery.toLowerCase();
      return item.url.toLowerCase().includes(q) || item.filename.toLowerCase().includes(q);
    }
    return true;
  }).sort((a, b) => (b.size || 0) - (a.size || 0));  // 按大小降序：大的排前面

  // 更新 badge
  totalBadge.textContent = allResources.length;
  updateCounts();

  if (filtered.length === 0) {
    listContainer.className = 'empty';
    const icon = document.createElement('div');
    icon.className = 'big-icon';
    icon.textContent = '🔍';
    const text = document.createElement('p');
    if (allResources.length === 0) {
      text.append('当前页面暂未嗅探到媒体资源');
      text.appendChild(document.createElement('br'));
      text.append('浏览或播放内容后资源将自动出现');
    } else {
      text.textContent = '没有符合筛选条件的资源';
    }
    listContainer.replaceChildren(icon, text);
    statusText.textContent = allResources.length === 0 ? '等待嗅探...' : `共 ${allResources.length} 个资源`;
    return;
  }

  statusText.textContent = `找到 ${filtered.length} / ${allResources.length} 个资源`;
  listContainer.className = 'list';
  const fragment = document.createDocumentFragment();
  filtered.forEach(item => fragment.appendChild(createResourceItemElement(item)));
  listContainer.replaceChildren(fragment);
}

function createResourceItemElement(item) {
  const row = document.createElement('div');
  row.className = 'item';

  const typeIcon = document.createElement('div');
  typeIcon.className = `type-icon ${item.type}`;
  typeIcon.textContent = TYPE_ICONS[item.type] || '📄';

  const info = document.createElement('div');
  info.className = 'item-info';

  const name = document.createElement('div');
  name.className = 'item-name item-name-link';
  name.title = item.url;
  name.dataset.url = item.url;
  name.textContent = item.filename;

  const meta = document.createElement('div');
  meta.className = 'item-meta';

  const typeTag = document.createElement('span');
  typeTag.className = `type-tag ${item.type}`;
  typeTag.textContent = TYPE_LABELS[item.type] || item.type;
  meta.appendChild(typeTag);

  const sizeStr = formatSize(item.size);
  if (sizeStr) {
    const size = document.createElement('span');
    size.textContent = sizeStr;
    meta.appendChild(size);
  }

  if (item.mimeType) {
    const mime = document.createElement('span');
    mime.textContent = item.mimeType.split(';')[0];
    meta.appendChild(mime);
  }

  info.append(name, meta);
  row.append(typeIcon, info);

  if (item.type === 'image') {
    row.appendChild(createThumbnail(item.url));
  }

  row.appendChild(createActions(item));
  return row;
}

function createThumbnail(url) {
  const wrap = document.createElement('div');
  wrap.className = 'img-thumb-wrap';
  wrap.dataset.previewUrl = url;

  const img = document.createElement('img');
  img.className = 'img-thumb';
  img.src = url;
  img.alt = '';
  img.loading = 'lazy';

  const fallback = document.createElement('div');
  fallback.className = 'img-thumb-loading';
  fallback.hidden = true;
  fallback.textContent = '🖼';

  img.addEventListener('error', () => {
    img.hidden = true;
    fallback.hidden = false;
  });

  wrap.append(img, fallback);
  return wrap;
}

function createActions(item) {
  const actions = document.createElement('div');
  actions.className = 'item-actions';

  if (item.type === 'm3u8') {
    const copyM3u8 = document.createElement('button');
    copyM3u8.className = 'btn-action btn-dl m3u8-hint';
    copyM3u8.dataset.url = item.url;
    copyM3u8.title = 'M3U8 流建议用 ffmpeg 下载';
    copyM3u8.textContent = '📋 复制';
    actions.appendChild(copyM3u8);
  } else {
    const download = document.createElement('button');
    download.className = 'btn-action btn-dl do-download';
    download.dataset.url = item.url;
    download.dataset.filename = item.filename;
    download.textContent = '⬇ 下载';
    actions.appendChild(download);
  }

  const copy = document.createElement('button');
  copy.className = 'btn-action btn-copy do-copy';
  copy.dataset.url = item.url;
  copy.textContent = '复制链接';
  actions.appendChild(copy);

  return actions;
}

function handleListClick(e) {
  const nameEl = e.target.closest('.item-name-link');
  if (nameEl) {
    chrome.tabs.create({ url: nameEl.dataset.url, active: false }, () => {
      if (chrome.runtime.lastError) {
        window.open(nameEl.dataset.url, '_blank');
      } else {
        showToast('✅ 已在新标签页打开');
      }
    });
    return;
  }

  const dlBtn = e.target.closest('.do-download');
  if (dlBtn) {
    const url = dlBtn.dataset.url;
    const filename = dlBtn.dataset.filename;
    chrome.runtime.sendMessage({ action: 'DOWNLOAD', url, filename, tabId: currentTabId })
      .then((result) => {
        if (result?.ok) {
          showToast('✅ 下载已开始');
        } else {
          showToast(`下载失败：${result?.error || '未知错误'}`, 2500);
        }
      })
      .catch((err) => showToast(`下载失败：${err?.message || '未知错误'}`, 2500));
    return;
  }

  const copyBtn = e.target.closest('.do-copy');
  if (copyBtn) {
    navigator.clipboard.writeText(copyBtn.dataset.url).then(() => {
      copyBtn.textContent = '✓ 已复制';
      copyBtn.classList.add('copied');
      showToast('✅ 链接已复制');
      setTimeout(() => {
        copyBtn.textContent = '复制链接';
        copyBtn.classList.remove('copied');
      }, 2000);
    }).catch(() => showToast('复制失败', 2000));
    return;
  }

  const m3u8Btn = e.target.closest('.m3u8-hint');
  if (m3u8Btn) {
    navigator.clipboard.writeText(m3u8Btn.dataset.url).then(() => {
      showToast('📋 M3U8 链接已复制，请用 ffmpeg 下载', 2500);
      m3u8Btn.textContent = '✓ 已复制';
      setTimeout(() => { m3u8Btn.textContent = '📋 复制'; }, 2000);
    }).catch(() => showToast('复制失败', 2000));
  }
}

function handlePreviewPointerOver(e) {
  const wrap = e.target.closest('.img-thumb-wrap');
  if (!wrap || !listContainer.contains(wrap) || !wrap.dataset.previewUrl) return;
  const related = e.relatedTarget;
  if (related && wrap.contains(related)) return;
  showImagePreview(wrap.dataset.previewUrl, wrap);
}

function handlePreviewPointerOut(e) {
  const wrap = e.target.closest('.img-thumb-wrap');
  if (!wrap) return;
  const related = e.relatedTarget;
  if (related && wrap.contains(related)) return;
  hideImagePreview(wrap);
}

// ======= 更新各类型数量 =======
function updateCounts() {
  const counts = { all: allResources.length, video: 0, audio: 0, image: 0, m3u8: 0 };
  allResources.forEach(r => { if (counts[r.type] !== undefined) counts[r.type]++; });
  for (const [type, cnt] of Object.entries(counts)) {
    const el = document.getElementById(`cnt-${type}`);
    if (el) el.textContent = cnt;
  }
}

// ======= 过滤 Tab 切换 =======
document.querySelectorAll('.tab').forEach(btn => {
  btn.addEventListener('click', () => {
    document.querySelectorAll('.tab').forEach(b => b.classList.remove('active'));
    btn.classList.add('active');
    currentType = btn.dataset.type;
    renderList();
  });
});

// ======= 搜索 =======
searchInput.addEventListener('input', (e) => {
  searchQuery = e.target.value.trim();
  renderList();
});

// ======= 刷新按钮 =======
document.getElementById('btn-refresh').addEventListener('click', () => {
  loadResources(true);
});

// ======= 清除按钮 =======
document.getElementById('btn-clear').addEventListener('click', () => {
  if (!currentTabId) return;
  chrome.runtime.sendMessage({ action: 'CLEAR_RESOURCES', tabId: currentTabId }).then(() => {
    allResources = [];
    renderList();
    showToast('🗑 列表已清除');
  });
});

// ======= 加载资源 =======
function loadResources(rescan = false) {
  listContainer.className = 'loading';
  const spinner = document.createElement('div');
  spinner.className = 'spinner';
  const loadingText = document.createElement('span');
  loadingText.textContent = '正在嗅探...';
  listContainer.replaceChildren(spinner, loadingText);

  chrome.tabs.query({ active: true, currentWindow: true }, (tabs) => {
    if (!tabs || !tabs[0]) return;
    currentTabId = tabs[0].id;

    const fetchResources = () => chrome.runtime.sendMessage({ action: 'GET_RESOURCES', tabId: currentTabId })
      .then(resources => {
        allResources = resources || [];
        renderList();
      })
      .catch(() => {
        allResources = [];
        renderList();
      });

    if (rescan) {
      chrome.tabs.sendMessage(currentTabId, { action: 'RESCAN_DOM' })
        .catch(() => {})
        .finally(fetchResources);
      return;
    }

    fetchResources();
  });
}

// ======= 监听新资源推送 =======
chrome.runtime.onMessage.addListener((message) => {
  if (message.action === 'NEW_RESOURCE' && message.tabId === currentTabId) {
    // 避免重复
    const exists = allResources.some(r => r.url === message.item.url);
    if (!exists) {
      allResources.unshift(message.item); // 新资源放顶部
      renderList();
    }
  }
});

// ======= 初始化 =======
listContainer.addEventListener('click', handleListClick);
listContainer.addEventListener('pointerover', handlePreviewPointerOver);
listContainer.addEventListener('pointerout', handlePreviewPointerOut);
listContainer.addEventListener('scroll', () => hideImagePreview());
loadResources();
