# projectinfo/saveNew Vue 3 进度 Demo

## 启动

```bash
npm install
npm run dev
```

浏览器访问 `http://localhost:5174`。请求头自动构造为 `Authorization: Bearer <token>`。

## 访问 Token 配置

在根目录 `.env.local` 中填写 `VITE_ACCESS_TOKEN=你的访问Token`（参考 `.env.example`）。配置有值时优先使用，不弹输入框；为空时使用会话已保存的 Token，没有时再弹框。支持带或不带 `Bearer ` 前缀。

修改配置后需重启开发服务；生产部署需重新构建。手动更换 Token 仅影响当前会话，刷新后重新优先使用配置。

注意：配置会包含在前端构建产物中，请仅用于可信环境，不要填写需要保密的长期凭证。`.env.local` 已加入 Git 忽略规则。

Vite 默认把 `/projectinfo` 和 `/queryresult` 代理到 `http://localhost:8080`，后端地址不同可修改 `vite.config.js`。

## 接口流程

1. `POST /projectinfo/saveNew`：保存项目并创建进度任务。
2. `GET /projectinfo/progress/stream?taskId=...`：SSE 持续接收进度。
3. `GET /projectinfo/progress?taskId=...`：页面刷新或断线恢复时查询快照。
4. `POST /projectinfo/cancel?taskId=...`：取消本地进度监控。
5. `GET /queryresult/list?xmchbh=projid`：查询已回传的详细结果。

保存项目参数为 `projName`、`layerName`、`jzdCoordinates`。图层名使用英文逗号分隔。
