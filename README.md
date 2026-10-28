# Research Agent for Zotero

A Zotero 9 plugin MVP that turns the currently selected collection into a local, hierarchical knowledge base and uses DeepSeek as a tool-using research agent.

## What is implemented

- **Three-level local index:** collection path → article metadata → paragraph chunks from Zotero's already-indexed PDF text cache.
- **Hybrid hierarchical retrieval:** SiliconFlow `BAAI/bge-m3` embeddings retrieve semantic candidates; `BAAI/bge-reranker-v2-m3` reranks them. Results retain collection path, item key, chunk level, and paragraph number. Article metadata is a separate `metadata` chunk.
- **Background knowledge-base management:** index the selected collection, selected Zotero articles, or every regular article in the active library. The manager lists local entries and can remove or re-embed selected entries without deleting Zotero items.
- **Research Wiki:** each indexed paper becomes a local Wiki node with a concise research card (problem, method, result, concepts) and typed relationships to related papers. The current chat automatically receives the current paper's saved neighbours for comparison and analogical reasoning, while clearly treating them as supporting context rather than primary evidence. A visual graph and a background rebuild action are available in the Knowledge Base tab.
- **Non-blocking indexing:** a sequential background queue reports article-level progress, yields to Zotero between articles, records per-item failures, and can be cancelled. Disabling or uninstalling the plugin cancels the queue; the in-flight network request is allowed to finish safely.
- **Research-cooperation agent:** choose DeepSeek, SiliconFlow, ModelScope, or Zhipu GLM in Settings, or configure any OpenAI-compatible endpoint. The plugin retrieves the provider's model list directly and streams answers, provider-supplied reasoning, and real-time tool activity into the sidebar. Its layered system policy preserves instruction priority, treats retrieved text and skills as untrusted reference material, keeps Wiki context optional, and leads with evidence-aware conclusions rather than rigid AI-style templates. The agent can independently use local paragraph search, Research Wiki search, web, arXiv, GitHub code search, and safe arithmetic when useful. Tool use requires a selected model with OpenAI-style Function Calling support.
- **Deep research workflow:** enable it for a complex question to persist a compact retrieval plan, gather a local evidence ledger, and synthesize claims with `[E#]` provenance markers. Wiki discovery can make a second-hop paragraph retrieval for related papers; graph relations are treated as leads, not proof. Tasks checkpoint every successful plan step, so a pause, restart, transient failure, or deliberately raised budget can resume without repeating completed retrieval.
- **Retrieval cache and spend controls:** web, arXiv, GitHub, and fetched-page results use a local cache with adjustable freshness. Settings expose per-task limits for total tools, external searches, and page fetches. The live trace shows cache hits/refreshes and the final evidence ledger records whether a source was freshly retrieved or reused from cache.
- **Remote reproduction workspace:** each research conversation can hold one repository URL and a persistent Pi coding-agent conversation. Configure the host/alias, SSH port, username, authentication type and server-side project root. Key-based SSH works through the system configuration; macOS/Linux password authentication stores the password separately in Zotero's login manager, never ordinary preferences, repository files, or model context. SSH always verifies known host keys. Creating a worktree also creates and validates its own `.venv`; Pi starts with that environment selected and `PIP_REQUIRE_VIRTUALENV=true`, and is instructed never to modify a global Conda/base environment. These instructions and virtualenv settings are not an OS sandbox: run Pi under a dedicated server user or container when stronger isolation is needed.
- **Guided learning mode:** enable it per conversation to turn the assistant into a patient research tutor: a short explanation, one answerable check-in question, targeted feedback and a progressively stronger hint. Quick actions start a learning path, diagnostic question, hint, or session recap; asking for a direct explanation always remains available.
- **Reflective conversation notes:** every conversation has one evolving local Markdown note. A daily sweep updates only notes whose source conversation changed, capturing evidence-backed focus hypotheses, research tensions, concrete next steps, reflective questions, and cited Zotero papers.
- **Safe community skills:** search skills.sh from Settings, preview and install selected `SKILL.md` workflows locally, and toggle them per user preference. Installed skills are bounded prompt-only methodology; scripts, MCP servers, shell commands, dependencies, and additional permissions are never executed or granted.
- **Privacy boundary:** the index, conversation log, and Markdown notes are in `<Zotero data directory>/research-agent/`. API keys are Zotero profile preferences, not files in this repository. Chunk text is sent to SiliconFlow during embedding and candidate text is sent during reranking; only the resulting vectors and local index are retained locally.

## Install the prototype

