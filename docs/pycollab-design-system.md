# PyCollab Design System

Version: 1.0.0  
Date: February 22, 2026  
Product: PyCollab (real-time collaborative Python IDE)

This system follows Apple Human Interface Guidelines principles of clarity, deference, and depth while expressing PyCollab's brand attributes: **Bold, Playful, Professional**.

## Brand Foundation

- Personality: Bold, Playful, Professional
- Primary emotion: Trust and Excitement
- Audience: Student developers, CS educators, and small engineering teams collaborating on Python in real time
- Product behavior to reinforce: fast collaboration, readable code, confidence during execution, low-friction project sharing

---

## 1) Foundations

## 1.1 Color System

### Primary Palette (6 Colors)

| Token | Role | Hex | RGB | HSL | Accessible Text Pair | Contrast | WCAG Rating |
|---|---|---|---|---|---|---|---|
| `color.primary.trustBlue` | Primary actions, links, active states | `#2D6CDF` | `rgb(45,108,223)` | `hsl(219,74%,53%)` | `#FFFFFF` | 4.86:1 | AA |
| `color.primary.collabTeal` | Collaboration signals, live indicators | `#00A8B5` | `rgb(0,168,181)` | `hsl(184,100%,35%)` | `#121113` | 6.52:1 | AA |
| `color.primary.pyOlive` | Brand continuity, secondary actions | `#899878` | `rgb(137,152,120)` | `hsl(88,13%,53%)` | `#121113` | 6.12:1 | AA |
| `color.primary.signalLime` | Highlight, success-adjacent emphasis | `#B8D66A` | `rgb(184,214,106)` | `hsl(77,57%,63%)` | `#121113` | 11.53:1 | AAA |
| `color.primary.sparkOrange` | Attention, urgency, prompts | `#FF8B3D` | `rgb(255,139,61)` | `hsl(24,100%,62%)` | `#121113` | 8.08:1 | AAA |
| `color.primary.graphite` | Text, dark surfaces, structural chrome | `#121113` | `rgb(18,17,19)` | `hsl(270,6%,7%)` | `#F7F7F2` | 17.52:1 | AAA |

### Semantic Colors

| Semantic Token | Light Mode | Dark Mode | Light Contrast on `#F7F7F2` | Dark Contrast on `#121113` | Use |
|---|---|---|---|---|---|
| `color.semantic.success` | `#1F9D61` | `#39C980` | 3.23:1 (icons/badges) | 8.82:1 | Pass states, completed runs, connected status |
| `color.semantic.warning` | `#B26A00` | `#FFB449` | 3.94:1 (icons/badges) | 10.65:1 | Potential data loss, unsaved changes |
| `color.semantic.error` | `#C7362D` | `#FF6E64` | 4.89:1 | 6.87:1 | Failed execution, auth problems, form errors |
| `color.semantic.info` | `#2D6CDF` | `#6F97FF` | 4.52:1 | 6.77:1 | Neutral notices, system events |

### Dark Mode Equivalents (Primary Colors)

| Light Token | Dark Equivalent | Contrast vs Dark Background `#121113` |
|---|---|---|
| `#2D6CDF` | `#6F97FF` | 6.77:1 |
| `#00A8B5` | `#42C9D4` | 9.45:1 |
| `#899878` | `#A8BC92` | 9.21:1 |
| `#B8D66A` | `#D3EA92` | 14.30:1 |
| `#FF8B3D` | `#FFB067` | 10.45:1 |
| `#121113` | `#F7F7F2` (inverse) | 17.52:1 |

### Color Usage Rules

1. Use `trustBlue` for single primary CTA per screen; never use more than one primary CTA in the same viewport region.
2. Use `collabTeal` only for real-time collaboration signals (presence, syncing, live cursors).
3. Reserve `sparkOrange` for attention-demanding but non-destructive signals; do not use it for errors.
4. Use `error` only for failed outcomes or blocking validation.
5. On colored surfaces, always use the documented accessible text pair; do not auto-invert text colors.
6. Keep decorative gradients behind content at <= 16% opacity.
7. In dark mode, increase border alpha by ~15% to preserve edge definition.
8. Charts: use at most 6 categorical hues from primary + semantic set, then vary stroke/pattern before introducing new colors.

