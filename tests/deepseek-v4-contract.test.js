const assert = require("node:assert/strict");
const fs = require("node:fs");

const prefs = fs.readFileSync("prefs.js", "utf8");
const main = fs.readFileSync("src/main.js", "utf8");
const agent = fs.readFileSync("src/agent.js", "utf8");
const memory = fs.readFileSync("src/memory.js", "utf8");
const notes = fs.readFileSync("src/daily-notes.js", "utf8");
const preferencesUI = fs.readFileSync("prefs-ui.js", "utf8");
const preferencesMarkup = fs.readFileSync("prefs.xhtml", "utf8");

assert.ok(prefs.includes('"deepseek-v4-flash"'), "new profiles must default to an active DeepSeek V4 model");
assert.ok(main.includes("migrateDeprecatedDeepSeekModel"), "startup must migrate persisted deprecated DeepSeek aliases");
assert.ok(main.includes('["deepseek-chat", "deepseek-reasoner"]'), "both retired DeepSeek aliases must be recognized");
assert.ok(preferencesUI.includes('this.safely("ra-deepseek-status", () => this.fetchChatModels())'), "settings must refresh persisted chat-model choices when opened");
assert.ok(preferencesUI.includes("async checkDeepSeekBalance()"), "settings must support DeepSeek balance checks");
assert.ok(preferencesUI.includes('this.endpoint(baseURL, "/user/balance")'), "balance checks must use DeepSeek's official balance endpoint");
assert.ok(preferencesMarkup.includes('id="ra-check-deepseek-balance"'), "settings must expose the balance-check button");
assert.ok(agent.includes("模型服务余额不足（HTTP 402）"), "chat failures must explain a provider balance error clearly");
for (const source of [agent, memory, notes]) {
  assert.ok(source.includes('|| "deepseek-v4-flash"'), "all chat calls must use the V4 Flash fallback");
  assert.ok(!source.includes('|| "deepseek-chat"'), "no runtime fallback may use the retired DeepSeek alias");
}

console.log("DeepSeek V4 migration contract passed.");
