/* global Zotero, ResearchAgentMemory, ResearchAgentTools */

var ResearchAgentAgent = {
  systemPrompt: `You are a Zotero research agent. Use search_knowledge_base before making claims about the user's library. Use search_web for current external facts, search_arxiv for scholarly preprints, and search_github_code for implementation questions. Cite Zotero evidence as [item key] and external sources as Markdown links. Be concise, distinguish evidence from inference, and do not invent sources.`,

  async answer(question, { onEvent, conversation, rag } = {}) {
    const apiKey = Zotero.Prefs.get("extensions.researchAgent.deepseekAPIKey", true);
    if (!apiKey) throw new Error("请先在 Zotero 设置 → Research Agent 中填写对话模型 API 密钥。");
    const ragEnabled = rag ? Boolean(rag.enabled) : true;
    const tools = ResearchAgentTools.definitionsFor({ ragEnabled });
    let messages = [
      { role: "system", content: this.systemPrompt },
      { role: "user", content: question }
    ];
    if (conversation) {
      const memoryMessages = await ResearchAgentMemory.prepare(conversation, question, apiKey, onEvent);
      messages = [{ role: "system", content: this.systemPrompt }, ...memoryMessages];
    }
    if (ragEnabled) {
      messages.splice(1, 0, { role: "system", content: `知识库检索已启用。本地知识库证据只能来自用户选择的知识库（${rag?.knowledgeBaseTitle || "当前选择"}），不得把未选择的本地文献作为证据。此范围限制只适用于 search_knowledge_base；需要外部最新信息、预印本或源码时，可分别使用 search_web、search_arxiv、search_github_code，并在最终回答中明确标注外部来源。` });
    } else {
      if (!rag?.paperContext) throw new Error("未启用 RAG 时，请先在左侧选择一篇论文。 ");
      messages.splice(1, 0, { role: "system", content: `知识库与网络工具均已关闭。只分析下面这篇当前论文，不能引用或推断其外部内容：\n\n${rag.paperContext}` });
    }
    const citations = [];
    for (let step = 0; step < 8; step++) {
      const message = await this.completeStream(messages, apiKey, onEvent, tools);
      if (!message.tool_calls?.length) {
        const answer = message.content || "模型没有返回正文。";
        const result = { answer, citations: this.uniqueCitations(citations) };
        return result;
      }
      messages.push({ role: "assistant", content: message.content || "", tool_calls: message.tool_calls });
      for (const call of message.tool_calls) {
        let args;
        try { args = JSON.parse(call.function.arguments || "{}"); } catch (_) { args = {}; }
        this.emit(onEvent, { type: "tool-start", name: call.function.name, args });
        let result;
        try {
          result = await ResearchAgentTools.execute(call.function.name, args, { collectionIDs: rag?.collectionIDs || [], useSemantic: Boolean(rag?.useSemantic) });
          const found = this.extractCitations(call.function.name, result);
          citations.push(...found);
          this.emit(onEvent, { type: "tool-finish", name: call.function.name, args, count: Array.isArray(result) ? result.length : 0, citations: found });
        } catch (error) {
          result = { error: error.message };
          this.emit(onEvent, { type: "tool-error", name: call.function.name, args, error: error.message });
        }
        messages.push({ role: "tool", tool_call_id: call.id, content: JSON.stringify(result).slice(0, 24000) });
      }
    }
    throw new Error("助手在八个工具步骤后停止。请缩小问题范围后重试。");
  },

  async completeStream(messages, apiKey, onEvent, tools) {
    const baseURL = (Zotero.Prefs.get("extensions.researchAgent.deepseekBaseURL", true) || "https://api.deepseek.com").replace(/\/$/, "");
    const model = Zotero.Prefs.get("extensions.researchAgent.deepseekModel", true) || "deepseek-v4-flash";
    const state = { content: "", reasoning: "", toolCalls: [] };
    let received = 0;
    let buffer = "";
    let sawSSE = false;
    const readEvent = (event) => {
      const data = event.split(/\r?\n/).filter((line) => line.startsWith("data:")).map((line) => line.slice(5).trim()).join("\n");
      if (!data || data === "[DONE]") return;
      sawSSE = true;
      let packet;
      try { packet = JSON.parse(data); } catch (_) { return; }
      if (packet.error) throw new Error(`模型服务错误：${packet.error.message || JSON.stringify(packet.error)}`);
      const delta = packet.choices?.[0]?.delta || {};
      if (delta.reasoning_content) {
        state.reasoning += delta.reasoning_content;
        this.emit(onEvent, { type: "reasoning", text: delta.reasoning_content });
      }
      if (delta.content) {
        state.content += delta.content;
        this.emit(onEvent, { type: "content", text: delta.content });
      }
      for (const update of delta.tool_calls || []) {
        const index = update.index || 0;
        const call = state.toolCalls[index] ||= { id: "", type: "function", function: { name: "", arguments: "" } };
        call.id ||= update.id || "";
        call.type = update.type || call.type;
        if (update.function?.name) call.function.name += update.function.name;
        if (update.function?.arguments) call.function.arguments += update.function.arguments;
      }
    };
    const consume = (final = false) => {
      const blocks = buffer.split(/\r?\n\r?\n/);
      buffer = final ? "" : blocks.pop();
      for (const block of blocks) readEvent(block);
    };
    const payload = { model, messages, temperature: 0.2, stream: true };
    if (tools?.length) { payload.tools = tools; payload.tool_choice = "auto"; }
    const xhr = await Zotero.HTTP.request("POST", `${baseURL}/chat/completions`, {
      headers: { "Content-Type": "application/json", Authorization: `Bearer ${apiKey}` },
      body: JSON.stringify(payload),
      responseType: "text",
      timeout: 0,
      requestObserver: (request) => {
        request.onprogress = () => {
          const text = request.responseText || "";
          buffer += text.slice(received);
          received = text.length;
          consume();
        };
      }
    });
    const text = xhr.responseText || xhr.response || "";
    buffer += text.slice(received);
    consume(true);
    if (!sawSSE && text) {
      const response = JSON.parse(text);
      if (response.error) throw new Error(`模型服务错误：${response.error.message || JSON.stringify(response.error)}`);
      const message = response.choices?.[0]?.message || {};
      if (message.reasoning_content) this.emit(onEvent, { type: "reasoning", text: message.reasoning_content });
      if (message.content) this.emit(onEvent, { type: "content", text: message.content });
      return message;
    }
    return { role: "assistant", content: state.content, reasoning_content: state.reasoning, tool_calls: state.toolCalls.filter((call) => call.function.name) };
  },

  emit(onEvent, event) {
    try { onEvent?.(event); } catch (error) { Zotero.logError(error); }
  },

  extractCitations(tool, result) {
    if (!Array.isArray(result)) return [];
    if (tool === "search_knowledge_base") return result.map((item) => ({ type: "zotero", label: item.citation }));
    return result.map((item) => ({
      type: tool,
      label: item.title || item.repository || item.url,
      url: item.url
    })).filter((item) => item.label);
  },

  uniqueCitations(citations) {
    const seen = new Set();
    return citations.filter((citation) => {
      const key = `${citation.type}:${citation.url || citation.label}`;
      if (seen.has(key)) return false;
      seen.add(key);
      return true;
    });
  }
};
