// ==========================================================
// ai-analyze：AI 分析的「中间人」函数（第五期）
//
// 作用：浏览器把训练报告发给它 → 它先验明身份、再限流，
//       然后拿着钥匙（存在 Supabase 保险箱里）去调阿里通义，
//       最后把 AI 的结论转交回浏览器。
// 钥匙绝不放进网页代码里，防止被人扒走白嫖。
// ==========================================================

import { createClient } from "npm:@supabase/supabase-js@2";

// Supabase 平台会自动注入这两个环境变量，不用手动配置
const SUPABASE_URL = Deno.env.get("SUPABASE_URL")!;
const SUPABASE_ANON_KEY = Deno.env.get("SUPABASE_ANON_KEY")!;

// 阿里百炼的钥匙：部署后用 `supabase secrets set DASHSCOPE_API_KEY=xxx` 存进保险箱
const DASHSCOPE_API_KEY = Deno.env.get("DASHSCOPE_API_KEY") ?? "";
// 模型名也放保险箱，想换模型改 secret 就行，不用重新部署
const AI_MODEL = Deno.env.get("AI_MODEL") ?? "qwen-turbo";

// 阿里通义的 OpenAI 兼容接口
const DASHSCOPE_URL =
  "https://dashscope.aliyuncs.com/compatible-mode/v1/chat/completions";

// AI 的人设：训练师口吻 + 总结趋势 + 1~2 条建议 + 200 字内口语化中文
const SYSTEM_PROMPT =
  "你是一位经验丰富、语气亲切的狗狗分离焦虑训练师。用户会发来一段训练记录报告" +
  "（含日期、每天总时长、训练次数等）。请你：1）用两三句话总结这段时间的训练趋势；" +
  "2）给出1~2条具体可操作的建议；3）全程口语化中文，总字数控制在200字以内；" +
  "4）如果记录很少，就温柔提醒数据还不多，先给一条简单建议就好。";

// ---------- 小工具：统一返回 JSON，并带上跨域头 ----------
// 网页将来放在 GitHub Pages 上，域名和函数不同源，必须允许跨域
const CORS_HEADERS = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, content-type, apikey",
  "Access-Control-Allow-Methods": "POST, OPTIONS",
};

function json(data: unknown, status = 200) {
  return new Response(JSON.stringify(data), {
    status,
    headers: { ...CORS_HEADERS, "Content-Type": "application/json" },
  });
}

// ---------- 简易限流：每个用户每小时最多 20 次 ----------
// 说明：函数实例可能不止一个，这是「尽力而为」的限流，防的是手滑连点和脚本狂刷
const rateMap = new Map<string, { count: number; resetAt: number }>();
const RATE_LIMIT = 20;
const RATE_WINDOW_MS = 60 * 60 * 1000;

function allow(userId: string): boolean {
  const now = Date.now();
  const record = rateMap.get(userId);
  // 时间窗口过期了就重新计
  if (!record || record.resetAt <= now) {
    rateMap.set(userId, { count: 1, resetAt: now + RATE_WINDOW_MS });
    return true;
  }
  if (record.count >= RATE_LIMIT) return false;
  record.count += 1;
  return true;
}

// ---------- 主逻辑 ----------
Deno.serve(async (req) => {
  // 浏览器跨域会先发一个 OPTIONS「探路」请求，直接放行
  if (req.method === "OPTIONS") {
    return new Response("ok", { headers: CORS_HEADERS });
  }
  if (req.method !== "POST") return json({ error: "只支持 POST 请求" }, 405);

  // 第 1 步：验明正身 —— 前端带来的登录令牌（JWT）必须是真的
  const authHeader = req.headers.get("Authorization") ?? "";
  if (!authHeader.startsWith("Bearer ")) {
    return json({ error: "请先登录再使用 AI 分析" }, 401);
  }

  const supabase = createClient(SUPABASE_URL, SUPABASE_ANON_KEY, {
    global: { headers: { Authorization: authHeader } },
    auth: { persistSession: false },
  });
  const { data: userData, error: userError } = await supabase.auth.getUser();
  if (userError || !userData?.user) {
    return json({ error: "登录状态已失效，请重新登录" }, 401);
  }

  // 第 2 步：限流，保护免费额度
  if (!allow(userData.user.id)) {
    return json({ error: "分析次数太频繁啦，一小时后再来吧" }, 429);
  }

  // 第 3 步：检查报告内容
  const body = await req.json().catch(() => null);
  const report = body?.report;
  if (typeof report !== "string" || !report.trim()) {
    return json({ error: "报告内容是空的，没法分析" }, 400);
  }
  if (report.length > 50000) {
    return json({ error: "报告太长了，请缩小日期范围" }, 400);
  }

  // 钥匙没配好：直接提示，而不是硬着头皮去调 AI
  if (!DASHSCOPE_API_KEY) {
    return json({ error: "AI 服务还没配置好，请联系站长" }, 500);
  }

  // 第 4 步：拿钥匙去调阿里通义（60 秒没回话就放弃）
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, 60_000);

  try {
    const aiRes = await fetch(DASHSCOPE_URL, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Authorization: `Bearer ${DASHSCOPE_API_KEY}`,
      },
      body: JSON.stringify({
        model: AI_MODEL,
        messages: [
          { role: "system", content: SYSTEM_PROMPT },
          { role: "user", content: report },
        ],
      }),
      signal: controller.signal,
    });

    const aiData = await aiRes.json().catch(() => null);
    if (!aiRes.ok) {
      // 阿里返回的错误透传一句，方便排查（比如额度用完、key 填错）
      const detail = aiData?.error?.message || `AI 返回状态码 ${aiRes.status}`;
      return json({ error: `AI 出错了：${detail}` }, 502);
    }

    const reply = aiData?.choices?.[0]?.message?.content;
    if (!reply) return json({ error: "AI 没有返回内容，稍后再试" }, 502);

    // 第 5 步：按前端约定好的格式交差 { reply: "..." }
    return json({ reply });
  } catch (_e) {
    const msg = timedOut
      ? "AI 想太久了（超时），稍后再试"
      : "AI 服务连不上，稍后再试";
    return json({ error: msg }, 504);
  } finally {
    clearTimeout(timer);
  }
});
