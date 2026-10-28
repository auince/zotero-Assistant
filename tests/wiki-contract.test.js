const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const persisted = { version: 1, nodes: {}, edges: [] };
const context = {
  Zotero: { Prefs: { get: () => "" }, logError: () => {} },
  ResearchAgentStorage: {
    getWiki: async () => persisted,
    saveWiki: async (wiki) => Object.assign(persisted, wiki)
  },
  ResearchAgentTools: {},
  ResearchAgentJobs: { start: () => { throw new Error("not used by this contract"); } },
  Set, Map, Object, Array, String, JSON, Date, Error, RegExp, console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/wiki.js", "utf8"), context);

(async () => {
  const wiki = context.ResearchAgentWiki;
  await wiki.upsertArticle({
    key: "PAPER-A", itemID: 1, title: "Hierarchical Retrieval for Vision", abstract: "We use hierarchical retrieval and reranking for visual question answering.", collectionPath: ["Multimodal RAG"]
  });
  assert.equal(persisted.nodes["PAPER-A"].domain, "Multimodal RAG", "a local fallback Wiki card must be written without a chat key");
  persisted.nodes["PAPER-B"] = { key: "PAPER-B", title: "Reranking in Multimodal Retrieval", domain: "Multimodal RAG", methods: ["reranking"], concepts: ["retrieval"], summary: "Studies reranking for multimodal retrieval." };
  persisted.edges.push({ source: "PAPER-A", target: "PAPER-B", type: "shares_method", reason: "Both use reranking in retrieval." });
  const contextText = await wiki.contextForArticle("PAPER-A", "这个方法如何和其他 reranking 工作比较？");
  assert.match(contextText, /PAPER-B/, "chat context must include graph neighbours");
  assert.match(contextText, /方法共通/, "chat context must retain the saved relation type");
  await wiki.removeArticles(["PAPER-B"]);
  assert.equal(persisted.nodes["PAPER-B"], undefined, "removing a knowledge-base entry must remove its Wiki node");
  assert.equal(persisted.edges.length, 0, "removing a node must remove its graph edges");
  console.log("Research Wiki contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
