const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  Zotero: { Prefs: { get: () => "" }, logError: () => {} },
  ResearchAgentIndexer: {},
  ResearchAgentStorage: {},
  ResearchAgentWiki: { getGraph: async () => ({ nodes: {}, edges: [] }), relationLabel: (type) => type },
  Set, Object, Array, String, Number, Math, Error, RegExp, console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/tools.js", "utf8"), context);

const tools = context.ResearchAgentTools;
assert.equal(tools.calculate("(7 + 5) * 3").result, 36);
assert.equal(tools.calculate("1e3 / 8").result, 125);
assert.throws(() => tools.calculate("globalThis.process.exit()"), /只能包含/);
assert.throws(() => tools.calculate("1 / 0"), /不能除以零/);
assert.ok(tools.definitionsFor({ ragEnabled: false }).some((entry) => entry.function.name === "search_knowledge_base"), "local knowledge search remains available when no RAG scope is selected");

console.log("Agent helper-tool contract passed.");
