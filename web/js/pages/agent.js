import { escapeHtml, formatContent, formatDuration, humanFileSize, revokeDraft, uniqueBy } from "../core/utils.js";

const AGENT_PRESETS = [
  { icon: "⌕", label: "知识检索", prompt: "请检索当前项目知识库中的关键规范并给出摘要" },
  { icon: "⎋", label: "附件校验", prompt: "请校验当前附件的列结构并指出问题" },
  { icon: "◫", label: "模型巡检", prompt: "请列出当前子项目可用模型并推荐一个适合批量预测的模型" },
  { icon: "↻", label: "批量预测", prompt: "请使用当前子项目模型对最近上传的附件执行批量预测" },
];

const PAPERCLIP_ICON = `
  <svg viewBox="0 0 20 20" fill="none" aria-hidden="true">
    <path
      d="M7.75 10.75 12.7 5.8a3 3 0 1 1 4.24 4.25l-6.37 6.36a5 5 0 1 1-7.07-7.07l7.08-7.07"
      stroke="currentColor"
      stroke-width="1.8"
      stroke-linecap="round"
      stroke-linejoin="round"
    />
  </svg>
`;

function modelOptions(ctx) {
  const options = [{ id: "local-fallback", label: "本地回退", enabled: true }];
  (ctx.state.llmProfiles || []).forEach((profile) => {
    if (!profile.model) return;
    options.push({
      id: profile.id,
      label: `${profile.name} · ${profile.model}`,
      enabled: true,
      profile,
    });
  });
  if (ctx.state.agentConfig?.model && !options.some((item) => item.profile?.model === ctx.state.agentConfig.model)) {
    options.push({
      id: "runtime-current",
      label: `当前运行时 · ${ctx.state.agentConfig.model}`,
      enabled: true,
      runtime: true,
    });
  }
  return options;
}

function currentRuntimeModel(ctx) {
  if (!(ctx.state.agentConfig?.runtime_mode === "llm" && ctx.state.agentConfig?.model)) {
    return "local-fallback";
  }
  const matched = (ctx.state.llmProfiles || []).find(
    (item) =>
      item.model === ctx.state.agentConfig.model &&
      (item.base_url || "") === (ctx.state.agentConfig.base_url || "")
  );
  return matched?.id || "runtime-current";
}

function buildToolSummary(event) {
  const payload = event.payload || {};
  if (event.type === "tool_plan") {
    const tools = (payload.tool_calls || []).map((item) => item.name).filter(Boolean);
    return tools.length ? `计划执行 ${tools.length} 个动作：${tools.join(" / ")}` : "未规划额外工具";
  }
  if (event.type === "tool_start") {
    return "开始执行";
  }
  if (event.type === "file_ready") {
    return "已生成结果文件";
  }
  if (event.type !== "tool_result") return "";
  if (payload.status === "failed") return payload.error || "调用失败";
  if (payload.tool === "search_project_kb") return `命中 ${(payload.result?.hits || []).length} 条知识片段`;
  if (payload.tool === "preview_attachment") {
    const preview = payload.result?.preview || {};
    return `${preview.row_count || 0} 行 / ${preview.column_count || 0} 列`;
  }
  if (payload.tool === "batch_predict_with_file") {
    const prediction = payload.result?.prediction || {};
    return `已处理 ${prediction.row_count || 0} 行数据`;
  }
  if (payload.tool === "predict_with_model") {
    const prediction = payload.result?.prediction?.prediction || {};
    const firstTarget = Object.entries(prediction)[0];
    return firstTarget ? `已完成单次预测：${firstTarget[0]} = ${firstTarget[1]}` : "已完成单次预测";
  }
  if (payload.tool === "list_user_models") return `发现 ${(payload.result?.models || []).length} 个模型`;
  if (payload.tool === "list_session_attachments") return `当前会话附件 ${(payload.result?.attachments || []).length} 个`;
  return payload.status === "success" ? "执行完成" : "";
}

function buildToolDetails(event) {
  const payload = event.payload || {};
  if (event.type === "tool_result") {
    return payload.result || { error: payload.error || null };
  }
  return payload;
}

