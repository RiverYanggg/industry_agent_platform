import { escapeHtml } from "../core/utils.js";

function countSubProjects(projects) {
  return projects.reduce((sum, item) => sum + (item.subproject_count || item.subprojects?.length || 0), 0);
}

function countModels(projects) {
  return projects.reduce((sum, item) => sum + (item.model_count || 0), 0);
}

function countDocs(projects) {
  return projects.reduce((sum, item) => sum + (item.doc_count || 0), 0);
}

export function renderHomePage(ctx) {
  const { state } = ctx;
  const recentProjects = [...state.projects].slice(0, 4);
  return `
    <section class="stack">
      <section class="hero-banner hero-card home-hero-wide">
        <div class="eyebrow">Platform Home</div>
        <div class="hero-title-row">
          <div>
            <h2 class="section-title">项目、模型、知识库与 Agent 在同一工作流内协同。</h2>
          </div>
        </div>
        <p>
          首页只保留全局概览与最近项目入口。详细训练、知识库、预测与 Agent 操作都在对应工作台中完成。
        </p>
        <div class="action-row">
          <button type="button" class="action-btn" data-home-action="open-projects">进入项目列表</button>
          <button type="button" class="ghost-btn" data-home-action="open-agent">打开 Agent 对话</button>
        </div>
      </section>

      <section class="metrics-grid">
        <article class="stat-card blue">
          <span>项目</span>
          <strong>${state.projects.length}</strong>
          <div class="card-meta">顶层项目总数</div>
        </article>
        <article class="stat-card green">
          <span>子项目</span>
          <strong>${countSubProjects(state.projects)}</strong>
          <div class="card-meta">训练与数据作用域</div>
        </article>
        <article class="stat-card violet">
          <span>知识文档</span>
          <strong>${countDocs(state.projects)}</strong>
          <div class="card-meta">RAG 文档总量</div>
        </article>
        <article class="stat-card gold">
          <span>已保存模型</span>
          <strong>${countModels(state.projects)}</strong>
          <div class="card-meta">可复用模型资产</div>
        </article>
      </section>

      <section class="panel home-recent-section">
        <div class="card-title-row">
          <div>
            <div class="eyebrow">Recent Projects</div>
            <h3 class="section-title">最近项目</h3>
          </div>
          <button type="button" class="ghost-btn" data-home-action="open-projects">查看全部</button>
        </div>
        <div class="project-card-grid">
          ${
            recentProjects.length
              ? recentProjects
                  .map(
                    (project) => `
                      <article class="project-showcase-card" data-home-project="${project.id}">
                        <div class="project-showcase-top">
                          <div>
                            <strong>${escapeHtml(project.name)}</strong>
                            <div class="card-meta">${escapeHtml(project.description || "暂无描述")}</div>
                          </div>
                          <span class="status-chip">${escapeHtml(project.status || "active")}</span>
                        </div>
                        <div class="project-inline-metrics">
                          <span class="metric-pill">文档 ${project.doc_count}</span>
                          <span class="metric-pill">子项目 ${project.subproject_count}</span>
                          <span class="metric-pill">模型 ${project.model_count}</span>
                        </div>
                      </article>
                    `
                  )
                  .join("")
              : `<div class="empty-card">当前还没有项目。建议先创建一个项目，再上传知识文档和训练数据。</div>`
          }
        </div>
      </section>
    </section>
  `;
}

export function bindHomePage(ctx, root) {
  root.querySelectorAll("[data-home-action='open-projects']").forEach((button) => {
    button.addEventListener("click", () => ctx.go("projects", "overview"));
  });
  root.querySelectorAll("[data-home-action='open-agent']").forEach((button) => {
    button.addEventListener("click", () => ctx.go("agent"));
  });
  root.querySelectorAll("[data-home-project]").forEach((card) => {
    card.addEventListener("click", async () => {
      await ctx.selectProject(card.dataset.homeProject);
      ctx.go("project", "overview");
    });
  });
}
