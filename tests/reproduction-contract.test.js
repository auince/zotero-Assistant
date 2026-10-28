const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const saved = [];
const preferences = {
  "extensions.researchAgent.reproductionSSHHost": "gpu-lab",
  "extensions.researchAgent.reproductionProjectRoot": "/data/reproductions",
  "extensions.researchAgent.reproductionPiCommand": "pi"
};
const context = {
  Zotero: { Prefs: { get: (key) => preferences[key] || "" }, logError: () => {} },
  ResearchAgentStorage: {
    getReproductionSessionForConversation: async () => null,
    saveReproductionSession: async (session) => { saved.push(JSON.parse(JSON.stringify(session))); return session; }
  },
  ChromeUtils: {},
  Date, Math, String, Number, Object, Array, JSON, RegExp, Error, Set, TextDecoder
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/reproduction.js", "utf8"), context);

(async () => {
  const reproduction = context.ResearchAgentReproduction;
  const session = await reproduction.forConversation({ id: "conversation-a", paper: { title: "A Paper" } });
  await reproduction.setRepository(session, "https://github.com/example/repro.git");
  assert.equal(session.projectName, "repro", "repository URLs must map to a safe stable project name");
  assert.equal(session.serverPath, "/data/reproductions/repro", "project path must stay under the configured root");
  assert.match(reproduction.piPrompt(session, "run tests"), /不得使用 sudo/, "Pi runs need explicit remote safety constraints");
  const parsed = reproduction.parsePiEvents('{"type":"session_start","sessionFile":"/tmp/pi.jsonl"}\n{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n{"type":"agent_settled"}');
  assert.equal(parsed.answer, "done", "Pi JSON events must become a readable response");
  assert.equal(parsed.sessionRef, "/tmp/pi.jsonl", "Pi session references must persist for the next turn");
  assert.ok(saved.length >= 2, "reproduction state must be stored locally");
  console.log("Remote reproduction contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
