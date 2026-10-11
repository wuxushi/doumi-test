/* ==========================================================
   豆米小站 · 分离焦虑训练记录器
   第四期：计时器 + 云端保存 + 邮箱登录/注册 + 记录按天分组（可展开明细）
   第五期：豆米报告复制 + AI 训练分析（AI 走后端代理，接口位在 config.js）
   游客可先用；注册后游客数据自动归到账号名下；换设备登录即可同步
   前提：config.js 填好 anon key + 云端开了匿名登录 + 建好了表
   ========================================================== */

/* ---------- 1. 数据部分 ---------- */

// 所有训练记录存在这个数组里
// 每条记录：{ startTime: 开始时间, endTime: 结束时间, durationSeconds: 安静秒数 }
let records = [];

// 记录列表里被点开日期（存日期串如 "2026-10-11"），重画列表时好恢复展开状态
const expandedDays = new Set();

/* ---------- 2. 计时器部分 ---------- */

// 计时器只有两种状态：idle（空闲）和 running（计时中）
let timerState = "idle";
// 本轮计时的开始时间戳（毫秒数），用来精确计算过了多久
let startTime = null;
// setInterval 的编号，停止刷新时要靠它
let tickId = null;

// 页面加载完成后：绑定按钮事件 + 渲染初始界面 + 连接云端
document.addEventListener("DOMContentLoaded", () => {
  // 第十期 PWA：注册后台缓存器（只在 https 生效；本地 file:// 双击打开时静默跳过）
  if ("serviceWorker" in navigator && location.protocol === "https:") {
    navigator.serviceWorker.register("sw.js");
  }

  document.getElementById("btn-start").addEventListener("click", onMainClick);
  document.getElementById("btn-reset").addEventListener("click", onResetClick);
  document.getElementById("btn-close-modal").addEventListener("click", hideModal);
  document.getElementById("btn-do-register").addEventListener("click", onRegisterClick);
  document.getElementById("btn-do-login").addEventListener("click", onLoginClick);
  document.getElementById("btn-close-auth").addEventListener("click", closeAuthModal);
  document.getElementById("btn-forgot").addEventListener("click", openForgotModal);
  document.getElementById("btn-send-reset").addEventListener("click", onSendResetClick);
  document.getElementById("btn-back-login").addEventListener("click", closeForgotModal);
  document.getElementById("btn-save-newpass").addEventListener("click", onSaveNewPasswordClick);
  document.getElementById("btn-copy-report").addEventListener("click", openCopyModal);
  document.getElementById("btn-do-copy").addEventListener("click", onCopyClick);
  document.getElementById("btn-close-copy").addEventListener("click", closeCopyModal);
  document.getElementById("btn-ai-analyze").addEventListener("click", onAiAnalyzeClick);
  // 弹窗里的「🤖 AI 分析」按钮：按选中范围生成报告 → 发给 AI
  document.getElementById("btn-do-ai").addEventListener("click", onDoAiClick);
  // 复制弹窗里切到「自选」时才解锁日期框
  document.querySelectorAll('input[name="copy-range"]').forEach((radio) => {
    radio.addEventListener("change", updateDateInputs);
  });

  renderTimer(0);
  renderStats();
  renderRecords();
  initHealth();       // 第七期：健康手册的按钮绑定 + 初始列表
  restoreAiResult(); // 把上次 AI 分析的结论摆回卡片里
  initApp();
});

// 启动云端初始化：连数据库、领游客身份、拉取历史记录
async function initApp() {
  // 还没填 anon key：给个提醒，页面照常能用（数据只存在本页）
  if (!CONFIG.SUPABASE_ANON_KEY || CONFIG.SUPABASE_ANON_KEY.includes("在这里粘贴")) {
    showStatus("⚠️ 还没填 anon key（见 config.js），目前数据只存在本页，刷新会丢");
    return;
  }

  try {
    await initCloud();              // 连接 + 领身份（游客或已登录账号）

    // 从「重置密码」邮件链接跳回来时，自动弹出设置新密码的弹窗
    db.auth.onAuthStateChange((event) => {
      if (event === "PASSWORD_RECOVERY") openNewPassModal();
    });
    records = await fetchRecords(); // 把云端的历史记录拉下来
    await loadHealthCloud();        // 第七期：健康手册的历史记录也拉下来

    renderStats();
    renderRecords();
    if (currentUserEmail) {
      showUserStatus(currentUserEmail); // 已经是正式账号
    } else {
      showGuestStatus();                // 还是游客，给个登录入口
    }
  } catch (e) {
    showStatus("⚠️ 云端连接失败：" + friendlyError(e));
  }
}

