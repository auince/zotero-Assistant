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
  // Feed a non-interactive Bash parser through stdin. If no-exec is ever
  // ignored, the leading exit stops before ANY generated workspace command.
  const checkShellSyntax = (source) => execFileSync("/bin/bash", ["--noprofile", "--norc", "-n"], { input: `exit 98\n${source}\n`, env: { PATH: "/usr/bin:/bin" } });
  checkShellSyntax(workspaceCommand);
  assert.match(workspaceCommand, /python3 -m venv \.venv/, "each workspace must create a project-local venv");
  assert.equal(session.workspaceReady, true, "Pi should run only after workspace environment preparation");
  assert.match(workspaceCommand, /timeout 120 git/, "Git network operations must have a deadline");
  assert.match(workspaceCommand, /http.version=HTTP\/1.1/, "Git transport must use the server-tested compatibility mode without changing global config");
  const savedArchive = reproduction.prepareGitHubArchive;
  let fallbackCalls = 0;
  reproduction.runSSH = async () => {throw new Error("Cloning into project: Connection timed out");};
  reproduction.prepareGitHubArchive = async () => {fallbackCalls++; return {stdout: "official snapshot"};};
  await reproduction.prepareWorkspace(session);
  assert.equal(fallbackCalls, 1, "public GitHub clone transport failures should try the official archive, not an unknown mirror");
  reproduction.prepareGitHubArchive = savedArchive;
  reproduction.runSSH = async (config, command) => { workspaceCommand = command; return {stdout: "official_source_commit:test", stderr: "", exitCode: 0}; };
  await reproduction.prepareGitHubArchive(session, reproduction.configuration(), "example", "repro");
  checkShellSyntax(workspaceCommand);
  assert.match(workspaceCommand, /codeload.github.com/, "archive fallback must download from the official upstream host");
  assert.match(workspaceCommand, /upstreamCommit/, "snapshot mode must retain the upstream commit and not impersonate Git history");
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
  const files = new Map();
  const cleaned = [];
  const env = new Map([["SSH_ASKPASS", "original-helper"]]);
  const previousEnvironment = new Map(env);
  let nativeArgs;
  context.setTimeout = setTimeout;
  context.Zotero.isMac = true;
  context.Zotero.File = {
    createDirectoryIfMissingAsync: async () => {},
    putContentsAsync: async (path, value) => files.set(path, value),
    getContentsAsync: async (path) => files.get(path) || "",
    pathToFile: (path) => ({path})
  };
  context.IOUtils.remove = async (path) => {cleaned.push(path); files.delete(path);};
  context.Services = {env: {exists: (key) => env.has(key), get: (key) => env.get(key) || "", set: (key, value) => value ? env.set(key, value) : env.delete(key)}};
  const native = {
    exitValue: 0, init: (file) => assert.equal(file.path, "/bin/sh"),
    runwAsync: (args, length, observer) => {
      nativeArgs = args;
      assert.equal(length, args.length);
      assert.equal(env.get("RESEARCH_AGENT_SSH_PASSWORD"), "test-password-sentinel");
      setTimeout(() => { files.set(args[1], "connected\n"); observer.observe(null, "process-finished"); }, 1);
    }
  };
  context.Components = {classes: {"@mozilla.org/process/util;1": {createInstance: () => native}}, interfaces: {nsIProcess: {}}};
  const nativeResult = await reproduction.runSSH({host: "example.com", port: 2222, username: "researcher", authType: "password"}, "true", "native-test");
  assert.equal(nativeResult.stdout, "connected\n", "macOS must use Zotero native process launching and capture output");
  assert.equal(nativeArgs[3], "/usr/bin/ssh");
  assert.deepEqual(env, previousEnvironment, "Zotero environment must be restored immediately after launch");
  assert.ok([...files.values()].every((value) => !value.includes("test-password-sentinel")), "native launch must not write any credential file");
  assert.equal(cleaned.length, 2, "temporary native output files must be cleaned after completion");
  const parsed = reproduction.parsePiEvents('{"type":"session_start","sessionFile":"/tmp/pi.jsonl"}\n{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"done"}}\n{"type":"agent_settled"}');
  assert.equal(parsed.answer, "done", "Pi JSON events must become a readable response");
  assert.equal(parsed.sessionRef, "/tmp/pi.jsonl", "Pi session references must persist for the next turn");
  const failure = reproduction.parsePiEvents('{"type":"message_end","message":{"role":"assistant","content":[],"stopReason":"error","errorMessage":"Missing model credentials"}}\n{"type":"agent_settled","aborted":false}\n');
  assert.match(failure.error, /Missing model credentials/, "Pi provider errors must not be reported as successful reproduction");
  const final = reproduction.parsePiEvents('{"type":"message_end","message":{"role":"user","content":"not assistant output"}}\n{"type":"message_end","message":{"role":"assistant","content":[{"type":"text","text":"verified result"}],"stopReason":"stop"}}\n{"type":"agent_settled","aborted":false}\n');
  assert.equal(final.answer, "verified result", "completed assistant text blocks are authoritative; user echoes are not answers");
  assert.equal(final.settled, true);
  const firstDelta = reproduction.parsePiEvents('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"first "}}\n');
  const secondDelta = reproduction.parsePiEvents('{"type":"message_update","assistantMessageEvent":{"type":"text_delta","delta":"second"}}\n', firstDelta);
  assert.equal(secondDelta.answer, "first second", "Pi incremental parsing must process only newly completed JSONL records");
  assert.ok(saved.length >= 2, "reproduction state must be stored locally");
  console.log("Remote reproduction contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
