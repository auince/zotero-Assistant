const assert = require("node:assert/strict");
const fs = require("node:fs");

const storage = fs.readFileSync("src/storage.js", "utf8");
const dailyNotes = fs.readFileSync("src/daily-notes.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(storage.includes("notes-index.json"), "notes need a persistent metadata index");
assert.ok(storage.includes("listNotes()"), "notes page needs to list local notes");
assert.ok(storage.includes("getNoteForConversation(conversationID)"), "notes must map persistently to their source conversation");
assert.ok(storage.includes("openNotesDirectory()"), "notes page must open the local notes directory");
assert.ok(dailyNotes.includes("refreshChangedNotes()"), "daily processing must only scan changed conversations");
assert.ok(dailyNotes.includes("sourceUpdatedAt"), "note refreshes must be tied to the source conversation timestamp");
assert.ok(dailyNotes.includes("createConversationNote(conversation)"), "one note must be generated for one conversation");
assert.ok(dailyNotes.includes("关注点假设（暂定）"), "notes must include evidence-backed inferred focuses");
assert.ok(dailyNotes.includes("下一步可验证行动"), "notes must propose concrete next research actions");
assert.ok(dailyNotes.includes("延展性反问"), "notes must contain prompts for further thinking");
assert.ok(sidebar.includes('"笔记"'), "the sidebar must expose a notes tab");
assert.ok(sidebar.includes("会话研究笔记"), "notes page must have a dedicated manager");
assert.ok(sidebar.includes("复制当前笔记"), "notes page must support copying the selected note");

console.log("Notes management contract passed.");
