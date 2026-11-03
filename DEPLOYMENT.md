# 监考规划 Web：运行与部署

这是可独立部署的纯前端 PWA。计算和界面代码是原生 JavaScript、HTML、CSS，没有业务服务器、账号、数据库或外部 CDN 依赖。

## 数据行为

- 输入、设置、计算结果和手动切换的明暗模式只存在当前页面内存中。
- 刷新、关闭后重新打开会恢复初始状态。浏览器历史返回时也不恢复上一次输入。
- 没有保存方案、自动保存或数据导入功能。“分享结果”仅在本地生成 PNG，用户可主动保存图片；图片不是可重新导入的方案文件。
- PWA 的 Cache Storage 只保存固定清单中的程序文件与图标，用来离线打开；不保存输入、结果、Cookie、localStorage 或 IndexedDB 数据。
- 原 Android 工程和 APK 仍在上一层目录，其本地数据不会导入网页版。

## 本机预览与检查

安装 Node.js 20 或更新版本后，在本目录执行：

```powershell
node scripts/serve.mjs
```

打开 `http://127.0.0.1:4173/`。也可用 `npm start`；不需要先执行 `npm install`。

```powershell
npm test
npm run build
```

构建只把运行所需的 11 个文件复制到 `web/dist/`；测试、说明文档、本地服务器、Android 工程及签名材料不会进入发布目录。预览服务器默认只监听本机，也仅暴露运行文件。不要直接双击 `index.html`，ES modules 和 Service Worker 需要 HTTP(S) 环境。

构建会按全部运行文件内容生成缓存版本。验证真正的发布包时执行 `node scripts/serve.mjs --dist --port 4174`，然后打开 `http://127.0.0.1:4174/`。

可验证子目录部署：

```powershell
node scripts/serve.mjs --port 4174 --base /planner/
```

打开 `http://127.0.0.1:4174/planner/`。线上使用 HTTPS，地址末尾保留 `/`。

## Cloudflare Pages

### 从 Git 自动部署

将本工程提交到自己的 Git 仓库，再在 Cloudflare 的 Workers & Pages 中创建 Pages 项目并连接仓库。若仓库根目录是 `invigilation-planner`，填写：

| 设置 | 值 |
| --- | --- |
| Framework preset | None |
| Root directory | `web` |
| Build command | `npm run build` |
| Build output directory | `dist` |
| Environment variables | 无需配置业务变量 |

如果仓库根目录已经是 `web`，Root directory 留空。若仓库包含上层 `Chat`，根目录应填写仓库内实际的 `invigilation-planner/web` 相对路径。

### 直接上传

先运行 `npm run build`，在 Pages 的 Direct Upload 流程中上传 `web/dist` 目录的内容（让 `index.html` 位于上传根目录）。也可在本 `web` 目录执行：

```powershell
npx wrangler@latest pages deploy ./dist --project-name invigilation-planner
```

这是实际发布命令，需要你自己的 Cloudflare 登录。首次项目创建会询问项目与分支信息；项目名可以修改。不要上传整个 Android 工程。

## Cloudflare Workers Static Assets

本目录的 `wrangler.jsonc` 只配置静态资源，不含 Worker 业务脚本、数据库绑定或密钥。先构建，再从本目录执行：

```powershell
npm run build
npx wrangler@latest deploy
```

使用自己的 Cloudflare 登录。可将 `wrangler.jsonc` 中的 `name` 改为你的项目名。配置中的 `assets.directory` 是 `./dist`，以该配置所在目录为基准。没有前端路由，因此未匹配的路径返回 404，无需 SPA fallback。

此工程已准备部署配置；交付本身不表示已经发布到任何 Cloudflare 账号。

## 安装、离线与更新

1. 在线打开一次，等界面显示离线资源已准备好。
2. 支持安装的浏览器可使用页面安装入口或浏览器菜单“安装应用 / 添加到主屏幕”。iPhone/iPad 通常从 Safari 分享菜单选择“添加到主屏幕”。安装入口因浏览器而异。
3. 程序资源缓存完成后，断网仍可打开并计算；首次访问时没有缓存则需要联网。浏览器清理网站数据或回收缓存后，需要重新在线加载。
4. 离线运行同样刷新即重置，不会保存计算内容。
5. 新版本下载完成后会等待。当前页面不会因为后台更新而自动刷新。用户主动执行更新重置操作，或关闭该站点的全部页面后重新打开，才切换到新版本。

维护者每次修改运行文件后都应重新执行 `npm run build`，再发布 `dist/`。构建自动按运行文件的 SHA-256 生成发布版 `sw.js` 缓存版本，修改界面或计算代码也会触发新版本，不需要手工改版本号。完整资源预缓存失败时，新版本不会完成安装；旧版本仍可继续使用。`_headers` 对源文件设置重新验证和基本安全响应头。开发时优先用 `--dist` 测试发布包；直接预览源码时，已安装的开发缓存可能需在浏览器开发工具中注销后再加载。

## 验证范围

`npm test` 包含原 Android 规则的计算回归，以及 Service Worker 安装失败、离线壳、作用域隔离、显式更新、非静态请求排除、Manifest 图标和本地服务路径边界检查。部署后还应在实际 HTTPS 域名上验证资源状态、首次缓存、离线重开和系统安装入口；本地测试不能代替真实设备安装验证。

## 对照的官方文档

于 2026-10-26 核对 Cloudflare 官方 Static HTML、Static Assets 文档。维护时可重新检查以下地址：

```text
https://developers.cloudflare.com/pages/framework-guides/deploy-anything/
https://developers.cloudflare.com/workers/static-assets/
https://developers.cloudflare.com/workers/static-assets/headers/
https://developers.cloudflare.com/pages/configuration/headers/
https://developer.mozilla.org/en-US/docs/Web/API/Service_Worker_API
https://developer.mozilla.org/en-US/docs/Web/Progressive_web_apps
```
