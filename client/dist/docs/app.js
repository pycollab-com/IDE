const primaryPalette = [
  {
    token: "color.brand.primary",
    role: "Primary actions, highlights",
    hex: "#899878",
    rgb: "rgb(137,152,120)",
    hsl: "hsl(88,13%,53%)",
    pair: "#121113",
    contrast: "6.12:1",
    wcag: "AA"
  },
  {
    token: "color.brand.secondary",
    role: "Secondary actions and accents",
    hex: "#7F8E6D",
    rgb: "rgb(127,142,109)",
    hsl: "hsl(87,13%,49%)",
    pair: "#121113",
    contrast: "5.37:1",
    wcag: "AA"
  },
  {
    token: "color.brand.accent",
    role: "Accent surfaces and emphasis",
    hex: "#9CAA88",
    rgb: "rgb(156,170,136)",
    hsl: "hsl(85,17%,60%)",
    pair: "#121113",
    contrast: "7.64:1",
    wcag: "AAA"
  },
  {
    token: "color.surface.dark",
    role: "Dark theme background",
    hex: "#121113",
    rgb: "rgb(18,17,19)",
    hsl: "hsl(270,6%,7%)",
    pair: "#F7F7F2",
    contrast: "17.52:1",
    wcag: "AAA"
  },
  {
    token: "color.surface.light",
    role: "Light theme background",
    hex: "#F7F7F2",
    rgb: "rgb(247,247,242)",
    hsl: "hsl(60,24%,96%)",
    pair: "#121113",
    contrast: "17.52:1",
    wcag: "AAA"
  },
  {
    token: "color.text.light",
    role: "Text on dark surfaces",
    hex: "#F7F7F2",
    rgb: "rgb(247,247,242)",
    hsl: "hsl(60,24%,96%)",
    pair: "#121113",
    contrast: "17.52:1",
    wcag: "AAA"
  }
];

const semanticColors = [
  {
    token: "color.semantic.success",
    light: "#9CAA88",
    dark: "#9CAA88",
    use: "Pass states, completed runs, connected status"
  },
  {
    token: "color.semantic.warning",
    light: "#7F8E6D",
    dark: "#7F8E6D",
    use: "Potential data loss, unsaved changes"
  },
  {
    token: "color.semantic.error",
    light: "#EF4444",
    dark: "#F87171",
    use: "Failed execution, auth problems, form errors"
  },
  {
    token: "color.semantic.info",
    light: "#899878",
    dark: "#9CAA88",
    use: "Neutral notices, system events"
  }
];

const darkEquivalents = [
  { light: "#899878", dark: "#899878", contrast: "6.12:1" },
  { light: "#7F8E6D", dark: "#7F8E6D", contrast: "5.37:1" },
  { light: "#9CAA88", dark: "#9CAA88", contrast: "7.64:1" },
  { light: "#F7F7F2", dark: "#121113", contrast: "17.52:1" },
  { light: "#121113", dark: "#F7F7F2", contrast: "17.52:1" }
];

const colorRules = [
  "Use --primary (#899878) for one primary CTA per screen region.",
  "Use --secondary (#7F8E6D) for supporting actions and secondary emphasis.",
  "Use --accent (#9CAA88) for subtle emphasis and highlighted surfaces.",
  "Use error only for failed outcomes or blocking validation.",
  "On colored surfaces, always use the defined accessible text pair.",
  "Keep decorative gradients behind content at 16% opacity or less.",
  "Increase border alpha in dark mode by about 15% to preserve edges.",
  "Charts should use six hues max, then differentiate with pattern/shape."
];

const typographyRows = [
  { role: "Display", desktop: "56 / 64 / -0.02em / 700", tablet: "48 / 56 / -0.02em / 700", mobile: "40 / 46 / -0.015em / 700" },
  { role: "Headline", desktop: "40 / 48 / -0.015em / 700", tablet: "34 / 42 / -0.01em / 700", mobile: "30 / 38 / -0.01em / 700" },
  { role: "Title", desktop: "30 / 38 / -0.01em / 600", tablet: "28 / 34 / -0.008em / 600", mobile: "24 / 30 / -0.006em / 600" },
  { role: "Body", desktop: "18 / 30 / 0em / 400", tablet: "17 / 28 / 0em / 400", mobile: "16 / 26 / 0em / 400" },
  { role: "Callout", desktop: "17 / 26 / 0em / 500", tablet: "16 / 24 / 0em / 500", mobile: "15 / 22 / 0em / 500" },
  { role: "Subheadline", desktop: "16 / 24 / 0.002em / 500", tablet: "15 / 22 / 0.002em / 500", mobile: "14 / 20 / 0.002em / 500" },
  { role: "Footnote", desktop: "14 / 20 / 0.004em / 500", tablet: "13 / 18 / 0.004em / 500", mobile: "12 / 17 / 0.004em / 500" },
  { role: "Caption", desktop: "12 / 16 / 0.006em / 500", tablet: "12 / 16 / 0.006em / 500", mobile: "11 / 14 / 0.006em / 500" }
];

