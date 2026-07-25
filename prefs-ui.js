/* global Zotero */

var ResearchAgentPreferences = {
  initialized: false,
  startupTimer: null,
  chatProviders: [
    { id: "deepseek", label: "DeepSeek", baseURL: "https://api.deepseek.com" },
    { id: "siliconflow", label: "硅基流动（开源模型）", baseURL: "https://api.siliconflow.cn/v1" },
    { id: "modelscope", label: "魔搭 ModelScope（开源模型）", baseURL: "https://api-inference.modelscope.cn/v1" },
    { id: "zhipu", label: "智谱 GLM", baseURL: "https://open.bigmodel.cn/api/paas/v4" },
    { id: "custom", label: "自定义 OpenAI 兼容服务", baseURL: "" }
  ],

  // Preference-pane scripts run in their own sandbox before the XHTML fragment
  // is inserted. Inline onload handlers cannot see this sandbox. Poll briefly
  // for the imported controls and bind them from the same script scope.
  install() {
    if (!document?.getElementById) return;
    const startWhenReady = () => {
      if (!document.getElementById("ra-fetch-deepseek-models")) {
        this.startupTimer = setTimeout(startWhenReady, 25);
        return;
      }
      this.init();
    };
    startWhenReady();
  },

  init() {
    if (this.initialized) return;
    this.initialized = true;
    const doc = document;
    this.populateChatProviders();
    doc.getElementById("ra-chat-provider").addEventListener("change", (event) => this.applyChatProvider(event.target.value));
    doc.getElementById("ra-fetch-deepseek-models").addEventListener("click", () => this.safely("ra-deepseek-status", () => this.fetchChatModels()));
    doc.getElementById("ra-test-deepseek").addEventListener("click", () => this.safely("ra-deepseek-status", () => this.testChat()));
    doc.getElementById("ra-fetch-siliconflow-models").addEventListener("click", () => this.safely("ra-siliconflow-status", () => this.fetchKnowledgeModels()));
    doc.getElementById("ra-test-siliconflow").addEventListener("click", () => this.safely("ra-siliconflow-status", () => this.testKnowledge()));
    this.bindModel("ra-deepseek-model", "extensions.researchAgent.deepseekModel");
    this.bindModel("ra-embedding-model", "extensions.researchAgent.embeddingModel");
    this.bindModel("ra-rerank-model", "extensions.researchAgent.rerankModel");
    this.bindLivePreference("ra-deepseek-key", "extensions.researchAgent.deepseekAPIKey");
    this.bindLivePreference("ra-deepseek-url", "extensions.researchAgent.deepseekBaseURL");
    this.bindLivePreference("ra-siliconflow-key", "extensions.researchAgent.siliconFlowAPIKey");
    this.bindLivePreference("ra-siliconflow-url", "extensions.researchAgent.siliconFlowBaseURL");
    this.bindLivePreference("ra-context-limit", "extensions.researchAgent.contextWindowTokens", true);
    this.bindAutomaticFetch("ra-deepseek-key", "ra-deepseek-url", () => this.fetchChatModels());
    this.bindAutomaticFetch("ra-siliconflow-key", "ra-siliconflow-url", () => this.fetchKnowledgeModels());
    // Show the persisted (and possibly startup-migrated) model in the selector
    // as soon as settings open; the user should not need to retype a key first.
    if (this.value("ra-deepseek-key") && this.value("ra-deepseek-url")) {
      this.safely("ra-deepseek-status", () => this.fetchChatModels());
    }
  },

  populateChatProviders() {
    const select = document.getElementById("ra-chat-provider");
    select.replaceChildren();
    for (const provider of this.chatProviders) {
      const option = document.createElement("option");
      option.value = provider.id;
      option.textContent = provider.label;
      select.append(option);
    }
    const configuredURL = this.value("ra-deepseek-url");
    const saved = Zotero.Prefs.get("extensions.researchAgent.chatProvider", true);
    const detected = this.chatProviders.find((provider) => provider.baseURL && provider.baseURL === configuredURL)?.id;
    const savedProvider = this.chatProviders.find((provider) => provider.id === saved);
    select.value = savedProvider?.baseURL === configuredURL ? saved : (detected || "custom");
    // Existing DeepSeek configurations predate the provider preference. Preserve them untouched.
    if (!saved && detected) {
      select.value = detected;
      Zotero.Prefs.set("extensions.researchAgent.chatProvider", detected, true);
    }
  },

  applyChatProvider(providerID) {
    const provider = this.chatProviders.find((entry) => entry.id === providerID) || this.chatProviders.at(-1);
    Zotero.Prefs.set("extensions.researchAgent.chatProvider", provider.id, true);
    if (provider.baseURL) {
      const url = document.getElementById("ra-deepseek-url");
      url.value = provider.baseURL;
      Zotero.Prefs.set("extensions.researchAgent.deepseekBaseURL", provider.baseURL, true);
    }
    const model = document.getElementById("ra-deepseek-model");
    model.replaceChildren();
    const placeholder = document.createElement("option"); placeholder.value = ""; placeholder.textContent = "正在获取该厂商的模型列表…";
    model.append(placeholder);
    Zotero.Prefs.set("extensions.researchAgent.deepseekModel", "", true);
    if (this.value("ra-deepseek-key") && this.value("ra-deepseek-url")) {
      this.safely("ra-deepseek-status", () => this.fetchChatModels());
    } else {
      this.setStatus("ra-deepseek-status", "已切换厂商。填写该厂商 API 密钥后即可获取模型列表。");
    }
  },

  bindModel(id, preference) {
    document.getElementById(id).addEventListener("change", (event) => Zotero.Prefs.set(preference, event.target.value, true));
  },

  bindLivePreference(id, preference, numeric = false) {
    document.getElementById(id).addEventListener("input", (event) => {
      const value = numeric ? Math.max(16000, Number(event.target.value) || 360000) : event.target.value;
      Zotero.Prefs.set(preference, value, true);
    });
  },

  bindAutomaticFetch(keyID, urlID, action) {
    let timer;
    const schedule = () => {
      clearTimeout(timer);
      if (this.value(keyID) && this.value(urlID)) timer = setTimeout(() => action().catch(() => {}), 650);
    };
    document.getElementById(keyID).addEventListener("change", schedule);
    document.getElementById(urlID).addEventListener("change", schedule);
  },

  value(id) {
    return document.getElementById(id).value.trim();
  },

  endpoint(baseURL, suffix) {
    return `${baseURL.replace(/\/$/, "")}${suffix}`;
  },

  setStatus(id, text, error = false) {
    const node = document.getElementById(id);
    node.textContent = text;
    node.classList.add("visible");
    node.classList.toggle("error", error);
  },

  async safely(statusID, action) {
    try {
      await action();
    } catch (error) {
      this.setStatus(statusID, error.message, true);
    }
  },

  async request(method, url, key, body) {
    const response = await Zotero.HTTP.request(method, url, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
      body: body ? JSON.stringify(body) : undefined,
      responseType: "text",
      timeout: 30000
    });
    const text = response.responseText || response.response || "{}";
    const data = JSON.parse(text);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data;
  },

  async fetchChatModels() {
    const key = this.value("ra-deepseek-key");
    const baseURL = this.value("ra-deepseek-url");
    if (!key || !baseURL) throw new Error("请先填写对话模型的 API 密钥和 API 地址。");
    this.setStatus("ra-deepseek-status", "正在从服务商获取模型列表…");
    try {
      const data = await this.request("GET", this.endpoint(baseURL, "/models"), key);
      const models = this.modelIDs(data).filter((model) => !/embedding|embed|rerank|text-to-image|image-generation|speech|audio|video/i.test(model)).sort();
      if (!models.length) throw new Error("服务商没有返回可用模型。");
      this.setOptions("ra-deepseek-model", models, Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true));
      this.setStatus("ra-deepseek-status", `已获取 ${models.length} 个模型，请选择后测试连通性。`);
    } catch (error) {
      this.setStatus("ra-deepseek-status", `获取模型失败：${error.message}`, true);
      throw error;
    }
  },

  async fetchKnowledgeModels() {
    const key = this.value("ra-siliconflow-key");
    const baseURL = this.value("ra-siliconflow-url");
    if (!key || !baseURL) throw new Error("请先填写硅基流动的 API 密钥和 API 地址。");
    this.setStatus("ra-siliconflow-status", "正在从服务商获取模型列表…");
    try {
      const data = await this.request("GET", this.endpoint(baseURL, "/models"), key);
      const models = this.modelIDs(data).sort();
      if (!models.length) throw new Error("服务商没有返回可用模型。");
      const embedding = models.filter((model) => /embed|bge-m3|text-embedding/i.test(model));
      const rerank = models.filter((model) => /rerank|bge-reranker/i.test(model));
      this.setOptions("ra-embedding-model", embedding.length ? embedding : models, Zotero.Prefs.get("extensions.researchAgent.embeddingModel", true));
      this.setOptions("ra-rerank-model", rerank.length ? rerank : models, Zotero.Prefs.get("extensions.researchAgent.rerankModel", true));
      this.setStatus("ra-siliconflow-status", `已获取 ${models.length} 个模型，请分别选择嵌入与重排序模型。`);
    } catch (error) {
      this.setStatus("ra-siliconflow-status", `获取模型失败：${error.message}`, true);
      throw error;
    }
  },

  setOptions(id, models, preferred) {
    const select = document.getElementById(id);
    select.replaceChildren();
    for (const model of models) {
      const option = document.createElement("option");
      option.value = model;
      option.textContent = model;
      select.append(option);
    }
    const selected = models.includes(preferred) ? preferred : models[0];
    select.value = selected;
    const preferences = {
      "ra-deepseek-model": "extensions.researchAgent.deepseekModel",
      "ra-embedding-model": "extensions.researchAgent.embeddingModel",
      "ra-rerank-model": "extensions.researchAgent.rerankModel"
    };
    Zotero.Prefs.set(preferences[id], selected, true);
  },

  modelIDs(data) {
    const entries = data.data || data.models || data.model_list || [];
    return entries.map((model) => typeof model === "string" ? model : (model.id || model.model || model.name))
      .filter(Boolean)
      .filter((model, index, list) => list.indexOf(model) === index);
  },

  async testChat() {
    const key = this.value("ra-deepseek-key");
    const baseURL = this.value("ra-deepseek-url");
    const model = this.value("ra-deepseek-model");
    if (!key || !baseURL || !model) throw new Error("请先填写 API 密钥、API 地址并获取并选择对话模型。");
    this.setStatus("ra-deepseek-status", "正在测试 API 与模型连通性…");
    try {
      await this.request("POST", this.endpoint(baseURL, "/chat/completions"), key, {
        model, messages: [{ role: "user", content: "请仅回复 OK" }], max_tokens: 8, temperature: 0, stream: false
      });
      this.setStatus("ra-deepseek-status", `连接成功：${model} 可用。`);
    } catch (error) {
      this.setStatus("ra-deepseek-status", `连接测试失败：${error.message}`, true);
    }
  },

  async testKnowledge() {
    const key = this.value("ra-siliconflow-key");
    const baseURL = this.value("ra-siliconflow-url");
    const embeddingModel = this.value("ra-embedding-model");
    const rerankModel = this.value("ra-rerank-model");
    if (!key || !baseURL || !embeddingModel || !rerankModel) throw new Error("请先填写 API 密钥、API 地址并获取并选择两个知识库模型。");
    this.setStatus("ra-siliconflow-status", "正在测试嵌入与重排序模型…");
    try {
      await this.request("POST", this.endpoint(baseURL, "/embeddings"), key, { model: embeddingModel, input: ["连通性测试"] });
      await this.request("POST", this.endpoint(baseURL, "/rerank"), key, { model: rerankModel, query: "测试", documents: ["测试文本"], top_n: 1, return_documents: false });
      this.setStatus("ra-siliconflow-status", `连接成功：${embeddingModel} 与 ${rerankModel} 均可用。`);
    } catch (error) {
      this.setStatus("ra-siliconflow-status", `连接测试失败：${error.message}`, true);
    }
  }
};

ResearchAgentPreferences.install();
