/* global Services, Zotero */

Services.scriptloader.loadSubScript(`${ResearchAgentRootURI}vendor/katex/katex.min.js`);

for (const module of ["storage", "memory", "jobs", "semantic", "indexer", "tools", "agent", "daily-notes", "markdown", "sidebar"]) {
  Services.scriptloader.loadSubScript(`${ResearchAgentRootURI}src/${module}.js`);
}

var ResearchAgent = {
  id: "research-agent@zotero.example.com",
  rootURI: null,
  windows: new Set(),
  timer: null,

  async startup({ rootURI: pluginRootURI }) {
    this.rootURI = pluginRootURI;
    this.migrateDeprecatedDeepSeekModel();
    await Zotero.PreferencePanes.register({
      pluginID: this.id,
      label: "研究助手",
      image: this.rootURI + "icons/research-agent.png",
      src: this.rootURI + "prefs.xhtml",
      scripts: [this.rootURI + "prefs-ui.js"]
    });
    await ResearchAgentStorage.initialize();
    ResearchAgentSidebar.register(this.rootURI);
    this.timer = setInterval(() => ResearchAgentDailyNotes.runIfDue().catch(Zotero.logError), 60 * 60 * 1000);
    ResearchAgentDailyNotes.runIfDue().catch(Zotero.logError);
    Zotero.debug("Research Agent started");
  },

  migrateDeprecatedDeepSeekModel() {
    const baseURL = String(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com")
      .replace(/\/+$/, "")
      .replace(/\/v1$/, "");
    const model = Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true);
    // DeepSeek retired these aliases on 2026-07-24. Restrict the migration to
    // the official endpoint: a custom OpenAI-compatible provider may still use
    // similarly named models and must not be changed behind the user's back.
    if (baseURL === "https://api.deepseek.com" && ["deepseek-chat", "deepseek-reasoner"].includes(model)) {
      Zotero.Prefs.set("extensions.researchAgent.deepseekModel", "deepseek-v4-flash", true);
      Zotero.debug(`Research Agent migrated deprecated DeepSeek model ${model} to deepseek-v4-flash`);
    }
  },

  shutdown() {
    clearInterval(this.timer);
    ResearchAgentJobs.cancel();
    ResearchAgentSidebar.unregister();
    this.windows.clear();
  },

  onMainWindowLoad(window) {
    this.windows.add(window);
  },

  onMainWindowUnload(window) {
    this.windows.delete(window);
  }
};
