# projectinfo/saveNew Vue 3 进度 Demo

## 启动

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:5174`。页面首次打开会要求输入 Token，请求头自动构造为 `Authorization: Bearer <token>`。

Vite 默认把 `/projectinfo` 和 `/queryresult` 代理到 `http://localhost:8080`，后端地址不同可修改 `vite.config.js`。

## 接口流程

1. `POST /projectinfo/saveNew`：保存项目并创建进度任务。
2. `GET /projectinfo/progress/stream?taskId=...`：SSE 持续接收进度。
3. `GET /projectinfo/progress?taskId=...`：页面刷新或断线恢复时查询快照。
4. `POST /projectinfo/cancel?taskId=...`：取消本地进度监控。
5. `GET /queryresult/list?xmchbh=projid`：查询已回传的详细结果。

保存项目参数为 `projName`、`layerName`、`jzdCoordinates`。图层名使用英文逗号分隔。