1. Use the included `research-agent-0.4.23.xpi` (or create it with the packaging command below).
2. Zotero → **Tools → Add-ons** → gear icon → **Install Add-on From File…**.
3. Restart Zotero. In an item's right-side details pane, open **Research Agent** (or click its side-navigation icon). The **Research Agent** settings tab is available in Zotero Settings.
4. Go to Zotero **Settings → Research Agent**, select a chat-model provider, enter its API key, fetch its model list directly from the provider, select a model, and run the connection test. For the official DeepSeek API address, **检查 API 余额** directly checks whether the account can make API calls. Brave Search is optional; GitHub Code Search requires an access token.
5. Select a collection or articles, open the **Research Agent** right sidebar, choose the desired indexing action, then ask a question. The agent automatically decides whether the current paper, local knowledge base, Research Wiki, web, arXiv, GitHub, or calculation tools improve the answer; no separate RAG switch is required. For a complicated comparison or survey, enable **深度研究模式**: its plan and evidence ledger are stored locally and can be continued from the same conversation. The progress bar is non-modal, so Zotero remains usable while indexing.
6. To reproduce a code repository on a server, configure the SSH connection, project root, and Pi command in **Settings → Research Agent → 服务器代码复现（Pi）**. For password authentication, explicitly save the password using the separate credential button. Verify and accept the server fingerprint in your terminal before the first plugin connection. The server must already have Python's venv support and Pi installed and authenticated. In the chat tab, open **代码复现工作区（服务器 Pi）** below the linked paper, test the connection, enter the repository URL, prepare the worktree and its `.venv`, then send Pi a reproduction task. Missing or incompatible Python environments fail with an actionable error rather than falling back to global installation.

## External tools

| Tool | Default implementation | Credential |
|---|---|---|
| Knowledge base | Local hierarchical lexical retrieval during chat; SiliconFlow `BAAI/bge-m3` embedding is used only while embedding or re-embedding knowledge-base entries | SiliconFlow required only for knowledge-base management |
| Research Wiki | Local search across LLM-generated paper cards, concepts, methods, and saved paper relationships | none after Wiki creation |
| Chat model agent | DeepSeek, SiliconFlow, ModelScope, Zhipu GLM, or a custom OpenAI-compatible provider | required |
| Web | DeepSeek Search API when the official DeepSeek endpoint and key are selected; Brave Search then Bing RSS are fallbacks. The agent can use DeepSeek Fetch to read one selected result as Markdown. | DeepSeek key preferred; Brave optional fallback |
| arXiv | arXiv Atom API | none |
| GitHub code | GitHub Code Search REST API | required |

## Package and verify

```sh
node --check bootstrap.js
for file in src/*.js chrome/content/chat.js; do node --check "$file"; done
node tests/indexer-contract.test.js && node tests/wiki-contract.test.js && node tests/semantic-contract.test.js && node tests/jobs-contract.test.js && node tests/agent-stream-contract.test.js && node tests/answer-quality-prompt-contract.test.js && node tests/guided-learning-contract.test.js && node tests/prefs-models-contract.test.js && node tests/deepseek-v4-contract.test.js && node tests/skills-contract.test.js && node tests/memory-contract.test.js && node tests/markdown-contract.test.js && node tests/math-rendering-contract.test.js && node tests/sidebar-edit-contract.test.js && node tests/sidebar-shortcuts-layout-contract.test.js && node tests/conversation-session-contract.test.js && node tests/conversation-delete-contract.test.js && node tests/reader-selection-contract.test.js && node tests/quick-prompts-contract.test.js && node tests/notes-management-contract.test.js && node tests/notes-refresh-contract.test.js && node tests/tools-contract.test.js && node tests/tools-helper-contract.test.js && node tests/research-contract.test.js && node tests/reproduction-contract.test.js
zip -X -r research-agent-0.4.23.xpi manifest.json bootstrap.js prefs.js prefs.xhtml prefs-ui.js chrome src locale icons vendor LICENSE README.md
unzip -t research-agent-0.4.23.xpi
```

## DeepSeek model migration

DeepSeek retired `deepseek-chat` and `deepseek-reasoner` on 2026-07-24. The plugin now defaults to `deepseek-v4-flash` and automatically migrates either retired alias when the configured endpoint is the official `https://api.deepseek.com`; custom OpenAI-compatible endpoints are left unchanged.

## Deliberate MVP limits

- Vectors are stored alongside chunks in the local JSON index. This keeps the prototype dependency-free but is not the best format for very large libraries; the next increment is a SQLite/FAISS-style vector index and background incremental indexing.
- The plugin consumes Zotero's existing full-text cache. PDFs must already be indexed by Zotero; scanned PDFs need OCR first.
- The daily job runs while Zotero is open and catches up for the previous day at next launch. It cannot run while Zotero itself is closed.
- 网页搜索默认使用 Bing RSS；配置 Brave Search 后会优先走 Brave。
- GitHub Code Search 要求认证；请在设置中填写具有代码搜索权限的访问令牌。
- This is a research prototype. Test on a copied Zotero profile before using it with an irreplaceable library.

## 自动更新

从 `0.4.4` 开始，插件会通过 GitHub Release 的 `updates.json` 自动检查更新；Zotero 验证发布包的 SHA-256 后提供安装。首次需要手动安装 `0.4.4` 或更高版本，之后可在插件管理器中使用“检查更新”。

## Repository publication

The repository is initialized locally with no remote and contains no secret. To publish after creating an empty GitHub repository under your account:

```sh
git remote add origin https://github.com/<your-account>/zotero-research-agent.git
git branch -M main
git push -u origin main
```

## Zotero compatibility

The manifest declares Zotero 7.9.9–10.9.9, matching the compatibility declaration used by the locally installed Zotero 9 translation plugin. Its `update_url` now points to the latest GitHub Release update manifest. It follows Zotero's current bootstrapped-plugin structure: WebExtension-style `manifest.json`, `bootstrap.js`, lifecycle hooks, main-window hooks, and runtime chrome registration.
