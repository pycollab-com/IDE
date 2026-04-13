const PARENT_SOURCE = "pycollab-pybricks-parent";
const HOST_SOURCE = "pycollab-pybricks-host";
const VENDOR_BASE = "/vendor/pybricks-beta";
const VENDOR_STATIC_BASE = `${VENDOR_BASE}/static`;
const RUNTIME_URL = `${VENDOR_STATIC_BASE}/js/main.cfafc721.js`;
const BLOCKLY_MEDIA_BASE = "https://beta.pybricks.com/static/blockly-media/";
const SVG_NS = "http://www.w3.org/2000/svg";
const HIDDEN_RAIL_ICON_INDICES = new Set([0, 1, 3]);
const trashAnimationObservers = new WeakMap();

// Vendored from beta.pybricks.com (Pybricks Beta 2.3.0-beta.1 / docs v2.20.0).
const VENDORED_CHUNKS = [
  "388.059b77ba.chunk.js",
  "5164.8fd589d6.chunk.js",
  "6138.d5e1675a.chunk.js",
  "3344.32ebb558.chunk.js",
  "2829.fdaf90cd.chunk.js",
  "5261.a0099d37.chunk.js",
  "1991.e8964c80.chunk.js",
  "498.2489651e.chunk.js",
  "8148.68f8f341.chunk.js",
  "7346.00d5129d.chunk.js",
  "9494.f9d5286c.chunk.js",
];

const UPSTREAM_STARTER_JSON = JSON.stringify({
  blocks: {
    languageVersion: 0,
    blocks: [
      {
        type: "blockGlobalSetup",
        id: "pycollab-upstream-setup",
        x: 150,
        y: 100,
        deletable: false,
      },
      {
        type: "blockGlobalStart",
        id: "pycollab-upstream-program",
        x: 150,
        y: 300,
        deletable: false,
        next: {
          block: {
            type: "blockPrint",
            id: "pycollab-upstream-print",
            extraState: {
              optionLevel: 0,
            },
            inputs: {
              TEXT0: {
                shadow: {
                  type: "text",
                  id: "pycollab-upstream-print-text",
                  fields: {
                    TEXT: "Hello, world!",
                  },
                },
              },
            },
          },
        },
      },
    ],
  },
});

const state = {
  blockly: null,
  mountEditor: null,
  documentId: null,
  workspace: null,
  workspaceId: "",
  initialized: false,
  currentReadOnly: false,
  remotePresence: [],
  followPresence: null,
  localPointer: null,
  localFieldEdit: null,
  dragging: null,
  pointerTickAt: 0,
  applyingFollowViewport: false,
  pendingWorkspaceUpdateSource: "",
  cleanupWorkspaceUi: () => {},
  chromeObserver: null,
};

const workspaceRoot = document.getElementById("workspace");
const appRoot = document.getElementById("app");
const statusRoot = document.getElementById("status");
const presenceLayer = document.getElementById("presence-layer");

function postToParent(type, payload = {}) {
  window.parent.postMessage({ source: HOST_SOURCE, type, payload }, window.location.origin);
}

function setStatus(message) {
  if (!statusRoot) return;
  if (!message) {
    statusRoot.textContent = "";
    statusRoot.classList.remove("visible");
    return;
  }
  statusRoot.textContent = message;
  statusRoot.classList.add("visible");
}

function createSvgNode(tagName, attributes = {}) {
  const node = document.createElementNS(SVG_NS, tagName);
  Object.entries(attributes).forEach(([name, value]) => {
    node.setAttribute(name, value);
  });
  return node;
}

function getTranslateY(node) {
  const transform = node.dataset.pycollabOriginalTransform || node.getAttribute("transform") || "";
  const match = /translate\(\s*[-\d.]+\s*,\s*([-\d.]+)\s*\)/.exec(transform);
  return match ? Number.parseFloat(match[1]) : Number.MAX_SAFE_INTEGER;
}

