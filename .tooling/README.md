# Development resource tooling

This directory isolates the requested resource CLIs from the tourism application's runtime. npm is the only package manager used.

```powershell
npm.cmd ci --prefix .tooling --ignore-scripts
node .tooling/node_modules/@playwright/cli/playwright-cli.js --version
node .tooling/node_modules/impeccable/cli/bin/cli.js --version
node .tooling/node_modules/img2threejs/bin/img2threejs.mjs version
```

Canonical committed skill source lives in `../.agents/skills`. Acquisition clones in `sources/`, package archives in `packages/`, and `node_modules/` are disposable and must not be deployed. Do not rerun an unpinned skill updater as part of a production build.

See `../docs/TOOLS_VERIFICATION.md` for reviewed installer behavior, exact source revisions, hashes and evidence, and `../docs/TOOL_USAGE.md` for application evidence and commands. The resources have no need for production credentials.
