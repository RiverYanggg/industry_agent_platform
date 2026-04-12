import { escapeHtml } from "../core/utils.js";

function renderCreateSheet(ctx) {
  if (!ctx.state.projectCreateOpen) return "";
  return `
    <section class="panel compact-panel">
      <div class="card-title-row">
        <div>
          <div class="eyebrow">Create</div>
          <h3 class="section-title">新建项目</h3>
        </div>
        <button type="button" class="ghost-btn" id="cancel-project-create-btn">取消</button>
      </div>
      <form id="project-create-form" class="field-grid">
        <label class="field-label">
          <span>项目名称</span>
          <input id="project-name" type="text" placeholder="例如：材料强度预测 / 数据中台试验项目" required />
        </label>
        <label class="field-label">
          <span>标签</span>
          <input id="project-tags" type="text" placeholder="工艺, 回归预测, 实验室" />
        </label>
        <label class="field-label">
          <span>项目描述</span>
          <textarea id="project-description" placeholder="简要描述当前项目的目标、数据来源与交付内容"></textarea>
        </label>
        <div class="action-row">
          <button type="submit" class="action-btn">创建项目</button>
        </div>
      </form>
    </section>
  `;
}

function renderProjectCard(project, editing = false) {
  if (editing) {
    return `
      <article class="project-showcase-card project-showcase-card--editing" data-project-id="${project.id}">
        <form class="field-grid project-inline-form" data-project-edit-form="${project.id}">
          <label class="field-label">
            <span>项目名称</span>
            <input type="text" name="name" value="${escapeHtml(project.name)}" required />
          </label>
          <label class="field-label project-inline-wide">
            <span>项目描述</span>
            <textarea name="description" placeholder="项目描述">${escapeHtml(project.description || "")}</textarea>
          </label>
          <label class="field-label project-inline-wide">
            <span>标签</span>
            <input type="text" name="tags" value="${escapeHtml((project.tags || []).join(", "))}" placeholder="工艺, 回归预测, 实验室" />
          </label>
          <div class="project-showcase-metrics project-showcase-metrics--compact">
            <div><span>知识文档</span><strong>${project.doc_count}</strong></div>
            <div><span>子项目</span><strong>${project.subproject_count}</strong></div>
            <div><span>模型</span><strong>${project.model_count}</strong></div>
          </div>
          <div class="action-row project-inline-actions">
            <button type="submit" class="action-btn">保存</button>
            <button type="button" class="ghost-btn" data-cancel-project-edit="${project.id}">取消</button>
            <button type="button" class="danger-btn" data-delete-project="${project.id}">删除项目</button>
          </div>
        </form>
      </article>
    `;
  }
  return `
    <article class="project-showcase-card" data-open-project="${project.id}">
      <div class="project-showcase-top">
        <div>
          <strong>${escapeHtml(project.name)}</strong>
          <div class="card-meta">${escapeHtml(project.description || "暂无描述")}</div>
        </div>
        <span class="status-chip">${escapeHtml(project.status || "active")}</span>
      </div>
      <div class="chip-row">
        ${(project.tags || []).map((tag) => `<span class="tag">${escapeHtml(tag)}</span>`).join("") || `<span class="tag">未设置标签</span>`}
      </div>
      <div class="project-showcase-metrics project-showcase-metrics--compact">
        <div><span>知识文档</span><strong>${project.doc_count}</strong></div>
        <div><span>子项目</span><strong>${project.subproject_count}</strong></div>
        <div><span>模型</span><strong>${project.model_count}</strong></div>
      </div>
      <div class="action-row project-card-actions">
        <button type="button" class="ghost-btn" data-edit-project="${project.id}">编辑</button>
      </div>
    </article>
  `;
}

