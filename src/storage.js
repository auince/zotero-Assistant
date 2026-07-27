/* global Zotero */

var ResearchAgentStorage = {
  root: null,
  indexPath: null,
  conversationsPath: null,
  conversationIndexPath: null,
  conversationsDirectoryPath: null,
  settingsPath: null,
  notesIndexPath: null,

  async initialize() {
    if (this.root) return;
    this.root = this.join(Zotero.DataDirectory.dir, "research-agent");
    this.indexPath = this.join(this.root, "knowledge-index.json");
    this.conversationsPath = this.join(this.root, "conversations.jsonl");
    this.conversationIndexPath = this.join(this.root, "conversation-index.json");
    this.conversationsDirectoryPath = this.join(this.root, "conversations");
    this.settingsPath = this.join(this.root, "state.json");
    this.notesIndexPath = this.join(this.root, "notes-index.json");
    await Zotero.File.createDirectoryIfMissingAsync(this.root);
    await Zotero.File.createDirectoryIfMissingAsync(this.conversationsDirectoryPath);
  },

  join(base, ...segments) {
    const file = Zotero.File.pathToFile(base).clone();
    for (const segment of segments) file.append(segment);
    return file.path;
  },

  async readJSON(path, fallback) {
    await this.initialize();
    try {
      return JSON.parse(await Zotero.File.getContentsAsync(path));
    } catch (error) {
      if (error.name === "NotFoundError" || /no such file/i.test(error.message)) return fallback;
      throw error;
    }
  },

  async writeJSON(path, value) {
    await this.initialize();
    await Zotero.File.putContentsAsync(path, JSON.stringify(value, null, 2));
  },

  async getIndex() {
    return this.readJSON(this.indexPath, { version: 1, updatedAt: null, collections: {}, articles: {}, chunks: [] });
  },

  async saveIndex(index) {
    index.updatedAt = new Date().toISOString();
    await this.writeJSON(this.indexPath, index);
  },

  conversationPath(id) {
    return this.join(this.conversationsDirectoryPath, `${id}.json`);
  },

  makeConversationID() {
    return `conversation-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 9)}`;
  },

  async getConversationIndex() {
    const index = await this.readJSON(this.conversationIndexPath, null);
    if (index) return index;
    const migrated = { version: 2, conversations: [] };
    await this.migrateLegacyConversations(migrated);
    await this.writeJSON(this.conversationIndexPath, migrated);
    return migrated;
  },

  async migrateLegacyConversations(index) {
    let entries = [];
    try { entries = (await Zotero.File.getContentsAsync(this.conversationsPath)).split("\n").filter(Boolean).map((line) => JSON.parse(line)); } catch (_) {}
    for (const entry of entries) {
      const conversation = this.newConversation({ title: this.titleFromText(entry.question), createdAt: entry.at });
      conversation.messages = [
        this.message("user", entry.question, entry.at),
        this.message("assistant", entry.answer, entry.at, { citations: entry.citations || [] })
      ];
      await this.saveConversation(conversation, index);
    }
  },

  newConversation({ title, item, createdAt } = {}) {
    const at = createdAt || new Date().toISOString();
    const conversation = {
      version: 2,
      id: this.makeConversationID(),
      title: title || "新对话",
      // Titles are derived from the associated paper and the conversation's first
      // question. A future manual rename UI can opt into `custom` explicitly.
      titleMode: "auto",
      createdAt: at,
      updatedAt: at,
      paper: item ? this.paperFromItem(item) : null,
      messages: [],
      memory: { rootSummary: "", layers: [], compressedMessageIDs: [] }
    };
    if (conversation.titleMode === "auto") conversation.title = this.autoTitle(conversation);
    return conversation;
  },

  paperFromItem(item) {
    const regular = item?.isRegularItem?.() ? item : item?.parentItem;
    if (!regular) return null;
    return { key: regular.key, itemID: regular.id, libraryID: regular.libraryID, title: regular.getField("title") || "未命名文献" };
  },

  message(role, content, createdAt, extra = {}) {
    return { id: `message-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 8)}`, role, content: String(content || ""), createdAt: createdAt || new Date().toISOString(), ...extra };
  },

  titleFromText(text, maximumLength = 34) {
    return String(text || "新对话").replace(/\s+/g, " ").trim().slice(0, maximumLength) || "新对话";
  },

  autoTitle(conversation) {
    const paperTitle = String(conversation.paper?.title || "").replace(/\s+/g, " ").trim();
    const firstQuestion = (conversation.messages || []).find((message) => message.role === "user")?.content;
    // Before the first question, the paper is the most useful and stable session name.
    if (!firstQuestion) return paperTitle || "新对话";
    const questionTitle = this.titleFromText(firstQuestion, paperTitle ? 28 : 42);
    if (!paperTitle) return questionTitle;
    if (questionTitle === paperTitle) return paperTitle;
    return `${this.titleFromText(paperTitle, 38)} · ${questionTitle}`;
  },

  refreshAutoTitle(conversation) {
    if (!conversation.titleMode || conversation.titleMode === "auto") {
      conversation.titleMode = "auto";
      conversation.title = this.autoTitle(conversation);
    }
  },

  async createConversation(options = {}) {
    const conversation = this.newConversation(options);
    await this.saveConversation(conversation);
    return conversation;
  },

  async saveConversation(conversation, suppliedIndex) {
    await this.initialize();
    conversation.updatedAt = new Date().toISOString();
    conversation.messages ||= [];
    conversation.memory ||= { rootSummary: "", layers: [], compressedMessageIDs: [] };
    this.refreshAutoTitle(conversation);
    await this.writeJSON(this.conversationPath(conversation.id), conversation);
    const index = suppliedIndex || await this.getConversationIndex();
    const summary = {
      id: conversation.id,
      title: conversation.title,
      createdAt: conversation.createdAt,
      updatedAt: conversation.updatedAt,
      paper: conversation.paper || null,
      messageCount: conversation.messages.length
    };
    const position = index.conversations.findIndex((entry) => entry.id === conversation.id);
    if (position === -1) index.conversations.push(summary); else index.conversations[position] = summary;
    await this.writeJSON(this.conversationIndexPath, index);
    return conversation;
  },

  async listConversations() {
    const index = await this.getConversationIndex();
    await this.migrateConversationTitles(index);
    return [...index.conversations].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
  },

  async migrateConversationTitles(index) {
    // Version 0.4.5 introduced paper-aware automatic titles. Reconcile existing
    // per-conversation files once, without altering their meaningful update time.
    if (index.titleSchemaVersion >= 2) return;
    for (const summary of index.conversations) {
      const conversation = await this.readJSON(this.conversationPath(summary.id), null);
      if (!conversation) continue;
      const previousTitle = conversation.title;
      const previousMode = conversation.titleMode;
      this.refreshAutoTitle(conversation);
      if (conversation.title !== previousTitle || conversation.titleMode !== previousMode) {
        await this.writeJSON(this.conversationPath(conversation.id), conversation);
      }
      summary.title = conversation.title;
      summary.paper = conversation.paper || null;
      summary.messageCount = (conversation.messages || []).length;
    }
    index.titleSchemaVersion = 2;
    await this.writeJSON(this.conversationIndexPath, index);
  },

  async getConversation(id) {
    if (!id) return null;
    return this.readJSON(this.conversationPath(id), null);
  },

  async appendMessage(conversation, role, content, extra = {}) {
    const message = this.message(role, content, null, extra);
    conversation.messages.push(message);
    await this.saveConversation(conversation);
    return message;
  },

  async updateMessage(conversation, id, content) {
    const message = conversation.messages.find((entry) => entry.id === id);
    if (!message) throw new Error("找不到需要编辑的消息。");
    message.content = String(content || "").trim();
    message.editedAt = new Date().toISOString();
    await this.saveConversation(conversation);
    return message;
  },

  async retractFrom(conversation, id) {
    const index = conversation.messages.findIndex((message) => message.id === id);
    if (index === -1) throw new Error("找不到需要撤回的消息。");
    conversation.messages.splice(index);
    conversation.memory = { rootSummary: "", layers: [], compressedMessageIDs: [] };
    await this.saveConversation(conversation);
  },

  async editAndRetractAfter(conversation, id, content) {
    const index = conversation.messages.findIndex((message) => message.id === id);
    if (index === -1) throw new Error("找不到需要编辑的消息。");
    conversation.messages[index].content = String(content || "").trim();
    conversation.messages[index].editedAt = new Date().toISOString();
    conversation.messages.splice(index + 1);
    // Any change to historical text invalidates summaries derived from it.
    conversation.memory = { rootSummary: "", layers: [], compressedMessageIDs: [] };
    await this.saveConversation(conversation);
    return conversation.messages[index];
  },

  async appendConversation(entry) {
    // Backward-compatible entry point used by older plugin versions.
    const conversation = await this.createConversation({ title: this.titleFromText(entry.question), createdAt: entry.at });
    await this.appendMessage(conversation, "user", entry.question, { createdAt: entry.at });
    await this.appendMessage(conversation, "assistant", entry.answer, { createdAt: entry.at, citations: entry.citations || [] });
  },

  async getConversations() {
    const entries = [];
    for (const summary of await this.listConversations()) {
      const conversation = await this.getConversation(summary.id);
      if (!conversation) continue;
      for (let index = 0; index < conversation.messages.length; index++) {
        const message = conversation.messages[index];
        if (message.role !== "user") continue;
        const answer = conversation.messages.slice(index + 1).find((candidate) => candidate.role === "assistant");
        if (answer) entries.push({ at: answer.createdAt || message.createdAt, question: message.content, answer: answer.content, citations: answer.citations || [] });
      }
    }
    return entries;
  },

  async getState() {
    return this.readJSON(this.settingsPath, { processedDays: {} });
  },

  async saveState(state) {
    await this.writeJSON(this.settingsPath, state);
  },

  notesDirectory() {
    return this.join(this.root, "notes");
  },

  async getNoteIndex() {
    await this.initialize();
    const index = await this.readJSON(this.notesIndexPath, null);
    if (index) return { version: 2, notes: index.notes || [] };
    const migrated = { version: 2, notes: [] };
    await this.migrateNoteIndex(migrated);
    await this.writeJSON(this.notesIndexPath, migrated);
    return migrated;
  },

  async migrateNoteIndex(index) {
    const notes = this.notesDirectory();
    const directory = Zotero.File.pathToFile(notes);
    if (!directory.exists()) return;
    const files = directory.directoryEntries;
    while (files.hasMoreElements()) {
      const file = files.getNext();
      if (!file.isFile() || !/\.md$/i.test(file.leafName)) continue;
      try {
        const content = await Zotero.File.getContentsAsync(file.path);
        index.notes.push(this.noteMetadata(file.leafName, content));
      } catch (error) { Zotero.logError(error); }
    }
  },

  noteMetadata(filename, content, metadata = {}) {
    const title = String(content || "").match(/^#\s+(.+)$/m)?.[1]?.trim() || filename.replace(/^\d{4}-\d{2}-\d{2}-/, "").replace(/\.md$/i, "");
    const day = metadata.day || filename.match(/^(\d{4}-\d{2}-\d{2})/)?.[1] || "";
    return {
      filename,
      day,
      title,
      updatedAt: metadata.updatedAt || new Date().toISOString(),
      conversationID: metadata.conversationID || "",
      sourceUpdatedAt: metadata.sourceUpdatedAt || "",
      questionCount: Number(metadata.questionCount) || 0,
      insightCount: Number(metadata.insightCount) || 0,
      focusCount: Number(metadata.focusCount) || 0,
      nextStepCount: Number(metadata.nextStepCount) || 0,
      citations: metadata.citations || []
    };
  },

  async listNotes({ includeLegacy = false } = {}) {
    const index = await this.getNoteIndex();
    const sessionNotes = index.notes.filter((note) => note.conversationID);
    const notes = sessionNotes.length && !includeLegacy ? sessionNotes : index.notes;
    return [...notes].sort((a, b) => `${b.updatedAt}|${b.title}`.localeCompare(`${a.updatedAt}|${a.title}`));
  },

  async getNote(filename) {
    if (!filename) return null;
    try { return await Zotero.File.getContentsAsync(this.join(this.notesDirectory(), filename)); }
    catch (error) { if (error.name === "NotFoundError" || /no such file/i.test(error.message)) return null; throw error; }
  },

  async getNoteForDay(day) {
    return (await this.listNotes()).find((note) => note.day === day) || null;
  },

  async getNoteForConversation(conversationID) {
    if (!conversationID) return null;
    return (await this.listNotes()).find((note) => note.conversationID === conversationID) || null;
  },

  async writeNote(filename, content, metadata = {}) {
    await this.initialize();
    const notes = this.notesDirectory();
    await Zotero.File.createDirectoryIfMissingAsync(notes);
    const path = this.join(notes, filename);
    await Zotero.File.putContentsAsync(path, content);
    const index = await this.getNoteIndex();
    const note = this.noteMetadata(filename, content, { ...metadata, updatedAt: new Date().toISOString() });
    const position = index.notes.findIndex((entry) => entry.filename === filename);
    if (position === -1) index.notes.push(note); else index.notes[position] = note;
    await this.writeJSON(this.notesIndexPath, index);
    return path;
  },

  async openNotesDirectory() {
    await this.initialize();
    const notes = this.notesDirectory();
    await Zotero.File.createDirectoryIfMissingAsync(notes);
    Zotero.launchFile(Zotero.File.pathToFile(notes));
    return notes;
  },

  async openNote(filename) {
    const path = this.join(this.notesDirectory(), filename);
    Zotero.launchFile(Zotero.File.pathToFile(path));
    return path;
  },

  openVault() {
    Zotero.launchFile(Zotero.File.pathToFile(this.root));
  }
};
