# ============================================================
# Markit 单容器镜像：前端静态资源 + API 后端 + SQLite
# 多阶段构建：web(前端) → server(后端编译) → runtime(仅生产依赖)
# npm 使用国内镜像源（npmmirror），适合国内 NAS 网络
# ============================================================

# ---- 阶段 1：构建前端 ----
FROM docker.m.daocloud.io/library/node:20-slim AS web
WORKDIR /web
COPY package.json package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci
COPY index.html vite.config.ts tsconfig.json ./
COPY public ./public
COPY src ./src
RUN npm run build

# ---- 阶段 2：编译后端 ----
FROM docker.m.daocloud.io/library/node:20-slim AS server
WORKDIR /srv
# apt 换阿里云源（国内），装编译工具链兜底原生模块源码编译
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null; \
    apt-get update \
  && apt-get install -y --no-install-recommends python3 make g++ \
  && rm -rf /var/lib/apt/lists/*
# better-sqlite3 预编译二进制走 npmmirror 国内源
ENV better_sqlite3_binary_host_mirror=https://npmmirror.com/mirrors/better-sqlite3
COPY server/package.json server/package-lock.json ./
RUN npm config set registry https://registry.npmmirror.com && npm ci
COPY server/tsconfig.json ./
COPY server/src ./src
RUN npm run build

# ---- 阶段 2.5：扩展打包 ----
FROM docker.m.daocloud.io/library/node:20-slim AS extzip
RUN sed -i 's|deb.debian.org|mirrors.aliyun.com|g' /etc/apt/sources.list.d/debian.sources /etc/apt/sources.list 2>/dev/null;     apt-get update && apt-get install -y --no-install-recommends zip && rm -rf /var/lib/apt/lists/*
COPY extension /ext
RUN cd /ext && zip -r /markit-extension.zip . -x "*.DS_Store" -x "安装教程.md"

# ---- 阶段 3：运行时 ----
FROM docker.m.daocloud.io/library/node:20-slim
WORKDIR /app
ENV NODE_ENV=production \
    PORT=8340 \
    TZ=Asia/Shanghai
COPY --from=server /srv/node_modules ./server/node_modules
COPY --from=server /srv/dist ./server/dist
COPY --from=web /web/dist ./dist
# 浏览器扩展分发包（设置页提供下载）
COPY --from=extzip /markit-extension.zip /app/downloads/markit-extension.zip
EXPOSE 8340
VOLUME /app/data
CMD ["node", "server/dist/index.js"]
