const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const saved = [];
const context = {
  Zotero: { Prefs: { get: () => "" }, logError: () => {} },
  ResearchAgentStorage: {
    saveResearchTask: async (task) => { saved.push(JSON.parse(JSON.stringify(task))); return task; },
    listResearchTasks: async () => []
  },
  ResearchAgentWiki: {
    getGraph: async () => ({ nodes: { "paper-related": { title: "相关论文", methods: ["reranking"], concepts: ["层级检索"] } } })
  },
  ResearchAgentTools: {
    execute: async (name, args) => name === "search_research_wiki"
      ? [{ title: "种子论文", relations: [{ articleKey: "paper-related" }] }]
      : [{ title: `${name} result`, url: "https://example.com/source", summary: args.query }]
  },
  Set, Object, Array, String, Number, Math, JSON, Date, Error, RegExp, console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/research.js", "utf8"), context);

(async () => {
  const research = context.ResearchAgentResearch;
  const task = await research.create({ question: "比较层级检索和 reranking", conversationID: "conversation-a" });
  assert.equal(task.status, "pending");
  await research.prepare(task, { apiKey: "", scope: {} });
  assert.ok(task.plan?.queries?.length >= 1, "a deep-research task needs a persisted retrieval plan");
  assert.ok(task.evidence.length >= 1, "planned retrieval must become a local evidence ledger");
  assert.equal(task.completedPlanQueryKeys.length, task.plan.queries.length, "each successful plan step must be checkpointed for resume");
  assert.equal(task.completedHopKeys.length, 1, "Wiki relations must trigger a checkpointed paragraph-level second hop");
  assert.ok(task.evidence[0].id, "ledger entries need stable evidence IDs");
  assert.match(research.prompt(task), /\[E1\]/, "the synthesis prompt must preserve evidence identifiers");
  await research.pause(task, "test pause");
  assert.equal(task.status, "paused", "research tasks must be resumable after a pause");
  assert.ok(saved.length >= 3, "task state must be checkpointed throughout planning and retrieval");
  console.log("Deep research task contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
