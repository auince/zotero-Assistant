const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  Zotero: { Prefs: { get: () => 120 }, debug: () => {} },
  ResearchAgentStorage: {},
  console
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/indexer.js", "utf8"), context);

const article = {
  key: "ABCD1234",
  collectionID: 7,
  collectionPath: ["Methods", "RAG"],
  title: "Hierarchical Retrieval",
  abstract: "A short abstract.",
  text: "First paragraph has enough text to be chunked and indexed for a meaningful retrieval test.\n\nSecond paragraph discusses paragraph-level evidence and article-level metadata in the local knowledge base."
};

const chunks = context.ResearchAgentIndexer.chunkArticle(article);
assert.equal(chunks[0].level, "metadata");
assert.ok(chunks.some((chunk) => chunk.level === "paragraph"));
assert.ok(chunks.every((chunk) => chunk.articleKey === "ABCD1234"));
assert.equal(context.ResearchAgentIndexer.score(chunks[0], ["hierarchical"]), 4);
assert.ok(fs.readFileSync("src/indexer.js", "utf8").includes("ResearchAgentWiki.upsertArticle(article)"), "indexing must create or refresh the derived Wiki card");
console.log(`Indexer contract passed with ${chunks.length} hierarchical chunks.`);
