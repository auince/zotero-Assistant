/* global Zotero, ResearchAgentAgent, ResearchAgentIndexer, ResearchAgentJobs, ResearchAgentDailyNotes, ResearchAgentStorage, ResearchAgentMemory, ResearchAgentMarkdown, ResearchAgentTools, ResearchAgentWiki, ResearchAgentResearch, ResearchAgentReproduction */

var ResearchAgentSidebar = {
  sectionID: null,
  rootURI: null,
  selectionListeners: new Set(),
  pendingSelection: null,
  readerSelectionHandler: null,

  register(rootURI) {
    this.rootURI = rootURI;
    this.sectionID = Zotero.ItemPaneManager.registerSection({
      paneID: "research-agent-chat",
      pluginID: "research-agent@zotero.example.com",
      // Zotero renders these narrow slots at the image's intrinsic size.
      // Keep a dedicated 24px rendition so the icon is never cropped.
      header: { l10nID: "research-agent-header", icon: `${rootURI}icons/research-agent-small.png` },
      sidenav: { l10nID: "research-agent-header", icon: `${rootURI}icons/research-agent-small.png`, orderable: true },
      onRender: (props) => this.render(props)
    });
    this.registerReaderSelectionAction();
  },

  unregister() {
    if (this.sectionID) Zotero.ItemPaneManager.unregisterSection(this.sectionID);
    if (this.readerSelectionHandler) {
      try { Zotero.Reader?.unregisterEventListener("renderTextSelectionPopup", this.readerSelectionHandler); } catch (error) { Zotero.logError(error); }
    }
    this.sectionID = null;
    this.readerSelectionHandler = null;
    this.selectionListeners.clear();
  },

  registerReaderSelectionAction() {
    if (!Zotero.Reader?.registerEventListener || this.readerSelectionHandler) return;
    this.readerSelectionHandler = ({ reader, doc, params, append }) => {
      const text = params?.annotation?.text?.trim();
      if (!text) return;
      const attachment = reader?._item || reader?.item;
      const item = attachment?.parentItem || attachment;
      const title = item?.getField?.("title") || "当前论文";
      const actions = doc.createElement("div");
      const addAction = (label, preset) => {
        const button = doc.createElement("button");
        button.type = "button"; button.textContent = label;
        button.addEventListener("click", () => { this.queueSelectedText({ text, title, preset }); button.textContent = "已添加"; button.disabled = true; });
        actions.append(button);
      };
      addAction("添加到研究助手", "");
      addAction("解释选段", "请结合论文整体语境，解释下列选段的概念、推理逻辑与作者意图。");
      addAction("翻译选段", "请将下列论文选段准确翻译为简洁中文；保留专业术语，并在必要时简要解释关键词。");
      addAction("总结要点", "请提炼下列选段的核心观点、依据与对本文结论的作用。");
      addAction("批判性阅读", "请批判性评估下列选段：它的假设、证据强度、可能的替代解释与局限分别是什么？");
      append(actions);
    };
    Zotero.Reader.registerEventListener("renderTextSelectionPopup", this.readerSelectionHandler, "research-agent@zotero.example.com");
  },

  queueSelectedText(payload) {
    if (!payload?.text?.trim()) return;
    this.pendingSelection = { text: payload.text.trim(), title: payload.title || "当前论文", preset: payload.preset || "" };
    for (const listener of this.selectionListeners) {
      try { listener(this.pendingSelection); } catch (error) { Zotero.logError(error); }
    }
  },

  render({ body, doc, item, setSectionSummary }) {
    setSectionSummary(item ? `当前文献：${item.getField("title") || "未命名文献"}` : "聊天、会话与知识库");
    if (body.querySelector(".research-agent")) return;
    this.mount(body, doc, item);
  },

  mount(body, doc, initialItem) {
    if (!doc.querySelector('link[data-research-agent-katex]')) {
      const katexStyles = doc.createElement("link");
      katexStyles.rel = "stylesheet"; katexStyles.href = `${this.rootURI}vendor/katex/katex.min.css`;
      katexStyles.dataset.researchAgentKatex = "true";
      (doc.head || body).append(katexStyles);
    }
    const style = doc.createElement("style");
    style.textContent = `
      .research-agent { --ra-accent:#3478c5; --ra-accent-weak:#e9f2ff; --ra-border:color-mix(in srgb, currentColor 15%, transparent); display:flex; flex-direction:column; gap:10px; height:min(78vh, 980px); min-height:540px; max-height:100%; overflow:hidden; font:menu; color:var(--fill-primary,#1d2733); }
      @media (prefers-color-scheme:dark) { .research-agent { --ra-accent:#7cb7ff; --ra-accent-weak:#1b3552; } }
      .research-agent-top { display:flex; gap:5px; padding:3px; border:1px solid var(--ra-border); border-radius:10px; background:color-mix(in srgb,var(--ra-accent) 5%,transparent); }
      .research-agent-tab { flex:1; min-height:30px; border:0; border-radius:7px; background:transparent; color:inherit; font:menu; font-weight:650; cursor:pointer; }
      .research-agent-tab:hover { background:color-mix(in srgb,var(--ra-accent) 10%,transparent); }.research-agent-tab.is-active{background:var(--ra-accent);color:#fff;box-shadow:0 1px 4px color-mix(in srgb,var(--ra-accent) 35%,transparent)}
      .research-agent-status { padding:7px 9px; border-radius:8px; background:var(--ra-accent-weak); color:color-mix(in srgb,var(--ra-accent) 78%,currentColor); font-size:.9em; line-height:1.35; }.research-agent-panel{display:none;min-height:0}.research-agent-panel.is-active{display:flex;flex:1;flex-direction:column;gap:10px}
      .research-agent-sessionbar { display:grid; grid-template-columns:minmax(0,1fr) max-content; flex:0 0 auto; align-items:center; gap:6px; min-width:0; }.research-agent-session-title { min-width:0; overflow:hidden; text-overflow:ellipsis; white-space:nowrap; font-weight:700; }.research-agent-sessionbar .research-agent-primary{min-width:max-content;white-space:nowrap}.research-agent button { min-height:29px; padding:5px 9px; border:1px solid var(--ra-border); border-radius:7px; background:var(--material-sidepane,#fff); color:inherit; font:menu; cursor:pointer; }.research-agent button:hover:not(:disabled){border-color:var(--ra-accent);background:var(--ra-accent-weak)}.research-agent button:disabled{cursor:wait;opacity:.65}.research-agent-primary{border-color:var(--ra-accent)!important;background:var(--ra-accent)!important;color:#fff!important;font-weight:650!important}
      .research-agent-session-drawer { display:none; flex:1 1 0; flex-direction:column; gap:8px; min-height:0; overflow:hidden; padding:10px; border:1px solid var(--ra-border); border-radius:10px; background:color-mix(in srgb,var(--ra-accent) 4%,transparent); }.research-agent-session-drawer.is-open{display:flex}.research-agent-session-list{display:flex;flex:1 1 0;flex-direction:column;align-items:stretch;gap:7px;min-height:0;overflow-x:hidden;overflow-y:auto}.research-agent-session-card{display:flex;flex:0 0 auto;flex-direction:column;min-width:0;overflow:hidden;border:1px solid var(--ra-border);border-radius:8px;background:var(--ra-surface-raised)}.research-agent-session-card.is-active{border-color:var(--ra-accent);box-shadow:0 0 0 1px color-mix(in srgb,var(--ra-accent) 18%,transparent)}.research-agent-session-item{box-sizing:border-box;display:block;flex:0 0 auto;width:100%;min-height:auto!important;padding:7px 8px!important;overflow:hidden;border:0!important;border-radius:0!important;background:transparent!important;text-align:left;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}.research-agent-session-card.is-active .research-agent-session-item{background:var(--ra-accent-weak)!important}.research-agent-session-paper{display:-webkit-box;min-width:0;max-height:2.7em;padding:5px 8px;overflow:hidden;border-top:1px solid var(--ra-border);-webkit-box-orient:vertical;-webkit-line-clamp:2;color:var(--fill-secondary,#687583);font-size:.78em;line-height:1.35;overflow-wrap:anywhere}.research-agent-session-actions{display:flex;justify-content:flex-end;padding:5px 7px;border-top:1px solid var(--ra-border)}.research-agent-session-delete{min-height:24px!important;padding:2px 7px!important;border-color:transparent!important;background:transparent!important;color:var(--ra-muted)!important;font-size:.8em}.research-agent-session-delete:hover:not(:disabled){border-color:#b84a4a!important;background:color-mix(in srgb,#b84a4a 10%,transparent)!important;color:#b84a4a!important}.research-agent-session-drawer > .research-agent-session-toggle,.research-agent-session-drawer > button{flex:0 0 auto}.research-agent-session-toggle{display:flex;align-items:center;gap:6px;color:var(--fill-secondary,#687583);font-size:.88em}
      .research-agent-rag { display:flex; flex-wrap:wrap; align-items:center; gap:7px; padding:8px 10px; border:1px solid var(--ra-border); border-radius:10px; background:color-mix(in srgb,var(--ra-accent) 3%,transparent); }.research-agent-rag label{display:flex;align-items:center;gap:5px;font-weight:650}.research-agent-rag select{flex:1;min-width:150px;box-sizing:border-box;min-height:28px;border:1px solid var(--ra-border);border-radius:6px;background:var(--material-sidepane,#fff);color:inherit;font:menu}.research-agent-rag select:disabled{opacity:.55}.research-agent-rag-note{width:100%;color:var(--fill-secondary,#687583);font-size:.82em}
      .research-agent-learning{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--ra-border);border-radius:10px;background:var(--ra-subtle)}.research-agent-learning.is-enabled{border-color:color-mix(in srgb,var(--ra-accent) 48%,var(--ra-border));background:color-mix(in srgb,var(--ra-accent) 7%,var(--ra-surface-raised))}.research-agent-learning-label{display:flex;align-items:center;gap:5px;font-weight:650}.research-agent-learning-note{flex:1 1 190px;min-width:0;color:var(--ra-muted);font-size:.82em;line-height:1.35}.research-agent-learning-actions{display:flex;flex:1 0 100%;flex-wrap:wrap;gap:5px}.research-agent-learning-actions button{min-height:24px;padding:2px 7px;border-radius:999px;color:var(--ra-muted);font-size:.8em}.research-agent-learning.is-enabled .research-agent-learning-actions button{border-color:color-mix(in srgb,var(--ra-accent) 30%,var(--ra-border));color:var(--ra-accent)}
      .research-agent-deep{display:flex;flex-wrap:wrap;align-items:center;gap:7px;padding:8px 10px;border:1px solid var(--ra-border);border-radius:10px;background:var(--ra-subtle)}.research-agent-deep.is-enabled{border-color:color-mix(in srgb,var(--ra-accent) 48%,var(--ra-border));background:color-mix(in srgb,var(--ra-accent) 7%,var(--ra-surface-raised))}.research-agent-deep-label{display:flex;align-items:center;gap:5px;font-weight:650}.research-agent-deep-note{flex:1 1 190px;min-width:0;color:var(--ra-muted);font-size:.82em;line-height:1.35}.research-agent-deep-actions{display:flex;flex:0 0 auto;gap:5px}.research-agent-deep-actions button{min-height:24px;padding:2px 7px;font-size:.8em}
      .research-agent-context{padding:9px 10px;border:1px solid var(--ra-border);border-radius:10px;background:color-mix(in srgb,var(--ra-accent) 4%,transparent)}.research-agent-context-label{display:block;margin-bottom:3px;color:var(--fill-secondary,#687583);font-size:.82em;font-weight:600}.research-agent-selected-item{display:-webkit-box;overflow:hidden;-webkit-box-orient:vertical;-webkit-line-clamp:2;font-weight:650;line-height:1.35}
      .research-agent-log{flex:1;min-height:200px;overflow:auto;padding:12px;border:1px solid var(--ra-border);border-radius:11px;background:var(--material-sidepane,#fff);box-shadow:inset 0 1px 0 color-mix(in srgb,currentColor 4%,transparent);line-height:1.48}.research-agent-message{margin:0 0 12px;padding:8px 10px;border-radius:9px;background:color-mix(in srgb,currentColor 4%,transparent)}.research-agent-message:last-child{margin-bottom:0}.research-agent-message.is-user{background:var(--ra-accent-weak)}.research-agent-role{display:block;margin-bottom:3px;color:var(--ra-accent);font-size:.84em;font-weight:700}.research-agent-message-content{white-space:pre-wrap}.research-agent-message-actions{display:flex;justify-content:flex-end;gap:5px;margin-top:7px}.research-agent-message-actions button{min-height:24px;padding:2px 6px;font-size:.8em}
      .research-agent-response{background:var(--material-sidepane,#fff);border:1px solid color-mix(in srgb,var(--ra-accent) 18%,var(--ra-border))}.research-agent-answer{min-height:1.4em;white-space:pre-wrap}.research-agent-trace{margin-top:9px;border:1px solid color-mix(in srgb,currentColor 10%,transparent);border-radius:8px;background:color-mix(in srgb,currentColor 2.5%,transparent)}.research-agent-trace summary{padding:7px 9px;color:var(--fill-secondary,#687583);cursor:pointer;font-size:.86em;font-weight:600}.research-agent-trace-body{display:flex;flex-direction:column;gap:5px;padding:0 8px 8px}.research-agent-trace-reasoning{padding:7px 8px;border-radius:6px;background:color-mix(in srgb,currentColor 3.5%,transparent);color:var(--fill-secondary,#687583);font-size:.88em;line-height:1.42;white-space:pre-wrap}.research-agent-tool-event{padding:6px 8px;border-radius:6px;background:#f1f3f5;color:#69727d;font-size:.84em;line-height:1.38}@media(prefers-color-scheme:dark){.research-agent-tool-event{background:#262b31;color:#b8c0ca}}
      .research-agent-citations{display:none;margin-top:10px;padding-top:9px;border-top:1px solid var(--ra-border)}.research-agent-citations.has-items{display:block}.research-agent-citations-title{margin-bottom:6px;color:var(--fill-secondary,#687583);font-size:.82em;font-weight:700}.research-agent-citation-list{display:flex;flex-wrap:wrap;gap:5px}.research-agent-citation{max-width:100%;overflow:hidden;padding:4px 7px;border-radius:999px;background:var(--ra-accent-weak);color:var(--ra-accent);font-size:.82em;overflow-wrap:anywhere;text-decoration:none}a.research-agent-citation:hover{text-decoration:underline}
      .research-agent-composer{display:flex;flex-direction:column;gap:7px}.research-agent textarea{box-sizing:border-box;width:100%;min-height:108px;max-height:34vh;padding:10px;resize:vertical;border:1px solid var(--ra-border);border-radius:10px;background:var(--material-sidepane,#fff);color:inherit;font:menu;line-height:1.42}.research-agent textarea:focus{outline:2px solid color-mix(in srgb,var(--ra-accent) 48%,transparent);outline-offset:1px}.research-agent-sendline{display:grid;grid-template-columns:minmax(0,1fr) max-content max-content;align-items:center;gap:8px;min-width:0}.research-agent-hint{min-width:0;overflow:hidden;color:var(--fill-secondary,#687583);font-size:.82em;text-overflow:ellipsis;white-space:nowrap}.research-agent-remaining{color:var(--fill-secondary,#687583);font-size:.82em;white-space:nowrap}.research-agent-sendline .research-agent-primary{min-width:max-content;white-space:nowrap}.research-agent-remaining.warning{color:#a56812}.research-agent-remaining.over{color:#a53c3c;font-weight:650}@media(max-width:330px){.research-agent-sessionbar{grid-template-columns:minmax(0,1fr)}.research-agent-sessionbar .research-agent-primary{justify-self:start}.research-agent-sendline{grid-template-columns:minmax(0,1fr) max-content}.research-agent-hint{display:none}}
      .research-agent-card{display:flex;flex-direction:column;gap:9px;padding:11px;border:1px solid var(--ra-border);border-radius:11px;background:color-mix(in srgb,currentColor 2%,transparent)}.research-agent-card-title{font-weight:700}.research-agent-card-copy{margin:0;color:var(--fill-secondary,#687583);font-size:.9em;line-height:1.38}.research-agent-actions{display:flex;flex-wrap:wrap;gap:6px}.research-agent-progress{width:100%;height:6px;accent-color:var(--ra-accent)}.research-agent-entry-list{flex:1;min-height:145px;width:100%;box-sizing:border-box;border:1px solid var(--ra-border);border-radius:8px;background:var(--material-sidepane,#fff);color:inherit;font:menu}.research-agent-entry-list option{padding:5px}
      .research-agent-wiki-card{min-height:0}.research-agent-wiki-toolbar{display:flex;flex-wrap:wrap;align-items:center;gap:7px}.research-agent-wiki-meta{color:var(--ra-muted);font-size:.82em}.research-agent-wiki-legend{display:flex;flex-wrap:wrap;gap:5px}.research-agent-wiki-legend span{padding:2px 6px;border:1px solid var(--ra-border);border-radius:999px;color:var(--ra-muted);font-size:.77em}.research-agent-wiki-graph{min-height:270px;max-height:380px;overflow:auto;border:1px solid var(--ra-border);border-radius:8px;background:var(--ra-surface);scrollbar-gutter:stable}.research-agent-wiki-empty{padding:28px 14px;color:var(--ra-muted);text-align:center;line-height:1.5}.research-agent-wiki-svg{display:block;min-width:500px}.research-agent-wiki-edge{stroke:color-mix(in srgb,var(--ra-muted) 58%,transparent);stroke-width:1.4}.research-agent-wiki-edge-label{fill:var(--ra-muted);font-size:10px}.research-agent-wiki-node{cursor:pointer}.research-agent-wiki-node circle{fill:var(--ra-accent-weak);stroke:var(--ra-accent);stroke-width:1.6}.research-agent-wiki-node:hover circle,.research-agent-wiki-node.is-selected circle{fill:var(--ra-accent);stroke:var(--ra-accent)}.research-agent-wiki-node text{fill:var(--ra-text);font-size:11px;font-weight:600;pointer-events:none}.research-agent-wiki-node.is-selected text{fill:var(--ra-accent-text)}.research-agent-wiki-detail{min-height:64px;padding:9px;border-left:3px solid var(--ra-accent);border-radius:0 7px 7px 0;background:var(--ra-subtle);line-height:1.45}.research-agent-wiki-detail-title{font-weight:700}.research-agent-wiki-detail p{margin:5px 0}.research-agent-wiki-chips{display:flex;flex-wrap:wrap;gap:4px}.research-agent-wiki-chips span{padding:2px 5px;border-radius:5px;background:var(--ra-accent-weak);color:var(--ra-accent);font-size:.8em}

      /* Follow Zotero/Firefox semantic colours. Do not hard-code a light or dark surface. */
      .research-agent{--ra-accent:AccentColor;--ra-accent-text:AccentColorText;--ra-surface:var(--material-sidepane,Canvas);--ra-surface-raised:Field;--ra-text:var(--fill-primary,CanvasText);--ra-muted:var(--fill-secondary,GrayText);--ra-border:color-mix(in srgb,CanvasText 18%,transparent);--ra-subtle:color-mix(in srgb,CanvasText 4%,Canvas);--ra-accent-weak:color-mix(in srgb,AccentColor 14%,Canvas);gap:9px;letter-spacing:.01em;color:var(--ra-text)}
      .research-agent-top{gap:3px;padding:3px;border-radius:9px;background:var(--ra-subtle);border-color:var(--ra-border)}
      .research-agent-tab{min-height:29px;border-radius:6px;font-weight:600}.research-agent-tab.is-active{background:var(--ra-accent);color:var(--ra-accent-text);box-shadow:none}.research-agent-tab:hover{background:color-mix(in srgb,var(--ra-accent) 12%,var(--ra-surface-raised))}
      .research-agent-status{padding:6px 9px;border:1px solid var(--ra-border);border-radius:7px;background:var(--ra-subtle);color:var(--ra-muted);font-size:.82em}
      .research-agent button{min-height:28px;padding:4px 8px;border-color:var(--ra-border);border-radius:6px;background:ButtonFace;color:ButtonText;transition:background .12s,border-color .12s}.research-agent button:hover:not(:disabled){border-color:var(--ra-accent);background:color-mix(in srgb,var(--ra-accent) 11%,ButtonFace)}.research-agent-primary{border-color:var(--ra-accent)!important;background:var(--ra-accent)!important;color:var(--ra-accent-text)!important}
      .research-agent-session-drawer,.research-agent-rag,.research-agent-context,.research-agent-card{border-color:var(--ra-border);border-radius:9px;background:var(--ra-subtle)}
      .research-agent-session-item{background:transparent}.research-agent-session-item.is-active{border-color:var(--ra-accent);background:var(--ra-accent-weak)}
      .research-agent-rag select,.research-agent-entry-list{border-color:var(--ra-border);background:var(--ra-surface-raised);color:FieldText}
      .research-agent-chat-panel{overflow:hidden}.research-agent-log{flex:1 1 0;min-height:0;padding:8px;border:0;border-radius:9px;background:var(--ra-surface);box-shadow:none}.research-agent-composer{flex:0 0 auto;min-height:0}.research-agent-message{margin-bottom:9px;padding:10px;border:1px solid transparent;border-radius:8px;background:transparent}.research-agent-message.is-user{border-color:color-mix(in srgb,var(--ra-accent) 26%,transparent);background:var(--ra-accent-weak)}.research-agent-response{border-color:var(--ra-border);background:var(--ra-surface-raised)}.research-agent-role{font-size:.78em;color:var(--ra-accent)}
      .research-agent-message-actions{gap:4px;margin-top:8px}.research-agent-message-actions button{min-height:23px;padding:2px 7px;border-color:transparent;background:transparent;color:var(--ra-muted)}.research-agent-message-actions button:hover:not(:disabled){background:var(--ra-subtle);color:ButtonText}
      .research-agent-edit-box{box-sizing:border-box;width:100%;min-height:92px;max-height:34vh;padding:9px;resize:vertical;border:1px solid var(--ra-accent);border-radius:7px;background:var(--ra-surface-raised);color:FieldText;font:menu;line-height:1.45}.research-agent-edit-box:focus{outline:2px solid color-mix(in srgb,var(--ra-accent) 45%,transparent);outline-offset:1px}.research-agent-edit-actions{justify-content:flex-end;margin-top:8px}
      .research-agent-trace{border-color:var(--ra-border);background:var(--ra-subtle)}.research-agent-trace-reasoning,.research-agent-tool-event{border-radius:6px;background:color-mix(in srgb,CanvasText 5%,Canvas);color:var(--ra-muted)}
      .research-agent-citation{border-radius:6px;background:var(--ra-accent-weak);color:var(--ra-accent)}
      .research-agent textarea{min-height:100px;padding:11px;border-color:var(--ra-border);border-radius:9px;background:var(--ra-surface-raised);color:FieldText;box-shadow:none}
      .research-agent-message-content> :first-child,.research-agent-answer> :first-child{margin-top:0}.research-agent-message-content> :last-child,.research-agent-answer> :last-child{margin-bottom:0}.research-agent-message-content p,.research-agent-answer p{margin:0 0:.72em}.research-agent-message-content h1,.research-agent-message-content h2,.research-agent-message-content h3,.research-agent-message-content h4,.research-agent-answer h1,.research-agent-answer h2,.research-agent-answer h3,.research-agent-answer h4{margin:.9em 0 .42em;line-height:1.28}.research-agent-message-content h1,.research-agent-answer h1{font-size:1.25em}.research-agent-message-content h2,.research-agent-answer h2{font-size:1.15em}.research-agent-message-content h3,.research-agent-answer h3{font-size:1.05em}.research-agent-message-content ul,.research-agent-message-content ol,.research-agent-answer ul,.research-agent-answer ol{margin:.35em 0 .7em;padding-inline-start:1.45em}.research-agent-message-content li,.research-agent-answer li{margin:.23em 0}.research-agent-message-content pre,.research-agent-answer pre{margin:.7em 0;padding:9px;overflow:auto;border:1px solid var(--ra-border);border-radius:7px;background:color-mix(in srgb,CanvasText 7%,Canvas)}.research-agent-message-content code,.research-agent-answer code{padding:.12em .32em;border-radius:4px;background:color-mix(in srgb,CanvasText 8%,transparent);font-family:ui-monospace,SFMono-Regular,Menlo,monospace;font-size:.9em}.research-agent-message-content pre code,.research-agent-answer pre code{padding:0;background:transparent}.research-agent-message-content blockquote,.research-agent-answer blockquote{margin:.7em 0;padding:.1em 0 .1em .8em;border-inline-start:3px solid var(--ra-accent);color:var(--ra-muted)}.research-agent-message-content table,.research-agent-answer table{display:block;max-width:100%;margin:.7em 0;overflow:auto;border-collapse:collapse}.research-agent-message-content th,.research-agent-message-content td,.research-agent-answer th,.research-agent-answer td{padding:5px 7px;border:1px solid var(--ra-border);text-align:left}.research-agent-message-content th,.research-agent-answer th{background:var(--ra-subtle)}.research-agent-message-content a,.research-agent-answer a{color:var(--ra-accent);text-decoration:none}.research-agent-message-content a:hover,.research-agent-answer a:hover{text-decoration:underline}.research-agent-markdown-pending{white-space:pre-wrap}
      .research-agent-message-content,.research-agent-answer{-moz-user-select:text!important;user-select:text!important;cursor:text}.research-agent-message-actions{user-select:none}
      .research-agent-quick-prompts{display:flex;flex-wrap:wrap;gap:5px;padding:0 1px}.research-agent-quick-prompts-label{width:100%;margin-bottom:1px;color:var(--ra-muted);font-size:.78em;font-weight:600}.research-agent-quick-prompts button{min-height:25px;padding:3px 7px;border-radius:999px;background:transparent;color:var(--ra-muted);font-size:.8em}.research-agent-quick-prompts button:hover:not(:disabled){color:var(--ra-accent);background:var(--ra-accent-weak)}
      .research-agent-math{color:inherit}.research-agent-math.is-display{display:block;max-width:100%;margin:.8em 0;padding:.55em .7em;overflow-x:auto;border:1px solid var(--ra-border);border-radius:7px;background:var(--ra-subtle);text-align:center}.research-agent-math.has-error{white-space:pre-wrap;text-align:left;color:var(--ra-muted);font-family:ui-monospace,SFMono-Regular,Menlo,monospace}.research-agent-math .katex-display{margin:0}.research-agent-math .katex{font-size:1.04em}
      .research-agent-notes-card{flex:1 1 0;min-height:0;overflow:hidden}.research-agent-notes-layout{display:grid;grid-template-columns:minmax(150px,34%) minmax(0,1fr);flex:1 1 0;min-height:0;gap:8px;overflow:hidden}.research-agent-note-list{display:flex;min-width:0;min-height:0;flex-direction:column;gap:6px;overflow-x:hidden;overflow-y:auto;overscroll-behavior:contain}.research-agent-note-item{box-sizing:border-box;display:flex;flex:0 0 auto;flex-direction:column;align-items:stretch;gap:3px;width:100%;min-width:0;min-height:50px!important;padding:7px 8px!important;overflow:hidden;text-align:left}.research-agent-note-item.is-active{border-color:var(--ra-accent);background:var(--ra-accent-weak)}.research-agent-note-title{display:block;min-width:0;overflow:hidden;font-weight:600;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}.research-agent-note-item small{display:block;min-width:0;overflow:hidden;color:var(--ra-muted);font-size:.78em;line-height:1.3;text-overflow:ellipsis;white-space:nowrap}.research-agent-note-preview{box-sizing:border-box;min-width:0;min-height:0;overflow-x:hidden;overflow-y:scroll;overscroll-behavior:contain;padding:11px;border:1px solid var(--ra-border);border-radius:9px;background:var(--ra-surface);scrollbar-gutter:stable}.research-agent-note-empty{margin:auto;color:var(--ra-muted);text-align:center}.research-agent-note-preview .research-agent-message-content{min-width:0;white-space:normal;overflow-wrap:anywhere}.research-agent-note-actions{display:flex;flex:0 0 auto;flex-wrap:wrap;gap:6px}@media(max-width:480px){.research-agent-notes-layout{grid-template-columns:1fr;grid-template-rows:minmax(140px,34%) minmax(0,1fr)}.research-agent-note-list{border-bottom:1px solid var(--ra-border);padding-bottom:6px}}
      .research-agent-session-resources{display:flex;flex-direction:column;gap:8px;min-width:0}.research-agent-reproduction{min-width:0;border:1px solid var(--ra-border);border-radius:9px;background:var(--ra-subtle)}.research-agent-reproduction summary{padding:8px 10px;cursor:pointer;font-weight:650}.research-agent-reproduction-body{display:flex;flex-direction:column;gap:7px;padding:0 9px 9px}.research-agent-reproduction-note{color:var(--ra-muted);font-size:.8em;line-height:1.35}.research-agent-reproduction-input{box-sizing:border-box;width:100%;min-width:0;min-height:29px;padding:6px 8px;border:1px solid var(--ra-border);border-radius:6px;background:var(--ra-surface-raised);color:FieldText;font:menu}.research-agent-reproduction-path{overflow-wrap:anywhere;color:var(--ra-muted);font-size:.8em}.research-agent-reproduction-actions{display:flex;flex-wrap:wrap;gap:5px}.research-agent-reproduction-actions button{min-height:25px;padding:3px 7px;font-size:.8em}.research-agent-reproduction-log{display:flex;flex-direction:column;gap:5px;max-height:150px;overflow:auto;padding:7px;border:1px solid var(--ra-border);border-radius:7px;background:var(--ra-surface);scrollbar-gutter:stable}.research-agent-reproduction-entry{white-space:pre-wrap;overflow-wrap:anywhere;font-size:.81em;line-height:1.38}.research-agent-reproduction-entry.is-user{color:var(--ra-accent);font-weight:600}.research-agent-reproduction-prompt{min-height:64px;max-height:150px}.research-agent button:focus-visible,.research-agent input:focus-visible,.research-agent textarea:focus-visible,.research-agent summary:focus-visible{outline:2px solid color-mix(in srgb,var(--ra-accent) 58%,transparent);outline-offset:1px}
    `;
    body.append(style);
    const root = doc.createElement("div"); root.className = "research-agent";
    const status = doc.createElement("div"); status.className = "research-agent-status"; status.textContent = "正在载入本地会话…";
    const tabs = doc.createElement("div"); tabs.className = "research-agent-top";
    const sessionPanel = doc.createElement("section"); sessionPanel.className = "research-agent-panel";
    const chatPanel = doc.createElement("section"); chatPanel.className = "research-agent-panel research-agent-chat-panel is-active";
    const knowledgePanel = doc.createElement("section"); knowledgePanel.className = "research-agent-panel";
    const notesPanel = doc.createElement("section"); notesPanel.className = "research-agent-panel";
    const sessionTab = this.button(doc, "会话", () => activate("sessions")); sessionTab.classList.add("research-agent-tab", "research-agent-session-button");
    const chatTab = this.button(doc, "✦ 聊天", () => activate("chat")); chatTab.classList.add("research-agent-tab", "is-active");
    const knowledgeTab = this.button(doc, "▦ 知识库", () => activate("knowledge")); knowledgeTab.classList.add("research-agent-tab");
    const notesTab = this.button(doc, "笔记", () => activate("notes")); notesTab.classList.add("research-agent-tab"); tabs.append(sessionTab, chatTab, knowledgeTab, notesTab);
    const activate = (page) => {
      const chat = page === "chat";
      const sessions = page === "sessions";
      chatPanel.classList.toggle("is-active", chat);
      sessionPanel.classList.toggle("is-active", sessions);
      knowledgePanel.classList.toggle("is-active", page === "knowledge");
      notesPanel.classList.toggle("is-active", page === "notes");
      chatTab.classList.toggle("is-active", chat);
      sessionTab.classList.toggle("is-active", sessions);
      knowledgeTab.classList.toggle("is-active", page === "knowledge");
      notesTab.classList.toggle("is-active", page === "notes");
      if (page === "knowledge") refreshKnowledge().catch((error) => { Zotero.logError(error); status.textContent = `错误：${error.message}`; });
      if (page === "notes") renderNotes().catch((error) => { Zotero.logError(error); status.textContent = `无法读取笔记：${error.message}`; });
    };

    const state = { active: null, summaries: [], switchRequest: 0, deepResearch: false, researchTask: null, reproduction: null };
    const sessionBar = doc.createElement("div"); sessionBar.className = "research-agent-sessionbar";
    const sessionTitle = doc.createElement("div"); sessionTitle.className = "research-agent-session-title";
    const newSession = this.button(doc, "新对话", () => createSession()); newSession.classList.add("research-agent-primary"); sessionBar.append(sessionTitle, newSession);
    const drawer = doc.createElement("div"); drawer.className = "research-agent-session-drawer is-open";
    const sessionList = doc.createElement("div"); sessionList.className = "research-agent-session-list";
    const syncToggle = doc.createElement("input"); syncToggle.type = "checkbox"; syncToggle.checked = Boolean(Zotero.Prefs.get("extensions.researchAgent.syncItemOnConversationSwitch", true));
    const syncLabel = doc.createElement("label"); syncLabel.className = "research-agent-session-toggle"; syncLabel.append(syncToggle, doc.createTextNode("切换会话时联动左侧文献"));
    syncToggle.addEventListener("change", () => Zotero.Prefs.set("extensions.researchAgent.syncItemOnConversationSwitch", syncToggle.checked, true));
    const bindPaper = this.button(doc, "关联当前文献", () => bindCurrentPaper());
    drawer.append(sessionList, bindPaper, syncLabel);
    sessionPanel.append(sessionBar, drawer);
    const learning = doc.createElement("div"); learning.className = "research-agent-learning";
    const learningToggle = doc.createElement("input"); learningToggle.type = "checkbox";
    const learningLabel = doc.createElement("label"); learningLabel.className = "research-agent-learning-label"; learningLabel.append(learningToggle, doc.createTextNode("学习辅导模式"));
    const learningNote = doc.createElement("span"); learningNote.className = "research-agent-learning-note";
    const learningActions = doc.createElement("div"); learningActions.className = "research-agent-learning-actions";
    learning.append(learningLabel, learningNote, learningActions);
    const deep = doc.createElement("div"); deep.className = "research-agent-deep";
    const deepToggle = doc.createElement("input"); deepToggle.type = "checkbox";
    const deepLabel = doc.createElement("label"); deepLabel.className = "research-agent-deep-label"; deepLabel.append(deepToggle, doc.createTextNode("深度研究模式"));
    const deepNote = doc.createElement("span"); deepNote.className = "research-agent-deep-note";
    const deepActions = doc.createElement("div"); deepActions.className = "research-agent-deep-actions";
    const resumeResearch = this.button(doc, "继续任务", () => resumeDeepResearch());
    const pauseResearch = this.button(doc, "暂停任务", () => pauseDeepResearch());
    deepActions.append(resumeResearch, pauseResearch); deep.append(deepLabel, deepNote, deepActions);
    const context = doc.createElement("div"); context.className = "research-agent-context";
    const contextLabel = doc.createElement("span"); contextLabel.className = "research-agent-context-label"; contextLabel.textContent = "本会话关联文献";
    const selected = doc.createElement("div"); selected.className = "research-agent-selected-item"; context.append(contextLabel, selected);
    const resources = doc.createElement("div"); resources.className = "research-agent-session-resources";
    const reproduction = doc.createElement("details"); reproduction.className = "research-agent-reproduction";
    const reproductionSummary = doc.createElement("summary"); reproductionSummary.textContent = "代码复现工作区（服务器 Pi）";
    const reproductionBody = doc.createElement("div"); reproductionBody.className = "research-agent-reproduction-body";
    const reproductionNote = doc.createElement("div"); reproductionNote.className = "research-agent-reproduction-note";
    const repositoryInput = doc.createElement("input"); repositoryInput.className = "research-agent-reproduction-input"; repositoryInput.type = "url"; repositoryInput.placeholder = "代码仓库地址（HTTPS 或 SSH）"; repositoryInput.setAttribute("aria-label", "代码仓库地址");
    const reproductionPath = doc.createElement("div"); reproductionPath.className = "research-agent-reproduction-path";
    const reproductionActions = doc.createElement("div"); reproductionActions.className = "research-agent-reproduction-actions";
    const testServer = this.button(doc, "测试服务器", () => testReproductionServer());
    const prepareWorkspace = this.button(doc, "创建/更新工作区", () => prepareReproductionWorkspace());
    const stopReproduction = this.button(doc, "停止", () => stopReproductionTask());
    reproductionActions.append(testServer, prepareWorkspace, stopReproduction);
    const reproductionLog = doc.createElement("div"); reproductionLog.className = "research-agent-reproduction-log";
    const reproductionPrompt = doc.createElement("textarea"); reproductionPrompt.className = "research-agent-reproduction-input research-agent-reproduction-prompt"; reproductionPrompt.placeholder = "告诉 Pi 要复现、运行或排查什么…"; reproductionPrompt.setAttribute("aria-label", "代码复现任务");
    const runReproduction = this.button(doc, "交给 Pi 执行", () => startReproductionTask()); runReproduction.classList.add("research-agent-primary");
    reproductionBody.append(reproductionNote, repositoryInput, reproductionPath, reproductionActions, reproductionLog, reproductionPrompt, runReproduction);
    reproduction.append(reproductionSummary, reproductionBody); resources.append(context, reproduction);
    const quickPrompts = doc.createElement("div"); quickPrompts.className = "research-agent-quick-prompts";
    const quickPromptsLabel = doc.createElement("span"); quickPromptsLabel.className = "research-agent-quick-prompts-label"; quickPromptsLabel.textContent = "论文阅读快捷问题";
    const log = doc.createElement("div"); log.className = "research-agent-log";
    let followLog = true;
    const isNearLogBottom = () => log.scrollHeight - log.scrollTop - log.clientHeight < 36;
    const scrollToLatest = (force = false) => { if (force || followLog) log.scrollTop = log.scrollHeight; };
    log.addEventListener("scroll", () => { followLog = isNearLogBottom(); });
    const composer = doc.createElement("div"); composer.className = "research-agent-composer";
    const input = doc.createElement("textarea"); input.placeholder = "输入你的问题…"; input.setAttribute("aria-label", "向研究助手提问");
    const remaining = doc.createElement("span"); remaining.className = "research-agent-remaining";
    const send = this.button(doc, "发送", () => ask()); send.classList.add("research-agent-primary");
    const sendLine = doc.createElement("div"); sendLine.className = "research-agent-sendline";
    const hint = doc.createElement("span"); hint.className = "research-agent-hint"; hint.textContent = "Enter 发送 · ⌘ / Ctrl + Enter 换行"; sendLine.append(hint, remaining, send);
    composer.append(input, sendLine); chatPanel.append(learning, deep, resources, quickPrompts, log, composer);
    const resizeInput = () => {
      input.style.height = "auto";
      const fixedHeight = [...chatPanel.children]
        .filter((child) => child !== log && child !== composer)
        .reduce((sum, child) => sum + child.getBoundingClientRect().height, 0);
      const available = chatPanel.clientHeight - fixedHeight - sendLine.getBoundingClientRect().height - 28;
      const maxHeight = Math.max(108, Math.min(doc.defaultView.innerHeight * .34, available));
      input.style.height = `${Math.min(Math.max(input.scrollHeight, 108), maxHeight)}px`;
    };
    const updateRemaining = () => {
      const limit = ResearchAgentMemory.limit();
      const left = state.active ? ResearchAgentMemory.remaining(state.active, input.value) : limit;
      const used = Math.max(0, limit - left);
      remaining.textContent = `${this.formatTokens(used)}/${this.formatTokens(limit)}`;
      remaining.classList.toggle("warning", left >= 0 && left < ResearchAgentMemory.limit() * .1);
      remaining.classList.toggle("over", left < 0);
    };
    input.addEventListener("input", () => { resizeInput(); updateRemaining(); });
    input.addEventListener("keydown", (event) => {
      // Plain Enter sends. Modified Enter keeps the textarea's native newline,
      // including Ctrl/⌘+Enter as requested; composition must not be interrupted.
      if (event.key === "Enter" && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) {
        event.preventDefault(); ask();
      }
    });
    const fillQuickPrompt = (prompt) => {
      input.value = prompt; resizeInput(); updateRemaining(); input.focus();
      status.textContent = "已填入快捷问题；可直接发送或继续修改。";
    };
    const readerPrompts = [
      ["概述全文", "请用结构化方式概述本文的研究问题、核心方法、主要结论，以及它试图填补的研究空白。"],
      ["创新贡献", "请提炼本文的创新点与贡献，并区分作者明确主张和可由证据支持的推断。"],
      ["方法实验", "请梳理本文的方法、数据、实验设置、比较基线与评价指标，并指出复现时需要注意的关键细节。"],
      ["结果解读", "请解释本文最重要的实验结果：它们支持什么结论、证据强度如何、是否存在反例或不确定性？"],
      ["局限改进", "请批判性分析本文的局限、潜在偏差、未验证假设，并提出具体可行的改进方向。"],
      ["关联我的研究", "请将本文与我当前的研究问题建立联系：哪些观点、方法或结论值得借鉴？还需要补足哪些证据？"]
    ];
    quickPrompts.append(quickPromptsLabel);
    for (const [label, prompt] of readerPrompts) quickPrompts.append(this.button(doc, label, () => fillQuickPrompt(prompt)));
    const learningPrompts = [
      ["制定学习路线", "请基于当前主题或论文，给我一个不超过三步的学习路线：先讲最关键的直觉，再带我逐步掌握。先从第一步开始，并在结尾问我一个能检验理解的问题。"],
      ["开始诊断", "请先用一个简短、基于当前材料的诊断问题判断我的起点。一次只问一题；我回答后再给针对性反馈和下一步。"],
      ["给一条提示", "我暂时卡住了。请不要直接给完整答案，先给我一条最小提示，帮助我自己迈出下一步。"],
      ["总结本轮", "请简短总结这一轮我已经理解的内容、仍可能混淆的一点，以及下一次最值得练习的一个问题。" ]
    ];
    const enableLearning = async () => {
      if (!state.active?.learning?.enabled) {
        state.active.learning = { enabled: true };
        await ResearchAgentStorage.saveConversation(state.active);
        state.summaries = await ResearchAgentStorage.listConversations();
        renderSessions();
      }
      renderLearningMode();
    };
    for (const [label, prompt] of learningPrompts) {
      const button = this.button(doc, label, () => enableLearning().then(() => fillQuickPrompt(prompt)).catch((error) => { Zotero.logError(error); status.textContent = `无法启用学习辅导：${error.message}`; }));
      learningActions.append(button);
    }
    const receiveSelectedText = ({ text, title, preset }) => {
      const quote = text.split(/\r?\n/).map((line) => `> ${line}`).join("\n");
      input.value = `${preset || "我在下列论文选段中遇到了问题，请帮我分析："}\n\n论文：《${title}》\n\n${quote}\n\n`;
      activate("chat"); resizeInput(); updateRemaining(); input.focus();
      status.textContent = "已将论文选中文本添加到输入框；补充问题后即可发送。";
    };
    this.selectionListeners.add(receiveSelectedText);
    if (this.pendingSelection) receiveSelectedText(this.pendingSelection);

    const currentItem = () => {
      const item = Zotero.getActiveZoteroPane()?.getSelectedItems()?.[0];
      return item?.isRegularItem?.() ? item : item?.parentItem;
    };
    const renderLearningMode = () => {
      const enabled = Boolean(state.active?.learning?.enabled);
      learningToggle.checked = enabled;
      learning.classList.toggle("is-enabled", enabled);
      learningNote.textContent = enabled
        ? "短讲解后只问一个可回答的问题；会根据你的回答给提示或纠偏。可随时要求直接讲解。"
        : "开启后，助手会用讲解、单题检查和针对性提示带你逐步理解；模式按会话保存。";
    };
    const renderDeepResearch = () => {
      const task = state.researchTask;
      deepToggle.checked = Boolean(state.deepResearch);
      deep.classList.toggle("is-enabled", Boolean(state.deepResearch));
      const active = task && ["pending", "planning", "researching", "paused", "failed"].includes(task.status);
      resumeResearch.hidden = !active;
      pauseResearch.hidden = !task || !["pending", "planning", "researching"].includes(task.status);
      if (task) {
        const evidence = task.evidence?.length || 0;
        const usage = task.usage || {};
        deepNote.textContent = task.status === "completed"
          ? `最近任务已完成：${evidence} 条证据、${usage.toolCalls || 0} 次工具调用。`
          : `任务${task.status === "paused" ? "已暂停" : "可继续"}：${evidence} 条证据、${usage.toolCalls || 0}/${task.budget?.maxToolCalls || 12} 次工具调用。`;
      } else {
        deepNote.textContent = state.deepResearch
          ? "发送后会先规划、检索并建立证据账本；任务可在中断后继续。"
          : "适合复杂综述、方案比较和需要多源证据的问题；普通提问保持直接回答。";
      }
    };
    const refreshResearchTask = async () => {
      state.researchTask = await ResearchAgentResearch.latestResumable(state.active?.id);
      renderDeepResearch();
    };
    const pauseDeepResearch = async () => {
      if (!state.researchTask) return;
      await ResearchAgentResearch.pause(state.researchTask, "用户在界面中暂停任务。");
      renderDeepResearch();
      status.textContent = "已保存深度研究进度；可随时继续任务。";
    };
    const resumeDeepResearch = async () => {
      const task = state.researchTask;
      if (!task || send.disabled) return;
      state.deepResearch = true;
      deepToggle.checked = true;
      await ask({ question: task.question, existingMessage: true, researchTask: task });
    };
    const renderReproduction = () => {
      const session = state.reproduction;
      const configuration = ResearchAgentReproduction.configuration();
      const configured = Boolean(configuration.host && configuration.projectRoot);
      if (doc.activeElement !== repositoryInput) repositoryInput.value = session?.repositoryURL || "";
      repositoryInput.disabled = !configured;
      testServer.disabled = !configured || session?.status === "connecting";
      prepareWorkspace.disabled = !configured || !session?.repositoryURL || ["preparing", "running"].includes(session?.status);
      runReproduction.disabled = !configured || !session?.workspaceReady || ["running", "preparing", "connecting"].includes(session?.status);
      stopReproduction.hidden = session?.status !== "running";
      reproductionPath.textContent = session?.serverPath ? `服务器工作区：${session.serverPath}` : "工作区：填写仓库地址后将显示在统一项目根目录下的位置。";
      reproductionNote.textContent = configured
        ? `${configuration.title || "复现服务器"}：${configuration.username ? `${configuration.username}@` : ""}${configuration.host}:${configuration.port}。项目内 .venv；不使用全局 Conda。`
        : "请先在 Zotero 设置 → 研究助手 → 服务器代码复现（Pi）填写 SSH 配置别名和服务器项目根目录。";
      reproductionLog.replaceChildren();
      const history = [...(session?.messages || []).slice(-4), ...(session?.events || []).slice(-3).map((event) => ({ role: "event", content: event.text }))];
      if (session?.status === "running" && session.liveAnswer) history.push({ role: "assistant", content: session.liveAnswer });
      if (!history.length) {
        const empty = doc.createElement("div"); empty.className = "research-agent-reproduction-entry";
        empty.textContent = "本会话的仓库与 Pi 对话会保存在本地。先测试服务器，再创建工作区。";
        reproductionLog.append(empty);
      }
      for (const entry of history) {
        const line = doc.createElement("div"); line.className = `research-agent-reproduction-entry${entry.role === "user" ? " is-user" : ""}`;
        line.textContent = `${entry.role === "user" ? "你：" : entry.role === "assistant" ? "Pi：" : "状态："}${entry.content || ""}`;
        reproductionLog.append(line);
      }
    };
    const refreshReproduction = async () => {
      state.reproduction = state.active ? await ResearchAgentReproduction.forConversation(state.active) : null;
      renderReproduction();
    };
    const saveReproductionRepository = async () => {
      if (!state.reproduction) await refreshReproduction();
      state.reproduction = await ResearchAgentReproduction.setRepository(state.reproduction, repositoryInput.value);
      renderReproduction();
      return state.reproduction;
    };
    const testReproductionServer = async () => {
      try {
        if (!state.reproduction) await refreshReproduction();
        status.textContent = "正在测试服务器与 Pi…";
        await ResearchAgentReproduction.testConnection(state.reproduction);
        renderReproduction(); status.textContent = "服务器与 Pi 连接正常。";
      } catch (error) { Zotero.logError(error); renderReproduction(); status.textContent = `服务器连接失败：${error.message}`; }
    };
    const prepareReproductionWorkspace = async () => {
      try {
        const session = await saveReproductionRepository();
        status.textContent = "正在创建或更新服务器工作区…";
        await ResearchAgentReproduction.prepareWorkspace(session);
        renderReproduction(); status.textContent = "服务器工作区已就绪。";
      } catch (error) { Zotero.logError(error); renderReproduction(); status.textContent = `无法准备工作区：${error.message}`; }
    };
    const startReproductionTask = async () => {
      try {
        const session = await saveReproductionRepository();
        await ResearchAgentReproduction.startPi(session, reproductionPrompt.value, { onUpdate: (updated) => { if (state.reproduction?.id === updated.id) { state.reproduction = updated; renderReproduction(); } } });
        reproductionPrompt.value = ""; renderReproduction(); status.textContent = "Pi 正在服务器上执行；可继续阅读或切换 Zotero 页面。";
      } catch (error) { Zotero.logError(error); renderReproduction(); status.textContent = `无法启动 Pi：${error.message}`; }
    };
    const stopReproductionTask = async () => {
      if (!state.reproduction) return;
      await ResearchAgentReproduction.cancel(state.reproduction);
      renderReproduction(); status.textContent = "已请求停止代码复现任务。";
    };
    repositoryInput.addEventListener("change", () => saveReproductionRepository().catch((error) => { Zotero.logError(error); status.textContent = `无法保存仓库地址：${error.message}`; renderReproduction(); }));
    reproductionPrompt.addEventListener("keydown", (event) => {
      if (event.key === "Enter" && !event.isComposing && !event.metaKey && !event.ctrlKey && !event.altKey && !event.shiftKey) { event.preventDefault(); startReproductionTask(); }
    });
    deepToggle.addEventListener("change", () => { state.deepResearch = deepToggle.checked; renderDeepResearch(); });
    learningToggle.addEventListener("change", () => {
      if (!state.active) return;
      state.active.learning = { enabled: learningToggle.checked };
      ResearchAgentStorage.saveConversation(state.active).then(async () => {
        state.summaries = await ResearchAgentStorage.listConversations();
        renderSessions(); renderLearningMode();
        status.textContent = learningToggle.checked ? "已开启学习辅导模式。" : "已关闭学习辅导模式。";
      }).catch((error) => { Zotero.logError(error); status.textContent = `无法保存学习辅导设置：${error.message}`; renderLearningMode(); });
    });
    const renderSessions = () => {
      sessionList.replaceChildren();
      for (const summary of state.summaries) {
        const card = doc.createElement("article"); card.className = "research-agent-session-card";
        card.classList.toggle("is-active", summary.id === state.active?.id);
        const entry = this.button(doc, summary.title, () => loadSession(summary.id));
        entry.classList.add("research-agent-session-item");
        entry.title = summary.title;
        const paper = doc.createElement("div"); paper.className = "research-agent-session-paper";
        paper.textContent = `关联文献：${summary.paper?.title || "未关联文献"} · ${this.shortDate(summary.updatedAt)}`;
        paper.title = summary.paper?.title || "未关联文献";
        const actions = doc.createElement("div"); actions.className = "research-agent-session-actions";
        const remove = this.button(doc, "删除会话", () => deleteSession(summary.id));
        remove.classList.add("research-agent-session-delete");
        remove.title = `删除会话：${summary.title}`;
        actions.append(remove);
        card.append(entry, paper, actions); sessionList.append(card);
      }
    };
    const renderCitations = (target, citations) => {
      if (!citations?.length) return;
      const box = doc.createElement("div"); box.className = "research-agent-citations has-items";
      const title = doc.createElement("div"); title.className = "research-agent-citations-title"; title.textContent = "引用文献与来源";
      const list = doc.createElement("div"); list.className = "research-agent-citation-list";
      for (const citation of citations) { const entry = citation.url ? doc.createElement("a") : doc.createElement("span"); entry.className = "research-agent-citation"; entry.textContent = citation.label || citation.value; if (citation.url) { entry.href = citation.url; entry.target = "_blank"; } list.append(entry); }
      box.append(title, list); target.append(box);
    };
    const copyText = async (text) => {
      const value = String(text || "");
      try {
        if (doc.defaultView.navigator.clipboard?.writeText) await doc.defaultView.navigator.clipboard.writeText(value);
        else {
          const area = doc.createElement("textarea"); area.value = value; area.setAttribute("aria-hidden", "true"); area.style.cssText = "position:fixed;left:-9999px;top:0";
          doc.body.append(area); area.select();
          if (!doc.execCommand("copy")) throw new Error("浏览器拒绝复制请求。");
          area.remove();
        }
        status.textContent = "已复制到剪贴板。";
      } catch (error) { Zotero.logError(error); status.textContent = "复制失败，请手动选择文本复制。"; }
    };
    const renderConversation = () => {
      log.replaceChildren();
      if (!state.active) return;
      sessionTitle.textContent = state.active.title || "新对话";
      selected.textContent = state.active.paper?.title || "未关联文献；可在会话面板中关联当前文献。";
      renderLearningMode();
      renderDeepResearch();
      renderReproduction();
      if (!state.active.messages.length) {
        const greetingText = "这是一个本地保存的新会话。你可以提问，或先关联一篇当前文献。";
        const greeting = this.addMessage(doc, log, "助手", greetingText, false);
        const greetingActions = doc.createElement("div"); greetingActions.className = "research-agent-message-actions";
        greetingActions.append(this.button(doc, "复制", () => copyText(greetingText))); greeting.append(greetingActions);
      }
      for (const message of state.active.messages) {
        const item = this.addMessage(doc, log, message.role === "user" ? "你" : "助手", message.content, message.role === "user", message.role === "assistant" ? message.citations : null, message.role === "assistant" ? message.evidence : null);
        const actions = doc.createElement("div"); actions.className = "research-agent-message-actions";
        if (message.role === "user") {
          actions.append(this.button(doc, "复制", () => copyText(message.content)), this.button(doc, "编辑", () => editMessage(message, item)), this.button(doc, "撤回", () => retractMessage(message)));
        } else {
          actions.append(this.button(doc, "复制", () => copyText(message.content)), this.button(doc, "编辑", () => editMessage(message, item)), this.button(doc, "撤回此轮", () => retractAssistantTurn(message)));
        }
        item.append(actions);
      }
      followLog = true; scrollToLatest(true);
      updateRemaining();
    };
    const persistActiveID = async () => { const appState = await ResearchAgentStorage.getState(); appState.activeConversationID = state.active?.id || null; await ResearchAgentStorage.saveState(appState); };
    const syncPaper = async () => {
      if (!syncToggle.checked || !state.active?.paper?.itemID) return;
      try {
        const paper = Zotero.Items.get(state.active.paper.itemID);
        const attachment = paper?.isRegularItem?.() ? await paper.getBestAttachment() : null;
        // A reader tab preserves the paper-reading context. Selecting the item in the main
        // library is only a fallback for records that do not have a readable attachment.
        if (attachment?.attachmentReaderType) {
          await Zotero.Reader.open(attachment.id);
          return;
        }
        await Zotero.getActiveZoteroPane().selectItem(state.active.paper.itemID);
      } catch (error) { Zotero.logError(error); status.textContent = "无法打开关联论文，已保留当前页面。"; }
    };
    const loadSession = async (id) => {
      const request = ++state.switchRequest;
      if (state.active?.id !== id) status.textContent = "正在切换会话…";
      const conversation = await ResearchAgentStorage.getConversation(id);
      // A second click or a later selection always wins; an older async read must
      // never redraw the previous conversation after the paper has already changed.
      if (!conversation || request !== state.switchRequest) return;
      state.active = conversation;
      await persistActiveID();
      if (request !== state.switchRequest) return;
      await refreshResearchTask();
      await refreshReproduction();
      renderSessions();
      renderConversation();
      // Show the selected session immediately. Paper synchronisation may cause Zotero
      // to re-render the pane, in which case the persisted activeConversationID restores it.
      activate("chat");
      await syncPaper();
      if (request !== state.switchRequest) return;
      status.textContent = "已切换会话。";
    };
    const createSession = async () => {
      state.active = await ResearchAgentStorage.createConversation({ item: currentItem() || initialItem });
      state.researchTask = null;
      await refreshReproduction();
      state.summaries = await ResearchAgentStorage.listConversations(); await persistActiveID(); renderSessions(); renderConversation(); status.textContent = "已创建新会话。";
    };
    const deleteSession = async (id) => {
      if (send.disabled) { status.textContent = "请等待当前回答结束后再删除会话。"; return; }
      const summary = state.summaries.find((entry) => entry.id === id);
      if (!summary) return;
      if (!doc.defaultView.confirm(`确定删除会话“${summary.title}”？此操作不能恢复；已生成的研究笔记会保留。`)) return;
      ++state.switchRequest;
      await ResearchAgentStorage.deleteConversation(id);
      state.summaries = await ResearchAgentStorage.listConversations();
      if (state.active?.id === id) {
        state.active = state.summaries[0] ? await ResearchAgentStorage.getConversation(state.summaries[0].id) : null;
        if (!state.active) state.active = await ResearchAgentStorage.createConversation({ item: currentItem() || initialItem });
        state.summaries = await ResearchAgentStorage.listConversations();
        await persistActiveID();
      }
      await refreshResearchTask();
      await refreshReproduction();
      renderSessions();
      renderConversation();
      status.textContent = "会话已删除。";
    };
    const bindCurrentPaper = async () => {
      const item = currentItem();
      if (!item) { status.textContent = "请先在左侧文献列表选中一篇论文。"; return; }
      state.active.paper = ResearchAgentStorage.paperFromItem(item); await ResearchAgentStorage.saveConversation(state.active);
      if (state.reproduction) { state.reproduction.paper = state.active.paper; await ResearchAgentStorage.saveReproductionSession(state.reproduction); }
      state.summaries = await ResearchAgentStorage.listConversations(); renderSessions(); renderConversation(); status.textContent = "已关联当前文献。";
    };
    const saveEditedMessage = async (message, content, resend) => {
      const revised = content.trim();
      if (!revised) { status.textContent = "消息不能为空。"; return; }
      await ResearchAgentStorage.editAndRetractAfter(state.active, message.id, revised);
      state.summaries = await ResearchAgentStorage.listConversations();
      renderSessions();
      renderConversation();
      if (resend && message.role === "user") {
        status.textContent = "已保存修改，正在重新发送…";
        await ask({ question: revised, existingMessage: true });
      } else {
        status.textContent = "修改已保存，后续消息已撤回。";
      }
    };
    const editMessage = (message, item) => {
      if (send.disabled) { status.textContent = "请等待当前回答结束后再编辑。"; return; }
      const content = item.querySelector(".research-agent-message-content");
      const actions = item.querySelector(".research-agent-message-actions");
      if (!content || !actions || item.classList.contains("is-editing")) return;
      item.classList.add("is-editing");
      const editor = doc.createElement("textarea"); editor.className = "research-agent-edit-box"; editor.value = message.content;
      editor.setAttribute("aria-label", "编辑消息内容");
      content.replaceWith(editor);
      const cancel = this.button(doc, "取消", () => renderConversation());
      const save = this.button(doc, "保存修改", () => saveEditedMessage(message, editor.value, false).catch((error) => { Zotero.logError(error); status.textContent = `错误：${error.message}`; }));
      actions.classList.add("research-agent-edit-actions");
      actions.replaceChildren(cancel, save);
      if (message.role === "user") {
        const resend = this.button(doc, "保存并重新发送", () => saveEditedMessage(message, editor.value, true).catch((error) => { Zotero.logError(error); status.textContent = `错误：${error.message}`; }));
        resend.classList.add("research-agent-primary");
        actions.append(resend);
      }
      editor.focus(); editor.setSelectionRange(editor.value.length, editor.value.length);
    };
    const retractMessage = async (message) => {
      if (!doc.defaultView.confirm("撤回这条消息及其后的内容？")) return;
      await ResearchAgentStorage.retractFrom(state.active, message.id); state.summaries = await ResearchAgentStorage.listConversations(); renderSessions(); renderConversation(); status.textContent = "已撤回。";
    };
    const retractAssistantTurn = async (message) => {
      const index = state.active.messages.findIndex((entry) => entry.id === message.id);
      const user = [...state.active.messages.slice(0, index)].reverse().find((entry) => entry.role === "user");
      if (user) await retractMessage(user);
    };
    const ask = async ({ question: suppliedQuestion, existingMessage = false } = {}) => {
      const question = String(suppliedQuestion ?? input.value).trim();
      if (!question || send.disabled || !state.active) return;
      const paper = currentItem() || (state.active.paper?.itemID ? Zotero.Items.get(state.active.paper.itemID) : null);
      let ragConfig = { enabled: true, collectionIDs: [], useSemantic: false };
      if (paper) {
        try { ragConfig = { ...ragConfig, paperContext: await ResearchAgentIndexer.paperContext(paper) }; }
        catch (error) { Zotero.logError(error); status.textContent = `无法读取当前论文，将继续使用知识库与联网工具：${error.message}`; }
      }
      const wikiArticleKey = (currentItem() || (state.active.paper?.itemID ? Zotero.Items.get(state.active.paper.itemID) : null))?.key || state.active.paper?.key;
      let wikiContext = "";
      if (wikiArticleKey) {
        try { wikiContext = await ResearchAgentWiki.contextForArticle(wikiArticleKey, question); }
        catch (error) { Zotero.logError(error); }
      }
      let task = researchTask || null;
      if (!task && state.deepResearch) {
        task = await ResearchAgentResearch.create({ question, conversationID: state.active.id, paper: state.active.paper || null });
        state.researchTask = task;
        renderDeepResearch();
      }
      if (!existingMessage) {
        await ResearchAgentStorage.appendMessage(state.active, "user", question);
        state.summaries = await ResearchAgentStorage.listConversations(); renderSessions();
        this.addMessage(doc, log, "你", question, true);
      }
      input.value = ""; resizeInput(); updateRemaining(); send.disabled = true; status.textContent = "正在检索、整理记忆并生成回答…";
      followLog = true; scrollToLatest(true);
      const responseView = this.createResponseView(doc, log, scrollToLatest);
      try {
        const result = await ResearchAgentAgent.answer(question, { conversation: state.active, rag: ragConfig, learning: state.active.learning, wikiContext, deepResearch: Boolean(task), researchTask: task, onEvent: (event) => responseView.handle(event) });
        responseView.finish(result);
        state.researchTask = result.researchTask || state.researchTask;
        await ResearchAgentStorage.appendMessage(state.active, "assistant", result.answer, { citations: result.citations, evidence: result.evidence || [], researchTaskID: result.researchTask?.id || null, trace: responseView.trace() });
        state.summaries = await ResearchAgentStorage.listConversations(); renderSessions(); renderConversation(); updateRemaining(); status.textContent = "回答完成，已保存到本地会话文件。";
      } catch (error) { if (task?.status !== "paused") await ResearchAgentResearch.fail(task, error); Zotero.logError(error); responseView.fail(error); renderDeepResearch(); status.textContent = `错误：${error.message}`; }
      finally { send.disabled = false; input.focus(); }
    };
    const initializeSessions = async () => {
      state.summaries = await ResearchAgentStorage.listConversations();
      const appState = await ResearchAgentStorage.getState();
      const preferred = appState.activeConversationID && await ResearchAgentStorage.getConversation(appState.activeConversationID);
      state.active = preferred || (state.summaries[0] && await ResearchAgentStorage.getConversation(state.summaries[0].id));
      if (!state.active) state.active = await ResearchAgentStorage.createConversation({ item: initialItem });
      await refreshResearchTask();
      await refreshReproduction();
      state.summaries = await ResearchAgentStorage.listConversations(); renderSessions(); renderConversation(); status.textContent = "就绪。会话均保存于本地独立文件。";
    };

    const indexCard = doc.createElement("div"); indexCard.className = "research-agent-card";
    const indexTitle = doc.createElement("div"); indexTitle.className = "research-agent-card-title"; indexTitle.textContent = "嵌入文献";
    const indexCopy = doc.createElement("p"); indexCopy.className = "research-agent-card-copy"; indexCopy.textContent = "嵌入任务在后台顺序执行，不会阻塞 Zotero 的其他操作。";
    const actions = doc.createElement("div"); actions.className = "research-agent-actions";
    const progress = doc.createElement("progress"); progress.className = "research-agent-progress"; progress.max = 1; progress.value = 0;
    const updateProgress = (event) => { progress.max = Math.max(1, event.total); progress.value = event.completed; status.textContent = `${event.label}：${event.completed}/${event.total} 篇文献${event.cancelled ? "（正在取消）" : ""}`; };
    const startJob = async (start) => { try { const job = await start(updateProgress); updateProgress(job); const result = await job.promise; status.textContent = `${result.state}：已处理 ${result.completed}/${result.total} 篇文献。`; await refreshEntries(); } catch (error) { Zotero.logError(error); status.textContent = `错误：${error.message}`; } };
    actions.append(this.button(doc, "嵌入当前分类", () => startJob((callback) => ResearchAgentIndexer.startCurrentCollection(callback))), this.button(doc, "嵌入所选文献", () => startJob((callback) => ResearchAgentIndexer.startSelectedArticles(callback))), this.button(doc, "嵌入全部文献", () => startJob((callback) => ResearchAgentIndexer.startAllArticles(callback))), this.button(doc, "取消任务", () => ResearchAgentJobs.cancel())); indexCard.append(indexTitle, indexCopy, actions, progress);
    const management = doc.createElement("div"); management.className = "research-agent-card";
    const managementTitle = doc.createElement("div"); managementTitle.className = "research-agent-card-title"; managementTitle.textContent = "知识库条目";
    const entryCopy = doc.createElement("p"); entryCopy.className = "research-agent-card-copy"; entryCopy.textContent = "选择条目后可重嵌入或从本地知识库移除；不会删除 Zotero 中的原始文献。";
    const entries = doc.createElement("select"); entries.className = "research-agent-entry-list"; entries.multiple = true; entries.size = 7;
    const selectedKeys = () => [...entries.selectedOptions].map((option) => option.value);
    const refreshEntries = async () => { const records = await ResearchAgentIndexer.listEntries(); entries.replaceChildren(); for (const record of records) { const option = doc.createElement("option"); option.value = record.key; option.textContent = `${record.title} [${record.key}] — ${record.collectionPath.join(" / ")}`; entries.append(option); } if (!records.length) { const option = doc.createElement("option"); option.disabled = true; option.textContent = "尚未嵌入任何文献"; entries.append(option); } };
    const wikiCard = doc.createElement("div"); wikiCard.className = "research-agent-card research-agent-wiki-card";
    const wikiTitle = doc.createElement("div"); wikiTitle.className = "research-agent-card-title"; wikiTitle.textContent = "研究 Wiki";
    const wikiCopy = doc.createElement("p"); wikiCopy.className = "research-agent-card-copy"; wikiCopy.textContent = "每篇入库文献都会成为一个本地 Wiki 节点。入库时，当前对话模型会提炼研究概要、领域、方法和可追溯的文献关系；关系始终保存在本机，可随时重建。";
    const wikiToolbar = doc.createElement("div"); wikiToolbar.className = "research-agent-wiki-toolbar";
    const wikiMeta = doc.createElement("span"); wikiMeta.className = "research-agent-wiki-meta";
    const wikiGraph = doc.createElement("div"); wikiGraph.className = "research-agent-wiki-graph";
    const wikiDetail = doc.createElement("div"); wikiDetail.className = "research-agent-wiki-detail";
    const wikiLegend = doc.createElement("div"); wikiLegend.className = "research-agent-wiki-legend";
    for (const [type, label] of Object.entries(ResearchAgentWiki.relationTypes)) { const chip = doc.createElement("span"); chip.textContent = label; chip.dataset.type = type; wikiLegend.append(chip); }
    let selectedWikiKey = null;
    const shortWikiText = (text, length = 20) => { const value = String(text || "未命名文献").replace(/\s+/g, " ").trim(); return value.length > length ? `${value.slice(0, Math.max(1, length - 1))}…` : value; };
    const renderWikiDetail = (node, wiki, selectedEdges = []) => {
      wikiDetail.replaceChildren();
      if (!node) { wikiDetail.textContent = "单击图谱中的文献节点，可查看它的研究概要、方法标签和关系依据。"; return; }
      const title = doc.createElement("div"); title.className = "research-agent-wiki-detail-title"; title.textContent = node.title;
      const summary = doc.createElement("p"); summary.textContent = node.summary || "暂无模型生成的研究概要；可在填写对话模型后使用“为已入库文献补建 Wiki”。";
      const metadata = doc.createElement("p"); metadata.textContent = `领域：${node.domain || "未标注"}${node.collectionPath?.length ? ` · 分类：${node.collectionPath.join(" / ")}` : ""}`;
      const chips = doc.createElement("div"); chips.className = "research-agent-wiki-chips";
      for (const method of node.methods || []) { const chip = doc.createElement("span"); chip.textContent = method; chips.append(chip); }
      wikiDetail.append(title, summary, metadata); if (chips.childElementCount) wikiDetail.append(chips);
      if (selectedEdges.length) {
        const relation = doc.createElement("p");
        relation.textContent = `关联：${selectedEdges.map((edge) => `${ResearchAgentWiki.relationLabel(edge.type)}${edge.reason ? `（${edge.reason}）` : ""}`).join("；")}`;
        wikiDetail.append(relation);
      }
    };
    const renderWiki = async () => {
      const wiki = await ResearchAgentWiki.getGraph();
      const nodes = Object.values(wiki.nodes || {}).sort((a, b) => String(a.title).localeCompare(String(b.title), "zh-CN"));
      const nodeKeys = new Set(nodes.map((node) => node.key));
      const edges = (wiki.edges || []).filter((edge) => nodeKeys.has(edge.source) && nodeKeys.has(edge.target));
      wikiMeta.textContent = `${nodes.length} 篇文献 · ${edges.length} 条关系${wiki.updatedAt ? ` · 更新于 ${this.shortDate(wiki.updatedAt)}` : ""}`;
      wikiGraph.replaceChildren();
      if (!nodes.length) {
        const empty = doc.createElement("div"); empty.className = "research-agent-wiki-empty"; empty.textContent = "还没有 Wiki 节点。先嵌入一篇文献，或在已有嵌入后点击“为已入库文献补建 Wiki”。";
        wikiGraph.append(empty); renderWikiDetail(null, wiki); return;
      }
      if (!nodeKeys.has(selectedWikiKey)) selectedWikiKey = nodes[0].key;
      const columns = Math.max(3, Math.ceil(Math.sqrt(nodes.length)));
      const width = Math.max(520, columns * 160);
      const rows = Math.ceil(nodes.length / columns);
      const height = Math.max(270, rows * 118 + 52);
      const positions = new Map(nodes.map((node, index) => [node.key, { x: 78 + (index % columns) * ((width - 156) / Math.max(1, columns - 1)), y: 56 + Math.floor(index / columns) * ((height - 112) / Math.max(1, rows - 1 || 1)) }]));
      const svg = doc.createElementNS("http://www.w3.org/2000/svg", "svg"); svg.setAttribute("class", "research-agent-wiki-svg"); svg.setAttribute("width", String(width)); svg.setAttribute("height", String(height)); svg.setAttribute("viewBox", `0 0 ${width} ${height}`);
      for (const edge of edges) {
        const start = positions.get(edge.source); const end = positions.get(edge.target); if (!start || !end) continue;
        const line = doc.createElementNS("http://www.w3.org/2000/svg", "line"); line.setAttribute("class", "research-agent-wiki-edge"); line.setAttribute("x1", start.x); line.setAttribute("y1", start.y); line.setAttribute("x2", end.x); line.setAttribute("y2", end.y); svg.append(line);
      }
      const selectNode = (key) => { selectedWikiKey = key; renderWiki().catch((error) => { Zotero.logError(error); }); };
      for (const node of nodes) {
        const position = positions.get(node.key); const group = doc.createElementNS("http://www.w3.org/2000/svg", "g"); group.setAttribute("class", `research-agent-wiki-node${node.key === selectedWikiKey ? " is-selected" : ""}`); group.setAttribute("transform", `translate(${position.x} ${position.y})`); group.setAttribute("tabindex", "0"); group.setAttribute("role", "button"); group.setAttribute("aria-label", node.title); group.addEventListener("click", () => selectNode(node.key)); group.addEventListener("keydown", (event) => { if (event.key === "Enter" || event.key === " ") { event.preventDefault(); selectNode(node.key); } });
        const circle = doc.createElementNS("http://www.w3.org/2000/svg", "circle"); circle.setAttribute("r", "37"); group.append(circle);
        const title = doc.createElementNS("http://www.w3.org/2000/svg", "title"); title.textContent = `${node.title}\n${node.summary || ""}`; group.append(title);
        const text = doc.createElementNS("http://www.w3.org/2000/svg", "text"); text.setAttribute("text-anchor", "middle"); text.setAttribute("dy", "-3"); text.textContent = shortWikiText(node.title, 18); group.append(text);
        const domain = doc.createElementNS("http://www.w3.org/2000/svg", "text"); domain.setAttribute("text-anchor", "middle"); domain.setAttribute("dy", "13"); domain.setAttribute("font-size", "9"); domain.textContent = shortWikiText(node.domain || "未标注", 14); group.append(domain);
        svg.append(group);
      }
      wikiGraph.append(svg);
      const selectedNode = wiki.nodes[selectedWikiKey];
      renderWikiDetail(selectedNode, wiki, edges.filter((edge) => edge.source === selectedWikiKey || edge.target === selectedWikiKey));
    };
    const refreshKnowledge = async () => { await Promise.all([refreshEntries(), renderWiki()]); };
    const entryActions = doc.createElement("div"); entryActions.className = "research-agent-actions";
    const checkTools = async () => {
      status.textContent = "正在检查本地知识库、网页、arXiv 与 GitHub 源码工具…";
      try {
        const checks = await ResearchAgentTools.healthCheck();
        status.textContent = checks.map((check) => `${check.ok ? "✓" : "×"} ${check.name}：${check.detail}`).join("； ");
      } catch (error) {
        Zotero.logError(error); status.textContent = `工具检查失败：${error.message}`;
      }
    };
    entryActions.append(this.button(doc, "刷新", refreshKnowledge), this.button(doc, "重嵌入所选", () => startJob((callback) => ResearchAgentIndexer.startReembedEntries(selectedKeys(), callback))), this.button(doc, "移除所选", async () => { const keys = selectedKeys(); if (!keys.length || !doc.defaultView.confirm(`从本地知识库移除 ${keys.length} 个条目？Zotero 原始文献不会被删除。`)) return; status.textContent = await ResearchAgentIndexer.removeEntries(keys); await refreshKnowledge(); }), this.button(doc, "检查工具可用性", checkTools), this.button(doc, "检查并更新会话笔记", () => generateTodayNote()));
    const rebuildWiki = async () => {
      try {
        const job = await ResearchAgentIndexer.rebuildWiki(updateProgress);
        updateProgress(job);
        const result = await job.promise;
        status.textContent = `${result.state}：已生成 ${result.completed}/${result.total} 篇文献的 Wiki 关系。`;
        await renderWiki();
      } catch (error) { Zotero.logError(error); status.textContent = `无法构建研究 Wiki：${error.message}`; }
    };
    wikiToolbar.append(this.button(doc, "刷新关系图", () => renderWiki().catch((error) => { Zotero.logError(error); status.textContent = `无法刷新关系图：${error.message}`; })), this.button(doc, "为已入库文献补建 Wiki", rebuildWiki), wikiMeta);
    wikiCard.append(wikiTitle, wikiCopy, wikiToolbar, wikiLegend, wikiGraph, wikiDetail);
    management.append(managementTitle, entryCopy, entries, entryActions); knowledgePanel.append(indexCard, wikiCard, management);
    const notesCard = doc.createElement("div"); notesCard.className = "research-agent-card research-agent-notes-card";
    const notesTitle = doc.createElement("div"); notesTitle.className = "research-agent-card-title"; notesTitle.textContent = "会话研究笔记";
    const notesCopy = doc.createElement("p"); notesCopy.className = "research-agent-card-copy"; notesCopy.textContent = "每个会话对应一份持续演化的本地 Markdown 笔记。每日会自动检查，只更新内容发生变化的会话；笔记会保留关注点假设、证据缺口、可验证下一步与延展性反问。";
    const noteActions = doc.createElement("div"); noteActions.className = "research-agent-note-actions";
    const noteLayout = doc.createElement("div"); noteLayout.className = "research-agent-notes-layout";
    const noteList = doc.createElement("div"); noteList.className = "research-agent-note-list";
    const notePreview = doc.createElement("div"); notePreview.className = "research-agent-note-preview";
    let activeNoteFilename = null; let activeNoteContent = "";
    const renderNotes = async (requestedFilename = activeNoteFilename) => {
      const notes = await ResearchAgentStorage.listNotes();
      noteList.replaceChildren(); notePreview.replaceChildren();
      if (!notes.length) {
        const empty = doc.createElement("div"); empty.className = "research-agent-note-empty"; empty.textContent = "还没有笔记。完成一轮对话后，可点击“检查并更新会话笔记”。";
        notePreview.append(empty); activeNoteFilename = null; activeNoteContent = ""; return;
      }
      const active = notes.find((note) => note.filename === requestedFilename) || notes[0];
      activeNoteFilename = active.filename;
      for (const note of notes) {
        const item = this.button(doc, "", () => renderNotes(note.filename));
        item.classList.add("research-agent-note-item"); item.classList.toggle("is-active", note.filename === active.filename);
        const title = doc.createElement("span"); title.className = "research-agent-note-title"; title.textContent = note.title; title.title = note.title;
        const meta = doc.createElement("small"); meta.textContent = `${note.questionCount || 0} 个问题 · ${note.focusCount || 0} 个关注点 · ${note.nextStepCount || 0} 个下一步`;
        item.append(title, meta); noteList.append(item);
      }
      activeNoteContent = await ResearchAgentStorage.getNote(active.filename) || "";
      const meta = doc.createElement("div"); meta.className = "research-agent-context-label"; meta.textContent = `会话笔记 · ${active.questionCount || 0} 个问题 · ${active.focusCount || 0} 个关注点 · ${active.nextStepCount || 0} 个下一步`;
      const content = doc.createElement("div"); content.className = "research-agent-message-content"; ResearchAgentMarkdown.render(doc, content, activeNoteContent);
      notePreview.append(meta, content);
      if (active.citations?.length) this.addCitations(doc, notePreview, active.citations.map((label) => ({ label })));
    };
    const generateTodayNote = async () => {
      try { status.textContent = "正在检查会话变动并更新对应笔记…"; const result = await ResearchAgentDailyNotes.runNow(); await renderNotes(); status.textContent = result; }
      catch (error) { Zotero.logError(error); status.textContent = `生成笔记失败：${error.message}`; }
    };
    noteActions.append(
      this.button(doc, "检查并更新会话笔记", generateTodayNote),
      this.button(doc, "刷新列表", () => renderNotes()),
      this.button(doc, "复制当前笔记", () => copyText(activeNoteContent)),
      this.button(doc, "在默认程序打开", async () => { if (!activeNoteFilename) return; await ResearchAgentStorage.openNote(activeNoteFilename); }),
      this.button(doc, "打开笔记文件夹", async () => { await ResearchAgentStorage.openNotesDirectory(); })
    );
    noteLayout.append(noteList, notePreview); notesCard.append(notesTitle, notesCopy, noteActions, noteLayout); notesPanel.append(notesCard);
    root.append(tabs, status, sessionPanel, chatPanel, knowledgePanel, notesPanel); body.append(root); resizeInput();
    const resizeObserver = doc.defaultView.ResizeObserver ? new doc.defaultView.ResizeObserver(resizeInput) : null;
    resizeObserver?.observe(root); resizeObserver?.observe(chatPanel);
    doc.defaultView.addEventListener("resize", resizeInput);
    initializeSessions().catch((error) => { Zotero.logError(error); status.textContent = `无法载入会话：${error.message}`; });
  },

  button(doc, label, onClick) { const button = doc.createElement("button"); button.type = "button"; button.textContent = label; button.addEventListener("click", onClick); return button; },

  addMessage(doc, log, role, text, isUser, citations, evidence) {
    const message = doc.createElement("div"); message.className = `research-agent-message${isUser ? " is-user" : ""}`;
    const label = doc.createElement("span"); label.className = "research-agent-role"; label.textContent = role;
    const content = doc.createElement("div"); content.className = "research-agent-message-content";
    if (isUser) content.textContent = text;
    else ResearchAgentMarkdown.render(doc, content, text);
    message.append(label, content); if (citations?.length) this.addCitations(doc, message, citations); if (evidence?.length) this.addEvidenceLedger(doc, message, evidence); log.append(message); log.scrollTop = log.scrollHeight; return message;
  },

  addCitations(doc, parent, citations) {
    const box = doc.createElement("div"); box.className = "research-agent-citations has-items";
    const title = doc.createElement("div"); title.className = "research-agent-citations-title"; title.textContent = "引用文献与来源";
    const list = doc.createElement("div"); list.className = "research-agent-citation-list";
    for (const citation of citations) { const entry = citation.url ? doc.createElement("a") : doc.createElement("span"); entry.className = "research-agent-citation"; entry.textContent = citation.label || citation.value; if (citation.url) { entry.href = citation.url; entry.target = "_blank"; } list.append(entry); }
    box.append(title, list); parent.append(box);
  },

  addEvidenceLedger(doc, parent, evidence) {
    const details = doc.createElement("details"); details.className = "research-agent-trace";
    const summary = doc.createElement("summary"); summary.textContent = `证据账本 · ${evidence.length} 条`;
    const body = doc.createElement("div"); body.className = "research-agent-trace-body";
    for (const item of evidence.slice(0, 20)) {
      const row = doc.createElement("div"); row.className = "research-agent-tool-event";
      const source = `${item.id || "证据"} · ${item.title || "未命名来源"}${item.key ? ` [${item.key}]` : ""}`;
      const freshness = item.freshness?.state === "cache" ? `\n缓存来源：${item.freshness.fetchedAt || "时间未知"}（有效至 ${item.freshness.expiresAt || "未知"}）` : item.freshness ? "\n本次已刷新检索结果" : "";
      row.textContent = `${source}${item.excerpt ? `\n${item.excerpt}` : ""}${freshness}`;
      if (item.url) { const link = doc.createElement("a"); link.href = item.url; link.target = "_blank"; link.textContent = " 打开来源"; row.append(link); }
      body.append(row);
    }
    details.append(summary, body); parent.append(details);
  },

  createResponseView(doc, log, scrollToLatest = () => { log.scrollTop = log.scrollHeight; }) {
    const message = doc.createElement("div"); message.className = "research-agent-message research-agent-response";
    const label = doc.createElement("span"); label.className = "research-agent-role"; label.textContent = "助手";
    const answer = doc.createElement("div"); answer.className = "research-agent-answer"; answer.textContent = "正在准备回答…";
    let markdown = null;
    const trace = doc.createElement("details"); trace.className = "research-agent-trace"; trace.open = true;
    const traceSummary = doc.createElement("summary"); traceSummary.textContent = "推理、记忆与检索过程";
    const traceBody = doc.createElement("div"); traceBody.className = "research-agent-trace-body"; trace.append(traceSummary, traceBody); message.append(label, answer, trace); log.append(message);
    let answerStarted = false; let reasoningBlock = null; const steps = [];
    const addTrace = (text, className = "research-agent-tool-event", type = "tool") => { const entry = doc.createElement("div"); entry.className = className; entry.textContent = text; traceBody.append(entry); steps.push({ type, text }); traceSummary.textContent = `推理、记忆与检索过程 · ${steps.length} 步`; scrollToLatest(); };
    const names = { search_knowledge_base: "检索本地知识库", search_research_wiki: "查询研究 Wiki", search_web: "搜索网页", fetch_web_page: "抓取网页正文", search_arxiv: "查询 arXiv", search_github_code: "检索 GitHub 源码", calculate: "计算" };
    const describe = (event) => `${names[event.name] || event.name}${event.args?.query ? ` · ${event.args.query}` : ""}`;
    return {
      handle: (event) => { if (event.type === "content") { if (!answerStarted) { answer.replaceChildren(); markdown = ResearchAgentMarkdown.createStreamRenderer(doc, answer); answerStarted = true; } markdown.append(event.text); scrollToLatest(); } else if (event.type === "reasoning") { if (!reasoningBlock) { reasoningBlock = doc.createElement("div"); reasoningBlock.className = "research-agent-trace-reasoning"; traceBody.append(reasoningBlock); steps.push({ type: "reasoning", text: "" }); traceSummary.textContent = `推理、记忆与检索过程 · ${steps.length} 步`; } reasoningBlock.append(doc.createTextNode(event.text)); steps.at(-1).text += event.text; scrollToLatest(); } else if (event.type === "memory") addTrace(event.text, "research-agent-tool-event", "memory"); else if (["plan", "evidence", "cache", "budget"].includes(event.type)) addTrace(event.text, "research-agent-tool-event", event.type); else if (event.type === "tool-start") addTrace(`正在${describe(event)}`); else if (event.type === "tool-finish") addTrace(`${describe(event)} · 找到 ${event.count} 条结果`); else if (event.type === "tool-error") addTrace(`${describe(event)} · 调用失败：${event.error}`); },
      finish: (result) => { if (!answerStarted) { answer.replaceChildren(); markdown = ResearchAgentMarkdown.createStreamRenderer(doc, answer); markdown.append(result.answer || "模型没有返回正文。"); } markdown.finish(); if (!steps.length) addTrace("模型直接生成回答，未调用外部检索工具。"); trace.open = false; if (result.citations?.length) ResearchAgentSidebar.addCitations(doc, message, result.citations); if (result.evidence?.length) ResearchAgentSidebar.addEvidenceLedger(doc, message, result.evidence); scrollToLatest(); },
      fail: (error) => { answer.textContent = `回答失败：${error.message}`; addTrace("请求未完成；请检查模型配置或网络连接。"); trace.open = true; },
      trace: () => steps
    };
  },

  formatTokens(value) { const number = Math.max(0, Math.round(value)); return `${number >= 1000 ? `${(number / 1000).toFixed(number >= 10000 ? 0 : 1)}` : "0"}k`; },
  shortDate(value) { try { return new Date(value).toLocaleDateString("zh-CN", { month: "numeric", day: "numeric" }); } catch (_) { return ""; } }
};
