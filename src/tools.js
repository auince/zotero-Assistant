/* global Zotero, DOMParser, ResearchAgentIndexer, ResearchAgentStorage */

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
    }
  ],

  definitionsFor({ ragEnabled = true } = {}) {
    // RAG controls access to the user's local collection only. External research
    // remains an optional agent tool in every chat, rather than a separate mode.
    return this.definitions.filter((definition) => ragEnabled || definition.function.name !== "search_knowledge_base");
  },

  async execute(name, args, scope = {}) {
    const query = String(args?.query || "").trim();
    if (!query) throw new Error("检索关键词不能为空。" );
    switch (name) {
      case "search_knowledge_base": return ResearchAgentIndexer.search(query, args.limit || 8, scope.collectionIDs || [], { useSemantic: Boolean(scope.useSemantic) });
      case "search_web": return this.searchWeb(query, args.limit || 5);
      case "search_arxiv": return this.searchArxiv(query, args.limit || 5);
      case "search_github_code": return this.searchGitHubCode(query, args.limit || 5);
      default: throw new Error(`Unknown agent tool: ${name}`);
    }
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
    await run("网页搜索", () => this.searchWeb("Zotero plugin API", 1));
    await run("arXiv", () => this.searchArxiv("machine learning", 1));
    await run("GitHub 源码", () => this.searchGitHubCode("zotero language:javascript", 1), true);
    return checks;
  }
};
