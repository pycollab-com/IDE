const navGroups = [
  {
    title: "Overview",
    links: [
      { label: "Overview", href: "#overview" },
      { label: "Platform capabilities", href: "#overview-capabilities" },
      { label: "When to use PyCollab", href: "#overview-when-to-use" }
    ]
  },
  {
    title: "Get started",
    links: [
      { label: "Quick start", href: "#quickstart" },
      { label: "Open the app", href: "#quickstart-open-app" },
      { label: "Start a project", href: "#quickstart-start-project" },
      { label: "Share and join", href: "#quickstart-share-and-join" },
      { label: "Run Python", href: "#quickstart-run-code" }
    ]
  },
  {
    title: "Core concepts",
    links: [
      { label: "Architecture", href: "#architecture" },
      { label: "System layout", href: "#architecture-stack" },
      { label: "Execution flow", href: "#architecture-data-flow" },
      { label: "Product guarantees", href: "#architecture-guarantees" },
      { label: "Collaboration", href: "#collaboration" },
      { label: "Sharing model", href: "#collaboration-sharing" },
      { label: "Editing model", href: "#collaboration-editing" },
      { label: "Access model", href: "#collaboration-access" }
    ]
  },
  {
    title: "Runtime and deploy",
    links: [
      { label: "Browser runtime", href: "#runtime" },
      { label: "Runtime contract", href: "#runtime-pyodide" },
      { label: "Cross-origin isolation", href: "#runtime-isolation" },
      { label: "Package policy", href: "#runtime-packages" },
      { label: "Configuration", href: "#configuration" },
      { label: "Local development", href: "#configuration-local" },
      { label: "Google OAuth", href: "#configuration-oauth" },
      { label: "Environment reference", href: "#configuration-reference" }
    ]
  },
  {
    title: "Design and ops",
    links: [
      { label: "Design system", href: "#design" },
      { label: "Product palette", href: "#design-palette" },
      { label: "Implementation baseline", href: "#design-foundations" },
      { label: "Token source of truth", href: "#design-tokens" },
      { label: "Troubleshooting", href: "#troubleshooting" },
      { label: "Runtime failures", href: "#troubleshooting-runtime" },
      { label: "Authentication failures", href: "#troubleshooting-auth" },
      { label: "Deployment storage", href: "#troubleshooting-deploy" }
    ]
  }
];

const envVars = [
  {
    name: "GOOGLE_OAUTH_CLIENT_ID",
    purpose: "Backend token verification for Google sign-in and verified email flows.",
    note: "Must match VITE_GOOGLE_CLIENT_ID."
  },
  {
    name: "VITE_GOOGLE_CLIENT_ID",
    purpose: "Frontend Google button and provider configuration.",
    note: "Must match GOOGLE_OAUTH_CLIENT_ID."
  },
  {
    name: "PYCOLLAB_PYODIDE_VERSION",
    purpose: "Pins the Pyodide version served to the browser runtime.",
    note: "Defaults to 0.29.3."
  },
  {
    name: "PYCOLLAB_PYODIDE_BASE_URL",
    purpose: "Overrides the base URL for the Pyodide distribution.",
    note: "Optional."
  },
  {
    name: "PYCOLLAB_PYODIDE_ALLOWED_PACKAGES",
    purpose: "Comma-separated allowlist for runtime imports and micropip installs.",
    note: "Optional."
  },
  {
    name: "PYCOLLAB_PYODIDE_MAX_RUN_SECONDS",
    purpose: "Caps Python execution time before interruption.",
    note: "0 disables the timeout."
  },
  {
    name: "PYCOLLAB_ENABLE_CROSS_ORIGIN_ISOLATION",
    purpose: "Enables the browser isolation policy required for full runtime behavior.",
    note: "Defaults to true."
  },
  {
    name: "PYCOLLAB_UPLOADS_DIR",
    purpose: "Absolute path for persisted uploads in production.",
    note: "Defaults to server/uploads."
  }
];

