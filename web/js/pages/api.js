import { escapeHtml } from "../core/utils.js";

const API_SECTIONS = [
  {
    id: "profiles",
    label: "模型配置",
    short: "M",
    title: "模型配置库",
    description: "保存多个 OpenAI-compatible 配置，并按需应用到当前 Agent 运行时。",
  },
  {
    id: "runtime",
    label: "运行时",
    short: "R",
    title: "当前运行时",
    description: "直接修改后端当前生效的 Agent 模型配置，适合联调与临时切换。",
  },
  {
    id: "guide",
    label: "接入说明",
    short: "G",
    title: "接入说明",
    description: "查看 API 代理接入方式、请求地址和当前运行摘要。",
  },
];

function activeProfile(ctx) {
  return ctx.state.llmProfiles.find((item) => item.id === ctx.state.selectedProfileId) || null;
}

function currentSection(ctx) {
  return API_SECTIONS.find((item) => item.id === ctx.state.apiSection) || API_SECTIONS[0];
}

function renderApiHeader(ctx) {
  const section = currentSection(ctx);
  return `
    <section class="panel api-header-card">
      <div class="api-header-main">
        <div class="api-header-copy">
          <div class="eyebrow">Configuration</div>
          <h2 class="section-title">${escapeHtml(section.title)}</h2>
          <div class="section-copy">${escapeHtml(section.description)}</div>
        </div>
      </div>
    </section>
  `;
}

function renderApiNav(ctx) {
  const collapsed = ctx.state.apiNavCollapsed;
  if (collapsed) {
    return "";
  }
  return `
    <aside class="api-nav-shell">
      <div class="api-nav-list">
        ${API_SECTIONS.map(
          (section) => `
            <button
              type="button"
              class="project-tile api-nav-item ${ctx.state.apiSection === section.id ? "active" : ""}"
              data-api-section="${section.id}"
              title="${escapeHtml(section.label)}"
            >
              <span class="api-nav-icon">${escapeHtml(section.short)}</span>
              ${
                collapsed
                  ? ""
                  : `
                    <span class="api-nav-copy">
                      <strong>${escapeHtml(section.label)}</strong>
                      <span class="card-meta">${escapeHtml(section.description)}</span>
                    </span>
                  `
              }
            </button>
          `
        ).join("")}
      </div>
    </aside>
  `;
}

function renderProfileList(ctx) {
  if (!ctx.state.llmProfiles.length) {
    return `<div class="empty-card">还没有本地保存的模型配置。点击右上角“新增配置”开始。</div>`;
  }

  return ctx.state.llmProfiles
    .map(
      (item) => `
        <article class="project-tile api-profile-tile ${item.id === ctx.state.selectedProfileId ? "active" : ""}">
          <button type="button" class="profile-select-btn" data-select-profile="${item.id}">
            <strong>${escapeHtml(item.name)}</strong>
            <div class="card-meta">${escapeHtml(item.model || "未指定模型")}</div>
            <div class="card-meta">${escapeHtml(item.base_url || "未配置 Base URL")}</div>
          </button>
          <div class="action-row">
            <button type="button" class="ghost-btn" data-apply-profile="${item.id}">应用</button>
            <button type="button" class="danger-btn" data-delete-profile="${item.id}">删除</button>
          </div>
        </article>
      `
    )
    .join("");
}

function renderProfilesSection(ctx) {
  const profile = activeProfile(ctx);
  return `
    <section class="panel api-workspace-panel">
      <div class="api-section-head">
        <div>
          <strong>配置列表</strong>
          <div class="card-meta">选择左侧配置后在右侧编辑，应用后立即切换 Agent 运行时。</div>
        </div>
        <div class="action-row">
          <span class="meta-chip muted">${ctx.state.llmProfiles.length} 个配置</span>
          <button type="button" class="action-btn" id="new-profile-btn">新增配置</button>
        </div>
      </div>

      <div class="api-workspace-grid">
        <aside class="api-list-column">
          <div class="result-stack">${renderProfileList(ctx)}</div>
        </aside>

        <section class="api-editor-column">
          <div class="api-editor-head">
            <div>
              <strong>${profile ? "编辑配置" : "新增配置"}</strong>
              <div class="card-meta">${profile ? "修改后保存即可更新本地配置库。" : "填写一个新的 OpenAI-compatible 模型接入配置。"}</div>
            </div>
            ${profile ? `<span class="meta-chip">${escapeHtml(profile.model || "未指定模型")}</span>` : ""}
          </div>
          <form id="profile-form" class="field-grid api-form-grid">
            <label class="field-label">
              <span>配置名称</span>
              <input id="profile-name" type="text" value="${escapeHtml(profile?.name || "")}" placeholder="例如：GLM 内网代理 / GPT-4 Team Proxy" />
            </label>
            <label class="field-label">
              <span>Base URL</span>
              <input id="profile-base-url" type="text" value="${escapeHtml(profile?.base_url || "")}" placeholder="https://hostname/v1/" />
            </label>
            <label class="field-label">
              <span>API Key</span>
              <input id="profile-api-key" type="password" value="${escapeHtml(profile?.api_key || "")}" placeholder="sk-..." />
            </label>
            <label class="field-label">
              <span>Model ID</span>
              <input id="profile-model" type="text" value="${escapeHtml(profile?.model || "")}" placeholder="gpt-4o-mini / glm-4.6 / 自定义模型 ID" />
            </label>
            <label class="field-label">
              <span>Temperature</span>
              <input id="profile-temperature" type="number" min="0" max="2" step="0.1" value="${profile?.temperature ?? 0.2}" />
            </label>
            <label class="field-label api-wide-field">
              <span>System Prompt</span>
              <textarea id="profile-system-prompt" placeholder="Agent 系统提示词">${escapeHtml(profile?.system_prompt || "")}</textarea>
            </label>
            <div class="action-row api-wide-field">
              <button type="submit" class="action-btn">保存配置</button>
              ${profile ? `<button type="button" class="ghost-btn" id="apply-current-profile-btn">应用到运行时</button>` : ""}
            </div>
          </form>
        </section>
      </div>
    </section>
  `;
}

