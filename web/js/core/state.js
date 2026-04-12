export const state = {
  route: "home",
  workspaceTab: "overview",
  workspaceSidebarCollapsed: false,
  autoCreatingDefaultSubproject: false,
  subprojectEditorMode: null,
  projectCreateOpen: false,
  projectEditingId: null,
  apiSection: "profiles",
  apiNavCollapsed: false,
  health: null,
  templates: [],
  selectedTemplateId: null,
  agentConfig: null,
  projects: [],
  selectedProjectId: null,
  selectedProject: null,
  selectedSubProjectId: null,
  selectedSubProject: null,
  selectedDatasetId: null,
  datasetPreview: null,
  knowledgeSearchResults: [],
  roleAssignment: { features: [], targets: [] },
  selectedModelId: null,
  singlePredictResult: null,
  manualPredictResult: null,
  artifactEditingId: null,
  artifactComposerOpen: false,
  trainingTemplateFocusId: null,
  trainingTemplateMenuOpen: false,
  sessions: [],
  currentSessionId: null,
  currentSession: null,
  agentSidebarOpen: false,
  showAgentDebug: false,
  agentUploading: false,
  agentAwaitingReply: false,
  agentAbortController: null,
  agentStreamingMessage: "",
  agentLiveEvents: [],
  terminalLines: [],
  pendingAttachments: [],
  llmProfiles: [],
  selectedProfileId: null,
};

export function resetAgentStream() {
  state.agentStreamingMessage = "";
  state.agentLiveEvents = [];
}

export function activeProject() {
  return state.projects.find((item) => item.id === state.selectedProjectId) || state.selectedProject || null;
}

export function activeSubProject() {
  return state.selectedSubProject || null;
}

export function activeModels() {
  return state.selectedSubProject?.models || [];
}

export function currentModel() {
  return activeModels().find((item) => item.id === state.selectedModelId) || activeModels()[0] || null;
}