// 主按钮：同一个按钮，空闲时是「开始」，计时中是「暂停」
function onMainClick() {
  if (timerState === "idle") {
    startTimer();
  } else {
    pauseAndSave();
  }
}

// 开始计时：记下开始时间，每 0.25 秒刷新一次显示
function startTimer() {
  timerState = "running";
  startTime = Date.now();
  tickId = setInterval(() => renderTimer(getElapsedSeconds()), 250);
  updateButtons();
}

// 计算已过秒数：现在的时间 - 开始的时间（不受 setInterval 卡顿影响，很准）
function getElapsedSeconds() {
  return Math.floor((Date.now() - startTime) / 1000);
}

// 暂停 = 一次训练完成：保存记录 + 弹出奖励提醒
function pauseAndSave() {
  const seconds = getElapsedSeconds();
  clearInterval(tickId);
  timerState = "idle";
  startTime = null;

  // 存一条记录：先放内存让界面立刻有反馈，再传云端永久保存
  const record = {
    startTime: new Date(Date.now() - seconds * 1000),
    endTime: new Date(),
    durationSeconds: seconds,
  };
  records.unshift(record);

  // db 存在 = 云端已连接，把这条记录传上去
  if (db) {
    saveRecordToCloud(record)
      .then((id) => { record.id = id; })
      .catch(() => showStatus("⚠️ 这条没存上云端，网络恢复后重试一次训练即可"));
  }

  updateButtons();
  renderTimer(0);
  renderStats();
  renderRecords();
  showRewardModal(seconds);
}

// 重置 = 狗狗叫了这次不算：丢弃当前计时，归零
function onResetClick() {
  if (timerState !== "running") return;
  clearInterval(tickId);
  timerState = "idle";
  startTime = null;
  updateButtons();
  renderTimer(0);
}

/* ---------- 3. 界面渲染部分 ---------- */

// 更新大号计时数字
function renderTimer(seconds) {
  document.getElementById("timer-display").textContent = formatTime(seconds);
}

// 根据状态切换按钮：文字、颜色、重置按钮显隐
function updateButtons() {
  const mainBtn = document.getElementById("btn-start");
  const resetBtn = document.getElementById("btn-reset");
  const running = timerState === "running";
  mainBtn.textContent = running ? "暂停" : "开始";
  mainBtn.classList.toggle("pausing", running);
  resetBtn.classList.toggle("hidden", !running);
}

// 更新今日统计卡片
function renderStats() {
  const todayRecords = records.filter((r) => isToday(r.startTime));
  const totalSeconds = todayRecords.reduce((sum, r) => sum + r.durationSeconds, 0);
  document.getElementById("stat-total").textContent = formatDuration(totalSeconds);
  document.getElementById("stat-count").textContent = todayRecords.length + " 次";
}

// 把记录按天归堆：返回 [{ dateStr, items }]，新的日期在前
// （records 本来就是新的在前，所以归完堆顺序天然正确；列表和报告都靠它）
function groupRecordsByDay(list) {
  const groups = [];
  list.forEach((r) => {
    const dateStr = toLocalDateStr(r.startTime);
    let group = groups.find((g) => g.dateStr === dateStr);
    if (!group) {
      group = { dateStr: dateStr, items: [] };
      groups.push(group);
    }
    group.items.push(r);
  });
  return groups;
}

