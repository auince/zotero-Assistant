const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");
const { execFileSync } = require("node:child_process");

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
  assert.match(reproduction.piPrompt(session, "run tests"), /禁止 conda create\/install/, "project dependencies must not be installed in global Conda environments");
  const quoted = reproduction.shellQuote("project's source; $(false)");
  assert.equal(execFileSync("/bin/sh", ["-c", `printf '%s' ${quoted}`], { encoding: "utf8" }), "project's source; $(false)", "shell escaping must preserve literal quotes and metacharacters");
  for (const invalid of ["https://example.com/..", "https://example.com/.git"]) assert.throws(() => reproduction.projectName(invalid));
  const originalSSH = reproduction.runSSH;
  let workspaceCommand = "";
  reproduction.runSSH = async (config, command) => { workspaceCommand = command; return {stdout: "project_venv: /data/reproductions/repro/.venv", stderr: "", exitCode: 0}; };
  await reproduction.prepareWorkspace(session);
  execFileSync("/bin/sh", ["-n", "-c", workspaceCommand]);
  assert.match(workspaceCommand, /python3 -m venv \.venv/, "each workspace must create a project-local venv");
  assert.equal(session.workspaceReady, true, "Pi should run only after workspace environment preparation");
  reproduction.runSSH = originalSSH;
  let sshOptions;
  let helperText;
  let helperMode;
  context.Zotero.File = {putContentsAsync: async (_, content) => { helperText = content; }};
  context.IOUtils = {setPermissions: async (_, mode) => { helperMode = mode; }};
  context.ResearchAgentStorage.root = "/tmp/test-research-agent";
  context.ResearchAgentStorage.initialize = async () => {};
  context.ResearchAgentStorage.join = (...parts) => parts.join("/");
  context.ResearchAgentCredentials = {getPassword: async () => "test-password-sentinel"};
  const emptyPipe = () => ({readString: async () => ""});
  context.ChromeUtils.importESModule = () => ({Subprocess: {
    pathSearch: async () => "/usr/bin/ssh",
    call: async (options) => { sshOptions = options; return {stdin: {close: async () => {}}, stdout: emptyPipe(), stderr: emptyPipe(), wait: async () => ({exitCode: 0})}; }
  }});
  await reproduction.runSSH({host: "example.com", port: 2222, username: "researcher", authType: "password"}, "true", "test-task");
  assert.ok(sshOptions.arguments.includes("2222") && sshOptions.arguments.includes("researcher"), "non-default port and username must reach ssh");
  assert.ok(sshOptions.arguments.includes("StrictHostKeyChecking=yes"), "password login must not bypass host-key verification");
  assert.ok(!sshOptions.arguments.join(" ").includes("test-password-sentinel"), "password must not appear in process arguments");
  assert.ok(!helperText.includes("test-password-sentinel"), "askpass helper must not contain the actual password");
  assert.equal(helperMode, 0o700, "askpass helper must be private and executable");
  const parsed = reproduction.parsePiEvents('{"type":"session_start","sessionFile":"/tmp/pi.jsonl"}\n{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n{"type":"agent_settled"}');
  assert.equal(parsed.answer, "done", "Pi JSON events must become a readable response");
  assert.equal(parsed.sessionRef, "/tmp/pi.jsonl", "Pi session references must persist for the next turn");
  assert.ok(saved.length >= 2, "reproduction state must be stored locally");
  console.log("Remote reproduction contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