function hideUnneededChromeIcons() {
  const railIcons = Array.from(document.querySelectorAll("image.controlsIconStyleLightTheme")).sort((left, right) => {
    return getTranslateY(left) - getTranslateY(right);
  });
  const originalSlotYs = railIcons.map((image) => {
    if (!image.dataset.pycollabOriginalTransform) {
      image.dataset.pycollabOriginalTransform = image.getAttribute("transform") || "";
    }
    return getTranslateY(image);
  });
  const firstVisibleIndex = railIcons.findIndex((image, index) => !HIDDEN_RAIL_ICON_INDICES.has(index));
  const packedSlotYs =
    firstVisibleIndex >= 0
      ? originalSlotYs.slice(firstVisibleIndex, firstVisibleIndex + railIcons.length - HIDDEN_RAIL_ICON_INDICES.size)
      : [];
  let visibleIndex = 0;

  railIcons.forEach((image, index) => {
    if (HIDDEN_RAIL_ICON_INDICES.has(index)) {
      image.style.display = "none";
      image.style.pointerEvents = "none";
      image.dataset.pycollabHidden = "1";
      return;
    }

    image.style.display = "";
    image.style.pointerEvents = "";
    image.dataset.pycollabHidden = "0";
    const originalTransform = image.dataset.pycollabOriginalTransform || image.getAttribute("transform") || "";
    const targetY = packedSlotYs[visibleIndex];
    visibleIndex += 1;
    if (!Number.isFinite(targetY)) {
      image.setAttribute("transform", originalTransform);
      return;
    }
    image.setAttribute(
      "transform",
      originalTransform.replace(
        /translate\(\s*([-\d.]+)\s*,\s*([-\d.]+)\s*\)/,
        (_, x) => `translate(${x}, ${targetY})`,
      ),
    );
  });
}

function patchTrashIcon() {
  const trash = document.querySelector("g.blocklyTrash");
  if (!(trash instanceof SVGGElement)) {
    return;
  }

  const sourceImages = Array.from(trash.children).filter((child) => child instanceof SVGImageElement);
  const bodySource = sourceImages[0] || null;
  const lidSource = sourceImages[1] || null;
  if (!(bodySource instanceof SVGImageElement) || !(lidSource instanceof SVGImageElement)) {
    return;
  }

  const syncCustomTrashLid = () => {
    const customLid = trash.querySelector('[data-pycollab-trash-lid="1"]');
    if (!(customLid instanceof SVGGElement)) return;
    customLid.setAttribute("transform", lidSource.getAttribute("transform") || "rotate(0,43,14)");
  };

  if (trash.dataset.pycollabPatched === "1") {
    syncCustomTrashLid();
    return;
  }

  sourceImages.forEach((image) => {
    image.style.opacity = "0";
    image.style.pointerEvents = "none";
  });

  const bin = createSvgNode("g", {
    "data-pycollab-trash-bin": "1",
    transform: "translate(4 5)",
    fill: "none",
    stroke: "#aab3bc",
    "stroke-width": "3",
    "stroke-linecap": "round",
    "stroke-linejoin": "round",
    "pointer-events": "none",
  });
  const scaledBin = createSvgNode("g", {
    transform: "scale(1.08)",
  });
  const body = createSvgNode("g", {
    "data-pycollab-trash-body": "1",
  });
  body.appendChild(
    createSvgNode("path", {
      d: "M14 17h20v17a3 3 0 0 1-3 3H17a3 3 0 0 1-3-3z",
    }),
  );
  body.appendChild(createSvgNode("path", { d: "M18 22v10" }));
  body.appendChild(createSvgNode("path", { d: "M24 22v10" }));
  body.appendChild(createSvgNode("path", { d: "M30 22v10" }));

  const lid = createSvgNode("g", {
    "data-pycollab-trash-lid": "1",
    transform: lidSource.getAttribute("transform") || "rotate(0,43,14)",
  });
  lid.appendChild(createSvgNode("path", { d: "M18 10h10" }));
  lid.appendChild(createSvgNode("path", { d: "M12 14h28" }));
  lid.appendChild(createSvgNode("path", { d: "M14 14l2-3h20l2 3" }));

  scaledBin.appendChild(body);
  scaledBin.appendChild(lid);
  bin.appendChild(scaledBin);

  trash.appendChild(bin);
  trash.dataset.pycollabPatched = "1";

  const lidObserver = new MutationObserver(() => {
    syncCustomTrashLid();
  });
  lidObserver.observe(lidSource, {
    attributes: true,
    attributeFilter: ["transform"],
  });
  trashAnimationObservers.set(trash, lidObserver);
  syncCustomTrashLid();
}

