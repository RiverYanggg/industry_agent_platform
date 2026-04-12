import { api, readSseStream } from "./core/api.js";
import { $, $$, setHtml } from "./core/dom.js";
import { state, currentModel, resetAgentStream } from "./core/state.js";
import { humanFileSize, revokeDraft } from "./core/utils.js";
import { renderHomePage, bindHomePage } from "./pages/home.js";
import { renderProjectsPage, bindProjectsPage } from "./pages/projects.js";
import { renderProjectDetailPage, bindProjectDetailPage } from "./pages/project-detail.js";
import { renderAgentPage, bindAgentPage, cleanupAgentDrafts } from "./pages/agent.js";
import { renderApiPage, bindApiPage } from "./pages/api.js";

const HERO_META = {
  home: null,
  projects: null,
  project: {
    kicker: "Project Detail",
    title: "项目详情",
    description: "在项目内部处理知识库、训练、模型预测和项目 Agent。",
  },
  agent: null,
  api: null,
};

function toast(message, isError = false) {
  const root = $("#toast-root");
  const item = document.createElement("div");
  item.className = `toast ${isError ? "error" : ""}`;
  item.textContent = message;
  root.appendChild(item);
  setTimeout(() => item.remove(), 3200);
}

function appendTerminal(line) {
  state.terminalLines.push(line);
  if (state.terminalLines.length > 240) {
    state.terminalLines = state.terminalLines.slice(-240);
  }
}