const palette = [
  {
    label: "Primary",
    token: "--primary",
    hex: "#899878",
    use: "Primary actions and highlights",
    textColor: "#121113"
  },
  {
    label: "Secondary",
    token: "--secondary",
    hex: "#7f8e6d",
    use: "Supporting actions and accents",
    textColor: "#121113"
  },
  {
    label: "Accent",
    token: "--accent",
    hex: "#9caa88",
    use: "Accent surfaces and emphasis",
    textColor: "#121113"
  },
  {
    label: "Dark background",
    token: "--bg-color",
    hex: "#121113",
    use: "Default dark shell background",
    textColor: "#f7f7f2"
  },
  {
    label: "Light background",
    token: "--bg-color",
    hex: "#f7f7f2",
    use: "Default light shell background",
    textColor: "#121113"
  },
  {
    label: "Text",
    token: "--text-color",
    hex: "#121113",
    use: "Primary text on light surfaces",
    textColor: "#f7f7f2"
  }
];

const runtimeIssues = [
  {
    title: "Runtime refuses to start",
    body: "Check window.crossOriginIsolated in the browser. If it is false, verify that COOP and COEP headers are both set correctly."
  },
  {
    title: "Package install fails",
    body: "Review PYCOLLAB_PYODIDE_ALLOWED_PACKAGES. Imports and micropip installs are both constrained by the allowlist when configured."
  },
  {
    title: "Execution never stops",
    body: "Set PYCOLLAB_PYODIDE_MAX_RUN_SECONDS to a non-zero value if you need bounded execution for user code."
  }
];

const sidebarNav = document.querySelector("#sidebar-nav");
const tocNav = document.querySelector("#toc-nav");
const envTable = document.querySelector("#env-table");
const paletteRoot = document.querySelector("#brand-palette");
const runtimeIssuesRoot = document.querySelector("#runtime-issues");
const tokenPreview = document.querySelector("#token-preview");
const copyTokensButton = document.querySelector("#copy-tokens");
const copyStatus = document.querySelector("#copy-status");
const themeToggle = document.querySelector("#theme-toggle");
const searchInput = document.querySelector("#doc-search");
const searchStatus = document.querySelector("#search-status");
const sidebar = document.querySelector("#sidebar");
const sidebarToggle = document.querySelector("#sidebar-toggle");
const sidebarScrim = document.querySelector("#sidebar-scrim");

let tokenText = "";

renderSidebar();
renderToc();
renderEnvTable();
renderPalette();
renderRuntimeIssues();
setupTheme();
setupSearch();
setupCopyTokens();
setupMobileSidebar();
setupScrollSpy();
loadTokens();

function renderSidebar() {
  const markup = navGroups
    .map((group) => {
      const links = group.links
        .map((link, index) => {
          const className = index === 0 ? "sidebar-link" : "sidebar-link child";
          return `<a class="${className}" href="${link.href}">${link.label}</a>`;
        })
        .join("");

      return `<section class="sidebar-group"><h2>${group.title}</h2><div class="sidebar-links">${links}</div></section>`;
    })
    .join("");

  sidebarNav.innerHTML = markup;
}

function renderToc() {
  const headings = [...document.querySelectorAll("main h2, main h3")];
  tocNav.innerHTML = headings
    .map((heading) => {
      const className = heading.tagName === "H2" ? "toc-link" : "toc-link child";
      const id = heading.id || heading.closest("section")?.id;
      return `<a class="${className}" href="#${id}">${heading.textContent}</a>`;
    })
    .join("");
}

function renderEnvTable() {
  envTable.innerHTML = envVars
    .map(
      (item) => `
        <tr>
          <td><code>${item.name}</code></td>
          <td>${item.purpose}</td>
          <td>${item.note}</td>
        </tr>
      `
    )
    .join("");
}

function renderPalette() {
  paletteRoot.innerHTML = palette
    .map(
      (swatch) => `
        <article class="swatch" role="listitem">
          <div class="swatch-chip" style="background:${swatch.hex};"></div>
          <div class="swatch-body">
            <span class="swatch-label">${swatch.label}</span>
            <strong>${swatch.hex}</strong>
            <p><code>${swatch.token}</code></p>
            <p>${swatch.use}</p>
          </div>
        </article>
      `
    )
    .join("");
}

function renderRuntimeIssues() {
  runtimeIssuesRoot.innerHTML = runtimeIssues
    .map(
      (issue) => `
        <article class="issue-card">
          <h4>${issue.title}</h4>
          <p>${issue.body}</p>
        </article>
      `
    )
    .join("");
}

async function loadTokens() {
  try {
    const response = await fetch("./pycollab-design-tokens.json");
    const tokens = await response.json();
    tokenText = JSON.stringify(tokens, null, 2);
    tokenPreview.textContent = tokenText;
  } catch (error) {
    tokenPreview.textContent = "Unable to load token file.";
  }
}

