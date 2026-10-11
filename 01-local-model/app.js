const STORAGE_KEY = "haishi-local-kb-v1";
const SYNC_KEY = "haishi-local-sync-url";
const DEV_PASS = "1145141919810";
const DEV_UNLOCK_KEY = "haishi-dev-unlock";

const state = {
  seed: [],
  extras: [],
  model: null,
  messages: [],
  category: "全部",
};

const $ = (id) => document.getElementById(id);

function allEntries() {
  const extras = state.extras.map((e) => ({ ...e, local: true }));
  const overwritten = new Set(state.extras.map((e) => e.id));
  return [...state.seed.filter((e) => !overwritten.has(e.id)), ...extras];
}

function persist() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.extras));
}

function rebuild() {
  state.model = OceanEngine.build(allEntries());
  $("kbCount").textContent = String(allEntries().length);
  $("kbUpdated").textContent = new Date().toLocaleString();
  renderLibrary();
}

function renderLibrary(filter = "") {
  const q = filter.trim();
  const cats = ["全部", ...new Set(allEntries().map((e) => e.category))];
  $("chips").innerHTML = cats
    .map((c) => `<button class="chip" data-cat="${c}">${c}</button>`)
    .join("");
  const list = allEntries().filter((e) => {
    const catOk = state.category === "全部" || e.category === state.category;
    const text = `${e.title}${e.summary}${e.tags.join("")}`;
    return catOk && (!q || text.includes(q));
  });
  $("library").innerHTML = list
    .map(
      (e) => `<article class="card" data-id="${e.id}">
        <div class="kicker">${e.category} · ${e.depth}${e.local ? " · 本地增补" : ""}</div>
        <b>${e.title}</b>
        <span>${e.summary}</span>
      </article>`
    )
    .join("");
}

