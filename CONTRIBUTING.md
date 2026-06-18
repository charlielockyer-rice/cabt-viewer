# Contributing

These rules apply to `cabt-viewer`.

## Code Style

- New `.svelte` files use Svelte 5 runes from the first commit:
  `$props`, `$state`, `$derived`, and `$effect`.
- New child-to-parent communication uses callback props. Do not add new
  `createEventDispatcher` usage.
- New shared reactive state lives in `.svelte.ts` modules, not as new
  top-level feature state in `App.svelte`.
- Per-prompt-instance state stays in that prompt component. Do not create
  long-lived singleton stores for prompt-local selections or assignments.
- Component-local styling belongs in component `<style>` blocks. Global CSS is
  only for tokens, resets, and genuinely cross-cutting rules.
- Prompt field access should go through helpers in `src/lib/game/prompts.ts`.
  Do not add new prompt-field `as any` outside that module.
- Keep leaf components presentational by default. Store imports belong in
  explicit container components.
- Keep Kaggle-provided native engine files and private agents out of this repo.
  Use `CABT_SAMPLE_SUBMISSION_DIR` for local engine resources.

## Verification

For meaningful changes:

```sh
npm run build
npm test
```

Use these as sanity checks while migrating:

```sh
rg -n '\$state|\$derived|\$effect|\$props|\$bindable' src/
rg -n 'export let' src/
rg -n 'as any' src/
rg -n 'createEventDispatcher' src/
```
