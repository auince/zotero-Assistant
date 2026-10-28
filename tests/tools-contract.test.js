const assert = require("node:assert/strict");
const fs = require("node:fs");

const tools = fs.readFileSync("src/tools.js", "utf8");
const agent = fs.readFileSync("src/agent.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(tools.includes("https://www.bing.com/search?format=rss"), "web search needs the Bing RSS fallback");
assert.ok(tools.includes('"X-Subscription-Token": braveKey'), "Brave requests must authenticate with the configured key");
assert.ok(tools.includes("GitHub 源码搜索需要访问令牌"), "GitHub authentication failures must be actionable");
assert.ok(tools.includes("async healthCheck()"), "all agent tools need a health check");
assert.ok(tools.includes("search_research_wiki"), "the agent needs a direct research-Wiki lookup tool");
assert.ok(tools.includes("name: \"calculate\""), "the agent needs a safe numeric helper tool");
assert.ok(tools.includes("return this.definitions;"), "RAG scope must not be a hard tool-capability wall");
for (const name of ["本地知识库", "研究 Wiki", "计算", "网页搜索", "arXiv", "GitHub 源码"]) assert.ok(tools.includes(`"${name}"`), `health check missing ${name}`);
assert.ok(agent.includes("RAG 优先范围未启用"), "RAG state must be framed as a scope preference");
assert.ok(agent.includes("不禁止工具"), "external and local tools must remain available without a selected RAG scope");
assert.ok(sidebar.includes('"检查工具可用性"'), "knowledge management needs a tool-health action");
assert.ok(sidebar.includes("自主查询本地 Wiki、知识库、联网、arXiv、GitHub 或计算工具"), "chat UI must explain agent tool autonomy");

console.log("Tool availability contract passed.");