function toolTone(event) {
  const payload = event.payload || {};
  if (event.type === "tool_plan") return "plan";
  if (event.type === "file_ready") return "success";
  if (payload.status === "failed") return "failed";
  if (payload.status === "success") return "success";
  return "running";
}

function collectSources(events = []) {
  const items = [];
  events
    .filter((event) => event.type === "tool_result" && event.payload?.tool === "search_project_kb" && event.payload?.status === "success")
    .forEach((event) => {
      (event.payload.result?.hits || []).forEach((hit) => items.push(hit));
    });
  return uniqueBy(items, (hit) => `${hit.citation}-${hit.doc_id}-${hit.chunk_index}`);
}

function sourceKey(source) {
  return `${source.citation || "S"}-${source.doc_id || "doc"}-${source.chunk_index ?? 0}`;
}

function stripCitationFooter(text) {
  return String(text || "").replace(/\n{2,}引用来源：[\s\S]*$/u, "").trim();
}

function renderAgentContent(content, sources) {
  const html = formatContent(sources.length ? stripCitationFooter(content) : content);
  return html.replace(
    /<span class="source-chip">\[(S\d+)\]<\/span>/g,
    (_match, marker) =>
      `<button type="button" class="source-chip source-chip--interactive" data-citation-marker="${marker}" aria-label="查看 ${marker} 的引用详情">[${marker}]</button>`
  );
}

function renderToolEvent(event) {
  const payload = event.payload || {};
  const title =
    event.type === "tool_plan"
      ? "Planner"
      : event.type === "file_ready"
        ? "Artifact"
        : payload.tool || event.type;
  return `
    <article class="tool-event ${toolTone(event)}">
      <div class="tool-event-head">
        <div class="tool-event-title-wrap">
          <span class="tool-dot"></span>
          <strong>${escapeHtml(title)}</strong>
        </div>
        <span class="mini-meta">${[payload.status, formatDuration(payload.duration_ms)].filter(Boolean).join(" · ") || "执行中"}</span>
      </div>
      <div class="card-meta">${escapeHtml(buildToolSummary(event))}</div>
      ${
        event.type === "file_ready" && payload.file_url
          ? `<a href="${payload.file_url}" target="_blank">下载结果</a>`
          : ""
      }
      ${
        payload.status === "failed"
          ? `<button type="button" class="ghost-btn retry-latest-btn">重试上条消息</button>`
          : ""
      }
      <details class="tool-event-details">
        <summary>查看详情</summary>
        <pre class="tool-body">${escapeHtml(JSON.stringify(buildToolDetails(event), null, 2))}</pre>
      </details>
    </article>
  `;
}

function renderMessageAttachments(attachments = []) {
  if (!attachments.length) return "";
  return `
    <div class="attachment-inline-list">
      ${attachments
        .map(
          (item) => `
            <article class="attachment-card">
              ${
                item.is_image && item.download_url
                  ? `<img class="attachment-thumb" src="${item.download_url}" alt="${escapeHtml(item.filename || "附件")}" />`
                  : `<div class="attachment-file-icon">${escapeHtml((item.filename || "FILE").split(".").pop()?.toUpperCase() || "FILE")}</div>`
              }
              <div>
                <strong>${escapeHtml(item.filename || "未命名附件")}</strong>
                <div class="mini-meta">${item.size_bytes ? humanFileSize(item.size_bytes) : "已绑定到本条消息"}</div>
              </div>
              ${item.download_url ? `<a href="${item.download_url}" target="_blank">打开</a>` : ""}
            </article>
          `
        )
        .join("")}
    </div>
  `;
}

