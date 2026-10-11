/* ==========================================================
   豆米小站 · 健康手册模块（第七期）
   记录驱虫和疫苗：类型 + 名称 + 日期 + 备注
   界面逻辑在这个文件；云端操作全在 cloud.js，分工同 app.js
   数据存云端 health_records 表；游客可用，注册后数据自动归到账号名下
   ========================================================== */

/* ---------- 1. 数据部分 ---------- */

// 类型对照表：云端存英文代号，页面显示中文
const HEALTH_TYPES = {
  deworm: { label: "驱虫", emoji: "🐛" },
  vaccine: { label: "疫苗", emoji: "💉" },
};

// 所有健康记录（新的在前）
// 每条：{ id, type, name, date: "2026-10-01", note }
let healthRecords = [];

/* ---------- 2. 初始化 ---------- */

// 页面加载完成时由 app.js 调用：绑按钮 + 画初始列表
function initHealth() {
  document.getElementById("btn-add-health").addEventListener("click", openHealthModal);
  document.getElementById("btn-add-booking").addEventListener("click", openBookingModal);
  document.getElementById("btn-save-booking").addEventListener("click", onSaveBookingClick);
  document.getElementById("btn-close-booking").addEventListener("click", closeBookingModal);
  document.getElementById("btn-save-health").addEventListener("click", onSaveHealthClick);
  document.getElementById("btn-close-health").addEventListener("click", closeHealthModal);
  renderHealthList();
}

// 云端连上后拉历史记录（app.js 的 initApp 会调）
async function loadHealthCloud() {
  try {
    healthRecords = await fetchHealthRecords();
    renderHealthList();
    renderBookingBar(); // 有预约的话，首页提醒条也亮出来
  } catch (e) {
    showStatus("⚠️ 健康记录没拉下来：" + friendlyError(e));
  }
}

/* ---------- 3. 添加记录弹窗 ---------- */

// 打开弹窗：清空上次的输入，日期默认今天
function openHealthModal() {
  document.getElementById("health-name").value = "";
  document.getElementById("health-note").value = "";
  document.getElementById("health-date").value = toLocalDateStr(new Date());
  document.getElementById("health-error").textContent = "";
  document.getElementById("health-modal").classList.add("show");
}

// 关闭弹窗
function closeHealthModal() {
  document.getElementById("health-modal").classList.remove("show");
}

/* ---------- 3.5 预约弹窗（第九期） ---------- */

// 打开预约弹窗：清空上次输入，预约日期默认今天（自己改到要约的那天）
function openBookingModal() {
  document.getElementById("booking-name").value = "";
  document.getElementById("booking-note").value = "";
  document.getElementById("booking-date").value = toLocalDateStr(new Date());
  document.getElementById("booking-error").textContent = "";
  document.getElementById("booking-modal").classList.add("show");
}

// 关闭预约弹窗
function closeBookingModal() {
  document.getElementById("booking-modal").classList.remove("show");
}

// 点「保存预约」：预约是一条「还没做」的记录——
// 不用填哪天做过！真正的预约日存进 nextDate，date 先存今天占位
async function onSaveBookingClick() {
  const type = document.querySelector('input[name="booking-type"]:checked').value;
  const name = document.getElementById("booking-name").value.trim();
  const bookingDay = document.getElementById("booking-date").value;
  const note = document.getElementById("booking-note").value.trim();
  const errEl = document.getElementById("booking-error");

  if (!name) { errEl.textContent = "名称还没填，比如「狂犬疫苗年针」"; return; }
  if (!bookingDay) { errEl.textContent = "选一下预约哪天"; return; }
  const todayStr = toLocalDateStr(new Date());
  if (bookingDay < todayStr) { errEl.textContent = "预约日期不能是昨天及之前"; return; }

  const record = { id: null, type: type, name: name, date: todayStr, note: note, nextDate: bookingDay };
  healthRecords.unshift(record);
  renderBookingBar(); // 首页提醒条立刻亮出来
  closeBookingModal();

  if (db) {
    try {
      record.id = await saveHealthRecordToCloud(record);
    } catch (e) {
      showStatus("⚠️ 这条没存上云端，网络恢复后重新约一次即可");
    }
  }
}

