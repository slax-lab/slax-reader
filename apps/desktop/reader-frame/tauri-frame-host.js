/* Desktop transport around the portable reader bridge. */
(function install(configuration) {
  "use strict";
  let active = true;
  const pageId = configuration.pageId;
  const listeners = [];
  function listen(target, name, callback, options) {
    target.addEventListener(name, callback, options);
    listeners.push(() => target.removeEventListener(name, callback, options));
  }
  function post(payload) {
    if (active)
      parent.postMessage({ channel: "slax-reader", pageId, payload }, "*");
  }
  let lastSelection = "";
  function selected() {
    const bridge = window.SlaxWebViewBridge;
    const selection = window.getSelection();
    if (!selection || selection.isCollapsed || !selection.rangeCount) {
      if (lastSelection !== "none") post({ type: "textDeselected" });
      lastSelection = "none";
      return;
    }
    const range = selection.getRangeAt(0);
    const rect = range.getBoundingClientRect();
    const key = `${selection.toString()}\n${rect.x},${rect.y},${rect.width},${rect.height}`;
    if (key === lastSelection) return;
    const value = bridge.captureCurrentSelection();
    if (!value) return;
    lastSelection = key;
    post({
      type: "textSelected",
      selection: typeof value === "string" ? JSON.parse(value) : value,
      rect: { x: rect.x, y: rect.y, width: rect.width, height: rect.height },
    });
  }
  function restore(value) {
    scrollTo(
      0,
      Math.max(0, Math.min(1, value)) *
        Math.max(0, document.documentElement.scrollHeight - innerHeight),
    );
  }
  let userScrolled = false;
  const initial =
    typeof configuration.progress === "number" &&
    Number.isFinite(configuration.progress)
      ? configuration.progress
      : 0;
  if (initial > 0) restore(initial);
  // The shared bridge uses the Android-shaped host port. No native namespace is exposed.
  window.NativeBridge = {
    postMessage(raw) {
      try {
        const value = JSON.parse(raw);
        if (value.type === "textSelected") selected();
        else if (
          [
            "textDeselected",
            "markClicked",
            "domReady",
            "requestInfoPack",
          ].includes(value.type)
        )
          post(value);
      } catch {}
    },
  };
  const bridge = window.SlaxWebViewBridge;
  listen(document, "contextmenu", (event) => {
    event.preventDefault();
    selected();
    const anchor = event.target.closest("a[href]");
    post({ type: "context", url: anchor?.getAttribute("href") ?? null });
  });
  bridge.startSelectionMonitoring(
    "#slax-article-content",
    configuration.userId,
  );
  let selectionTimer;
  listen(document, "selectionchange", () => {
    clearTimeout(selectionTimer);
    selectionTimer = setTimeout(selected, 80);
  });
  listen(document, "mouseup", () => {
    clearTimeout(selectionTimer);
    selected();
  });
  let resizeTimer;
  listen(window, "resize", () => {
    clearTimeout(resizeTimer);
    resizeTimer = setTimeout(() => {
      if (lastSelection !== "none") {
        lastSelection = "";
        selected();
      }
    }, 150);
  });
  for (const name of ["wheel", "keydown", "touchstart", "pointerdown"])
    listen(window, name, () => (userScrolled = true), { passive: true });
  if (initial > 0)
    listen(window, "load", () => {
      if (!userScrolled) restore(initial);
    });
  listen(document, "keyup", (event) => {
    if (event.key === "Shift" || event.key.startsWith("Arrow")) selected();
  });
  listen(
    document,
    "click",
    (event) => {
      const anchor = event.target.closest("a[href]");
      if (anchor) {
        event.preventDefault();
        const href = anchor.getAttribute("href");
        if (href.startsWith("#")) {
          document.getElementById(href.slice(1))?.scrollIntoView();
        } else post({ type: "link", url: href });
      }
      const image = event.target.closest("img");
      if (image) post({ type: "image", url: image.getAttribute("src") });
    },
    true,
  );
  let scrollTimer;
  listen(
    window,
    "scroll",
    () => {
      clearTimeout(scrollTimer);
      scrollTimer = setTimeout(() => {
        lastSelection = lastSelection === "none" ? "none" : "";
        selected();
        post({
          type: "progress",
          value: Math.max(
            0,
            Math.min(
              1,
              scrollY /
                Math.max(
                  1,
                  document.documentElement.scrollHeight - innerHeight,
                ),
            ),
          ),
        });
      }, 200);
    },
    { passive: true },
  );
  listen(window, "message", (event) => {
    const message = event.data;
    if (
      !active ||
      event.source !== parent ||
      !message ||
      message.channel !== "slax-reader-host" ||
      message.pageId !== pageId ||
      typeof message.requestId !== "string" ||
      message.requestId.length > 80
    )
      return;
    try {
      switch (message.operation) {
        case "drawMarks": {
          if (!Array.isArray(message.argument)) return;
          const marks = JSON.stringify(message.argument);
          if (marks.length > 1024 * 1024) return;
          bridge.drawMarks(marks);
          break;
        }
        case "clearSelection":
          bridge.clearSelection();
          break;
        case "captureSelection":
          selected();
          break;
        case "restore":
          if (
            typeof message.argument === "number" &&
            Number.isFinite(message.argument)
          )
            restore(message.argument);
          break;
        case "scrollToAnchor":
          if (
            typeof message.argument === "string" &&
            message.argument.length <= 256
          )
            bridge.scrollToAnchor(message.argument);
          break;
        case "dispose":
          active = false;
          clearTimeout(selectionTimer);
          clearTimeout(scrollTimer);
          clearTimeout(resizeTimer);
          listeners.splice(0).forEach((remove) => remove());
          break;
        default:
          return;
      }
      post({ type: "result", requestId: message.requestId });
    } catch {
      post({
        type: "error",
        code: "READER_COMMAND_FAILED",
        requestId: message.requestId,
      });
    }
  });
  post({ type: "domReady" });
})(__SLAX_READER_CONFIGURATION__);
