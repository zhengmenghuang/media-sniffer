# 🎯 Media Sniffer

> 浏览器媒体资源嗅探与下载插件 — 自动捕获当前页面的视频、音频、图片及 M3U8 流媒体资源

![Chrome](https://img.shields.io/badge/Chrome-MV3-green) ![Firefox](https://img.shields.io/badge/Firefox-MV2-orange) ![版本](https://img.shields.io/badge/版本-1.2.0-blue)

---

## ✨ 功能特性

| 功能 | 描述 |
|------|------|
| 🔍 **自动嗅探** | 通过 `webRequest` API 拦截所有网络请求，实时捕获媒体资源 |
| 🎬 **视频资源** | 支持 MP4、WebM、MKV、FLV、AVI、MOV 等格式 |
| 🎵 **音频资源** | 支持 MP3、AAC、OGG、FLAC、WAV 等格式 |
| 🖼 **图片资源** | 支持 JPG、PNG、GIF、WebP、AVIF、SVG 等格式 |
| 📡 **M3U8/HLS** | 捕获流媒体 M3U8 地址，一键复制供 ffmpeg 下载 |
| ⬇ **直接下载** | 普通媒体文件通过浏览器原生 API 直接下载 |
| 📋 **复制链接** | 一键复制资源 URL，配合外部工具使用 |
| 🔄 **实时更新** | 新资源自动推送到 Popup，无需手动刷新 |
| 🔎 **搜索过滤** | 支持按类型筛选和关键词搜索 |

---

## 📦 项目结构

```
media-sniffer/
├── manifest.json          # 插件配置（MV3，Chrome/Edge）
├── src/
│   ├── background.js      # Service Worker：网络请求拦截 + 资源存储
│   ├── content.js         # Content Script：DOM 元素扫描
│   ├── popup.html         # 弹窗 UI
│   ├── popup.js           # 弹窗逻辑
│   └── icons/             # 插件图标
│       ├── icon16.png
│       ├── icon48.png
│       └── icon128.png
└── scripts/
    ├── gen-icons.js       # SVG 图标生成脚本
    └── gen_icons.py       # PNG 图标生成脚本
```

---

## 🚀 安装方式

### Chrome / Edge（推荐）

1. 打开浏览器，访问 `chrome://extensions/`（Edge 为 `edge://extensions/`）
2. 右上角开启 **开发者模式**
3. 点击 **加载已解压的扩展程序**
4. 选择 `media-sniffer` 目录
5. 插件图标出现在工具栏 ✅

### Firefox

Firefox 使用 Manifest V2，需要修改 `manifest.json`：

```json
{
  "manifest_version": 2,
  "background": {
    "scripts": ["src/background.js"],
    "persistent": false
  },
  "browser_action": {
    "default_popup": "src/popup.html"
  }
}
```

然后访问 `about:debugging` → 加载临时附加组件 → 选择 `manifest.json`

---

## 📖 使用方法

1. 打开任意网页，开始浏览或播放视频
2. 点击工具栏的 🎯 图标打开插件
3. 资源会自动出现在列表中
4. 点击 **⬇ 下载** 直接保存文件
5. 点击 **复制链接** 获取资源 URL

### M3U8 流媒体下载

M3U8 是分片流媒体格式，无法直接下载，推荐以下方式：

```bash
# 使用 ffmpeg 下载（推荐）
ffmpeg -i "https://example.com/video.m3u8" -c copy output.mp4

# 使用 N_m3u8DL-RE（Windows 友好）
N_m3u8DL-RE "https://example.com/video.m3u8" --save-name output
```

---

## 🛠 技术原理

```
浏览器网络层
    ↓ chrome.webRequest.onResponseStarted
background.js（Service Worker）
    → 根据 MIME 类型 + URL 扩展名识别媒体类型
    → 存储到 resourceStore (Map<tabId, Map<url, ResourceItem>>)
    → 推送消息到 Popup
    ↑
content.js（Content Script）
    → 扫描 <video> <audio> <img> <source> 等 DOM 标签
    → MutationObserver 监听动态新增节点
    → 上报给 background.js
    ↑
popup.js（弹窗）
    → 从 background.js 拉取资源列表
    → 实时接收新资源推送
    → 触发下载 / 复制链接
```

---

## ⚠️ 注意事项

- **需要在页面加载过程中打开插件**，已经加载完毕的资源通过 DOM 扫描补全
- 部分网站使用 **加密 HLS / DRM** 保护，M3U8 地址即使复制也可能无法下载
- 图片类资源较多时，建议使用 **类型筛选** 快速定位
- 如遇权限问题，确保插件在 `chrome://extensions/` 中已启用"访问所有网站"权限

---

## 🗺 后续可扩展功能

- [ ] 批量下载（选择多个资源一键打包）
- [ ] 右键菜单嗅探（在图片/视频上右键直接下载）
- [ ] 历史记录（记录已嗅探资源）
- [ ] 黑名单域名（忽略广告/追踪像素）
- [ ] 自定义文件名模板

---

## 📄 License

MIT © 2026