const weights = [
  ["ultraLight", 100],
  ["thin", 200],
  ["light", 300],
  ["regular", 400],
  ["medium", 500],
  ["semibold", 600],
  ["bold", 700],
  ["heavy", 800],
  ["black", 900]
];

const legibilityRules = [
  "Minimum body: 16px mobile, 17px tablet, 18px desktop for long-form copy.",
  "Minimum interactive label: 14px semibold.",
  "Minimum caption for non-interactive metadata: 11px.",
  "Code editor minimum: 14px with 1.5 line-height.",
  "Maintain paragraph measure at 45-75 characters."
];

const gridRows = [
  ["Desktop", "1440px", "12", "24px", "60px"],
  ["Tablet", "768px", "12", "16px", "32px"],
  ["Mobile", "375px", "12", "12px", "16px"]
];

const breakpoints = ["xs: 0-479px", "sm: 480-767px", "md: 768-1023px", "lg: 1024-1439px", "xl: 1440px+"];

const safeAreaRules = [
  "Pad interactive chrome with env(safe-area-inset-top/right/bottom/left).",
  "Maintain at least 12px above home indicator for tappable controls.",
  "Include safe-area in tab bar and floating action final height calculations."
];

const spacingScale = [
  ["space.0_5", 4, "Hairline separations, icon-label micro gaps"],
  ["space.1", 8, "Tight internal spacing, compact chips"],
  ["space.1_5", 12, "Form control internals, short lists"],
  ["space.2", 16, "Standard control padding, card internals"],
  ["space.3", 24, "Section spacing inside panels"],
  ["space.4", 32, "Major block separation"],
  ["space.6", 48, "Page section vertical rhythm"],
  ["space.8", 64, "Hero spacing and major layout gutters"],
  ["space.12", 96, "Landing page banding"],
  ["space.16", 128, "Large campaign/marketing separations"]
];

