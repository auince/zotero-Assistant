/* global Zotero, ResearchAgentCredentials */

var ResearchAgentPreferences = {
  initialized: false,
  startupTimer: null,
  skillSearchResults: [],
  selectedSkillDetail: null,
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
    doc.getElementById("ra-check-deepseek-balance").addEventListener("click", () => this.safely("ra-deepseek-status", () => this.checkDeepSeekBalance()));
    doc.getElementById("ra-fetch-siliconflow-models").addEventListener("click", () => this.safely("ra-siliconflow-status", () => this.fetchKnowledgeModels()));
    doc.getElementById("ra-test-siliconflow").addEventListener("click", () => this.safely("ra-siliconflow-status", () => this.testKnowledge()));
    doc.getElementById("ra-search-skills").addEventListener("click", () => this.safely("ra-skill-status", () => this.searchSkills()));
    doc.getElementById("ra-preview-skill").addEventListener("click", () => this.safely("ra-skill-status", () => this.previewSelectedSkill()));
    doc.getElementById("ra-install-skill").addEventListener("click", () => this.safely("ra-skill-status", () => this.installSelectedSkill()));
    doc.getElementById("ra-skill-results").addEventListener("change", () => { this.selectedSkillDetail = null; });
    doc.getElementById("ra-skill-query").addEventListener("keydown", (event) => { if (event.key === "Enter") { event.preventDefault(); this.safely("ra-skill-status", () => this.searchSkills()); } });
    this.bindModel("ra-deepseek-model", "extensions.researchAgent.deepseekModel");
    this.bindModel("ra-embedding-model", "extensions.researchAgent.embeddingModel");
    this.bindModel("ra-rerank-model", "extensions.researchAgent.rerankModel");
    this.bindLivePreference("ra-deepseek-key", "extensions.researchAgent.deepseekAPIKey");
    this.bindLivePreference("ra-deepseek-url", "extensions.researchAgent.deepseekBaseURL");
    this.bindLivePreference("ra-siliconflow-key", "extensions.researchAgent.siliconFlowAPIKey");
    this.bindLivePreference("ra-siliconflow-url", "extensions.researchAgent.siliconFlowBaseURL");
    this.bindLivePreference("ra-context-limit", "extensions.researchAgent.contextWindowTokens", true);
    this.bindLivePreference("ra-deep-research-tools", "extensions.researchAgent.deepResearchMaxToolCalls", true, 4, 12);
    this.bindLivePreference("ra-deep-research-searches", "extensions.researchAgent.deepResearchMaxSearchRequests", true, 0, 7);
    this.bindLivePreference("ra-deep-research-fetches", "extensions.researchAgent.deepResearchMaxFetches", true, 0, 3);
    this.bindLivePreference("ra-search-cache-hours", "extensions.researchAgent.searchCacheFreshnessHours", true, 1, 4);
    for (const [id, name] of [["server-title", "ServerTitle"], ["ssh-host", "SSHHost"], ["ssh-user", "SSHUser"], ["project-root", "ProjectRoot"], ["pi-command", "PiCommand"]]) {
      this.bindLivePreference(`ra-reproduction-${id}`, `extensions.researchAgent.reproduction${name}`);
    }
    this.bindLivePreference("ra-reproduction-ssh-port", "extensions.researchAgent.reproductionSSHPort", true, 1, 22);
    doc.getElementById("ra-reproduction-ssh-auth").addEventListener("change", (event) => Zotero.Prefs.set("extensions.researchAgent.reproductionSSHAuthType", event.target.value, true));
    doc.getElementById("ra-save-server-password").addEventListener("click", () => this.safely("ra-server-password-status", () => this.saveServerPassword()));
    doc.getElementById("ra-forget-server-password").addEventListener("click", () => this.safely("ra-server-password-status", () => this.forgetServerPassword()));
    this.bindAutomaticFetch("ra-deepseek-key", "ra-deepseek-url", () => this.fetchChatModels());
    this.bindAutomaticFetch("ra-siliconflow-key", "ra-siliconflow-url", () => this.fetchKnowledgeModels());
    // Show the persisted (and possibly startup-migrated) model in the selector
    // as soon as settings open; the user should not need to retype a key first.
    if (this.value("ra-deepseek-key") && this.value("ra-deepseek-url")) {
      this.safely("ra-deepseek-status", () => this.fetchChatModels());
    }
    this.renderInstalledSkills().catch((error) => this.setStatus("ra-skill-status", `无法读取本地技能库：${error.message}`, true));
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

  serverIdentity() {
    const host = this.value("ra-reproduction-ssh-host");
    const username = this.value("ra-reproduction-ssh-user");
    const port = Number(this.value("ra-reproduction-ssh-port")) || 22;
    if (!/^[A-Za-z0-9_.@-]{1,180}$/.test(host) || host.startsWith("-") || !Number.isInteger(port) || port < 1 || port > 65535) throw new Error("请先填写有效的服务器地址和端口。");
    return { host, username, port };
  },

  async saveServerPassword() {
    const input = document.getElementById("ra-reproduction-ssh-password");
    const password = input.value;
    try { await ResearchAgentCredentials.savePassword(this.serverIdentity(), password); }
    finally { input.value = ""; }
    this.setStatus("ra-server-password-status", "服务器密码已保存至 Zotero 登录凭据库；不会显示在配置文件或发送给模型。");
  },

  async forgetServerPassword() {
    await ResearchAgentCredentials.forgetPassword(this.serverIdentity());
    document.getElementById("ra-reproduction-ssh-password").value = "";
    this.setStatus("ra-server-password-status", "已清除当前服务器的密码。");
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

  bindLivePreference(id, preference, numeric = false, minimum = 16000, fallback = 360000) {
    document.getElementById(id).addEventListener("input", (event) => {
      const value = numeric ? Math.max(minimum, Number(event.target.value) || fallback) : event.target.value;
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
    let response;
    try {
      response = await Zotero.HTTP.request(method, url, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${key}` },
        body: body ? JSON.stringify(body) : undefined,
        responseType: "text",
        timeout: 30000
      });
    } catch (error) {
      throw this.describeServiceError(error);
    }
    const text = response.responseText || response.response || "{}";
    const data = JSON.parse(text);
    if (data.error) throw new Error(data.error.message || JSON.stringify(data.error));
    return data;
  },

  describeServiceError(error) {
    const status = Number(error?.xmlhttp?.status || error?.status || 0);
    const body = error?.xmlhttp?.responseText || error?.responseText || "";
    const message = `${error?.message || ""}\n${body}`;
    if (status === 402 || /insufficient[ _-]?balance|余额不足/i.test(message)) {
      return new Error("模型服务余额不足（HTTP 402）。请在服务商账户充值，或切换到另一个已配置的模型厂商后重新测试。DeepSeek 可点击“检查 API 余额”查看状态。");
    }
    return error instanceof Error ? error : new Error(String(error || "服务请求失败。"));
  },

  isOfficialDeepSeek(baseURL) {
    return String(baseURL || "").replace(/\/+$/, "") === "https://api.deepseek.com";
  },

  async publicRequest(url) {
    const response = await Zotero.HTTP.request("GET", url, {
      headers: { Accept: "application/json" },
      responseType: "text",
      timeout: 30000
    });
    const text = response.responseText || response.response || "{}";
    const data = JSON.parse(text);
    if (data.error) throw new Error(data.message || data.error);
    return data;
  },

  async publicTextRequest(url) {
    const response = await Zotero.HTTP.request("GET", url, { responseType: "text", timeout: 30000 });
    return response.responseText || response.response || "";
  },

  skillIndexPath() {
    const file = Zotero.File.pathToFile(Zotero.DataDirectory.dir).clone();
    file.append("research-agent");
    file.append("skills-index.json");
    return file.path;
  },

  async readSkillIndex() {
    const root = Zotero.File.pathToFile(Zotero.DataDirectory.dir).clone();
    root.append("research-agent");
    await Zotero.File.createDirectoryIfMissingAsync(root.path);
    try {
      const data = JSON.parse(await Zotero.File.getContentsAsync(this.skillIndexPath()));
      return { version: 1, skills: Array.isArray(data.skills) ? data.skills : [] };
    } catch (error) {
      if (error.name === "NotFoundError" || /no such file/i.test(error.message)) return { version: 1, skills: [] };
      throw error;
    }
  },

  async writeSkillIndex(index) {
    await Zotero.File.putContentsAsync(this.skillIndexPath(), JSON.stringify({ version: 1, skills: index.skills || [] }, null, 2));
  },

  selectedResult() {
    const id = document.getElementById("ra-skill-results").value;
    return this.skillSearchResults.find((skill) => skill.id === id) || null;
  },

  skillDetailURL(id) {
    const safePath = String(id || "").split("/").map((part) => encodeURIComponent(part)).join("/");
    if (!safePath || safePath.split("/").length < 2) throw new Error("技能标识无效。请重新搜索后选择。" );
    return `https://skills.sh/api/v1/skills/${safePath}`;
  },

  async searchSkills() {
    const query = this.value("ra-skill-query");
    if (query.length < 2) throw new Error("请输入至少两个字符的技能关键词。");
    this.setStatus("ra-skill-status", "正在搜索 SkillMD 技能目录…");
    const data = await this.publicRequest(`https://api.skillmd.com/v1/search?q=${encodeURIComponent(query)}&limit=20`);
    this.skillSearchResults = (data.items || data.data || []).map((skill) => ({
      id: skill.id || skill.slug,
      name: skill.name || skill.title || skill.slug,
      description: skill.description || "",
      source: skill.source || String(skill.slug || "").split("/").slice(0, -1).join("/"),
      url: skill.url || "",
      rawURL: skill.raw_url || skill.rawURL || "",
      verified: Boolean(skill.verified),
      installs: Number(skill.installs || skill.install_count || 0)
    })).filter((skill) => skill.id && skill.name && skill.rawURL);
    const select = document.getElementById("ra-skill-results");
    select.replaceChildren();
    if (!this.skillSearchResults.length) {
      const empty = document.createElement("option"); empty.value = ""; empty.textContent = "没有找到匹配技能"; select.append(empty);
      this.setStatus("ra-skill-status", "没有找到可安装的匹配技能。可尝试使用英文主题词，例如 literature review。", true);
      return;
    }
    for (const skill of this.skillSearchResults) {
      const option = document.createElement("option"); option.value = skill.id;
      option.textContent = `${skill.name}${skill.verified ? " · 已审阅" : ""} · ${skill.source || "未知来源"}`;
      select.append(option);
    }
    this.selectedSkillDetail = null;
    this.setStatus("ra-skill-status", `找到 ${this.skillSearchResults.length} 个技能。选择后请先预览内容与风险提示。`);
  },

  parseSkillFrontmatter(content, fallback) {
    const header = String(content || "").match(/^---\s*\n([\s\S]*?)\n---/);
    const field = (name) => header?.[1]?.match(new RegExp(`^${name}:\\s*["']?([^\\n"']+)["']?\\s*$`, "m"))?.[1]?.trim() || "";
    return { name: field("name") || fallback.name || fallback.slug || fallback.id, description: field("description") || fallback.description || "" };
  },

  skillWarnings(content) {
    const text = String(content || "");
    const warnings = [];
    if (/ignore (all |any |the )?(previous|system)|override (the )?(system|safety)|prompt injection/i.test(text)) warnings.push("包含可能试图改变指令优先级的文本");
    if (/\b(curl|wget|fetch\(|powershell|bash|zsh|cmd\.exe|npm install|pip install|brew install)\b/i.test(text)) warnings.push("包含网络、终端或依赖安装命令（本插件不会执行）");
    if (/\b(api[ _-]?key|token|password|secret|\.env|credential)\b/i.test(text)) warnings.push("提及密钥或凭据；聊天时不会向技能提供这些内容");
    if (/\b(upload|exfiltrat|send .*to|read .*file|delete|rm -rf)\b/i.test(text)) warnings.push("包含文件或数据处理指令，需人工审阅");
    return warnings;
  },

  async loadSelectedSkillDetail() {
    const selected = this.selectedResult();
    if (!selected) throw new Error("请先选择一个搜索结果。");
    if (this.selectedSkillDetail?.id === selected.id) return this.selectedSkillDetail;
    this.setStatus("ra-skill-status", "正在下载技能说明以供预览…");
    const content = String(await this.publicTextRequest(selected.rawURL));
    if (!content.trim()) throw new Error("该技能没有可安装的 SKILL.md 文本。");
    if (content.length > 48000) throw new Error("技能说明超过 48,000 字符，为保护上下文窗口未安装。");
    const meta = this.parseSkillFrontmatter(content, selected);
    this.selectedSkillDetail = {
      id: selected.id,
      name: meta.name,
      description: meta.description,
      source: selected.source || "",
      url: selected.url || "",
      installUrl: selected.rawURL || "",
      installs: Number(selected.installs || 0),
      content,
      warnings: this.skillWarnings(content)
    };
    return this.selectedSkillDetail;
  },

  async previewSelectedSkill() {
    const skill = await this.loadSelectedSkillDetail();
    const preview = document.getElementById("ra-skill-preview");
    const warnings = skill.warnings.length ? `\n\n风险提示：${skill.warnings.join("；")}。\n本插件仅把此文本作为方法说明，绝不执行其中脚本或安装命令。` : "\n\n未检测到常见的高风险关键词；仍请阅读完整内容后再启用。";
    preview.textContent = `${skill.name}\n来源：${skill.source || "未知"}\n${skill.description || "（未提供描述）"}${warnings}\n\n${skill.content}`;
    this.setStatus("ra-skill-status", "已载入预览。确认内容适合你的研究流程后，才安装并启用。", skill.warnings.length > 0);
  },

  async installSelectedSkill() {
    const skill = await this.loadSelectedSkillDetail();
    const index = await this.readSkillIndex();
    const position = index.skills.findIndex((entry) => entry.id === skill.id);
    const record = { ...skill, enabled: true, installedAt: new Date().toISOString(), updatedAt: new Date().toISOString() };
    if (position === -1) index.skills.push(record); else index.skills[position] = { ...index.skills[position], ...record };
    await this.writeSkillIndex(index);
    await this.renderInstalledSkills();
    this.setStatus("ra-skill-status", `已安装并启用「${skill.name}」。它将在相关提问时作为受限的方法说明加载。`, skill.warnings.length > 0);
  },

  async setSkillEnabled(id, enabled) {
    const index = await this.readSkillIndex();
    const skill = index.skills.find((entry) => entry.id === id);
    if (!skill) return;
    skill.enabled = Boolean(enabled); skill.updatedAt = new Date().toISOString();
    await this.writeSkillIndex(index);
    await this.renderInstalledSkills();
  },

  async removeSkill(id) {
    const index = await this.readSkillIndex();
    const skill = index.skills.find((entry) => entry.id === id);
    if (!skill || !document.defaultView.confirm(`移除本地技能「${skill.name}」？不会影响远端来源。`)) return;
    index.skills = index.skills.filter((entry) => entry.id !== id);
    await this.writeSkillIndex(index);
    await this.renderInstalledSkills();
    this.setStatus("ra-skill-status", "已从本地技能库移除。" );
  },

  async renderInstalledSkills() {
    const container = document.getElementById("ra-installed-skills");
    const skills = await this.readSkillIndex().then((index) => index.skills.sort((a, b) => String(a.name).localeCompare(String(b.name), "zh-CN")));
    container.replaceChildren();
    if (!skills.length) { container.textContent = "尚未安装技能。搜索后可预览并安装。"; return; }
    for (const skill of skills) {
      const row = document.createElement("div"); row.className = "skill-installed-row";
      const enabled = document.createElement("input"); enabled.type = "checkbox"; enabled.checked = Boolean(skill.enabled); enabled.title = "在聊天中启用此技能";
      enabled.addEventListener("change", () => this.setSkillEnabled(skill.id, enabled.checked).catch((error) => this.setStatus("ra-skill-status", error.message, true)));
      const label = document.createElement("div"); label.className = "skill-installed-name"; label.textContent = skill.name || skill.id; label.title = `${skill.source || "未知来源"}\n${skill.description || ""}`;
      const remove = document.createElement("button"); remove.type = "button"; remove.className = "secondary"; remove.textContent = "移除";
      remove.addEventListener("click", () => this.removeSkill(skill.id).catch((error) => this.setStatus("ra-skill-status", error.message, true)));
      row.append(enabled, label, remove); container.append(row);
    }
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

  async checkDeepSeekBalance() {
    const key = this.value("ra-deepseek-key");
    const baseURL = this.value("ra-deepseek-url");
    if (!key || !baseURL) throw new Error("请先填写对话模型的 API 密钥和 API 地址。");
    if (!this.isOfficialDeepSeek(baseURL)) {
      this.setStatus("ra-deepseek-status", "余额查询仅适用于官方 DeepSeek 地址（https://api.deepseek.com）。当前厂商请使用其控制台查询余额。", true);
      return;
    }
    this.setStatus("ra-deepseek-status", "正在查询 DeepSeek API 余额…");
    const data = await this.request("GET", this.endpoint(baseURL, "/user/balance"), key);
    const balances = Array.isArray(data.balance_infos) ? data.balance_infos : [];
    const detail = balances.map((entry) => `${entry.currency || "余额"} ${entry.total_balance ?? "未知"}`).join("； ");
    if (!data.is_available) {
      this.setStatus("ra-deepseek-status", `DeepSeek API 当前不可用：余额不足。${detail ? `可用余额：${detail}。` : ""}请前往 DeepSeek 平台充值后再试。`, true);
      return;
    }
    this.setStatus("ra-deepseek-status", `DeepSeek API 余额可用${detail ? `：${detail}` : ""}。`);
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