## 1.2 Typography

### Font Families

- Primary: `SF Pro Display`, `SF Pro Text`, `-apple-system`, `BlinkMacSystemFont`, `Segoe UI`, sans-serif
- Code: `SF Mono`, `JetBrains Mono`, `ui-monospace`, monospace

### Implemented Landing Page Logo Typography

The landing page navigation logo text (`PyCollab`) currently does not declare a dedicated `font-family`.

- Source: `client/src/pages/Landing.jsx` (`.logo`)
- Inheritance path: `.logo` -> `body` -> `var(--font-sans)` from `client/src/index.css`
- Implemented stack: `system-ui, -apple-system, "Segoe UI", "Helvetica Neue", Arial, sans-serif`
- Implemented styling: `font-weight: 700`, `font-size: 1.35rem`, `letter-spacing: -0.03em`

Rendered face is platform-dependent:
- macOS / iOS: San Francisco system UI
- Windows: Segoe UI
- Fallbacks: `Helvetica Neue`, `Arial`, then generic `sans-serif`

Implementation note: this is the current code-level behavior for the landing page logo, even though higher-level brand guidance elsewhere in this document references the SF Pro family.

### Weight System (9 Weights)

| Weight Token | Numeric |
|---|---|
| `font.weight.ultraLight` | 100 |
| `font.weight.thin` | 200 |
| `font.weight.light` | 300 |
| `font.weight.regular` | 400 |
| `font.weight.medium` | 500 |
| `font.weight.semibold` | 600 |
| `font.weight.bold` | 700 |
| `font.weight.heavy` | 800 |
| `font.weight.black` | 900 |

### Type Roles and Scale (Desktop / Tablet / Mobile)

Format: `size / line-height / letter-spacing / weight`

| Role | Desktop (1440) | Tablet (768) | Mobile (375) |
|---|---|---|---|
| Display | `56 / 64 / -0.02em / 700` | `48 / 56 / -0.02em / 700` | `40 / 46 / -0.015em / 700` |
| Headline | `40 / 48 / -0.015em / 700` | `34 / 42 / -0.01em / 700` | `30 / 38 / -0.01em / 700` |
| Title | `30 / 38 / -0.01em / 600` | `28 / 34 / -0.008em / 600` | `24 / 30 / -0.006em / 600` |
| Body | `18 / 30 / 0em / 400` | `17 / 28 / 0em / 400` | `16 / 26 / 0em / 400` |
| Callout | `17 / 26 / 0em / 500` | `16 / 24 / 0em / 500` | `15 / 22 / 0em / 500` |
| Subheadline | `16 / 24 / 0.002em / 500` | `15 / 22 / 0.002em / 500` | `14 / 20 / 0.002em / 500` |
| Footnote | `14 / 20 / 0.004em / 500` | `13 / 18 / 0.004em / 500` | `12 / 17 / 0.004em / 500` |
| Caption | `12 / 16 / 0.006em / 500` | `12 / 16 / 0.006em / 500` | `11 / 14 / 0.006em / 500` |

### Font Pairing Strategy

1. Use `SF Pro Display` for Display, Headline, Title.
2. Use `SF Pro Text` for Body through Caption.
3. Use `SF Mono` for editor text, terminal, inline code, and code snippets.
4. Keep max 2 families visible in one viewport state to preserve clarity.

### Accessibility Legibility Rules

1. Minimum body text: 16px mobile, 17px tablet, 18px desktop for long-form copy.
2. Minimum interactive label: 14px semibold.
3. Minimum caption for non-interactive metadata: 11px, never for critical instructions.
4. Code editor minimum: 14px with 1.5 line-height.
5. Maintain paragraph measure at 45-75 characters.

## 1.3 Layout Grid

### 12-Column Responsive Grid

| Viewport | Canvas Width | Columns | Gutter | Outer Margin | Column Width |
|---|---|---:|---:|---:|---:|
| Desktop | 1440px | 12 | 24px | 60px | 88px |
| Tablet | 768px | 12 | 16px | 32px | 44px |
| Mobile | 375px | 12 | 12px | 16px | 17.58px (virtual) |

### Breakpoints

