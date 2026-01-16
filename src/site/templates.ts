/**
 * HTML Templates for Static Site Generation
 *
 * Provides the layout and component templates for the interactive wiki site.
 */

interface PageTemplateData {
  title: string;
  siteTitle: string;
  description: string;
  content: string;
  toc: string;
  breadcrumbs: string;
  relatedPages: string;
  navigation: {
    sections: Array<{
      title: string;
      path: string;
      pages: Array<{
        title: string;
        path: string;
        description?: string;
      }>;
    }>;
  };
  rootPath: string;
  currentPath: string;
  features: {
    guidedTour?: boolean;
    codeExplorer?: boolean;
    search?: boolean;
    progressTracking?: boolean;
    keyboardNav?: boolean;
    aiChat?: boolean;
  };
  theme: 'light' | 'dark' | 'auto';
  lastModified?: string;
}

export function getTemplates() {
  return {
    page: (data: PageTemplateData): string => `<!DOCTYPE html>
<html lang="en" data-theme="${data.theme}">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width, initial-scale=1.0">
  <meta name="description" content="${escapeAttr(data.description)}">
  <meta name="generator" content="SemanticWiki Generator">

  <title>${escapeHtml(data.title)} | ${escapeHtml(data.siteTitle)}</title>

  <!-- Preconnect for performance -->
  <link rel="preconnect" href="https://fonts.googleapis.com">
  <link rel="preconnect" href="https://fonts.gstatic.com" crossorigin>

  <!-- Fonts -->
  <link href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700&family=JetBrains+Mono:wght@400;500&display=swap" rel="stylesheet">

  <!-- Styles -->
  <link rel="stylesheet" href="${data.rootPath}assets/styles.css">

  <!-- Mermaid for diagrams -->
  <script src="https://cdn.jsdelivr.net/npm/mermaid@10/dist/mermaid.min.js"></script>

  <!-- Syntax highlighting -->
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/themes/prism-tomorrow.min.css">
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/prism.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-typescript.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-javascript.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-python.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-bash.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-json.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-yaml.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-go.min.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/prismjs@1.29.0/components/prism-rust.min.js"></script>
</head>
<body>
  <!-- Skip link for accessibility -->
  <a href="#main-content" class="skip-link">Skip to content</a>

  <!-- Site Header -->
  <header class="site-header">
    <div class="header-container">
      <a href="${data.rootPath}index.html" class="site-logo">
        <svg class="logo-icon" width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M2 3h6a4 4 0 0 1 4 4v14a3 3 0 0 0-3-3H2z"></path>
          <path d="M22 3h-6a4 4 0 0 0-4 4v14a3 3 0 0 1 3-3h7z"></path>
        </svg>
        <span class="site-name">${escapeHtml(data.siteTitle)}</span>
      </a>

      <div class="header-actions">
        ${data.features.search ? `
        <button class="search-trigger" title="Search (/)">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="11" cy="11" r="8"></circle>
            <path d="m21 21-4.35-4.35"></path>
          </svg>
          <span class="search-shortcut">/</span>
        </button>
        ` : ''}

        ${data.features.guidedTour ? `
        <button class="tour-trigger" title="Take a tour">
          <svg width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="10"></circle>
            <path d="M12 16v-4"></path>
            <path d="M12 8h.01"></path>
          </svg>
        </button>
        ` : ''}


        <button class="theme-toggle" title="Toggle theme">
          <svg class="sun-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <circle cx="12" cy="12" r="5"></circle>
            <line x1="12" y1="1" x2="12" y2="3"></line>
            <line x1="12" y1="21" x2="12" y2="23"></line>
            <line x1="4.22" y1="4.22" x2="5.64" y2="5.64"></line>
            <line x1="18.36" y1="18.36" x2="19.78" y2="19.78"></line>
            <line x1="1" y1="12" x2="3" y2="12"></line>
            <line x1="21" y1="12" x2="23" y2="12"></line>
            <line x1="4.22" y1="19.78" x2="5.64" y2="18.36"></line>
            <line x1="18.36" y1="5.64" x2="19.78" y2="4.22"></line>
          </svg>
          <svg class="moon-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M21 12.79A9 9 0 1 1 11.21 3 7 7 0 0 0 21 12.79z"></path>
          </svg>
        </button>

        <button class="mobile-menu-toggle" aria-label="Toggle menu">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="3" y1="12" x2="21" y2="12"></line>
            <line x1="3" y1="6" x2="21" y2="6"></line>
            <line x1="3" y1="18" x2="21" y2="18"></line>
          </svg>
        </button>
      </div>
    </div>
  </header>

  <!-- Main Layout Container - adjusts when chat panel is open -->
  <div class="site-container">
    <!-- Main Layout -->
    <div class="site-layout">
      <!-- Sidebar Navigation -->
      <aside class="sidebar" aria-label="Main navigation">
        <nav class="sidebar-nav">
          ${data.navigation.sections.map(section => `
            <div class="nav-section">
              <h3 class="nav-section-title">${escapeHtml(section.title)}</h3>
              <ul class="nav-list">
                ${section.pages.map(page => `
                  <li class="nav-item${page.path === data.currentPath ? ' active' : ''}">
                    <a href="${data.rootPath}${page.path}" class="nav-link" ${page.description ? `title="${escapeAttr(page.description)}"` : ''}>
                      ${escapeHtml(page.title)}
                      ${data.features.progressTracking ? '<span class="read-indicator" aria-hidden="true"></span>' : ''}
                    </a>
                  </li>
                `).join('')}
              </ul>
            </div>
          `).join('')}
        </nav>

        ${data.features.progressTracking ? `
        <div class="progress-indicator">
          <div class="progress-bar">
            <div class="progress-fill"></div>
          </div>
          <span class="progress-text">0% complete</span>
        </div>
        ` : ''}
      </aside>

      <!-- Main Content -->
      <main id="main-content" class="main-content">
      ${data.breadcrumbs}

      <article class="page-content">
        <h1 class="page-title">${escapeHtml(data.title)}</h1>
        ${data.content}
      </article>

      ${data.relatedPages}

      <!-- Page footer -->
      <footer class="page-footer">
        <div class="page-meta">
          <span class="last-updated">Last updated: ${data.lastModified || 'Unknown'}</span>
        </div>
        <div class="page-actions">
          <button class="scroll-to-top" title="Scroll to top">
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 15l-6-6-6 6"></path>
            </svg>
            Top
          </button>
        </div>
      </footer>
    </main>

      <!-- Table of Contents (if available) -->
      ${data.toc ? `
      <aside class="toc-sidebar" aria-label="Table of contents">
        ${data.toc}
      </aside>
      ` : ''}
    </div>
  </div>

  <!-- Search Modal -->
  ${data.features.search ? `
  <div class="search-modal" role="dialog" aria-modal="true" aria-label="Search documentation">
    <div class="search-modal-backdrop"></div>
    <div class="search-modal-content">
      <div class="search-input-wrapper">
        <svg class="search-icon" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <circle cx="11" cy="11" r="8"></circle>
          <path d="m21 21-4.35-4.35"></path>
        </svg>
        <input type="text" class="search-input" placeholder="Search documentation..." autocomplete="off" autofocus>
        <kbd class="search-close-hint">ESC</kbd>
      </div>
      <div class="search-results">
        <div class="search-empty">
          <p>Start typing to search...</p>
          <div class="search-hints">
            <p><kbd>Enter</kbd> to select</p>
            <p><kbd>↑</kbd> <kbd>↓</kbd> to navigate</p>
            <p><kbd>ESC</kbd> to close</p>
          </div>
        </div>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Tour Overlay -->
  ${data.features.guidedTour ? `
  <div class="tour-overlay" aria-hidden="true">
    <div class="tour-spotlight"></div>
    <div class="tour-tooltip">
      <div class="tour-tooltip-content">
        <h4 class="tour-step-title"></h4>
        <p class="tour-step-description"></p>
      </div>
      <div class="tour-tooltip-footer">
        <span class="tour-step-counter"></span>
        <div class="tour-buttons">
          <button class="tour-btn tour-btn-skip">Skip</button>
          <button class="tour-btn tour-btn-prev">Back</button>
          <button class="tour-btn tour-btn-next tour-btn-primary">Next</button>
        </div>
      </div>
    </div>
  </div>

  <!-- Tour Selector Modal -->
  <div class="tour-selector-modal" role="dialog" aria-modal="true">
    <div class="tour-selector-backdrop"></div>
    <div class="tour-selector-content">
      <h3>Choose a Tour</h3>
      <p class="tour-selector-desc">Get oriented with guided walkthroughs</p>
      <div class="tour-list"></div>
      <button class="tour-selector-close">Maybe later</button>
    </div>
  </div>
  ` : ''}

  <!-- Code Explorer Modal -->
  ${data.features.codeExplorer ? `
  <div class="code-explorer-modal" role="dialog" aria-modal="true">
    <div class="code-explorer-backdrop"></div>
    <div class="code-explorer-content">
      <div class="code-explorer-header">
        <div class="code-explorer-title">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="16 18 22 12 16 6"></polyline>
            <polyline points="8 6 2 12 8 18"></polyline>
          </svg>
          <span class="code-explorer-file"></span>
        </div>
        <button class="code-explorer-close" aria-label="Close">
          <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <line x1="18" y1="6" x2="6" y2="18"></line>
            <line x1="6" y1="6" x2="18" y2="18"></line>
          </svg>
        </button>
      </div>
      <div class="code-explorer-body">
        <pre><code class="code-explorer-code"></code></pre>
      </div>
      <div class="code-explorer-footer">
        <span class="code-explorer-info"></span>
      </div>
    </div>
  </div>
  ` : ''}

  <!-- Mermaid Fullscreen Modal -->
  <div class="mermaid-fullscreen-modal" role="dialog" aria-modal="true">
    <div class="mermaid-fullscreen-backdrop"></div>
    <div class="mermaid-fullscreen-content">
      <button class="mermaid-fullscreen-close" aria-label="Close">
        <svg width="24" height="24" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="18" y1="6" x2="6" y2="18"></line>
          <line x1="6" y1="6" x2="18" y2="18"></line>
        </svg>
      </button>
      <div class="mermaid-fullscreen-diagram"></div>
    </div>
  </div>

  <!-- Keyboard shortcuts help -->
  ${data.features.keyboardNav ? `
  <div class="keyboard-help-modal" role="dialog" aria-modal="true">
    <div class="keyboard-help-backdrop"></div>
    <div class="keyboard-help-content">
      <h3>Keyboard Shortcuts</h3>
      <div class="keyboard-shortcuts">
        <div class="shortcut-group">
          <h4>Navigation</h4>
          <div class="shortcut"><kbd>j</kbd> / <kbd>k</kbd> <span>Next / Previous heading</span></div>
          <div class="shortcut"><kbd>h</kbd> / <kbd>l</kbd> <span>Previous / Next page</span></div>
          <div class="shortcut"><kbd>g</kbd> <kbd>g</kbd> <span>Go to top</span></div>
          <div class="shortcut"><kbd>G</kbd> <span>Go to bottom</span></div>
        </div>
        <div class="shortcut-group">
          <h4>Actions</h4>
          <div class="shortcut"><kbd>/</kbd> <span>Open search</span></div>
          <div class="shortcut"><kbd>t</kbd> <span>Toggle theme</span></div>
          <div class="shortcut"><kbd>?</kbd> <span>Show this help</span></div>
          <div class="shortcut"><kbd>ESC</kbd> <span>Close modal</span></div>
        </div>
      </div>
      <button class="keyboard-help-close">Got it</button>
    </div>
  </div>
  ` : ''}

  <!-- AI Chat Side Panel -->
  ${data.features.aiChat ? `
  <aside class="chat-panel" role="complementary" aria-label="AI Chat Assistant">
    <div class="chat-resize-handle" title="Drag to resize"></div>
    <div class="chat-panel-header">
      <div class="chat-panel-title">
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
        </svg>
        <span>AI Assistant</span>
      </div>
      <div class="chat-panel-controls">
        <div class="chat-mode-selector">
          <select class="chat-mode-dropdown" title="Chat mode">
            <option value="auto">Auto</option>
            <option value="chat">Chat</option>
            <option value="codemap">Codemap</option>
          </select>
        </div>
        <span class="chat-model-badge">SmolLM2</span>
        <button class="chat-panel-collapse" aria-label="Collapse chat panel" title="Collapse panel">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <polyline points="9 18 15 12 9 6"></polyline>
          </svg>
        </button>
      </div>
    </div>
    <div class="chat-panel-status">
      <div class="chat-loading-indicator">
        <div class="chat-loading-spinner"></div>
        <span class="chat-loading-text">Loading AI model...</span>
      </div>
      <div class="chat-progress-container">
        <div class="chat-progress-bar"></div>
      </div>
    </div>
    <div class="chat-messages">
      <div class="chat-welcome">
        <div class="chat-welcome-icon">
          <svg width="32" height="32" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
            <path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"></path>
          </svg>
        </div>
        <h4>Ask about these docs</h4>
        <p class="chat-welcome-desc">Get answers with links to relevant pages. Uses SmolLM2 locally in your browser.</p>
        <div class="chat-suggestions">
          <button class="chat-suggestion" data-question="What is the overall architecture?">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><circle cx="12" cy="12" r="10"/><path d="M12 16v-4M12 8h.01"/></svg>
            Overall architecture
          </button>
          <button class="chat-suggestion" data-question="How do the main components work together?">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><path d="M17 21v-2a4 4 0 0 0-4-4H5a4 4 0 0 0-4 4v2"/><circle cx="9" cy="7" r="4"/></svg>
            Component interactions
          </button>
          <button class="chat-suggestion" data-question="What are the key concepts I should understand?">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><polygon points="12 2 15.09 8.26 22 9.27 17 14.14 18.18 21.02 12 17.77 5.82 21.02 7 14.14 2 9.27 8.91 8.26 12 2"/></svg>
            Key concepts
          </button>
          <button class="chat-suggestion" data-question="Show me how the main components work together">
            <svg width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2"><rect x="3" y="3" width="7" height="7"/><rect x="14" y="3" width="7" height="7"/><rect x="14" y="14" width="7" height="7"/><rect x="3" y="14" width="7" height="7"/></svg>
            Flow diagram
          </button>
        </div>
      </div>
    </div>
    <div class="chat-input-area">
      <textarea class="chat-input" placeholder="Ask a question..." rows="1"></textarea>
      <button class="chat-send" title="Send message" disabled>
        <svg width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
          <line x1="22" y1="2" x2="11" y2="13"></line>
          <polygon points="22 2 15 22 11 13 2 9 22 2"></polygon>
        </svg>
      </button>
    </div>
  </aside>

  <!-- Chat toggle button (always visible) -->
  <button class="chat-toggle-btn" aria-label="Toggle AI chat" title="AI Assistant">
    <svg class="chat-toggle-icon-open" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <path d="M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z"></path>
    </svg>
    <svg class="chat-toggle-icon-close" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
      <polyline points="9 18 15 12 9 6"></polyline>
    </svg>
  </button>
  ` : ''}

  <!-- Toast notifications -->
  <div class="toast-container" aria-live="polite"></div>

  <!-- Site configuration -->
  <script>
    window.WIKI_CONFIG = {
      rootPath: '${data.rootPath}',
      currentPath: '${data.currentPath}',
      features: ${JSON.stringify(data.features)},
      theme: '${data.theme}'
    };
  </script>

  <!-- Client-side application -->
  <script src="${data.rootPath}assets/app.js"></script>
</body>
</html>`
  };
}

function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}

function escapeAttr(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/"/g, '&quot;')
    .replace(/'/g, '&#039;');
}
