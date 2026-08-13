import nodemailer from "nodemailer";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 50;
const MAX_IMAGES = 3;
const MAX_DETAILS = 24;

const stringValue = (value, maxLength) =>
  typeof value === "string" ? value.trim().slice(0, maxLength) : "";
const escapeHtml = (value) =>
  value.replace(
    /[&<>"']/g,
    (character) =>
      ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[
        character
      ],
  );
const isHttpUrl = (value) => {
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:";
  } catch {
    return false;
  }
};

export default async function handler(request, response) {
  if (request.method !== "POST")
    return response.status(405).json({ error: "只支持 POST 请求" });

  const webhookSecret = process.env.ADMIN_NOTIFICATION_SECRET;
  if (
    !webhookSecret ||
    request.headers.authorization !== `Bearer ${webhookSecret}`
  )
    return response.status(401).json({ error: "未授权" });

  const body =
    typeof request.body === "string"
      ? JSON.parse(request.body)
      : request.body || {};
  const recipients = [
    ...new Set(
      (Array.isArray(body.recipients) ? body.recipients : [])
        .filter(
          (email) =>
            typeof email === "string" && EMAIL_PATTERN.test(email.trim()),
        )
        .map((email) => email.trim().toLowerCase()),
    ),
  ].slice(0, MAX_RECIPIENTS);
  if (!recipients.length)
    return response.status(200).json({ sent: 0, skipped: true });

  const smtpUser = process.env.SMTP_USER;
  const smtpPass = process.env.SMTP_PASS;
  if (!smtpUser || !smtpPass)
    return response.status(503).json({ error: "SMTP 服务尚未配置" });

  const submission =
    body.submission && typeof body.submission === "object"
      ? body.submission
      : {};
  const name = stringValue(submission.name, 120) || "未命名地点";
  const recommendation =
    stringValue(submission.recommendation, 2000) || "未提供推荐内容";
  const address = stringValue(submission.address, 240) || "未提供地址";
  const queryCode = stringValue(body.queryCode, 32) || "未知";
  const coordinates = Array.isArray(submission.coordinates)
    ? submission.coordinates
        .slice(0, 2)
        .map((value) => Number(value))
        .filter(Number.isFinite)
    : [];
  const coordinateText =
    coordinates.length === 2 ? coordinates.join(", ") : "未提供坐标";
  const details = (Array.isArray(submission.details) ? submission.details : [])
    .slice(0, MAX_DETAILS)
    .map((detail) =>
      Array.isArray(detail)
        ? [stringValue(detail[0], 80), stringValue(detail[1], 500)]
        : ["", ""],
    )
    .filter(([label, value]) => label && value);
  const images = (Array.isArray(submission.images) ? submission.images : [])
    .slice(0, MAX_IMAGES)
    .filter((url) => typeof url === "string" && isHttpUrl(url));
  const detailText = details
    .map(([label, value]) => `${label}：${value}`)
    .join("\n");
  const imageText = images.length
    ? `\n\n投稿图片（链接 7 天有效）：\n${images
        .map((url, index) => `${index + 1}. ${url}`)
        .join("\n")}`
    : "";
  const mailText = `有新的地点投稿待审核\n\n地点：${name}\n推荐内容：${recommendation}\n地址：${address}\n坐标：${coordinateText}${detailText ? `\n${detailText}` : ""}${imageText}\n\n查询码：${queryCode}`;
  const detailHtml = details.length
    ? `<table style="border-collapse:collapse;margin:16px 0">${details
        .map(
          ([label, value]) =>
            `<tr><th style="padding:5px 10px 5px 0;text-align:left;color:#52655a">${escapeHtml(label)}</th><td style="padding:5px 0">${escapeHtml(value)}</td></tr>`,
        )
        .join("")}</table>`
    : "";
  const imageHtml = images.length
    ? `<h3 style="margin:20px 0 10px">投稿图片</h3><div>${images
        .map(
          (url, index) =>
            `<p style="margin:0 0 14px"><a href="${escapeHtml(url)}"><img src="${escapeHtml(url)}" alt="投稿图片 ${index + 1}" style="display:block;max-width:560px;width:100%;height:auto;border:1px solid #d6ded4" /></a><a href="${escapeHtml(url)}" style="display:inline-block;margin-top:6px">查看原图</a></p>`,
        )
        .join("")}</div><p style="color:#7d8c80;font-size:12px">图片链接 7 天内有效。</p>`
    : "";
  const mailHtml = `<h2>有新的地点投稿待审核</h2><p><strong>地点：</strong>${escapeHtml(name)}</p><p><strong>推荐内容：</strong>${escapeHtml(recommendation)}</p><p><strong>地址：</strong>${escapeHtml(address)}</p><p><strong>坐标：</strong>${escapeHtml(coordinateText)}</p>${detailHtml}${imageHtml}<p><strong>查询码：</strong>${escapeHtml(queryCode)}</p>`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.qq.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });
  const configuredFrom = stringValue(process.env.SMTP_FROM, 320).replace(
    /[\r\n]/g,
    " ",
  );
  const from = configuredFrom
    ? configuredFrom.includes("@")
      ? configuredFrom
      : { name: configuredFrom, address: smtpUser }
    : smtpUser;

  try {
    const result = await transporter.sendMail({
      from,
      envelope: { from: smtpUser, to: recipients },
      to: recipients,
      subject: `【安师生活地图】新投稿待审核：${name.replace(/[\r\n]/g, " ")}`,
      text: mailText,
      html: mailHtml,
    });
    return response
      .status(200)
      .json({ sent: recipients.length, messageId: result.messageId });
  } catch (error) {
    console.error("admin notification failed", error);
    return response.status(502).json({ error: "SMTP 发送失败" });
  }
}