- `xs`: 0-479px
- `sm`: 480-767px
- `md`: 768-1023px
- `lg`: 1024-1439px
- `xl`: 1440px+

### Grid Usage Rules

1. Main shell (sidebar + content) should align to 12-column structure at all breakpoints.
2. On mobile, use grouped spans (3, 4, 6, 12) rather than single-column spans.
3. Maximum content width for reading surfaces: 960px.
4. Keep sticky toolbars within grid margins.

### Safe Areas (Notched Devices)

- Always pad interactive chrome by `env(safe-area-inset-top/right/bottom/left)`.
- Minimum bottom tap target clearance above home indicator: 12px.
- Tab bars and floating actions must include safe-area inset in final height calc.

## 1.4 Spacing System

Base unit: 8px with controlled half-step for compact controls.

| Token | Value | Usage |
|---|---:|---|
| `space.0_5` | 4px | Hairline separations, icon-label micro gaps |
| `space.1` | 8px | Tight internal spacing, compact chips |
| `space.1_5` | 12px | Form control internals, short lists |
| `space.2` | 16px | Standard control padding, card internals |
| `space.3` | 24px | Section spacing inside panels |
| `space.4` | 32px | Major block separation |
| `space.6` | 48px | Page section vertical rhythm |
| `space.8` | 64px | Hero spacing and major layout gutters |
| `space.12` | 96px | Landing page banding |
| `space.16` | 128px | Large campaign/marketing separations |

Rules:

1. Keep increments on this scale; avoid arbitrary values unless tied to safe-area math.
2. Horizontal and vertical rhythm should stay on the same token family for a given surface.
3. Use 4px only inside components, not between major layout sections.

---

## 2) Components (30+)

State shorthand used below: `D=Default`, `H=Hover`, `A=Active/Pressed`, `F=Focus-visible`, `Ds=Disabled`, `L=Loading`, `E=Error`.

## 2.1 Navigation

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Header (expanded, compact, editor) | Logo, project switcher, global actions, account menu | D/H/A/F/Ds/L | Use for global context and high-frequency actions. Do not overload with page-local controls. | Landmark `header`, roving tab for action cluster, skip-link target. | Height 72px desktop / 64px mobile; padding 0 24px; bottom border 1px; shadow `0 1px 0` |
| Tab Bar (top, bottom mobile) | Tab item, icon, label, active indicator | D/H/A/F/Ds | Use for peer-level destinations (3-5 tabs). Do not exceed 5 tabs. | `role=tablist`, arrow-key nav, `aria-selected`. | Height 56px; item min-width 72px; indicator 2px; radius 12px |
| Sidebar (full, collapsed, rail) | Section title, nav groups, collapse control | D/H/A/F/Ds | Use for dense workspace navigation. Do not use on single-task flows. | `nav` landmark, collapsible button with `aria-expanded`. | Width 280px full / 88px rail; padding 20px; gap 8px |
| Breadcrumbs (text, text+icon) | Root crumb, separators, current page | D/H/A/F/Ds | Use for deep IA paths (3+ levels). Do not repeat page title. | `nav aria-label="Breadcrumb"`, current node `aria-current="page"`. | Height 32px; gap 8px; separator opacity 40% |
| Command Palette (global, scoped) | Search input, grouped commands, shortcut hints | D/F/L/E | Use for power workflows and discoverability. Do not hide critical actions only here. | Trap focus in modal layer, `aria-activedescendant`, ESC close. | Width 680px max; item height 44px; radius 16px; shadow `0 24px 48px rgba(0,0,0,0.28)` |
| Project Switcher (dropdown, quick switch) | Current project chip, list, create action | D/H/A/F/L/E | Use when user can belong to many projects. Do not place project creation only in overflow. | Combobox pattern, typeahead, `aria-controls`. | Trigger height 40px; menu min-width 280px; row padding 10px 12px |

