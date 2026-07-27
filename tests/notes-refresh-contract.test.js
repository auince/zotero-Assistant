const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const created = [];
const summaries = [
  { id: "changed", updatedAt: "2026-07-27T10:00:00.000Z" },
  { id: "unchanged", updatedAt: "2026-07-27T09:00:00.000Z" }
];
const context = {
  Zotero: { Prefs: { get: () => "" }, logError: () => {} },
  ResearchAgentStorage: {
    listConversations: async () => summaries,
    getNoteForConversation: async (id) => id === "unchanged" ? { sourceUpdatedAt: "2026-07-27T09:00:00.000Z" } : null,
    getConversation: async (id) => ({ id, messages: [] })
  },
  Date, String, JSON, Array, Set, RegExp
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/daily-notes.js", "utf8"), context);
context.ResearchAgentDailyNotes.createConversationNote = async (conversation) => { created.push(conversation.id); return { filename: "note.md" }; };

(async () => {
  const result = await context.ResearchAgentDailyNotes.refreshChangedNotes();
  assert.equal(result.updated, 1, "only changed conversations should regenerate notes");
  assert.deepEqual(created, ["changed"]);
  console.log("Conversation note refresh contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
