/* global Zotero, ZoteroPane */

var ResearchAgentIndexer = {
  startCurrentCollection(onProgress) {
    const pane = Zotero.getActiveZoteroPane();
    const collection = pane.getSelectedCollection();
    if (!collection) throw new Error("Select a regular Zotero collection first.");
    const collectionNodes = [collection, ...collection.getDescendents(false, "collection").map((node) => Zotero.Collections.get(node.id))];
    const targets = [];
    for (const current of collectionNodes) {
      const path = this.collectionPath(current);
      for (const item of current.getChildItems(false)) {
        if (item.isRegularItem()) targets.push({ item, collection: current, collectionPath: path });
      }
    }
    return this.startTargets(`collection: ${collection.name}`, targets, onProgress);
  },

  startSelectedArticles(onProgress) {
    const items = Zotero.getActiveZoteroPane().getSelectedItems()
      .map((item) => item.isRegularItem() ? item : item.parentItem)
      .filter((item) => item?.isRegularItem());
    if (!items.length) throw new Error("Select one or more regular Zotero items first.");
    return this.startTargets("selected articles", items.map((item) => this.targetForItem(item)), onProgress);
  },

  async startAllArticles(onProgress) {
    const libraryID = Zotero.getActiveZoteroPane().getSelectedLibraryID();
    const items = (await Zotero.Items.getAll(libraryID, true)).filter((item) => item.isRegularItem());
    return this.startTargets("all library articles", items.map((item) => this.targetForItem(item)), onProgress);
  },

  async startReembedEntries(keys, onProgress) {
    const index = await ResearchAgentStorage.getIndex();
    const items = keys.map((key) => Zotero.Items.get(index.articles[key]?.itemID)).filter(Boolean);
    if (!items.length) throw new Error("No indexed Zotero items were found for re-embedding.");
    return this.startTargets("re-embed selected entries", items.map((item) => this.targetForItem(item)), onProgress);
  },

  startTargets(label, targets, onProgress) {
    const unique = [...new Map(targets.map((target) => [target.item.key, target])).values()];
    if (!unique.length) throw new Error("There are no regular items to index.");
    const indexPromise = ResearchAgentStorage.getIndex().then((index) => {
      index.semantic = {
        embeddingModel: Zotero.Prefs.get("extensions.researchAgent.embeddingModel", true) || "BAAI/bge-m3",
        rerankModel: Zotero.Prefs.get("extensions.researchAgent.rerankModel", true) || "BAAI/bge-reranker-v2-m3",
        enabled: Boolean(Zotero.Prefs.get("extensions.researchAgent.siliconFlowAPIKey", true))
      };
      return index;
    });
    return ResearchAgentJobs.start(label, unique, async (target) => {
      const index = await indexPromise;
      await this.indexTarget(index, target);
      await ResearchAgentStorage.saveIndex(index);
    }, onProgress);
  },

  targetForItem(item) {
    const collection = Zotero.Collections.get(item.getCollections()[0]);
    return { item, collection: collection || null, collectionPath: collection ? this.collectionPath(collection) : ["Unfiled"] };
  },

  async indexTarget(index, { item, collection, collectionPath }) {
    if (collection) index.collections[collection.id] = { id: collection.id, name: collection.name, path: collectionPath, parentID: collection.parentID || null };
    const article = await this.articleRecord(item, collection || { id: null }, collectionPath);
    index.articles[item.key] = article;
    index.chunks = index.chunks.filter((chunk) => chunk.articleKey !== item.key);
    const chunks = this.chunkArticle(article);
    if (index.semantic.enabled) await this.embedChunks(chunks);
    index.chunks.push(...chunks);
    // Wiki construction is intentionally best-effort: a missing model key,
    // temporary network failure, or exhausted quota must never invalidate an
    // otherwise successful local embedding job.
    try { await ResearchAgentWiki.upsertArticle(article); } catch (error) { Zotero.logError(error); }
  },

  async listEntries() {
    const index = await ResearchAgentStorage.getIndex();
    return Object.values(index.articles).map((article) => ({ key: article.key, title: article.title, collectionPath: article.collectionPath, indexedAt: article.indexedAt }))
      .sort((a, b) => a.title.localeCompare(b.title));
  },

  async listKnowledgeBases() {
    const index = await ResearchAgentStorage.getIndex();
    const groups = new Map();
    for (const article of Object.values(index.articles)) {
      const id = article.collectionID == null ? "unfiled" : String(article.collectionID);
      const current = groups.get(id) || { id, title: article.collectionID == null ? "未分类文献" : article.collectionPath.join(" / "), articleCount: 0 };
      current.articleCount++;
      groups.set(id, current);
    }
    return [...groups.values()].sort((a, b) => a.title.localeCompare(b.title));
  },

  async paperContext(item, maxChars = 60000) {
    if (!item?.isRegularItem?.()) throw new Error("请先在左侧选择一篇常规文献。");
    const article = await this.articleRecord(item, { id: null }, ["当前论文"]);
    const metadata = [
      `标题：${article.title}`,
      article.creators.length ? `作者：${article.creators.join(", ")}` : "",
      article.date ? `日期：${article.date}` : "",
      article.abstract ? `摘要：${article.abstract}` : ""
    ].filter(Boolean).join("\n");
    const text = article.text ? `\n\n正文（可能已截断）：\n${article.text.slice(0, maxChars)}` : "";
    return `${metadata}${text}`;
  },

  async removeEntries(keys) {
    const index = await ResearchAgentStorage.getIndex();
    for (const key of keys) delete index.articles[key];
    index.chunks = index.chunks.filter((chunk) => !keys.includes(chunk.articleKey));
    await ResearchAgentStorage.saveIndex(index);
    try { await ResearchAgentWiki.removeArticles(keys); } catch (error) { Zotero.logError(error); }
    return `Removed ${keys.length} knowledge-base entries.`;
  },

  async rebuildWiki(onProgress) {
    const index = await ResearchAgentStorage.getIndex();
    const articles = Object.values(index.articles || {});
    if (!articles.length) throw new Error("尚未嵌入任何文献，无法构建研究 Wiki。");
    return ResearchAgentWiki.rebuild(articles, onProgress);
  },

  collectionPath(collection) {
    const names = [collection.name];
    let cursor = collection;
    while (cursor.parentID) {
      cursor = Zotero.Collections.get(cursor.parentID);
      if (!cursor) break;
      names.unshift(cursor.name);
    }
    return names;
  },

  async articleRecord(item, collection, collectionPath) {
    const attachment = this.bestTextAttachment(item);
    const fullText = attachment ? await this.readAttachmentText(attachment) : "";
    return {
      key: item.key,
      itemID: item.id,
      libraryID: item.libraryID,
      collectionID: collection.id,
      collectionPath,
      title: item.getField("title") || "Untitled",
      abstract: item.getField("abstractNote") || "",
      creators: item.getCreators().map((creator) => `${creator.firstName || ""} ${creator.lastName || ""}`.trim()).filter(Boolean),
      date: item.getField("date") || "",
      doi: item.getField("DOI") || "",
      url: item.getField("url") || "",
      attachmentKey: attachment?.key || null,
      text: fullText,
      indexedAt: new Date().toISOString()
    };
  },

  bestTextAttachment(item) {
    return item.getAttachments()
      .map((id) => Zotero.Items.get(id))
      .find((attachment) => attachment?.isAttachment() && attachment.attachmentContentType === "application/pdf");
  },

  async readAttachmentText(attachment) {
    try {
      const cachePath = Zotero.Fulltext.getItemCacheFile(attachment).path;
      return await Zotero.File.getContentsAsync(cachePath);
    } catch (error) {
      Zotero.debug(`Research Agent could not read indexed text for ${attachment.key}: ${error}`);
    }
    return "";
  },

  chunkArticle(article) {
    const chunks = [];
    const intro = [article.title, article.abstract].filter(Boolean).join("\n\n");
    if (intro) chunks.push(this.makeChunk(article, "metadata", 0, intro));
    const paragraphs = article.text
      .replace(/\r/g, "")
      .split(/\n\s*\n+/)
      .map((paragraph) => paragraph.replace(/\s+/g, " ").trim())
      .filter((paragraph) => paragraph.length > 40);
    const maxChars = Zotero.Prefs.get("extensions.researchAgent.maxChunkChars", true) || 1400;
    let sequence = 1;
    for (const paragraph of paragraphs) {
      for (const text of this.splitLongParagraph(paragraph, maxChars)) {
        chunks.push(this.makeChunk(article, "paragraph", sequence++, text));
      }
    }
    return chunks;
  },

  splitLongParagraph(paragraph, maxChars) {
    if (paragraph.length <= maxChars) return [paragraph];
    const sentences = paragraph.match(/[^.!?。！？]+[.!?。！？]*/g) || [paragraph];
    const result = [];
    let current = "";
    for (const sentence of sentences) {
      if (current && current.length + sentence.length > maxChars) {
        result.push(current.trim());
        current = "";
      }
      current += sentence;
    }
    if (current.trim()) result.push(current.trim());
    return result;
  },

  makeChunk(article, level, sequence, text) {
    return {
      id: `${article.key}:${level}:${sequence}`,
      articleKey: article.key,
      collectionID: article.collectionID,
      collectionPath: article.collectionPath,
      title: article.title,
      level,
      sequence,
      text
    };
  },

  async embedChunks(chunks) {
    const batchSize = 24;
    for (let start = 0; start < chunks.length; start += batchSize) {
      const batch = chunks.slice(start, start + batchSize);
      const inputs = batch.map((chunk) => `${chunk.collectionPath.join(" / ")}\n${chunk.title}\n${chunk.text}`);
      const vectors = await ResearchAgentSemantic.embed(inputs);
      batch.forEach((chunk, index) => { chunk.embedding = vectors[index]; });
    }
  },

  async search(query, limit = 8, collectionIDs = [], { useSemantic = false } = {}) {
    const index = await ResearchAgentStorage.getIndex();
    const terms = this.tokens(query);
    const selected = new Set(collectionIDs.map(String));
    const scopedChunks = selected.size ? index.chunks.filter((chunk) => selected.has(chunk.collectionID == null ? "unfiled" : String(chunk.collectionID))) : index.chunks;
    const semanticReady = useSemantic && Boolean(Zotero.Prefs.get("extensions.researchAgent.siliconFlowAPIKey", true)) && scopedChunks.some((chunk) => chunk.embedding);
    let queryEmbedding = null;
    if (semanticReady) {
      try { [queryEmbedding] = await ResearchAgentSemantic.embed([query]); } catch (error) { Zotero.logError(error); }
    }
    const scored = scopedChunks.map((chunk) => {
      const lexicalScore = this.score(chunk, terms);
      const semanticScore = queryEmbedding ? ResearchAgentSemantic.cosine(queryEmbedding, chunk.embedding) : 0;
      const lexicalWeight = terms.length ? Math.min(1, lexicalScore / (terms.length * 2)) : 0;
      return { chunk, lexicalScore, semanticScore, score: queryEmbedding ? lexicalWeight * 0.35 + ((semanticScore + 1) / 2) * 0.65 : lexicalScore };
    }).filter(({ score }) => score > 0);
    scored.sort((a, b) => b.score - a.score);
    let ranked = scored.slice(0, 36);
    if (queryEmbedding && ranked.length) {
      try { ranked = await ResearchAgentSemantic.rerank(query, ranked, limit); } catch (error) { Zotero.logError(error); ranked = ranked.slice(0, limit); }
    } else {
      ranked = ranked.slice(0, limit);
    }
    return ranked.slice(0, limit).map(({ chunk, score, lexicalScore, semanticScore, rerankScore }) => ({
      score: rerankScore ?? score,
      lexicalScore,
      semanticScore,
      rerankScore,
      citation: `${chunk.title} [${chunk.articleKey}] · ${chunk.collectionPath.join(" / ")} · ${chunk.level} ${chunk.sequence}`,
      text: chunk.text
    }));
  },

  tokens(text) {
    return [...new Set((text.toLowerCase().match(/[\\p{L}\\p{N}_-]{2,}/gu) || []))];
  },

  score(chunk, terms) {
    const haystack = `${chunk.title} ${chunk.text}`.toLowerCase();
    return terms.reduce((total, term) => total + (haystack.includes(term) ? (chunk.title.toLowerCase().includes(term) ? 4 : 1) : 0), 0);
  }
};
