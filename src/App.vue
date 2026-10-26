<script setup>
import { computed, onBeforeUnmount, onMounted, ref } from 'vue';
import { EventStreamContentType, fetchEventSource } from '@microsoft/fetch-event-source';

const API_BASE_URL = '';
const configuredToken = (import.meta.env.VITE_ACCESS_TOKEN || '').trim();
const token = ref(configuredToken || sessionStorage.getItem('projectinfo-demo-token') || '');
const tokenInput = ref(token.value);
const projName = ref(localStorage.getItem('projectinfo-demo-projName') || '');
const layerName = ref(localStorage.getItem('projectinfo-demo-layerName') || '');
const jzdCoordinates = ref(localStorage.getItem('projectinfo-demo-jzdCoordinates') || '');
const taskId = ref(sessionStorage.getItem('projectinfo-demo-taskId') || '');
const projid = ref(sessionStorage.getItem('projectinfo-demo-projid') || '');
const progress = ref(null);
const results = ref([]);
const errorMessage = ref('');
const busy = ref(false);
const loadingResults = ref(false);
const connectionState = ref('disconnected');
const streamController = ref(null);
const nowTick = ref(Date.now());
let timer = null;

const tokenReady = computed(() => token.value.trim().length > 0);
const active = computed(() => ['queued', 'running', 'calculating'].includes(progress.value?.status));
const finished = computed(() => ['done', 'fail', 'cancelled'].includes(progress.value?.status));
const statusText = computed(() => ({
  queued: '排队中', running: '等待内网结果回传', calculating: '正在收尾',
  done: '分析完成', fail: '分析失败', cancelled: '已取消', unknown: '任务不存在'
}[progress.value?.status] || '未启动'));
const connectionText = computed(() => ({
  connected: 'SSE 已连接', reconnecting: 'SSE 重连中', disconnected: 'SSE 未连接'
}[connectionState.value]));

