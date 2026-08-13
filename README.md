# 安师生活地图

本项目采用 [GNU GPLv3](./LICENSE) 开源许可证。

## 本地配置

复制 `.env.example` 为 `.env`，填写高德、Supabase 和 Turnstile 的前端变量。

```bash
npm install
npm run dev
```

## Supabase 初始化

1. 按编号顺序执行 `supabase/migrations` 中的全部 SQL 迁移（当前为 `001`–`007`）。
2. 部署 Edge Function：`supabase functions deploy submit-place`。
3. 配置 Turnstile Function secret：

```bash
supabase secrets set TURNSTILE_SECRET_KEY=...
```

`SUPABASE_URL` 和 `SUPABASE_SERVICE_ROLE_KEY` 由 Supabase Edge Functions 运行环境自动提供，不应放入 Vercel 的前端环境变量。

4. 在 Supabase Authentication 创建管理员邮箱密码账号，然后执行：

```sql
insert into public.admin_users(user_id, email)
select id, email from auth.users where email = '你的管理员邮箱';
```

`admin_users` 支持多个管理员。每新增一个管理员账号，执行同一条 SQL 并替换邮箱即可。`email` 是可选的通知邮箱；管理员权限只由 `user_id` 判断。无需邮件通知的管理员可以执行：

```sql
insert into public.admin_users(user_id, email)
select id, null from auth.users where email = '管理员登录邮箱';
```

管理员仍需使用 Supabase Authentication 中的邮箱密码账号登录。通知邮箱为 `NULL` 的管理员不会收到投稿邮件，也不会影响其他管理员正常收信。

## 管理员邮件通知

新投稿写入成功后，`submit-place` 会读取 `admin_users` 中所有有效的非空通知邮箱，并调用 Vercel 的 `/api/notify-admins` 通过 QQ 邮箱 SMTP 发送通知。没有有效收件人时会跳过邮件发送；通知失败也不会影响投稿写入。

在 Vercel 项目环境变量中配置：

```bash
SMTP_PORT=465
SMTP_USER=你的QQ邮箱
SMTP_PASS=QQ邮箱SMTP授权码
SMTP_FROM=AHNU Share Map
ADMIN_NOTIFICATION_SECRET=随机长密钥
```

在 Supabase Edge Function secrets 中配置相同的通知密钥与 Vercel 端点地址：

```bash
supabase secrets set ADMIN_NOTIFICATION_URL=https://你的域名/api/notify-admins
supabase secrets set ADMIN_NOTIFICATION_SECRET=与Vercel相同的随机长密钥
```

QQ 邮箱需要先在邮箱设置中开启 SMTP 服务，并使用 SMTP 授权码，而不是登录密码。修改后重新部署 Edge Function：

```bash
supabase functions deploy submit-place
```

## 数据流

- 匿名投稿统一经过 `submit-place` Edge Function，通过 Turnstile 和每日 5 次限额后写入 `pending`。
- 公共地图的 RLS 只允许读取 `approved` 地点。
- 管理员登录后可以编辑、通过或驳回投稿。
- 投稿图片先进入私有 `submission-images`，审核通过时迁移到公开 `place-images`。
- 地点的全部公开图片保存在 `places.image_urls`，`cover_url` 仅作为当前封面。
- 分类和详情字段分别由 `categories`、`detail_fields` 表维护；项目不包含预置推荐地点。
