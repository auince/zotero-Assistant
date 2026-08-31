const assert = require("node:assert/strict");
const fs = require("node:fs");

const storage = fs.readFileSync("src/storage.js", "utf8");
const sidebar = fs.readFileSync("src/sidebar.js", "utf8");

assert.ok(storage.includes("async deleteConversation(id)"), "conversation storage needs a deletion operation");
assert.ok(storage.includes("file.remove(false)"), "conversation deletion must remove its dedicated local file");
assert.ok(storage.includes("index.conversations.splice(position, 1)"), "conversation deletion must remove its index entry");
assert.ok(sidebar.includes('"删除会话"'), "session cards need a visible delete action");
assert.ok(sidebar.includes("确定删除会话"), "deleting a session must require confirmation");
assert.ok(sidebar.includes("已生成的研究笔记会保留"), "deleting chat history must not silently destroy notes");
assert.ok(sidebar.includes("if (state.active?.id === id)"), "deleting the active session must select a safe replacement");

console.log("Conversation deletion contract passed.");
