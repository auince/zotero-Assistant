/* global Zotero, ResearchAgentStorage, ResearchAgentTools, ResearchAgentWiki */

// Deep research is a persisted, bounded workflow rather than an unbounded
// autonomous loop. Its task file is deliberately plain JSON so a Zotero
// restart, transient API error, or user pause can resume from collected
// evidence instead of paying to repeat the same searches.
var ResearchAgentResearch = {
  taskID() {
    return `research-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`;
  },

  preferenceNumber(name, fallback, minimum, maximum) {
    const stored = Zotero.Prefs.get(name, true);
    if (stored === "" || stored === null || stored === undefined) return fallback;
    const value = Number(stored);
    if (!Number.isFinite(value)) return fallback;
    return Math.min(maximum, Math.max(minimum, Math.floor(value)));
  },

  budgetFromPreferences() {
    return {
      maxToolCalls: this.preferenceNumber("extensions.researchAgent.deepResearchMaxToolCalls", 12, 4, 60),
      maxSearchRequests: this.preferenceNumber("extensions.researchAgent.deepResearchMaxSearchRequests", 7, 0, 60),
      maxFetches: this.preferenceNumber("extensions.researchAgent.deepResearchMaxFetches", 3, 0, 30)
    };
  },

  async create({ question, conversationID, paper } = {}) {
    const at = new Date().toISOString();
    const task = {
      version: 1,
      id: this.taskID(),
      conversationID: conversationID || "",
      question: String(question || "").trim(),
      paper: paper || null,
      createdAt: at,
      updatedAt: at,
      status: "pending",
      phase: "planning",
      plan: null,
      seeded: false,
      completedPlanQueryKeys: [],
      completedHopKeys: [],
      evidence: [],
      events: [],
      budget: this.budgetFromPreferences(),
      usage: { toolCalls: 0, searchRequests: 0, fetches: 0, cacheHits: 0 },
      answer: "",
      error: ""
    };
    await ResearchAgentStorage.saveResearchTask(task);
    return task;
  },

  async latestResumable(conversationID) {
    return (await ResearchAgentStorage.listResearchTasks(conversationID)).find((task) => ["pending", "planning", "researching", "paused", "failed"].includes(task.status)) || null;
  },

  async pause(task, reason = "用户暂停") {
    if (!task || task.status === "completed") return task;
    task.status = "paused";
    task.phase = "paused";
    task.error = reason;
    this.event(task, "paused", reason);
    await ResearchAgentStorage.saveResearchTask(task);
    return task;
  },

  async fail(task, error) {
    if (!task || task.status === "completed") return task;
    task.status = "failed";
    task.phase = "paused";
    task.error = error?.message || String(error || "研究任务未完成。");
    this.event(task, "failed", task.error);
    await ResearchAgentStorage.saveResearchTask(task);
    return task;
  },

  async complete(task, answer) {
    if (!task) return task;
    task.status = "completed";
    task.phase = "completed";
    task.answer = String(answer || "");
    task.error = "";
    this.event(task, "completed", "已完成研究综合。");
    await ResearchAgentStorage.saveResearchTask(task);
    return task;
  },

  async prepare(task, { apiKey, onEvent, scope } = {}) {
    if (!task) return null;
    // Preferences are read again when a task runs or resumes. This makes a
    // user-raised budget effective immediately without discarding evidence.
    task.budget = this.budgetFromPreferences();
    if (task.status === "paused" || task.status === "failed") {
      task.status = "researching";
      task.phase = task.plan ? "evidence" : "planning";
      task.error = "";
      this.event(task, "resumed", "从已保存的计划与证据继续。");
      this.emit(onEvent, "已恢复上次未完成的深度研究任务。");
    }
    if (!task.plan) {
      task.status = "planning";
      task.phase = "planning";
      await ResearchAgentStorage.saveResearchTask(task);
      task.plan = await this.plan(task.question, task.paper, apiKey);
      this.event(task, "plan", "已生成检索计划。");
      this.emit(onEvent, `已生成研究计划：${task.plan.objective}`);
      await ResearchAgentStorage.saveResearchTask(task);
    }
    if (!task.seeded) {
      task.status = "researching";
      task.phase = "evidence";
      await this.executePlan(task, onEvent, scope);
      const plannedCount = (task.plan?.queries || []).length;
      task.seeded = (task.completedPlanQueryKeys || []).length >= plannedCount;
      this.event(task, task.seeded ? "seeded" : "checkpoint", task.seeded ? "已完成首轮计划检索。" : "已保存未完成的计划检索步骤。");
      await ResearchAgentStorage.saveResearchTask(task);
    }
    if (task.status === "paused") return task;
    task.status = "researching";
    task.phase = "synthesis";
    await ResearchAgentStorage.saveResearchTask(task);
    return task;
  },

  async plan(question, paper, apiKey) {
    const fallback = {
      objective: this.compact(question, 160),
      questions: ["需要哪些直接证据？", "本地研究与外部研究的共同点和分歧是什么？"],
      queries: [
        { tool: "search_knowledge_base", query: this.compact(question, 120), purpose: "查找本地段落证据" },
        { tool: "search_research_wiki", query: this.compact(question, 120), purpose: "定位相关方法与论文关系" },
        { tool: "search_web", query: this.compact(question, 120), purpose: "补充近期或外部事实" }
      ]
    };
    if (!apiKey) return fallback;
    try {
      const baseURL = String(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/+$/, "");
      const model = Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash";
      const paperText = paper?.title ? `\n当前论文：${paper.title}` : "";
      const raw = await ResearchAgentTools.request("POST", `${baseURL}/chat/completions`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({ model, temperature: 0.1, messages: [
          { role: "system", content: "你是研究规划器。把研究问题拆为少量可验证的检索步骤。只返回 JSON，不要 Markdown。" },
          { role: "user", content: `问题：${question}${paperText}\n\n返回：{"objective":"...","questions":["..."],"queries":[{"tool":"search_knowledge_base|search_research_wiki|search_web|search_arxiv|search_github_code","query":"不超过120字","purpose":"..."}]}。最多 4 个查询；优先本地证据，只有外部信息真正必要时使用 web/arXiv/GitHub。` }
        ] })
      });
      const content = JSON.parse(raw).choices?.[0]?.message?.content || "";
      return this.normalisePlan(this.parseJSON(content), fallback);
    } catch (error) {
      Zotero.logError(error);
      return fallback;
    }
  },

  normalisePlan(value, fallback) {
    const allowed = new Set(["search_knowledge_base", "search_research_wiki", "search_web", "search_arxiv", "search_github_code"]);
    const queries = (Array.isArray(value?.queries) ? value.queries : []).map((query) => ({
      tool: allowed.has(query?.tool) ? query.tool : "search_knowledge_base",
      query: this.compact(query?.query, 128),
      purpose: this.compact(query?.purpose, 160)
    })).filter((query) => query.query).slice(0, 4);
    return {
      objective: this.compact(value?.objective, 200) || fallback.objective,
      questions: (Array.isArray(value?.questions) ? value.questions : fallback.questions).map((entry) => this.compact(entry, 180)).filter(Boolean).slice(0, 4),
      queries: queries.length ? queries : fallback.queries
    };
  },

  async executePlan(task, onEvent, scope = {}) {
    for (const query of task.plan?.queries || []) {
      const queryKey = `${query.tool}:${query.query}`;
      task.completedPlanQueryKeys ||= [];
      if (task.completedPlanQueryKeys.includes(queryKey)) {
        this.emit(onEvent, `复用已完成的计划步骤：${query.purpose || query.tool}`, "cache");
        continue;
      }
      if (!(await this.beforeTool(task, query.tool, onEvent))) break;
      this.emit(onEvent, `执行计划检索：${query.purpose || query.tool}`);
      try {
        const result = await ResearchAgentTools.execute(query.tool, { query: query.query, limit: 5 }, {
          ...scope,
          researchTask: task,
          onCache: (event) => this.recordCache(task, event, onEvent)
        });
        await this.recordTool(task, query.tool, { query: query.query, purpose: query.purpose, planned: true }, result, onEvent);
        task.completedPlanQueryKeys.push(queryKey);
        await ResearchAgentStorage.saveResearchTask(task);
        if (query.tool === "search_research_wiki") await this.expandWikiHop(task, result, onEvent, scope);
      } catch (error) {
        this.event(task, "tool-error", `${query.tool}: ${error.message}`);
        this.emit(onEvent, `${query.tool} 未完成：${error.message}`);
        await ResearchAgentStorage.saveResearchTask(task);
      }
    }
  },

  async expandWikiHop(task, results, onEvent, scope = {}) {
    // The first hop finds papers/relations in the local Wiki. The second hop
    // turns the most relevant neighbours into a paragraph-level knowledge-base
    // query, so graph similarity alone is never presented as primary evidence.
    if (!Array.isArray(results) || !results.length || typeof ResearchAgentWiki === "undefined" || !ResearchAgentWiki.getGraph) return;
    let graph;
    try { graph = await ResearchAgentWiki.getGraph(); } catch (error) { Zotero.logError(error); return; }
    const nodes = graph?.nodes || {};
    const targetKeys = [];
    for (const seed of results.slice(0, 3)) {
      for (const relation of seed.relations || []) {
        if (relation.articleKey && nodes[relation.articleKey] && !targetKeys.includes(relation.articleKey)) targetKeys.push(relation.articleKey);
        if (targetKeys.length >= 2) break;
      }
      if (targetKeys.length >= 2) break;
    }
    for (const key of targetKeys) {
      const node = nodes[key];
      const query = this.compact(`${node.title || ""} ${(node.methods || []).slice(0, 2).join(" ")} ${(node.concepts || []).slice(0, 2).join(" ")}`, 128);
      const hopKey = `wiki-hop:${key}`;
      task.completedHopKeys ||= [];
      if (!query || task.completedHopKeys.includes(hopKey)) continue;
      if (!(await this.beforeTool(task, "search_knowledge_base", onEvent))) return;
      this.emit(onEvent, `第二跳检索：从研究 Wiki 的关联论文回到段落证据 · ${node.title || key}`);
      try {
        const result = await ResearchAgentTools.execute("search_knowledge_base", { query, limit: 4 }, scope);
        await this.recordTool(task, "search_knowledge_base", { query, purpose: `第二跳：验证 Wiki 关联论文「${node.title || key}」的段落证据`, multiHop: true }, result, onEvent);
        task.completedHopKeys.push(hopKey);
        await ResearchAgentStorage.saveResearchTask(task);
      } catch (error) {
        this.event(task, "tool-error", `第二跳 ${key}: ${error.message}`);
        this.emit(onEvent, `第二跳检索未完成：${error.message}`);
        await ResearchAgentStorage.saveResearchTask(task);
      }
    }
  },

  async beforeTool(task, name, onEvent) {
    if (!task || task.status === "paused") return false;
    task.usage ||= { toolCalls: 0, searchRequests: 0, fetches: 0, cacheHits: 0 };
    task.budget ||= { maxToolCalls: 12, maxSearchRequests: 7, maxFetches: 3 };
    const external = ["search_web", "search_arxiv", "search_github_code"].includes(name);
    if (task.usage.toolCalls >= task.budget.maxToolCalls || (external && task.usage.searchRequests >= task.budget.maxSearchRequests) || (name === "fetch_web_page" && task.usage.fetches >= task.budget.maxFetches)) {
      await this.pause(task, "已达到深度研究的工具预算；可继续恢复任务以使用新的预算。");
      this.emit(onEvent, "已达到本次深度研究的工具预算，已保存进度。可稍后继续。", "budget");
      return false;
    }
    task.usage.toolCalls++;
    if (external) task.usage.searchRequests++;
    if (name === "fetch_web_page") task.usage.fetches++;
    this.event(task, "tool", name);
    await ResearchAgentStorage.saveResearchTask(task);
    return true;
  },

  async recordTool(task, tool, args, result, onEvent) {
    const evidence = this.evidenceFrom(tool, args, result, task.lastCacheEvent);
    const keys = new Set((task.evidence || []).map((entry) => `${entry.source}:${entry.url || entry.key || entry.title}`));
    for (const entry of evidence) {
      const key = `${entry.source}:${entry.url || entry.key || entry.title}`;
      if (keys.has(key)) continue;
      keys.add(key);
      entry.id = `E${(task.evidence || []).length + 1}`;
      task.evidence.push(entry);
      if (task.evidence.length >= 36) break;
    }
    this.event(task, "evidence", `${tool} · 新增 ${evidence.length} 条证据`);
    task.lastCacheEvent = null;
    await ResearchAgentStorage.saveResearchTask(task);
    this.emit(onEvent, `${tool} 已归档为可追溯证据。`, "evidence");
  },

  evidenceFrom(tool, args, result, cacheEvent = null) {
    const values = Array.isArray(result) ? result : result ? [result] : [];
    return values.slice(0, 8).map((item) => ({
      source: tool,
      title: item.title || item.repository || item.citation || "未命名结果",
      url: item.url || "",
      key: item.key || this.itemKey(item.citation),
      excerpt: this.compact(item.text || item.summary || item.snippet || item.content || item.path || "", 900),
      query: args?.query || "",
      purpose: args?.purpose || "",
      collectedAt: new Date().toISOString(),
      freshness: cacheEvent ? {
        state: cacheEvent.hit ? "cache" : "fresh",
        fetchedAt: cacheEvent.fetchedAt || "",
        expiresAt: cacheEvent.expiresAt || ""
      } : null
    })).filter((entry) => entry.title);
  },

  itemKey(citation) {
    return String(citation || "").match(/\[([^\]]+)\]/)?.[1] || "";
  },

  recordCache(task, event, onEvent) {
    if (event?.hit) task.usage.cacheHits = (task.usage.cacheHits || 0) + 1;
    task.lastCacheEvent = event || null;
    this.event(task, "cache", `${event?.hit ? "命中" : "刷新"}缓存：${event?.kind || "检索"}`);
    this.emit(onEvent, `${event?.hit ? "命中" : "写入"}检索缓存（${event?.kind || "检索"}）。`, "cache");
  },

  prompt(task) {
    const evidence = (task?.evidence || []).slice(0, 20).map((entry) => `${entry.id}｜${entry.title}${entry.key ? ` [${entry.key}]` : ""}${entry.url ? ` ${entry.url}` : ""}\n${entry.excerpt}`).join("\n\n");
    return `当前处于深度研究任务。任务目标：${task?.plan?.objective || task?.question || ""}\n待回答问题：${(task?.plan?.questions || []).join("；")}\n\n证据账本：\n${evidence || "暂无已收集证据。"}\n\n请基于证据账本综合回答。对关键事实在句末标注 [E1] 这类证据编号；跨来源归纳必须明确为推断。若证据不足，继续使用工具补齐，不要用猜测填补。`;
  },

  event(task, type, text) {
    task.events ||= [];
    task.events.push({ at: new Date().toISOString(), type, text: String(text || "") });
    if (task.events.length > 100) task.events.splice(0, task.events.length - 100);
  },

  parseJSON(text) {
    const value = String(text || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("规划器没有返回 JSON。");
    return JSON.parse(match[0]);
  },

  compact(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
  },

  emit(onEvent, text, type = "plan") {
    try { onEvent?.({ type, text }); } catch (error) { Zotero.logError(error); }
  }
};
