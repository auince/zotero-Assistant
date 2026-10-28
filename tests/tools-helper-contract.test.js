const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  Zotero: { Prefs: { get: () => "" }, logError: () => {} },
  ResearchAgentIndexer: {},
  ResearchAgentStorage: {},
  ResearchAgentWiki: { getGraph: async () => ({ nodes: {}, edges: [] }), relationLabel: (type) => type },
  Set, Object, Array, String, Number, Math, Error, RegExp, URL, console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/tools.js", "utf8"), context);

const tools = context.ResearchAgentTools;
assert.equal(tools.calculate("(7 + 5) * 3").result, 36);
assert.equal(tools.calculate("1e3 / 8").result, 125);
assert.throws(() => tools.calculate("globalThis.process.exit()"), /只能包含/);
assert.throws(() => tools.calculate("1 / 0"), /不能除以零/);
assert.ok(tools.definitionsFor().some((entry) => entry.function.name === "search_knowledge_base"), "local knowledge search remains available to the agent");

(async () => {
  context.Zotero.Prefs.get = (key) => key.endsWith("BaseURL") ? "https://api.deepseek.com" : "deepseek-key";
  let request;
  tools.request = async (method, url, options) => {
    request = { method, url, options };
    return JSON.stringify({ results: [{ title: "官方结果", url: "https://example.com", summary: "可供模型阅读的摘要", rerank_score: 2.1 }] });
  };
  const results = await tools.searchDeepSeek("test query", 3, "original question");
  assert.equal(request.url, "https://api.deepseek.com/v1/tools/search");
  assert.equal(JSON.parse(request.options.body).need_content, false);
  assert.equal(results[0].source, "DeepSeek Search");
  console.log("Agent helper-tool contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
