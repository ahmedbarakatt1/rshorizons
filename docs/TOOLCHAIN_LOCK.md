# Toolchain lock

Discovery date: 2026-10-20. Application package versions must be exact and committed in `package-lock.json`.

| Tool | Observed version | Evidence |
|---|---|---|
| Node | 22.22.2 | `node --version` |
| npm | 10.9.7 | `npm.cmd --version` |
| Python | 3.11.1 | `python --version` |
| Git | 2.47.1.windows.1 | `git --version` |
| PostgreSQL | 17 installed | Host binary discovery; exact server version to be logged on start |
| Codex CLI | 0.159.0 | Resource agent discovery |

Registry discovery: Next.js 16.4.2 requires Node >=20.9.0; React 19.3.1. Package metadata, compatibility, security audit and install evidence are recorded as they are executed. No framework compatibility/build success is claimed yet.

Five-resource versions and installation evidence: `TOOLS_VERIFICATION.md`.

## Dependency compatibility and security

- React 19.3.1 / Next 16.4.2 / next-intl 4.14.9 satisfy inspected peer ranges.
- TypeScript 7.0.2 was the registry newest version but is outside typescript-eslint's supported `<6.1` range. Pin 6.0.3.
- The Next ESLint preset pulls `fast-glob → micromatch → braces` (GHSA-vfj7-8cjw-p6xm), with no patched braces release at discovery. Replaced that lint dependency chain with ESLint 10.13.0, typescript-eslint 8.72.0 and React Hooks 7.1.1. Accessibility remains covered by axe/browser tests.
- Initial interrupted dependency install produced missing lock/package metadata. Preserved generated tree and lock under ignored `.local/failed-*`; rebuilt a clean dependency tree. Original user files were untouched.
- Initial M0 validation RED: 13 failing / 4 passing; GREEN: 17 passing. Logs: `docs/evidence/m0-red.txt`, `m0-green.txt`.
