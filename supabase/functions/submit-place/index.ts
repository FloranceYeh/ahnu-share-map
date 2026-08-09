import { createClient } from "https://esm.sh/@supabase/supabase-js@2";

const allowedOrigins = new Set(
  (
    Deno.env.get("ALLOWED_ORIGINS") ||
    "https://map.florance.top,http://localhost:5173,http://127.0.0.1:5173"
  )
    .split(",")
    .map((origin) => origin.trim())
    .filter(Boolean),
);
const allowedTurnstileHostnames = new Set(
  (
    Deno.env.get("TURNSTILE_ALLOWED_HOSTNAMES") ||
    "map.florance.top,localhost,127.0.0.1"
  )
    .split(",")
    .map((hostname) => hostname.trim().toLowerCase())
    .filter(Boolean),
);
const MAX_BODY_BYTES = 64 * 1024;
const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[1-5][0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/i;
const IMAGE_PATH_PATTERN = /^[0-9a-f-]{36}\/[A-Za-z0-9._-]{1,180}$/i;

const corsHeaders = (origin: string | null) => {
  const headers: Record<string, string> = {
    "Access-Control-Allow-Headers":
      "authorization, x-client-info, apikey, content-type",
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    Vary: "Origin",
  };
  if (origin && allowedOrigins.has(origin))
    headers["Access-Control-Allow-Origin"] = origin;
  return headers;
};

const json = (body: unknown, status: number, origin: string | null) =>
  new Response(JSON.stringify(body), {
    status,
    headers: {
      ...corsHeaders(origin),
      "Content-Type": "application/json",
      "Cache-Control": "no-store",
    },
  });

const fail = (message: string): never => {
  throw new Error(`INPUT:${message}`);
};

function stringValue(
  value: unknown,
  field: string,
  maxLength: number,
  required: true,
): string;
function stringValue(
  value: unknown,
  field: string,
  maxLength: number,
  required?: false,
): string | null;
function stringValue(
  value: unknown,
  field: string,
  maxLength: number,
  required = false,
) {
  if (typeof value !== "string") {
    if (required) fail(`${field}不能为空`);
    return null;
  }
  const trimmed = value.trim();
  if (required && !trimmed) fail(`${field}不能为空`);
  if (trimmed.length > maxLength)
    fail(`${field}长度不能超过${maxLength}个字符`);
  return trimmed || null;
}

function normalizePayload(payload: unknown, submissionId: string | null) {
  if (!payload || typeof payload !== "object" || Array.isArray(payload))
    fail("投稿数据格式错误");
  const source = payload as Record<string, unknown>;
  const latitude = Number(source.latitude);
  const longitude = Number(source.longitude);
  if (!Number.isFinite(latitude) || latitude < -90 || latitude > 90)
    fail("纬度无效");
  if (!Number.isFinite(longitude) || longitude < -180 || longitude > 180)
    fail("经度无效");

  const customSource = source.custom_details;
  if (
    customSource !== undefined &&
    (!customSource ||
      typeof customSource !== "object" ||
      Array.isArray(customSource))
  )
    fail("自定义项格式错误");
  const customDetails: Record<string, unknown> = {};
  const customEntries = Object.entries(
    (customSource || {}) as Record<string, unknown>,
  );
  if (customEntries.length > 20) fail("自定义项不能超过20个");
  for (const [key, value] of customEntries) {
    if (key === "duplicate_candidates") continue;
    if (key.length > 50) fail("自定义项名称过长");
    if (key === "images") {
      if (
        !Array.isArray(value) ||
        value.length > 3 ||
        value.some(
          (path) =>
            typeof path !== "string" ||
            !IMAGE_PATH_PATTERN.test(path) ||
            !submissionId ||
            !path.startsWith(`${submissionId}/`),
        )
      )
        fail("图片路径无效");
      customDetails.images = value;
      continue;
    }
    if (typeof value !== "string" || value.length > 500)
      fail("自定义项内容无效");
    customDetails[key] = value;
  }

  return {
    name: stringValue(source.name, "地名", 120, true),
    recommendation: stringValue(source.recommendation, "推荐理由", 2000, true),
    category_id: stringValue(source.category_id, "分类", 64),
    latitude,
    longitude,
    address: stringValue(source.address, "地址", 240),
    hours: stringValue(source.hours, "营业时间", 120),
    price: stringValue(source.price, "价格", 120),
    best_for: stringValue(source.best_for, "适合场景", 120),
    custom_details: customDetails,
  };
}

async function notifyAdmins(
  admin: ReturnType<typeof createClient>,
  submission: ReturnType<typeof normalizePayload>,
  queryCode: string,
) {
  const notificationUrl = Deno.env.get("ADMIN_NOTIFICATION_URL");
  const notificationSecret = Deno.env.get("ADMIN_NOTIFICATION_SECRET");
  if (!notificationUrl || !notificationSecret) return;

  try {
    const { data: admins, error } = await admin
      .from("admin_users")
      .select("email");
    if (error) throw error;
    const recipients = (admins || [])
      .map((item) => item.email)
      .filter((email): email is string => typeof email === "string");
    if (!recipients.length) return;
    const response = await fetch(notificationUrl, {
      method: "POST",
      headers: {
        Authorization: `Bearer ${notificationSecret}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        recipients,
        queryCode,
        submission: {
          name: submission.name,
          recommendation: submission.recommendation,
          address: submission.address,
          coordinates: [submission.longitude, submission.latitude],
        },
      }),
    });
    if (!response.ok)
      console.error("admin notification endpoint failed", response.status);
  } catch (error) {
    console.error("admin notification request failed", error);
  }
}

Deno.serve(async (request) => {
  const origin = request.headers.get("origin");
  if (origin && !allowedOrigins.has(origin))
    return json({ error: "请求来源不被允许" }, 403, origin);
  if (request.method === "OPTIONS")
    return new Response("ok", { headers: corsHeaders(origin) });
  if (request.method !== "POST")
    return json({ error: "只支持 POST 请求" }, 405, origin);

  try {
    const contentLength = Number(request.headers.get("content-length") || 0);
    if (contentLength > MAX_BODY_BYTES)
      return json({ error: "投稿数据过大" }, 413, origin);
    const rawText = await request.text();
    if (new TextEncoder().encode(rawText).byteLength > MAX_BODY_BYTES)
      return json({ error: "投稿数据过大" }, 413, origin);
    let rawBody: unknown;
    try {
      rawBody = JSON.parse(rawText);
    } catch {
      fail("请求格式错误");
    }
    if (!rawBody || typeof rawBody !== "object" || Array.isArray(rawBody))
      fail("请求格式错误");
    const body = rawBody as Record<string, unknown>;
    const turnstileToken = stringValue(
      body.turnstileToken,
      "人机验证",
      4096,
      true,
    );
    const fingerprint = stringValue(body.fingerprint, "设备标识", 128, true);
    const rawSubmissionId = body.submissionId;
    const submissionId =
      rawSubmissionId === undefined ||
      rawSubmissionId === null ||
      rawSubmissionId === ""
        ? null
        : stringValue(rawSubmissionId, "投稿编号", 36);
    if (submissionId && !UUID_PATTERN.test(submissionId)) fail("投稿编号无效");
    const normalizedPayload = normalizePayload(body.payload, submissionId);
    if (normalizedPayload.custom_details.images && !submissionId)
      fail("图片投稿编号缺失");

    const ip =
      request.headers.get("cf-connecting-ip") ||
      request.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ||
      "unknown";
    const verifyBody = new URLSearchParams({
      secret: Deno.env.get("TURNSTILE_SECRET_KEY") || "",
      response: turnstileToken,
      remoteip: ip,
    });
    const verification = await fetch(
      "https://challenges.cloudflare.com/turnstile/v0/siteverify",
      { method: "POST", body: verifyBody },
    ).then((response) => response.json());
    const hostname =
      typeof verification.hostname === "string"
        ? verification.hostname.toLowerCase()
        : "";
    if (
      !verification.success ||
      !hostname ||
      !allowedTurnstileHostnames.has(hostname)
    )
      return json({ error: "人机验证失败" }, 403, origin);

    const digest = await crypto.subtle.digest(
      "SHA-256",
      new TextEncoder().encode(`${ip}:${fingerprint}`),
    );
    const rateKey = Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("");
    const admin = createClient(
      Deno.env.get("SUPABASE_URL")!,
      Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!,
    );
    if (normalizedPayload.category_id) {
      const { data: category, error: categoryError } = await admin
        .from("categories")
        .select("id")
        .eq("id", normalizedPayload.category_id)
        .eq("is_active", true)
        .maybeSingle();
      if (categoryError) throw categoryError;
      if (!category) fail("所选分类不存在或已停用");
    }
    const { data: allowed, error: quotaError } = await admin.rpc(
      "consume_submission_quota",
      { key: rateKey, max_count: 5 },
    );
    if (quotaError) throw quotaError;
    if (!allowed) return json({ error: "今天的投稿次数已用完" }, 429, origin);

    const { data: nearby, error: nearbyError } = await admin
      .from("places")
      .select("id,name")
      .gte("latitude", normalizedPayload.latitude - 0.0015)
      .lte("latitude", normalizedPayload.latitude + 0.0015)
      .gte("longitude", normalizedPayload.longitude - 0.0015)
      .lte("longitude", normalizedPayload.longitude + 0.0015)
      .limit(5);
    if (nearbyError) throw nearbyError;
    const duplicateCandidates = (nearby || [])
      .filter(
        (place) =>
          place.name.includes(normalizedPayload.name) ||
          normalizedPayload.name.includes(place.name),
      )
      .map((place) => ({ id: place.id, name: place.name }));
    const insertPayload = {
      ...normalizedPayload,
      ...(submissionId ? { id: submissionId } : {}),
      custom_details: {
        ...normalizedPayload.custom_details,
        duplicate_candidates: duplicateCandidates,
      },
      status: "pending",
    };
    const { data, error } = await admin
      .from("places")
      .insert(insertPayload)
      .select("query_code")
      .single();
    if (error) throw error;
    await notifyAdmins(admin, normalizedPayload, data.query_code);
    return json({ queryCode: data.query_code }, 200, origin);
  } catch (error) {
    const message = error instanceof Error ? error.message : "";
    if (message.startsWith("INPUT:"))
      return json({ error: message.slice(6) }, 400, origin);
    console.error("submit-place failed", error);
    return json({ error: "投稿服务暂时不可用" }, 500, origin);
  }
});
