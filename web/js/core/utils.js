export function escapeHtml(value) {
  return String(value ?? "")
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#039;");
}

export function humanFileSize(value) {
  const size = Number(value || 0);
  if (size < 1024) return `${size} B`;
  if (size < 1024 * 1024) return `${(size / 1024).toFixed(1)} KB`;
  return `${(size / 1024 / 1024).toFixed(1)} MB`;
}

export function formatDuration(value) {
  if (!Number.isFinite(value) || value <= 0) return "";
  if (value < 1000) return `${value} ms`;
  return `${(value / 1000).toFixed(1)} s`;
}

export function previewTableHtml(preview) {
  if (!preview?.columns?.length) {
    return `<div class="empty-card">上传并选择数据后，这里会展示字段预览与样本数据。</div>`;
  }
  const head = preview.columns.map((column) => `<th>${escapeHtml(column)}</th>`).join("");
  const rows = (preview.rows || [])
    .map(
      (row) =>
        `<tr>${preview.columns.map((column) => `<td>${escapeHtml(row[column] ?? "")}</td>`).join("")}</tr>`
    )
    .join("");
  return `<table class="data-table"><thead><tr>${head}</tr></thead><tbody>${rows}</tbody></table>`;
}

export function formatContent(value) {
  return renderRichText(value, "chat-markdown");
}

export function renderMarkdownPreview(value) {
  const text = String(value || "").trim();
  if (!text) return `<p class="card-meta">暂无说明。</p>`;
  return renderRichText(text, "markdown-preview");
}

function renderRichText(value, className) {
  const text = String(value || "").replace(/\r\n/g, "\n").trim();
  if (!text) return "";
  const lines = text.split("\n");
  const parts = [];
  let listItems = [];
  let quoteLines = [];
  let codeFence = null;
  let codeLines = [];
  let paragraphLines = [];

  function flushParagraph() {
    if (!paragraphLines.length) return;
    parts.push(`<p>${paragraphLines.map((line) => inlineMarkdown(line)).join("<br />")}</p>`);
    paragraphLines = [];
  }

  function flushList() {
    if (!listItems.length) return;
    parts.push(`<ul class="markdown-list">${listItems.map((item) => `<li>${inlineMarkdown(item)}</li>`).join("")}</ul>`);
    listItems = [];
  }

  function flushQuote() {
    if (!quoteLines.length) return;
    parts.push(`<blockquote>${quoteLines.map((line) => `<p>${inlineMarkdown(line)}</p>`).join("")}</blockquote>`);
    quoteLines = [];
  }

  function flushAll() {
    flushParagraph();
    flushList();
    flushQuote();
  }

  for (const rawLine of lines) {
    const line = rawLine.trimEnd();
    const trimmed = line.trim();
    const fenceMatch = trimmed.match(/^```([\w-]+)?$/);
    if (fenceMatch) {
      flushAll();
      if (codeFence !== null) {
        const language = codeFence ? `<span class="code-language">${escapeHtml(codeFence)}</span>` : "";
        parts.push(
          `<pre class="markdown-code">${language}<code>${escapeHtml(codeLines.join("\n"))}</code></pre>`
        );
        codeFence = null;
        codeLines = [];
      } else {
        codeFence = fenceMatch[1] || "";
      }
      continue;
    }

    if (codeFence !== null) {
      codeLines.push(rawLine);
      continue;
    }

    if (!trimmed) {
      flushAll();
      continue;
    }

    const headingMatch = trimmed.match(/^(#{1,4})\s+(.+)$/);
    if (headingMatch) {
      flushAll();
      const level = Math.min(headingMatch[1].length, 6);
      parts.push(`<h${level}>${inlineMarkdown(headingMatch[2])}</h${level}>`);
      continue;
    }

    if (/^[-*]\s+/.test(trimmed)) {
      flushParagraph();
      flushQuote();
      listItems.push(trimmed.replace(/^[-*]\s+/, ""));
      continue;
    }

    if (/^>\s?/.test(trimmed)) {
      flushParagraph();
      flushList();
      quoteLines.push(trimmed.replace(/^>\s?/, ""));
      continue;
    }

    flushList();
    flushQuote();
    paragraphLines.push(trimmed);
  }

  if (codeFence !== null) {
    const language = codeFence ? `<span class="code-language">${escapeHtml(codeFence)}</span>` : "";
    parts.push(`<pre class="markdown-code">${language}<code>${escapeHtml(codeLines.join("\n"))}</code></pre>`);
  } else {
    flushAll();
  }
  return `<div class="${className}">${parts.join("")}</div>`;
}

function inlineMarkdown(value) {
  return escapeHtml(value)
    .replace(/\[(S\d+)\]/g, `<span class="source-chip">[$1]</span>`)
    .replace(/\[([^\]]+)\]\(((?:https?:\/\/|\/)[^\s)]+)\)/g, (_match, label, url) => {
      return `<a href="${escapeHtml(url)}" target="_blank" rel="noreferrer">${label}</a>`;
    })
    .replace(/\*\*(.+?)\*\*/g, "<strong>$1</strong>")
    .replace(/\*(.+?)\*/g, "<em>$1</em>")
    .replace(/`([^`]+)`/g, "<code>$1</code>");
}

export function revokeDraft(entry) {
  if (entry?.previewUrl) URL.revokeObjectURL(entry.previewUrl);
}

export function uniqueBy(items, keyGetter) {
  const seen = new Set();
  return items.filter((item) => {
    const key = keyGetter(item);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

export function parseJsonSafe(value, fallback = {}) {
  try {
    return value ? JSON.parse(value) : fallback;
  } catch {
    return fallback;
  }
}