export function renderProjectsPage(ctx) {
  const projects = ctx.state.projects || [];
  return `
    <section class="stack">
      <section class="panel compact-panel">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">Workspace</div>
            <h2 class="section-title">项目列表</h2>
            <div class="section-copy">这里仅负责浏览和进入项目。知识库、训练、模型预测与项目 Agent 全部在项目详情页处理。</div>
          </div>
          <div class="action-row">
            <span class="meta-chip muted">${projects.length} 个项目</span>
            <button type="button" class="ghost-btn" id="refresh-projects-btn">刷新</button>
            <button type="button" class="action-btn" id="open-project-create-btn">${ctx.state.projectCreateOpen ? "收起创建器" : "新建项目"}</button>
          </div>
        </div>
      </section>

      ${renderCreateSheet(ctx)}

      <section class="panel compact-panel project-card-section">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">All Projects</div>
            <h3 class="section-title">项目卡片</h3>
          </div>
        </div>
        <div class="project-card-grid">
          ${
            projects.length
              ? projects
                  .map((project) => renderProjectCard(project, ctx.state.projectEditingId === project.id))
                  .join("")
              : `<div class="empty-card">还没有项目。点击右上角“新建项目”后即可开始。</div>`
          }
        </div>
      </section>
    </section>
  `;
}

export function bindProjectsPage(ctx, root) {
  root.querySelector("#refresh-projects-btn")?.addEventListener("click", async () => {
    await ctx.reloadProjects();
    ctx.render();
  });

  root.querySelector("#open-project-create-btn")?.addEventListener("click", () => {
    ctx.state.projectCreateOpen = !ctx.state.projectCreateOpen;
    ctx.render();
  });

  root.querySelector("#cancel-project-create-btn")?.addEventListener("click", () => {
    ctx.state.projectCreateOpen = false;
    ctx.render();
  });

  root.querySelector("#project-create-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    const name = root.querySelector("#project-name").value.trim();
    if (!name) return;
    await ctx.api("/projects", {
      method: "POST",
      body: JSON.stringify({
        name,
        description: root.querySelector("#project-description").value.trim(),
        tags: root
          .querySelector("#project-tags")
          .value.split(",")
          .map((item) => item.trim())
          .filter(Boolean),
      }),
    });
    ctx.state.projectCreateOpen = false;
    await ctx.reloadProjects();
    ctx.toast("项目已创建");
    ctx.render();
  });

  root.querySelectorAll("[data-edit-project]").forEach((button) => {
    button.addEventListener("click", (event) => {
      event.stopPropagation();
      ctx.state.projectEditingId = button.dataset.editProject;
      ctx.render();
    });
  });

  root.querySelectorAll("[data-cancel-project-edit]").forEach((button) => {
    button.addEventListener("click", () => {
      if (ctx.state.projectEditingId === button.dataset.cancelProjectEdit) {
        ctx.state.projectEditingId = null;
      }
      ctx.render();
    });
  });

  root.querySelectorAll("[data-project-edit-form]").forEach((form) => {
    form.addEventListener("submit", async (event) => {
      event.preventDefault();
      const projectId = form.dataset.projectEditForm;
      const fd = new FormData(form);
      await ctx.api(`/projects/${projectId}`, {
        method: "PATCH",
        body: JSON.stringify({
          name: String(fd.get("name") || "").trim(),
          description: String(fd.get("description") || "").trim(),
          tags: String(fd.get("tags") || "")
            .split(",")
            .map((item) => item.trim())
            .filter(Boolean),
        }),
      });
      ctx.state.projectEditingId = null;
      await ctx.reloadProjects();
      ctx.toast("项目已更新");
      ctx.render();
    });
  });

  root.querySelectorAll("[data-delete-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      const projectId = button.dataset.deleteProject;
      if (!projectId || !window.confirm("删除该项目？该操作不可恢复。")) return;
      await ctx.api(`/projects/${projectId}`, { method: "DELETE" });
      if (ctx.state.projectEditingId === projectId) {
        ctx.state.projectEditingId = null;
      }
      await ctx.reloadProjects();
      ctx.toast("项目已删除");
      ctx.render();
    });
  });

  root.querySelectorAll("[data-open-project]").forEach((button) => {
    button.addEventListener("click", async () => {
      await ctx.selectProject(button.dataset.openProject);
      ctx.go("project", "overview");
    });
  });
}
