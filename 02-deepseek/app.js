const STORAGE_KEY = "haishi-deepseek-kb-v1";
const SETTING_KEY = "haishi-deepseek-settings-v1";
const SYNC_KEY = "haishi-deepseek-sync-url";
const DEV_PASS = "1145141919810";
const DEV_UNLOCK_KEY = "haishi-dev-unlock";

const state = {
  seed: [],
  extras: [],
  model: null,
  category: "全部",
  history: [],
  settings: {
    apiKey: "",
    modelName: "deepseek-chat",
    proxyUrl: "",
  },
};

const $ = (id) => document.getElementById(id);

function allEntries() {
  const extras = state.extras.map((e) => ({ ...e, local: true }));
  const overwritten = new Set(state.extras.map((e) => e.id));
  return [...state.seed.filter((e) => !overwritten.has(e.id)), ...extras];
}

function persistKb() {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state.extras));
}

function persistSettings() {
  localStorage.setItem(SETTING_KEY, JSON.stringify(state.settings));
  refreshLinkState();
}

function refreshLinkState() {
  if (!state.settings.apiKey) {
    $("linkState").textContent = "尚未填写 API Key";
    return;
  }
  $("linkState").textContent = state.settings.proxyUrl
    ? `已连接 ${state.settings.modelName}`
    : `已填写密钥，建议配置代理后提问`;
}

function rebuild() {
  state.model = OceanEngine.build(allEntries());
  $("kbCount").textContent = String(allEntries().length);
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
    const text = `${e.title}${e.summary}${(e.tags || []).join("")}`;
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

function escapeHtml(text) {
  return String(text)
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/\n/g, "<br>");
}

function addMessage(role, html) {
  const wrap = document.createElement("div");
  wrap.className = `bubble ${role}`;
  wrap.innerHTML = html;
  $("thread").appendChild(wrap);
  $("empty").style.display = "none";
  $("thread").scrollTop = $("thread").scrollHeight;
  return wrap;
}

function openEntry(id) {
  const entry = allEntries().find((e) => e.id === id);
  if (!entry) return;
  addMessage("bot", `<h3>${entry.title}</h3>${escapeHtml(`${entry.summary}\n\n${entry.content}`)}`);
}

function fillForm(entry) {
  $("fId").value = entry?.id || "";
  $("fTitle").value = entry?.title || "";
  $("fCategory").value = entry?.category || "开发者增补";
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

function endpoint() {
  const proxy = state.settings.proxyUrl.trim();
  if (proxy) return proxy.replace(/\/$/, "");
  return "https://api.deepseek.com/chat/completions";
}

function systemPrompt(question) {
  const hits = OceanEngine.search(state.model, question, 4);
  const knowledge = OceanEngine.contextBlock(hits, 2200);
  const titles = hits.map((h) => h.entry.title).join("、");
  return [
    "你是「海识」海洋科学助手，回答使用简体中文，准确、克制、可读。",
    "优先使用下面由开发者维护的知识库；知识库没有覆盖时，再使用你自己的海洋常识，并明确区分。",
    titles ? `本次检索到的条目：${titles}。` : "本次没有检索到足够相关的本地条目。",
    knowledge ? `知识库摘录：\n${knowledge}` : "",
  ].filter(Boolean).join("\n\n");
}

async function askDeepSeek(question) {
  const messages = [
    { role: "system", content: systemPrompt(question) },
    ...state.history.slice(-6),
    { role: "user", content: question },
  ];
  const headers = {
    "Content-Type": "application/json",
    Authorization: `Bearer ${state.settings.apiKey}`,
  };
  const body = {
    model: state.settings.modelName,
    messages,
    stream: true,
    temperature: 0.4,
  };

  let res;
  try {
    res = await fetch(endpoint(), { method: "POST", headers, body: JSON.stringify(body) });
  } catch (err) {
    throw new Error("浏览器无法直连 DeepSeek（多为跨域限制）。请在 API 设置里填写已部署的代理地址。");
  }
  if (!res.ok) {
    const errText = await res.text();
    throw new Error(`DeepSeek 返回 ${res.status}：${errText.slice(0, 240)}`);
  }
  return res;
}

async function readStream(res, bubble) {
  const reader = res.body.getReader();
  const decoder = new TextDecoder();
  let full = "";
  let buffer = "";
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    const parts = buffer.split("\n");
    buffer = parts.pop() || "";
    for (const line of parts) {
      const trimmed = line.trim();
      if (!trimmed.startsWith("data:")) continue;
      const data = trimmed.slice(5).trim();
      if (data === "[DONE]") continue;
      try {
        const json = JSON.parse(data);
        const piece = json.choices?.[0]?.delta?.content || json.choices?.[0]?.message?.content || "";
        full += piece;
        bubble.innerHTML = escapeHtml(full);
        $("thread").scrollTop = $("thread").scrollHeight;
      } catch {
        /* ignore keep-alive */
      }
    }
  }
  if (!full) {
    const fallback = buffer.trim();
    try {
      const json = JSON.parse(fallback);
      full = json.choices?.[0]?.message?.content || fallback;
    } catch {
      full = fallback || "模型没有返回内容。";
    }
    bubble.innerHTML = escapeHtml(full);
  }
  return full;
}

