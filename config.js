/* ==========================================================
   配置文件：连接云数据库的两样东西
   ========================================================== */

const CONFIG = {
  // 你的 Supabase 项目地址（已经帮你填好了）
  SUPABASE_URL: "https://beofllfhqeatxfqjailu.supabase.co",

  // ← 把你复制的 anon key 粘贴到下面这对引号中间（步骤③）
  SUPABASE_ANON_KEY: "sb_publishable_6N0dCcZ-_ZdsEwk0pDmbkw_sgTsImFL",

  // AI 分析的后端代理地址（第五期）：部署好 Supabase 边缘函数后填入
  // 形如 https://beofllfhqeatxfqjailu.supabase.co/functions/v1/ai-analyze
  // 留空 = AI 分析按钮显示「部署中」提示，其他功能不受影响
  AI_PROXY_URL: "https://beofllfhqeatxfqjailu.supabase.co/functions/v1/ai-analyze",
};
