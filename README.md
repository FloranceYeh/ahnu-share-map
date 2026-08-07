# 赭山生活地图

## 本地配置

复制 `.env.example` 为 `.env`，填写高德、Supabase 和 Turnstile 的前端变量。

```bash
npm install
npm run dev
```

## Supabase 初始化

1. 在 Supabase 项目中执行 `supabase/migrations/001_initial.sql`、`002_seed_catalog.sql`、`003_security_hardening.sql` 和 `004_place_images.sql`。
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

## 数据流

- 匿名投稿统一经过 `submit-place` Edge Function，通过 Turnstile 和每日 5 次限额后写入 `pending`。
- 公共地图的 RLS 只允许读取 `approved` 地点。
- 管理员登录后可以编辑、通过或驳回投稿。
- 投稿图片先进入私有 `submission-images`，审核通过时迁移到公开 `place-images`。
- 地点的全部公开图片保存在 `places.image_urls`，`cover_url` 仅作为当前封面。
- 分类和详情字段分别由 `categories`、`detail_fields` 表维护；项目不包含预置推荐地点。
