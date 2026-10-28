const assert = require("node:assert/strict");
const fs = require("node:fs");
const vm = require("node:vm");

const logins = [];
const manager = {
  findLogins: (origin, _, realm) => logins.filter((entry) => entry.origin === origin && entry.realm === realm),
  addLoginAsync: async (login) => logins.push(login),
  modifyLogin: (previous, next) => logins.splice(logins.indexOf(previous), 1, next),
  removeLogin: (login) => logins.splice(logins.indexOf(login), 1)
};
class LoginInfo {
  init(origin, _, realm, username, password) { Object.assign(this, { origin, realm, username, password }); }
}
const context = { Services: { logins: manager }, ChromeUtils: { importESModule: () => ({ nsLoginInfo: LoginInfo }) } };
vm.createContext(context);
vm.runInContext(fs.readFileSync("src/credentials.js", "utf8"), context);
(async () => {
  const credentials = context.ResearchAgentCredentials;
  const server = {host: "example.com", port: 2222, username: "researcher"};
  await credentials.savePassword(server, "test-sentinel-not-a-real-password");
  assert.equal(await credentials.getPassword(server), "test-sentinel-not-a-real-password");
  assert.equal(await credentials.getPassword({...server, port: 22}), "", "credentials must be scoped by host, port, and user");
  await credentials.savePassword(server, "replacement-test-sentinel");
  assert.equal(logins.length, 1, "saving again must replace only the exact login");
  await credentials.forgetPassword(server);
  assert.equal(await credentials.getPassword(server), "");
  const prefs = fs.readFileSync("prefs.xhtml", "utf8");
  assert.match(prefs, /id="ra-reproduction-ssh-password"[^>]*type="password"/);
  assert.ok(!/id="ra-reproduction-ssh-password"[^>]*preference=/.test(prefs), "password must never bind to plaintext preferences");
  console.log("Server credentials contract passed.");
})().catch((error) => { console.error(error); process.exitCode = 1; });
