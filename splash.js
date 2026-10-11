/* ==========================================================
   豆米小站 · 开屏动画模块（第十期）
   打开小站时先全屏展示一张照片 1.5 秒再淡出：
   - 照片最多 3 张，存在浏览器 localStorage（不上云端，换设备不跟随）
   - 只在「冷启动」显示：关掉窗口重开才有；同一会话内刷新、切后台都不打扰
   - 没传照片时显示默认款：橙色底 + 「豆米小家」
   - 右上角 🖼️ 按钮打开设置弹窗管理照片
   ========================================================== */

/* ---------- 1. 存储部分 ---------- */

// 照片列表的存储钥匙：值是 [{ id, data }]，data 是压缩后的 base64 图片
const SPLASH_PHOTOS_KEY = "doumi_splash_photos";
// 「本次会话已亮过开屏」的标记：存 sessionStorage，关掉窗口自动清空
const SPLASH_SHOWN_KEY = "doumi_splash_shown";
// 开屏最多几张照片
const SPLASH_MAX = 3;

// 读照片列表（没有存过 / 内容坏了，都当空数组处理）
function loadSplashPhotos() {
  try {
    const list = JSON.parse(localStorage.getItem(SPLASH_PHOTOS_KEY));
    return Array.isArray(list) ? list : [];
  } catch (e) {
    return [];
  }
}

// 存照片列表；浏览器容量满了会抛错，交给调用方提示
function saveSplashPhotos(list) {
  localStorage.setItem(SPLASH_PHOTOS_KEY, JSON.stringify(list));
}

/* ---------- 2. 初始化 ---------- */

function initSplash() {
  document.getElementById("btn-open-splash").addEventListener("click", openSplashModal);
  document.getElementById("btn-close-splash").addEventListener("click", closeSplashModal);
  document.getElementById("splash-file").addEventListener("change", onSplashFilePicked);
  renderSplashSlots();
  showSplashOnce();
}

initSplash();

/* ---------- 3. 开屏显示（核心） ---------- */

// 冷启动判定：sessionStorage 有标记 = 这次的窗口已经亮过开屏 = 直接跳过。
// 关掉窗口 / 标签页重开时 sessionStorage 自动清空，开屏就又会亮一次
function showSplashOnce() {
  if (sessionStorage.getItem(SPLASH_SHOWN_KEY)) return;
  sessionStorage.setItem(SPLASH_SHOWN_KEY, "1");

  const overlay = document.getElementById("splash-overlay");
  const img = document.getElementById("splash-img");
  const title = document.getElementById("splash-title");

  const photos = loadSplashPhotos();
  if (photos.length > 0) {
    // 有照片：随机抽一张铺满整屏，底部的四个字收起来
    const pick = photos[Math.floor(Math.random() * photos.length)];
    img.src = pick.data;
    img.classList.remove("hidden");
    title.classList.add("hidden");
  }
  // 没照片就不动页面：橙色底 +「豆米小家」是 HTML 里写好的默认款

  overlay.classList.add("show");                 // 0.4 秒淡入
  setTimeout(hideSplash, 1500);                  // 满 1.5 秒自动淡出
  overlay.addEventListener("click", hideSplash, { once: true }); // 等不及点一下就走
}

function hideSplash() {
  document.getElementById("splash-overlay").classList.remove("show");
}

/* ---------- 4. 设置弹窗 ---------- */

function openSplashModal() {
  document.getElementById("splash-error").textContent = "";
  renderSplashSlots();
  document.getElementById("splash-modal").classList.add("show");
}

function closeSplashModal() {
  document.getElementById("splash-modal").classList.remove("show");
}

// 画 3 个照片槽：传过的显示缩略图 + 删除 ✕，空槽显示 ＋ 点击去选图
function renderSplashSlots() {
  const wrap = document.getElementById("splash-slots");
  wrap.innerHTML = "";
  const photos = loadSplashPhotos();

  for (let i = 0; i < SPLASH_MAX; i++) {
    const slot = document.createElement("div");
    const photo = photos[i];

    if (photo) {
      slot.className = "splash-slot filled";
      const thumb = document.createElement("img");
      thumb.src = photo.data;
      thumb.alt = "开屏照片";
      const del = document.createElement("button");
      del.className = "splash-slot-del";
      del.textContent = "✕";
      del.addEventListener("click", () => onDeleteSplashPhoto(photo));
      slot.appendChild(thumb);
      slot.appendChild(del);
    } else {
      slot.className = "splash-slot empty";
      slot.textContent = "＋";
      slot.addEventListener("click", () => document.getElementById("splash-file").click());
    }
    wrap.appendChild(slot);
  }
}

function onDeleteSplashPhoto(photo) {
  if (!confirm("删掉这张开屏照片？")) return;
  saveSplashPhotos(loadSplashPhotos().filter((p) => p.id !== photo.id));
  renderSplashSlots();
}

/* ---------- 5. 选图 → 压缩 → 保存 ---------- */

// 手机拍一张照片就好几 MB，直接塞 localStorage 会撑爆；
// 用 canvas 缩到最长边 1080、转成 JPEG，一张只剩 200KB 左右
function compressImage(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const scale = Math.min(1, 1080 / Math.max(img.width, img.height));
        const canvas = document.createElement("canvas");
        canvas.width = Math.round(img.width * scale);
        canvas.height = Math.round(img.height * scale);
        const ctx = canvas.getContext("2d");
        ctx.fillStyle = "#ffffff"; // 透明 PNG 转 JPEG 时垫白底，防止变黑
        ctx.fillRect(0, 0, canvas.width, canvas.height);
        ctx.drawImage(img, 0, 0, canvas.width, canvas.height);
        resolve({
          id: Date.now() + "-" + Math.random().toString(36).slice(2, 7),
          data: canvas.toDataURL("image/jpeg", 0.75),
        });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 选完照片：逐张压缩入库，满 3 张就停；浏览器存不下时给一句人话提示
async function onSplashFilePicked(event) {
  const files = Array.from(event.target.files || []);
  event.target.value = ""; // 清掉选择记录，下次选同一张图也能正常触发
  if (files.length === 0) return;

  const errEl = document.getElementById("splash-error");
  errEl.textContent = "";
  let photos = loadSplashPhotos();

  for (const file of files) {
    if (photos.length >= SPLASH_MAX) {
      errEl.textContent = "最多 3 张，多的没放进去";
      break;
    }
    try {
      photos.push(await compressImage(file));
    } catch (e) {
      errEl.textContent = "有张图没读出来，换一张试试";
    }
  }

  try {
    saveSplashPhotos(photos);
  } catch (e) {
    // 存不进去 = localStorage 还是旧内容，重新读回来即可
    photos = loadSplashPhotos();
    errEl.textContent = "浏览器存满了，删掉一两张再试";
  }
  renderSplashSlots();
}