// 渲染训练记录：按天分组，每组一行摘要（日期 + 总时长 + 次数）
// 点日期展开/收起当天的时刻明细；多组可同时展开，方便对比
function renderRecords() {
  const listEl = document.getElementById("record-list");
  listEl.innerHTML = ""; // 先清空再重画，简单可靠

  if (records.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "还没有记录，快带豆米开始第一次训练吧！";
    listEl.appendChild(li);
    return;
  }

  const groups = groupRecordsByDay(records);

  const todayStr = toLocalDateStr(new Date());

  groups.forEach((g) => {
    const totalSeconds = g.items.reduce((sum, r) => sum + r.durationSeconds, 0);

    const li = document.createElement("li");
    li.className = "record-group" + (expandedDays.has(g.dateStr) ? " open" : "");

    // 组头：日期（今天会标注）+ 当天总时长和次数 + 展开箭头
    const head = document.createElement("div");
    head.className = "record-day";
    head.innerHTML =
      '<span class="day-label">' + formatDate(g.items[0].startTime) +
      (g.dateStr === todayStr ? " · 今天" : "") + "</span>" +
      '<span class="day-summary">共 ' + formatDuration(totalSeconds) +
      " · " + g.items.length + " 次</span>" +
      '<span class="day-arrow">▾</span>';
    head.addEventListener("click", () => {
      if (expandedDays.has(g.dateStr)) {
        expandedDays.delete(g.dateStr);
      } else {
        expandedDays.add(g.dateStr);
      }
      li.classList.toggle("open");
    });

    // 明细：当天的每条训练（时刻 + 安静多久 + 删除），只有展开时才显示
    const details = document.createElement("ul");
    details.className = "day-details";
    g.items.forEach((r) => {
      const item = document.createElement("li");

      const timeEl = document.createElement("span");
      timeEl.className = "record-time";
      timeEl.textContent = formatClock(r.startTime);

      const durEl = document.createElement("span");
      durEl.className = "record-duration";
      durEl.textContent = "安静了 " + formatDuration(r.durationSeconds);

      const del = document.createElement("button");
      del.className = "record-del";
      del.textContent = "✕";
      del.addEventListener("click", () => onDeleteRecordClick(r));

      item.appendChild(timeEl);
      item.appendChild(durEl);
      item.appendChild(del);
      details.appendChild(item);
    });

    li.appendChild(head);
    li.appendChild(details);
    listEl.appendChild(li);
  });
}

// 点明细里的 ✕：确认后先从列表移除，再删云端
// 用对象引用删而不是 id：断网时新记录还没拿到云端编号（id 是空的），
// 拿 id 删会把同样没编号的记录一起误删
async function onDeleteRecordClick(record) {
  if (!confirm("删掉这条训练记录？删了就找不回来")) return;
  records = records.filter((r) => r !== record);
  renderStats();   // 今日统计里可能正好有这条，跟着重算
  renderRecords();

  // id 为空 = 这条本来就没存上云端，删本地就够了
  if (db && record.id) {
    try {
      await deleteRecordFromCloud(record.id);
    } catch (e) {
      showStatus("⚠️ 云端没删掉，刷新页面看看还在不在");
    }
  }
}

/* ---------- 3.5 豆米报告与复制（第五期） ---------- */

// 快捷方式：最近 days 天（1 / 3 / 7）的报告，具体活交给下面的范围版
function buildReportText(days) {
  const end = new Date();
  const start = new Date();
  start.setDate(start.getDate() - (days - 1));
  return buildReportTextRange(start, end);
}