function parseRouteHash() {
  const cleaned = (location.hash || "#/home").replace(/^#\//, "");
  const [route = "home", sub] = cleaned.split("/");
  state.route = ["home", "projects", "project", "agent", "api"].includes(route) ? route : "home";
  if (state.route === "project" && sub) {
    state.workspaceTab = sub;
  }
}

function go(route, sub) {
  if (route === "project" && sub) {
    location.hash = `#/project/${sub}`;
    return;
  }
  location.hash = `#/${route}`;
}

function renderNav() {
  $$("[data-route]").forEach((button) => {
    const activeRoute = state.route === "project" ? "projects" : state.route;
    button.classList.toggle("active", button.dataset.route === activeRoute);
  });
}

function renderContextChips() {
  const healthChip = $("#health-chip");
  const projectChip = $("#context-project-chip");
  if (healthChip) {
    healthChip.textContent = state.health?.status === "ok" ? "服务正常" : "健康检查中";
  }
  if (projectChip) {
    projectChip.textContent = state.selectedProject?.name || "未选项目";
  }
}

function renderHero() {
  const root = $("#page-hero");
  const meta = HERO_META[state.route];
  if (!meta) {
    root.innerHTML = "";
    root.classList.add("hidden");
    return;
  }
  root.classList.remove("hidden");
  root.innerHTML = `
    <div class="panel">
      <div class="eyebrow">${meta.kicker}</div>
      <div class="card-title-row">
        <div>
          <h2 class="section-title">${meta.title}</h2>
          <div class="section-copy">${meta.description}</div>
        </div>
        <div class="inline-cluster">
          <span class="meta-chip">${state.agentConfig?.runtime_mode === "llm" ? "远程 LLM" : "本地回退"}</span>
          <span class="meta-chip muted">${state.sessions.length} 个会话</span>
        </div>
      </div>
    </div>
  `;
}

export function resetRoleAssignment(columns) {
  if (!columns?.length) {
    state.roleAssignment = { features: [], targets: [] };
    return;
  }
  state.roleAssignment = {
    features: columns.slice(0, Math.max(1, columns.length - 1)),
    targets: [columns[columns.length - 1]],
  };
}

export function toggleRole(column, role) {
  const features = new Set(state.roleAssignment.features);
  const targets = new Set(state.roleAssignment.targets);
  if (role === "feature") {
    if (features.has(column)) {
      features.delete(column);
    } else {
      features.add(column);
      targets.delete(column);
    }
  } else {
    if (targets.has(column)) {
      targets.delete(column);
    } else {
      targets.add(column);
      features.delete(column);
    }
  }
  state.roleAssignment = { features: [...features], targets: [...targets] };
}

async function loadHealth() {
  try {
    state.health = await api("/health");
  } catch {
    state.health = { status: "degraded" };
  }
}

async function loadTemplates() {
  state.templates = await api("/catalog/model-templates");
  state.selectedTemplateId = state.selectedTemplateId || state.templates[0]?.template_id || null;
}

async function loadAgentConfig() {
  state.agentConfig = await api("/settings/agent-model");
}

function defaultProfilesFromConfig() {
  if (!state.agentConfig?.model && !state.agentConfig?.base_url) return [];
  return [
    {
      id: `profile_${Date.now()}`,
      name: state.agentConfig.model ? `${state.agentConfig.model} 默认配置` : "当前运行配置",
      base_url: state.agentConfig.base_url || "",
      api_key: "",
      model: state.agentConfig.model || "",
      temperature: state.agentConfig.temperature ?? 0.2,
      system_prompt: state.agentConfig.system_prompt || "",
    },
  ];
}

function loadLlmProfiles() {
  try {
    const raw = globalThis.localStorage?.getItem("industry-agent-llm-profiles");
    const parsed = raw ? JSON.parse(raw) : defaultProfilesFromConfig();
    state.llmProfiles = Array.isArray(parsed) ? parsed : [];
    state.selectedProfileId = state.llmProfiles[0]?.id || null;
  } catch {
    state.llmProfiles = defaultProfilesFromConfig();
    state.selectedProfileId = state.llmProfiles[0]?.id || null;
  }
}

function persistLlmProfiles() {
  try {
    globalThis.localStorage?.setItem("industry-agent-llm-profiles", JSON.stringify(state.llmProfiles));
  } catch {
    // ignore
  }
}

async function ensureProject(projectId) {
  if (!projectId) return null;
  const existing = state.projects.find((item) => item.id === projectId);
  if (existing?.subprojects) {
    return existing;
  }
  const project = await api(`/projects/${projectId}`);
  state.projects = state.projects.map((item) => (item.id === projectId ? { ...item, ...project } : item));
  return project;
}

async function selectProject(projectId) {
  if (!projectId) return;
  state.selectedProjectId = projectId;
  state.selectedProject = await api(`/projects/${projectId}`);
  state.projects = state.projects.map((item) => (item.id === projectId ? { ...item, ...state.selectedProject } : item));
  state.knowledgeSearchResults = [];
  const existingSubProject = state.selectedProject.subprojects.find((item) => item.id === state.selectedSubProjectId);
  if (existingSubProject) {
    await selectSubProject(existingSubProject.id, false);
  } else if (state.selectedProject.subprojects?.length) {
    await selectSubProject(state.selectedProject.subprojects[0].id, false);
  } else {
    state.selectedSubProjectId = null;
    state.selectedSubProject = null;
    state.selectedDatasetId = null;
    state.datasetPreview = null;
    state.selectedModelId = null;
    state.singlePredictResult = null;
    state.manualPredictResult = null;
  }
}

async function selectSubProject(subprojectId, rerender = true) {
  if (!state.selectedProjectId || !subprojectId) return;
  state.selectedSubProjectId = subprojectId;
  state.selectedSubProject = await api(`/projects/${state.selectedProjectId}/subprojects/${subprojectId}`);
  state.selectedModelId = state.selectedSubProject.models?.[0]?.id || null;
  state.singlePredictResult = null;
  state.manualPredictResult = null;
  const firstDataset = state.selectedSubProject.datasets?.[0];
  if (firstDataset) {
    state.selectedDatasetId = firstDataset.id;
    state.datasetPreview = await api(`/projects/${state.selectedProjectId}/subprojects/${subprojectId}/data/${firstDataset.id}/preview`);
    resetRoleAssignment(state.datasetPreview?.columns || []);
  } else {
    state.selectedDatasetId = null;
    state.datasetPreview = null;
    resetRoleAssignment([]);
  }
  if (rerender) render();
}

async function reloadProjects() {
  state.projects = await api("/projects");
  if (!state.projects.length) {
    state.selectedProjectId = null;
    state.selectedProject = null;
    state.selectedSubProjectId = null;
    state.selectedSubProject = null;
    return;
  }
  if (state.selectedProjectId && state.projects.some((item) => item.id === state.selectedProjectId)) {
    await selectProject(state.selectedProjectId);
    return;
  }
  await selectProject(state.projects[0].id);
}

async function reloadSessions() {
  state.sessions = await api("/agent/sessions");
  if (state.currentSessionId && state.sessions.some((item) => item.id === state.currentSessionId)) {
    state.currentSession = await api(`/agent/sessions/${state.currentSessionId}`);
    return;
  }
  state.currentSessionId = null;
  state.currentSession = null;
}

async function selectSession(sessionId) {
  state.currentSessionId = sessionId;
  state.currentSession = await api(`/agent/sessions/${sessionId}`);
  await ensureProject(state.currentSession.project_id);
  if (state.currentSession.project_id !== state.selectedProjectId) {
    await selectProject(state.currentSession.project_id);
  }
  if (state.currentSession.subproject_id && state.currentSession.subproject_id !== state.selectedSubProjectId) {
    await selectSubProject(state.currentSession.subproject_id, false);
  }
  resetAgentStream();
}

async function ensureAgentSession({ projectId, subprojectId = null, title } = {}) {
  if (
    state.currentSessionId &&
    state.currentSession &&
    (!projectId ||
      (state.currentSession.project_id === projectId && (state.currentSession.subproject_id || null) === (subprojectId || null)))
  ) {
    return state.currentSessionId;
  }
  if (!projectId) return null;
  const session = await api("/agent/sessions", {
    method: "POST",
    body: JSON.stringify({
      title: title || `会话 ${new Date().toLocaleTimeString()}`,
      project_id: projectId,
      subproject_id: subprojectId,
    }),
  });
  state.currentSessionId = session.id;
  await reloadSessions();
  return session.id;
}

function queuePendingAttachments(files) {
  const items = Array.from(files || []).filter(Boolean).map((file, index) => ({
    id: `draft_${Date.now()}_${index}_${Math.random().toString(36).slice(2, 8)}`,
    file,
    name: file.name,
    size: file.size,
    isImage: file.type.startsWith("image/"),
    previewUrl: file.type.startsWith("image/") ? URL.createObjectURL(file) : "",
  }));
  state.pendingAttachments = [...state.pendingAttachments, ...items];
}

function removePendingAttachment(id) {
  const match = state.pendingAttachments.find((item) => item.id === id);
  if (match) revokeDraft(match);
  state.pendingAttachments = state.pendingAttachments.filter((item) => item.id !== id);
}

function clearPendingAttachments() {
  cleanupAgentDrafts({ state });
  state.pendingAttachments = [];
}

async function uploadPendingAttachments() {
  if (!state.currentSessionId || !state.pendingAttachments.length) return;
  state.agentUploading = true;
  render();
  try {
    for (const item of state.pendingAttachments) {
      const form = new FormData();
      form.append("file", item.file);
      appendTerminal(`[attachment_upload] ${item.name} ${humanFileSize(item.size)}`);
      await api(`/agent/sessions/${state.currentSessionId}/attachments`, { method: "POST", body: form });
    }
    clearPendingAttachments();
    await selectSession(state.currentSessionId);
  } finally {
    state.agentUploading = false;
  }
}

function handleAgentEvent(event) {
  const { type, payload } = event;
  if (type === "agent_mode") {
    if (state.agentConfig) {
      state.agentConfig.runtime_mode = payload.mode;
      if (payload.model && payload.model !== "local-fallback") {
        state.agentConfig.model = payload.model;
      }
    }
    appendTerminal(`[agent_mode] ${payload.mode} / ${payload.model}`);
    render();
    return;
  }
  if (type === "terminal_stdout") {
    appendTerminal(payload.text);
    if (state.showAgentDebug) render();
    return;
  }
  if (type === "context") {
    appendTerminal(`[context] project=${payload.project} subproject=${payload.subproject}`);
    return;
  }
  if (type === "message_delta") {
    state.agentStreamingMessage += payload.delta;
    render();
    return;
  }
  if (["tool_plan", "tool_start", "tool_result", "file_ready"].includes(type)) {
    state.agentLiveEvents.push({ type, payload });
    appendTerminal(`[${type}] ${payload.tool || payload.file_url || ""}`.trim());
    render();
    return;
  }
}

async function streamTurn(message) {
  const controller = new AbortController();
  try {
    state.currentSession = state.currentSession || { messages: [], attachments: [], tools: [] };
    state.currentSession.messages = [...(state.currentSession.messages || []), { role: "user", content: message, metadata: { events: [] } }];
    state.agentAwaitingReply = true;
    state.agentAbortController = controller;
    resetAgentStream();
    render();
    await readSseStream(`/agent/sessions/${state.currentSessionId}/turn`, { message }, handleAgentEvent, {
      signal: controller.signal,
    });
    if (state.currentSessionId) {
      await selectSession(state.currentSessionId);
    }
    state.agentAwaitingReply = false;
    state.agentAbortController = null;
    render();
  } catch (error) {
    if (error?.name === "AbortError") {
      if (state.agentStreamingMessage) {
        state.currentSession = state.currentSession || { messages: [], attachments: [], tools: [] };
        state.currentSession.messages = [
          ...(state.currentSession.messages || []),
          {
            role: "assistant",
            content: `${state.agentStreamingMessage}\n\n[已手动停止生成]`,
            metadata: { events: [...state.agentLiveEvents] },
          },
        ];
      }
      state.agentAwaitingReply = false;
      state.agentAbortController = null;
      resetAgentStream();
      render();
      return;
    }
    state.agentAwaitingReply = false;
    state.agentAbortController = null;
    resetAgentStream();
    render();
    toast(error.message, true);
  }
}

function stopAgentStream() {
  state.agentAbortController?.abort();
}

function pageContext() {
  return {
    state,
    api,
    go,
    render,
    toast,
    loadAgentConfig,
    reloadProjects,
    reloadSessions,
    selectProject,
    selectSubProject,
    selectSession,
    ensureProject,
    ensureAgentSession,
    persistLlmProfiles,
    currentModel,
    toggleRole,
    resetRoleAssignment,
    queuePendingAttachments,
    removePendingAttachment,
    clearPendingAttachments,
    uploadPendingAttachments,
    streamTurn,
    stopAgentStream,
    activeProjectName: state.selectedProject?.name || "",
    activeSubProjectName: state.selectedSubProject?.name || "",
  };
}

function renderCurrentPage() {
  const root = $("#view-root");
  const ctx = pageContext();
  switch (state.route) {
    case "project":
      setHtml(root, renderProjectDetailPage(ctx));
      bindProjectDetailPage(ctx, root);
      break;
    case "projects":
      setHtml(root, renderProjectsPage(ctx));
      bindProjectsPage(ctx, root);
      break;
    case "agent":
      setHtml(root, renderAgentPage(ctx));
      bindAgentPage(ctx, root);
      break;
    case "api":
      setHtml(root, renderApiPage(ctx));
      bindApiPage(ctx, root);
      break;
    case "home":
    default:
      setHtml(root, renderHomePage(ctx));
      bindHomePage(ctx, root);
      break;
  }
}

function render() {
  renderNav();
  renderContextChips();
  renderHero();
  renderCurrentPage();
}

function bindShellEvents() {
  $$("[data-route]").forEach((button) => {
    button.addEventListener("click", () => go(button.dataset.route, button.dataset.route === "projects" ? state.workspaceTab : undefined));
  });
  window.addEventListener("hashchange", () => {
    parseRouteHash();
    render();
  });
  window.addEventListener("beforeunload", () => clearPendingAttachments());
}

async function bootstrap() {
  parseRouteHash();
  bindShellEvents();
  await Promise.all([loadHealth(), loadTemplates(), loadAgentConfig()]);
  loadLlmProfiles();
  await reloadProjects();
  await reloadSessions();
  render();
}

bootstrap().catch((error) => {
  toast(error.message, true);
});
