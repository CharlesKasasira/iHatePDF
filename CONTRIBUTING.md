# Contributing

Thank you for helping improve iHatePDF.

1. Fork the repository and branch from `development`.
2. Install Node.js 22+ and pnpm 9, then run `pnpm install --frozen-lockfile`.
3. Keep changes focused and add tests for security boundaries and regressions.
4. Run `pnpm lint`, `pnpm test`, `pnpm build`, and `pnpm security:audit`.
5. Open a pull request describing the behavior change and verification.

Do not commit credentials, uploaded documents, generated build metadata, or
desktop installers. Publish release binaries as GitHub Release assets.

Report vulnerabilities privately according to [SECURITY.md](SECURITY.md).