const components = [
  {
    category: "Navigation",
    name: "Header",
    variants: "expanded, compact, editor",
    anatomy: "Logo, project switcher, global actions, account menu",
    states: "D/H/A/F/Ds/L",
    usage: "Use for global context and high-frequency actions. Do not overload with page-local controls.",
    accessibility: "Landmark header, roving tab for action cluster, skip-link target.",
    specs: "Height 72px desktop / 64px mobile; padding 0 24px; bottom border 1px."
  },
  {
    category: "Navigation",
    name: "Tab Bar",
    variants: "top, bottom mobile",
    anatomy: "Tab item, icon, label, active indicator",
    states: "D/H/A/F/Ds",
    usage: "Use for peer destinations (3-5 tabs). Do not exceed five tabs.",
    accessibility: "role=tablist, arrow-key nav, aria-selected.",
    specs: "Height 56px; item min-width 72px; indicator 2px; radius 12px."
  },
  {
    category: "Navigation",
    name: "Sidebar",
    variants: "full, collapsed, rail",
    anatomy: "Section title, nav groups, collapse control",
    states: "D/H/A/F/Ds",
    usage: "Use for dense workspace navigation. Do not use on single-task flows.",
    accessibility: "nav landmark and collapse control with aria-expanded.",
    specs: "Width 280px full / 88px rail; padding 20px; gap 8px."
  },
  {
    category: "Navigation",
    name: "Breadcrumbs",
    variants: "text, text+icon",
    anatomy: "Root crumb, separators, current page",
    states: "D/H/A/F/Ds",
    usage: "Use for deep IA paths (3+ levels). Do not repeat page title.",
    accessibility: "nav aria-label='Breadcrumb', current crumb aria-current='page'.",
    specs: "Height 32px; gap 8px; separator opacity 40%."
  },
  {
    category: "Navigation",
    name: "Command Palette",
    variants: "global, scoped",
    anatomy: "Search input, grouped commands, shortcut hints",
    states: "D/F/L/E",
    usage: "Use for power workflows. Do not hide critical actions exclusively here.",
    accessibility: "Focus trap, aria-activedescendant, ESC close.",
    specs: "Width 680px max; item height 44px; radius 16px."
  },
  {
    category: "Navigation",
    name: "Project Switcher",
    variants: "dropdown, quick switch",
    anatomy: "Current project chip, list, create action",
    states: "D/H/A/F/L/E",
    usage: "Use when users belong to many projects. Do not bury project creation in overflow.",
    accessibility: "Combobox pattern, typeahead, aria-controls.",
    specs: "Trigger height 40px; menu min-width 280px; row padding 10px 12px."
  },
  {
    category: "Input",
    name: "Button",
    variants: "primary, secondary, tertiary, destructive, ghost, link",
    anatomy: "Container, label, optional icons, spinner",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use one primary per region. Use destructive only for irreversible actions.",
    accessibility: "Native button, visible focus ring, aria-busy for loading.",
    specs: "Height 44px default / 36px compact; padding 0 16px; radius 12px."
  },
  {
    category: "Input",
    name: "Icon Button",
    variants: "standard, tonal, danger",
    anatomy: "Icon-only hit area with optional badge",
    states: "D/H/A/F/Ds/L",
    usage: "Use for common reversible actions. Do not use ambiguous icon-only actions.",
    accessibility: "aria-label required; tap target at least 44x44.",
    specs: "Size 44px; radius 12px; badge 16px."
  },
  {
    category: "Input",
    name: "Split Button",
    variants: "action + caret",
    anatomy: "Primary action segment and menu segment",
    states: "D/H/A/F/Ds/L",
    usage: "Use for one default action plus alternatives.",
    accessibility: "Arrow keys swap segment focus; menu semantics for caret.",
    specs: "Height 44px; left padding 16px; menu segment 40px."
  },
  {
    category: "Input",
    name: "Text Field",
    variants: "single-line, with icon, helper text",
    anatomy: "Label, input, helper/error text, prefix/suffix",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for short text and IDs. Do not use for paragraphs.",
    accessibility: "Visible label, aria-invalid for errors, describedby helper text.",
    specs: "Height 44px; padding 12px; radius 12px; border 1px."
  },
  {
    category: "Input",
    name: "Text Area",
    variants: "resizable, autosize",
    anatomy: "Label, textarea, count/helper, error line",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for messages and descriptions. Do not constrain below three rows.",
    accessibility: "Announce character count near limits.",
    specs: "Min-height 120px; padding 12px; radius 12px."
  },
  {
    category: "Input",
    name: "Search Field",
    variants: "inline, global",
    anatomy: "Search icon, input, clear button, suggestion list",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for retrieval. Do not reuse as command trigger without explicit affordance.",
    accessibility: "role=search; ESC clears suggestions; arrows navigate listbox.",
    specs: "Height 40px; radius 999px or 12px."
  },
  {
    category: "Input",
    name: "Dropdown / Select",
    variants: "single-select",
    anatomy: "Label, trigger, selected value, options menu",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for fixed option sets. Do not use for <=3 options.",
    accessibility: "Combobox/listbox semantics with typeahead.",
    specs: "Trigger 44px; menu item 40px; radius 12px."
  },
  {
    category: "Input",
    name: "Multi-select",
    variants: "chips, checklist",
    anatomy: "Label, trigger, token chips, options menu",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for tags/collaborators. Do not use for single mandatory choice.",
    accessibility: "Backspace removes chips; add/remove announcements.",
    specs: "Trigger min-height 44px; chip 28px; gap 6px."
  },
  {
    category: "Input",
    name: "Toggle Switch",
    variants: "default, with labels",
    anatomy: "Track, thumb, optional text labels",
    states: "D/H/A/F/Ds",
    usage: "Use for immediate binary settings.",
    accessibility: "role=switch, aria-checked, Space toggles.",
    specs: "Track 44x28; thumb 24px; travel 16px."
  },
  {
    category: "Input",
    name: "Checkbox",
    variants: "single, indeterminate",
    anatomy: "Control, checkmark, label",
    states: "D/H/A/F/Ds/E",
    usage: "Use for multi-select lists.",
    accessibility: "Native checkbox semantics and programmatic indeterminate state.",
    specs: "Box 20px; row min-height 32px; label gap 10px."
  },
  {
    category: "Input",
    name: "Radio Group",
    variants: "stacked, inline",
    anatomy: "Group label, radio controls, options",
    states: "D/H/A/F/Ds/E",
    usage: "Use for low-count exclusive options.",
    accessibility: "role=radiogroup and arrow key selection.",
    specs: "Control 20px; row min-height 32px; gap 8px."
  },
  {
    category: "Input",
    name: "Slider",
    variants: "single, range",
    anatomy: "Track, fill, thumb(s), value label",
    states: "D/H/A/F/Ds",
    usage: "Use for approximate ranges, not precise entry alone.",
    accessibility: "Arrow/page keys supported and textual value labels.",
    specs: "Track 4px; thumb 20px; min width 160px."
  },
  {
    category: "Input",
    name: "Stepper",
    variants: "numeric, compact",
    anatomy: "Minus, value field, plus",
    states: "D/H/A/F/Ds/E",
    usage: "Use for bounded integer quantities.",
    accessibility: "Buttons labeled increment/decrement; value announced.",
    specs: "Height 36px; button width 36px; radius 10px."
  },
  {
    category: "Input",
    name: "File Upload Dropzone",
    variants: "single, multi-file",
    anatomy: "Drop area, icon, helper text, progress row",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for media imports. Do not use for tiny single actions.",
    accessibility: "Keyboard equivalent button and file type hints.",
    specs: "Min-height 128px; border 2px dashed; radius 16px; padding 24px."
  },
  {
    category: "Input",
    name: "Date Picker",
    variants: "single, range",
    anatomy: "Trigger field, calendar grid, presets",
    states: "D/H/A/F/Ds/E",
    usage: "Use for scheduling and logs.",
    accessibility: "Calendar grid semantics, arrow nav, aria-current for today.",
    specs: "Trigger 44px; cell 36px; popover width 320px."
  },
  {
    category: "Feedback",
    name: "Alert Banner",
    variants: "info, success, warning, error",
    anatomy: "Icon, title, message, actions, dismiss",
    states: "D/F/Ds",
    usage: "Use for high-priority contextual messages.",
    accessibility: "role=alert for critical, role=status for neutral.",
    specs: "Min-height 56px; padding 12px 16px; radius 12px."
  },
  {
    category: "Feedback",
    name: "Inline Alert",
    variants: "form, section-level",
    anatomy: "Icon, text, optional link",
    states: "D/F",
    usage: "Use close to error source.",
    accessibility: "Connect with aria-describedby to affected controls.",
    specs: "Min-height 36px; padding 8px 12px; radius 10px."
  },
  {
    category: "Feedback",
    name: "Toast",
    variants: "auto-dismiss, persistent",
    anatomy: "Status icon, message, action",
    states: "D/H/F",
    usage: "Use for transient confirmations.",
    accessibility: "role=status and pause timeout on hover/focus.",
    specs: "Max width 320px; padding 12px 14px; radius 12px."
  },
  {
    category: "Feedback",
    name: "Modal",
    variants: "confirm, form, blocking",
    anatomy: "Scrim, panel, header, body, actions",
    states: "D/F/Ds/L/E",
    usage: "Use for high-focus tasks. Do not nest modals.",
    accessibility: "Focus trap, aria-modal=true, ESC close when safe.",
    specs: "Width 560px default; padding 24px; radius 20px."
  },
  {
    category: "Feedback",
    name: "Drawer",
    variants: "right desktop, bottom mobile",
    anatomy: "Overlay, header, body, footer actions",
    states: "D/F/Ds/L/E",
    usage: "Use for secondary workflows without losing context.",
    accessibility: "Focus trap and focus restore on close.",
    specs: "Desktop width 420px; mobile min-height 40vh."
  },
  {
    category: "Feedback",
    name: "Progress Bar",
    variants: "determinate, indeterminate",
    anatomy: "Track, fill, label, percent text",
    states: "D/L",
    usage: "Use for tasks over 400ms.",
    accessibility: "role=progressbar with min/max/value.",
    specs: "Height 8px; radius 999px; label gap 8px."
  },
  {
    category: "Feedback",
    name: "Circular Progress",
    variants: "inline, fullscreen",
    anatomy: "Ring track, active arc, label",
    states: "D/L",
    usage: "Use in constrained spaces and loading overlays.",
    accessibility: "Hidden textual progress label required.",
    specs: "Sizes 20/32/48px; stroke 3px."
  },
  {
    category: "Feedback",
    name: "Skeleton Screen",
    variants: "text, card, table",
    anatomy: "Placeholder blocks and shimmer",
    states: "D/L",
    usage: "Use to preserve layout during load.",
    accessibility: "Respect prefers-reduced-motion.",
    specs: "Shimmer 1.2s linear; radius mirrors destination component."
  },
  {
    category: "Feedback",
    name: "Empty State",
    variants: "first-use, no-results, error-empty",
    anatomy: "Illustration, headline, explanation, CTA",
    states: "D/H/A/F",
    usage: "Use when no data is present.",
    accessibility: "CTA first in tab order with explicit reason text.",
    specs: "Min-height 280px; max-width 480px; gap 12px."
  },
  {
    category: "Data Display",
    name: "Card",
    variants: "default, interactive, featured",
    anatomy: "Container, header, body, footer",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for grouped information chunks.",
    accessibility: "Clickable cards should be a single interactive target.",
    specs: "Padding 16-24px; radius 16px; border 1px."
  },
  {
    category: "Data Display",
    name: "Data Table",
    variants: "dense, standard, selectable",
    anatomy: "Header row, body rows, sort controls, pagination",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for comparable structured data.",
    accessibility: "Table semantics and announced sort state.",
    specs: "Rows 44/52px; cell padding 12px 16px."
  },
  {
    category: "Data Display",
    name: "List",
    variants: "simple, media, actionable",
    anatomy: "Item container, leading/meta slots, trailing actions",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for scan-friendly records.",
    accessibility: "Actions keyboard reachable with list semantics.",
    specs: "Item min-height 48px; divider inset 16px."
  },
  {
    category: "Data Display",
    name: "Stat Tile",
    variants: "single metric, trend",
    anatomy: "Label, value, delta, sparkline",
    states: "D/H/A/F/L/E",
    usage: "Use for KPI snapshots; keep six or fewer per row.",
    accessibility: "Metric and units must have text alternatives.",
    specs: "Min-height 120px; padding 16px; radius 14px."
  },
  {
    category: "Data Display",
    name: "Line Chart",
    variants: "single, multi-series",
    anatomy: "Plot area, axes, legend, tooltip",
    states: "D/H/F/L/E",
    usage: "Use for trends over time.",
    accessibility: "Color cannot be sole cue; include markers/patterns.",
    specs: "Min-height 240px; stroke 2px; point 6px."
  },
  {
    category: "Data Display",
    name: "Bar Chart",
    variants: "grouped, stacked",
    anatomy: "Axis, bars, legend, tooltip",
    states: "D/H/F/L/E",
    usage: "Use for categorical comparison.",
    accessibility: "Focusable bars with data summary.",
    specs: "Min-height 240px; bar radius 6px."
  },
  {
    category: "Data Display",
    name: "Activity Heatmap",
    variants: "calendar, matrix",
    anatomy: "Grid cells, labels, legend",
    states: "D/H/F/L",
    usage: "Use for contribution/activity history.",
    accessibility: "Numeric tooltip and tabular fallback required.",
    specs: "Cell 14-18px; gap 3px."
  },
  {
    category: "Data Display",
    name: "Code Block Preview",
    variants: "inline, panel",
    anatomy: "Header, language tag, code text, copy action",
    states: "D/H/F",
    usage: "Use for snippets and docs output.",
    accessibility: "Monospace with contrast >= 7:1 and labeled copy action.",
    specs: "Padding 12px 16px; radius 12px; line-height 1.5."
  },
  {
    category: "Media",
    name: "Avatar",
    variants: "image, initials, status",
    anatomy: "Image/initials, fallback color, status dot",
    states: "D/H/F/Ds",
    usage: "Use for identity and presence.",
    accessibility: "Name-based alt text and textual status equivalent.",
    specs: "Sizes 24/32/40/56px; radius 50%."
  },
  {
    category: "Media",
    name: "Avatar Group",
    variants: "stacked, grid",
    anatomy: "Visible avatars and overflow counter",
    states: "D/H/F",
    usage: "Use for collaborator clusters.",
    accessibility: "Overflow counter provides full names in tooltip/list.",
    specs: "Overlap 8px; max visible 5 plus counter."
  },
  {
    category: "Media",
    name: "Image Container",
    variants: "cover, contain, zoomable",
    anatomy: "Frame, image, caption slot",
    states: "D/H/F/L/E",
    usage: "Use for references and attachments.",
    accessibility: "Alt text required unless decorative.",
    specs: "Radius 14px; 1:1, 4:3, 16:9 ratios."
  },
  {
    category: "Media",
    name: "Video Player",
    variants: "inline, modal theater",
    anatomy: "Video surface, controls, timeline, captions",
    states: "D/H/A/F/Ds/L/E",
    usage: "Use for tutorials. Do not autoplay with sound.",
    accessibility: "Keyboard controls, captions, transcript link.",
    specs: "Min-height 240px; controls 44px; radius 14px."
  },
  {
    category: "Collaboration",
    name: "Live Cursor Tag",
    variants: "named, color-coded",
    anatomy: "Caret line, name pill, fade timer",
    states: "D/L",
    usage: "Use in editor for remote edits; expire stale cursors after 8s.",
    accessibility: "Provide collaborator list fallback outside the canvas.",
    specs: "Pill height 20px; name padding 0 8px."
  },
  {
    category: "Collaboration",
    name: "Presence Chip",
    variants: "online, idle, offline",
    anatomy: "Avatar, name, status dot, timestamp",
    states: "D/H/F",
    usage: "Use in participant lists and side panels.",
    accessibility: "Status shown with text plus color.",
    specs: "Height 36px; gap 8px; radius 999px."
  },
  {
    category: "Collaboration",
    name: "Comment Thread Bubble",
    variants: "inline marker, sidebar synced",
    anatomy: "Marker, summary, thread panel",
    states: "D/H/A/F/Ds",
    usage: "Use for asynchronous review notes.",
    accessibility: "Marker focusable with aria-details.",
    specs: "Marker 18px; panel width 320px."
  },
  {
    category: "Collaboration",
    name: "Activity Timeline",
    variants: "project, user",
    anatomy: "Timestamp, icon, event text, metadata",
    states: "D/H/F/L",
    usage: "Use for audit/history of edits and runs.",
    accessibility: "Semantic list with time elements.",
    specs: "Row min-height 44px; left rail 2px."
  },
  {
    category: "Collaboration",
    name: "Diff Change Chip",
    variants: "add, modify, delete",
    anatomy: "Badge shell, change type, count",
    states: "D/H/F",
    usage: "Use in commit and patch context; not a full diff replacement.",
    accessibility: "Text + icon + color encoding.",
    specs: "Height 24px; padding 0 10px; radius 999px."
  }
];

