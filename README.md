# Deep Tavern

Deep Tavern is an installable DeepSeek Harness web bundle that adds workspace-scoped character expressions to the native Chat experience through modular right-sidebar tabs. It does not replace DSH sessions, agents, models, tools, the transcript, or its composer.

## Features

- A **Character** right-sidebar tab showing only the live sprite, without text or manual overrides. It stays blank when no sprite is available.
- An **Expressions** right-sidebar tab for fallback selection, per-expression image management, ZIP import, and classifier status.
- Backend-only emotion classification with `Cohee/distilbert-base-uncased-go-emotions-onnx` and the 28 GoEmotions labels.
- A workspace-local expression pack at `.dsh/character-expressions/` with a manifest and opaque image assets.
- Per-label image upload, ZIP import API, fallback selection, and random multiple-sprite selection.
- Binary uploads are split into bounded chunks so sprite images and ZIP packs do not exceed ordinary reverse-proxy request limits.
- Sprite images and ZIP pack uploads accept up to 50 MiB each.
- A lightweight expression-only DSH event projection; the native Chat keeps ownership of the transcript and all of its extensions.
- Workspace-scoped expression settings alongside the portrait in the right Sidebar.

Version 0.1.7 targets DSH `0.2.2-rc.1`. Expressions use native ignorable
`plugin:deep-tavern/expression` records; the Client also reads the older event
name. HTTP actions and assets require native authenticated-owner admission.
Existing Sessions still follow the native Harness format-migration flow.

## Install from a checkout

```sh
npm install
npm run build
dsh plugin --profile web add ./
dsh --profile web
```

## Install a prebuilt GitHub Release

Tagged releases are built and tested on GitHub-hosted Node 24 runners. Each
release includes `dsh-deep-tavern-<version>.tgz` and `SHA256SUMS`; using the
tarball avoids the Git dependency `prepare` step on the DSH server.

```sh
dsh plugin --profile web add https://github.com/ZhenyaPav/dsh-deep-tavern/releases/download/v<version>/dsh-deep-tavern-<version>.tgz
```

The backend classifier still uses `onnxruntime-node`. In profiles that block
all dependency lifecycle scripts, approve that dependency through the profile's
`pnpm-workspace.yaml` (or `pnpm approve-builds`) before installing.

Open a workspace session, expand the right sidebar, then add **Character** or **Expressions** from its tab guide. Use **Expressions** to upload individual sprites or a flat label-named ZIP. The first model download starts when the bundle loads and is cached under `~/.dsh/models/deep-tavern` by default.

## Data and privacy

Images are stored only in the workspace that owns them, under `.dsh/character-expressions/`. Model inference runs in the DSH Node host; the browser never loads ONNX Runtime or model weights. The browser receives only expression labels, workspace manifests, and images from the local `/deep-tavern` route.

The initial release deliberately does not implement character cards, lorebooks, group chat, or a prompt pipeline. Its visual style is original work inspired by SillyTavern’s documented expression behavior; it contains no copied SillyTavern source or assets.

## Development

```sh
npm run check
```

With the current Harness source checkout beside this repository (or set `DSH_SOURCE`),
run `npm run test:harness` to check expression recording and replay against the real Session implementation.
