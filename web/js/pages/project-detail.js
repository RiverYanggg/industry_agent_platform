import { escapeHtml, parseJsonSafe, previewTableHtml, renderMarkdownPreview } from "../core/utils.js";

const WORKSPACE_TABS = [
  { id: "overview", label: "概览" },
  { id: "knowledge", label: "知识库" },
  { id: "training", label: "模型训练" },
  { id: "models", label: "我的模型" },
  { id: "agent", label: "项目 Agent" },
  { id: "settings", label: "设置" },
];

function activeTemplate(ctx) {
  const value = ctx.state.selectedTemplateId || ctx.state.templates[0]?.template_id;
  return ctx.state.templates.find((item) => item.template_id === value) || ctx.state.templates[0] || null;
}

function focusedTemplate(ctx) {
  const value = ctx.state.trainingTemplateFocusId || ctx.state.selectedTemplateId || ctx.state.templates[0]?.template_id;
  return ctx.state.templates.find((item) => item.template_id === value) || activeTemplate(ctx);
}

function selectedColumns(ctx) {
  return ctx.state.datasetPreview?.columns || [];
}

function templateHighlights(template) {
  return (template?.highlights || []).map((item) => `<span class="tag">${escapeHtml(item)}</span>`).join("");
}

function templateSchemaRows(template) {
  const entries = Object.entries(template?.schema || {});
  if (!entries.length) return `<div class="card-meta">当前模板未提供额外超参数说明。</div>`;
  return entries
    .map(
      ([key, config]) => `
        <div class="template-schema-item">
          <strong>${escapeHtml(key)}</strong>
          <span>${escapeHtml(config.type || "value")}</span>
          <span>默认 ${escapeHtml(config.default ?? "-")}</span>
        </div>
      `
    )
    .join("");
}

function renderTemplatePreview(template) {
  return `
    <div class="card-title-row">
      <strong>${escapeHtml(template?.name || "未选择模板")}</strong>
      <span class="meta-chip">${escapeHtml(template?.task_type || "-")}</span>
    </div>
    <div class="chip-row">
      <span class="tag">${escapeHtml(template?.input_type || "tabular")}</span>
      <span class="tag">${template?.supports_multi_output ? "多输出" : "单输出"}</span>
      <span class="tag">${escapeHtml(template?.resource || "CPU")}</span>
    </div>
    <div class="card-meta">${escapeHtml(template?.description || "悬停模板查看说明。")}</div>
    <div class="chip-row">${templateHighlights(template)}</div>
    <div class="template-schema-grid">${templateSchemaRows(template)}</div>
  `;
}

function renderRoleChips(ctx, role) {
  return selectedColumns(ctx)
    .map((column) => {
      const active = role === "feature" ? ctx.state.roleAssignment.features.includes(column) : ctx.state.roleAssignment.targets.includes(column);
      const activeClass = active ? (role === "feature" ? "active-x" : "active-y") : "";
      return `<button type="button" class="role-chip ${activeClass}" data-role="${role}" data-column="${escapeHtml(column)}">${escapeHtml(column)}</button>`;
    })
    .join("");
}

function renderRunList(ctx) {
  const runs = ctx.state.selectedSubProject?.runs || [];
  if (!runs.length) return `<div class="empty-card">当前没有训练记录。</div>`;
  return runs
    .map((run) => {
      const metrics = Object.entries(run.metrics || {})
        .map(([key, value]) => `<span class="metric-pill">${escapeHtml(key)}: ${escapeHtml(value)}</span>`)
        .join("");
      const targets = (run.target_columns || [run.target_column]).filter(Boolean).join(", ") || "-";
      return `
        <article class="list-card training-run-card">
          <div class="card-title-row">
            <strong>${escapeHtml(run.template_id)}</strong>
            <span class="status-chip ${run.status === "failed" ? "danger" : run.status === "running" ? "warning" : "muted"}">${escapeHtml(run.status)}</span>
          </div>
          <div class="card-meta">目标 ${escapeHtml(targets)}</div>
          <div class="chip-row">${metrics || `<span class="card-meta">${escapeHtml(run.error_text || "等待指标生成")}</span>`}</div>
        </article>
      `;
    })
    .join("");
}

function renderSubprojectTiles(ctx) {
  const subprojects = ctx.state.selectedProject?.subprojects || [];
  if (!subprojects.length) {
    if (ctx.state.autoCreatingDefaultSubproject) {
      return `<div class="empty-card">正在为训练工作流创建默认子项目…</div>`;
    }
    return `<div class="empty-card">当前项目还没有子项目。进入模型训练时会自动创建默认子项目。</div>`;
  }
  return subprojects
    .map(
      (item) => `
        <article class="subproject-tile ${item.id === ctx.state.selectedSubProjectId ? "active" : ""}" data-subproject-id="${item.id}">
          <div class="card-title-row">
            <strong>${escapeHtml(item.name)}</strong>
            <span class="mini-meta">${item.model_count} 模型</span>
          </div>
          <div class="card-meta">${escapeHtml(item.goal || "暂无目标说明")}</div>
          <div class="chip-row">
            <span class="meta-chip muted">数据 ${item.dataset_count}</span>
            <span class="meta-chip muted">训练 ${item.run_count}</span>
            <span class="meta-chip muted">附件 ${item.artifact_count}</span>
          </div>
        </article>
      `
    )
    .join("");
}

function latestSubproject(ctx) {
  return ctx.state.selectedProject?.subprojects?.[0] || null;
}