function customizeUpstreamChrome() {
  hideUnneededChromeIcons();
  patchTrashIcon();
}

function ensureChromeObserver() {
  if (state.chromeObserver || !appRoot) return;
  state.chromeObserver = new MutationObserver(() => {
    customizeUpstreamChrome();
  });
  state.chromeObserver.observe(appRoot, {
    childList: true,
    subtree: true,
  });
}

function loadScript(src) {
  return new Promise((resolve, reject) => {
    const existing = document.querySelector(`script[data-pybricks-src="${src}"]`);
    if (existing) {
      resolve();
      return;
    }
    const script = document.createElement("script");
    script.src = src;
    script.async = false;
    script.dataset.pybricksSrc = src;
    script.onload = () => resolve();
    script.onerror = () => reject(new Error(`Failed to load upstream Pybricks asset: ${src}`));
    document.head.appendChild(script);
  });
}

async function ensureUpstreamRuntime() {
  if (state.blockly && state.mountEditor) {
    return;
  }

  setStatus("Loading vendored Pybricks runtime...");

  if (!window.__pybricksWebpackRequire__) {
    const response = await fetch(RUNTIME_URL);
    if (!response.ok) {
      throw new Error(`Failed to load upstream Pybricks runtime (${response.status}).`);
    }
    let source = await response.text();
    source = source.replace(/n\.p="\/"/, `n.p="${VENDOR_BASE}/"`);
    const runtimeTail = "})();n(n.s=35674)})();";
    if (!source.includes(runtimeTail)) {
      throw new Error("The vendored Pybricks runtime bootstrap no longer matches the expected shape.");
    }
    source = source.replace(
      runtimeTail,
      "})();self.__pybricksWebpackRequire__=n;self.__pybricksWebpackChunkLoader__=n.e.bind(n);})();",
    );
    // eslint-disable-next-line no-eval
    (0, eval)(`${source}\n//# sourceURL=${RUNTIME_URL}?bridge`);
  }

  await Promise.all(VENDORED_CHUNKS.map((fileName) => loadScript(`${VENDOR_STATIC_BASE}/js/${fileName}`)));

  const requireUpstream = window.__pybricksWebpackRequire__;
  state.blockly = requireUpstream(2210);
  state.mountEditor = requireUpstream(53459).M;
  setStatus("");
}

function resolveBlockSvgRoot(block) {
  if (!block) return null;
  if (typeof block.getSvgRoot === "function") return block.getSvgRoot();
  if (block.svgGroup_) return block.svgGroup_;
  if (block.pathObject?.svgRoot) return block.pathObject.svgRoot;
  if (block.pathObject?.svgPath) return block.pathObject.svgPath;
  return null;
}

function normalizeWorkspaceJson(workspaceJson) {
  if (typeof workspaceJson !== "string" || !workspaceJson.trim()) {
    return UPSTREAM_STARTER_JSON;
  }

  try {
    const parsed = JSON.parse(workspaceJson);
    const blockTypes = [];
    const scanBlocks = (blockNode) => {
      if (!blockNode || typeof blockNode !== "object") return;
      if (typeof blockNode.type === "string") {
        blockTypes.push(blockNode.type);
      }
      if (blockNode.next?.block) scanBlocks(blockNode.next.block);
      if (blockNode.inputs && typeof blockNode.inputs === "object") {
        Object.values(blockNode.inputs).forEach((value) => {
          if (value?.block) scanBlocks(value.block);
          if (value?.shadow) scanBlocks(value.shadow);
        });
      }
      if (Array.isArray(blockNode.blocks)) {
        blockNode.blocks.forEach(scanBlocks);
      }
    };
    scanBlocks(parsed.blocks);
    if (blockTypes.some((type) => typeof type === "string" && type.startsWith("pybricks_"))) {
      return UPSTREAM_STARTER_JSON;
    }
    return JSON.stringify(parsed);
  } catch {
    return UPSTREAM_STARTER_JSON;
  }
}