const patterns = [
  {
    title: "Landing Page",
    details: [
      "12-column hero with 7/5 split.",
      "CTA pair: Start Coding + Join with PIN.",
      "Social proof band and 3-column feature grid."
    ]
  },
  {
    title: "Dashboard",
    details: [
      "Persistent sidebar, quick actions, KPI strip, project table.",
      "Sticky filters and integrated empty state with creation CTA."
    ]
  },
  {
    title: "Settings",
    details: [
      "Two-column desktop and one-column mobile layout.",
      "Account, Editor, Collaboration, Billing groups.",
      "Dirty-state save bars only when needed."
    ]
  },
  {
    title: "Profile",
    details: [
      "Avatar, role tags, contribution metrics.",
      "Overview, Projects, Activity, Security tabs."
    ]
  },
  {
    title: "Checkout",
    details: [
      "Minimal-distraction stepper flow.",
      "Plan summary + payment form + trust affordances.",
      "Always-visible cancel and help actions."
    ]
  },
  {
    title: "Onboarding Flow",
    details: [
      "Role selection, quick setup, first success.",
      "Replayable guided overlays with dismiss controls."
    ]
  },
  {
    title: "Authentication Flow",
    details: [
      "Google, passkey, email fallback.",
      "Inline validation and clear recovery links."
    ]
  },
  {
    title: "Search & Filtering",
    details: [
      "Global search and command palette entry points.",
      "Typeahead grouped results, keyboard-first behavior.",
      "Filter chips with one-tap removal and empty-result assist."
    ]
  },
  {
    title: "Feedback Patterns",
    details: [
      "Success: local confirmation + optional toast.",
      "Error: explain cause, resolution, retry path.",
      "Loading: progressive behavior by duration.",
      "Empty: reason + next best action."
    ]
  }
];

