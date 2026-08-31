const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(source.includes("grid-template-columns:minmax(0,1fr) max-content"), "session actions must reserve their own non-shrinking grid column");
assert.ok(source.includes(".research-agent-sessionbar .research-agent-primary{min-width:max-content;white-space:nowrap}"), "new conversation button must not collapse under a long session title");
assert.ok(source.includes("Enter 发送 · ⌘ / Ctrl + Enter 换行"), "the visible shortcut hint must match the requested behavior");
assert.ok(source.includes("!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey"), "only unmodified Enter should send messages");
assert.ok(source.includes("!event.isComposing"), "IME composition must not accidentally send a message");

console.log("Sidebar shortcuts and layout contract passed.");
