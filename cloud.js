/* ==========================================================
   云端数据层：所有「跟 Supabase 打交道」的代码都集中在这里
   app.js 只管界面，这个文件只管云端，分工清楚好排查
   ========================================================== */

// 数据库连接对象（initCloud 之后才能用）
let db = null;
// 当前用户的编号（匿名用户也有编号，存记录时要写上"这是谁的"）
let currentUserId = null;
// 当前账号的邮箱（游客身份时是 null，注册/登录后才有值）
let currentUserEmail = null;

// 初始化：连接数据库 + 确保手上有身份（没有就领一个匿名身份）
async function initCloud() {
  // 用网址 + 钥匙建立连接（相当于"输对网址、刷对门禁卡"）
  db = supabase.createClient(CONFIG.SUPABASE_URL, CONFIG.SUPABASE_ANON_KEY);

  // 看看浏览器里有没有上次留下的登录身份（localStorage 自动保存的）
  let session = (await db.auth.getSession()).data.session;

  if (!session) {
    // 第一次来：领一个匿名（游客）身份，不用注册
    const res = await db.auth.signInAnonymously();
    if (res.error) throw res.error;
    session = res.data.session;
  }

  // 记下自己的用户编号和邮箱
  currentUserId = session.user.id;
  currentUserEmail = session.user.email || null;
}

// 从云端拉取最近的训练记录（最多100条，够用很久）
async function fetchRecords() {
  const { data, error } = await db
    .from("training_records")                 // 选哪张表
    .select("*")                              // 要哪些列，* = 全部
    .order("start_time", { ascending: false })// 按时间新的在前
    .limit(100);                              // 最多拿100条

  if (error) throw error;
  return data.map(rowToRecord);
}

// 存一条新记录到云端，成功后返回这条记录的编号（id）
async function saveRecordToCloud(record) {
  const { data, error } = await db
    .from("training_records")
    .insert({
      user_id: currentUserId,                       // 这条记录是谁的
      start_time: record.startTime.toISOString(),   // 时间转成通用格式
      end_time: record.endTime.toISOString(),
      duration_seconds: record.durationSeconds,
      date: toLocalDateStr(record.startTime),       // 训练日期，按天统计用
      note: "",
    })
    .select()   // 让云端把存好的那条（含编号）还给我们
    .single();  // 只要一条

  if (error) throw error;
  return data.id;
}

// 从云端删除一条记录
async function deleteRecordFromCloud(id) {
  const { error } = await db
    .from("training_records")
    .delete()
    .eq("id", id); // 条件：id 等于要删的那条

  if (error) throw error;
}

/* ---------- 小工具函数 ---------- */

// 把云端返回的一行数据，转换成页面用的格式（列名 → 好懂的驼峰名）
function rowToRecord(row) {
  return {
    id: row.id,
    startTime: new Date(row.start_time),
    endTime: new Date(row.end_time),
    durationSeconds: row.duration_seconds,
  };
}

// 取本地日期的 YYYY-MM-DD 字符串（比如 2026-10-11）
function toLocalDateStr(date) {
  const m = String(date.getMonth() + 1).padStart(2, "0");
  const d = String(date.getDate()).padStart(2, "0");
  return date.getFullYear() + "-" + m + "-" + d;
}

/* ---------- 账号部分（第三期新增） ---------- */

// 注册 = 把当前游客身份「升级」成正式账号（邮箱+密码）
// 关键点：升级后用户编号不变，所以游客期间的记录自动归到账号名下，不用迁移数据
async function registerAccount(email, password) {
  const res = await db.auth.updateUser({ email: email, password: password });
  if (res.error) throw res.error;
}

// 登录 = 用已有账号的邮箱密码换回身份，云端会自动把记录发给我们
async function loginAccount(email, password) {
  const res = await db.auth.signInWithPassword({ email: email, password: password });
  if (res.error) throw res.error;
}

// 退出登录（退出后页面会刷新，重新当游客）
async function logoutAccount() {
  const res = await db.auth.signOut();
  if (res.error) throw res.error;
}

// 发送找回密码邮件（链接发到邮箱；点开链接回到页面时会自动弹出「设置新密码」）
async function sendResetEmail(email) {
  const res = await db.auth.resetPasswordForEmail(email);
  if (res.error) throw res.error;
}

// 保存新密码（必须先点过邮件里的重置链接，云端才允许改）
async function updatePassword(newPassword) {
  const res = await db.auth.updateUser({ password: newPassword });
  if (res.error) throw res.error;
}
