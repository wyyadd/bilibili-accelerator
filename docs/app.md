# Loon / Surge 代理端

这个代理端实现直接复用 `src/core/rewrite.js`，不维护第二份 rewrite，
也不覆盖或扩展核心对象。代理运行时兼容位于 `src/app/env.js`，备用 URL
和自动 Rank 采样分别位于 `backup.js`、`sample.js`。它不包含网页面板、
速度曲线、DOM 卡顿监听或 WebRTC SDK 注入。

## 代码结构

```text
src/core/rewrite.js   共用的 URL 分类、改写、直播过滤和 Rank 算法
src/app/env.js        Loon/Surge 参数、持久化存储和有效配置
src/app/request.js    发出媒体请求前改写 URL 与 Host
src/app/response.js   编排播放响应改写、样本保存和备用地址注入
src/app/sample.js     从播放响应提取短期签名 VOD 样本
src/app/backup.js     给 DASH/durl 注入按排名排列的备用 CDN
src/app/rank.js       定时 HEAD 探测候选 CDN 并缓存排名
template/             Loon 插件和 Surge 模块模板
scripts/build-app.mjs 代理端构建入口
```

Loon/Surge 没有模块加载器，因此构建时按入口需要组合源文件：

```text
request  = rewrite + env + request
response = rewrite + env + sample + backup + response
rank     = rewrite + env + rank
```

三个脚本都逐字使用同一个 `src/core/rewrite.js`。

## 构建产物

运行：

```sh
node scripts/build-app.mjs
```

会生成：

```text
dist/app/bilibili-accelerator.plugin
dist/app/bilibili-accelerator.sgmodule
dist/app/bilibili-accelerator.request.js
dist/app/bilibili-accelerator.response.js
dist/app/bilibili-accelerator.rank.js
```

独立测试：

```sh
node --test test/app-*.test.js
```

完整项目测试：

```sh
npm test
```

Loon 导入 `.plugin`，Surge 安装 `.sgmodule`。两者都需要生成、安装并信任
各自的 MITM CA，否则 HTTPS 播放 API 和媒体请求无法被脚本处理。

远程安装地址：

```text
Loon:
https://wyyadd.github.io/bilibili-accelerator/app/bilibili-accelerator.plugin

Surge:
https://wyyadd.github.io/bilibili-accelerator/app/bilibili-accelerator.sgmodule
```
## 保留的能力

- 根据域名、IP、非标准端口和 `os=mcdn` 识别 PCDN/MCDN。
- 将慢 PCDN、海外镜像或可选的 Akamai 地址换成指定 UPOS。
- 将 MCDN URL 包装到 `proxy-tf-all-ws.bilivideo.com`，或按配置直接替换。
- 解开携带 `xy_usource` 的 scheduler URL。
- 递归改写普通视频和番剧的 JSON 播放信息。
- 给 DASH `baseUrl`/`base_url` 和 durl 添加官方 CDN 备用地址。
- 从播放响应保存短期签名样本，由定时任务探测候选 CDN 并缓存排名。
- 从直播 `url_info` 中移除 PCDN/MCDN，同时保证至少保留一个可用项。
- 在真正发出媒体请求前再执行一次 URL 改写，覆盖未命中的播放信息结构。

## 不包含的能力

- 页面内速度测量和图表。
- `<video>` 的 `waiting`/`stalled` 卡顿监听与实时 CDN 轮换。
- 浏览器页面中的 P2P/WebRTC SDK 禁用。
- 原生 App 的 gRPC/Protobuf 播放响应改写。

## 配置

默认行为：

```jsonc
{
  "enabled": true,
  "mode": "bad-only",
  "selection": "auto",
  "pcdnHost": "upos-sz-mirrorcos.bilivideo.com",
  "mcdnStrategy": "proxy-all",
  "rewriteAkamai": false,
  "portHeuristic": true
}
```

Loon 在插件设置中修改这些值。Surge 在模块参数中修改它们。

`auto` 模式不会阻塞播放响应：响应脚本只保存一个最多有效 15 分钟的
签名媒体 URL，定时脚本每 10 分钟用 `HEAD` 探测候选 CDN。成功排名
缓存 6 小时，第一名作为实际 `pcdnHost`，完整排名作为备用 URL 顺序。
首次排名生成前继续使用配置中的默认 CDN。`fixed` 模式完全跳过探测，
固定使用 `pcdnHost`，也不注入自动排序的备用地址。

`force` 模式会处理所有识别到的 Bilibili VOD CDN，而 `bad-only` 只处理
明显的 PCDN/MCDN 和慢镜像。`/live-bvc/` 媒体请求始终不会被替换到
VOD UPOS；直播优化只通过播放响应中的 `url_info` 过滤完成。

## 安全边界

模块仅对列出的 Bilibili API、媒体 CDN 和已知 PCDN 域名启用 MITM。
播放 URL 的查询参数可能包含签名及设备相关信息。为供定时探测使用，
`auto` 模式会在本机持久化存储中暂存一个完整 URL，最长 15 分钟；
它不会进入日志或通知，并会在探测完成后清除。所有解析错误都会原样
放行请求或响应。

原生 App 是否接受 MITM 取决于具体版本和端点；证书固定可能导致部分
请求无法解密。本模块当前以网页播放 JSON 和可被 HTTP 引擎接管的媒体
请求为主要支持范围。
