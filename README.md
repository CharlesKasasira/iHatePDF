# iHatePDF (Open-Source iLovePDF Alternative)

This repo is a self-hosted, open-source PDF platform starter with these implemented features:

- Merge PDF files (ordered merge)
- Split PDF files (single or multiple ranges)
- Sign PDF files (image signature placement)
- Signature requests (email link + remote sign page)

## Stack

- Frontend: Next.js + React + TypeScript
- API: NestJS + Fastify + Prisma
- Worker: BullMQ + pdf-lib
- Data: PostgreSQL
- Queue: Valkey
- File storage: local filesystem (`./storage`)
- Email (local dev): Mailpit

## Project Structure

- `/apps/web` Next.js app
- `/apps/api` NestJS API
- `/apps/worker` background job worker
- `/packages/shared` shared types/schemas
- `/docker-compose.yml` local OSS infrastructure services

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker + Docker Compose

## Quick Start

1. Start infrastructure:

```bash
docker compose up -d
```

2. Install dependencies:

```bash
pnpm install
```

3. Configure env files:

```bash
cp apps/api/.env.example apps/api/.env
cp apps/worker/.env.example apps/worker/.env
cp apps/web/.env.example apps/web/.env.local
```

4. Run Prisma migration:

```bash
pnpm --filter @ihatepdf/api prisma:generate
pnpm --filter @ihatepdf/api prisma migrate deploy
```

5. Start all apps:

```bash
pnpm dev
```

6. Open apps:

- Web UI: http://localhost:3000
- API: http://localhost:4000/api
- Mailpit inbox: http://localhost:8025

## Feature API Endpoints

- `POST /api/uploads` (JSON with `fileName`, `mimeType`, `dataBase64`)
- `GET /api/files/:id/download`
- `POST /api/tasks/merge`
- `POST /api/tasks/split`
- `POST /api/tasks/sign`
- `GET /api/tasks/:id`
- `POST /api/signature-requests`
- `GET /api/signature-requests/:token`
- `POST /api/signature-requests/:token/complete`

## Notes

- Split returns:
  - PDF when one range is requested
  - ZIP when multiple ranges are requested
- Sign coordinates (`x`, `y`) use PDF points from bottom-left origin.
- Uploaded and processed files are stored under `./storage` by default.
