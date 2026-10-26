import { DEFAULT_INPUT, EXAMPLE_INPUT, calculate, formatPlan } from './calculator.js';

const $ = (id) => document.getElementById(id);
const fields = Object.keys(DEFAULT_INPUT);
const form = $('planner-form');
const systemDark = window.matchMedia('(prefers-color-scheme: dark)');
const numberFormat = new Intl.NumberFormat('zh-CN');
const number = (value) => numberFormat.format(BigInt(String(value)));
let input = { ...DEFAULT_INPUT };
let result;
let showCalculation = false;
let themeOverridden = false;
let confirmAction = null;
let installPrompt = null;
let registration = null;
let updateRequested = false;
let toastTimer;
let announcementTimer;

function element(tag, className, text) {
  const node = document.createElement(tag);
  if (className) node.className = className;
  if (text !== undefined) node.textContent = text;
  return node;
}

function setTheme(dark) {
  document.documentElement.dataset.theme = dark ? 'dark' : 'light';
  $('theme-light').setAttribute('aria-pressed', String(!dark));
  $('theme-dark').setAttribute('aria-pressed', String(dark));
  document.querySelector('meta[name="theme-color"]').content = dark ? '#111418' : '#f7f9fc';
}

function applyInput(values) {
  input = { ...values };
  for (const key of fields) $(key).value = input[key];
  render();
}

function resetPage() {
  // Explicit writes defeat browser-restored form values, including BFCache restores.
  form.reset();
  themeOverridden = false;
  setTheme(systemDark.matches);
  showCalculation = false;
  $('show-calculation').checked = false;
  document.querySelectorAll('dialog[open]').forEach((dialog) => dialog.close());
  confirmAction = null;
  applyInput(DEFAULT_INPUT);
}

function render() {
  result = calculate(input);
  for (const key of fields) {
    const error = result.errors?.[key];
    $(key).setAttribute('aria-invalid', String(Boolean(error)));
    $(`${key}-error`).textContent = error || '';
    $(`${key}-error`).hidden = !error;
  }
  const content = $('result-content');
  content.replaceChildren();
  let announcement;
  if (result.status === 'valid') {
    const demand = element('div', 'demand');
    demand.append(element('p', 'success-label', '工作量满足需求'), element('p', 'demand-label', '总需求'), element('strong', 'demand-number', number(result.totalDemand)), element('p', 'unit', '监考人次'));
    const stats = element('div', 'stats');
    for (const [label, value] of [['实际参与', result.participating], ['实际未参与', result.inactive]]) {
      const stat = element('div', 'stat');
      const amount = element('strong', '', number(value));
      amount.append(element('small', '', ' 人'));
      stat.append(element('span', '', label), amount);
      stats.append(stat);
    }
    const list = element('ul', 'allocation-list');
    for (const row of result.rows) {
      const item = element('li', 'allocation-row');
      const description = element('div');
      description.append(element('span', '', row.label), element('small', '', String(row.sessions) === '0' ? '不安排监考' : `每人监考 ${number(row.sessions)} 场`));
      item.append(description, element('strong', '', `${number(row.people)} 人`));
      list.append(item);
    }
    content.append(demand, stats, element('h3', 'allocation-title', '人员分配'), list);
    $('result-badge').textContent = '已计算';
    $('mobile-summary').textContent = `${number(result.totalDemand)} 人次`;
    announcement = `规划已更新：总需求 ${number(result.totalDemand)} 监考人次，实际参与 ${number(result.participating)} 人。`;
  } else if (result.status === 'conflict') {
    const conflict = element('div', 'conflict');
    conflict.append(element('h3', '', result.title), element('p', '', result.message));
    content.append(conflict);
    $('result-badge').textContent = '需调整';
    $('mobile-summary').textContent = '安排存在冲突';
    announcement = `${result.title}。${result.message}`;
  } else {
    const state = element('div', 'empty-state');
    state.append(element('span', 'empty-number', '—'));
    const started = fields.some((key) => input[key] !== DEFAULT_INPUT[key]);
    const missingLabels = (result.missing || []).map((key) => $(key).labels[0].textContent);
    const incompleteMessage = started ? `还需填写：${missingLabels.join('、')}。` : '填写考场数量、考试场数和教职工总数，即可查看监考工作量分配。';
    state.append(element('h3', '', result.status === 'invalid' ? '请检查输入数值' : started ? '请补全输入' : '从考试规模开始'));
    state.append(element('p', '', result.status === 'invalid' ? '请按输入框下方的提示调整，结果会自动重新计算。' : incompleteMessage));
    content.append(state);
    $('result-badge').textContent = result.status === 'invalid' ? '需检查' : '待填写';
    $('mobile-summary').textContent = result.status === 'invalid' ? '请检查输入' : '待填写';
    announcement = result.status === 'invalid' ? Object.values(result.errors).join('。') : incompleteMessage;
  }
  $('result-actions').hidden = result.status !== 'valid';
  $('share-button').hidden = typeof navigator.share !== 'function';
  $('calculation').hidden = !(showCalculation && result.steps?.length);
  $('calculation-steps').replaceChildren(...(result.steps || []).map((step) => element('li', '', step)));
  clearTimeout(announcementTimer);
  announcementTimer = setTimeout(() => { $('live-status').textContent = announcement; }, 450);
}

