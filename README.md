# PyCollab IDE

PyCollab IDE is the offline desktop edition of PyCollab for Python and PyBricks projects.

It keeps the familiar PyCollab editor feel, but removes the hosted product baggage: no login, no collaboration backend, no share pins, no profiles, and no internet dependency for normal local work. The goal is a fast, competition-friendly IDE for robotics teams that need local editing, local projects, and offline PyBricks workflows.

## Download

- macOS DMG: [Download the latest release](https://github.com/pycollab-com/pythonCollab/releases/latest/download/PyCollab.IDE.dmg)
- All builds and release notes: [GitHub Releases](https://github.com/pycollab-com/pythonCollab/releases)

## What It Does

- Open local folders and work in place
- Create local projects with Normal or PyBricks project types
- Edit Python files in a PyCollab-style editor UI
- Run normal Python projects with a local Pyodide runtime
- Connect to PyBricks hubs locally over Bluetooth or wired transport
- Use PyBricks block coding offline
- Keep local tasks and checkpoints inside the project

## What It Intentionally Does Not Do

- Accounts, login, or signup
- Realtime collaboration
- Messaging, profiles, or social features
- Public/private hosted project sharing
- Dependency on an internet-hosted backend

## Project Structure

- `client/` React + Vite renderer
- `desktop/` Electron shell, preload bridge, desktop packaging
- `server/` local FastAPI backend for project, file, task, checkpoint, and runtime APIs
- `logo.png` source branding asset used for desktop packaging

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

## Notes

- This repository is focused on the offline IDE product surface, not the original hosted collaborative app.
- Local packaging outputs such as `.dmg` files and temporary build artifacts should stay out of git.