function renderSources(sources, messageKey, activeSourceKey) {
  if (!sources.length) return "";
  const activeSource = sources.find((source) => sourceKey(source) === activeSourceKey) || null;
  return `
    <div class="source-list">
      <div class="source-reference-head">
        <span class="mini-meta">引用来源</span>
      </div>
      <div class="source-reference-list">
      ${sources
        .map(
          (source) => `
            <button
              type="button"
              class="source-ref-item ${sourceKey(source) === activeSourceKey ? "is-active" : ""}"
              data-message-key="${messageKey}"
              data-source-key="${sourceKey(source)}"
              data-citation-marker="${escapeHtml(source.citation || "S")}"
              aria-expanded="${sourceKey(source) === activeSourceKey ? "true" : "false"}"
            >
              <span class="source-chip">[${escapeHtml(source.citation || "S")}]</span>
              <span class="source-ref-text">${escapeHtml(source.filename || "未命名文档")} / chunk ${escapeHtml(source.chunk_index)}</span>
              <span class="source-ref-icon">${PAPERCLIP_ICON}</span>
            </button>
          `
        )
        .join("")}
      </div>
      ${
        activeSource
          ? `
            <article class="source-card source-detail-panel" data-message-key="${messageKey}" data-source-detail="${sourceKey(activeSource)}">
              <div class="source-card-head">
                <div class="source-detail-title">
                  <span class="source-chip">[${escapeHtml(activeSource.citation || "S")}]</span>
                  <span class="source-name">${escapeHtml(activeSource.filename || "未命名文档")}</span>
                  <span class="mini-meta">chunk ${escapeHtml(activeSource.chunk_index)}</span>
                </div>
                <button
                  type="button"
                  class="ghost-btn source-detail-close"
                  data-message-key="${messageKey}"
                  data-source-key="${sourceKey(activeSource)}"
                  aria-label="收起引用详情"
                >收起</button>
              </div>
              <div class="source-snippet">${escapeHtml(activeSource.content || "")}</div>
              ${activeSource.download_url ? `<a href="${activeSource.download_url}" target="_blank">打开原文</a>` : ""}
            </article>
          `
          : ""
      }
    </div>
  `;
}

function showToolInChat(ctx, event) {
  if (ctx.state.showAgentDebug) return true;
  if (event.type === "file_ready") return true;
  if (event.type === "tool_result" && event.payload?.status === "failed") return true;
  return false;
}

function renderMessage(ctx, message, events = [], streaming = false, messageKey = "msg") {
  const visibleEvents = events.filter((event) => ["tool_plan", "tool_start", "tool_result", "file_ready"].includes(event.type)).filter((event) => showToolInChat(ctx, event));
  const sources = collectSources(events);
  const activeSourceKey = ctx.state.agentCitationPanels?.[messageKey] || null;
  const messageAttachments = Array.isArray(message.metadata?.attachments) ? message.metadata.attachments : [];
  return `
    <div class="chat-message ${message.role}" data-message-key="${messageKey}">
      <div class="message-shell">
        <div class="message-meta">
          <span class="meta-chip">${message.role === "assistant" ? "助手" : "你"}</span>
          <span class="message-meta-text">${[
            streaming ? "生成中" : "",
            sources.length ? `${sources.length} 条引用` : "",
          ]
            .filter(Boolean)
            .join(" · ")}</span>
        </div>
        ${visibleEvents.length ? `<div class="tool-stack">${visibleEvents.map((event) => renderToolEvent(event)).join("")}</div>` : ""}
        <div class="message-bubble">
          <div class="message-body">${renderAgentContent(message.content || "", sources)}</div>
        </div>
        ${message.role === "user" ? renderMessageAttachments(messageAttachments) : ""}
        ${renderSources(sources, messageKey, activeSourceKey)}
      </div>
    </div>
  `;
}

function renderTimeline(ctx) {
  const messages = ctx.state.currentSession?.messages || [];
  if (!messages.length && !ctx.state.agentStreamingMessage && !ctx.state.agentLiveEvents.length) {
    return `
      <div class="chat-empty">
        <div>
          <div class="section-title">开始一个新对话</div>
          <p>输入问题，或拖拽文件到对话区域。检索命中后会自动附带引用，工具调用会以状态卡片展示。</p>
        </div>
      </div>
    `;
  }
  const finished = messages
    .map((message, index) => renderMessage(ctx, message, message.metadata?.events || [], false, message.id || `history-${index}`))
    .join("");
  const typingPlaceholder =
    ctx.state.agentAwaitingReply && !ctx.state.agentStreamingMessage
      ? `
        <div class="chat-message assistant">
          <div class="message-shell">
            ${ctx.state.agentLiveEvents.length ? `<div class="tool-stack">${ctx.state.agentLiveEvents.map((event) => renderToolEvent(event)).join("")}</div>` : ""}
            <div class="message-bubble typing-bubble">
              <div class="typing-dots"><span></span><span></span><span></span></div>
            </div>
          </div>
        </div>
      `
      : "";
  const streaming = ctx.state.agentStreamingMessage
    ? renderMessage(
        ctx,
        { role: "assistant", content: ctx.state.agentStreamingMessage },
        ctx.state.agentLiveEvents,
        true,
        "streaming"
      )
    : typingPlaceholder;
  return `${finished}${streaming}`;
}

