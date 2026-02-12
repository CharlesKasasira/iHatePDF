FROM node:22-alpine

RUN apk add --no-cache qpdf libc6-compat

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/worker/package.json apps/worker/package.json
COPY apps/api/package.json apps/api/package.json
COPY packages/shared/package.json packages/shared/package.json

RUN corepack enable && pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @ihatepdf/worker build

CMD ["pnpm", "--filter", "@ihatepdf/worker", "start"]
