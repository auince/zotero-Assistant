const assert = require("node:assert/strict");
const fs = require("node:fs");

const agent = fs.readFileSync("src/agent.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");
const storage = fs.readFileSync("src/storage.js", "utf8");

assert.ok(agent.includes("learningPrompt:"), "agent needs a dedicated learning-mode instruction");
assert.ok(agent.includes("随后只提出一个清晰"), "guided learning must ask one answerable question at a time");
assert.ok(agent.includes("立即给出完整、清楚的解释"), "learners must be able to request a direct explanation");
assert.ok(agent.includes("learning?.enabled"), "learning behavior must be opt-in per answer");
assert.ok(sidebar.includes("学习辅导模式"), "chat needs a learning-mode toggle");
assert.ok(sidebar.includes("制定学习路线"), "learning mode needs a study-path shortcut");
assert.ok(sidebar.includes("开始诊断"), "learning mode needs a diagnostic-question shortcut");
assert.ok(sidebar.includes("模式按会话保存"), "chat must explain per-session persistence");
assert.ok(storage.includes("learning: { enabled: false }"), "new conversations must persist learning-mode state");

console.log("Guided learning contract passed.");