function renderPendingAttachments(ctx) {
  return (ctx.state.pendingAttachments || [])
    .map(
      (item) => `
        <article class="attachment-card">
          ${
            item.isImage && item.previewUrl
              ? `<img class="attachment-thumb" src="${item.previewUrl}" alt="${escapeHtml(item.name)}" />`
              : `<div class="attachment-file-icon">${escapeHtml(item.name.split(".").pop()?.toUpperCase() || "FILE")}</div>`
          }
          <div>
            <strong>${escapeHtml(item.name)}</strong>
            <div class="mini-meta">${humanFileSize(item.size)}</div>
          </div>
          <button type="button" class="danger-btn" data-remove-draft="${item.id}">移除</button>
        </article>
      `
    )
    .join("");
}

function renderUploadedAttachments(ctx) {
  const attachments = ctx.state.currentSession?.attachments || [];
  if (!attachments.length) return "";
  return attachments
    .map(
      (item) => `
        <article class="attachment-card">
          ${
            item.is_image
              ? `<img class="attachment-thumb" src="${item.download_url}" alt="${escapeHtml(item.filename)}" />`
              : `<div class="attachment-file-icon">${escapeHtml(item.filename.split(".").pop()?.toUpperCase() || "FILE")}</div>`
          }
          <div>
            <strong>${escapeHtml(item.filename)}</strong>
            <div class="mini-meta">${humanFileSize(item.size_bytes)} · ${escapeHtml(item.parse_status || "stored")}</div>
          </div>
          <button type="button" class="danger-btn" data-remove-uploaded="${item.id}">删除</button>
        </article>
      `
    )
    .join("");
}

function renderPresetActions() {
  return AGENT_PRESETS.map(
    (item) => `
      <button type="button" class="quick-action-chip" data-agent-preset="${escapeHtml(item.prompt)}">
        <span class="quick-action-icon">${item.icon}</span>
        <span>${escapeHtml(item.label)}</span>
      </button>
    `
  ).join("");
}

function renderTools(ctx) {
  const tools = ctx.state.currentSession?.tools || [];
  if (!tools.length) return `<div class="empty-card">当前上下文没有额外暴露模型工具。</div>`;
  return tools
    .map(
      (tool) => `
        <article class="list-card">
          <strong>${escapeHtml(tool.name)}</strong>
          <div class="card-meta">${escapeHtml(tool.description)}</div>
        </article>
      `
    )
    .join("");
}

function renderSessions(ctx) {
  if (!ctx.state.sessions.length) {
    return `<div class="empty-card">还没有会话。发送第一条消息时会自动创建。</div>`;
  }
  return ctx.state.sessions
    .map(
      (session) => `
        <article class="session-tile ${session.id === ctx.state.currentSessionId ? "active" : ""}" data-session-id="${session.id}">
          <div class="session-tile-head">
            <strong>${escapeHtml(session.title)}</strong>
            <button
              type="button"
              class="icon-btn session-delete-btn"
              data-delete-session="${session.id}"
              title="删除会话"
              aria-label="删除会话"
            >×</button>
          </div>
          <div class="card-meta">${escapeHtml(session.project_name || "")}${session.subproject_name ? ` / ${escapeHtml(session.subproject_name)}` : ""}</div>
          <div class="card-meta">${escapeHtml(session.last_message || "暂无消息")}</div>
        </article>
      `
    )
    .join("");
}

