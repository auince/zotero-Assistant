/* global Zotero */

var ResearchAgentDailyNotes = {
  async runIfDue() {
    if (!Zotero.Prefs.get("extensions.researchAgent.dailyNotesEnabled", true)) return;
    const yesterday = new Date(Date.now() - 24 * 60 * 60 * 1000);
    const day = this.dayKey(yesterday);
    const state = await ResearchAgentStorage.getState();
    if (state.processedDays[day]) return;
    const note = await this.create(day);
    if (note) {
      state.processedDays[day] = new Date().toISOString();
      await ResearchAgentStorage.saveState(state);
    }
  },

  async runNow() {
    const day = this.dayKey(new Date());
    const note = await this.create(day);
    return note ? `已更新笔记：${note.path}` : "今天还没有可沉淀的完整对话。";
  },

  dayKey(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date - offset).toISOString().slice(0, 10);
  },

  async create(day) {
    const entries = (await ResearchAgentStorage.getConversations()).filter((entry) => entry.at?.slice(0, 10) === day);
    if (!entries.length) return null;
    const digest = await this.summarize(entries, day);
    const cited = [...new Set(entries.flatMap((entry) => entry.citations || []).filter((citation) => citation.type === "zotero").map((citation) => citation.label || citation.value))];
    const markdown = [
      `# ${digest.title}`,
      "",
      `日期：${day}`,
      "",
      "## 今日问题",
      ...digest.questions.map((question) => `- ${question}`),
      "",
      "## 思考与结论",
      ...digest.insights.map((insight) => `- ${insight}`),
      "",
      "## 提及的论文",
      ...(cited.length ? cited.map((citation) => `- ${citation}`) : ["- 当日对话未引用 Zotero 文献。"]),
      "",
      "## 对话摘要",
      digest.digest,
      ""
    ].join("\n");
    const existing = await ResearchAgentStorage.getNoteForDay(day);
    const filename = existing?.filename || `${day}-${this.slug(digest.title)}.md`;
    const path = await ResearchAgentStorage.writeNote(filename, markdown, {
      day,
      questionCount: digest.questions.length,
      insightCount: digest.insights.length,
      citations: cited
    });
    return { path, filename, title: digest.title };
  },

  async summarize(entries, day) {
    const fallback = {
      title: this.fallbackTitle(entries[0].question),
      questions: entries.map((entry) => this.clean(entry.question)).slice(0, 6),
      insights: entries.map((entry) => this.clean(entry.answer)).slice(0, 4),
      digest: `已沉淀 ${entries.length} 段研究对话；请结合上方问题、结论与引用论文继续追踪。`
    };
    const apiKey = Zotero.Prefs.get("extensions.researchAgent.deepseekAPIKey", true);
    if (!apiKey) return fallback;
    const transcript = entries.map((entry, index) => `Conversation ${index + 1}\nQuestion: ${entry.question}\nAnswer: ${entry.answer}`).join("\n\n").slice(0, 50000);
    try {
      const raw = await ResearchAgentTools.request("POST", `${(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash",
          temperature: 0.1,
          messages: [{
            role: "system",
            content: "将以下研究对话沉淀为简洁、可检索的中文笔记。仅返回 JSON：title（代表性标题，不超过 18 个中文字符或 12 个英文单词）、questions（最多 5 条简短问题）、insights（最多 5 条简短思考或结论）、digest（最多 120 字）。保留不确定性、证据边界与未解决问题；不得虚构事实。"
          }, { role: "user", content: `Date: ${day}\n\n${transcript}` }],
          response_format: { type: "json_object" }
        })
      });
      const content = JSON.parse(raw).choices?.[0]?.message?.content;
      const digest = JSON.parse(content);
      if (!digest.title || !Array.isArray(digest.questions) || !Array.isArray(digest.insights)) return fallback;
      return { title: this.clean(digest.title), questions: digest.questions.map(this.clean).filter(Boolean), insights: digest.insights.map(this.clean).filter(Boolean), digest: this.clean(digest.digest) };
    } catch (error) {
      Zotero.logError(error);
      return fallback;
    }
  },

  clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  },

  fallbackTitle(question) {
    return this.clean(question).replace(/[?？].*$/, "").slice(0, 56) || "Research questions";
  },

  slug(title) {
    return this.clean(title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "research-note";
  }
};