## 2.2 Input

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Buttons (primary, secondary, tertiary, destructive, ghost, link) | Container, label, icon start/end, spinner | D/H/A/F/Ds/L/E | Use primary once per region; use destructive only for irreversible actions. Do not use link style for destructive actions. | Native `<button>`, visible focus ring, `aria-busy` for loading. | Height 44px default / 36px compact; padding 0 16px; radius 12px; gap 8px |
| Icon Button (standard, tonal, danger) | Icon-only hit area, optional badge | D/H/A/F/Ds/L | Use for common reversible actions. Do not use without tooltip/label if icon is ambiguous. | `aria-label` required, touch target >= 44x44. | Size 44px; radius 12px; badge 16px |
| Split Button (action + caret) | Primary action segment, menu segment | D/H/A/F/Ds/L | Use for one default action + alternatives. Do not use when options have equal priority. | Arrow keys swap segment focus, menu semantics for caret. | Height 44px; left padding 16px; right segment width 40px |
| Text Field (single-line, with icon, with helper) | Label, input, helper/error text, optional prefix/suffix | D/H/A/F/Ds/L/E | Use for short text and IDs. Do not use for paragraphs. | Label always visible, `aria-invalid` on error, describedby helper ID. | Height 44px; horizontal padding 12px; radius 12px; border 1px |
| Text Area (resizable, autosize) | Label, textarea, count/helper, error line | D/H/A/F/Ds/L/E | Use for descriptions/messages. Do not constrain under 3 rows. | Character count announced via live region when near limit. | Min-height 120px; padding 12px; radius 12px |
| Search Field (inline, global) | Search icon, input, clear button, suggestion list | D/H/A/F/Ds/L/E | Use for quick retrieval. Do not reuse for command execution without clear affordance. | `role=search`, ESC clears suggestions, down arrow enters listbox. | Height 40px; radius 999px or 12px; left icon inset 12px |
| Dropdown / Select (single-select) | Label, trigger, selected value, menu list | D/H/A/F/Ds/L/E | Use for fixed option sets. Do not use for <=3 options (prefer radios). | Combobox/listbox semantics, typeahead, `aria-expanded`. | Trigger height 44px; menu radius 12px; item height 40px |
| Multi-select (chips, checklist) | Label, input trigger, token chips, menu | D/H/A/F/Ds/L/E | Use for tags/collaborators. Do not use for mandatory single choice. | Keyboard remove chips with backspace; announcements for add/remove. | Trigger min-height 44px; chip height 28px; gap 6px |
| Toggle Switch (default, with labels) | Track, thumb, optional text labels | D/H/A/F/Ds | Use for immediate binary settings. Do not use when action needs confirmation. | `role=switch`, `aria-checked`, space toggles. | 44x28 track; thumb 24px; travel 16px |
| Checkbox (single, indeterminate) | Box, check mark, label | D/H/A/F/Ds/E | Use for multi-select lists. Do not use for mutual exclusivity. | Native checkbox, indeterminate programmatically set. | Box 20px; label gap 10px; min row height 32px |
| Radio Group (stacked, inline) | Group label, radio control, option labels | D/H/A/F/Ds/E | Use for exclusive choices with low option count. Do not use for long lists. | `role=radiogroup`, arrows move selection. | Control 20px; row min-height 32px; group gap 8px |
| Slider (single, range) | Track, fill, thumb(s), value label | D/H/A/F/Ds | Use for approximate numeric ranges. Do not use for precise entry alone. | Arrow keys step, page keys jump 10x, value text label required. | Track height 4px; thumb 20px; min width 160px |
| Stepper (numeric, compact) | Minus button, value field, plus button | D/H/A/F/Ds/E | Use for bounded integer quantities. Do not use for large ranges. | Buttons labeled increment/decrement; value announced. | Height 36px; button width 36px; radius 10px |
| File Upload Dropzone (single, multi-file) | Drop area, icon, helper text, progress row | D/H/A/F/Ds/L/E | Use for assets/media imports. Do not use for tiny one-click actions. | Full keyboard equivalent via button trigger; file type hints via `accept`. | Min-height 128px; border 2px dashed; radius 16px; padding 24px |
| Date Picker (single, range) | Field trigger, calendar grid, presets | D/H/A/F/Ds/E | Use for scheduling and logs. Do not use for ambiguous locale text entry only. | Grid role, arrow key date nav, `aria-current` for today. | Trigger 44px; calendar cell 36px; popover width 320px |

