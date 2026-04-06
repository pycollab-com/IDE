# PyCollab

A browser-based collaborative Python IDE where users can work on Python projects together in real time. Projects can be shared with others via a simple 6-character share code (`0-9`, `a-z`), and code is executed in-browser with a Pyodide runtime (interactive `input()` supported).

Access the live site here: [https://pythoncollab.onrender.com](https://pythoncollab.onrender.com) 

---

## Features (very very good)

- Real-time collaborative editing with multiple users.
- Browser-side live Python execution (Pyodide Worker) with stream-based stdout/stderr and interactive stdin.
- Project sharing using 6-character share codes (`0-9`, `a-z`).
- Guest login or account-based access.
- Persistent storage for projects, files, and collaborators.

---

## Brand Colours

Source of truth: `client/src/index.css` (`:root` and `[data-theme="light"]`).

| Token | Hex | Typical Use | Accessible Text Pair |
| --- | --- | --- | --- |
| `--primary` | `#899878` | Primary actions, highlights | `#121113` (6.12:1) |
| `--secondary` | `#7f8e6d` | Secondary actions, accents | `#121113` (5.37:1) |
| `--accent` | `#9caa88` | Accent surfaces, emphasis | `#121113` (7.64:1) |
| `--bg-color` (dark) | `#121113` | Dark theme background | `#f7f7f2` (17.52:1) |
| `--bg-color` (light) | `#f7f7f2` | Light theme background | `#121113` (17.52:1) |
| `--text-color` (dark) | `#f7f7f2` | Dark theme text | On `#121113` |
| `--text-color` (light) | `#121113` | Light theme text | On `#f7f7f2` |

Accessibility note: avoid `#f7f7f2` text on the green brand colours for normal-size body text; use `#121113` for AA-compliant contrast.

---

## Brand Typography

Landing page nav logo (`PyCollab`) source of truth:
- Component: `client/src/pages/Landing.jsx` (`.logo`)
- Font family: inherits `var(--font-sans)` from `body`
- Implemented stack: `system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
- Weight / spacing used for the logo: `700`, `letter-spacing: -0.03em`

Rendered face depends on the platform:
- macOS / iOS: San Francisco system UI
- Windows: Segoe UI
- Other systems: the next available fallback in the stack

This means the landing page logo does not use a separate branded font file right now; it uses the host OS system sans font.

---

## Configuration

### Local Development Setup

For local development, you can use a `.env` file:

1. Copy `.env.example` to `.env`:
   ```bash
   cp .env.example .env
   ```

2. Edit `.env` and configure your environment variables

### Local Testing Override Profile

Use this only for local testing on your machine. Do not copy these substitutions into deployment envs.

The current local testing profile keeps the same app-level settings you use elsewhere, but swaps only the infrastructure values that are not valid on a local workstation:
- `DATABASE_URL` uses local SQLite instead of the Railway internal Postgres host.
- `PYCOLLAB_UPLOADS_DIR` points at the repo-local uploads folder instead of `/data/uploads`.

Example local-only shell exports:

```bash
export ACCESS_TOKEN_EXPIRE_MINUTES="10080"
export ADMIN_BOOTSTRAP_PROMOTE="false"
export ALLOWED_ORIGINS="http://localhost:5173,http://localhost:8000"
export AUTH_RATE_LIMIT_PER_MINUTE="10"
export DATABASE_URL="sqlite:////tmp/pycollab-local-test.db"
export ENVIRONMENT="development"
export GOOGLE_OAUTH_CLIENT_ID="673654005602-gecd1ltp10rttmh177k0onqignmcofag.apps.googleusercontent.com"
export GOOGLE_SIGNUP_TOKEN_EXPIRE_MINUTES="15"
export LOG_LEVEL="INFO"
export MAX_PROFILE_PICTURE_BYTES="1048576"
export MAX_WS_PAYLOAD_BYTES="200000"
export OPENAI_MODEL="gpt-4o-mini"
export PROJECT_RATE_LIMIT_PER_MINUTE="60"
export PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION="true"
export PYCOLLAB_PYODIDE_BASE_URL="https://cdn.jsdelivr.net/pyodide/v0.29.3/full/"
export PYCOLLAB_PYODIDE_MAX_RUN_SECONDS="0"
export PYCOLLAB_PYODIDE_VERSION="0.29.3"
export PYCOLLAB_UPLOADS_DIR="/Users/adam/Desktop/Programming/websites/pycollab/Web/server/uploads"
export RAILWAY_RUN_UID="0"
export SECRET_KEY='KJDFSNKJNDFKNDFKLJSFNKLFJS#$%^&*&*(^%^UDSYIJKHVDGFKABHVFGJGBGKSFHGVKBGDFJHFDVBGDHKFJ'
export SOCKET_RATE_LIMIT_PER_SECOND="20"
export VITE_GOOGLE_CLIENT_ID="673654005602-gecd1ltp10rttmh177k0onqignmcofag.apps.googleusercontent.com"
export WEBAUTHN_RP_NAME="PyCollab"
```

Run locally with:

```bash
python3 -m uvicorn main:app --host 127.0.0.1 --port 8000
```

Notes:
- This does not change deploy behavior unless you explicitly set these values in your deploy environment.
- The Railway internal Postgres hostname will not resolve from a normal local machine.
- `/data/uploads` is a deploy/container path and should stay a local path when testing outside that environment.

### Docker/Production Setup

When running in Docker or production environments, set environment variables directly:

**Using Docker:**
```bash
docker run -e DATABASE_URL=... your-image
```

**Using docker-compose.yml:**
```yaml
environment:
  - DATABASE_URL=postgresql://...
```

### Google OAuth Setup

To enable Google sign-in/sign-up, set both of these to the same Google Web client ID:
- `GOOGLE_OAUTH_CLIENT_ID` (backend token verification)
- `VITE_GOOGLE_CLIENT_ID` (frontend Google button/provider)

Email verification note:
- Account emails are now Google-verified only.
- Users must verify/update email from Settings using Google OAuth (direct manual email edits are rejected).

### Pyodide Runtime Setup

The application executes Python in the browser using Pyodide. The backend serves runtime config only; it does not execute user Python code.

**Optional Environment Variables:**
- `PYCOLLAB_PYODIDE_VERSION` - pinned Pyodide version (default `0.29.3`).
- `PYCOLLAB_PYODIDE_BASE_URL` - full base URL for the Pyodide distribution.
- `PYCOLLAB_PYODIDE_ALLOWED_PACKAGES` - comma-separated package allowlist for runtime imports and `micropip.install`.
- `PYCOLLAB_PYODIDE_MAX_RUN_SECONDS` - max execution time before interruption (`0` disables timeout; default).
- `PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION` - defaults to `true`; set to `false` only if you intentionally disable browser execution.
- `PYCOLLAB_UPLOADS_DIR` - absolute path for persisted uploads (defaults to `server/uploads`; set this to your platform volume mount path in production).

### Browser Isolation Mode

Full-fidelity interrupts and blocking stdin require cross-origin isolation (enabled by default):
- `Cross-Origin-Opener-Policy: same-origin`
- `Cross-Origin-Embedder-Policy: require-corp`

If `window.crossOriginIsolated` is false, runtime initialization fails with a clear error and execution is blocked.

---

## How it Works

1. **Create a Project**  
   Start a new project with a starter Python file included automatically.

2. **Edit Files**  
   Open and edit project files. Changes sync live to all collaborators. Remote cursors and selections are visible for smooth collaboration.

3. **Run Code**  
   Execute Python files in a dedicated browser worker and stream output to the terminal panel in real time.

4. **Share Projects**  
   Generate a 6-character share code to allow others to join your project. Collaborators added through the code can edit files and run code alongside you.

---

## Getting Started

- Visit the live IDE: [https://pycollab.com](https://pycollab.com)  
- Create a project or join one using a shared code.  
- Start coding immediately, no local setup required.

---

## Notes

- Collaboration merges concurrent edits (no more last-writer-wins overwrites).  
- Guest access allows quick entry without registration.  
- The IDE provides a project dashboard for creating, opening, and joining projects.  
- Python execution is stream-based in browser runtime workers, enabling interactive stdin and progressive output.
- Package loading is policy-controlled by backend allowlist config.
