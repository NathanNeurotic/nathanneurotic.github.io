// UI: file selection, progress, download. All work happens in builder.worker.js.
const $ = (id) => document.getElementById(id);

const MESSAGES = {
  NOT_N64: "This file is not a Nintendo 64 ROM.",
  WRONG_REGION: "This is not the USA release. Only Super Smash Bros. (USA) v1.0 is supported.",
  WRONG_REVISION: "This is the USA game, but not the expected v1.0 dump (it may be a different revision or modified).",
  CHECKSUM: "This ROM does not match Super Smash Bros. (USA) v1.0.",
  TRUNCATED: "The ROM file is incomplete (too small). Please re-dump or re-copy it.",
  WRONG_SIZE: "The ROM file is larger than expected. It may be padded or modified.",
  OUT_OF_MEMORY: "The browser ran out of memory. Close other tabs and try again, or use a desktop browser.",
  OUTPUT_HASH: "The generated file failed verification. Nothing was saved.",
  OUTPUT_SIZE: "The generated file failed verification. Nothing was saved.",
  MANIFEST: "The builder's conversion data could not be loaded. Check your connection and reload the page.",
  CONVERSION: "Asset conversion failed.",
  NO_ROM: "Select a ROM first.",
  READ: "The file could not be read.",
};

let worker = null;
let downloadUrl = null;

function show(id, visible) { $(id).hidden = !visible; }

function showError(code, detail) {
  $("error-text").textContent = MESSAGES[code] || MESSAGES.CONVERSION;
  $("error-detail").textContent = `${code}\n${detail || ""}`;
  show("error", true);
  console.error(code, detail);
}

function resetBuild() {
  show("step-build", false);
  show("progress", false);
  show("step-done", false);
  show("error", false);
  $("build").disabled = false;
  if (downloadUrl) { URL.revokeObjectURL(downloadUrl); downloadUrl = null; }
}

function startWorker() {
  if (worker) worker.terminate();
  worker = new Worker(new URL("./builder.worker.js", import.meta.url), { type: "module" });
  worker.onerror = (e) => showError("CONVERSION", e.message);
  worker.onmessage = ({ data }) => {
    switch (data.type) {
      case "verified":
        $("rom-status").textContent = "Verified";
        $("rom-status").className = "ok";
        show("step-build", true);
        break;
      case "progress":
        $("stage").textContent = data.stage;
        $("bar").value = data.percent;
        $("percent").textContent = data.percent;
        break;
      case "done": {
        const blob = new Blob([data.dat], { type: "application/octet-stream" });
        downloadUrl = URL.createObjectURL(blob);
        $("download").href = downloadUrl;
        $("stage").textContent = "Complete";
        $("bar").value = 100;
        $("percent").textContent = "100";
        show("step-done", true);
        console.info(`SSB64.DAT: ${data.size} bytes, sha256 ${data.sha256}`);
        break;
      }
      case "error":
        if (!$("step-build").hidden) $("build").disabled = false;
        if ($("rom-status").textContent === "Checking…") {
          $("rom-status").textContent = "Not accepted";
          $("rom-status").className = "bad";
        }
        showError(data.code, data.detail);
        break;
    }
  };
}

$("select-rom").addEventListener("click", () => $("rom-input").click());

$("rom-input").addEventListener("change", async () => {
  const file = $("rom-input").files[0];
  $("rom-input").value = "";
  if (!file) return;
  resetBuild();
  startWorker();
  $("rom-name").textContent = file.name;
  $("rom-status").textContent = "Checking…";
  $("rom-status").className = "";
  show("rom-info", true);
  let buf;
  try {
    buf = await file.arrayBuffer();
  } catch (e) {
    showError(e instanceof RangeError ? "OUT_OF_MEMORY" : "READ", String(e));
    return;
  }
  worker.postMessage({ type: "verify", rom: buf }, [buf]);
});

$("build").addEventListener("click", () => {
  $("build").disabled = true;
  show("error", false);
  show("progress", true);
  worker.postMessage({ type: "build" });
});

if ("serviceWorker" in navigator && window.isSecureContext) {
  navigator.serviceWorker.register("sw.js").catch((e) => console.warn("offline cache unavailable:", e));
}
if (!window.isSecureContext || !crypto.subtle) {
  showError("CONVERSION", "This page must be opened over https:// (or http://localhost), not as a local file.");
  $("select-rom").disabled = true;
}