## 2.3 Feedback

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Alert Banner (info, success, warning, error) | Icon, title, message, actions, dismiss | D/F/Ds | Use for high-priority contextual messaging. Do not stack more than 2 banners. | `role=alert` for critical, `status` for neutral. | Min-height 56px; padding 12px 16px; radius 12px |
| Inline Alert (form, section-level) | Icon, text, optional link | D/F | Use near source of issue. Do not display far from triggering element. | Linked with `aria-describedby` to control. | Min-height 36px; padding 8px 12px; radius 10px |
| Toast (auto-dismiss, persistent) | Status icon, message, optional action | D/H/F | Use for transient confirmations. Do not show blocking information. | `role=status`, pause timeout on hover/focus. | Width 320px max; padding 12px 14px; radius 12px |
| Modal (confirm, form, blocking) | Scrim, panel, header, body, actions | D/F/Ds/L/E | Use for high-focus tasks. Do not nest modals. | Focus trap, ESC close when safe, `aria-modal=true`. | Width 560px default; padding 24px; radius 20px |
| Drawer (right, bottom mobile) | Overlay, header, body, footer actions | D/F/Ds/L/E | Use for secondary workflow without full context loss. Do not use for destructive confirms. | Focus trap, restore focus on close. | Width 420px desktop; bottom sheet min-height 40vh mobile |
| Progress Bar (determinate, indeterminate) | Track, fill, label, percent text | D/L | Use for tasks >400ms. Do not fake determinate percentages. | `role=progressbar` with min/max/value attrs. | Height 8px; radius 999px; label gap 8px |
| Circular Progress (inline, full-screen) | Ring track, active arc, label | D/L | Use in constrained spaces and loading overlays. Do not replace progress bar for long files. | Include hidden text label of progress/status. | Size 20/32/48px; stroke 3px |
| Skeleton Screen (text, card, table) | Placeholder blocks, shimmer layer | D/L | Use to preserve layout during load. Do not show longer than 8s without fallback. | Respect reduced motion preferences. | Radius mirrors final components; shimmer 1.2s linear |
| Empty State (first-use, no-results, error-empty) | Illustration, headline, explanation, CTA | D/H/A/F | Use when no data is present. Do not leave blank whitespace. | CTA first in tab order, clear reason text. | Min-height 280px; content max-width 480px; gap 12px |

## 2.4 Data Display

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Card (default, interactive, featured) | Container, header, body, footer | D/H/A/F/Ds/L/E | Use for grouped information chunks. Do not over-nest cards within cards. | If clickable, entire card is one interactive element. | Padding 16-24px; radius 16px; border 1px |
| Data Table (dense, standard, selectable) | Header row, body rows, sort controls, pagination | D/H/A/F/Ds/L/E | Use for comparable structured data. Do not use on mobile without responsive strategy. | Proper table semantics, sortable headers announce state. | Row heights 44/52px; cell padding 12px 16px |
| List (simple, media, actionable) | Item container, leading/meta slots, trailing actions | D/H/A/F/Ds/L/E | Use for scan-friendly records. Do not hide primary action in tiny icon only. | List roles, action buttons keyboard reachable. | Item min-height 48px; divider inset 16px |
| Stat Tile (single metric, trend) | Label, value, delta, sparkline | D/H/A/F/L/E | Use for KPI snapshot. Do not place more than 6 per row. | Value must have text alternative and unit. | Min-height 120px; padding 16px; radius 14px |
| Line Chart (single, multi-series) | Plot area, axes, legend, tooltip | D/H/F/L/E | Use for trend over time. Do not use for unrelated categories. | Color not sole cue; include pattern/marker variants. | Min-height 240px; stroke 2px; point 6px |
| Bar Chart (grouped, stacked) | Axis, bars, legend, tooltip | D/H/F/L/E | Use for categorical comparisons. Do not exceed 12 categories without grouping. | Bars keyboard focusable with data summary. | Min-height 240px; bar radius 6px |
| Activity Heatmap (calendar, matrix) | Grid cells, labels, legend | D/H/F/L | Use for contribution/activity history. Do not use as sole performance indicator. | Provide numeric tooltip and tabular fallback. | Cell 14-18px; gap 3px |
| Code Block Preview (inline, panel) | Header, language tag, code text, copy action | D/H/F | Use for snippets/docs output. Do not render executable inputs here. | Monospace, copy button labeled, contrast >= 7:1. | Padding 12px 16px; radius 12px; line-height 1.5 |

