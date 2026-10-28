/* global Zotero, DOMParser, ResearchAgentIndexer, ResearchAgentStorage, ResearchAgentWiki */

var ResearchAgentTools = {
  definitions: [
    {
      type: "function",
      function: {
        name: "search_knowledge_base",
        description: "Search indexed Zotero collections. Returns hierarchical citations at article or paragraph level.",
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 12 } }, required: ["query"] }
      }
    },
    {
      type: "function",
      function: {
        name: "search_research_wiki",
        description: "Search local Research Wiki cards by paper title, field, method, concept, summary, and saved relations. Use to locate comparable papers before retrieving primary paragraph evidence.",
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["query"] }
      }
    },
    {
      type: "function",
      function: {
        name: "search_web",
        description: "Search the public web for recent or external information. Cite result URLs in the final answer.",
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["query"] }
      }
    },
    {
      type: "function",
      function: {
        name: "search_arxiv",
        description: "Search arXiv for papers. Use for preprints, authors, methods, and recent research.",
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["query"] }
      }
    },
    {
      type: "function",
      function: {
        name: "search_github_code",
        description: "Search GitHub source code. A GitHub access token is required by the Code Search API.",
        parameters: { type: "object", properties: { query: { type: "string" }, limit: { type: "integer", minimum: 1, maximum: 10 } }, required: ["query"] }
      }
    },
    {
      type: "function",
      function: {
        name: "calculate",
        description: "Evaluate a simple arithmetic expression accurately. Supports parentheses, +, -, *, /, %, ^ and decimal/scientific numbers. Use for numerical checks; never use it to execute code.",
        parameters: { type: "object", properties: { expression: { type: "string", description: "Arithmetic expression, e.g. '(64 * 0.75) / 12'" } }, required: ["expression"] }
      }
    }
  ],

  definitionsFor() {
    // The RAG switch selects a preferred scope, not an artificial capability
    // wall. The agent may still inspect a relevant local source when necessary.
    return this.definitions;
  },

  async execute(name, args, scope = {}) {
    if (name === "calculate") return this.calculate(args?.expression);
    const query = String(args?.query || "").trim();
    if (!query) throw new Error("检索关键词不能为空。" );
    switch (name) {
      case "search_knowledge_base": return ResearchAgentIndexer.search(query, args.limit || 8, scope.collectionIDs || [], { useSemantic: Boolean(scope.useSemantic) });
      case "search_research_wiki": return this.searchResearchWiki(query, args.limit || 6);
      case "search_web": return this.searchWeb(query, args.limit || 5);
      case "search_arxiv": return this.searchArxiv(query, args.limit || 5);
      case "search_github_code": return this.searchGitHubCode(query, args.limit || 5);
      default: throw new Error(`Unknown agent tool: ${name}`);
    }
  },

  async searchResearchWiki(query, limit) {
    const wiki = await ResearchAgentWiki.getGraph();
    const terms = this.tokens(query);
    const nodes = Object.values(wiki.nodes || {});
    return nodes.map((node) => {
      const haystack = `${node.title || ""} ${node.domain || ""} ${(node.methods || []).join(" ")} ${(node.concepts || []).join(" ")} ${node.summary || ""}`.toLowerCase();
      const score = terms.reduce((total, term) => total + (haystack.includes(term) ? (String(node.title || "").toLowerCase().includes(term) ? 4 : 1) : 0), 0);
      const relations = (wiki.edges || []).filter((edge) => edge.source === node.key || edge.target === node.key).map((edge) => ({
        articleKey: edge.source === node.key ? edge.target : edge.source,
        type: ResearchAgentWiki.relationLabel(edge.type), reason: edge.reason || ""
      }));
      return { key: node.key, title: node.title, domain: node.domain || "未标注", methods: node.methods || [], summary: node.summary || "", relations, score };
    }).filter((item) => item.score > 0).sort((a, b) => b.score - a.score).slice(0, limit);
  },

  calculate(expression) {
    const source = String(expression || "").trim();
    if (!source || source.length > 240) throw new Error("请提供不超过 240 个字符的算式。");
    const tokens = source.match(/(?:\d+(?:\.\d*)?|\.\d+)(?:e[+-]?\d+)?|[()+\-*/%^]/gi) || [];
    if (tokens.join("") !== source.replace(/\s+/g, "")) throw new Error("算式只能包含数字、科学计数法、括号与 + - * / % ^ 运算符。");
    let position = 0;
    const peek = () => tokens[position];
    const take = () => tokens[position++];
    const finite = (value) => { if (!Number.isFinite(value)) throw new Error("计算结果不是有限数值。"); return value; };
    const primary = () => { if (peek() === "(") { take(); const value = additive(); if (take() !== ")") throw new Error("括号不匹配。"); return value; } const token = take(); if (!token || !/^(?:\d|\.)/.test(token)) throw new Error("算式格式不正确。"); return finite(Number(token)); };
    const unary = () => { if (peek() === "+") { take(); return unary(); } if (peek() === "-") { take(); return finite(-unary()); } return primary(); };
    const power = () => { let value = unary(); if (peek() === "^") { take(); value = finite(value ** power()); } return value; };
    const multiplicative = () => { let value = power(); while (["*", "/", "%"].includes(peek())) { const operator = take(); const right = power(); if ((operator === "/" || operator === "%") && right === 0) throw new Error("不能除以零。"); value = finite(operator === "*" ? value * right : operator === "/" ? value / right : value % right); } return value; };
    const additive = () => { let value = multiplicative(); while (["+", "-"].includes(peek())) { const operator = take(); const right = multiplicative(); value = finite(operator === "+" ? value + right : value - right); } return value; };
    const result = additive();
    if (position !== tokens.length) throw new Error("算式格式不正确。");
    return { expression: source, result };
  },

  tokens(value) {
    return [...new Set((String(value || "").toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))];
  },

  async request(method, url, options = {}) {
    try {
      const response = await Zotero.HTTP.request(method, url, {
        headers: options.headers || {},
        body: options.body,
        responseType: options.responseType || "text",
        timeout: options.timeout || 30000
      });
      const text = response.responseText || response.response || "";
      if (!text) throw new Error("服务没有返回内容。");
      return text;
    } catch (error) {
      const status = error?.xmlhttp?.status || error?.status;
      const body = error?.xmlhttp?.responseText || error?.responseText || "";
      let detail = body;
      try { detail = JSON.parse(body).message || JSON.parse(body).error?.message || body; } catch (_) {}
      const host = (() => { try { return new URL(url).host; } catch (_) { return url; } })();
      throw new Error(`${host} 请求失败${status ? `（HTTP ${status}）` : ""}${detail ? `：${String(detail).slice(0, 280)}` : ""}`);
    }
  },

  async searchWeb(query, limit) {
    const braveKey = Zotero.Prefs.get("extensions.researchAgent.braveAPIKey", true);
    if (braveKey) {
      try {
        const raw = await this.request("GET", `https://api.search.brave.com/res/v1/web/search?q=${encodeURIComponent(query)}&count=${Math.min(limit, 20)}&safesearch=moderate`, {
          headers: { Accept: "application/json", "X-Subscription-Token": braveKey }
        });
        const data = JSON.parse(raw);
        const results = (data.web?.results || []).slice(0, limit).map((item) => ({ title: item.title, url: item.url, snippet: item.description, source: "Brave Search" })).filter((item) => item.url);
        if (results.length) return results;
      } catch (error) { Zotero.logError(error); }
    }
    const rss = await this.request("GET", `https://www.bing.com/search?format=rss&q=${encodeURIComponent(query)}`, {
      headers: { Accept: "application/rss+xml, application/xml;q=0.9", "User-Agent": "ResearchAgentForZotero/0.3" }
    });
    const doc = new DOMParser().parseFromString(rss, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("网页搜索返回了无法解析的 RSS 数据。");
    const results = [...doc.querySelectorAll("channel > item")].slice(0, limit).map((item) => ({
      title: item.querySelector("title")?.textContent?.trim(),
      url: item.querySelector("link")?.textContent?.trim(),
      snippet: item.querySelector("description")?.textContent?.replace(/<[^>]+>/g, " ").replace(/\s+/g, " ").trim(),
      source: "Bing RSS"
    })).filter((item) => item.title && /^https?:\/\//.test(item.url || ""));
    if (!results.length) throw new Error("网页搜索没有返回可用结果。可在设置中填写 Brave Search API 密钥以提高稳定性。");
    return results;
  },

  async searchArxiv(query, limit) {
    const searchQuery = `all:${query.replace(/\s+/g, "+AND+all:")}`;
    const xml = await this.request("GET", `https://export.arxiv.org/api/query?search_query=${encodeURIComponent(searchQuery)}&start=0&max_results=${limit}&sortBy=relevance&sortOrder=descending`, {
      headers: { Accept: "application/atom+xml, application/xml;q=0.9", "User-Agent": "ResearchAgentForZotero/0.3 (Zotero plugin)" }
    });
    const doc = new DOMParser().parseFromString(xml, "application/xml");
    if (doc.querySelector("parsererror")) throw new Error("arXiv 返回了无法解析的数据。");
    const results = [...doc.querySelectorAll("entry")].map((entry) => ({
      title: entry.querySelector("title")?.textContent?.replace(/\s+/g, " ").trim(),
      url: entry.querySelector("id")?.textContent?.trim(),
      published: entry.querySelector("published")?.textContent?.slice(0, 10),
      summary: entry.querySelector("summary")?.textContent?.replace(/\s+/g, " ").trim(),
      authors: [...entry.querySelectorAll("author > name")].map((node) => node.textContent)
    })).filter((item) => item.title && item.url);
    if (!results.length) throw new Error("arXiv 没有找到匹配的预印本。请尝试更具体的英文关键词。" );
    return results;
  },

  async searchGitHubCode(query, limit) {
    const token = Zotero.Prefs.get("extensions.researchAgent.githubToken", true);
    if (!token) throw new Error("GitHub 源码搜索需要访问令牌。请在 Zotero 设置 → Research Agent → 联网检索服务中填写 GitHub 访问令牌。");
    const headers = { Accept: "application/vnd.github+json", "X-GitHub-Api-Version": "2022-11-28" };
    headers.Authorization = `Bearer ${token}`;
    const raw = await this.request("GET", `https://api.github.com/search/code?q=${encodeURIComponent(query)}&per_page=${limit}`, { headers });
    const data = JSON.parse(raw);
    const results = (data.items || []).map((item) => ({
      repository: item.repository?.full_name,
      path: item.path,
      url: item.html_url,
      sha: item.sha
    })).filter((item) => item.repository && item.url);
    if (!results.length) throw new Error("GitHub 源码搜索没有返回匹配结果。请调整关键词或检查令牌的访问范围。" );
    return results;
  },

  async healthCheck() {
    const checks = [];
    const run = async (name, action, required = false) => {
      try { const result = await action(); checks.push({ name, ok: true, detail: Array.isArray(result) ? `${result.length} 条结果` : String(result) }); }
      catch (error) { checks.push({ name, ok: false, required, detail: error.message }); }
    };
    await run("本地知识库", async () => {
      const index = await ResearchAgentStorage.getIndex();
      return Object.keys(index.articles || {}).length ? `${Object.keys(index.articles).length} 篇已索引文献` : "尚未嵌入文献（功能可用）";
    });
    await run("研究 Wiki", async () => {
      const wiki = await ResearchAgentWiki.getGraph();
      return Object.keys(wiki.nodes || {}).length ? `${Object.keys(wiki.nodes).length} 个文献节点` : "尚未建立节点（功能可用）";
    });
    await run("计算", () => this.calculate("(7 + 5) * 3").result);
    await run("网页搜索", () => this.searchWeb("Zotero plugin API", 1));
    await run("arXiv", () => this.searchArxiv("machine learning", 1));
    await run("GitHub 源码", () => this.searchGitHubCode("zotero language:javascript", 1), true);
    return checks;
  }
};
