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
.app (package as a .zip release asset)
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

## Publish Release Assets

The web app has a desktop downloads page at:

```text
/desktop
```

By default, it links to the latest GitHub Release asset:

```text
https://github.com/CharlesKasasira/iHatePDF/releases/latest/download/ihatepdf-desktop-macos.zip
```

Do not commit installers under `apps/web/public`. Package the macOS app and
upload it directly to a GitHub Release:

```text
ditto -c -k --sequesterRsrc --keepParent \
  apps/desktop/src-tauri/target/release/bundle/macos/iHatePDF.app \
  ihatepdf-desktop-macos.zip
shasum -a 256 ihatepdf-desktop-macos.zip > SHA256SUMS
gh release upload v0.1.0 ihatepdf-desktop-macos.zip SHA256SUMS
```

Use stable asset names when additional platforms are ready:

```text
ihatepdf-desktop-macos.zip
ihatepdf-desktop-windows.msi
ihatepdf-desktop-linux.AppImage
ihatepdf-desktop-linux.deb
```

Set this environment variable to use a mirror or a different release repository:

```bash
NEXT_PUBLIC_DESKTOP_DOWNLOAD_BASE_URL=https://github.com/OWNER/REPO/releases/latest/download
```

The current macOS preview is Apple-silicon-only, ad-hoc signed, and not
notarized. Keep that limitation visible in release notes until Developer ID
signing and Apple notarization are part of the release pipeline.