function notify(message) {
  clearTimeout(toastTimer);
  $('toast').textContent = message;
  $('toast').hidden = false;
  toastTimer = setTimeout(() => { $('toast').hidden = true; }, 3600);
}

function confirm(title, description, action) {
  $('confirm-title').textContent = title;
  $('confirm-description').textContent = description;
  confirmAction = action;
  $('confirm-dialog').showModal();
}

function replaceInput(values, title) {
  const action = () => { applyInput(values); notify(values === EXAMPLE_INPUT ? '已填入示例，可继续修改数值' : '输入已重置'); };
  if (fields.some((key) => input[key] !== DEFAULT_INPUT[key])) confirm(title, '这会替换当前填写的数值。', action);
  else action();
}

function showCopyFallback(text) {
  $('copy-text').value = text;
  $('copy-dialog').showModal();
  $('copy-text').focus();
  $('copy-text').select();
}

form.addEventListener('submit', (event) => event.preventDefault());
form.addEventListener('input', (event) => {
  if (!fields.includes(event.target.name)) return;
  input[event.target.name] = event.target.value;
  render();
});
$('example-button').addEventListener('click', () => replaceInput(EXAMPLE_INPUT, '填入示例？'));
$('reset-button').addEventListener('click', () => replaceInput(DEFAULT_INPUT, '重置当前输入？'));
$('theme-light').addEventListener('click', () => { themeOverridden = true; setTheme(false); });
$('theme-dark').addEventListener('click', () => { themeOverridden = true; setTheme(true); });
systemDark.addEventListener('change', () => { if (!themeOverridden) setTheme(systemDark.matches); });
$('show-calculation').addEventListener('change', (event) => { showCalculation = event.target.checked; render(); });
$('settings-open').addEventListener('click', () => $('settings-dialog').showModal());
for (const dialog of ['settings', 'install', 'copy']) $(dialog + '-close').addEventListener('click', () => $(dialog + '-dialog').close());
$('confirm-cancel').addEventListener('click', () => { confirmAction = null; $('confirm-dialog').close(); });
$('confirm-dialog').addEventListener('cancel', () => { confirmAction = null; });
$('confirm-accept').addEventListener('click', () => { const action = confirmAction; confirmAction = null; $('confirm-dialog').close(); action?.(); });
$('copy-button').addEventListener('click', async () => {
  if (result.status !== 'valid') return;
  const text = formatPlan(result, input);
  try { if (!navigator.clipboard) throw new Error('Clipboard unavailable'); await navigator.clipboard.writeText(text); notify('规划结果已复制'); }
  catch { showCopyFallback(text); }
});
$('share-button').addEventListener('click', async () => {
  if (result.status !== 'valid' || !navigator.share) return;
  try { await navigator.share({ title: '监考规划', text: formatPlan(result, input) }); }
  catch (error) { if (error.name !== 'AbortError') notify('暂时无法分享，请使用“复制结果”'); }
});
window.addEventListener('beforeinstallprompt', (event) => { event.preventDefault(); installPrompt = event; });
window.addEventListener('appinstalled', () => { installPrompt = null; $('install-button').hidden = true; notify('已安装到桌面'); });
$('install-button').addEventListener('click', async () => {
  if (!installPrompt) { $('install-dialog').showModal(); return; }
  try { await installPrompt.prompt(); await installPrompt.userChoice; }
  catch { $('install-dialog').showModal(); }
  finally { installPrompt = null; }
});
if (window.matchMedia('(display-mode: standalone)').matches || navigator.standalone) $('install-button').hidden = true;

async function setupOffline() {
  if (!('serviceWorker' in navigator) || !window.isSecureContext) {
    $('offline-status').textContent = '当前环境不支持离线安装，可继续在线计算';
    return;
  }
  try {
    registration = await navigator.serviceWorker.register(new URL('../sw.js', import.meta.url), { updateViaCache: 'none' });
    const showUpdate = () => { $('update-banner').hidden = !(registration.waiting && registration.active); };
    showUpdate();
    registration.addEventListener('updatefound', () => {
      const worker = registration.installing;
      worker?.addEventListener('statechange', () => {
        if (worker.state === 'installed' || worker.state === 'activated') showUpdate();
        if (worker.state === 'redundant' && !registration.active) $('offline-status').textContent = '离线准备未完成，请联网后刷新重试';
      });
    });
    await navigator.serviceWorker.ready;
    showUpdate();
    const updateStatus = () => { $('offline-status').textContent = navigator.onLine ? '离线已就绪 · 数据仅在当前页面有效' : '当前离线 · 可继续计算，刷新后重置'; };
    updateStatus();
    window.addEventListener('online', updateStatus);
    window.addEventListener('offline', updateStatus);
  } catch {
    $('offline-status').textContent = '离线准备未完成，可继续在线计算';
  }
}
if ('serviceWorker' in navigator) navigator.serviceWorker.addEventListener('controllerchange', () => {
  if (updateRequested) window.location.reload();
  else $('update-banner').hidden = true;
});
$('update-button').addEventListener('click', () => confirm('更新应用并重置？', '更新将重新加载页面，当前输入不会保留。', () => {
  if (!registration?.waiting) { notify('新版本尚未就绪，请稍后再试'); return; }
  updateRequested = true;
  registration.waiting.postMessage({ type: 'ACTIVATE_UPDATE' });
}));
window.addEventListener('pageshow', () => resetPage());
resetPage();
void setupOffline();