// 按起止日期生成报告（含头含尾）；范围内一条记录都没有时返回空字符串
// 复制按钮和 AI 分析共用这一份文本，保证两边说的数据一模一样
function buildReportTextRange(startDay, endDay) {
  const start = new Date(startDay);
  start.setHours(0, 0, 0, 0);   // 从起始日 0 点算起
  const end = new Date(endDay);
  end.setHours(23, 59, 59, 999); // 到结束日 23:59:59

  const inRange = records.filter((r) => r.startTime >= start && r.startTime <= end);
  if (inRange.length === 0) return "";

  const groups = groupRecordsByDay(inRange);
  const totalSeconds = inRange.reduce((sum, r) => sum + r.durationSeconds, 0);

  const lines = [];
  lines.push("【豆米的分离焦虑训练记录】");
  lines.push("豆米是一只正在做分离焦虑训练的狗狗：每天多次短时间离开它，记录它保持安静的时长，时长逐步变长 = 在进步。");
  lines.push("范围：" + formatDate(startDay) + " ~ " + formatDate(endDay) +
    "（共 " + inRange.length + " 次训练，累计 " + formatDuration(totalSeconds) + "）");
  lines.push("");
  groups.forEach((g) => {
    const dayTotal = g.items.reduce((sum, r) => sum + r.durationSeconds, 0);
    const isToday = g.dateStr === toLocalDateStr(new Date());
    lines.push(formatDate(g.items[0].startTime) + (isToday ? "（今天）" : "") +
      "：" + g.items.length + " 次，共 " + formatDuration(dayTotal));
    g.items.forEach((r) => {
      lines.push("  " + formatClock(r.startTime) + " 安静了 " + formatDuration(r.durationSeconds));
    });
  });
  return lines.join("\n");
}

// 打开「复制豆米报告」弹窗（每次都把自选日期重置成默认：最早记录日 ~ 今天）
function openCopyModal() {
  document.getElementById("copy-status").textContent = "";
  initCustomRangeDefaults();
  document.getElementById("copy-modal").classList.add("show");
}

// 自定义日期的默认值：自动识别记录——起始 = 最早一条记录那天，结束 = 今天
// （records 是新的在前，最早一条在末尾；一条记录都没有就给今天 ~ 今天）
function initCustomRangeDefaults() {
  const todayStr = toLocalDateStr(new Date());
  const firstStr = records.length > 0 ? toLocalDateStr(records[records.length - 1].startTime) : todayStr;
  document.getElementById("copy-start").value = firstStr;
  document.getElementById("copy-end").value = todayStr;
}

// 切换单选项时：选「自选」才让日期框能点，选 1/3/7 时灰掉
function updateDateInputs() {
  const custom = document.querySelector('input[name="copy-range"]:checked').value === "custom";
  document.getElementById("copy-start").disabled = !custom;
  document.getElementById("copy-end").disabled = !custom;
}

// 关闭弹窗
function closeCopyModal() {
  document.getElementById("copy-modal").classList.remove("show");
}

// 读弹窗里当前选中的范围，生成报告文本
// 返回 { text, error }：范围没选好或没记录时 text 为空、error 带提示
// 「复制到剪贴板」和「🤖 AI 分析」两个按钮共用这一段，保证两边数据一模一样
function getReportFromModal() {
  const mode = document.querySelector('input[name="copy-range"]:checked').value;

  let text = "";
  if (mode === "custom") {
    // 自选模式：读两个日期框（值形如 2026-10-11）
    const startVal = document.getElementById("copy-start").value;
    const endVal = document.getElementById("copy-end").value;
    if (!startVal || !endVal) return { text: "", error: "把起始和结束日期都选上" };
    if (startVal > endVal) return { text: "", error: "起始日期不能晚于结束日期" };
    // 日期串拼上 T00:00:00 再解析，保证按本地时间算，不差时区
    text = buildReportTextRange(new Date(startVal + "T00:00:00"), new Date(endVal + "T00:00:00"));
  } else {
    text = buildReportText(Number(mode));
  }
  if (!text) return { text: "", error: "这个范围还没有训练记录" };
  return { text: text, error: "" };
}

// 点「复制到剪贴板」：按当前选中的范围生成报告并复制
async function onCopyClick() {
  const statusEl = document.getElementById("copy-status");
  const { text, error } = getReportFromModal();
  if (error) { statusEl.textContent = error; return; }

  try {
    await navigator.clipboard.writeText(text);
    closeCopyModal();
    flashCopyButton();
  } catch (e) {
    // 个别浏览器不给用新剪贴板接口，换老办法再试一次
    if (copyByLegacy(text)) {
      closeCopyModal();
      flashCopyButton();
    } else {
      statusEl.textContent = "复制失败了，长按报告文字手动复制吧";
    }
  }
}

