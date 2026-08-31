const assert = require("node:assert/strict");
const fs = require("node:fs");

const tools = fs.readFileSync("src/tools.js", "utf8");
const agent = fs.readFileSync("src/agent.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(tools.includes("https://www.bing.com/search?format=rss"), "web search needs the Bing RSS fallback");
assert.ok(tools.includes('"X-Subscription-Token": braveKey'), "Brave requests must authenticate with the configured key");
assert.ok(tools.includes("GitHub 源码搜索需要访问令牌"), "GitHub authentication failures must be actionable");
assert.ok(tools.includes("async healthCheck()"), "all agent tools need a health check");
assert.ok(tools.includes('definition.function.name !== "search_knowledge_base"'), "disabling RAG must remove only the local knowledge-base tool");
for (const name of ["本地知识库", "网页搜索", "arXiv", "GitHub 源码"]) assert.ok(tools.includes(`"${name}"`), `health check missing ${name}`);
assert.ok(agent.includes("此范围限制只适用于 search_knowledge_base"), "RAG scope must not prohibit external tools");
assert.ok(agent.includes("网页、arXiv 与 GitHub 是按需可用的外部工具"), "external tools must remain available without RAG");
assert.ok(sidebar.includes('"检查工具可用性"'), "knowledge management needs a tool-health action");
assert.ok(sidebar.includes("联网、arXiv 与 GitHub 工具仍由助手按需调用"), "chat UI must explain that external tools are independent of RAG");

console.log("Tool availability contract passed.");