function renderSubprojectManager(ctx) {
  const project = ctx.state.selectedProject;
  const subproject = ctx.state.selectedSubProject;
  const latest = latestSubproject(ctx);
  const collapsed = ctx.state.workspaceSidebarCollapsed;
  if (collapsed) {
    return "";
  }

  return `
    <aside class="workspace-sidebar-shell">
      <section class="sidebar-section">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">Workspace</div>
            <h3 class="section-title">${escapeHtml(project?.name || "未选择项目")}</h3>
          </div>
        </div>
        <div class="card-meta">${escapeHtml(project?.description || "暂无描述")}</div>
        <div class="workspace-header-stats compact-metrics">
          <div class="workspace-stat"><span>知识文档</span><strong>${project?.doc_count ?? 0}</strong></div>
          <div class="workspace-stat"><span>子项目</span><strong>${project?.subproject_count ?? 0}</strong></div>
          <div class="workspace-stat"><span>模型</span><strong>${project?.model_count ?? 0}</strong></div>
        </div>
      </section>

      <div class="sidebar-divider"></div>

      <section class="sidebar-section">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">Subprojects</div>
            <h3 class="section-title">子项目</h3>
          </div>
          <div class="action-row">
            <button type="button" class="ghost-btn" id="open-subproject-create-btn">新建</button>
            <button type="button" class="ghost-btn" id="open-subproject-edit-btn" ${latest ? "" : "disabled"}>编辑</button>
          </div>
        </div>
        ${
          latest
            ? `
              <article class="subproject-tile active latest-subproject-card" data-subproject-id="${latest.id}">
                <div class="card-title-row">
                  <strong>${escapeHtml(latest.name)}</strong>
                  <span class="mini-meta">${latest.model_count} 模型</span>
                </div>
                <div class="card-meta">${escapeHtml(latest.goal || "暂无目标说明")}</div>
                <div class="chip-row">
                  <span class="meta-chip muted">数据 ${latest.dataset_count}</span>
                  <span class="meta-chip muted">训练 ${latest.run_count}</span>
                  <span class="meta-chip muted">附件 ${latest.artifact_count}</span>
                </div>
              </article>
            `
            : `<div class="empty-card">当前项目还没有子项目。点击“新建”开始创建。</div>`
        }
        ${
          ctx.state.subprojectEditorMode === "create"
            ? `
              <form id="subproject-create-form" class="field-grid subproject-edit-form">
                <label class="field-label">
                  <span>子项目名称</span>
                  <input id="subproject-name" type="text" placeholder="新增子项目名称" ${project ? "" : "disabled"} />
                </label>
                <label class="field-label">
                  <span>子项目说明</span>
                  <textarea id="subproject-goal" placeholder="新增子项目目标或说明" ${project ? "" : "disabled"}></textarea>
                </label>
                <div class="action-row">
                  <button type="submit" class="action-btn">新建子项目</button>
                  <button type="button" class="ghost-btn" id="cancel-subproject-editor-btn">取消</button>
                </div>
              </form>
            `
            : ""
        }
        ${
          ctx.state.subprojectEditorMode === "edit" && latest
            ? `
              <form id="subproject-edit-form" class="field-grid subproject-edit-form">
                <label class="field-label">
                  <span>当前子项目名称</span>
                  <input id="subproject-edit-name" type="text" value="${escapeHtml(latest.name)}" />
                </label>
                <label class="field-label">
                  <span>子项目说明</span>
                  <textarea id="subproject-edit-goal">${escapeHtml(latest.goal || "")}</textarea>
                </label>
                <div class="action-row">
                  <button type="submit" class="action-btn">保存子项目</button>
                  <button type="button" class="danger-btn" id="delete-subproject-btn">删除子项目</button>
                  <button type="button" class="ghost-btn" id="cancel-subproject-editor-btn">取消</button>
                </div>
              </form>
            `
            : ""
        }
      </section>

      ${
        ctx.state.workspaceTab === "training"
          ? `
            <div class="sidebar-divider"></div>
            <section class="sidebar-section">
              <div class="eyebrow">Runs</div>
              <h3 class="section-title">训练记录</h3>
              <div class="run-list">${renderRunList(ctx)}</div>
            </section>
          `
          : ""
      }
    </aside>
  `;
}