function getWorkspaceMetrics() {
  if (!state.workspace || typeof state.workspace.getMetrics !== "function") {
    return null;
  }
  try {
    const metrics = state.workspace.getMetrics();
    return metrics
      ? {
          viewLeft: metrics.viewLeft ?? 0,
          viewTop: metrics.viewTop ?? 0,
          viewWidth: metrics.viewWidth ?? 0,
          viewHeight: metrics.viewHeight ?? 0,
          contentLeft: metrics.contentLeft ?? 0,
          contentTop: metrics.contentTop ?? 0,
          scale: state.workspace.scale ?? 1,
        }
      : null;
  } catch {
    return null;
  }
}

function emitLocalPresence(partial = {}) {
  if (!state.workspace || state.documentId == null) return;
  const selected = state.workspace.getSelected?.() || null;
  postToParent("local-presence", {
    documentId: state.documentId,
    presence: {
      activeBlockId: selected?.id || null,
      selectedBlockIds: selected?.id ? [selected.id] : [],
      editingField: state.localFieldEdit ? { ...state.localFieldEdit } : null,
      dragging: state.dragging ? { ...state.dragging } : null,
      pointer: state.localPointer ? { ...state.localPointer } : null,
      viewport: getWorkspaceMetrics(),
      ...partial,
    },
  });
}

function applyFollowPresence(blockPresence) {
  if (!state.workspace || !blockPresence) return;
  const viewport = blockPresence.viewport;
  const targetBlockId =
    typeof blockPresence.activeBlockId === "string" && blockPresence.activeBlockId
      ? blockPresence.activeBlockId
      : Array.isArray(blockPresence.selectedBlockIds) && blockPresence.selectedBlockIds.length
        ? blockPresence.selectedBlockIds[0]
        : null;

  state.applyingFollowViewport = true;
  try {
    if (viewport && Number.isFinite(viewport.scale) && viewport.scale > 0) {
      const currentScale = Number.isFinite(state.workspace.scale) ? state.workspace.scale : 1;
      if (Math.abs(currentScale - viewport.scale) > 0.001) {
        state.workspace.setScale(viewport.scale);
      }
    }

    if (
      viewport &&
      Number.isFinite(viewport.viewLeft) &&
      Number.isFinite(viewport.viewTop) &&
      typeof state.workspace.scroll === "function"
    ) {
      state.workspace.scroll(-viewport.viewLeft, -viewport.viewTop);
    } else if (targetBlockId && typeof state.workspace.centerOnBlock === "function") {
      state.workspace.centerOnBlock(targetBlockId, true);
    }
  } catch {
    // Keep follow best-effort; failures should not break the editor.
  } finally {
    window.setTimeout(() => {
      state.applyingFollowViewport = false;
      renderRemotePresence();
    }, 0);
  }
}

function pointerPayloadFromEvent(event) {
  const rect = presenceLayer.getBoundingClientRect();
  return {
    x: event.clientX - rect.left,
    y: event.clientY - rect.top,
    width: rect.width,
    height: rect.height,
  };
}

function syncHtmlInputState() {
  const activeInput = document.querySelector(".blocklyHtmlInput");
  if (!(activeInput instanceof HTMLInputElement || activeInput instanceof HTMLTextAreaElement)) {
    state.localFieldEdit = null;
    emitLocalPresence();
    return;
  }
  const selected = state.workspace?.getSelected?.() || null;
  state.localFieldEdit = {
    blockId: selected?.id || null,
    fieldId: "html-input",
    selectionStart: activeInput.selectionStart ?? 0,
    selectionEnd: activeInput.selectionEnd ?? activeInput.selectionStart ?? 0,
    value: activeInput.value,
  };
  emitLocalPresence();
}

