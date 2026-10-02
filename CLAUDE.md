# claude-workshop

A Claude Code plugin marketplace, published on GitHub as `doxxx/claude-workshop`.

## Layout

- `.claude-plugin/marketplace.json`: the marketplace manifest. It lists each plugin with its `source` under `plugins/`.
- `plugins/<name>/`: one folder per plugin, with its own `.claude-plugin/plugin.json`.
- `README.md`: the install commands and a one-line summary of each plugin. Update it when a plugin is added or renamed.

## Rules

- Keep the marketplace name `claude-workshop`. Claude Code rejects names that look like official ones, such as `claude-marketplace` and `claude-plugins`.
- Keep a plugin's `version`, `homepage`, `repository`, `license` and `keywords` the same in `marketplace.json` and its `plugin.json`.
- Bump the plugin's `version` in both files when its behaviour changes, so installs pick up the update.
- Don't put an email address in either manifest.

## Checks

Run these after every change:

```
claude plugin validate .
claude plugin validate plugins/<name>
claude plugin test plugins/<name>
```

## Hooks mods (usage-band)

`usage-band` is a function-hooks mod: `hooks/hooks.json` names `hooks/register.tsx`, which exports `register`. That API is early access and can change between Claude Code releases. It was written and tested against Claude Code 2.1.288.

- Load the `plugin-authoring` skill before you change a hooks module. It holds the API reference and examples.
- To try changes live, run `claude --plugin-dir plugins/<name>`.
- Claude Code writes the API types into `.claude-plugin/types/` when it loads the mod. That folder is gitignored. `tsconfig.json` extends it, so `tsc -p plugins/<name>` works only after one load.
- Every `$.state` key the module uses must be declared in `types/index.d.ts` under `interface PluginState`. That file may export types only.
- A `turn.step` hook must be an async generator (`async function*`) that forwards the stream with `yield* next(e)`.
- The hooks environment has no Node and no local timezone. `usage-band` gets the offset from `date +%z` at session start.
- The API does not report the prompt cache TTL. `usage-band` assumes 1 hour, which is what main-thread requests on this account use.