async function ask(question) {
  const q = question.trim();
  if (!q) return;
  if (!state.settings.apiKey) {
    $("settings").classList.add("open");
    return;
  }
  $("askInput").value = "";
  addMessage("user", escapeHtml(q));
  const bubble = addMessage("bot", "正在把知识库与问题发送给 DeepSeek…");
  $("askBtn").disabled = true;
  try {
    const res = await askDeepSeek(q);
    const answer = await readStream(res, bubble);
    state.history.push({ role: "user", content: q }, { role: "assistant", content: answer });
  } catch (err) {
    const local = OceanEngine.answer(state.model, q);
    bubble.innerHTML = `<h3>DeepSeek 暂不可用</h3>${escapeHtml(`${err.message}\n\n已改用本地知识库作答：\n\n${local.text}`)}`;
  } finally {
    $("askBtn").disabled = false;
  }
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
  try {
    Object.assign(state.settings, JSON.parse(localStorage.getItem(SETTING_KEY) || "{}"));
  } catch {
    /* keep default */
  }
  if (!state.settings.proxyUrl) {
    const sameOrigin = new URL("../api/chat", location.href).href;
    state.settings.proxyUrl = sameOrigin;
  }
  $("apiKey").value = state.settings.apiKey;
  $("modelName").value = state.settings.modelName;
  $("proxyUrl").value = state.settings.proxyUrl;
  $("syncUrl").value = localStorage.getItem(SYNC_KEY) || new URL("./knowledge.json", location.href).href;
  rebuild();
  refreshLinkState();
}

async function syncRemote() {
  const url = $("syncUrl").value.trim();
  const res = await fetch(url, { cache: "no-store" });
  const data = await res.json();
  if (!Array.isArray(data.entries)) throw new Error("远程文件缺少 entries");
  state.seed = data.entries;
  localStorage.setItem(SYNC_KEY, url);
  rebuild();
  addMessage("bot", `已同步 ${data.entries.length} 条知识，下次提问将注入 DeepSeek。`);
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
    state.extras = data.entries || data;
    persistKb();
    rebuild();
  };
  reader.readAsText(file, "utf-8");
}

$("chips").addEventListener("click", (e) => {
  if (!e.target.dataset.cat) return;
  state.category = e.target.dataset.cat;
  renderLibrary($("libSearch").value);
});
$("library").addEventListener("click", (e) => {
  const card = e.target.closest(".card");
  if (card) openEntry(card.dataset.id);
});
$("suggest").addEventListener("click", (e) => e.target.dataset.q && ask(e.target.dataset.q));
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
$("openSet").addEventListener("click", () => $("settings").classList.add("open"));
$("closeSet").addEventListener("click", () => $("settings").classList.remove("open"));
$("saveEntry").addEventListener("click", () => {
  const entry = collectForm();
  if (!entry) return;
  state.extras = [...state.extras.filter((x) => x.id !== entry.id), entry];
  persistKb();
  rebuild();
});
$("deleteEntry").addEventListener("click", () => {
  state.extras = state.extras.filter((x) => x.id !== $("fId").value);
  persistKb();
  rebuild();
  fillForm(null);
});
$("exportKb").addEventListener("click", exportKb);
$("importKb").addEventListener("change", (e) => e.target.files[0] && importKb(e.target.files[0]));
$("syncNow").addEventListener("click", () => syncRemote().catch((err) => alert(err.message)));
$("newEntry").addEventListener("click", () => fillForm(null));
$("saveSet").addEventListener("click", () => {
  state.settings.apiKey = $("apiKey").value.trim();
  state.settings.modelName = $("modelName").value;
  state.settings.proxyUrl = $("proxyUrl").value.trim();
  persistSettings();
  $("settings").classList.remove("open");
});
$("clearKey").addEventListener("click", () => {
  $("apiKey").value = "";
  state.settings.apiKey = "";
  persistSettings();
});

loadSeed().catch((err) => {
  $("empty").innerHTML = `<h2>知识库未能加载</h2><p>${err.message}</p>`;
});
