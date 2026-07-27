const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const events = [];
const chunks = [
  'data: {"choices":[{"delta":{"content":"流式"}}]}\n\n',
  'data: {"choices":[{"delta":{"reasoning_content":"检索后作答"}}]}\n\n',
  'data: {"choices":[{"delta":{"content":"回答"}}]}\n\n',
  "data: [DONE]\n\n"
];
const context = {
  Zotero: {
    Prefs: { get: (key) => key.endsWith("APIKey") ? "key" : "deepseek-v4-flash" },
    HTTP: {
      request: async (_method, _url, options) => {
        const xhr = { responseText: "" };
        options.requestObserver(xhr);
        for (const chunk of chunks) {
          xhr.responseText += chunk;
          xhr.onprogress();
        }
        return xhr;
      }
    },
    logError: () => {}
  },
  ResearchAgentStorage: { appendConversation: async () => {}, getEnabledSkills: async () => [] },
  ResearchAgentTools: { definitions: [], definitionsFor: () => [], execute: async () => [] },
  Set, JSON, Error
};
const sidebarSource = fs.readFileSync("src/sidebar.js", "utf8");
assert.ok(sidebarSource.includes("isNearLogBottom"), "streaming chat must detect when the user has scrolled away from the bottom");
assert.ok(sidebarSource.includes("scrollToLatest = (force = false)"), "streaming chat must only follow output while the user remains at the bottom");
const manifest = JSON.parse(fs.readFileSync("manifest.json", "utf8"));
assert.equal(manifest.applications.zotero.update_url, "https://github.com/auince/zotero-Agent/releases/latest/download/updates.json", "plugin updates must come from the GitHub Release manifest");
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/agent.js", "utf8"), context);

(async () => {
  const result = await context.ResearchAgentAgent.answer("test", { onEvent: (event) => events.push(event) });
  assert.equal(result.answer, "流式回答");
  assert.equal(events.filter((event) => event.type === "content").map((event) => event.text).join(""), "流式回答");
  assert.equal(events.find((event) => event.type === "reasoning").text, "检索后作答");
  console.log("Agent streaming contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