export function renderAgentPage(ctx) {
  const currentProjectId = ctx.state.currentSession?.project_id || ctx.state.selectedProjectId || ctx.state.projects[0]?.id || "";
  const currentProject = ctx.state.projects.find((item) => item.id === currentProjectId) || null;
  const currentSubProjectId = ctx.state.currentSession?.subproject_id || ctx.state.selectedSubProjectId || "";
  const subprojects = currentProject?.subprojects || [];
  const currentSessionTitle = ctx.state.currentSession?.title || "新对话";
  const drawerClass = ctx.state.agentSidebarOpen ? "chat-layout--drawer-open" : "chat-layout--drawer-closed";
  return `
    <section class="agent-page-shell">
      <section class="chat-layout ${drawerClass}">
        <button
          type="button"
          class="icon-btn sidebar-collapsed-fab agent-sidebar-fab ${ctx.state.agentSidebarOpen ? "is-open" : ""}"
          id="toggle-session-drawer-btn"
          title="${ctx.state.agentSidebarOpen ? "收起历史会话" : "展开历史会话"}"
          aria-label="${ctx.state.agentSidebarOpen ? "收起历史会话" : "展开历史会话"}"
        >☰</button>

        <aside class="chat-drawer">
          <div class="drawer-card">
            <div class="drawer-toolbar">
              <div>
                <div class="eyebrow">History</div>
                <div class="chat-title">历史会话</div>
              </div>
            </div>
            <div class="session-list">${renderSessions(ctx)}</div>
          </div>
        </aside>

        <div class="chat-stage">
          <div class="chat-stage-main">
            <section class="panel chat-shell" id="agent-dropzone">
              <div id="agent-drop-overlay" class="agent-drop-overlay hidden">释放以上传附件</div>
              <div class="chat-shell-head">
                <div class="chat-shell-title">
                  <div class="chat-title">${escapeHtml(currentSessionTitle)}</div>
                  <div class="agent-context-pickers">
                    <label class="agent-context-picker">
                      <span class="agent-context-label">项目</span>
                      <select id="agent-project-select" class="agent-context-select">
                        ${ctx.state.projects.map((project) => `<option value="${project.id}" ${project.id === currentProjectId ? "selected" : ""}>${escapeHtml(project.name)}</option>`).join("")}
                      </select>
                    </label>
                    <label class="agent-context-picker">
                      <span class="agent-context-label">子项目</span>
                      <select id="agent-subproject-select" class="agent-context-select">
                        <option value="">未绑定子项目</option>
                        ${subprojects.map((item) => `<option value="${item.id}" ${item.id === currentSubProjectId ? "selected" : ""}>${escapeHtml(item.name)}</option>`).join("")}
                      </select>
                    </label>
                  </div>
                </div>
                <div class="toolbar-row">
                  <button type="button" class="action-btn" id="new-session-btn">新对话</button>
                  <button type="button" class="ghost-btn" id="toggle-debug-btn">${ctx.state.showAgentDebug ? "收起详情" : "执行详情"}</button>
                  <button type="button" class="ghost-btn" id="rename-session-btn" ${ctx.state.currentSession ? "" : "disabled"}>重命名</button>
                </div>
              </div>

              <div class="chat-surface">
                <div class="chat-stream" id="chat-stream">${renderTimeline(ctx)}</div>
              </div>

              <form id="agent-composer" class="composer-shell">
                ${
                  ctx.state.agentUploading || ctx.state.pendingAttachments.length
                    ? `
                      <div class="composer-status-row">
                        <span class="meta-chip">${ctx.state.agentUploading ? "附件上传中" : `待上传 ${ctx.state.pendingAttachments.length} 个附件`}</span>
                        <span class="mini-meta">Enter 发送，Shift+Enter 换行，也支持拖拽上传。</span>
                      </div>
                    `
                    : ""
                }
                <div id="pending-attachment-list" class="attachment-draft-list">${renderPendingAttachments(ctx)}</div>
                ${
                  ctx.state.currentSession?.attachments?.length
                    ? `<div class="attachment-inline-list" id="uploaded-attachment-list">${renderUploadedAttachments(ctx)}</div>`
                    : `<div class="attachment-inline-list" id="uploaded-attachment-list"></div>`
                }
                <textarea id="agent-message-input" placeholder="输入消息，或拖拽文件到此处..."></textarea>
                <div class="composer-toolbar-row">
                  <div class="chip-row preset-bar preset-bar--inline">
                    ${renderPresetActions()}
                  </div>
                  <div class="composer-controls composer-controls--inline">
                    <input id="agent-file-input" type="file" accept=".csv,.xlsx,.xls,.txt,.pdf,image/*" multiple class="hidden" />
                    <button type="button" class="icon-btn" id="agent-attach-btn" title="上传附件" aria-label="上传附件">📎</button>
                    <label class="field-label inline-field model-select-field compact-select compact-select--inline">
                      <span>模型</span>
                      <select id="agent-model-select">
                        ${modelOptions(ctx)
                          .map(
                            (option) => `
                              <option value="${option.id}" ${currentRuntimeModel(ctx) === option.id ? "selected" : ""}>
                                ${escapeHtml(option.label)}
                              </option>
                            `
                          )
                          .join("")}
                      </select>
                    </label>
                    ${
                      ctx.state.agentAwaitingReply
                        ? `
                          <button type="button" class="ghost-btn composer-status-btn" disabled>生成中</button>
                          <button type="button" class="danger-btn composer-stop-btn" id="agent-stop-btn">停止</button>
                        `
                        : `<button type="submit" class="send-btn composer-send-btn">发送</button>`
                    }
                  </div>
                </div>
              </form>
            </section>

            <section class="panel ${ctx.state.showAgentDebug ? "" : "hidden"}">
              <div class="card-title-row">
                <div>
                  <div class="eyebrow">Execution Detail</div>
                  <h3 class="section-title">工具、附件与日志</h3>
                </div>
                <button type="button" class="ghost-btn" id="clear-terminal-btn">清空日志</button>
              </div>
              <div class="debug-sections">
                <details class="debug-block" open>
                  <summary>会话附件</summary>
                  <div class="result-stack">${renderUploadedAttachments(ctx)}</div>
                </details>
                <details class="debug-block" open>
                  <summary>可用工具</summary>
                  <div class="result-stack">${renderTools(ctx)}</div>
                </details>
                <details class="debug-block" open>
                  <summary>终端日志</summary>
                  <pre class="terminal-log">${escapeHtml(ctx.state.terminalLines.join("\n"))}</pre>
                </details>
              </div>
            </section>
          </div>
        </div>
      </section>
    </section>
  `;
}

