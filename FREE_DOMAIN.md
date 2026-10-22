# 免费域名：is-a.dev

推荐使用 is-a.dev 的免费子域名：

```text
aoshkk-skinlab.is-a.dev
```

该名字目前未被占用。is-a.dev 通过 GitHub Pull Request 审核发放域名，审核通过后由 Vercel 自动签发 HTTPS 证书。

> 需要等待维护者审核，通常几小时到几天。急用可以改用付费域名。

## 第一步：在 Vercel 添加域名

1. 打开 Vercel 项目 `minecraftskin`
2. **Settings → Domains → Add**
3. 输入：
   ```text
   aoshkk-skinlab.is-a.dev
   ```
4. 如果提示重定向到 `www`，取消勾选
5. 选择 **Continue manually**
6. 记下页面给出的 **TXT 验证值**，以及 A / CNAME 记录

## 第二步：Fork is-a.dev 仓库

打开并 Fork：

```text
https://github.com/is-a-dev/register/fork
```

## 第三步：创建两个 JSON 文件

在 fork 的 `domains/` 目录下创建：

### 1. `domains/aoshkk-skinlab.json`

如果 Vercel 给出的 A 记录是 `216.198.79.1`：

```json
{
  "owner": {
    "username": "Aoshkk"
  },
  "records": {
    "A": ["216.198.79.1"]
  }
}
```

如果 Vercel 给的是 CNAME，则改成：

```json
{
  "owner": {
    "username": "Aoshkk"
  },
  "records": {
    "CNAME": "cname.vercel-dns.com"
  }
}
```

以 Vercel 页面实际显示的记录为准。

### 2. `domains/_vercel.aoshkk-skinlab.json`

把 `PASTE_TXT_VALUE_HERE` 换成 Vercel 给出的 TXT 值：

```json
{
  "owner": {
    "username": "Aoshkk"
  },
  "records": {
    "TXT": "PASTE_TXT_VALUE_HERE"
  }
}
```

## 第四步：发 Pull Request

1. 在 fork 中提交这两个文件
2. 点击 **Contribute → Open pull request**
3. 标题建议：
   ```text
   Add aoshkk-skinlab.is-a.dev
   ```
4. PR 描述里附上网站和截图：

```text
Website: https://minecraftskin-seven.vercel.app/
Source: https://github.com/Aoshkk/minecraftskin
Preview: https://raw.githubusercontent.com/Aoshkk/minecraftskin/main/preview.png
```

5. 按 is-a.dev 的 PR 模板填写，等待审核合并

## 第五步：等待生效

合并后等待几分钟到几小时：

- 检查 `aoshkk-skinlab.is-a.dev` 能否解析
- 回到 Vercel 查看域名状态
- HTTPS 证书由 Vercel 自动签发

如果 Vercel 一直显示未验证，检查：

- `_vercel.aoshkk-skinlab.json` 的 TXT 值是否完全一致
- `aoshkk-skinlab.json` 的 A/CNAME 是否和 Vercel 显示的一致
- PR 是否已合并

参考文档：

- <https://docs.is-a.dev/guides/vercel/>
- <https://docs.is-a.dev/domain-structure/>