const principles = [
  {
    title: "Clarity First",
    body: "Prioritize explicit labels, readable type, and straightforward controls. Example: run state is always icon + text, never color alone."
  },
  {
    title: "Expressive Precision",
    body: "Bold visuals are intentional and semantic. Example: primary, secondary, and accent are reserved for their documented UI roles."
  },
  {
    title: "Momentum by Default",
    body: "Frequent workflows stay fast and interrupt-light. Example: command palette and keyboard shortcuts for high-frequency project actions."
  }
];

const dosDonts = [
  [1, "Use one primary CTA per area", "Place multiple competing primary buttons", "Single blue button with outlined alternatives"],
  [2, "Pair status color with icon/text", "Communicate state by color alone", "Error row with icon + \"Run failed\" label"],
  [3, "Keep body text 16px+ on mobile", "Use 12px paragraph copy", "Comfortable line lengths and readable contrast"],
  [4, "Use skeletons matching final layout", "Use generic spinner for every load", "Placeholder cards reflect final content geometry"],
  [5, "Keep targets at least 44px", "Use icon-only 28px controls", "Touch-safe icon buttons with labels"],
  [6, "Use sticky filter bars in data views", "Hide filters in nested menus", "Visible chips and reset affordance"],
  [7, "Show inline field-level errors", "Show one generic top-level error", "Input border + targeted helper message"],
  [8, "Use consistent radius and elevation", "Mix random corner sizes", "Unified 12-16px corners and stable shadows"],
  [9, "Respect safe areas on mobile", "Allow controls to collide with indicator", "Tab bar lifted above bottom inset"],
  [10, "Label chart legends with markers", "Use unlabeled color-only bands", "Named series with pattern markers"],
];