function attachWorkspaceUiListeners() {
  state.cleanupWorkspaceUi();

  const pointerMove = (event) => {
    const now = Date.now();
    if (now - state.pointerTickAt < 40) return;
    state.pointerTickAt = now;
    state.localPointer = pointerPayloadFromEvent(event);
    emitLocalPresence();
  };
  const pointerLeave = () => {
    state.localPointer = null;
    emitLocalPresence();
  };
  const pointerDown = () => {
    const selected = state.workspace?.getSelected?.() || null;
    if (selected?.id) {
      state.dragging = { blockId: selected.id, state: "dragging" };
      emitLocalPresence();
    }
  };
  const pointerUp = () => {
    if (state.dragging) {
      state.dragging = null;
      emitLocalPresence();
    }
  };
  const onWorkspaceEvent = (event) => {
    if (!event?.isUiEvent) return;
    if (event.type === state.blockly.Events.BLOCK_DRAG) {
      state.dragging = {
        blockId: event.blockId || state.workspace?.getSelected?.()?.id || null,
        state: "dragging",
      };
    }
    if (!state.applyingFollowViewport) {
      emitLocalPresence();
    }
    renderRemotePresence();
  };

  appRoot.addEventListener("mousemove", pointerMove, true);
  appRoot.addEventListener("mouseleave", pointerLeave, true);
  appRoot.addEventListener("pointerdown", pointerDown, true);
  window.addEventListener("pointerup", pointerUp, true);
  document.addEventListener("selectionchange", syncHtmlInputState);
  document.addEventListener("input", syncHtmlInputState, true);
  document.addEventListener("focusin", syncHtmlInputState, true);
  document.addEventListener("focusout", syncHtmlInputState, true);
  document.addEventListener("keyup", syncHtmlInputState, true);
  state.workspace?.addChangeListener(onWorkspaceEvent);

  state.cleanupWorkspaceUi = () => {
    appRoot.removeEventListener("mousemove", pointerMove, true);
    appRoot.removeEventListener("mouseleave", pointerLeave, true);
    appRoot.removeEventListener("pointerdown", pointerDown, true);
    window.removeEventListener("pointerup", pointerUp, true);
    document.removeEventListener("selectionchange", syncHtmlInputState);
    document.removeEventListener("input", syncHtmlInputState, true);
    document.removeEventListener("focusin", syncHtmlInputState, true);
    document.removeEventListener("focusout", syncHtmlInputState, true);
    document.removeEventListener("keyup", syncHtmlInputState, true);
    state.workspace?.removeChangeListener(onWorkspaceEvent);
  };
}

function appendRemotePointer(person, blockPresence) {
  const pointer = blockPresence?.pointer;
  if (!pointer || !pointer.width || !pointer.height) return;
  const rect = presenceLayer.getBoundingClientRect();
  const x = (pointer.x / pointer.width) * rect.width;
  const y = (pointer.y / pointer.height) * rect.height;
  const pointerEl = document.createElement("div");
  pointerEl.className = "pycollab-remote-pointer";
  pointerEl.style.left = `${x}px`;
  pointerEl.style.top = `${y}px`;
  pointerEl.style.setProperty("--pointer-color", person.color || "#2563eb");

  const label = document.createElement("span");
  label.className = "pycollab-remote-pointer-label";
  label.textContent = person.name || "Collaborator";
  pointerEl.appendChild(label);

  presenceLayer.appendChild(pointerEl);
}