// 点「保存」：先放内存让列表立刻出现，再传云端永久保存（和训练记录同套路）
async function onSaveHealthClick() {
  const type = document.querySelector('input[name="health-type"]:checked').value;
  const name = document.getElementById("health-name").value.trim();
  const date = document.getElementById("health-date").value;
  const note = document.getElementById("health-note").value.trim();
  const errEl = document.getElementById("health-error");

  // 最简单的检查，不用等云端跑一趟才知道填没填对
  if (!name) { errEl.textContent = "名称还没填，比如「福来恩体外驱虫」"; return; }
  if (!date) { errEl.textContent = "选一下是哪天做的"; return; }

  const record = { id: null, type: type, name: name, date: date, note: note };
  healthRecords.unshift(record); // 新的放最前面
  renderHealthList();
  closeHealthModal();

  // db 存在 = 云端已连接，把这条传上去；成功后补上编号，删除时要用
  if (db) {
    try {
      record.id = await saveHealthRecordToCloud(record);
    } catch (e) {
      showStatus("⚠️ 这条没存上云端，网络恢复后重新记一次即可");
    }
  }
}

/* ---------- 4. 删除记录 ---------- */

// 点 ✕：确认后先从列表移除，再删云端
// 传对象而不是 id：断网时新记录还没拿到云端编号（id 是空的），
// 拿 id 删会把同样没编号的记录一起误删
async function onDeleteHealthClick(record) {
  if (!confirm("删掉这条记录？删了就找不回来")) return;
  healthRecords = healthRecords.filter((r) => r !== record);
  renderHealthList();
  renderBookingBar(); // 删的若是带预约的，首页提醒条也要跟着消失

  // id 为空 = 这条本来就没存上云端，删本地就够了
  if (db && record.id) {
    try {
      await deleteHealthRecordFromCloud(record.id);
    } catch (e) {
      showStatus("⚠️ 云端没删掉，刷新页面看看还在不在");
    }
  }
}

/* ---------- 5. 渲染列表 ---------- */

// 画健康记录列表：每条一行（类型徽章 + 名称 + 日期 + 删除），有备注再加一行小字
// 全程用 DOM API 和 textContent 填内容，用户填的文字永远不会被当代码执行
function renderHealthList() {
  const listEl = document.getElementById("health-list");
  listEl.innerHTML = ""; // 先清空再重画，简单可靠

  if (healthRecords.length === 0) {
    const li = document.createElement("li");
    li.className = "empty";
    li.textContent = "还没有健康记录，点右上角「＋ 记一笔」";
    listEl.appendChild(li);
    return;
  }

  healthRecords.forEach((r) => {
    if (r.nextDate) return; // 带预约的是「还没做的」，只显示在首页预约条
    const t = HEALTH_TYPES[r.type] || { label: r.type, emoji: "❓" };

    const li = document.createElement("li");
    li.className = "health-item";

    // 一行：类型徽章 + 名称 + 日期 + 删除小按钮
    const row = document.createElement("div");
    row.className = "health-row";

    const badge = document.createElement("span");
    badge.className = "health-badge " + (r.type === "vaccine" ? "vaccine" : "deworm");
    badge.textContent = t.emoji + " " + t.label;

    const nameEl = document.createElement("span");
    nameEl.className = "health-name";
    nameEl.textContent = r.name;

    const dateEl = document.createElement("span");
    dateEl.className = "health-date";
    dateEl.textContent = r.date;

    const del = document.createElement("button");
    del.className = "health-del";
    del.textContent = "✕";
    del.addEventListener("click", () => onDeleteHealthClick(r));

    row.appendChild(badge);
    row.appendChild(nameEl);
    row.appendChild(dateEl);
    row.appendChild(del);
    li.appendChild(row);

    // 有备注才加第二行小字
    if (r.note) {
      const noteEl = document.createElement("p");
      noteEl.className = "health-note";
      noteEl.textContent = r.note;
      li.appendChild(noteEl);
    }

    listEl.appendChild(li);
  });
}