const implementationSteps = [
  "Load token JSON as source of truth and generate CSS variables plus TypeScript typings.",
  "Apply theme with data-theme='light|dark' and map semantic aliases to component states.",
  "Build primitives first: button, text field, card, toast, modal, table.",
  "Test state matrix for every component: D/H/A/F/Ds/L/E.",
  "Add accessibility checks for keyboard navigation, contrast, and icon-only control labels.",
  "Implement responsive utilities from grid tokens (columns, gutters, margins).",
  "Respect prefers-reduced-motion and provide non-animated fallbacks.",
  "Use mono typography tokens for editor and terminal surfaces.",
  "Use semantic tokens instead of hardcoded status colors.",
  "Version docs and token JSON together in each release."
];

const handoffChecklist = [
  "Foundation tokens approved in light and dark modes",
  "Core components built with full state coverage",
  "Accessibility pass completed (contrast, keyboard, screen reader)",
  "Responsive QA at 375, 768, 1440",
  "Empty/loading/error states implemented across major flows"
];

function el(id) {
  return document.getElementById(id);
}

function renderFoundations() {
  const paletteRoot = el("primary-palette");
  primaryPalette.forEach((swatch) => {
    const card = document.createElement("article");
    card.className = "swatch";
    card.setAttribute("role", "listitem");
    card.innerHTML = `
      <div class="swatch-color" style="background:${swatch.hex};"></div>
      <div class="swatch-info">
        <p class="swatch-title">${swatch.token}</p>
        <p>${swatch.role}</p>
        <p><code>${swatch.hex}</code> | ${swatch.rgb}</p>
        <p>${swatch.hsl}</p>
        <p>Text pair <code>${swatch.pair}</code> | ${swatch.contrast} ${swatch.wcag}</p>
      </div>
    `;
    paletteRoot.append(card);
  });

  el("semantic-table").innerHTML = semanticColors
    .map(
      (row) => `
      <tr>
        <td><code>${row.token}</code></td>
        <td><code>${row.light}</code></td>
        <td><code>${row.dark}</code></td>
        <td>${row.use}</td>
      </tr>`
    )
    .join("");

  el("dark-equivalents-table").innerHTML = darkEquivalents
    .map(
      (row) => `
      <tr>
        <td><code>${row.light}</code></td>
        <td><code>${row.dark}</code></td>
        <td>${row.contrast}</td>
      </tr>`
    )
    .join("");

  el("color-rules").innerHTML = colorRules.map((rule) => `<li>${rule}</li>`).join("");
  el("typography-table").innerHTML = typographyRows
    .map(
      (row) => `
      <tr>
        <td>${row.role}</td>
        <td><code>${row.desktop}</code></td>
        <td><code>${row.tablet}</code></td>
        <td><code>${row.mobile}</code></td>
      </tr>`
    )
    .join("");

  el("weight-list").innerHTML = weights
    .map(([name, value]) => `<li><span>font.weight.${name}</span><strong>${value}</strong></li>`)
    .join("");
  el("legibility-rules").innerHTML = legibilityRules.map((rule) => `<li>${rule}</li>`).join("");

  el("grid-table").innerHTML = gridRows
    .map(
      (row) => `
      <tr>
        <td>${row[0]}</td>
        <td>${row[1]}</td>
        <td>${row[2]}</td>
        <td>${row[3]}</td>
        <td>${row[4]}</td>
      </tr>`
    )
    .join("");

  el("breakpoint-list").innerHTML = breakpoints.map((item) => `<li><code>${item}</code></li>`).join("");
  el("safe-area-rules").innerHTML = safeAreaRules.map((rule) => `<li>${rule}</li>`).join("");

  el("spacing-scale").innerHTML = spacingScale
    .map(
      ([token, value, usage]) => `
      <div class="spacing-row">
        <strong><code>${token}</code></strong>
        <div class="spacing-bar" style="width:${Math.max(value * 2, 24)}px"></div>
        <span>${value}px - ${usage}</span>
      </div>`
    )
    .join("");
}

