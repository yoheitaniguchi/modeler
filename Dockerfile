# =============================================================================
# Stage 1: builder
# 全ワークスペースの依存関係インストールとビルドを行う。
# =============================================================================
FROM node:24.13.0-bookworm-slim AS builder

WORKDIR /app

# package.json を先にコピーしてレイヤーキャッシュを有効活用
COPY package.json package-lock.json ./
COPY shared/package.json   ./shared/package.json
COPY server/package.json   ./server/package.json
COPY client/package.json   ./client/package.json
COPY e2e/package.json      ./e2e/package.json

RUN npm ci

# package-lock.json がWindows環境で生成されているため Linux用ネイティブバイナリが欠落。
# CIと同じ手順で補完する (.github/workflows/ci.yml 参照)
RUN npm install @rollup/rollup-linux-x64-gnu @esbuild/linux-x64

# ソースをコピー
COPY shared/ ./shared/
COPY server/ ./server/
COPY client/ ./client/

# ビルド順序: shared → server → client (型依存のため順序固定)
# VITE_BASE=/ はCIと同じ設定 (root配信時に必要)
RUN npm run build --workspace=shared
RUN npm run build --workspace=server
RUN VITE_BASE=/ npm run build --workspace=client


# =============================================================================
# Stage 2: runner
# ランタイム成果物のみを含むリーンな本番イメージ。
# ビルドツールやdevDependenciesは含まれない。
# =============================================================================
FROM node:24.13.0-bookworm-slim AS runner

WORKDIR /app

# ワークスペース解決に必要なpackage.jsonをコピー
COPY --from=builder /app/package.json      ./package.json
COPY --from=builder /app/package-lock.json ./package-lock.json
COPY --from=builder /app/shared/package.json  ./shared/package.json
COPY --from=builder /app/server/package.json  ./server/package.json
COPY --from=builder /app/client/package.json  ./client/package.json
COPY --from=builder /app/e2e/package.json     ./e2e/package.json

# プロダクション依存のみインストール
RUN npm ci --omit=dev --ignore-scripts

# ビルド成果物をコピー
COPY --from=builder /app/shared/dist   ./shared/dist/
COPY --from=builder /app/server/dist   ./server/dist/
COPY --from=builder /app/client/dist   ./client/dist/

# データ・ログディレクトリを作成しownership設定 (USER切り替え前に実施)
RUN mkdir -p /app/data /app/log && chown -R node:node /app

# エントリポイントスクリプトをコピー
COPY --chown=node:node docker-entrypoint.sh /usr/local/bin/docker-entrypoint.sh
RUN chmod +x /usr/local/bin/docker-entrypoint.sh

USER node

ENV PORT=4000
ENV NODE_ENV=production
ENV MODELER_DATA_DIR=/app/data
ENV CLIENT_DIST_DIR=/app/client/dist
ENV LOG_LEVEL=info

EXPOSE 4000

VOLUME ["/app/data", "/app/log"]

# Node 24 の組み込みfetchを使用 (curl不要)
HEALTHCHECK --interval=30s --timeout=5s --start-period=15s --retries=3 \
  CMD node -e "fetch('http://localhost:4000/health').then(r=>r.ok?process.exit(0):process.exit(1)).catch(()=>process.exit(1))"

ENTRYPOINT ["docker-entrypoint.sh"]
CMD ["node", "server/dist/index.js"]
