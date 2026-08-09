import nodemailer from "nodemailer";

const EMAIL_PATTERN = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const MAX_RECIPIENTS = 50;

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
    return response.status(400).json({ error: "没有有效的管理员邮箱" });

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
  const mailText = `有新的地点投稿待审核\n\n地点：${name}\n推荐内容：${recommendation}\n地址：${address}\n坐标：${coordinateText}\n查询码：${queryCode}`;
  const mailHtml = `<h2>有新的地点投稿待审核</h2><p><strong>地点：</strong>${escapeHtml(name)}</p><p><strong>推荐内容：</strong>${escapeHtml(recommendation)}</p><p><strong>地址：</strong>${escapeHtml(address)}</p><p><strong>坐标：</strong>${escapeHtml(coordinateText)}</p><p><strong>查询码：</strong>${escapeHtml(queryCode)}</p>`;
  const transporter = nodemailer.createTransport({
    host: process.env.SMTP_HOST || "smtp.qq.com",
    port: Number(process.env.SMTP_PORT || 465),
    secure: true,
    auth: { user: smtpUser, pass: smtpPass },
  });

  try {
    const result = await transporter.sendMail({
      from: process.env.SMTP_FROM || smtpUser,
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
