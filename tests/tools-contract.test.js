const assert = require("node:assert/strict");
const fs = require("node:fs");

const tools = fs.readFileSync("src/tools.js", "utf8");
const agent = fs.readFileSync("src/agent.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(tools.includes("https://www.bing.com/search?format=rss"), "web search needs the Bing RSS fallback");
assert.ok(tools.includes("https://api.deepseek.com/v1/tools/search"), "web search should prefer DeepSeek Search API");
assert.ok(tools.includes("https://api.deepseek.com/v1/tools/fetch"), "agent must be able to fetch a selected web page through DeepSeek");
assert.ok(tools.includes("need_content: false"), "search should keep initial agent context concise and fetch pages only when needed");
assert.ok(tools.includes("name: \"fetch_web_page\""), "the model needs a controlled page-fetch tool");
assert.ok(tools.includes("async cached("), "network retrieval needs a persistent cache layer");
assert.ok(tools.includes("getSearchCacheEntry"), "tool cache must survive the current chat run");
assert.ok(tools.includes("searchCacheFreshnessHours"), "cache freshness must be hot-configurable in Zotero settings");
assert.ok(tools.includes('"X-Subscription-Token": braveKey'), "Brave requests must authenticate with the configured key");
assert.ok(tools.includes("GitHub 源码搜索需要访问令牌"), "GitHub authentication failures must be actionable");
assert.ok(tools.includes("async healthCheck()"), "all agent tools need a health check");
assert.ok(tools.includes("search_research_wiki"), "the agent needs a direct research-Wiki lookup tool");
assert.ok(tools.includes("name: \"calculate\""), "the agent needs a safe numeric helper tool");
assert.ok(tools.includes("return this.definitions;"), "knowledge search must not be a hard tool-capability wall");
for (const name of ["本地知识库", "研究 Wiki", "计算", "网页搜索", "arXiv", "GitHub 源码"]) assert.ok(tools.includes(`"${name}"`), `health check missing ${name}`);
assert.ok(agent.includes("本地知识库、研究 Wiki、网页、arXiv、GitHub 与计算工具均按需可用"), "the agent must receive autonomous access to its tools");
assert.ok(agent.includes("由你判断是否检索"), "retrieval must be chosen by the agent, not a chat-panel toggle");
assert.ok(sidebar.includes('"检查工具可用性"'), "knowledge management needs a tool-health action");
assert.ok(!sidebar.includes("启用知识库检索（RAG）"), "chat UI must not expose a manual RAG enable switch");

console.log("Tool availability contract passed.");
