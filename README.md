# Deep Tavern

Deep Tavern is an installable DeepSeek Harness web bundle that adds a **Character Chat** view: a SillyTavern-inspired transcript and persistent character portrait stage, without replacing DSH sessions, agents, models, tools, or its composer.

## Features

- A selectable Character Chat tab with a large, persistent left portrait rail.
- Backend-only emotion classification with `Cohee/distilbert-base-uncased-go-emotions-onnx` and the 28 GoEmotions labels.
- A workspace-local expression pack at `.dsh/character-expressions/` with a manifest and opaque image assets.
- Per-label image upload, ZIP import API, fallback selection, random multiple-sprite selection, and an in-chat manual expression picker.
- Full DSH event projection for user/assistant messages, tool calls/results, attempts, live text chunks, and turn completion.
- A Character Chat settings page with classifier state and the active workspace’s sprite manager.

## Install from a checkout

```sh
npm install
npm run build
dsh plugin --profile web add ./
dsh --profile web
```

Open a workspace session, select **Character Chat** from the conversation-view tabs, then open **Settings → Character Chat** to upload expression images. The first model download starts when the bundle loads and is cached under `~/.dsh/models/deep-tavern` by default.

## Data and privacy

Images are stored only in the workspace that owns them, under `.dsh/character-expressions/`. Model inference runs in the DSH Node host; the browser never loads ONNX Runtime or model weights. The browser receives only expression labels, workspace manifests, and images from the local `/deep-tavern` route.

The initial release deliberately does not implement character cards, lorebooks, group chat, or a prompt pipeline. Its visual style is original work inspired by SillyTavern’s documented expression behavior; it contains no copied SillyTavern source or assets.

## Development

```sh
npm run check
```
