/* global Zotero, ResearchAgentTools */

var ResearchAgentMemory = {
  systemOverhead: 1800,

  limit() {
    return Number(Zotero.Prefs.get("extensions.researchAgent.contextWindowTokens", true)) || 360000;
  },

  estimateTokens(text) {
    const value = String(text || "");
    const cjk = (value.match(/[\u3400-\u9fff\uf900-\ufaff]/g) || []).length;
    const latin = value.length - cjk;
    return Math.ceil(cjk * 1.15 + latin / 3.8);
  },

  activeMessages(conversation) {
    const compressed = new Set(conversation.memory?.compressedMessageIDs || []);
    return (conversation.messages || []).filter((message) => !compressed.has(message.id));
  },

  contextUsage(conversation, pending = "") {
    const memory = conversation.memory || {};
    const active = this.activeMessages(conversation).map((message) => message.content).join("\n");
    return this.systemOverhead + this.estimateTokens(`${memory.rootSummary || ""}\n${active}\n${pending}`);
  },

  remaining(conversation, pending = "") {
    return this.limit() - this.contextUsage(conversation, pending);
  },

  async prepare(conversation, question, apiKey, onEvent) {
    conversation.memory ||= { rootSummary: "", layers: [], compressedMessageIDs: [] };
    if (this.contextUsage(conversation) > this.limit()) {
      this.emit(onEvent, `会话上下文超过 ${this.limit().toLocaleString()} token，正在创建分层摘要记忆…`);
      await this.compress(conversation, apiKey, onEvent);
    }
    const memory = conversation.memory;
    const recalled = this.retrieve(memory.layers || [], question, 8);
    const memoryText = [
      memory.rootSummary ? `长期摘要：\n${memory.rootSummary}` : "",
      recalled.length ? `与当前问题最相关的分层记忆：\n${recalled.map((layer, index) => `${index + 1}. ${layer.summary}`).join("\n")}` : ""
    ].filter(Boolean).join("\n\n");
    const messages = [{ role: "system", content: "你正在使用一个持久化研究会话。长期记忆和分层检索结果是历史摘要，不是新的事实；如与当前消息冲突，以当前消息为准。" }];
    if (memoryText) messages.push({ role: "system", content: memoryText });
    messages.push(...this.activeMessages(conversation).map((message) => ({ role: message.role, content: message.content })));
    return messages;
  },

  async compress(conversation, apiKey, onEvent) {
    const active = this.activeMessages(conversation);
    const target = Math.floor(this.limit() * 0.34);
    let kept = [];
    let used = this.systemOverhead + this.estimateTokens(conversation.memory.rootSummary || "");
    for (let index = active.length - 1; index >= 0; index--) {
      const tokens = this.estimateTokens(active[index].content);
      if (used + tokens > target) break;
      kept.unshift(active[index]);
      used += tokens;
    }
    const toCompress = active.slice(0, Math.max(0, active.length - kept.length));
    if (!toCompress.length) return;
    const groups = this.chunkMessages(toCompress, 48000);
    const summaries = [];
    for (const group of groups) {
      const summary = await this.summarize(group, apiKey);
      summaries.push({
        id: `memory-${Date.now().toString(36)}-${summaries.length}`,
        summary,
        sourceMessageIDs: group.map((message) => message.id),
        from: group[0].createdAt,
        to: group.at(-1).createdAt,
        tokenEstimate: this.estimateTokens(summary)
      });
      this.emit(onEvent, `已压缩 ${group.length} 条历史消息`);
    }
    conversation.memory.layers.push(...summaries);
    conversation.memory.compressedMessageIDs.push(...toCompress.map((message) => message.id));
    if (conversation.memory.layers.length > 10 || this.estimateTokens(conversation.memory.layers.map((layer) => layer.summary).join("\n")) > 26000) {
      conversation.memory.rootSummary = await this.summarizeLayers(conversation.memory.layers, apiKey);
      // The root is the first hierarchy level; individual layers stay on disk for RAG recall.
      this.emit(onEvent, "已生成长期摘要，并保留分层记忆供按需检索。");
    }
  },

  chunkMessages(messages, maxChars) {
    const groups = [];
    let current = [];
    let length = 0;
    for (const message of messages) {
      const size = message.content.length + 80;
      if (current.length && length + size > maxChars) { groups.push(current); current = []; length = 0; }
      current.push(message);
      length += size;
    }
    if (current.length) groups.push(current);
    return groups;
  },

  async summarize(messages, apiKey) {
    const transcript = messages.map((message) => `${message.role === "user" ? "用户" : "助手"}：${message.content}`).join("\n\n");
    const fallback = this.extractive(transcript, 2600);
    if (!apiKey) return fallback;
    try {
      const raw = await ResearchAgentTools.request("POST", `${(Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/$/, "")}/chat/completions`, {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
        body: JSON.stringify({
          model: Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash",
          temperature: 0.1,
          messages: [
            { role: "system", content: "将以下研究对话压缩为可检索的会话记忆。保留问题、结论、证据、未解决事项、论文键和重要限定条件。不要虚构信息；使用简洁中文，最多 1000 字。" },
            { role: "user", content: transcript.slice(0, 48000) }
          ]
        })
      });
      return JSON.parse(raw).choices?.[0]?.message?.content?.trim() || fallback;
    } catch (error) {
      Zotero.logError(error);
      return fallback;
    }
  },

  async summarizeLayers(layers, apiKey) {
    const virtualMessages = layers.map((layer, index) => ({ role: "assistant", content: `记忆层 ${index + 1}：${layer.summary}` }));
    return this.summarize(virtualMessages, apiKey);
  },

  retrieve(layers, query, limit) {
    const terms = this.tokens(query);
    return layers.map((layer) => ({ layer, score: this.score(layer.summary, terms) }))
      .filter((entry) => entry.score > 0)
      .sort((a, b) => b.score - a.score)
      .slice(0, limit)
      .map((entry) => entry.layer);
  },

  tokens(text) {
    return [...new Set((String(text).toLowerCase().match(/[\p{L}\p{N}_-]{2,}/gu) || []))];
  },

  score(text, terms) {
    const haystack = String(text).toLowerCase();
    return terms.reduce((score, term) => score + (haystack.includes(term) ? 1 : 0), 0);
  },

  extractive(text, maxChars) {
    return String(text).replace(/\s+/g, " ").slice(0, maxChars);
  },

  emit(onEvent, text) {
    try { onEvent?.({ type: "memory", text }); } catch (error) { Zotero.logError(error); }
  }
};
