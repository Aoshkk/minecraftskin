# 免费部署到 Netlify（不需要绑卡）

Vercel 的 `*.vercel.app` 在部分网络会被 DNS 污染，导致打不开。Netlify 的 `*.netlify.app` 通常可以正常访问。

项目已包含：

- `netlify.toml`：Vite 构建、`dist` 静态发布、Functions 目录配置
- `netlify/functions/api.mjs`：使用 Netlify Functions 2.0 的自定义 `/api/*` 路由，复用 Mojang 查询与皮肤代理
- BGM 随 `public/audio` 一起打包为静态资源

## 部署步骤

1. 打开 <https://app.netlify.com/>，使用 **GitHub** 登录。
2. 点击 **Add new site → Import an existing project**。
3. 选择 **GitHub**，授权并选择仓库：
   ```text
   Aoshkk/minecraftskin
   ```
4. 构建设置会自动读取 `netlify.toml`：
   ```text
   Build command: npm run build
   Publish directory: dist
   ```
5. 点击 **Deploy site**，等待 1–3 分钟。
6. 部署完成后，复制 `https://xxxx.netlify.app` 地址。

## 注意

- Netlify 免费计划通常不需要绑卡；如果也要求付款验证，先停止并告诉我。
- 自定义域名可以之后在 Netlify 的 **Domain settings** 里添加。
- BGM 是版权音乐，公开部署前请确认你有公开传播授权。
- API 路由由 `/.netlify/functions/api/*` 通过重定向代理到 `/api/*`。