function renderComponents(filter = "all") {
  const categorySet = Array.from(new Set(components.map((item) => item.category)));
  const select = el("component-filter");
  if (select.options.length === 1) {
    categorySet.forEach((category) => {
      const option = document.createElement("option");
      option.value = category;
      option.textContent = category;
      select.append(option);
    });
  }

  const filtered = filter === "all" ? components : components.filter((item) => item.category === filter);
  el("component-count").textContent = `${filtered.length} components shown`;

  el("component-list").innerHTML = filtered
    .map(
      (component) => `
      <details class="component-card">
        <summary>
          <div>
            <h4>${component.name}</h4>
            <p>${component.variants}</p>
          </div>
          <span class="category-chip">${component.category}</span>
        </summary>
        <div class="component-meta">
          <div class="meta-row"><span class="meta-key">Anatomy</span><span>${component.anatomy}</span></div>
          <div class="meta-row"><span class="meta-key">States</span><span><code>${component.states}</code></span></div>
          <div class="meta-row"><span class="meta-key">Usage</span><span>${component.usage}</span></div>
          <div class="meta-row"><span class="meta-key">Accessibility</span><span>${component.accessibility}</span></div>
          <div class="meta-row"><span class="meta-key">Code Specs</span><span>${component.specs}</span></div>
        </div>
      </details>`
    )
    .join("");
}

