# Markit · 自托管书签收藏夹

> 收藏的东西，放回自己家里。数据 100% 存在你自己的服务器上，不经过任何云。

Markit 是一个跑在你自己机器上的网页书签收藏夹：Docker 单容器部署，浏览器、手机打开同一个地址就能用。它还带一个 Markdown 资料库模式（Skills），可以把平时攒的提示词、笔记片段当卡片库管理。

## 功能

**书签**
- 无限层级分组（Notion 式图标与配色）、Pin 宫格、星标、全文搜索
- 悬停卡片自动浮出网页预览，不用一条条点开
- 卡片 / 列表双视图，全部视图支持手动拖拽排序
- 批量管理：多选移动分组、打标签、星标、导出、删除
- 收藏即抓取网页标题与 favicon；已知被墙站点自动打标
- AI 生成简介与标签（OpenAI 兼容接口，管理员统一配置 Key，支持智谱 / DeepSeek / OpenAI 等）
- 回收站（软删除、恢复、30 天自动清理）；所有危险操作二次确认
- 导入 / 导出 Netscape HTML 与 JSON；数据库实时镜像为 CSV，随时可看

**Skills（Markdown 资料库）**
- 双模式切换，书签和提示词库互不打扰
- 手动编写、上传 .md、GitHub 仓库解析导入三种入库方式
- GitHub 来源条目支持一键检查更新、自动同步
- 右侧实时 Markdown 预览 + 在线编辑，保留历史版本可回退
- 公开广场：把自己觉得好的条目公开给其他用户，他人可收藏、复制到自己的库

**分享与多端**
- 任意书签 / Skill 生成分享链接，访客只读查看
- 浏览器扩展（Chrome / Edge）：点一下即收藏，支持右键菜单与快捷键
- PWA：手机加到主屏幕，像原生应用一样打开
- 暗色模式（跟随系统）、中英双语、移动端适配

**安全**
- 多用户数据隔离；管理员可关闭开放注册
- 登录限速、CSRF 防护、会话 Cookie（HttpOnly + SameSite）
- 每个危险操作都有确认弹窗

## 快速开始

```bash
git clone https://github.com/<your-name>/markit.git
cd markit
docker compose up -d --build
```

打开 `http://localhost:8340` 即可使用。

- 管理员默认账号 `admin / 0000`，**首次登录强制修改密码**
- 可选演示账号 `markit_demo / password123`（内置演示书签，`MARKIT_SEED_DEMO=0` 关闭）
- 所有数据（数据库、CSV 镜像、图标缓存）都在 `./data` 文件夹，备份它 = 备份一切

> 公网部署建议：设置 → 站点设置 → 关闭开放注册，账号由管理员手动创建。

### 环境变量

| 变量 | 说明 | 默认 |
|------|------|------|
| `PORT` | 服务端口 | 8340 |
| `TZ` | 时区 | Asia/Shanghai |
| `MARKIT_ADMIN_PASSWORD` | admin 初始密码 | 0000（首登强制改） |
| `MARKIT_SEED_DEMO` | 是否创建演示账号 | 1 |

### 浏览器扩展

`extension/` 目录，Chrome / Edge 以「加载已解压的扩展程序」方式安装。首次使用在 Markit 的 设置 → 扩展与 API 生成 Token，填入扩展即可。

## 本地开发

```bash
# 前端（5180 端口，/api 代理到 8340）
npm install && npm run dev

# 后端（8340 端口）
cd server && npm install && npm run dev

# 生产构建（单进程同服静态页与 API，即容器内跑法）
npm run build && cd server && npm run build
node server/dist/index.js
```

需要 Node.js 20+。

## 技术栈

Vue 3 + TypeScript + Vite + Pinia · Express + better-sqlite3（WAL）· Docker 单容器 · 无外部服务依赖

## License

[MIT](LICENSE)