## 2.5 Media

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Avatar (image, initials, status) | Image/initials, fallback color, status dot | D/H/F/Ds | Use for user identity and presence. Do not use tiny sizes for primary identity. | Alt text via user name; status dot also text-described. | Sizes 24/32/40/56px; radius 50% |
| Avatar Group (stacked, grid) | Individual avatars, overflow counter | D/H/F | Use for collaborator clusters. Do not exceed 6 visible in one row. | Overflow counter has full names in tooltip/list. | Overlap 8px; max visible 5 + counter |
| Image Container (cover, contain, zoomable) | Frame, image, caption slot | D/H/F/L/E | Use for visual references and attachments. Do not stretch aspect ratio. | Alt text mandatory unless decorative. | Radius 14px; aspect ratios 1:1, 4:3, 16:9 |
| Video Player (inline, modal theater) | Video surface, controls, timeline, captions | D/H/A/F/Ds/L/E | Use for tutorial content. Do not autoplay with sound. | Keyboard controls, captions required, transcript link. | Min-height 240px; control bar 44px; radius 14px |

## 2.6 Collaboration-Specific

| Component (Variants) | Anatomy | States | Usage (Do / Do Not) | Accessibility | Code-ready Specs |
|---|---|---|---|---|---|
| Live Cursor Tag (name, color coded) | Caret line, name pill, fade timer | D/L | Use in editor to show remote edits. Do not persist stale cursors >8s idle. | Provide collaborator list fallback outside canvas. | Pill 20px height; name padding 0 8px |
| Presence Chip (online, idle, offline) | Avatar, name, status dot, timestamp | D/H/F | Use in side panels and participant lists. Do not signal offline with color alone. | Include text labels for status; contrast dot border. | Height 36px; gap 8px; radius 999px |
| Comment Thread Bubble (inline, sidebar synced) | Marker, summary, thread panel | D/H/A/F/Ds | Use for asynchronous review notes. Do not block code editing focus. | Thread marker keyboard focusable with `aria-details`. | Marker 18px; panel width 320px |
| Activity Timeline (project, user) | Timestamp, icon, event text, metadata | D/H/F/L | Use for audit/history of edits and runs. Do not use for live chat. | Semantic list with time elements. | Row min-height 44px; left rail 2px |
| Diff Change Chip (add, modify, delete) | Badge shell, change type, count | D/H/F | Use in commit/patch context. Do not use as replacement for full diff. | Text + icon + color for state encoding. | Height 24px; padding 0 10px; radius 999px |

---

## 3) Patterns

## 3.1 Page Templates

### Landing Page

- Hero on 12-column layout with 7/5 split (copy/demo).
- Immediate CTA pair: `Start Coding` (primary) and `Join with PIN` (secondary).
- Social proof band with educator/team logos.
- Feature cards in 3-column desktop, 1-column mobile.

### Dashboard

- Persistent left sidebar, top quick-action bar, stat row, project table.
- Empty state appears in content frame with creation CTA.
- Filters and search stay sticky below header.

### Settings

- Two-column structure desktop (nav + content), single-column mobile.
- Group settings by Account, Editor, Collaboration, Billing.
- Save bars appear only when dirty state exists.

### Profile

- Header with avatar, role tags, and contribution stats.
- Tabs: Overview, Projects, Activity, Security.
- Activity stream uses timeline component.

### Checkout

- Minimal distraction template with progress stepper.
- Left: plan summary; right: payment form and trust indicators.
- Always show cancel and help options.

## 3.2 User Flows

### Onboarding

1. Welcome: choose role (Student, Educator, Team).
2. Quick setup: username, optional avatar, theme preference.
3. First success: create project or join by PIN.
4. Guided hint overlays (dismissible and replayable).

### Authentication

1. Sign in options: Google, passkey, email fallback.
2. Inline validation on blur + submit.
3. Error recovery links for locked or expired sessions.

### Search

1. Trigger via global search field or command palette.
2. Typeahead with sections: Projects, Files, Users, Commands.
3. Keyboard-first completion and Enter-to-open.

### Filtering

1. Persistent filter row for project lists.
2. Active filter chips with one-tap remove.
3. Empty-result state suggests nearest relax action.

