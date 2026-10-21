# 免费部署到 Render

项目已包含 [render.yaml](render.yaml)，可让 Render 自动创建免费 Web Service。

## 1. 推送到 GitHub

先在 GitHub 创建一个**私有**空仓库（不要勾选自动生成 README），然后在项目目录执行：

```bash
git remote add origin https://github.com/你的用户名/minecraft-skin-lab.git
git branch -M main
git push -u origin main
```

## 2. 在 Render 创建服务

1. 打开 <https://render.com/>，使用 GitHub 注册或登录。
2. 点击 **New → Blueprint**。
3. 选择刚才的 `minecraft-skin-lab` 仓库。
4. Render 会自动读取 `render.yaml`，确认后点击 **Apply**。
5. 等待构建和部署完成，Render 会给出一个 `https://xxxx.onrender.com` 公网地址。

构建命令：

```text
npm install --include=dev && npm run build
```

启动命令：

```text
npm start
```

环境变量已由 `render.yaml` 配置：`HOST=0.0.0.0`、`NODE_ENV=production`、`NODE_VERSION=22`。

## 3. 注意事项

- **免费实例会休眠**：Render 免费 Web Service 在一段时间无访问后会休眠，下一次打开需要几十秒冷启动。这是免费套餐的限制。
- **音频版权**：当前 BGM 是用户提供的音乐文件。公开部署会向所有人提供该音频，请确认你拥有公开传播授权，否则请替换为无版权/已授权音乐。
- **自动部署**：推送到 GitHub 的 `main` 分支后，Render 会自动重新部署。
- **修改端口**：不需要手动改端口，Render 会通过 `PORT` 环境变量注入端口，`server.js` 已支持。
- **免费额度**：Render 免费套餐的带宽、构建时长和休眠策略可能调整，以 Render 控制台为准。