// 老式复制兜底：临时放一个看不见的文本框，选中再复制
function copyByLegacy(text) {
  const ta = document.createElement("textarea");
  ta.value = text;
  ta.style.position = "fixed";
  ta.style.opacity = "0";
  document.body.appendChild(ta);
  ta.select();
  let ok = false;
  try { ok = document.execCommand("copy"); } catch (e) { ok = false; }
  document.body.removeChild(ta);
  return ok;
}

// 复制成功后，让入口按钮短暂显示「✓ 已复制」
function flashCopyButton() {
  const btn = document.getElementById("btn-copy-report");
  btn.textContent = "✓ 已复制";
  setTimeout(() => { btn.textContent = "📋 复制豆米信息"; }, 1500);
}

/* ---------- 3.6 AI 分析（第五期） ---------- */

// 点「分析一下」：打开报告弹窗选范围（默认 7 天），在弹窗里点「🤖 AI 分析」才真正发请求
function onAiAnalyzeClick() {
  openCopyModal();
}

// 弹窗里的「🤖 AI 分析」：按选中范围拿到报告，关弹窗 → 发给 AI
function onDoAiClick() {
  const { text, error } = getReportFromModal();
  if (error) {
    document.getElementById("copy-status").textContent = error;
    return;
  }
  closeCopyModal();
  startAiAnalyze(text);
}

// 拿着报告文本请求 AI（范围来自弹窗，不再写死 7 天）
async function startAiAnalyze(reportText) {
  const btn = document.getElementById("btn-ai-analyze");

  // 后端还没部署：接口位是空的
  if (!CONFIG.AI_PROXY_URL) {
    showAiResult("AI 分析还在部署中，过几天回来就能用啦", "");
    return;
  }
  // 云端都没连上（比如断网），拿不到登录凭证
  if (!db) {
    showAiResult("云端还没连上，等页面顶部显示「已连接」后再试", "");
    return;
  }

  // 防连点烧额度：分析中按钮变灰
  btn.disabled = true;
  btn.textContent = "分析中…";

  try {
    const session = (await db.auth.getSession()).data.session;
    const res = await fetch(CONFIG.AI_PROXY_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + session.access_token, // 证明「是本站用户」，代理验完才肯转发
      },
      body: JSON.stringify({ report: reportText }),
    });
    const data = await res.json();
    if (!res.ok) throw new Error(data.error || "AI 服务开小差了");
    showAiResult(data.reply, "分析于 " + formatClock(new Date()));
  } catch (e) {
    showAiResult("分析失败了：" + friendlyAiError(e), "");
  } finally {
    btn.disabled = false;
    btn.textContent = "分析一下";
  }
}

// 显示分析结果（顺手存进浏览器，刷新页面后还能看到上次的结论）
function showAiResult(text, meta) {
  document.getElementById("ai-result").classList.remove("hidden");
  document.getElementById("ai-result-text").textContent = text;
  document.getElementById("ai-meta").textContent = meta;
  try { localStorage.setItem("doumi_ai_result", JSON.stringify({ text: text, meta: meta })); } catch (e) {}
}

// 页面打开时恢复上次的分析结果
function restoreAiResult() {
  try {
    const saved = JSON.parse(localStorage.getItem("doumi_ai_result") || "null");
    if (saved && saved.text) showAiResult(saved.text, saved.meta);
  } catch (e) {}
}

// AI 相关报错翻译成人话
function friendlyAiError(e) {
  const msg = (e && e.message) ? e.message : String(e);
  if (msg.includes("Failed to fetch")) return "连不上后端，检查网络后再试";
  if (msg.includes("401") || msg.includes("403")) return "身份校验没通过，刷新页面再试";
  if (msg.includes("429")) return "分析太频繁啦，等一会儿再试";
  return msg;
}

/* ---------- 4. 弹窗部分 ---------- */

// 弹出奖励提醒
function showRewardModal(seconds) {
  document.getElementById("modal-text").textContent =
    "豆米安静了 " + formatDuration(seconds) + "，现在去奖励它！";
  document.getElementById("reward-modal").classList.add("show");
}

// 关闭弹窗
function hideModal() {
  document.getElementById("reward-modal").classList.remove("show");
}

/* ---------- 5. 小工具函数 ---------- */