/* ---------- 6. 首页预约提醒条（第九期） ---------- */

// 预约不是单独的数据：健康记录里「下次预约日期」没空的就算一条预约
// 提醒条挂在首页大标题下面，醒目；没有预约时整个隐藏，一点不占地方
function renderBookingBar() {
  const bar = document.getElementById("booking-bar");

  // 挑出有预约的记录，预约日期早的排前面
  const bookings = healthRecords
    .filter((r) => r.nextDate)
    .sort((a, b) => (a.nextDate < b.nextDate ? -1 : 1));

  if (bookings.length === 0) {
    bar.classList.add("hidden");
    bar.innerHTML = "";
    return;
  }

  bar.classList.remove("hidden");
  bar.innerHTML = ""; // 先清空再重画，简单可靠

  const title = document.createElement("p");
  title.className = "booking-title";
  title.textContent = "⏰ 豆米的健康预约（点条目可操作）";
  bar.appendChild(title);

  bookings.forEach((r) => {
    const t = HEALTH_TYPES[r.type] || { label: r.type, emoji: "❓" };
    const left = bookingDaysLeft(r.nextDate);

    const item = document.createElement("div");
    item.className = "booking-item" + (left <= 0 ? " urgent" : "");

    // 一行：emoji + 名称，右边日期和倒计时人话
    const head = document.createElement("div");
    head.className = "booking-head";

    const label = document.createElement("span");
    label.textContent = t.emoji + " " + r.name;

    const days = document.createElement("span");
    days.className = "booking-days";
    days.textContent = r.nextDate.slice(5) + " · " +
      (left === 0 ? "就是今天！" : left < 0 ? "已过 " + (-left) + " 天" : "还剩 " + left + " 天");

    head.appendChild(label);
    head.appendChild(days);

    // 操作按钮平时藏着，点条目才展开，主站保持干净
    const actions = document.createElement("div");
    actions.className = "booking-actions";

    const done = document.createElement("button");
    done.className = "btn-booking-done";
    done.textContent = "✓ 已完成";
    done.addEventListener("click", () => onBookingDoneClick(r));

    const del = document.createElement("button");
    del.className = "btn-booking-del";
    del.textContent = "🗑 删除记录";
    del.addEventListener("click", () => onDeleteHealthClick(r));

    actions.appendChild(done);
    actions.appendChild(del);

    head.addEventListener("click", () => item.classList.toggle("open"));

    item.appendChild(head);
    item.appendChild(actions);
    bar.appendChild(item);
  });
}

// 算预约日还差几天：正数=还剩几天，0=今天，负数=过了几天
// 两边都归到当天 0 点再相减，避免时分秒捣乱
function bookingDaysLeft(dateStr) {
  const target = new Date(dateStr + "T00:00:00");
  const today = new Date();
  today.setHours(0, 0, 0, 0);
  return Math.round((target - today) / 86400000); // 86400000 = 一天的毫秒数
}

// 点「✓ 已完成」：预约自动变成一条当天的已做记录（日期改成今天，预约清空）
async function onBookingDoneClick(record) {
  if (!confirm("「" + record.name + "」已经做完了吗？完成后会变成一条今天的记录")) return;

  const todayStr = toLocalDateStr(new Date());
  record.date = todayStr;   // 日期改成实际完成日
  record.nextDate = null;   // 预约清空
  renderBookingBar();
  renderHealthList(); // 这条现在能正常出现在记录列表里了

  if (db && record.id) {
    try {
      await completeHealthBooking(record.id, todayStr);
    } catch (e) {
      showStatus("⚠️ 云端没更新，刷新页面看看预约还在不在");
    }
  }
}
