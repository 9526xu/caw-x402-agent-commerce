# Domain Docs

How the engineering skills should consume this repo's domain documentation when exploring the codebase.

## Layout

This repo uses a single-context domain docs layout.

- Repository-level domain context belongs in `CONTEXT.md` at the repo root.
- Architectural decision records belong in `docs/adr/`.
- Demo-specific context belongs next to each demo, typically in that demo's `README.md` or local `docs/` directory.
- If this repo later grows into multiple long-lived contexts with distinct domains or architectures, add `CONTEXT-MAP.md` at the repo root and migrate to the multi-context layout.

## Before exploring, read these

- **`CONTEXT.md`** at the repo root, if it exists.
- **`docs/adr/`** for ADRs that touch the area you're about to work in.
- The relevant demo's local `README.md` or `docs/` directory when working inside a specific demo.
- **`CONTEXT-MAP.md`** at the repo root if it exists; it points at one `CONTEXT.md` per context. Read each one relevant to the topic.

If any of these files don't exist, proceed silently. Don't flag their absence or suggest creating them upfront. The producer skill (`/grill-with-docs`) creates them lazily when terms or decisions actually get resolved.

## File structure

Current single-context layout:

```text
/
|-- CONTEXT.md
|-- docs/
|   |-- adr/
|   `-- agents/
`-- <demo>/
    |-- README.md
    `-- docs/
```

Future multi-context layout, if needed:

```text
/
|-- CONTEXT-MAP.md
|-- docs/
|   `-- adr/
`-- <demo-or-context>/
    |-- CONTEXT.md
    `-- docs/
        `-- adr/
```

## Use the glossary's vocabulary

When your output names a domain concept in an issue title, a refactor proposal, a hypothesis, or a test name, use the term as defined in `CONTEXT.md`. Don't drift to synonyms the glossary explicitly avoids.

If the concept you need isn't in the glossary yet, that's a signal: either you're inventing language the project doesn't use, or there's a real gap to note for `/grill-with-docs`.

## Flag ADR conflicts

If your output contradicts an existing ADR, surface it explicitly rather than silently overriding:

> _Contradicts ADR-0007 (event-sourced orders), but worth reopening because..._
