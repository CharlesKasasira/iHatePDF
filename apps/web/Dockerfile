FROM node:22-alpine

RUN apk add --no-cache libc6-compat

WORKDIR /app

COPY package.json pnpm-workspace.yaml turbo.json tsconfig.base.json ./
COPY apps/web/package.json apps/web/package.json

RUN corepack enable && pnpm install --no-frozen-lockfile

COPY . .

RUN pnpm --filter @ihatepdf/web build

CMD ["pnpm", "--filter", "@ihatepdf/web", "start"]