### Empty States

1. First-use guidance with primary CTA.
2. No-results variant suggests filter reset.
3. Error-empty variant provides retry and diagnostics link.

## 3.3 Feedback Patterns

### Success Pattern

- Immediate inline signal near action origin.
- Optional toast confirmation when context changes.
- Persistent success badges for completed milestones only.

### Error Pattern

- Localize error near failing input or process area.
- Explain what happened + how to fix + retry action.
- Preserve user input whenever possible.

### Loading Pattern

- <400ms: no spinner; rely on optimistic transition.
- 400ms-2s: inline progress indicator.
- >2s: progress + status text.
- Unknown duration: skeleton layout + cancel action when safe.

### Empty Pattern

- Always include reason, next step, and optional secondary path.
- Pair short explanation with one clear primary action.

---

## 4) Tokens

Complete token source for handoff is provided in:

- `docs/pycollab-design-tokens.json`

Token categories include:

- Global primitives: color, typography, spacing, radius, shadow, motion
- Theme layers: light and dark
- Semantic aliases
- Component tokens (buttons, fields, navigation, data display, feedback, media)
- Grid and breakpoint tokens

---

## 5) Documentation Standards

## 5.1 Core Design Principles

### 1. Clarity First

- Prioritize readable code, explicit labels, and straightforward controls.
- Example: editor run state shown as text + icon, not color only.

### 2. Expressive Precision

- Bold visuals are welcome, but every accent must carry meaning.
- Example: `collabTeal` only indicates real-time collaboration signals.

### 3. Momentum by Default

- Reduce friction in repeated tasks and keep users in flow.
- Example: command palette + keyboard shortcuts for high-frequency actions.

## 5.2 Do's and Don'ts (10)

| # | Do | Don't | Visual Description |
|---|---|---|---|
| 1 | Use one primary CTA per area | Place multiple competing primary buttons | Single blue button with secondary outlined alternatives |
| 2 | Pair status color with icon/text | Communicate state by color alone | Error row shows red icon + "Run failed" text |
| 3 | Keep 16px+ body text on mobile | Use 12px paragraph text | Comfortable paragraph blocks versus tiny dense copy |
| 4 | Use skeletons that match final layout | Show generic spinner for all loads | Placeholder cards mirror eventual content proportions |
| 5 | Keep tap targets >=44px | Use icon-only 28px controls | Larger touch-safe icon buttons |
| 6 | Use sticky filter bar in data-heavy views | Hide filters behind multiple menus | Visible chips and reset affordance under header |
| 7 | Show inline form errors at field level | Show one generic error at top only | Input with red border and specific helper text |
| 8 | Use consistent radius and shadows | Mix random corner radii and elevations | Harmonized 12-16px corners across surfaces |
| 9 | Respect safe areas on mobile chrome | Let controls collide with home indicator | Tab bar lifted above bottom inset |
| 10 | Use chart legends with labels + markers | Use unlabeled color bands | Legend with named series and patterned markers |

## 5.3 Implementation Guide for Developers

1. Load token JSON as source of truth; generate CSS variables and TypeScript token typings from it.
2. Apply theme via `data-theme="light|dark"` at root and map semantic tokens to component states.
3. Build primitives first: button, text field, card, toast, modal, table.
4. Enforce state matrix in component tests: D/H/A/F/Ds/L/E.
5. Add accessibility tests:
   - Keyboard navigation for all interactive components
   - Contrast checks against token pairs
   - Screen-reader labels for icon-only actions
6. Implement responsive grid utilities from `grid.columns`, `grid.gutter`, and `grid.margin` tokens.
7. Add motion guards with `prefers-reduced-motion` and ensure non-animated fallback.
8. For code/editor surfaces, always switch to mono tokens and keep line-height >=1.5.
9. Use semantic tokens (`success`, `warning`, `error`, `info`) rather than hardcoded colors.
10. Version tokens and docs together; do not release one without the other.

---

## 6) Handoff Checklist

- Foundation tokens approved in light and dark mode
- Core components built with full state coverage
- Accessibility pass (contrast, keyboard, screen reader)
- Responsive checks at 375, 768, 1440
- Empty/loading/error states implemented for all major flows
