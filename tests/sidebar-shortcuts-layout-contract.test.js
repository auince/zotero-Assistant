const assert = require("node:assert/strict");
const fs = require("node:fs");

const source = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(source.includes("grid-template-columns:minmax(0,1fr) max-content"), "session actions must reserve their own non-shrinking grid column");
assert.ok(source.includes(".research-agent-sessionbar .research-agent-primary{min-width:max-content;white-space:nowrap}"), "new conversation button must not collapse under a long session title");
assert.ok(source.includes("Enter 发送 · ⌘ / Ctrl + Enter 换行"), "the visible shortcut hint must match the requested behavior");
assert.ok(source.includes("!event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey"), "only unmodified Enter should send messages");
assert.ok(source.includes("!event.isComposing"), "IME composition must not accidentally send a message");
assert.ok(source.includes("research-agent-notes-card{flex:1 1 0;min-height:0;overflow:hidden}"), "notes card must receive a bounded flex height");
assert.ok(source.includes("overflow-y:scroll"), "note preview must own a usable vertical scrollbar");
assert.ok(source.includes("research-agent-note-title"), "note title and metadata must render as distinct non-overlapping elements");
assert.ok(source.includes("research-agent-wiki-graph"), "knowledge management must expose the visual research Wiki graph");
assert.ok(source.includes("为已入库文献补建 Wiki"), "users must be able to build a graph for entries indexed before this version");
assert.ok(source.includes("深度研究模式"), "chat must expose a deliberate deep-research mode");
assert.ok(source.includes("继续任务"), "interrupted deep research must be resumable from the chat UI");
assert.ok(source.includes("证据账本"), "deep-research answers must expose their evidence ledger");

console.log("Sidebar shortcuts and layout contract passed.");
