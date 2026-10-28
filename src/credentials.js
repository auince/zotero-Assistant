/* global ChromeUtils, Services, Components */

// Passwords never belong in preferences, conversation JSON, or model context.
// Let Gecko's login manager own encryption and the profile credential lifetime.
var ResearchAgentCredentials = {
  realm: "Research Agent SSH",

  identity(config) {
    return { origin: `ssh://${config.host}:${config.port || 22}`, username: config.username || "" };
  },

  manager() {
    if (typeof Services !== "undefined") return Services.logins;
    return Components.classes["@mozilla.org/login-manager;1"].getService(Components.interfaces.nsILoginManager);
  },

  async getPassword(config) {
    const { origin, username } = this.identity(config);
    const logins = await this.manager().findLogins(origin, null, this.realm);
    return logins.find((login) => login.username === username)?.password || "";
  },

  async savePassword(config, password) {
    if (!password) throw new Error("请输入服务器密码。");
    const { origin, username } = this.identity(config);
    const manager = this.manager();
    const { nsLoginInfo } = ChromeUtils.importESModule("resource://gre/modules/LoginInfo.sys.mjs");
    const login = new nsLoginInfo();
    login.init(origin, null, this.realm, username, password, "", "");
    const existing = (await manager.findLogins(origin, null, this.realm)).find((entry) => entry.username === username);
    if (existing) await manager.modifyLogin(existing, login);
    else await manager.addLoginAsync(login);
  },

  async forgetPassword(config) {
    const { origin, username } = this.identity(config);
    const manager = this.manager();
    for (const login of await manager.findLogins(origin, null, this.realm)) {
      if (login.username === username) await manager.removeLogin(login);
    }
  }
};
