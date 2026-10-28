const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const context = {
  Zotero: { Prefs: { get: (key) => key.endsWith("deepseekModel") ? "deepseek-v4-flash" : "BAAI/bge-m3", set: () => {} } },
  document: {}, setTimeout, clearTimeout, Error, JSON
};
vm.createContext(context);
vm.runInContext(fs.readFileSync("prefs-ui.js", "utf8"), context);
const prefs = context.ResearchAgentPreferences;
assert.ok(prefs.chatProviders.some((provider) => provider.id === "siliconflow"), "chat settings must provide SiliconFlow");
assert.ok(prefs.chatProviders.some((provider) => provider.id === "modelscope"), "chat settings must provide ModelScope");
assert.ok(prefs.chatProviders.some((provider) => provider.id === "zhipu"), "chat settings must provide Zhipu GLM");
assert.ok(prefs.chatProviders.some((provider) => provider.id === "custom"), "chat settings must retain a custom OpenAI-compatible option");
const preferencesXHTML = fs.readFileSync("prefs.xhtml", "utf8");
assert.match(preferencesXHTML, /深度研究、缓存与预算/, "settings must expose deep-research controls");
assert.match(preferencesXHTML, /searchCacheFreshnessHours/, "settings must expose cache freshness");
assert.match(preferencesXHTML, /deepResearchMaxToolCalls/, "settings must expose the task tool budget");
const options = [];
prefs.value = (id) => ({ "ra-deepseek-key": "secret", "ra-deepseek-url": "https://api.example.com/" })[id] || "";
prefs.setStatus = () => {};
prefs.setOptions = (...args) => options.push(args);
prefs.request = async (method, url, key) => {
  assert.equal(method, "GET");
  assert.equal(url, "https://api.example.com/models");
  assert.equal(key, "secret");
  return { data: [{ id: "chat-a" }, { id: "chat-b" }] };
};

(async () => {
  await prefs.fetchChatModels();
  assert.deepEqual(options[0], ["ra-deepseek-model", ["chat-a", "chat-b"], "deepseek-v4-flash"]);
  console.log("Preference model discovery contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
