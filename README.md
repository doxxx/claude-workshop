# claude-workshop

Gordon Tyler's Claude Code plugins.

## Install

```
/plugin marketplace add doxxx/claude-workshop
/plugin install usage-band@claude-workshop
```

To use a local clone instead, add the marketplace with its path, such as
`/plugin marketplace add ~/Projects/claude-workshop`.

## Plugins

- **usage-band**: a band above the prompt with the directory and git branch
  in its top border (with incoming and outgoing commits and the count of
  modified files) and the model and effort at its right end, then progress
  bars spread across the width for the context window (with the prompt cache
  expiry), the 5-hour session limit and the weekly limit. In the desktop app, which shows the folder, branch, model and
  effort itself, the band shows only the usage bars.