function appendRemoteSelection(person, blockPresence) {
  const selectedIds = Array.from(
    new Set(
      [...(blockPresence?.selectedBlockIds || []), blockPresence?.activeBlockId].filter(
        (value) => typeof value === "string" && value,
      ),
    ),
  );

  selectedIds.forEach((blockId) => {
    const block = state.workspace?.getBlockById?.(blockId);
    const svgRoot = resolveBlockSvgRoot(block);
    if (!(svgRoot instanceof SVGElement)) return;

    const rect = svgRoot.getBoundingClientRect();
    const layerRect = presenceLayer.getBoundingClientRect();
    if (!rect.width || !rect.height) return;

    const box = document.createElement("div");
    box.className = "pycollab-remote-selection";
    if (blockPresence?.dragging?.blockId === blockId) {
      box.classList.add("dragging");
    }
    box.style.left = `${rect.left - layerRect.left - 6}px`;
    box.style.top = `${rect.top - layerRect.top - 6}px`;
    box.style.width = `${rect.width + 12}px`;
    box.style.height = `${rect.height + 12}px`;
    box.style.setProperty("--selection-color", person.color || "#2563eb");

    const tag = document.createElement("span");
    tag.className = "pycollab-remote-selection-tag";
    tag.style.setProperty("--selection-color", person.color || "#2563eb");
    tag.textContent = person.name || "Collaborator";
    box.appendChild(tag);

    presenceLayer.appendChild(box);
  });
}

function appendRemoteEditingPills() {
  const editingPeople = state.remotePresence.filter((person) => person?.block_presence?.editingField);
  if (!editingPeople.length) return;

  const stack = document.createElement("div");
  stack.className = "pycollab-remote-editing-stack";

  editingPeople.forEach((person) => {
    const pill = document.createElement("div");
    pill.className = "pycollab-remote-editing-pill";

    const swatch = document.createElement("span");
    swatch.className = "pycollab-remote-editing-swatch";
    swatch.style.setProperty("--editing-color", person.color || "#2563eb");

    const label = document.createElement("span");
    const fieldValue = person.block_presence.editingField?.value ?? "";
    label.textContent = fieldValue
      ? `${person.name || "Collaborator"} editing: ${fieldValue}`
      : `${person.name || "Collaborator"} editing a block field`;

    pill.appendChild(swatch);
    pill.appendChild(label);
    stack.appendChild(pill);
  });

  presenceLayer.appendChild(stack);
}

function renderRemotePresence() {
  presenceLayer.replaceChildren();
  if (!state.workspace) return;

  state.remotePresence.forEach((person) => {
    const blockPresence = person?.block_presence;
    if (!blockPresence) return;
    appendRemotePointer(person, blockPresence);
    appendRemoteSelection(person, blockPresence);
  });
  appendRemoteEditingPills();
}

function loadWorkspaceSnapshot(workspaceJson, source = "remote") {
  if (!state.workspace) return;
  const normalized = normalizeWorkspaceJson(workspaceJson);

  try {
    const parsed = JSON.parse(normalized);
    state.pendingWorkspaceUpdateSource = source;
    state.blockly.Events.disable();
    try {
      state.workspace.clear();
      state.blockly.serialization.workspaces.load(parsed, state.workspace);
    } finally {
      state.blockly.Events.enable();
    }
    const finishedLoadingEvent = state.blockly.Events.get(state.blockly.Events.FINISHED_LOADING);
    if (finishedLoadingEvent) {
      state.blockly.Events.fire(new finishedLoadingEvent(state.workspace));
    }
  } catch (error) {
    postToParent("error", {
      documentId: state.documentId,
      message: error?.message || "Failed to apply upstream Pybricks workspace snapshot.",
    });
  }
}