function renderRuntimeSection(ctx) {
  const config = ctx.state.agentConfig || {};
  return `
    <section class="panel api-workspace-panel">
      <div class="api-section-head">
        <div>
          <strong>运行时配置</strong>
          <div class="card-meta">这里修改的是后端当前生效配置，不会覆盖本地配置库。</div>
        </div>
        <button type="button" class="ghost-btn" id="test-agent-config-btn">测试连接</button>
      </div>

      <form id="agent-config-form" class="field-grid api-form-grid">
        <label class="field-label">
          <span>运行模式</span>
          <select id="config-enabled">
            <option value="true" ${config.enabled ? "selected" : ""}>启用远程 LLM</option>
            <option value="false" ${!config.enabled ? "selected" : ""}>仅使用本地回退</option>
          </select>
        </label>
        <label class="field-label">
          <span>Base URL</span>
          <input id="config-base-url" type="text" value="${escapeHtml(config.base_url || "")}" placeholder="https://hostname/v1/" />
        </label>
        <label class="field-label">
          <span>API Key</span>
          <input id="config-api-key" type="password" placeholder="sk-..." />
        </label>
        <label class="field-label">
          <span>Model ID</span>
          <input id="config-model" type="text" value="${escapeHtml(config.model || "")}" placeholder="gpt-4o-mini / your-model" />
        </label>
        <label class="field-label">
          <span>Temperature</span>
          <input id="config-temperature" type="number" min="0" max="2" step="0.1" value="${config.temperature ?? 0.2}" />
        </label>
        <label class="field-label api-wide-field">
          <span>System Prompt</span>
          <textarea id="config-system-prompt" placeholder="Agent 系统提示词">${escapeHtml(config.system_prompt || "")}</textarea>
        </label>
        <div class="action-row api-wide-field">
          <button type="submit" class="action-btn">保存运行配置</button>
        </div>
      </form>
    </section>
  `;
}

function renderGuideSection(ctx) {
  const config = ctx.state.agentConfig || {};
  return `
    <section class="panel api-workspace-panel">
      <div class="api-section-head">
        <div>
          <strong>OpenAI-compatible 接入</strong>
          <div class="card-meta">后端已经兼容 `/v1/chat/completions` 与 `/v1/models`，外部客户端可直接接入。</div>
        </div>
        <span class="meta-chip">${config.runtime_mode === "llm" ? "远程 LLM 已启用" : "当前为本地回退"}</span>
      </div>

      <div class="api-guide-grid">
        <div class="result-card">
          <strong>当前摘要</strong>
          <div class="card-meta">Base URL: ${escapeHtml(config.base_url || "未配置")}</div>
          <div class="card-meta">Model: ${escapeHtml(config.model || "未配置")}</div>
          <div class="card-meta">API Key: ${escapeHtml(config.api_key_mask || "未配置")}</div>
        </div>
        <pre class="code-block">import openai

client = openai.OpenAI(
    api_key="申请到的 key",
    base_url="http://127.0.0.1:8000/v1/",
)

response = client.chat.completions.create(
    model="industry-agent-default",
    messages=[{"role": "user", "content": "Hello World"}],
)
print(response)</pre>
      </div>
    </section>
  `;
}

