# 安师生活地图

本项目采用 [GNU GPLv3](./LICENSE) 开源许可证。

## 白标配置（White label）

同一套代码可服务多所学校 / 组织。品牌信息集中在 `src/data/brand.yml`，切换学校只需改配置，无需改动业务代码。`index.html` 的标题与分享卡片（Open Graph / Twitter）由 Vite 在构建时根据 `brand.yml` 自动注入，无需手动修改。

1. `src/data/brand.yml`（品牌唯一数据源）：站名、英文标语、机构名、口号、页面描述、分享描述、站点 URL、Logo 路径、引导标题、口碑标签、联系方式和 `storageKey`。`storageKey` 是浏览器本地存储前缀，默认沿用项目名 `ahnu-share-map`；若多个白标部署在同一个域名下，请改为不同值以避免互相覆盖。
2. `src/data/campuses.yml`：校区名称与坐标（坐标遵循 `app.yml` 的 `coordinateSystem`）。
3. `src/data/app.yml`：默认地图中心与缩放级别。
4. `public/logo.png`：站点 Logo（文件名由 `brand.yml` 的 `logo` 字段指定）。
5. 部署配置：`.env.example` 列出了全部可配置项（后端端口、数据库与上传目录、初始管理员、投稿限额等）。

## 本地运行

本项目已改为**单容器自包含部署**：前端（Vite/React）与后端（Express + `node:sqlite`）在同一个进程中，不再依赖 Supabase 或 Turnstile。

```bash
# 需 Node 24+（内置 node:sqlite）
npm install
npm run build     # 构建前端到 dist/
npm run server    # 启动后端，默认 http://127.0.0.1:3000

# 开发热更：Vite 已把 /api 与 /uploads 代理到 :3000
npm run dev
```

环境变量见 `.env.example`，其中 `ADMIN_USERNAME` / `ADMIN_PASSWORD` 仅在数据库还没有管理员时用于初始化。

如需配置管理员通知邮件的站点显示名，可参考以下 SMTP 示例：

```bash
SMTP_FROM=AHNU Share Map
SITE_NAME=安师生活地图
```

## 数据流

- 匿名投稿经 `POST /api/submissions`（multipart）提交，通过每日限额后写入 `pending`；
- 公共地图的 `GET /api/catalog` 只返回 `approved` 地点；
- 管理员登录后可以编辑、通过或驳回投稿；
- 投稿图片先落在 `data/uploads/pending/`，审核通过时迁移到 `data/uploads/public/`；
- 地点的全部公开图片保存在 `places.image_urls`，`cover_url` 仅作为当前封面；
- 分类和详情字段分别由 `categories`、`detail_fields` 表维护；项目不包含预置推荐地点（可用 `SEED_DEMO_PLACES=1` 写入演示数据）。

后台数据使用 SQLite，默认位于 `data/app.db`，图片位于 `data/uploads/`。