function mountWorkspace(payload) {
  const { documentId, readOnly } = payload;
  const workspaceJson = normalizeWorkspaceJson(payload.workspaceJson);

  state.cleanupWorkspaceUi();
  if (state.workspace) {
    try {
      state.workspace.dispose();
    } catch {
      // ignore dispose races
    }
  }

  state.documentId = documentId;
  state.workspaceId = "";
  state.workspace = null;
  state.localFieldEdit = null;
  state.dragging = null;
  state.localPointer = null;
  state.currentReadOnly = !!readOnly;
  state.pendingWorkspaceUpdateSource = "init";
  workspaceRoot.replaceChildren();
  setStatus("Mounting upstream Pybricks blocks...");

  const callbacks = {
    handleWorkspaceUpdate(workspaceId, projectJson, generatedCode) {
      state.workspaceId = workspaceId;
      state.workspace = state.blockly.Workspace.getById(workspaceId);
      const source = state.pendingWorkspaceUpdateSource || "local";
      state.pendingWorkspaceUpdateSource = "";
      postToParent("workspace-update", {
        documentId: state.documentId,
        workspaceId,
        workspaceJson: projectJson,
        generatedCode,
        source,
      });
      renderRemotePresence();
    },
    handleLoadFailure() {
      postToParent("error", {
        documentId: state.documentId,
        message: "Failed to load the upstream Pybricks blocks workspace.",
      });
    },
    handleHelpClick(blockType, docsPath) {
      postToParent("help", {
        documentId: state.documentId,
        blockType,
        docsPath,
      });
    },
    handleReadOnlyUserAction() {
      postToParent("readonly-action", {
        documentId: state.documentId,
      });
    },
    toggleDocs() {
      postToParent("toggle-docs", {
        documentId: state.documentId,
      });
    },
    toggleCode() {
      postToParent("toggle-code", {
        documentId: state.documentId,
      });
    },
  };

  const workspaceId = state.mountEditor(
    workspaceRoot,
    workspaceJson,
    callbacks,
    true,
    undefined,
    "en",
    BLOCKLY_MEDIA_BASE,
    !!readOnly,
  );
  state.workspaceId = workspaceId;
  state.workspace = state.blockly.Workspace.getById(workspaceId);
  attachWorkspaceUiListeners();
  customizeUpstreamChrome();
  ensureChromeObserver();
  renderRemotePresence();
  setStatus("");
}

window.addEventListener("message", async (event) => {
  if (event.origin !== window.location.origin) return;
  const message = event.data;
  if (!message || message.source !== PARENT_SOURCE) return;

  try {
    await ensureUpstreamRuntime();
    switch (message.type) {
      case "pybricks:init":
        mountWorkspace(message.payload || {});
        state.initialized = true;
        break;
      case "pybricks:apply-snapshot":
        if (message.payload?.documentId !== state.documentId) return;
        loadWorkspaceSnapshot(message.payload.workspaceJson, message.payload.source || "remote");
        break;
      case "pybricks:remote-presence":
        if (message.payload?.documentId !== state.documentId) return;
        state.remotePresence = Array.isArray(message.payload.presence) ? message.payload.presence : [];
        renderRemotePresence();
        break;
      case "pybricks:follow-presence":
        if (message.payload?.documentId !== state.documentId) return;
        state.followPresence = message.payload.presence || null;
        applyFollowPresence(state.followPresence);
        break;
      case "pybricks:resize":
        if (state.workspace) {
          state.blockly.svgResize(state.workspace);
          customizeUpstreamChrome();
          renderRemotePresence();
        }
        break;
      default:
        break;
    }
  } catch (error) {
    postToParent("error", {
      documentId: state.documentId,
      message: error?.message || "Failed to initialize upstream Pybricks blocks.",
    });
  }
});

window.addEventListener("resize", () => {
  if (state.workspace) {
    state.blockly.svgResize(state.workspace);
    customizeUpstreamChrome();
    renderRemotePresence();
  }
});

ensureUpstreamRuntime()
  .then(() => {
    const params = new URLSearchParams(window.location.search);
    if (params.get("standalone") === "1") {
      mountWorkspace({
        documentId: "standalone",
        workspaceJson: UPSTREAM_STARTER_JSON,
        readOnly: params.get("readonly") === "1",
      });
      setStatus("");
    }
    postToParent("ready");
  })
  .catch((error) => {
    setStatus(error?.message || "Failed to initialize upstream Pybricks blocks.");
    postToParent("error", {
      documentId: state.documentId,
      message: error?.message || "Failed to initialize upstream Pybricks blocks.",
    });
  });
