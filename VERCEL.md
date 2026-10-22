# 免费部署到 Vercel（不需要绑卡）

Render 在部分账号上会要求绑定银行卡做身份验证。如果不想绑卡，使用 Vercel 的 Hobby 免费方案。

项目已包含：

- `vercel.json`：Vite 构建、静态输出、API 函数配置
- `api/[...path].js`：Mojang 查询、皮肤代理、披风代理
- BGM 位于 `public/audio/friends-wine-dj.mp3`，由 Vercel CDN 直接提供

## 部署步骤

1. 关闭 Render 的 **Add Card** 弹窗，不要填写银行卡。
2. 打开 <https://vercel.com/>，使用 GitHub 注册或登录。
3. 点击 **Add New → Project**。
4. 选择 **Import Git Repository**，找到并导入：
   ```text
   Aoshkk/minecraftskin
   ```
5. Framework Preset 会自动识别为 **Vite**。
6. 保持默认构建配置：
   ```text
   Build Command: npm run build
   Output Directory: dist
   ```
7. 点击 **Deploy**，等待 1–3 分钟。
8. 部署完成后，Vercel 会给出 `https://xxxx.vercel.app` 地址。

## 注意

- Vercel Hobby 通常不要求绑卡；如果也要求付款验证，先停止并告诉我。
- 免费函数有调用次数和带宽额度，个人使用足够。
- `/api/profile`、`/api/skin/:name`、`/api/cape/:name` 已迁移为 Vercel Serverless Function。
- BGM 是版权音乐，仓库和站点公开后音频也会被公开访问，请确认你有公开传播授权。
- 如果导入仓库时看不到项目，需要在 Vercel 的 GitHub 授权中允许访问 `minecraftskin` 仓库。
