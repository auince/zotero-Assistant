const assert = require("node:assert/strict");
const fs = require("node:fs");

const agent = fs.readFileSync("src/agent.js", "utf8");

assert.ok(agent.includes("先给可检验的结论、判断或关键解释"), "answers must lead with the answer rather than generic setup");
assert.ok(agent.includes("不强行套“背景—方法—结论”模板"), "simple questions must not receive a rigid template");
assert.ok(agent.includes("按主题、机制、发现或争议组织"), "multi-source synthesis must be thematic");
assert.ok(agent.includes("来源直接支持"), "answers must distinguish evidence from inference");
assert.ok(agent.includes("最小、可验证的动作"), "recommendations must be concrete and testable");
assert.ok(agent.includes("不要为了调用工具而调用"), "tool calling must remain deliberate");

console.log("Answer-quality prompt contract passed.");
