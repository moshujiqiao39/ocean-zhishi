# 海识 · 海洋知识网站

用户提问，网站用海洋知识作答。仓库里是两套互不依赖的方案：

| 方案 | 文件夹 | 做法 |
| --- | --- | --- |
| 一 | `01-local-model/` | 自建浏览器检索模型，知识写进 `knowledge.json`，可同步更新 |
| 二 | `02-deepseek/` | 用户用自己的 DeepSeek API Key 提问，开发者把知识注入模型上下文 |

电脑关机后仍可打开的公开页面：

- 总入口：https://moshujiqiao39.github.io/ocean-zhishi/
- 方案一：https://moshujiqiao39.github.io/ocean-zhishi/01-local-model/
- 方案二：https://moshujiqiao39.github.io/ocean-zhishi/02-deepseek/

更短的链接清单见 [LINKS.md](./LINKS.md)。代码仓库：https://github.com/moshujiqiao39/ocean-zhishi

## 知识如何更新

1. 在网页「开发者知识」里新增条目，立刻可被本机提问使用。
2. 导出 `knowledge.json`，覆盖对应文件夹中的同名文件。
3. 推送到 GitHub 后，访客刷新页面即可同步到新知识。

## 方案二为什么需要代理

DeepSeek 官方接口不允许浏览器跨域。根目录的 `api/chat.js` 只把请求转发到 `api.deepseek.com`，密钥仍由用户自己提供。把本仓库部署到 Vercel 后，代理地址为 `https://你的项目.vercel.app/api/chat`。