const apiUrl = path => `${API_BASE_URL}${path}`;
function formatDuration(ms) {
  const totalSeconds = Math.max(0, Math.floor(Number(ms || 0) / 1000));
  const hours = Math.floor(totalSeconds / 3600);
  const minutes = Math.floor((totalSeconds % 3600) / 60);
  const seconds = totalSeconds % 60;
  if (hours) return `${hours}小时${minutes}分${seconds}秒`;
  if (minutes) return `${minutes}分${seconds}秒`;
  return `${seconds}秒`;
}
function layerDuration(layer) {
  if (layer?.status === 'done' || layer?.status === 'cancelled') return formatDuration(layer.durationMs || layer.elapsedMs);
  return formatDuration(layer?.startedAt ? nowTick.value - layer.startedAt : layer?.elapsedMs);
}
function authHeaders() {
  const raw = token.value.trim();
  return { Authorization: /^Bearer\s+/i.test(raw) ? raw : `Bearer ${raw}` };
}
function saveToken() {
  if (!tokenInput.value.trim()) { errorMessage.value = '请输入 token'; return; }
  token.value = tokenInput.value.trim();
  sessionStorage.setItem('projectinfo-demo-token', token.value);
  errorMessage.value = '';
}
function clearToken() {
  stopStream(); token.value = ''; tokenInput.value = '';
  sessionStorage.removeItem('projectinfo-demo-token');
}
async function readJson(response) {
  const body = await response.json();
  if (!response.ok || body.code >= 500) throw new Error(body.message || `请求失败：${response.status}`);
  return body;
}
function persistForm() {
  localStorage.setItem('projectinfo-demo-projName', projName.value.trim());
  localStorage.setItem('projectinfo-demo-layerName', layerName.value.trim());
  localStorage.setItem('projectinfo-demo-jzdCoordinates', jzdCoordinates.value.trim());
}
function setTask(data) {
  taskId.value = data.taskId || taskId.value;
  projid.value = String(data.projid || projid.value || '');
  if (taskId.value) sessionStorage.setItem('projectinfo-demo-taskId', taskId.value);
  if (projid.value) sessionStorage.setItem('projectinfo-demo-projid', projid.value);
  progress.value = data;
}
async function startAnalysis() {
  if (!projName.value.trim() || !layerName.value.trim() || !jzdCoordinates.value.trim()) {
    errorMessage.value = '项目名称、图层名、界址点坐标都不能为空'; return;
  }
  persistForm(); busy.value = true; errorMessage.value = ''; stopStream();
  try {
    const params = new URLSearchParams({ projName: projName.value.trim(), layerName: layerName.value.trim(), jzdCoordinates: jzdCoordinates.value.trim() });
    const response = await fetch(apiUrl(`/projectinfo/saveNew?${params}`), { method: 'POST', headers: authHeaders() });
    const body = await readJson(response);
    setTask(body.data || {});
    connectStream();
  } catch (error) { errorMessage.value = error.message || '保存项目失败'; }
  finally { busy.value = false; }
}
async function loadProgress() {
  if (!taskId.value) return;
  const response = await fetch(apiUrl(`/projectinfo/progress?taskId=${encodeURIComponent(taskId.value)}`), { headers: authHeaders() });
  const body = await readJson(response); setTask(body.data || {});
}
async function connectStream() {
  if (!taskId.value) return;
  stopStream();
  const controller = new AbortController(); streamController.value = controller; connectionState.value = 'reconnecting';
  try {
    await fetchEventSource(apiUrl(`/projectinfo/progress/stream?taskId=${encodeURIComponent(taskId.value)}`), {
      method: 'GET', headers: { ...authHeaders(), Accept: 'text/event-stream' }, signal: controller.signal,
      openWhenHidden: true, retryDelay: 2000,
      async onopen(response) {
        const type = response.headers.get('content-type') || '';
        if (!response.ok || !type.includes(EventStreamContentType)) throw new Error(`SSE 连接失败：${response.status}`);
        connectionState.value = 'connected'; await loadProgress();
      },
      onmessage(event) {
        if (!event.data) return;
        try {
          const data = JSON.parse(event.data); setTask(data);
          if (['done', 'fail', 'cancelled', 'unknown'].includes(data.status)) {
            controller.abort(); connectionState.value = 'disconnected';
            if (data.status !== 'unknown') loadResults();
          }
        } catch { errorMessage.value = '收到无法解析的进度消息'; }
      },
      onclose() { if (!finished.value) { connectionState.value = 'reconnecting'; throw new Error('SSE 提前关闭'); } },
      onerror(error) { if (controller.signal.aborted) return; connectionState.value = 'reconnecting'; throw error; }
    });
  } catch (error) { if (!controller.signal.aborted) { connectionState.value = 'reconnecting'; errorMessage.value = error.message || 'SSE 连接失败'; } }
}
async function cancelAnalysis() {
  if (!taskId.value || !active.value) return;
  busy.value = true; errorMessage.value = '';
  try {
    const response = await fetch(apiUrl(`/projectinfo/cancel?taskId=${encodeURIComponent(taskId.value)}`), { method: 'POST', headers: authHeaders() });
    const body = await readJson(response); if (body.data !== true) throw new Error(body.message || '取消失败');
    await loadProgress(); stopStream(); await loadResults();
  } catch (error) { errorMessage.value = error.message || '取消失败'; }
  finally { busy.value = false; }
}
async function loadResults() {
  if (!projid.value) return;
  loadingResults.value = true;
  try {
    const response = await fetch(apiUrl(`/queryresult/list?xmchbh=${encodeURIComponent(projid.value)}`), { headers: authHeaders() });
    const body = await readJson(response); results.value = body.data || [];
  } catch (error) { errorMessage.value = error.message || '结果查询失败'; }
  finally { loadingResults.value = false; }
}
function stopStream() { streamController.value?.abort(); streamController.value = null; connectionState.value = 'disconnected'; }
onMounted(async () => {
  timer = window.setInterval(() => { nowTick.value = Date.now(); }, 1000);
  if (!tokenReady.value || !taskId.value) return;
  try { await loadProgress(); if (active.value) connectStream(); else loadResults(); }
  catch (error) { errorMessage.value = error.message || '恢复任务失败'; }
});
onBeforeUnmount(() => { stopStream(); if (timer) window.clearInterval(timer); });
</script>