export function bindAgentPage(ctx, root) {
  const toggleCitation = (messageKey, targetSourceKey) => {
    const current = ctx.state.agentCitationPanels?.[messageKey] || null;
    ctx.state.agentCitationPanels = {
      ...(ctx.state.agentCitationPanels || {}),
      [messageKey]: current === targetSourceKey ? null : targetSourceKey,
    };
    ctx.render();
    if (current === targetSourceKey) return;
    requestAnimationFrame(() => {
      root.querySelector(`.source-detail-panel[data-message-key="${messageKey}"]`)?.scrollIntoView({
        block: "nearest",
        behavior: "smooth",
      });
    });
  };

  root.querySelector("#agent-model-select")?.addEventListener("change", async (event) => {
    const modelId = event.target.value;
    const selectedProfile = (ctx.state.llmProfiles || []).find((item) => item.id === modelId);
    if (modelId === "local-fallback") {
      await ctx.api("/settings/agent-model", { method: "PATCH", body: JSON.stringify({ enabled: false }) });
    } else if (selectedProfile) {
      await ctx.api("/settings/agent-model", {
        method: "PATCH",
        body: JSON.stringify({
          enabled: true,
          base_url: selectedProfile.base_url,
          api_key: selectedProfile.api_key || undefined,
          model: selectedProfile.model,
          temperature: Number(selectedProfile.temperature ?? 0.2),
          system_prompt: selectedProfile.system_prompt || "",
        }),
      });
    }
    await ctx.loadAgentConfig();
    ctx.render();
  });

  root.querySelector("#toggle-session-drawer-btn")?.addEventListener("click", () => {
    ctx.state.agentSidebarOpen = !ctx.state.agentSidebarOpen;
    ctx.render();
  });

  root.querySelector("#toggle-debug-btn")?.addEventListener("click", () => {
    ctx.state.showAgentDebug = !ctx.state.showAgentDebug;
    ctx.render();
  });

  root.querySelector("#new-session-btn")?.addEventListener("click", async () => {
    ctx.state.currentSessionId = null;
    ctx.state.currentSession = null;
    ctx.clearPendingAttachments();
    const projectId = root.querySelector("#agent-project-select").value || ctx.state.selectedProjectId || ctx.state.projects[0]?.id;
    if (!projectId) {
      ctx.toast("请先创建项目后再使用 Agent", true);
      return;
    }
    const sessionId = await ctx.ensureAgentSession({
      projectId,
      subprojectId: root.querySelector("#agent-subproject-select").value || null,
      title: `会话 ${new Date().toLocaleTimeString()}`,
    });
    await ctx.selectSession(sessionId);
    ctx.render();
  });

  root.querySelectorAll("[data-session-id]").forEach((item) => {
    item.addEventListener("click", async () => {
      await ctx.selectSession(item.dataset.sessionId);
      ctx.render();
    });
  });

  root.querySelector("#rename-session-btn")?.addEventListener("click", async () => {
    if (!ctx.state.currentSessionId) return;
    const title = window.prompt("输入新的会话标题", ctx.state.currentSession?.title || "");
    if (!title) return;
    await ctx.api(`/agent/sessions/${ctx.state.currentSessionId}`, {
      method: "PATCH",
      body: JSON.stringify({ title }),
    });
    await ctx.reloadSessions();
    await ctx.selectSession(ctx.state.currentSessionId);
    ctx.render();
  });

  root.querySelector("#clear-terminal-btn")?.addEventListener("click", () => {
    ctx.state.terminalLines = [];
    ctx.render();
  });

  root.querySelectorAll("[data-delete-session]").forEach((button) => {
    button.addEventListener("click", async (event) => {
      event.stopPropagation();
      const sessionId = button.dataset.deleteSession;
      if (!sessionId || !window.confirm("删除该会话？")) return;
      await ctx.api(`/agent/sessions/${sessionId}`, { method: "DELETE" });
      if (ctx.state.currentSessionId === sessionId) {
        ctx.state.currentSessionId = null;
        ctx.state.currentSession = null;
        ctx.clearPendingAttachments();
      }
      await ctx.reloadSessions();
      ctx.render();
    });
  });

  root.querySelector("#agent-project-select")?.addEventListener("change", async (event) => {
    const projectId = event.target.value;
    if (!projectId) return;
    await ctx.ensureProject(projectId);
    if (ctx.state.currentSessionId) {
      await ctx.api(`/agent/sessions/${ctx.state.currentSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ project_id: projectId, subproject_id: null }),
      });
      await ctx.reloadSessions();
      await ctx.selectSession(ctx.state.currentSessionId);
    } else {
      await ctx.selectProject(projectId);
    }
    ctx.render();
  });

  root.querySelector("#agent-subproject-select")?.addEventListener("change", async (event) => {
    const subprojectId = event.target.value || null;
    if (ctx.state.currentSessionId) {
      await ctx.api(`/agent/sessions/${ctx.state.currentSessionId}`, {
        method: "PATCH",
        body: JSON.stringify({ subproject_id: subprojectId }),
      });
      await ctx.reloadSessions();
      await ctx.selectSession(ctx.state.currentSessionId);
      ctx.render();
      return;
    }
    if (subprojectId) {
      await ctx.selectSubProject(subprojectId);
      ctx.render();
    }
  });

  root.querySelectorAll("[data-agent-preset]").forEach((button) => {
    button.addEventListener("click", () => {
      const input = root.querySelector("#agent-message-input");
      input.value = button.dataset.agentPreset || "";
      input.focus();
    });
  });

  root.querySelectorAll(".retry-latest-btn").forEach((button) => {
    button.addEventListener("click", () => {
      const latestUserMessage = [...(ctx.state.currentSession?.messages || [])].reverse().find((item) => item.role === "user")?.content || "";
      const input = root.querySelector("#agent-message-input");
      input.value = latestUserMessage;
      input.focus();
    });
  });

  root.querySelector("#agent-attach-btn")?.addEventListener("click", () => {
    root.querySelector("#agent-file-input").click();
  });

  root.querySelector("#agent-file-input")?.addEventListener("change", (event) => {
    const files = Array.from(event.target.files || []);
    if (!files.length) return;
    ctx.queuePendingAttachments(files);
    ctx.render();
    event.target.value = "";
  });

  root.querySelectorAll("[data-remove-draft]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.removePendingAttachment(button.dataset.removeDraft);
      ctx.render();
    });
  });

  root.querySelectorAll("[data-remove-uploaded]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.api(`/agent/sessions/${ctx.state.currentSessionId}/attachments/${button.dataset.removeUploaded}`, { method: "DELETE" });
      await ctx.selectSession(ctx.state.currentSessionId);
      ctx.render();
    });
  });

  root.querySelector("#agent-message-input")?.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.shiftKey) {
      event.preventDefault();
      if (ctx.state.agentAwaitingReply) return;
      root.querySelector("#agent-composer")?.requestSubmit();
    }
  });

  root.querySelector("#agent-stop-btn")?.addEventListener("click", () => {
    ctx.stopAgentStream();
  });

  root.querySelectorAll("[data-source-key][data-message-key]").forEach((button) => {
    button.addEventListener("click", () => {
      const messageKey = button.dataset.messageKey;
      const targetSourceKey = button.dataset.sourceKey;
      if (!messageKey || !targetSourceKey) return;
      toggleCitation(messageKey, targetSourceKey);
    });
  });

  root.querySelectorAll("[data-citation-marker]").forEach((button) => {
    if (button.dataset.sourceKey) return;
    button.addEventListener("click", () => {
      const messageNode = button.closest(".chat-message");
      const messageKey = messageNode?.dataset.messageKey;
      const marker = button.dataset.citationMarker;
      const target = messageNode?.querySelector(`.source-ref-item[data-citation-marker="${marker}"]`);
      if (!messageKey || !target?.dataset.sourceKey) return;
      toggleCitation(messageKey, target.dataset.sourceKey);
    });
  });

  root.querySelector("#agent-composer")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (ctx.state.agentAwaitingReply) return;
    const input = root.querySelector("#agent-message-input");
    const message = input.value.trim();
    if (!message && !ctx.state.pendingAttachments.length) return;
    const projectId = root.querySelector("#agent-project-select").value || ctx.state.selectedProjectId || ctx.state.projects[0]?.id;
    if (!projectId) {
      ctx.toast("请先创建项目后再发送消息", true);
      return;
    }
    const subprojectId = root.querySelector("#agent-subproject-select").value || null;
    const sessionId = await ctx.ensureAgentSession({ projectId, subprojectId, title: `会话 ${new Date().toLocaleTimeString()}` });
    await ctx.selectSession(sessionId);
    let uploadedAttachments = [];
    if (ctx.state.pendingAttachments.length) {
      uploadedAttachments = await ctx.uploadPendingAttachments();
    }
    const attachmentsForTurn = uploadedAttachments.length
      ? uploadedAttachments
      : (ctx.state.currentSession?.attachments || []);
    if (!message) {
      ctx.render();
      return;
    }
    input.value = "";
    await ctx.streamTurn(
      message,
      attachmentsForTurn.map((item) => item.id),
      attachmentsForTurn
    );
  });

  const dropzone = root.querySelector("#agent-dropzone");
  const overlay = root.querySelector("#agent-drop-overlay");
  let dragDepth = 0;
  const activate = () => {
    overlay.classList.remove("hidden");
    dropzone.classList.add("dragging");
  };
  const deactivate = () => {
    overlay.classList.add("hidden");
    dropzone.classList.remove("dragging");
    dragDepth = 0;
  };
  ["dragenter", "dragover"].forEach((name) => {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dragDepth += 1;
      activate();
    });
  });
  ["dragleave", "dragend"].forEach((name) => {
    dropzone.addEventListener(name, (event) => {
      event.preventDefault();
      dragDepth = Math.max(0, dragDepth - 1);
      if (dragDepth === 0) deactivate();
    });
  });
  dropzone.addEventListener("drop", (event) => {
    event.preventDefault();
    deactivate();
    const files = Array.from(event.dataTransfer?.files || []);
    if (!files.length) return;
    ctx.queuePendingAttachments(files);
    ctx.render();
  });

  requestAnimationFrame(() => {
    const stream = root.querySelector("#chat-stream");
    if (stream) {
      stream.scrollTop = stream.scrollHeight;
    }
  });
}

export function cleanupAgentDrafts(ctx) {
  (ctx.state.pendingAttachments || []).forEach((item) => revokeDraft(item));
}