function renderPatterns() {
  el("pattern-grid").innerHTML = patterns
    .map(
      (pattern) => `
      <article class="pattern-card">
        <h3>${pattern.title}</h3>
        <ul>${pattern.details.map((detail) => `<li>${detail}</li>`).join("")}</ul>
      </article>`
    )
    .join("");
}

function renderDocumentation() {
  el("principle-grid").innerHTML = principles
    .map(
      (principle) => `
      <article class="principle-card">
        <h3>${principle.title}</h3>
        <p>${principle.body}</p>
      </article>`
    )
    .join("");

  el("dos-donts-table").innerHTML = dosDonts
    .map(
      (row) => `
      <tr>
        <td>${row[0]}</td>
        <td>${row[1]}</td>
        <td>${row[2]}</td>
        <td>${row[3]}</td>
      </tr>`
    )
    .join("");

  el("implementation-steps").innerHTML = implementationSteps.map((step) => `<li>${step}</li>`).join("");
  el("handoff-checklist").innerHTML = handoffChecklist.map((item) => `<li>${item}</li>`).join("");
}

async function loadTokens() {
  try {
    const response = await fetch("./pycollab-design-tokens.json", { cache: "no-store" });
    if (!response.ok) throw new Error(`Failed to fetch tokens (${response.status})`);

    const data = await response.json();
    const formatted = JSON.stringify(data, null, 2);
    const preview = el("token-preview");
    preview.textContent = formatted;

    const copyButton = el("copy-tokens");
    const status = el("copy-status");
    copyButton.addEventListener("click", async () => {
      try {
        await navigator.clipboard.writeText(formatted);
        status.textContent = "Copied to clipboard.";
        setTimeout(() => {
          status.textContent = "";
        }, 1800);
      } catch {
        status.textContent = "Clipboard copy not available.";
      }
    });
  } catch (err) {
    el("token-preview").textContent = String(err);
  }
}

function setupThemeToggle() {
  const root = document.documentElement;
  const current = localStorage.getItem("pycollab-docs-theme");
  if (current === "light" || current === "dark") {
    root.setAttribute("data-theme", current);
  }

  const button = el("theme-toggle");
  button.addEventListener("click", () => {
    const next = root.getAttribute("data-theme") === "dark" ? "light" : "dark";
    root.setAttribute("data-theme", next);
    localStorage.setItem("pycollab-docs-theme", next);
  });
}

function slugify(text) {
  return text
    .toLowerCase()
    .trim()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)+/g, "");
}

function setupToc() {
  const tocRoot = el("toc-list");
  if (!tocRoot) return;

  const headings = Array.from(document.querySelectorAll(".docs-main h2, .docs-main h3"));
  const items = headings
    .map((heading) => {
      if (!heading.id) {
        heading.id = slugify(heading.textContent || "");
      }
      return {
        id: heading.id,
        label: heading.textContent || "",
        depth: heading.tagName.toLowerCase() === "h3" ? 3 : 2
      };
    })
    .filter((item) => item.id && item.label);

  tocRoot.innerHTML = items
    .map((item) => `<a href="#${item.id}" class="depth-${item.depth}" data-id="${item.id}">${item.label}</a>`)
    .join("");

  const tocLinks = Array.from(tocRoot.querySelectorAll("a"));
  const byId = new Map(tocLinks.map((link) => [link.dataset.id, link]));
  const sectionObserver = new IntersectionObserver(
    (entries) => {
      const visible = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => a.boundingClientRect.top - b.boundingClientRect.top)[0];
      if (!visible) return;
      const id = visible.target.id;
      tocLinks.forEach((link) => link.classList.toggle("active", link.dataset.id === id));
    },
    { rootMargin: "0px 0px -65% 0px", threshold: 0.1 }
  );

  headings.forEach((heading) => sectionObserver.observe(heading));

  const updateHashHighlight = () => {
    const hashId = window.location.hash.replace("#", "");
    if (!hashId) return;
    tocLinks.forEach((link) => link.classList.toggle("active", link.dataset.id === hashId));
    const matching = byId.get(hashId);
    if (matching) matching.scrollIntoView({ block: "nearest" });
  };

  window.addEventListener("hashchange", updateHashHighlight);
  updateHashHighlight();
}

function boot() {
  renderFoundations();
  renderComponents("all");
  renderPatterns();
  renderDocumentation();
  setupThemeToggle();
  setupToc();
  loadTokens();

  el("component-filter").addEventListener("change", (event) => {
    renderComponents(event.target.value);
  });
}

boot();
