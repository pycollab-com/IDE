# PyCollab IDE

PyCollab IDE is the desktop app for PyCollab. It should feel like the web app, with the same account-based flow, dashboard, editor, branding, and collaboration model when online.

The desktop-specific responsibility is competition-safe offline access:

- Online hosted projects behave like PyCollab Web.
- Hosted projects opened online are cached locally for later access.
- Cached hosted projects are read-only when the app cannot reach PyCollab services.
- Editing offline requires creating an explicit local copy.
- Local copies are separate projects stored on the device and do not auto-sync back to the hosted project.

This avoids hidden conflict resolution while still letting teams access code during competitions where Wi-Fi may be unavailable.

## Product Modes

### Online Hosted Mode

- User signs in with the same account used on PyCollab Web.
- Dashboard, project opening, sharing, collaboration, settings, and profiles should match Web behavior.
- Hosted project edits go through the hosted backend and realtime channel.
- The desktop shell should add only native affordances such as update checks, file reveal, Bluetooth permissions, and offline notices.

### Offline Cached Mode

- Available only for hosted projects previously opened while online.
- Shows the latest locally cached project snapshot.
- Files are read-only.
- Realtime collaboration, share actions, messaging, and hosted mutations are unavailable.
- The primary action is to create a local copy.

### Local Copy Mode

- Editable project stored on the local device.
- Uses the local FastAPI service for files, tasks, checkpoints, runtime config, and PyBricks workflows.
- Clearly identifies the project as a local/offline copy.
- May preserve origin metadata, but must not pretend to be the hosted project.

## Project Structure

- `client/` React + Vite renderer.
- `desktop/` Electron shell, preload bridge, desktop packaging.
- `server/` local FastAPI service for desktop-native storage, cache, local copies, and runtime APIs.
- `logo.png` source branding asset used for desktop packaging.

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

- Keep PyCollab brand identity consistent with Web.
- Do not make broad Web UI changes unless they are necessary to support shared desktop/web behavior.
- Generated artifacts such as `.dmg`, `desktop/release/`, `desktop/build-temp/`, `client/dist/`, `__pycache__/`, and machine-specific outputs should stay out of commits unless explicitly intended.
