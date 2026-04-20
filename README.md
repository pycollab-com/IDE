# PyCollab IDE

PyCollab IDE is the offline desktop branch of PyCollab.

This branch keeps the PyCollab visual identity and editor workflow, but removes the online product assumptions: no auth, no collaboration, no share codes, no profiles, no backend dependency on an internet-hosted service. The goal is a local-first robotics IDE that still feels like PyCollab, especially for PyBricks competition use.

## What This Branch Is

- Electron desktop shell in `desktop/`
- Local FastAPI service for project/file/runtime APIs in `server/`
- React/Vite renderer in `client/`
- Folder-backed local projects with `.pycollab/` metadata
- Two project types: normal Python and PyBricks
- Local Pyodide runtime assets vendored into the app

## Core Product Rules

- Preserve PyCollab familiarity inside the editor.
- Strip online features instead of mocking them locally.
- Keep local project flows simple: create, open folder, edit in place.
- Prefer small, obvious code paths over compatibility layers.
- Do not let generated junk or packaging leftovers accumulate in the branch.

## Current Scope

Implemented in this branch:

- Local welcome flow for new projects and opening folders
- Local editor flow with file tree, editor, terminal, tasks, checkpoints, and theme controls
- Local Pyodide runtime configuration
- Electron desktop shell and preload bridge
- PyBricks-oriented offline project support
- Branded macOS DMG builder in `desktop/build_dmg.py`

Explicitly not part of this branch:

- login/signup
- share pins
- realtime collaboration
- profiles/messages/social flows
- public/private hosted project concepts

## Repository Layout

- `client/`: renderer app
- `desktop/`: Electron shell, icons, DMG packaging
- `server/`: local IDE backend
- `logo.png`: source image used for desktop branding assets

## Development

Install dependencies:

```bash
npm install
npm --prefix client install
npm --prefix desktop install
```

Run the renderer build:

```bash
npm --prefix client run build
```

Run the desktop shell in development:

```bash
npm --prefix desktop start
```

## Packaging

Build the macOS app bundle:

```bash
npm --prefix desktop run build:mac
```

Build the branded DMG:

```bash
python3 desktop/build_dmg.py
```

The DMG output is local-only and should not be committed.

## Branch Hygiene

- Keep docs aligned with the offline IDE, not the hosted collaborative product.
- Do not commit local packaging outputs such as `.dmg`, `desktop/release/`, or cache files.
- Remove dead migration code when the branch direction is clear.
- If a change adds complexity without improving the local IDE path, it is probably the wrong change.