function setupTheme() {
  const storedTheme = localStorage.getItem("pycollab-docs-theme");
  const prefersDark = window.matchMedia("(prefers-color-scheme: dark)").matches;
  const nextTheme = storedTheme || (prefersDark ? "dark" : "light");
  setTheme(nextTheme);

  themeToggle.addEventListener("click", () => {
    const currentTheme = document.documentElement.dataset.theme;
    setTheme(currentTheme === "dark" ? "light" : "dark");
  });
}

function setTheme(theme) {
  document.documentElement.dataset.theme = theme;
  localStorage.setItem("pycollab-docs-theme", theme);
  themeToggle.textContent = theme === "dark" ? "Light" : "Dark";
}

function setupSearch() {
  const searchable = [...document.querySelectorAll("main section, main h2, main h3")];

  window.addEventListener("keydown", (event) => {
    if ((event.metaKey || event.ctrlKey) && event.key.toLowerCase() === "k") {
      event.preventDefault();
      searchInput.focus();
      searchInput.select();
    }
  });

  searchInput.addEventListener("keydown", (event) => {
    if (event.key !== "Enter") {
      return;
    }

    const query = searchInput.value.trim().toLowerCase();
    if (!query) {
      searchStatus.textContent = "";
      return;
    }

    const match = searchable.find((node) => node.textContent.toLowerCase().includes(query));
    if (!match) {
      searchStatus.textContent = `No section matched "${searchInput.value.trim()}".`;
      return;
    }

    const target = match.id ? match : match.closest("section");
    if (!target) {
      return;
    }

    target.scrollIntoView({ behavior: "smooth", block: "start" });
    target.classList.add("search-hit");
    window.setTimeout(() => target.classList.remove("search-hit"), 1400);
    searchStatus.textContent = `Jumped to ${target.querySelector("h2, h3")?.textContent || target.id}.`;
  });

  searchInput.addEventListener("input", () => {
    if (!searchInput.value.trim()) {
      searchStatus.textContent = "";
    }
  });
}

function setupCopyTokens() {
  copyTokensButton.addEventListener("click", async () => {
    if (!tokenText) {
      copyStatus.textContent = "Token file is still loading.";
      return;
    }

    try {
      await navigator.clipboard.writeText(tokenText);
      copyStatus.textContent = "Copied.";
    } catch (error) {
      copyStatus.textContent = "Copy failed.";
    }
  });
}

function setupMobileSidebar() {
  sidebarToggle.addEventListener("click", () => {
    const isOpen = sidebar.dataset.open === "true";
    setSidebarOpen(!isOpen);
  });

  sidebarScrim.addEventListener("click", () => setSidebarOpen(false));

  sidebar.addEventListener("click", (event) => {
    const target = event.target;
    if (target instanceof HTMLAnchorElement && window.innerWidth <= 960) {
      setSidebarOpen(false);
    }
  });
}

function setSidebarOpen(isOpen) {
  sidebar.dataset.open = isOpen ? "true" : "false";
  sidebarToggle.setAttribute("aria-expanded", String(isOpen));
  sidebarScrim.hidden = !isOpen;
}

function setupScrollSpy() {
  const headings = [...document.querySelectorAll("main section[id], main h2[id], main h3[id]")];
  const sidebarLinks = [...document.querySelectorAll(".sidebar-link")];
  const tocLinks = [...document.querySelectorAll(".toc-link")];
  const linkMap = new Map();

  [...sidebarLinks, ...tocLinks].forEach((link) => {
    linkMap.set(link.getAttribute("href"), linkMap.get(link.getAttribute("href")) || []);
    linkMap.get(link.getAttribute("href")).push(link);
  });

  const observer = new IntersectionObserver(
    (entries) => {
      const visibleEntry = entries
        .filter((entry) => entry.isIntersecting)
        .sort((a, b) => b.intersectionRatio - a.intersectionRatio)[0];

      if (!visibleEntry) {
        return;
      }

      [...sidebarLinks, ...tocLinks].forEach((link) => link.classList.remove("active"));
      const href = `#${visibleEntry.target.id}`;
      (linkMap.get(href) || []).forEach((link) => link.classList.add("active"));
    },
    {
      rootMargin: "-120px 0px -65% 0px",
      threshold: [0.1, 0.5, 1]
    }
  );

  headings.forEach((heading) => observer.observe(heading));
}
