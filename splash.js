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

// ---------- 桌面图标（第十期补充，声明必须放在 initSplash() 调用之前） ----------
// 自定义图标的存储钥匙：值 { data }，data 是 512x512 PNG 的 base64
const APP_ICON_KEY = "doumi_app_icon";
// 动态 manifest 的 blob 地址（换图/删图时回收旧的，防内存泄漏）
let dynamicIconUrl = null;
// 静态 manifest.json 的原始地址（删掉自定义图标后还原回去用）
let originalManifestHref = null;

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
  document.getElementById("icon-file").addEventListener("change", onIconFilePicked);
  // 图标槽的点击用 onclick 赋值：renderIconSlot 会反复重画槽内元素，赋值法天然不会重复绑定
  document.getElementById("icon-slot").onclick = () => document.getElementById("icon-file").click();
  renderSplashSlots();
  renderIconSlot();
  applyDynamicManifest(); // 有自定义图标就趁早换掉 manifest，让 Chrome 首次抓取就拿到动态版
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

/* ---------- 6. 桌面图标自定义（第十期补充，存储钥匙等声明在文件顶部） ---------- */

function loadAppIcon() {
  try {
    const icon = JSON.parse(localStorage.getItem(APP_ICON_KEY));
    return icon && icon.data ? icon : null;
  } catch (e) {
    return null;
  }
}

function saveAppIcon(icon) {
  localStorage.setItem(APP_ICON_KEY, JSON.stringify(icon));
}

function removeAppIcon() {
  localStorage.removeItem(APP_ICON_KEY);
}

// 中心正方形裁剪 + 缩到 512x512 PNG：桌面图标的标准规格
// 和开屏的 compressImage 分开写：图标要裁方、要 PNG；开屏要保比例、要 JPEG
function compressSquareIcon(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onerror = reject;
    reader.onload = () => {
      const img = new Image();
      img.onerror = reject;
      img.onload = () => {
        const side = Math.min(img.width, img.height); // 中心最大的正方形
        const sx = (img.width - side) / 2;
        const sy = (img.height - side) / 2;
        const canvas = document.createElement("canvas");
        canvas.width = 512;
        canvas.height = 512;
        canvas.getContext("2d").drawImage(img, sx, sy, side, side, 0, 0, 512, 512);
        resolve({ data: canvas.toDataURL("image/png") });
      };
      img.src = reader.result;
    };
    reader.readAsDataURL(file);
  });
}

// 把 manifest 换成「带自定义图标」的动态版，Chrome 安装时读的就是它。
// 关键点：动态 manifest 里不能用相对路径（blob 地址没有「文件夹」的概念），
// 所以所有地址都用 new URL 换成完整网址
function applyDynamicManifest() {
  const link = document.querySelector('link[rel="manifest"]');
  if (originalManifestHref === null) originalManifestHref = link.href;

  if (dynamicIconUrl) {
    URL.revokeObjectURL(dynamicIconUrl); // 回收上一版，防内存泄漏
    dynamicIconUrl = null;
  }

  const icon = loadAppIcon();
  if (!icon) {
    link.href = originalManifestHref; // 没有自定义图标 = 还原成静态 manifest.json
    return;
  }

  const manifest = {
    name: "豆米小站",
    short_name: "豆米小站",
    description: "记录狗狗豆米的分离焦虑训练和健康成长",
    start_url: new URL("./index.html", location.href).href,
    scope: new URL("./", location.href).href,
    display: "standalone",
    background_color: "#f5872e",
    theme_color: "#f5872e",
    icons: [
      { src: icon.data, sizes: "512x512", type: "image/png" },
      { src: new URL("./icons/icon-192.png", location.href).href, sizes: "192x192", type: "image/png" },
      {
        src: new URL("./icons/icon-512.png", location.href).href,
        sizes: "512x512",
        type: "image/png",
        purpose: "any maskable",
      },
    ],
  };
  dynamicIconUrl = URL.createObjectURL(
    new Blob([JSON.stringify(manifest)], { type: "application/manifest+json" })
  );
  link.href = dynamicIconUrl;

  // iPhone 尽力而为：iOS 不一定认 base64 的触摸图标，不认就回退网页截图，无害
  const touch = document.querySelector('link[rel="apple-touch-icon"]');
  if (touch) touch.href = icon.data;
}

// 画图标槽：有图显示预览 + ✕，没图显示虚线 ＋
function renderIconSlot() {
  const slot = document.getElementById("icon-slot");
  const icon = loadAppIcon();
  slot.innerHTML = "";

  if (icon) {
    slot.className = "icon-slot filled";
    const img = document.createElement("img");
    img.src = icon.data;
    img.alt = "自定义桌面图标";
    const del = document.createElement("button");
    del.className = "splash-slot-del";
    del.textContent = "✕";
    del.addEventListener("click", (e) => {
      e.stopPropagation(); // 别让点击传给槽位，不然又弹选图框
      if (!confirm("恢复默认橙色图标？卸载重装 PWA 后生效")) return;
      removeAppIcon();
      renderIconSlot();
      applyDynamicManifest();
    });
    slot.appendChild(img);
    slot.appendChild(del);
  } else {
    slot.className = "icon-slot empty";
    slot.textContent = "＋";
  }
}

// 选完图标：裁剪压缩入库 → manifest 换成动态版 → 重画槽位
async function onIconFilePicked(event) {
  const file = event.target.files && event.target.files[0];
  event.target.value = ""; // 清掉选择记录，下次选同一张也能触发
  if (!file) return;

  const errEl = document.getElementById("splash-error");
  try {
    saveAppIcon(await compressSquareIcon(file));
    applyDynamicManifest();
    renderIconSlot();
    errEl.textContent = "";
  } catch (e) {
    errEl.textContent = "图标没读出来，换一张试试";
  }
}
