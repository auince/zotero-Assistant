/* global Zotero, ResearchAgentStorage, ResearchAgentTools, ResearchAgentJobs */

// A small, local-first research graph.  The graph never replaces the indexed
// articles: it stores compact LLM-produced descriptions and explicit claims
// about why two papers belong together.  That makes it cheap to rebuild and
// safe to inspect or edit outside of Zotero if necessary.
var ResearchAgentWiki = {
  relationTypes: {
    same_domain: "同一研究领域",
    shares_method: "方法共通",
    extends: "扩展或继承",
    contrasts: "结论或假设对照",
    applies: "跨领域应用"
  },

  relationLabel(type) {
    return this.relationTypes[type] || "相关";
  },

  async getGraph() {
    return ResearchAgentStorage.getWiki();
  },

  async rebuild(articles, onProgress) {
    return ResearchAgentJobs.start("构建研究 Wiki", articles, async (article) => {
      await this.upsertArticle(article);
    }, onProgress);
  },

  async removeArticles(keys) {
    const removed = new Set(keys || []);
    if (!removed.size) return;
    const wiki = await this.getGraph();
    for (const key of removed) delete wiki.nodes[key];
    wiki.edges = wiki.edges.filter((edge) => !removed.has(edge.source) && !removed.has(edge.target));
    await ResearchAgentStorage.saveWiki(wiki);
  },

  async upsertArticle(article) {
    const wiki = await this.getGraph();
    const candidates = Object.values(wiki.nodes)
      .filter((node) => node.key !== article.key)
      .sort((a, b) => this.candidateScore(article, b) - this.candidateScore(article, a))
      .slice(0, 12);
    const fallback = this.fallbackNode(article);
    let described = fallback;
    try {
      described = { ...fallback, ...await this.describe(article, candidates) };
    } catch (error) {
      // A Wiki entry is still valuable without an available chat model. Keep
      // the fallback and allow a later rebuild to enrich it with relations.
      Zotero.logError(error);
    }
    const previous = wiki.nodes[article.key];
    const node = {
      ...described,
      key: article.key,
      itemID: article.itemID,
      title: article.title || "未命名文献",
      collectionPath: Array.isArray(article.collectionPath) ? article.collectionPath : [],
      indexedAt: article.indexedAt || new Date().toISOString(),
      createdAt: previous?.createdAt || new Date().toISOString(),
      updatedAt: new Date().toISOString()
    };
    wiki.nodes[article.key] = node;
    wiki.edges = wiki.edges.filter((edge) => edge.source !== article.key);
    for (const relation of this.validRelations(described.relations, candidates, article.key)) {
      wiki.edges.push({ source: article.key, target: relation.target, type: relation.type, reason: relation.reason, updatedAt: new Date().toISOString() });
    }
    await ResearchAgentStorage.saveWiki(wiki);
    return node;
  },

  fallbackNode(article) {
    const source = this.compact(article.abstract || article.text || "尚未提取摘要。", 620);
    const concepts = this.tokens(`${article.title || ""} ${article.abstract || ""}`).slice(0, 10);
    return {
      summary: source,
      domain: (article.collectionPath || []).slice(-1)[0] || "未分类",
      methods: [],
      concepts,
      relations: []
    };
  },

  async describe(article, candidates) {
    const apiKey = Zotero.Prefs.get("extensions.researchAgent.deepseekAPIKey", true);
    if (!apiKey) return {};
    // Match the chat agent exactly: custom OpenAI-compatible providers often
    // require a trailing /v1, so it must not be stripped here.
    const baseURL = String(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/+$/, "");
    const model = Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash";
    const candidateText = candidates.length ? candidates.map((node) => [
      `key: ${node.key}`,
      `title: ${node.title}`,
      `domain: ${node.domain || ""}`,
      `methods: ${(node.methods || []).join("；")}`,
      `summary: ${this.compact(node.summary, 460)}`
    ].join("\n")).join("\n\n") : "（这是 Wiki 的第一篇文献，没有候选关联。）";
    const prompt = `为本地研究 Wiki 建立一张文献卡片，并只基于给出的元数据、摘要/正文片段和候选卡片判断关系。不要补造论文事实、实验结果或作者立场。\n\n目标文献：\nkey: ${article.key}\ntitle: ${article.title}\ncollection: ${(article.collectionPath || []).join(" / ")}\nabstract: ${this.compact(article.abstract || article.text || "无可用摘要", 9000)}\n\n候选 Wiki 文献：\n${candidateText}\n\n只返回合法 JSON，不要 Markdown 或解释：\n{\n  "summary": "不超过 180 字的中文研究概要，写清问题、核心方法和主要结论/产出；缺失时明确缺失",\n  "domain": "一个简短领域标签",\n  "methods": ["最多 5 个方法或技术短语"],\n  "concepts": ["最多 8 个概念短语"],\n  "relations": [\n    {"target": "候选 key", "type": "same_domain|shares_method|extends|contrasts|applies", "reason": "不超过 50 字、可追溯到两篇材料的关系依据"}\n  ]\n}\n关系只连接候选文献；最多 6 条；不确定就返回空数组。`;
    const text = await ResearchAgentTools.request("POST", `${baseURL}/chat/completions`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify({ model, temperature: 0.1, messages: [
        { role: "system", content: "你是严谨的研究知识图谱整理者。输出必须是可解析 JSON。" },
        { role: "user", content: prompt }
      ] })
    });
    const parsed = JSON.parse(text);
    const content = parsed?.choices?.[0]?.message?.content;
    if (!content) throw new Error("模型没有返回 Wiki 卡片内容。");
    return this.normaliseDescription(this.parseJSON(content));
  },

  parseJSON(content) {
    const value = String(content || "").trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
    const match = value.match(/\{[\s\S]*\}/);
    if (!match) throw new Error("Wiki 卡片不是 JSON 格式。");
    return JSON.parse(match[0]);
  },

  normaliseDescription(value) {
    return {
      summary: this.compact(value?.summary || "", 900),
      domain: this.compact(value?.domain || "", 120),
      methods: this.stringList(value?.methods, 5, 120),
      concepts: this.stringList(value?.concepts, 8, 80),
      relations: Array.isArray(value?.relations) ? value.relations : []
    };
  },

  validRelations(relations, candidates, source) {
    const candidateKeys = new Set(candidates.map((candidate) => candidate.key));
    const seen = new Set();
    const result = [];
    for (const relation of relations || []) {
      const target = String(relation?.target || "");
      const type = String(relation?.type || "");
      if (target === source || !candidateKeys.has(target) || !this.relationTypes[type] || seen.has(target)) continue;
      seen.add(target);
      result.push({ target, type, reason: this.compact(relation.reason || "", 180) || "模型识别到主题或方法关联。" });
      if (result.length === 6) break;
    }
    return result;
  },

  async contextForArticle(articleKey, question, limit = 5) {
    const wiki = await this.getGraph();
    const current = wiki.nodes[articleKey];
    if (!current) return "";
    const related = [];
    const seen = new Set([articleKey]);
    for (const edge of wiki.edges) {
      if (edge.source !== articleKey && edge.target !== articleKey) continue;
      const otherKey = edge.source === articleKey ? edge.target : edge.source;
      const other = wiki.nodes[otherKey];
      if (!other || seen.has(otherKey)) continue;
      seen.add(otherKey);
      related.push({ node: other, edge, score: 100 + this.candidateScore({ title: question, abstract: question }, other) });
    }
    for (const node of Object.values(wiki.nodes)) {
      if (seen.has(node.key)) continue;
      const score = this.candidateScore({ title: `${question} ${current.title}`, abstract: `${current.domain || ""} ${(current.methods || []).join(" ")} ${(current.concepts || []).join(" ")}` }, node);
      if (score > 0) related.push({ node, edge: null, score });
    }
    related.sort((a, b) => b.score - a.score);
    const selected = related.slice(0, limit);
    const currentLine = `[${current.key}] ${current.title}\n概要：${this.compact(current.summary, 500)}\n领域：${current.domain || "未标注"}\n方法：${(current.methods || []).join("、") || "未标注"}`;
    if (!selected.length) return `当前 Wiki 文献卡片：\n${currentLine}`;
    const neighbours = selected.map(({ node, edge }) => {
      const relation = edge ? `关系：${this.relationLabel(edge.type)}${edge.reason ? `（${edge.reason}）` : ""}` : "关系：基于领域、概念或方法的相似性候选";
      return `[${node.key}] ${node.title}\n${relation}\n概要：${this.compact(node.summary, 440)}\n领域：${node.domain || "未标注"}；方法：${(node.methods || []).join("、") || "未标注"}`;
    });
    return `当前 Wiki 文献卡片：\n${currentLine}\n\n可用于比较与迁移的关联文献：\n${neighbours.join("\n\n")}`;
  },

  candidateScore(article, node) {
    const left = new Set(this.tokens(`${article.title || ""} ${article.abstract || ""} ${(article.collectionPath || []).join(" ")}`));
    const right = this.tokens(`${node.title || ""} ${node.domain || ""} ${(node.methods || []).join(" ")} ${(node.concepts || []).join(" ")} ${node.summary || ""}`);
    return right.reduce((score, term) => score + (left.has(term) ? 1 : 0), 0);
  },

  tokens(value) {
    return [...new Set((String(value || "").toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))];
  },

  stringList(values, limit, maxLength) {
    const seen = new Set();
    const result = [];
    for (const value of Array.isArray(values) ? values : []) {
      const item = this.compact(value, maxLength);
      const key = item.toLowerCase();
      if (!item || seen.has(key)) continue;
      seen.add(key); result.push(item);
      if (result.length === limit) break;
    }
    return result;
  },

  compact(value, maxLength) {
    const text = String(value || "").replace(/\s+/g, " ").trim();
    return text.length > maxLength ? `${text.slice(0, Math.max(0, maxLength - 1))}…` : text;
  }
};