function renderOverviewTab(ctx) {
  const project = ctx.state.selectedProject;
  const subproject = ctx.state.selectedSubProject;
  const artifacts = (subproject?.artifacts || []).slice(0, 3);
  return `
    <section class="overview-cards">
      <article class="outline-card">
        <div class="eyebrow">Project</div>
        <strong>${escapeHtml(project?.name || "未选择项目")}</strong>
        <div class="card-meta">${escapeHtml(project?.description || "暂无描述")}</div>
      </article>
      <article class="outline-card">
        <div class="eyebrow">Scope</div>
        <strong>${escapeHtml(subproject?.name || "未绑定子项目")}</strong>
        <div class="card-meta">${escapeHtml(subproject?.goal || "先创建并选择子项目，再进行训练和模型预测。")}</div>
      </article>
      <article class="outline-card">
        <div class="eyebrow">Agent</div>
        <strong>${ctx.state.agentConfig?.runtime_mode === "llm" ? "远程模型" : "本地回退"}</strong>
        <div class="card-meta">项目 Agent 会默认继承当前上下文。</div>
      </article>
    </section>

    <section class="two-column-grid">
      <article class="panel">
        <div class="eyebrow">Summary</div>
        <h3 class="section-title">项目摘要</h3>
        <div class="result-stack">
          <div class="list-card">
            <strong>知识文档</strong>
            <div class="card-meta">${project?.doc_count ?? 0} 份项目文档已可用于 RAG。</div>
          </div>
          <div class="list-card">
            <strong>训练与模型</strong>
            <div class="card-meta">${project?.model_count ?? 0} 个已保存模型，${subproject?.run_count ?? 0} 条训练记录。</div>
          </div>
        </div>
      </article>
      <article class="panel">
        <div class="eyebrow">Artifacts</div>
        <h3 class="section-title">最近产物</h3>
        <div class="result-stack">
          ${
            artifacts.length
              ? artifacts
                  .map(
                    (artifact) => `
                      <div class="list-card">
                        <strong>${escapeHtml(artifact.title || artifact.type)}</strong>
                        <div class="card-meta">${escapeHtml(artifact.description || "暂无说明")}</div>
                      </div>
                    `
                  )
                  .join("")
              : `<div class="empty-card">当前子项目暂无分析图或附件。</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderKnowledgeTab(ctx) {
  const docs = ctx.state.selectedProject?.knowledge_docs || [];
  const results = ctx.state.knowledgeSearchResults || [];
  return `
    <section class="knowledge-layout">
      <article class="panel knowledge-stack-panel">
        <div class="eyebrow">Knowledge</div>
        <h3 class="section-title">知识库工作台</h3>

        <div class="knowledge-workflow">
          <section class="outline-card knowledge-action-card">
            <div class="knowledge-action-head">
              <span class="meta-chip">上传</span>
              <div>
                <strong>批量上传文档</strong>
                <div class="card-meta">一次选择多个 PDF、TXT 或 MD 文件，系统会自动抽取文本并切分 chunk。</div>
              </div>
            </div>
            <form id="knowledge-upload-form" class="field-grid">
              <input id="knowledge-file" type="file" accept=".pdf,.txt,.md" multiple hidden />
              <div class="file-picker-row">
                <label for="knowledge-file" class="ghost-btn file-picker-btn">选择文件</label>
                <input id="knowledge-file-display" type="text" class="file-display-input" readonly placeholder="未选择文件，可一次选择多个 PDF / TXT / MD" />
              </div>
              <button type="submit" class="action-btn">上传到知识库</button>
            </form>
          </section>

          <section class="outline-card knowledge-action-card knowledge-action-card--search">
            <div class="knowledge-action-head">
              <span class="meta-chip muted">检索</span>
              <div>
                <strong>检索知识库</strong>
                <div class="card-meta">输入问题、规范或关键词，直接查看命中的 chunk 和引用位置。</div>
              </div>
            </div>
            <form id="knowledge-search-form" class="field-grid">
              <input id="knowledge-query" type="text" placeholder="例如：树脂加入量对抗压强度的影响" />
              <button type="submit" class="ghost-btn">开始检索</button>
            </form>
            <div class="result-stack knowledge-search-result-stack">
              ${
                results.length
                  ? results
                      .map(
                        (result) => `
                          <article class="source-card">
                            <div class="source-card-head">
                              <span class="source-chip">[${escapeHtml(result.citation || "S")}]</span>
                              <span class="source-name">${escapeHtml(result.filename)}</span>
                              <span class="mini-meta">chunk ${escapeHtml(result.chunk_index)}</span>
                            </div>
                            <div class="source-snippet">${escapeHtml(result.content)}</div>
                          </article>
                        `
                      )
                      .join("")
                  : `<div class="empty-card">检索结果会显示在这里。</div>`
              }
            </div>
          </section>
        </div>
      </article>

      <article class="panel">
        <div class="eyebrow">Documents</div>
        <h3 class="section-title">文档列表</h3>
        <div class="doc-list">
          ${
            docs.length
              ? docs
                  .map(
                    (doc) => `
                      <article class="list-card knowledge-doc-card">
                        <div class="card-title-row">
                          <strong>${escapeHtml(doc.filename)}</strong>
                          <button type="button" class="danger-btn" data-delete-doc="${doc.id}">删除</button>
                        </div>
                        <div class="card-meta">Chunks ${doc.chunk_count} · ${escapeHtml(doc.created_at)}</div>
                        <div class="action-row">
                          <a href="${doc.download_url}" target="_blank" class="ghost-btn">打开原文</a>
                        </div>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-card">当前项目知识库为空。</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderDatasetList(ctx) {
  const datasets = ctx.state.selectedSubProject?.datasets || [];
  if (!datasets.length) return `<div class="empty-card">当前子项目还没有训练数据。</div>`;
  return datasets
    .map(
      (dataset) => `
        <article class="list-card">
          <div class="card-title-row">
            <strong>${escapeHtml(dataset.name)}</strong>
            <button type="button" class="ghost-btn" data-preview-dataset="${dataset.id}">预览</button>
          </div>
          <div class="card-meta">${dataset.kind} · ${dataset.row_count} rows</div>
        </article>
      `
    )
    .join("");
}

function renderTemplateSelector(ctx) {
  const selected = activeTemplate(ctx);
  return `
    <div class="template-dropdown-shell">
      <button type="button" class="template-select-trigger ${ctx.state.trainingTemplateMenuOpen ? "active" : ""}" id="template-menu-toggle">
        <div class="template-select-copy">
          <span class="template-select-label">选择模型</span>
          <strong>${escapeHtml(selected?.name || "请选择模型模板")}</strong>
          <span>${escapeHtml(selected?.description || "悬停列表查看适用场景")}</span>
        </div>
        <span class="template-select-caret">${ctx.state.trainingTemplateMenuOpen ? "▴" : "▾"}</span>
      </button>
      ${
        ctx.state.trainingTemplateMenuOpen
          ? `
            <div class="template-dropdown-menu">
              <div class="template-dropdown-list">
                ${ctx.state.templates
                  .map(
                    (item) => `
                      <button
                        type="button"
                        class="template-option ${item.template_id === ctx.state.selectedTemplateId ? "active" : ""}"
                        data-template-option="${item.template_id}"
                        data-template-preview="${item.template_id}"
                      >
                        <strong>${escapeHtml(item.name)}</strong>
                        <span class="template-option-sub">${escapeHtml(item.template_id)}</span>
                      </button>
                    `
                  )
                  .join("")}
              </div>
            </div>
          `
          : ""
      }
    </div>
  `;
}

function renderArtifactCard(ctx, artifact) {
  const editing = ctx.state.artifactEditingId === artifact.id;
  return `
    <article class="artifact-card artifact-card-rich">
      <div class="artifact-card-head">
        <div>
          <strong>${escapeHtml(artifact.title || artifact.type)}</strong>
          <div class="card-meta">${escapeHtml(artifact.type)} · ${escapeHtml(artifact.created_at || "")}</div>
        </div>
        <div class="action-row">
          <button type="button" class="ghost-btn" data-edit-artifact="${artifact.id}">${editing ? "取消" : "编辑"}</button>
          <button type="button" class="danger-btn" data-delete-artifact="${artifact.id}">删除</button>
        </div>
      </div>
      ${
        artifact.is_image
          ? `<img class="artifact-preview artifact-preview-large" src="${artifact.download_url}" alt="${escapeHtml(artifact.title || artifact.type)}" />`
          : `<div class="outline-card">该产物不是图片，可直接下载查看。</div>`
      }
      ${
        editing
          ? `
            <div class="artifact-editor">
              <label class="field-label">
                <span>标题</span>
                <input type="text" class="artifact-title-input" data-artifact-id="${artifact.id}" value="${escapeHtml(artifact.title || "")}" />
              </label>
              <label class="field-label">
                <span>描述 / 注释（支持简易 Markdown）</span>
                <textarea class="artifact-description-input" data-artifact-id="${artifact.id}" placeholder="例如：\n- 图中显示湿度升高后目标值下降\n- **重点**关注异常点">${escapeHtml(artifact.description || "")}</textarea>
              </label>
              <div class="action-row">
                <button type="button" class="action-btn" data-save-artifact="${artifact.id}">保存说明</button>
              </div>
            </div>
          `
          : `
            <div class="artifact-markdown-preview">
              ${renderMarkdownPreview(artifact.description || "")}
            </div>
          `
      }
    </article>
  `;
}

function renderArtifacts(ctx) {
  const artifacts = ctx.state.selectedSubProject?.artifacts || [];
  if (!artifacts.length) return `<div class="empty-card">暂无分析图片或附件。</div>`;
  return artifacts.map((artifact) => renderArtifactCard(ctx, artifact)).join("");
}

function renderTrainingTab(ctx) {
  const subproject = ctx.state.selectedSubProject;
  if (!subproject) {
    return `<div class="empty-card">模型训练依赖子项目上下文，系统正在为当前项目准备默认子项目。</div>`;
  }
  const previewTemplate = focusedTemplate(ctx);

  return `
    <section class="training-stage">
      <article class="panel training-step-panel">
        <div class="training-step-head">
          <span class="step-index-chip">1</span>
          <div>
            <div class="eyebrow">Upload</div>
            <h3 class="section-title">上传数据与预览</h3>
          </div>
        </div>
        <div class="training-upload-grid">
          <form id="dataset-upload-form" class="field-grid">
            <input id="dataset-file" type="file" accept=".csv,.xlsx,.xls" hidden />
            <label for="dataset-file" class="dataset-dropzone">
              <div class="dataset-dropzone-icon">⇪</div>
              <strong>拖拽或点击上传训练数据</strong>
              <div class="card-meta">支持 CSV / Excel，上传后可立即预览表格与字段。</div>
            </label>
            <input id="dataset-file-display" type="text" class="file-display-input" readonly placeholder="未选择训练文件" />
            <button type="submit" class="action-btn">上传训练数据</button>
            <div class="result-stack">${renderDatasetList(ctx)}</div>
          </form>
          <div class="table-shell training-preview-shell">${previewTableHtml(ctx.state.datasetPreview)}</div>
        </div>
      </article>

      <article class="panel training-step-panel">
        <div class="training-step-head">
          <span class="step-index-chip">2</span>
          <div>
            <div class="eyebrow">Fields</div>
            <h3 class="section-title">选择特征与目标</h3>
          </div>
        </div>
        <div class="training-step-copy">先选择一个数据集，再把字段分配到输入特征 X 和输出目标 Y。同一列不能同时属于两边。</div>
        <div class="role-columns">
          <div class="role-box">
            <h4>输入特征 X</h4>
            <div class="card-meta">选择已知工艺或环境变量作为输入。</div>
            <div class="role-list">${renderRoleChips(ctx, "feature") || `<div class="card-meta">请选择数据集后配置。</div>`}</div>
          </div>
          <div class="role-box role-box-target">
            <h4>输出目标 Y</h4>
            <div class="card-meta">选择希望模型预测的指标。</div>
            <div class="role-list">${renderRoleChips(ctx, "target") || `<div class="card-meta">请选择数据集后配置。</div>`}</div>
          </div>
        </div>
      </article>

      <article class="panel training-step-panel">
        <div class="training-step-head">
          <span class="step-index-chip">3</span>
          <div>
            <div class="eyebrow">Model</div>
            <h3 class="section-title">选择模型并训练</h3>
          </div>
        </div>
        <div class="training-model-grid">
          <div class="training-config-panel">
            <label class="field-label">
              <span>数据集</span>
              <select id="training-dataset-select">
                ${!(subproject.datasets || []).length ? `<option value="">请先上传训练数据</option>` : ""}
                ${(subproject.datasets || [])
                  .map((dataset) => `<option value="${dataset.id}" ${dataset.id === ctx.state.selectedDatasetId ? "selected" : ""}>${escapeHtml(dataset.name)}</option>`)
                  .join("")}
              </select>
            </label>
            ${renderTemplateSelector(ctx)}
            <label class="field-label">
              <span>保存模型名称</span>
              <input id="training-model-name" type="text" placeholder="例如 工艺强度_v1" />
            </label>
            <label class="field-label">
              <span>超参数 JSON</span>
              <textarea id="training-params" placeholder='例如 {"n_estimators": 300, "max_depth": 8}'></textarea>
            </label>
            <button type="button" class="action-btn" id="training-submit-btn">开始训练</button>
          </div>
          <article class="outline-card template-preview-card" id="training-template-preview">
            ${renderTemplatePreview(previewTemplate)}
          </article>
        </div>
      </article>

      <article class="panel artifact-studio-panel">
        <div class="artifact-studio-head">
          <div>
            <div class="eyebrow">Artifacts</div>
            <h3 class="section-title">分析图与附件</h3>
            <div class="card-meta">自动生成的分析图会直接渲染在这里，也可以追加人工上传的图片与注释。</div>
          </div>
          <div class="action-row">
            <button type="button" class="icon-btn" id="artifact-composer-toggle" title="添加附件">＋</button>
          </div>
        </div>

        ${
          ctx.state.artifactComposerOpen
            ? `
              <form id="artifact-upload-form" class="artifact-inline-composer">
                <input id="artifact-file" type="file" accept=".png,.jpg,.jpeg,.gif,.webp,.pdf,.txt" hidden />
                <div class="file-picker-row">
                  <label for="artifact-file" class="icon-btn" title="选择附件">📎</label>
                  <input id="artifact-file-display" type="text" class="file-display-input" readonly placeholder="选择图片或附件后，可添加题注与说明" />
                </div>
                <input id="artifact-title" type="text" placeholder="题注或标题" />
                <input id="artifact-type" type="text" placeholder="类型，例如 correlation / curve / note" />
                <textarea id="artifact-description" placeholder="支持简易 Markdown：可写结论、题注、图例说明"></textarea>
                <div class="action-row">
                  <button type="submit" class="action-btn">保存附件</button>
                  <button type="button" class="ghost-btn" id="artifact-composer-cancel">取消</button>
                </div>
              </form>
            `
            : ""
        }

        <div class="artifact-grid artifact-grid-rich">${renderArtifacts(ctx)}</div>
      </article>
    </section>
  `;
}

function renderModelCards(ctx) {
  const models = ctx.state.selectedSubProject?.models || [];
  if (!models.length) return `<div class="empty-card">当前子项目还没有模型。请先训练并自动保存模型。</div>`;
  return models
    .map(
      (model) => `
        <article class="project-tile ${model.id === ctx.state.selectedModelId ? "active" : ""}">
          <div class="card-title-row">
            <strong>${escapeHtml(model.name)}</strong>
            <span class="meta-chip">${escapeHtml(model.task_type)}</span>
          </div>
          <div class="card-meta">输入 ${model.feature_columns.length} 项 · 输出 ${(model.target_columns || [model.target_column]).join(", ")}</div>
          <div class="action-row">
            <button type="button" class="ghost-btn" data-open-model="${model.id}">打开</button>
            <button type="button" class="danger-btn" data-delete-model="${model.id}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderSinglePredictionResult(ctx) {
  const result = ctx.state.singlePredictResult;
  if (!result) return `<div class="empty-card">执行单条预测后，结果会显示在这里。</div>`;
  return `
    <div class="result-card">
      <div class="chip-row">
        ${Object.entries(result.prediction || {})
          .map(([key, value]) => `<span class="metric-pill">${escapeHtml(key)}: ${escapeHtml(value)}</span>`)
          .join("")}
      </div>
    </div>
  `;
}

function renderBatchPredictionResult(ctx) {
  const result = ctx.state.manualPredictResult;
  if (!result) return `<div class="empty-card">上传 CSV / Excel 后，这里会展示批量预测结果预览。</div>`;
  return `
    <div class="result-card">
      <div class="card-title-row">
        <strong>批量预测完成</strong>
        <a href="${result.result_file_url}" target="_blank">下载结果文件</a>
      </div>
      <div class="card-meta">处理 ${result.row_count} 行</div>
    </div>
    <div class="table-shell">${previewTableHtml(result.preview)}</div>
  `;
}

function renderModelsTab(ctx) {
  const model = ctx.currentModel();
  return `
    <section class="panel">
      <div class="eyebrow">Model Registry</div>
      <h3 class="section-title">模型列表</h3>
      <div class="model-grid">${renderModelCards(ctx)}</div>
    </section>
    <section class="model-workbench-grid">
      <article class="panel">
        <div class="eyebrow">Single Prediction</div>
        <h3 class="section-title">${escapeHtml(model?.name || "请选择模型")}</h3>
        <form id="single-predict-form" class="prediction-grid">
          ${
            model
              ? model.feature_columns
                  .map(
                    (column) => `
                      <label class="field-label">
                        <span>${escapeHtml(column)}</span>
                        <input type="text" name="${escapeHtml(column)}" placeholder="输入 ${escapeHtml(column)}" />
                      </label>
                    `
                  )
                  .join("")
              : ""
          }
        </form>
        <div class="action-row">
          <button type="button" class="action-btn" id="single-predict-submit" ${model ? "" : "disabled"}>执行单条预测</button>
        </div>
        ${renderSinglePredictionResult(ctx)}
      </article>
      <article class="panel">
        <div class="eyebrow">Batch Prediction</div>
        <h3 class="section-title">批量预测</h3>
        <form id="manual-predict-form" class="field-grid">
          <select id="manual-model-select">
            ${(ctx.state.selectedSubProject?.models || [])
              .map((item) => `<option value="${item.id}" ${item.id === ctx.state.selectedModelId ? "selected" : ""}>${escapeHtml(item.name)}</option>`)
              .join("")}
          </select>
          <input id="manual-predict-file" type="file" accept=".csv,.xlsx,.xls" />
          <button type="submit" class="action-btn">执行批量预测</button>
        </form>
        ${renderBatchPredictionResult(ctx)}
      </article>
    </section>
  `;
}

function renderProjectAgentTab(ctx) {
  const filteredSessions = ctx.state.sessions.filter((session) => session.project_id === ctx.state.selectedProjectId).slice(0, 5);
  return `
    <section class="project-agent-bridge">
      <article class="panel">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">Scoped Agent</div>
            <h3 class="section-title">项目协作</h3>
          </div>
          <button type="button" class="action-btn" data-project-agent="start">进入 Agent</button>
        </div>
        <div class="chip-row">
          <button type="button" class="preset-chip" data-project-agent-prompt="请检索当前项目知识库中的关键规范并给出摘要">知识检索</button>
          <button type="button" class="preset-chip" data-project-agent-prompt="请总结当前子项目可用模型与适用场景">模型巡检</button>
          <button type="button" class="preset-chip" data-project-agent-prompt="请说明当前训练数据还缺什么">训练建议</button>
        </div>
      </article>
      <article class="panel">
        <div class="eyebrow">Recent Sessions</div>
        <h3 class="section-title">相关会话</h3>
        <div class="project-agent-session-list">
          ${
            filteredSessions.length
              ? filteredSessions
                  .map(
                    (session) => `
                      <article class="session-tile" data-open-session="${session.id}">
                        <strong>${escapeHtml(session.title)}</strong>
                        <div class="card-meta">${escapeHtml(session.last_message || "暂无消息")}</div>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-card">当前项目还没有关联的 Agent 会话。</div>`
          }
        </div>
      </article>
    </section>
  `;
}

function renderSettingsTab(ctx) {
  const project = ctx.state.selectedProject;
  return `
    <section class="panel">
      <div class="card-title-row">
        <div>
          <div class="eyebrow">Project Settings</div>
          <h3 class="section-title">项目设置</h3>
        </div>
        ${project ? `<button type="button" class="danger-btn" id="delete-project-btn">删除项目</button>` : ""}
      </div>
      ${
        project
          ? `
            <form id="project-settings-form" class="settings-form">
              <label class="field-label">
                <span>项目名称</span>
                <input id="project-settings-name" type="text" value="${escapeHtml(project.name)}" />
              </label>
              <label class="field-label">
                <span>标签</span>
                <input id="project-settings-tags" type="text" value="${escapeHtml((project.tags || []).join(", "))}" />
              </label>
              <label class="field-label">
                <span>描述</span>
                <textarea id="project-settings-description">${escapeHtml(project.description || "")}</textarea>
              </label>
              <button type="submit" class="action-btn">保存项目设置</button>
            </form>
          `
          : `<div class="empty-card">未选择项目。</div>`
      }
    </section>
  `;
}

function renderWorkspaceBody(ctx) {
  switch (ctx.state.workspaceTab) {
    case "knowledge":
      return renderKnowledgeTab(ctx);
    case "training":
      return renderTrainingTab(ctx);
    case "models":
      return renderModelsTab(ctx);
    case "agent":
      return renderProjectAgentTab(ctx);
    case "settings":
      return renderSettingsTab(ctx);
    case "overview":
    default:
      return renderOverviewTab(ctx);
  }
}

export function renderProjectDetailPage(ctx) {
  const project = ctx.state.selectedProject;
  const subproject = ctx.state.selectedSubProject;
  if (!project) {
    return `<div class="empty-card">未找到项目，请返回项目列表重新选择。</div>`;
  }
  return `
    <section class="page-with-floating-sidebar">
      <button
        type="button"
        class="icon-btn sidebar-collapsed-fab page-sidebar-fab ${ctx.state.workspaceSidebarCollapsed ? "" : "is-open"}"
        id="workspace-sidebar-toggle"
        title="${ctx.state.workspaceSidebarCollapsed ? "展开侧栏" : "收起侧栏"}"
        aria-label="${ctx.state.workspaceSidebarCollapsed ? "展开侧栏" : "收起侧栏"}"
      >☰</button>

      <section class="project-grid ${ctx.state.workspaceSidebarCollapsed ? "project-grid--sidebar-collapsed" : ""}">
        ${ctx.state.workspaceSidebarCollapsed ? "" : `<div class="workspace-sidebar">${renderSubprojectManager(ctx)}</div>`}

        <div class="workspace-main">
          <section class="workspace-hero hero-card">
            <div class="hero-title-row">
              <div>
                <div class="eyebrow">Workspace</div>
                <h2 class="workspace-title">${escapeHtml(project.name)}</h2>
              </div>
              <div class="action-row">
                ${subproject ? `<span class="meta-chip">${escapeHtml(subproject.name)}</span>` : `<span class="meta-chip muted">未绑定子项目</span>`}
                <button type="button" class="ghost-btn" id="back-to-projects-btn">返回列表</button>
              </div>
            </div>
            <div class="workspace-subtitle">在这里处理项目内部的知识库、训练、模型预测与项目 Agent。训练记录已收纳到左侧侧栏，主区域专注于当前任务。</div>
          </section>
          <section class="panel workspace-stage">
            <div class="workspace-tabs">
              ${WORKSPACE_TABS.map((tab) => `<button type="button" class="tab-chip ${ctx.state.workspaceTab === tab.id ? "active" : ""}" data-switch-tab="${tab.id}">${tab.label}</button>`).join("")}
            </div>
            <div class="workspace-tab-panel">${renderWorkspaceBody(ctx)}</div>
          </section>
        </div>
      </section>
    </section>
  `;
}

function ensureDefaultSubproject(ctx) {
  const needsAutoCreate =
    !!ctx.state.selectedProjectId &&
    ["training", "models", "agent"].includes(ctx.state.workspaceTab) &&
    !ctx.state.selectedProject?.subprojects?.length &&
    !ctx.state.autoCreatingDefaultSubproject;
  if (!needsAutoCreate) return;
  ctx.state.autoCreatingDefaultSubproject = true;
  ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects`, {
    method: "POST",
    body: JSON.stringify({
      name: "默认子项目",
      goal: "系统自动创建，用于承接模型训练、分析图与预测流程。",
    }),
  })
    .then(async () => {
      await ctx.selectProject(ctx.state.selectedProjectId);
      const first = ctx.state.selectedProject?.subprojects?.[0];
      if (first) {
        await ctx.selectSubProject(first.id, false);
      }
      ctx.toast("已自动创建默认子项目");
    })
    .catch(() => ctx.toast("默认子项目创建失败，请稍后重试", true))
    .finally(() => {
      ctx.state.autoCreatingDefaultSubproject = false;
      ctx.render();
    });
}

function syncFileDisplay(fileInput, displayInput, emptyText) {
  if (!fileInput || !displayInput) return;
  const files = Array.from(fileInput.files || []);
  if (!files.length) {
    displayInput.value = "";
    displayInput.placeholder = emptyText;
    return;
  }
  displayInput.value = files.map((file) => file.name).join("，");
}

export function bindProjectDetailPage(ctx, root) {
  ensureDefaultSubproject(ctx);
  const latest = latestSubproject(ctx);

  root.querySelector("#back-to-projects-btn")?.addEventListener("click", () => ctx.go("projects"));

  root.querySelector("#workspace-sidebar-toggle")?.addEventListener("click", () => {
    ctx.state.workspaceSidebarCollapsed = !ctx.state.workspaceSidebarCollapsed;
    ctx.render();
  });

  root.querySelector("#open-subproject-create-btn")?.addEventListener("click", () => {
    ctx.state.subprojectEditorMode = "create";
    ctx.render();
  });

  root.querySelector("#open-subproject-edit-btn")?.addEventListener("click", async () => {
    if (!latest?.id) return;
    if (ctx.state.selectedSubProjectId !== latest.id) {
      await ctx.selectSubProject(latest.id, false);
    }
    ctx.state.subprojectEditorMode = "edit";
    ctx.render();
  });

  root.querySelector("#cancel-subproject-editor-btn")?.addEventListener("click", () => {
    ctx.state.subprojectEditorMode = null;
    ctx.render();
  });

  root.querySelector("#subproject-create-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.selectedProjectId) return;
    const name = root.querySelector("#subproject-name").value.trim();
    if (!name) return;
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects`, {
      method: "POST",
      body: JSON.stringify({
        name,
        goal: root.querySelector("#subproject-goal").value.trim(),
      }),
    });
    await ctx.selectProject(ctx.state.selectedProjectId);
    const nextLatest = latestSubproject(ctx);
    if (nextLatest?.id) {
      await ctx.selectSubProject(nextLatest.id, false);
    }
    ctx.state.subprojectEditorMode = null;
    root.querySelector("#subproject-create-form").reset();
    ctx.toast("子项目已创建");
    ctx.render();
  });

  root.querySelector("#subproject-edit-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.selectedProjectId || !latest?.id) return;
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${latest.id}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: root.querySelector("#subproject-edit-name").value.trim(),
        goal: root.querySelector("#subproject-edit-goal").value.trim(),
      }),
    });
    await ctx.selectProject(ctx.state.selectedProjectId);
    await ctx.selectSubProject(latest.id, false);
    ctx.state.subprojectEditorMode = null;
    ctx.toast("子项目已更新");
    ctx.render();
  });

  root.querySelector("#delete-subproject-btn")?.addEventListener("click", async () => {
    if (!ctx.state.selectedProjectId || !latest?.id) return;
    if (!window.confirm("删除当前子项目？其数据集、训练记录、模型和附件会一并删除。")) return;
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${latest.id}`, {
      method: "DELETE",
    });
    await ctx.selectProject(ctx.state.selectedProjectId);
    const nextSubproject = ctx.state.selectedProject?.subprojects?.[0];
    if (nextSubproject) {
      await ctx.selectSubProject(nextSubproject.id, false);
    }
    ctx.state.subprojectEditorMode = null;
    ctx.toast("子项目已删除");
    ctx.render();
  });

  root.querySelectorAll("[data-subproject-id]").forEach((item) => {
    item.addEventListener("click", async () => {
      await ctx.selectSubProject(item.dataset.subprojectId);
      ctx.render();
    });
  });

  root.querySelectorAll("[data-switch-tab]").forEach((button) => {
    button.addEventListener("click", () => {
      if (button.dataset.switchTab === "training") {
        ctx.state.artifactEditingId = null;
      }
      ctx.go("project", button.dataset.switchTab);
    });
  });

  const knowledgeFileInput = root.querySelector("#knowledge-file");
  const knowledgeFileDisplay = root.querySelector("#knowledge-file-display");
  knowledgeFileInput?.addEventListener("change", () => {
    syncFileDisplay(knowledgeFileInput, knowledgeFileDisplay, "未选择文件，可一次选择多个 PDF / TXT / MD");
  });

  root.querySelector("#knowledge-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.selectedProjectId || !knowledgeFileInput?.files?.length) return;
    const form = new FormData();
    const files = Array.from(knowledgeFileInput.files);
    files.forEach((file) => form.append(files.length > 1 ? "files" : "file", file));
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/knowledge${files.length > 1 ? "/batch" : ""}`, { method: "POST", body: form });
    await ctx.selectProject(ctx.state.selectedProjectId);
    if (knowledgeFileInput) knowledgeFileInput.value = "";
    if (knowledgeFileDisplay) knowledgeFileDisplay.value = "";
    ctx.toast(`已上传 ${files.length} 份知识文档`);
    ctx.render();
  });

  root.querySelector("#knowledge-search-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.selectedProjectId) return;
    const query = root.querySelector("#knowledge-query").value.trim();
    if (!query) return;
    ctx.state.knowledgeSearchResults = await ctx.api(
      `/projects/${ctx.state.selectedProjectId}/knowledge/search?q=${encodeURIComponent(query)}`
    );
    ctx.render();
  });

  root.querySelectorAll("[data-delete-doc]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.api(`/projects/${ctx.state.selectedProjectId}/knowledge/${button.dataset.deleteDoc}`, { method: "DELETE" });
      await ctx.selectProject(ctx.state.selectedProjectId);
      ctx.toast("文档已删除");
      ctx.render();
    });
  });

  root.querySelector("#dataset-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    if (!ctx.state.selectedProjectId || !ctx.state.selectedSubProjectId) return;
    const file = root.querySelector("#dataset-file").files[0];
    if (!file) return;
    const form = new FormData();
    form.append("file", file);
    form.append("kind", "training");
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/data`, {
      method: "POST",
      body: form,
    });
    await ctx.selectSubProject(ctx.state.selectedSubProjectId);
    ctx.toast("训练数据已上传");
    ctx.render();
  });

  const datasetFileInput = root.querySelector("#dataset-file");
  const datasetFileDisplay = root.querySelector("#dataset-file-display");
  datasetFileInput?.addEventListener("change", () => {
    syncFileDisplay(datasetFileInput, datasetFileDisplay, "未选择训练文件");
  });

  root.querySelectorAll("[data-preview-dataset]").forEach((button) => {
    button.addEventListener("click", async () => {
      ctx.state.selectedDatasetId = button.dataset.previewDataset;
      ctx.state.datasetPreview = await ctx.api(
        `/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/data/${button.dataset.previewDataset}/preview`
      );
      ctx.resetRoleAssignment(selectedColumns(ctx));
      ctx.render();
    });
  });

  root.querySelector("#training-dataset-select")?.addEventListener("change", async (event) => {
    const datasetId = event.target.value;
    if (!datasetId) return;
    ctx.state.selectedDatasetId = datasetId;
    ctx.state.datasetPreview = await ctx.api(
      `/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/data/${datasetId}/preview`
    );
    ctx.resetRoleAssignment(selectedColumns(ctx));
    ctx.render();
  });

  root.querySelector("#template-menu-toggle")?.addEventListener("click", () => {
    ctx.state.trainingTemplateMenuOpen = !ctx.state.trainingTemplateMenuOpen;
    ctx.render();
  });

  const previewRoot = root.querySelector("#training-template-preview");
  const renderTemplateIntoPreview = (templateId) => {
    if (!previewRoot) return;
    const template = ctx.state.templates.find((item) => item.template_id === templateId) || activeTemplate(ctx);
    previewRoot.innerHTML = renderTemplatePreview(template);
  };

  root.querySelectorAll("[data-template-option]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.selectedTemplateId = button.dataset.templateOption || null;
      ctx.state.trainingTemplateFocusId = button.dataset.templateOption || null;
      ctx.state.trainingTemplateMenuOpen = false;
      ctx.render();
    });
    button.addEventListener("mouseenter", () => {
      ctx.state.trainingTemplateFocusId = button.dataset.templatePreview || null;
      renderTemplateIntoPreview(button.dataset.templatePreview);
    });
    button.addEventListener("focus", () => {
      ctx.state.trainingTemplateFocusId = button.dataset.templatePreview || null;
      renderTemplateIntoPreview(button.dataset.templatePreview);
    });
  });

  root.querySelector(".template-dropdown-menu")?.addEventListener("mouseleave", () => {
    ctx.state.trainingTemplateFocusId = ctx.state.selectedTemplateId;
    renderTemplateIntoPreview(ctx.state.selectedTemplateId);
  });

  root.querySelectorAll(".role-chip").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.toggleRole(button.dataset.column, button.dataset.role);
      ctx.render();
    });
  });

  root.querySelector("#training-submit-btn")?.addEventListener("click", async () => {
    const datasetId = root.querySelector("#training-dataset-select")?.value;
    if (!datasetId) {
      ctx.toast("请先上传并选择训练数据", true);
      return;
    }
    const features = ctx.state.roleAssignment.features;
    const targets = ctx.state.roleAssignment.targets;
    if (!features.length || !targets.length) {
      ctx.toast("请至少选择一个输入特征和一个输出目标", true);
      return;
    }
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/runs`, {
      method: "POST",
      body: JSON.stringify({
        dataset_id: datasetId,
        template_id: ctx.state.selectedTemplateId,
        feature_columns: features,
        target_columns: targets,
        params: parseJsonSafe(root.querySelector("#training-params").value.trim(), {}),
        model_name: root.querySelector("#training-model-name").value.trim() || undefined,
        auto_register_model: true,
      }),
    });
    await ctx.selectSubProject(ctx.state.selectedSubProjectId);
    ctx.toast("训练任务已启动");
    ctx.render();
    setTimeout(() => ctx.selectSubProject(ctx.state.selectedSubProjectId).then(() => ctx.render()), 1400);
  });

  const artifactFileInput = root.querySelector("#artifact-file");
  const artifactFileDisplay = root.querySelector("#artifact-file-display");
  artifactFileInput?.addEventListener("change", () => {
    syncFileDisplay(artifactFileInput, artifactFileDisplay, "选择图片或附件后，可添加题注与说明");
  });

  root.querySelector("#artifact-composer-toggle")?.addEventListener("click", () => {
    ctx.state.artifactComposerOpen = !ctx.state.artifactComposerOpen;
    ctx.render();
  });

  root.querySelector("#artifact-composer-cancel")?.addEventListener("click", () => {
    ctx.state.artifactComposerOpen = false;
    ctx.render();
  });

  root.querySelector("#artifact-upload-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = root.querySelector("#artifact-file")?.files?.[0];
    if (!file || !ctx.state.selectedProjectId || !ctx.state.selectedSubProjectId) return;
    const form = new FormData();
    form.append("title", root.querySelector("#artifact-title").value.trim() || file.name);
    form.append("type", root.querySelector("#artifact-type").value.trim() || "attachment");
    form.append("description", root.querySelector("#artifact-description").value || "");
    form.append("file", file);
    await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/artifacts`, {
      method: "POST",
      body: form,
    });
    ctx.state.artifactComposerOpen = false;
    await ctx.selectSubProject(ctx.state.selectedSubProjectId);
    ctx.toast("附件已保存");
    ctx.render();
  });

  root.querySelectorAll("[data-edit-artifact]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.artifactEditingId = ctx.state.artifactEditingId === button.dataset.editArtifact ? null : button.dataset.editArtifact;
      ctx.render();
    });
  });

  root.querySelectorAll("[data-save-artifact]").forEach((button) => {
    button.addEventListener("click", async () => {
      const artifactId = button.dataset.saveArtifact;
      const title = root.querySelector(`.artifact-title-input[data-artifact-id="${artifactId}"]`)?.value || "";
      const description = root.querySelector(`.artifact-description-input[data-artifact-id="${artifactId}"]`)?.value || "";
      await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/artifacts/${artifactId}`, {
        method: "PATCH",
        body: JSON.stringify({ title, description }),
      });
      ctx.state.artifactEditingId = null;
      await ctx.selectSubProject(ctx.state.selectedSubProjectId);
      ctx.toast("附件说明已保存");
      ctx.render();
    });
  });

  root.querySelectorAll("[data-delete-artifact]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/artifacts/${button.dataset.deleteArtifact}`, {
        method: "DELETE",
      });
      if (ctx.state.artifactEditingId === button.dataset.deleteArtifact) {
        ctx.state.artifactEditingId = null;
      }
      await ctx.selectSubProject(ctx.state.selectedSubProjectId);
      ctx.toast("附件已删除");
      ctx.render();
    });
  });

  root.querySelectorAll("[data-open-model]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.selectedModelId = button.dataset.openModel;
      ctx.state.singlePredictResult = null;
      ctx.state.manualPredictResult = null;
      ctx.render();
    });
  });

  root.querySelectorAll("[data-delete-model]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.api(`/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/models/${button.dataset.deleteModel}`, {
        method: "DELETE",
      });
      await ctx.selectSubProject(ctx.state.selectedSubProjectId);
      ctx.state.selectedModelId = ctx.state.selectedSubProject?.models?.[0]?.id || null;
      ctx.toast("模型已删除");
      ctx.render();
    });
  });

  root.querySelector("#single-predict-submit")?.addEventListener("click", async () => {
    const model = ctx.currentModel();
    if (!model) return;
    const form = new FormData(root.querySelector("#single-predict-form"));
    const inputs = Object.fromEntries(model.feature_columns.map((column) => [column, form.get(column) ?? ""]));
    ctx.state.singlePredictResult = await ctx.api(
      `/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/models/${model.id}/predict`,
      {
        method: "POST",
        body: JSON.stringify({ inputs }),
      }
    );
    ctx.render();
  });

  root.querySelector("#manual-model-select")?.addEventListener("change", (event) => {
    ctx.state.selectedModelId = event.target.value || null;
    ctx.render();
  });

  root.querySelector("#manual-predict-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const file = root.querySelector("#manual-predict-file").files[0];
    const modelId = root.querySelector("#manual-model-select").value;
    if (!file || !modelId) return;
    const form = new FormData();
    form.append("file", file);
    ctx.state.manualPredictResult = await ctx.api(
      `/projects/${ctx.state.selectedProjectId}/subprojects/${ctx.state.selectedSubProjectId}/models/${modelId}/batch-predict`,
      {
        method: "POST",
        body: form,
      }
    );
    ctx.render();
  });

  root.querySelectorAll("[data-project-agent='start']").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = await ctx.ensureAgentSession({
        projectId: ctx.state.selectedProjectId,
        subprojectId: ctx.state.selectedSubProjectId,
        title: ctx.state.selectedSubProject ? `${ctx.state.selectedSubProject.name} 协作` : `${ctx.state.selectedProject?.name || "项目"} 协作`,
      });
      await ctx.selectSession(sessionId);
      ctx.go("agent");
    });
  });

  root.querySelectorAll("[data-project-agent-prompt]").forEach((button) => {
    button.addEventListener("click", async () => {
      const sessionId = await ctx.ensureAgentSession({
        projectId: ctx.state.selectedProjectId,
        subprojectId: ctx.state.selectedSubProjectId,
        title: ctx.state.selectedSubProject ? `${ctx.state.selectedSubProject.name} 协作` : `${ctx.state.selectedProject?.name || "项目"} 协作`,
      });
      await ctx.selectSession(sessionId);
      ctx.go("agent");
      requestAnimationFrame(() => {
        const input = document.querySelector("#agent-message-input");
        if (input) {
          input.value = button.dataset.projectAgentPrompt || "";
          input.focus();
        }
      });
    });
  });

  root.querySelectorAll("[data-open-session]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.selectSession(button.dataset.openSession);
      ctx.go("agent");
    });
  });

  root.querySelector("#project-settings-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await ctx.api(`/projects/${ctx.state.selectedProjectId}`, {
      method: "PATCH",
      body: JSON.stringify({
        name: root.querySelector("#project-settings-name").value.trim(),
        description: root.querySelector("#project-settings-description").value.trim(),
        tags: root
          .querySelector("#project-settings-tags")
          .value.split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    await ctx.selectProject(ctx.state.selectedProjectId);
    ctx.toast("项目设置已保存");
    ctx.render();
  });

  root.querySelector("#delete-project-btn")?.addEventListener("click", async () => {
    if (!window.confirm("删除当前项目？其知识库、子项目和相关会话都会被删除。")) return;
    await ctx.api(`/projects/${ctx.state.selectedProjectId}`, { method: "DELETE" });
    ctx.state.selectedProjectId = null;
    ctx.state.selectedProject = null;
    ctx.state.selectedSubProjectId = null;
    ctx.state.selectedSubProject = null;
    await ctx.reloadProjects();
    await ctx.reloadSessions();
    ctx.go("projects");
  });
}