// 把秒数格式化成 05:32（满1小时则 1:05:32）
function formatTime(total) {
  const h = Math.floor(total / 3600);
  const m = Math.floor((total % 3600) / 60);
  const s = total % 60;
  const mm = String(m).padStart(2, "0");
  const ss = String(s).padStart(2, "0");
  return h > 0 ? h + ":" + mm + ":" + ss : mm + ":" + ss;
}

// 把秒数变成「X 分 X 秒」这种读法（统计卡片和弹窗用）
function formatDuration(total) {
  if (total < 60) return total + " 秒";
  const m = Math.floor(total / 60);
  const s = total % 60;
  return s === 0 ? m + " 分钟" : m + " 分 " + s + " 秒";
}

// 判断某天是不是今天（年月日都相同才算）
function isToday(date) {
  const now = new Date();
  return date.getFullYear() === now.getFullYear() &&
    date.getMonth() === now.getMonth() &&
    date.getDate() === now.getDate();
}

// 日期转成 10-11 这种短格式
function formatDate(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return m + "-" + d;
}

// 时间转成 14:30 这种短格式
function formatClock(date) {
  const h = String(date.getHours()).padStart(2, "0");
  const m = String(date.getMinutes()).padStart(2, "0");
  return h + ":" + m;
}

/* ---------- 6. 云端状态提示 ---------- */

// 顶部状态条：显示云端连接情况（第三期会升级成「登录提示条」）
function showStatus(text) {
  const el = document.getElementById("status-bar");
  el.textContent = text;
  el.classList.remove("hidden");
}

// 把英文报错翻译成人话
function friendlyError(e) {
  const msg = (e && e.message) ? e.message : String(e);
  if (msg.includes("Anonymous sign-ins are disabled")) {
    return "云端还没开「匿名登录」。去 Supabase 后台 → Authentication → Sign In / Providers，打开 Anonymous 再刷新";
  }
  if (msg.includes("does not exist") || msg.includes("schema cache")) {
    return "云端还没有 training_records 表，去跑一遍建表 SQL（见步骤 2）";
  }
  if (msg.includes("Invalid API key") || msg.includes("apikey")) {
    return "anon key 不对，去 config.js 里重新粘贴";
  }
  if (msg.includes("supabase is not defined")) {
    return "没加载到 Supabase 库，可能是网络问题，刷新或换个网络试试";
  }
  if (msg.includes("Failed to fetch")) {
    return "连不上 Supabase，检查网络后再刷新";
  }
  return msg;
}

/* ---------- 7. 登录 / 注册界面（第三期） ---------- */

// 状态条：游客模式（带登录入口）
function showGuestStatus() {
  const el = document.getElementById("status-bar");
  el.innerHTML = "✅ 已连接云端 · 游客模式：数据自动保存，但换设备或清缓存会丢" +
    ' · <a href="javascript:void(0)" id="link-login">登录 / 注册</a>';
  el.classList.remove("hidden");
  document.getElementById("link-login").addEventListener("click", openAuthModal);
}

// 状态条：已登录（带退出入口）
function showUserStatus(email) {
  const el = document.getElementById("status-bar");
  el.innerHTML = "✅ 已登录：" + email + " · 数据跨设备同步" +
    ' · <a href="javascript:void(0)" id="link-logout">退出</a>';
  el.classList.remove("hidden");
  document.getElementById("link-logout").addEventListener("click", onLogout);
}

// 打开登录/注册弹窗（顺便清空上次的输入和红字）
function openAuthModal() {
  document.getElementById("auth-email").value = "";
  document.getElementById("auth-password").value = "";
  setAuthError("");
  document.getElementById("auth-modal").classList.add("show");
}

// 关闭弹窗
function closeAuthModal() {
  document.getElementById("auth-modal").classList.remove("show");
}

// 往弹窗里的提示位置写字
function setAuthError(text) {
  document.getElementById("auth-error").textContent = text;
}