function addMessage(role, html, extra = "") {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${role}`;
  wrap.innerHTML = html + extra;
  $("thread").appendChild(wrap);
  $("empty").style.display = "none";
  $("thread").scrollTop = $("thread").scrollHeight;
}

function ask(question) {
  const q = question.trim();
  if (!q) return;
  $("askInput").value = "";
  addMessage("user", q);
  const result = OceanEngine.answer(state.model, q);
  const sources = result.sources
    .map((s) => `<button class="source" data-id="${s.id}">${s.title}</button>`)
    .join("");
  const extra = `<div class="meta">置信度 ${(result.confidence * 100).toFixed(0)}% · 本地检索模型</div>
    <div class="sources" style="margin-top:10px">${sources}</div>`;
  addMessage("bot", `<h3>${result.title}</h3>${escapeHtml(result.text)}`, extra);
}

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function openEntry(id) {
  const entry = allEntries().find((e) => e.id === id);
  if (!entry) return;
  addMessage(
    "bot",
    `<h3>${entry.title}</h3>${escapeHtml(entry.summary + "\n\n" + entry.content)}
     <div class="meta">${entry.category} · ${entry.depth} · ${(entry.tags || []).join(" / ")}</div>`
  );
}

function fillForm(entry) {
  $("fId").value = entry?.id || "";
  $("fTitle").value = entry?.title || "";
  $("fCategory").value = entry?.category || "海洋环境";
  $("fDepth").value = entry?.depth || "表层";
  $("fTags").value = (entry?.tags || []).join("，");
  $("fSummary").value = entry?.summary || "";
  $("fContent").value = entry?.content || "";
  $("fQa").value = (entry?.qa || []).map((x) => `${x.q} | ${x.a}`).join("\n");
}

function collectForm() {
  const title = $("fTitle").value.trim();
  if (!title) return null;
  const qa = $("fQa").value
    .split("\n")
    .map((line) => line.split("|").map((x) => x.trim()))
    .filter((p) => p[0] && p[1])
    .map(([q, a]) => ({ q, a }));
  return {
    id: $("fId").value.trim() || `local-${Date.now()}`,
    title,
    category: $("fCategory").value.trim() || "开发者增补",
    depth: $("fDepth").value.trim() || "表层",
    tags: $("fTags").value.split(/[,，]/).map((x) => x.trim()).filter(Boolean),
    summary: $("fSummary").value.trim(),
    content: $("fContent").value.trim(),
    qa,
  };
}

async function loadSeed() {
  const res = await fetch("./knowledge.json", { cache: "no-store" });
  const data = await res.json();
  state.seed = data.entries || [];
  try {
    state.extras = JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    state.extras = [];
  }
  $("syncUrl").value = localStorage.getItem(SYNC_KEY) || new URL("./knowledge.json", location.href).href;
  rebuild();
}

async function syncRemote() {
  const url = $("syncUrl").value.trim();
  if (!url) return;
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!Array.isArray(data.entries)) throw new Error("远程文件缺少 entries");
  state.seed = data.entries;
  localStorage.setItem(SYNC_KEY, url);
  rebuild();
  addMessage("bot", `已从远程同步 ${data.entries.length} 条知识。本地增补仍会覆盖同名条目。`);
}

function exportKb() {
  const bundle = {
    version: "1.0.0",
    updated: new Date().toISOString(),
    name: "海识海洋知识库",
    entries: allEntries().map(({ local, ...rest }) => rest),
  };
  const blob = new Blob([JSON.stringify(bundle, null, 2)], { type: "application/json" });
  const a = document.createElement("a");
  a.href = URL.createObjectURL(blob);
  a.download = "knowledge.json";
  a.click();
}

function importKb(file) {
  const reader = new FileReader();
  reader.onload = () => {
    const data = JSON.parse(reader.result);
    const entries = data.entries || data;
    if (!Array.isArray(entries)) return;
    state.extras = entries;
    persist();
    rebuild();
  };
  reader.readAsText(file, "utf-8");
}

$("chips").addEventListener("click", (e) => {
  const cat = e.target.dataset.cat;
  if (!cat) return;
  state.category = cat;
  renderLibrary($("libSearch").value);
});

$("library").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) openEntry(card.dataset.id);
});

$("thread").addEventListener("click", (e) => {
  const src = e.target.closest(".source");
  if (src) openEntry(src.dataset.id);
});

$("suggest").addEventListener("click", (e) => {
  if (e.target.dataset.q) ask(e.target.dataset.q);
});

$("askForm").addEventListener("submit", (e) => {
  e.preventDefault();
  ask($("askInput").value);
});

$("libSearch").addEventListener("input", (e) => renderLibrary(e.target.value));
function openDeveloper() {
  if (sessionStorage.getItem(DEV_UNLOCK_KEY) === "1") {
    $("drawer").classList.add("open");
    return;
  }
  $("gateError").textContent = "";
  $("gatePass").value = "";
  $("gate").classList.add("open");
  $("gatePass").focus();
}
$("openDev").addEventListener("click", openDeveloper);
$("closeDev").addEventListener("click", () => $("drawer").classList.remove("open"));
$("closeGate").addEventListener("click", () => $("gate").classList.remove("open"));
$("gateForm").addEventListener("submit", (e) => {
  e.preventDefault();
  if ($("gatePass").value === DEV_PASS) {
    sessionStorage.setItem(DEV_UNLOCK_KEY, "1");
    $("gate").classList.remove("open");
    $("drawer").classList.add("open");
    return;
  }
  $("gateError").textContent = "口令不正确";
});
$("saveEntry").addEventListener("click", () => {
  const entry = collectForm();
  if (!entry) return;
  state.extras = [...state.extras.filter((x) => x.id !== entry.id), entry];
  persist();
  rebuild();
  fillForm(entry);
});
$("deleteEntry").addEventListener("click", () => {
  const id = $("fId").value;
  state.extras = state.extras.filter((x) => x.id !== id);
  persist();
  rebuild();
  fillForm(null);
});
$("exportKb").addEventListener("click", exportKb);
$("importKb").addEventListener("change", (e) => e.target.files[0] && importKb(e.target.files[0]));
$("syncNow").addEventListener("click", () => syncRemote().catch((err) => alert(err.message)));
$("newEntry").addEventListener("click", () => fillForm(null));

loadSeed().catch((err) => {
  $("empty").innerHTML = `<h2>知识库未能加载</h2><p>${err.message}</p>`;
});
