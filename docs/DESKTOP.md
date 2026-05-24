# iHatePDF Desktop

The desktop app lives in `apps/desktop` and is powered by Tauri, React, TypeScript, and the existing iHatePDF API.

## Prerequisites

- Node.js 22+
- pnpm 9+
- Docker and Docker Compose for the API dependencies
- Rust and Cargo from `https://rustup.rs`
- Tauri OS prerequisites for your platform

## Run Locally

Start the API, web app, and worker:

```bash
pnpm install
docker compose up -d
pnpm --filter @ihatepdf/api prisma:generate
pnpm --filter @ihatepdf/api prisma migrate deploy
pnpm dev
```

In another terminal, run the desktop app:

```bash
pnpm dev:desktop
```

The desktop app defaults to:

```text
http://localhost:4000/api
```

You can change the API server from the desktop app settings.

## Build Installers

Tauri builds the installer for the operating system you are currently running.

macOS:

```bash
pnpm build:desktop
```

Expected artifact type:

```text
.dmg
```

Windows:

```powershell
pnpm build:desktop
```

Expected artifact type:

```text
.msi
```

Linux:

```bash
pnpm build:desktop
```

Expected artifact types:

```text
.AppImage
.deb
```

## Publish Web Downloads

The web app has a desktop downloads page at:

```text
/desktop
```

By default, it links to these public paths:

```text
/downloads/desktop/ihatepdf-desktop-macos.dmg
/downloads/desktop/ihatepdf-desktop-windows.msi
/downloads/desktop/ihatepdf-desktop-linux.AppImage
/downloads/desktop/ihatepdf-desktop-linux.deb
```

After building installers on each OS, copy or upload the artifacts to:

```text
apps/web/public/downloads/desktop/
```

Use exactly these filenames:

```text
ihatepdf-desktop-macos.dmg
ihatepdf-desktop-windows.msi
ihatepdf-desktop-linux.AppImage
ihatepdf-desktop-linux.deb
```

Alternatively, set this environment variable to point the web app at a release bucket or GitHub Releases URL:

```bash
NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL=https://example.com/ihatepdf/desktop
```
