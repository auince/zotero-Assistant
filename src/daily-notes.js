/* global Zotero, ResearchAgentStorage, ResearchAgentTools */

var ResearchAgentDailyNotes = {
  async runIfDue() {
    if (!Zotero.Prefs.get("extensions.researchAgent.dailyNotesEnabled", true)) return;
    const day = this.dayKey(new Date());
    const state = await ResearchAgentStorage.getState();
    if (state.lastConversationNoteSweepDay === day) return;
    await this.refreshChangedNotes();
    state.lastConversationNoteSweepDay = day;
    await ResearchAgentStorage.saveState(state);
  },

  async runNow() {
    const result = await this.refreshChangedNotes();
    return result.updated ? `已更新 ${result.updated} 篇会话笔记。` : "没有会话内容变动，无需更新笔记。";
  },

  dayKey(date) {
    const offset = date.getTimezoneOffset() * 60000;
    return new Date(date - offset).toISOString().slice(0, 10);
  },

  async refreshChangedNotes() {
    const summaries = await ResearchAgentStorage.listConversations();
    let updated = 0;
    for (const summary of summaries) {
      const existing = await ResearchAgentStorage.getNoteForConversation(summary.id);
      if (existing?.sourceUpdatedAt && existing.sourceUpdatedAt >= summary.updatedAt) continue;
      const conversation = await ResearchAgentStorage.getConversation(summary.id);
      if (await this.createConversationNote(conversation)) updated++;
    }
    return { updated };
  },

  sessionEntries(conversation) {
    if (!conversation?.messages?.length) return [];
    const entries = [];
    for (let index = 0; index < conversation.messages.length; index++) {
      const message = conversation.messages[index];
      if (message.role !== "user") continue;
      const answer = conversation.messages.slice(index + 1).find((candidate) => candidate.role === "assistant");
      if (!answer) continue;
      entries.push({
        at: answer.createdAt || message.createdAt,
        question: message.content,
        answer: answer.content,
        citations: answer.citations || [],
        paper: conversation.paper || null
      });
    }
    return entries;
  },

  async createConversationNote(conversation) {
    const entries = this.sessionEntries(conversation);
    if (!entries.length) return null;
    const digest = await this.summarize(entries, conversation);
    const cited = this.collectPapers(entries);
    const markdown = [
      `# ${digest.title}`,
      "",
      `关联会话：${conversation.title || "未命名会话"}`,
      conversation.paper?.title ? `关联文献：${conversation.paper.key ? `[${conversation.paper.key}] ` : ""}${conversation.paper.title}` : "关联文献：未关联",
      `会话最后更新：${conversation.updatedAt || "未知"}`,
      `笔记刷新：${new Date().toISOString()}`,
      "",
      "> 本笔记随该会话内容变化而每日检查更新。关注点是可检验的暂定观察，不是对用户意图或能力的断言；所有推断都应回到对话与论文线索复核。",
      "",
      "## 当前研究主线",
      digest.thread,
      "",
      "## 关注点假设（暂定）",
      ...this.focusLines(digest.focuses),
      "",
      "## 明确提出的问题",
      ...this.lines(digest.questions, "- 当日对话未留下可独立追踪的问题。"),
      "",
      "## 已形成的判断",
      ...this.lines(digest.insights, "- 尚无足够证据形成稳定判断。"),
      "",
      "## 未解张力与证据缺口",
      ...this.lines(digest.tensions, "- 目前没有清晰记录的冲突；下次可刻意寻找反例或边界条件。"),
      "",
      "## 下一步可验证行动",
      ...this.numberedLines(digest.nextSteps, "为其中一个问题写出可验证的假设、所需证据与最小下一步。"),
      "",
      "## 延展性反问",
      ...this.lines(digest.provocations, "- 若当前假设相反，哪条观察最可能首先推翻它？"),
      "",
      "## 提及的论文",
      ...(cited.length ? cited.map((citation) => `- ${citation}`) : ["- 当日对话未关联 Zotero 文献。"]),
      "",
      "## 对话脉络摘要",
      digest.digest,
      ""
    ].join("\n");
    const existing = await ResearchAgentStorage.getNoteForConversation(conversation.id);
    const filename = existing?.filename || `${conversation.id}-${this.slug(digest.title)}.md`;
    const path = await ResearchAgentStorage.writeNote(filename, markdown, {
      conversationID: conversation.id,
      sourceUpdatedAt: conversation.updatedAt,
      questionCount: digest.questions.length,
      insightCount: digest.insights.length,
      focusCount: digest.focuses.length,
      nextStepCount: digest.nextSteps.length,
      citations: cited
    });
    return { path, filename, title: digest.title };
  },

  collectPapers(entries) {
    const papers = [];
    for (const entry of entries) {
      if (entry.paper?.title) papers.push(entry.paper.key ? `[${entry.paper.key}] ${entry.paper.title}` : entry.paper.title);
      for (const citation of entry.citations || []) {
        if (citation.type === "zotero") papers.push(citation.label || citation.value);
      }
    }
    return [...new Set(papers.filter(Boolean))];
  },

  conversationText(entries, includeAnswers = true, maximumLength = 56000) {
    let length = 0;
    const blocks = [];
    for (const [index, entry] of entries.entries()) {
      const paper = entry.paper?.title ? `\n关联论文：${entry.paper.key ? `[${entry.paper.key}] ` : ""}${entry.paper.title}` : "";
      const answer = includeAnswers ? `\n助手回答：${this.clean(entry.answer)}` : "";
      const block = `会话 ${index + 1}${paper}\n用户问题：${this.clean(entry.question)}${answer}`;
      if (length + block.length > maximumLength) break;
      blocks.push(block);
      length += block.length;
    }
    return blocks.join("\n\n");
  },

  async summarize(entries, conversation) {
    const fallback = this.fallbackDigest(entries);
    const apiKey = Zotero.Prefs.get("extensions.researchAgent.deepseekAPIKey", true);
    if (!apiKey) return fallback;
    const transcript = this.conversationText(entries);
    try {
      const raw = await ResearchAgentTools.request("POST", `${(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash",
          temperature: 0.25,
          messages: [{
            role: "system",
            content: `你是严谨的研究笔记编辑，而非泛泛总结器。将一个持续研究会话转化为一份简练、有助于下一轮研究的中文 Markdown 笔记素材。\n\n核心原则：\n1. 区分用户明确提出的问题、对话支持的判断、以及对用户关注点的暂定推断。不能把助手的建议误写成用户立场，也不能进行心理诊断。\n2. 关注点必须附一条来自问题、反复出现主题或关联论文的简短依据，并标注高/中/低置信度；最多 3 条。\n3. 用主题综合而不是逐问复述；指出真正的冲突、证据缺口、假设或边界条件，最多 3 条。\n4. 下一步必须是可执行、可验证且尽量具体的研究动作，最多 3 条；延展性反问应挑战当前假设或连接相邻主题，最多 2 条。\n5. 题目应有代表性，优先使用“对象 + 张力/行动”，不超过 18 个中文字符。所有字段都要简练，不能虚构论文、实验、引用或用户偏好。\n\n仅输出合法 JSON，不要使用 Markdown 围栏：\n{\n  "title":"",\n  "thread":"一句话概括该会话的研究主线与当前阶段",\n  "focuses":[{"focus":"暂定关注点","evidence":"来自对话的简短依据","confidence":"高|中|低"}],\n  "questions":["用户明确提出的问题"],\n  "insights":["得到的判断，必要时带限定"],\n  "tensions":["未解冲突、证据缺口或待检验假设"],\n  "nextSteps":["最小可验证的下一步"],\n  "provocations":["能推动进一步思考的反问"],\n  "digest":"不超过 120 字的会话脉络摘要"\n}`
          }, {
            role: "user",
            content: `会话标题：${conversation.title || "未命名会话"}\n关联论文：${conversation.paper?.title || "未关联"}\n会话最后更新：${conversation.updatedAt || "未知"}\n\n【完整会话】\n${transcript}`
          }],
          response_format: { type: "json_object" }
        })
      });
      return this.normaliseDigest(this.parseJSON(JSON.parse(raw).choices?.[0]?.message?.content), fallback);
    } catch (error) {
      Zotero.logError(error);
      return fallback;
    }
  },

  parseJSON(content) {
    const text = String(content || "").trim().replace(/^```(?:json)?\s*|\s*```$/g, "");
    return JSON.parse(text);
  },

  normaliseDigest(value, fallback) {
    if (!value || typeof value !== "object") return fallback;
    const list = (items, limit) => Array.isArray(items) ? items.map((item) => this.clean(item)).filter(Boolean).slice(0, limit) : [];
    const focuses = Array.isArray(value.focuses) ? value.focuses.map((item) => ({
      focus: this.clean(item?.focus),
      evidence: this.clean(item?.evidence),
      confidence: ["高", "中", "低"].includes(this.clean(item?.confidence)) ? this.clean(item.confidence) : "低"
    })).filter((item) => item.focus && item.evidence).slice(0, 3) : [];
    const digest = {
      title: this.clean(value.title).slice(0, 40),
      thread: this.clean(value.thread),
      focuses,
      questions: list(value.questions, 4),
      insights: list(value.insights, 4),
      tensions: list(value.tensions, 3),
      nextSteps: list(value.nextSteps, 3),
      provocations: list(value.provocations, 2),
      digest: this.clean(value.digest).slice(0, 260)
    };
    return {
      title: digest.title || fallback.title,
      thread: digest.thread || fallback.thread,
      focuses: digest.focuses.length ? digest.focuses : fallback.focuses,
      questions: digest.questions.length ? digest.questions : fallback.questions,
      insights: digest.insights.length ? digest.insights : fallback.insights,
      tensions: digest.tensions.length ? digest.tensions : fallback.tensions,
      nextSteps: digest.nextSteps.length ? digest.nextSteps : fallback.nextSteps,
      provocations: digest.provocations.length ? digest.provocations : fallback.provocations,
      digest: digest.digest || fallback.digest
    };
  },

  fallbackDigest(entries) {
    const questions = entries.map((entry) => this.clean(entry.question)).filter(Boolean).slice(0, 4);
    const first = questions[0] || "当日研究问题";
    return {
      title: this.fallbackTitle(first),
      thread: `该会话围绕“${this.fallbackTitle(first)}”展开；目前应把结论视为待继续验证的工作线索。`,
      focuses: [{ focus: this.fallbackTitle(first), evidence: `来自用户问题：“${first.slice(0, 72)}”`, confidence: "低" }],
      questions,
      insights: entries.map((entry) => this.clean(entry.answer)).filter(Boolean).slice(0, 3),
      tensions: ["当前离线摘要无法可靠判断证据冲突；下次请明确记录支持与反驳各自依赖的证据。"],
      nextSteps: ["选择一个问题，写下可被文献、实验或实现结果证伪的最小假设。"],
      provocations: ["如果当前问题的隐含前提不成立，最先需要重新检查的概念或证据是什么？"],
      digest: `已沉淀 ${entries.length} 段研究对话；笔记保留了问题、关联论文和待验证的下一步。`
    };
  },

  focusLines(focuses) {
    return focuses.length ? focuses.map((item) => `- **${item.focus}**（置信：${item.confidence}）——依据：${item.evidence}`) : ["- 暂无足够对话证据形成稳定的关注点假设。"];
  },

  lines(items, fallback) {
    return items.length ? items.map((item) => `- ${item}`) : [fallback];
  },

  numberedLines(items, fallback) {
    const values = items.length ? items : [fallback];
    return values.map((item, index) => `${index + 1}. ${item}`);
  },

  clean(value) {
    return String(value || "").replace(/\s+/g, " ").trim();
  },

  fallbackTitle(question) {
    return this.clean(question).replace(/[?？].*$/, "").slice(0, 56) || "研究线索";
  },

  slug(title) {
    return this.clean(title).toLowerCase().replace(/[^a-z0-9\u4e00-\u9fff]+/g, "-").replace(/^-+|-+$/g, "").slice(0, 50) || "research-note";
  }
};