// 点「注册」：把当前游客身份升级成正式账号
async function onRegisterClick() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;

  // 先做最简单的本地检查，不用等云端跑一趟才知道
  if (!email.includes("@")) { setAuthError("邮箱格式好像不对，检查一下"); return; }
  if (password.length < 6) { setAuthError("密码至少要 6 位"); return; }

  try {
    await registerAccount(email, password);

    // 如果云端开着「邮箱确认」，得先去点邮件里的链接才算注册完成
    const confirmedEmail = (await db.auth.getSession()).data.session.user.email;
    if (!confirmedEmail) {
      setAuthError("注册邮件已发到你的邮箱，点邮件里的链接后就完成了");
      return;
    }
    location.reload(); // 刷新后页面按新身份重新加载
  } catch (e) {
    setAuthError(friendlyAuthError(e));
  }
}

// 点「登录」
async function onLoginClick() {
  const email = document.getElementById("auth-email").value.trim();
  const password = document.getElementById("auth-password").value;
  if (!email.includes("@")) { setAuthError("邮箱格式好像不对，检查一下"); return; }
  if (password.length === 0) { setAuthError("密码还没填"); return; }

  try {
    await loginAccount(email, password);
    location.reload(); // 刷新后按登录的身份拉取数据
  } catch (e) {
    setAuthError(friendlyAuthError(e));
  }
}

// 点「退出」
async function onLogout() {
  try {
    await logoutAccount();
  } finally {
    location.reload(); // 无论如何都刷新，回到游客状态
  }
}

// 把账号相关的英文报错翻译成人话
function friendlyAuthError(e) {
  const msg = (e && e.message) ? e.message : String(e);
  if (msg.includes("already registered")) {
    return "这个邮箱已经注册过了，直接点「登录」";
  }
  if (msg.includes("Invalid login credentials")) {
    return "邮箱或密码不对，再试试";
  }
  if (msg.includes("at least 6") || msg.includes("Password should be")) {
    return "密码至少要 6 位";
  }
  if (msg.includes("rate limit") || msg.includes("once every 60 seconds")) {
    return "发得太频繁了，等几分钟再试";
  }
  if (msg.includes("valid email") || msg.includes("invalid")) {
    return "邮箱格式好像不对，检查一下";
  }
  return msg;
}

/* ---------- 8. 忘记密码 / 重置密码（第三期补充） ---------- */

// 打开「找回密码」弹窗
function openForgotModal() {
  closeAuthModal();
  document.getElementById("forgot-email").value = "";
  setForgotStatus("");
  document.getElementById("forgot-modal").classList.add("show");
}

// 关闭「找回密码」弹窗
function closeForgotModal() {
  document.getElementById("forgot-modal").classList.remove("show");
}

// 写找回弹窗里的提示文字（成功时变绿色）
function setForgotStatus(text, isSuccess) {
  const el = document.getElementById("forgot-status");
  el.textContent = text;
  el.classList.toggle("auth-success", !!isSuccess);
}

// 点「发送重置邮件」
async function onSendResetClick() {
  const email = document.getElementById("forgot-email").value.trim();
  if (!email.includes("@")) { setForgotStatus("邮箱格式好像不对，检查一下"); return; }

  try {
    await sendResetEmail(email);
    // 出于安全考虑，不管这邮箱注册没注册过，云端都不会明说，统一提示去收信
    setForgotStatus("邮件已发出，去邮箱点「重置密码」链接（记得翻翻垃圾邮件）", true);
  } catch (e) {
    setForgotStatus(friendlyAuthError(e));
  }
}

// 从邮件链接跳回页面时，自动弹出「设置新密码」
function openNewPassModal() {
  document.getElementById("newpass-input").value = "";
  document.getElementById("newpass-status").textContent = "";
  document.getElementById("newpass-modal").classList.add("show");
}

// 点「保存新密码」
async function onSaveNewPasswordClick() {
  const password = document.getElementById("newpass-input").value;
  if (password.length < 6) {
    document.getElementById("newpass-status").textContent = "密码至少要 6 位";
    return;
  }

  try {
    await updatePassword(password);
    location.reload(); // 保存成功，刷新后按已登录状态显示
  } catch (e) {
    document.getElementById("newpass-status").textContent = friendlyAuthError(e);
  }
}
