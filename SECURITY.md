# Security Policy

## Supported versions

Security fixes are applied to the latest release and the `main` branch. Older
releases are not maintained unless a release note says otherwise.

## Reporting a vulnerability

Please do not open a public issue for a suspected vulnerability. Use
[GitHub private vulnerability reporting](https://github.com/CharlesKasasira/iHatePDF/security/advisories/new)
and include:

- the affected endpoint, component, and version or commit;
- reproduction steps or a minimal proof of concept;
- the expected security impact; and
- any suggested mitigation.

You should receive an acknowledgement within seven days. We will coordinate a
fix and disclosure timeline after reproducing the issue. Please avoid accessing
other people's data, disrupting hosted services, or publishing details before a
fix is available.

## Deployment responsibility

Self-hosters are responsible for TLS, secrets, database and storage access,
backups, container updates, and monitoring. Review `.env.example` and the
production guidance before exposing an instance to the internet.