export function renderApiPage(ctx) {
  const section = ctx.state.apiSection;
  let workspace = renderProfilesSection(ctx);
  if (section === "runtime") {
    workspace = renderRuntimeSection(ctx);
  } else if (section === "guide") {
    workspace = renderGuideSection(ctx);
  }

  return `
    <section class="stack">
      ${renderApiHeader(ctx)}
      <section class="page-with-floating-sidebar">
        <button
          type="button"
          class="icon-btn sidebar-collapsed-fab page-sidebar-fab api-sidebar-collapsed-fab ${ctx.state.apiNavCollapsed ? "" : "is-open"}"
          id="toggle-api-nav-btn"
          aria-label="${ctx.state.apiNavCollapsed ? "展开导航" : "收起导航"}"
          title="${ctx.state.apiNavCollapsed ? "展开导航" : "收起导航"}"
        >☰</button>
        <section class="api-page-layout ${ctx.state.apiNavCollapsed ? "api-page-layout--collapsed" : ""}">
          ${ctx.state.apiNavCollapsed ? "" : renderApiNav(ctx)}
          <div class="workspace-main">${workspace}</div>
        </section>
      </section>
    </section>
  `;
}

export function bindApiPage(ctx, root) {
  root.querySelector("#toggle-api-nav-btn")?.addEventListener("click", () => {
    ctx.state.apiNavCollapsed = !ctx.state.apiNavCollapsed;
    ctx.render();
  });

  root.querySelectorAll("[data-api-section]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.apiSection = button.dataset.apiSection;
      ctx.render();
    });
  });

  root.querySelectorAll("[data-select-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.selectedProfileId = button.dataset.selectProfile;
      ctx.render();
    });
  });

  root.querySelectorAll("[data-delete-profile]").forEach((button) => {
    button.addEventListener("click", () => {
      ctx.state.llmProfiles = ctx.state.llmProfiles.filter((item) => item.id !== button.dataset.deleteProfile);
      if (ctx.state.selectedProfileId === button.dataset.deleteProfile) {
        ctx.state.selectedProfileId = ctx.state.llmProfiles[0]?.id || null;
      }
      ctx.persistLlmProfiles();
      ctx.render();
    });
  });

  const applyProfile = async (profileId) => {
    const profile = ctx.state.llmProfiles.find((item) => item.id === profileId);
    if (!profile) return;
    await ctx.api("/settings/agent-model", {
      method: "PATCH",
      body: JSON.stringify({
        enabled: true,
        base_url: profile.base_url,
        api_key: profile.api_key || undefined,
        model: profile.model,
        temperature: Number(profile.temperature ?? 0.2),
        system_prompt: profile.system_prompt || "",
      }),
    });
    await ctx.loadAgentConfig();
    ctx.toast(`已应用配置：${profile.name}`);
    ctx.render();
  };

  root.querySelectorAll("[data-apply-profile]").forEach((button) => {
    button.addEventListener("click", () => applyProfile(button.dataset.applyProfile));
  });

  root.querySelector("#new-profile-btn")?.addEventListener("click", () => {
    ctx.state.selectedProfileId = null;
    ctx.render();
  });

  root.querySelector("#profile-form")?.addEventListener("submit", (event) => {
    event.preventDefault();
    const profile = {
      id: ctx.state.selectedProfileId || `profile_${Date.now()}`,
      name: root.querySelector("#profile-name").value.trim() || "未命名配置",
      base_url: root.querySelector("#profile-base-url").value.trim(),
      api_key: root.querySelector("#profile-api-key").value.trim(),
      model: root.querySelector("#profile-model").value.trim(),
      temperature: Number(root.querySelector("#profile-temperature").value || 0.2),
      system_prompt: root.querySelector("#profile-system-prompt").value,
    };
    const exists = ctx.state.llmProfiles.some((item) => item.id === profile.id);
    ctx.state.llmProfiles = exists
      ? ctx.state.llmProfiles.map((item) => (item.id === profile.id ? profile : item))
      : [profile, ...ctx.state.llmProfiles];
    ctx.state.selectedProfileId = profile.id;
    ctx.persistLlmProfiles();
    ctx.toast("本地 LLM 配置已保存");
    ctx.render();
  });

  root.querySelector("#apply-current-profile-btn")?.addEventListener("click", () => {
    if (ctx.state.selectedProfileId) {
      applyProfile(ctx.state.selectedProfileId);
    }
  });

  root.querySelector("#agent-config-form")?.addEventListener("submit", async (event) => {
    event.preventDefault();
    await ctx.api("/settings/agent-model", {
      method: "PATCH",
      body: JSON.stringify({
        enabled: root.querySelector("#config-enabled").value === "true",
        base_url: root.querySelector("#config-base-url").value.trim(),
        api_key: root.querySelector("#config-api-key").value.trim() || undefined,
        model: root.querySelector("#config-model").value.trim(),
        temperature: Number(root.querySelector("#config-temperature").value || 0.2),
        system_prompt: root.querySelector("#config-system-prompt").value,
      }),
    });
    await ctx.loadAgentConfig();
    ctx.toast("运行配置已保存");
    ctx.render();
  });

  root.querySelector("#test-agent-config-btn")?.addEventListener("click", async () => {
    try {
      const result = await ctx.api("/settings/agent-model/test", { method: "POST" });
      ctx.toast(`连接成功: ${result.preview}`);
      await ctx.loadAgentConfig();
      ctx.render();
    } catch (error) {
      ctx.toast(`连接失败: ${error.message}`, true);
    }
  });
}