<template>
  <main class="shell">
    <div v-if="!tokenReady" class="mask"><section class="dialog"><p class="eyebrow">Authorization</p><h2>输入访问 Token</h2><p>程序会自动补充 <code>Bearer </code> 前缀。</p><input v-model="tokenInput" type="password" placeholder="请输入 token" @keyup.enter="saveToken" /><button class="primary" @click="saveToken">进入 Demo</button><p v-if="errorMessage" class="error">{{ errorMessage }}</p></section></div>
    <section class="card hero"><div><p class="eyebrow">analysis / projectinfo</p><h1>项目分析进度 Demo</h1><p>调用 projectinfo/saveNew，查看内网分批回传的图层进度。</p></div><span class="connection" :class="connectionState">{{ connectionText }}</span></section>
    <section class="card form"><label>项目名称<input v-model="projName" placeholder="例如：测试项目" :disabled="active" /></label><label>图层名（英文逗号分隔）<input v-model="layerName" placeholder="图层A,图层B,图层C" :disabled="active" /></label><label>界址点坐标<textarea v-model="jzdCoordinates" rows="4" placeholder="请输入 jzdCoordinates" :disabled="active"></textarea></label><div class="actions"><button class="primary" :disabled="busy || active" @click="startAnalysis">保存并开始分析</button><button class="danger" :disabled="busy || !active" @click="cancelAnalysis">取消分析</button><button class="secondary" :disabled="loadingResults || !projid" @click="loadResults">刷新结果</button><button class="secondary" @click="clearToken">更换 Token</button></div><p v-if="errorMessage" class="error">{{ errorMessage }}</p></section>
    <section class="card"><div class="title"><h2>分析进度</h2><span v-if="progress" class="status">{{ statusText }}</span></div><template v-if="progress"><div class="ids">taskId：{{ taskId }}　 projid：{{ projid }}</div><div class="percent">{{ progress.percent || 0 }}<small>%</small></div><div class="track"><div class="fill" :style="{ width: `${progress.percent || 0}%` }"></div></div><div class="meta"><span>{{ progress.done || 0 }} / {{ progress.total || 0 }} 个图层</span><span>{{ progress.message }}</span></div><div class="layer-time-table-wrap"><table class="layer-time-table"><thead><tr><th>图层名称</th><th>状态</th><th>耗时</th></tr></thead><tbody><tr v-for="layer in progress.layerProgress" :key="layer.layerName"><td>{{ layer.layerName }}</td><td :class="layer.status">{{ layer.status === 'done' ? '已完成' : layer.status === 'cancelled' ? '已取消' : '等待回传' }}</td><td>{{ layerDuration(layer) }}</td></tr><tr v-if="!progress.layerProgress?.length"><td colspan="3" class="muted">暂无图层耗时数据。</td></tr></tbody></table></div><div class="columns"><div><h3>已完成图层</h3><p v-for="layer in progress.completedLayers" :key="layer" class="done">✓ {{ layer }}</p><p v-if="!progress.completedLayers?.length" class="muted">暂无</p></div><div><h3>待回传图层</h3><p v-for="layer in progress.pendingLayers" :key="layer" class="pending">… {{ layer }}</p><p v-if="!progress.pendingLayers?.length" class="muted">暂无</p></div></div></template><p v-else class="muted empty">还没有启动任务。</p></section>
    <section class="card"><div class="title"><h2>已回传结果</h2><span class="muted">projid={{ projid || '—' }}</span></div><div v-if="results.length" class="table-wrap"><table><thead><tr><th>图层</th><th>项目名称</th><th>不合规面积</th><th>是否有效</th></tr></thead><tbody><tr v-for="item in results" :key="`${item.xmchbh}-${item.layername}`"><td>{{ item.layername }}</td><td>{{ item.xmmc }}</td><td>{{ item.invalidarea }}</td><td>{{ item.isvalid }}</td></tr></tbody></table></div><p v-else class="muted empty">暂无已回传结果。</p></section>
  </main>
</template>
