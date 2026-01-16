/**
 * CSS Styles for the Interactive Wiki Site
 *
 * Features:
 * - Light/Dark theme support
 * - Responsive design
 * - Smooth animations
 * - Modern typography
 */

export function getStyles(): string {
  return `
/* ========================================
   CSS Variables & Theme
   ======================================== */
:root {
  /* Colors - Monochromatic Light Theme */
  --color-bg: #fafafa;
  --color-bg-secondary: #f5f5f5;
  --color-bg-tertiary: #e5e5e5;
  --color-text: #171717;
  --color-text-secondary: #525252;
  --color-text-muted: #a3a3a3;
  --color-border: #d4d4d4;
  --color-border-light: #e5e5e5;

  --color-primary: #404040;
  --color-primary-hover: #262626;
  --color-primary-light: #f5f5f5;

  --color-accent: #525252;
  --color-success: #525252;
  --color-warning: #737373;
  --color-error: #525252;

  /* Luxurious purple link colors */
  --color-link: #9333ea;
  --color-link-hover: #7c3aed;
  --color-link-visited: #a855f7;

  /* Shadows */
  --shadow-sm: 0 1px 2px 0 rgb(0 0 0 / 0.05);
  --shadow-md: 0 4px 6px -1px rgb(0 0 0 / 0.1), 0 2px 4px -2px rgb(0 0 0 / 0.1);
  --shadow-lg: 0 10px 15px -3px rgb(0 0 0 / 0.1), 0 4px 6px -4px rgb(0 0 0 / 0.1);
  --shadow-xl: 0 20px 25px -5px rgb(0 0 0 / 0.1), 0 8px 10px -6px rgb(0 0 0 / 0.1);

  /* Spacing */
  --spacing-xs: 0.25rem;
  --spacing-sm: 0.5rem;
  --spacing-md: 1rem;
  --spacing-lg: 1.5rem;
  --spacing-xl: 2rem;
  --spacing-2xl: 3rem;

  /* Typography */
  --font-sans: 'Inter', -apple-system, BlinkMacSystemFont, 'Segoe UI', Roboto, sans-serif;
  --font-mono: 'JetBrains Mono', 'Fira Code', 'Consolas', monospace;

  --text-xs: 0.75rem;
  --text-sm: 0.875rem;
  --text-base: 1rem;
  --text-lg: 1.125rem;
  --text-xl: 1.25rem;
  --text-2xl: 1.5rem;
  --text-3xl: 1.875rem;
  --text-4xl: 2.25rem;

  /* Layout */
  --sidebar-width: 280px;
  --toc-width: 240px;
  --header-height: 60px;
  --content-max-width: 800px;

  /* Transitions */
  --transition-fast: 150ms ease;
  --transition-normal: 250ms ease;
  --transition-slow: 350ms ease;

  /* Border radius */
  --radius-sm: 4px;
  --radius-md: 8px;
  --radius-lg: 12px;
  --radius-full: 9999px;
}

/* Dark Theme - Monochromatic */
[data-theme="dark"] {
  --color-bg: #0a0a0a;
  --color-bg-secondary: #171717;
  --color-bg-tertiary: #262626;
  --color-text: #fafafa;
  --color-text-secondary: #a3a3a3;
  --color-text-muted: #737373;
  --color-border: #404040;
  --color-border-light: #262626;

  --color-primary: #d4d4d4;
  --color-primary-hover: #fafafa;
  --color-primary-light: #262626;

  /* Luxurious purple link colors for dark mode */
  --color-link: #c084fc;
  --color-link-hover: #d8b4fe;
  --color-link-visited: #a78bfa;
}

/* Auto theme (system preference) - Monochromatic */
@media (prefers-color-scheme: dark) {
  [data-theme="auto"] {
    --color-bg: #0a0a0a;
    --color-bg-secondary: #171717;
    --color-bg-tertiary: #262626;
    --color-text: #fafafa;
    --color-text-secondary: #a3a3a3;
    --color-text-muted: #737373;
    --color-border: #404040;
    --color-border-light: #262626;
    --color-primary: #d4d4d4;
    --color-primary-hover: #fafafa;
    --color-primary-light: #262626;

    /* Luxurious purple link colors for auto dark mode */
    --color-link: #c084fc;
    --color-link-hover: #d8b4fe;
    --color-link-visited: #a78bfa;
  }
}

/* ========================================
   Base Styles
   ======================================== */
*, *::before, *::after {
  box-sizing: border-box;
}

html {
  scroll-behavior: smooth;
  font-size: 16px;
}

body {
  margin: 0;
  padding: 0;
  font-family: var(--font-sans);
  font-size: var(--text-base);
  line-height: 1.6;
  color: var(--color-text);
  background-color: var(--color-bg);
  -webkit-font-smoothing: antialiased;
  -moz-osx-font-smoothing: grayscale;
}

/* Skip Link */
.skip-link {
  position: fixed;
  top: -100px;
  left: var(--spacing-md);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-primary);
  color: white;
  border-radius: var(--radius-md);
  z-index: 1000;
  transition: top var(--transition-fast);
}

.skip-link:focus {
  top: var(--spacing-md);
}

/* ========================================
   Header
   ======================================== */
.site-header {
  position: fixed;
  top: 0;
  left: 0;
  right: 0;
  height: var(--header-height);
  background: var(--color-bg);
  border-bottom: 1px solid var(--color-border);
  z-index: 100;
  backdrop-filter: blur(8px);
  background: rgba(var(--color-bg), 0.9);
}

.header-container {
  display: flex;
  align-items: center;
  justify-content: space-between;
  height: 100%;
  padding: 0 var(--spacing-lg);
  max-width: 100%;
}

.site-logo {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  text-decoration: none;
  color: var(--color-text);
  font-weight: 600;
  font-size: var(--text-lg);
}

.logo-icon {
  color: var(--color-primary);
}

.header-actions {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.header-actions button {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.header-actions button:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.search-trigger {
  position: relative;
  width: auto !important;
  padding: 0 var(--spacing-md) !important;
  gap: var(--spacing-sm);
}

.search-shortcut {
  font-size: var(--text-xs);
  padding: 2px 6px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}

/* Theme toggle icons */
.theme-toggle .sun-icon { display: block; }
.theme-toggle .moon-icon { display: none; }

[data-theme="dark"] .theme-toggle .sun-icon { display: none; }
[data-theme="dark"] .theme-toggle .moon-icon { display: block; }

@media (prefers-color-scheme: dark) {
  [data-theme="auto"] .theme-toggle .sun-icon { display: none; }
  [data-theme="auto"] .theme-toggle .moon-icon { display: block; }
}

.mobile-menu-toggle {
  display: none;
}

/* ========================================
   Layout
   ======================================== */
.site-layout {
  display: flex;
  min-height: 100vh;
  padding-top: var(--header-height);
}

/* Sidebar */
.sidebar {
  position: fixed;
  top: var(--header-height);
  left: 0;
  bottom: 0;
  width: var(--sidebar-width);
  padding: var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-right: 1px solid var(--color-border);
  overflow-y: auto;
  scrollbar-width: thin;
  scrollbar-color: var(--color-border) transparent;
}

.sidebar::-webkit-scrollbar {
  width: 6px;
}

.sidebar::-webkit-scrollbar-track {
  background: transparent;
}

.sidebar::-webkit-scrollbar-thumb {
  background: var(--color-border);
  border-radius: 3px;
}

.sidebar-nav {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-lg);
}

.nav-section-title {
  margin: 0 0 var(--spacing-sm) 0;
  padding: 0;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.nav-list {
  list-style: none;
  margin: 0;
  padding: 0;
}

.nav-item {
  margin: 0;
}

.nav-link {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  transition: all var(--transition-fast);
}

.nav-link:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.nav-item.active .nav-link {
  background: var(--color-primary-light);
  color: var(--color-primary);
  font-weight: 500;
}

.read-indicator {
  width: 8px;
  height: 8px;
  border-radius: 50%;
  background: transparent;
  transition: background var(--transition-fast);
}

.nav-item.read .read-indicator {
  background: var(--color-success);
}

/* Progress indicator - hidden by default (can be enabled via setting) */
.progress-indicator {
  display: none; /* Hidden - obtrusive for users */
  position: absolute;
  bottom: var(--spacing-lg);
  left: var(--spacing-lg);
  right: var(--spacing-lg);
  padding: var(--spacing-md);
  background: var(--color-bg);
  border-radius: var(--radius-md);
  border: 1px solid var(--color-border);
}

/* Enable progress tracker with data attribute if needed */
[data-show-progress="true"] .progress-indicator {
  display: block;
}

.progress-bar {
  height: 4px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-full);
  overflow: hidden;
  margin-bottom: var(--spacing-xs);
}

.progress-fill {
  height: 100%;
  background: linear-gradient(90deg, #404040, #737373);
  border-radius: var(--radius-full);
  width: 0%;
  transition: width var(--transition-slow);
}

.progress-text {
  font-size: var(--text-xs);
  color: var(--color-text-muted);
}

/* Main Content */
.main-content {
  flex: 1;
  margin-left: var(--sidebar-width);
  margin-right: var(--toc-width);
  padding: var(--spacing-2xl);
  max-width: calc(100% - var(--sidebar-width) - var(--toc-width));
  min-width: 0; /* Prevent content from overflowing */
}

.page-content {
  max-width: var(--content-max-width);
  margin: 0 auto;
  overflow-wrap: break-word;
  word-wrap: break-word;
}

/* TOC Sidebar */
.toc-sidebar {
  position: fixed;
  top: var(--header-height);
  right: 0;
  bottom: 0;
  width: var(--toc-width);
  padding: var(--spacing-lg);
  overflow-y: auto;
}

.toc {
  position: sticky;
  top: var(--spacing-lg);
}

.toc-title {
  margin: 0 0 var(--spacing-md) 0;
  font-size: var(--text-xs);
  font-weight: 600;
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.toc-list {
  list-style: none;
  margin: 0;
  padding: 0;
  border-left: 2px solid var(--color-border);
}

.toc-item {
  margin: 0;
}

.toc-item a {
  display: block;
  padding: var(--spacing-xs) var(--spacing-md);
  margin-left: -2px;
  border-left: 2px solid transparent;
  text-decoration: none;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  transition: all var(--transition-fast);
}

.toc-item a:hover {
  color: var(--color-text);
}

.toc-item a.active {
  color: var(--color-primary);
  border-left-color: var(--color-primary);
}

.toc-level-1 a {
  padding-left: calc(var(--spacing-md) + var(--spacing-md));
}

/* ========================================
   Typography
   ======================================== */
h1, h2, h3, h4, h5, h6 {
  margin: var(--spacing-2xl) 0 var(--spacing-md);
  font-weight: 600;
  line-height: 1.3;
  color: var(--color-text);
}

h1 { font-size: var(--text-4xl); margin-top: 0; }

.page-title {
  margin-bottom: var(--spacing-lg);
  padding-bottom: var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
}
h2 { font-size: var(--text-2xl); }
h3 { font-size: var(--text-xl); }
h4 { font-size: var(--text-lg); }

.heading-anchor {
  position: relative;
}

.anchor-link {
  position: absolute;
  left: -1.5em;
  padding-right: 0.5em;
  font-weight: 400;
  color: var(--color-text-muted);
  text-decoration: none;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.heading-anchor:hover .anchor-link {
  opacity: 1;
}

p {
  margin: 0 0 var(--spacing-md);
}

a {
  color: var(--color-link);
  text-decoration: none;
  font-weight: 500;
  transition: all var(--transition-fast);
}

a:hover {
  color: var(--color-link-hover);
  text-decoration: underline;
  text-underline-offset: 3px;
}

a:visited {
  color: var(--color-link-visited);
}

/* Content links - subtle underline effect */
.page-content a:not(.anchor-link):not(.source-link) {
  text-decoration: underline;
  text-decoration-color: rgba(147, 51, 234, 0.4);
  text-underline-offset: 2px;
  transition: text-decoration-color var(--transition-fast);
}

.page-content a:not(.anchor-link):not(.source-link):hover {
  text-decoration-color: rgba(147, 51, 234, 0.8);
}

[data-theme="dark"] .page-content a:not(.anchor-link):not(.source-link) {
  text-decoration-color: rgba(192, 132, 252, 0.4);
}

[data-theme="dark"] .page-content a:not(.anchor-link):not(.source-link):hover {
  text-decoration-color: rgba(192, 132, 252, 0.8);
}

.external-link {
  display: inline-flex;
  align-items: center;
  gap: 0.25em;
}

.external-icon {
  opacity: 0.6;
}

/* Lists */
ul, ol {
  margin: 0 0 var(--spacing-md);
  padding-left: var(--spacing-lg);
}

li {
  margin-bottom: var(--spacing-xs);
}

/* ========================================
   Code Blocks
   ======================================== */
.code-block {
  margin: var(--spacing-lg) 0;
  border-radius: var(--radius-lg);
  overflow: hidden;
  background: #1e1e2e;
  box-shadow: var(--shadow-md);
}

.code-header {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-sm) var(--spacing-md);
  background: rgba(0, 0, 0, 0.2);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.code-language {
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: rgba(255, 255, 255, 0.6);
  text-transform: uppercase;
}

.code-source {
  flex: 1;
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-primary);
  text-decoration: none;
  opacity: 0.8;
  transition: opacity var(--transition-fast);
}

.code-source:hover {
  opacity: 1;
}

.code-copy {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.code-copy:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.code-copy.copied {
  color: var(--color-success);
}

.code-block pre {
  margin: 0;
  padding: var(--spacing-md);
  overflow-x: auto;
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.code-block code {
  font-family: inherit;
}

/* Inline code */
:not(pre) > code {
  padding: 0.2em 0.4em;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: 0.9em;
  color: var(--color-primary);
}

/* ========================================
   Mermaid Diagrams
   ======================================== */
.mermaid-container {
  position: relative;
  margin: var(--spacing-xl) 0;
  padding: var(--spacing-lg);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-lg);
  overflow-x: auto;
}

.mermaid {
  display: flex;
  justify-content: center;
}

.mermaid svg {
  max-width: 100%;
  height: auto;
}

.mermaid-fullscreen {
  position: absolute;
  top: var(--spacing-sm);
  right: var(--spacing-sm);
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  cursor: pointer;
  color: var(--color-text-secondary);
  transition: all var(--transition-fast);
}

.mermaid-fullscreen:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* ========================================
   Callouts
   ======================================== */
.callout {
  margin: var(--spacing-lg) 0;
  padding: var(--spacing-md) var(--spacing-lg);
  border-radius: var(--radius-lg);
  border-left: 4px solid;
}

.callout-title {
  font-weight: 600;
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  margin-bottom: var(--spacing-xs);
}

.callout-note {
  background: var(--color-bg-secondary);
  border-color: var(--color-text-muted);
}
.callout-note .callout-title { color: var(--color-text); }

.callout-tip {
  background: var(--color-bg-secondary);
  border-color: var(--color-text-secondary);
}
.callout-tip .callout-title { color: var(--color-text); }

.callout-important {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text);
}
.callout-important .callout-title { color: var(--color-text); }

.callout-warning {
  background: var(--color-bg-secondary);
  border-color: var(--color-text-muted);
}
.callout-warning .callout-title { color: var(--color-text); }

.callout-caution {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text);
}
.callout-caution .callout-title { color: var(--color-text); }

[data-theme="dark"] .callout-note { background: var(--color-bg-secondary); }
[data-theme="dark"] .callout-tip { background: var(--color-bg-secondary); }
[data-theme="dark"] .callout-important { background: var(--color-bg-tertiary); }
[data-theme="dark"] .callout-warning { background: var(--color-bg-secondary); }
[data-theme="dark"] .callout-caution { background: var(--color-bg-tertiary); }

/* ========================================
   Breadcrumbs
   ======================================== */
.breadcrumbs {
  margin-bottom: var(--spacing-lg);
}

.breadcrumbs ol {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: var(--spacing-xs);
  list-style: none;
  margin: 0;
  padding: 0;
}

.breadcrumbs li {
  display: flex;
  align-items: center;
  margin: 0;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.breadcrumbs li:not(:last-child)::after {
  content: '/';
  margin-left: var(--spacing-xs);
  color: var(--color-text-muted);
}

.breadcrumbs a {
  color: var(--color-text-secondary);
}

.breadcrumbs a:hover {
  color: var(--color-primary);
}

.breadcrumbs [aria-current="page"] {
  color: var(--color-text);
  font-weight: 500;
}

/* ========================================
   Related Pages
   ======================================== */
.related-pages {
  margin-top: var(--spacing-2xl);
  padding: var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-lg);
}

.related-pages h3 {
  margin: 0 0 var(--spacing-md);
  font-size: var(--text-lg);
}

.related-pages ul {
  list-style: none;
  margin: 0;
  padding: 0;
}

.related-pages li {
  margin-bottom: var(--spacing-sm);
}

.related-pages a {
  display: block;
  font-weight: 500;
}

.related-desc {
  display: block;
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  margin-top: var(--spacing-xs);
}

/* ========================================
   Page Footer
   ======================================== */
.page-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  margin-top: var(--spacing-2xl);
  padding-top: var(--spacing-lg);
  border-top: 1px solid var(--color-border);
}

.page-meta {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.scroll-to-top {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.scroll-to-top:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

/* ========================================
   Search Modal
   ======================================== */
.search-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
}

.search-modal.open {
  display: block;
}

.search-modal-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.search-modal-content {
  position: absolute;
  top: 10vh;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 600px;
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.search-input-wrapper {
  display: flex;
  align-items: center;
  gap: var(--spacing-md);
  padding: var(--spacing-md) var(--spacing-lg);
  border-bottom: 1px solid var(--color-border);
}

.search-icon {
  flex-shrink: 0;
  color: var(--color-text-muted);
}

.search-input {
  flex: 1;
  border: none;
  background: transparent;
  font-size: var(--text-lg);
  color: var(--color-text);
  outline: none;
}

.search-input::placeholder {
  color: var(--color-text-muted);
}

.search-close-hint {
  flex-shrink: 0;
  padding: 4px 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  font-family: var(--font-mono);
  color: var(--color-text-muted);
}

.search-results {
  max-height: 60vh;
  overflow-y: auto;
  padding: var(--spacing-md);
}

.search-empty {
  text-align: center;
  padding: var(--spacing-xl);
  color: var(--color-text-secondary);
}

.search-hints {
  display: flex;
  justify-content: center;
  gap: var(--spacing-lg);
  margin-top: var(--spacing-md);
  font-size: var(--text-sm);
}

.search-hints kbd {
  padding: 2px 6px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
}

.search-result {
  display: block;
  padding: var(--spacing-md);
  border-radius: var(--radius-md);
  text-decoration: none;
  color: var(--color-text);
  transition: background var(--transition-fast);
}

.search-result:hover,
.search-result.selected {
  background: var(--color-bg-secondary);
}

.search-result-title {
  font-weight: 600;
  margin-bottom: var(--spacing-xs);
}

.search-result-snippet {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.search-result-snippet mark {
  background: var(--color-primary-light);
  color: var(--color-primary);
  border-radius: 2px;
  padding: 0 2px;
}

/* ========================================
   Tour Overlay
   ======================================== */
.tour-overlay {
  position: fixed;
  inset: 0;
  z-index: 300;
  pointer-events: none;
  display: none;
}

.tour-overlay.active {
  display: block;
  pointer-events: auto;
}

.tour-spotlight {
  position: absolute;
  border-radius: var(--radius-md);
  box-shadow: 0 0 0 9999px rgba(0, 0, 0, 0.7);
  transition: all var(--transition-normal);
}

.tour-tooltip {
  position: absolute;
  width: 320px;
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
  animation: fadeSlideIn 0.3s ease;
}

@keyframes fadeSlideIn {
  from {
    opacity: 0;
    transform: translateY(10px);
  }
  to {
    opacity: 1;
    transform: translateY(0);
  }
}

.tour-tooltip-content {
  padding: var(--spacing-lg);
}

.tour-step-title {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--text-lg);
  font-weight: 600;
}

.tour-step-description {
  margin: 0;
  color: var(--color-text-secondary);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.tour-tooltip-footer {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-top: 1px solid var(--color-border);
}

.tour-step-counter {
  font-size: var(--text-sm);
  color: var(--color-text-muted);
}

.tour-buttons {
  display: flex;
  gap: var(--spacing-sm);
}

.tour-btn {
  padding: var(--spacing-sm) var(--spacing-md);
  border: none;
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  font-weight: 500;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tour-btn-skip {
  background: transparent;
  color: var(--color-text-muted);
}

.tour-btn-skip:hover {
  color: var(--color-text);
}

.tour-btn-prev,
.tour-btn-next {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.tour-btn-primary {
  background: var(--color-primary);
  color: white;
}

.tour-btn-primary:hover {
  background: var(--color-primary-hover);
}

/* Tour Selector Modal */
.tour-selector-modal {
  position: fixed;
  inset: 0;
  z-index: 250;
  display: none;
}

.tour-selector-modal.open {
  display: block;
}

.tour-selector-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.tour-selector-content {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 400px;
  padding: var(--spacing-xl);
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  text-align: center;
}

.tour-selector-content h3 {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--text-xl);
}

.tour-selector-desc {
  margin: 0 0 var(--spacing-lg);
  color: var(--color-text-secondary);
}

.tour-list {
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-lg);
}

.tour-item {
  display: block;
  width: 100%;
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.tour-item:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-primary);
}

.tour-item-name {
  font-weight: 600;
  margin-bottom: var(--spacing-xs);
}

.tour-item-desc {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.tour-selector-close {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: transparent;
  border: none;
  color: var(--color-text-muted);
  font-size: var(--text-sm);
  cursor: pointer;
}

.tour-selector-close:hover {
  color: var(--color-text);
}

/* ========================================
   Code Explorer Modal
   ======================================== */
.code-explorer-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
}

.code-explorer-modal.open {
  display: block;
}

.code-explorer-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.7);
  backdrop-filter: blur(4px);
}

.code-explorer-content {
  position: absolute;
  top: 5vh;
  left: 50%;
  transform: translateX(-50%);
  width: 90%;
  max-width: 900px;
  max-height: 85vh;
  display: flex;
  flex-direction: column;
  background: #1e1e2e;
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
  overflow: hidden;
}

.code-explorer-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: var(--spacing-md) var(--spacing-lg);
  background: rgba(0, 0, 0, 0.3);
  border-bottom: 1px solid rgba(255, 255, 255, 0.1);
}

.code-explorer-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: rgba(255, 255, 255, 0.9);
  font-family: var(--font-mono);
  font-size: var(--text-sm);
}

.code-explorer-close {
  width: 32px;
  height: 32px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: rgba(255, 255, 255, 0.5);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.code-explorer-close:hover {
  background: rgba(255, 255, 255, 0.1);
  color: rgba(255, 255, 255, 0.9);
}

.code-explorer-body {
  flex: 1;
  overflow: auto;
  padding: var(--spacing-md);
}

.code-explorer-code {
  font-family: var(--font-mono);
  font-size: var(--text-sm);
  line-height: 1.6;
}

.code-explorer-footer {
  padding: var(--spacing-sm) var(--spacing-lg);
  background: rgba(0, 0, 0, 0.2);
  border-top: 1px solid rgba(255, 255, 255, 0.1);
}

.code-explorer-info {
  font-size: var(--text-xs);
  color: rgba(255, 255, 255, 0.5);
  font-family: var(--font-mono);
}

/* ========================================
   Mermaid Fullscreen Modal
   ======================================== */
.mermaid-fullscreen-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
}

.mermaid-fullscreen-modal.open {
  display: block;
}

.mermaid-fullscreen-backdrop {
  position: absolute;
  inset: 0;
  background: var(--color-bg);
}

.mermaid-fullscreen-content {
  position: absolute;
  inset: var(--spacing-lg);
  display: flex;
  align-items: center;
  justify-content: center;
  overflow: auto;
}

.mermaid-fullscreen-close {
  position: absolute;
  top: var(--spacing-lg);
  right: var(--spacing-lg);
  width: 40px;
  height: 40px;
  padding: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.mermaid-fullscreen-close:hover {
  background: var(--color-bg-tertiary);
}

.mermaid-fullscreen-diagram {
  max-width: 100%;
  max-height: 100%;
}

.mermaid-fullscreen-diagram svg {
  max-width: 100%;
  height: auto;
}

/* ========================================
   Keyboard Help Modal
   ======================================== */
.keyboard-help-modal {
  position: fixed;
  inset: 0;
  z-index: 200;
  display: none;
}

.keyboard-help-modal.open {
  display: block;
}

.keyboard-help-backdrop {
  position: absolute;
  inset: 0;
  background: rgba(0, 0, 0, 0.5);
  backdrop-filter: blur(4px);
}

.keyboard-help-content {
  position: absolute;
  top: 50%;
  left: 50%;
  transform: translate(-50%, -50%);
  width: 90%;
  max-width: 480px;
  padding: var(--spacing-xl);
  background: var(--color-bg);
  border-radius: var(--radius-lg);
  box-shadow: var(--shadow-xl);
}

.keyboard-help-content h3 {
  margin: 0 0 var(--spacing-lg);
  font-size: var(--text-xl);
  text-align: center;
}

.keyboard-shortcuts {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: var(--spacing-lg);
}

.shortcut-group h4 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--text-sm);
  text-transform: uppercase;
  letter-spacing: 0.05em;
  color: var(--color-text-muted);
}

.shortcut {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  margin-bottom: var(--spacing-sm);
  font-size: var(--text-sm);
}

.shortcut kbd {
  padding: 4px 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-family: var(--font-mono);
  font-size: var(--text-xs);
}

.shortcut span {
  color: var(--color-text-secondary);
}

.keyboard-help-close {
  display: block;
  width: 100%;
  margin-top: var(--spacing-lg);
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  font-weight: 500;
  cursor: pointer;
  transition: background var(--transition-fast);
}

.keyboard-help-close:hover {
  background: var(--color-primary-hover);
}

/* ========================================
   Toast Notifications
   ======================================== */
.toast-container {
  position: fixed;
  bottom: var(--spacing-lg);
  right: var(--spacing-lg);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-sm);
  z-index: 400;
}

.toast {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  padding: var(--spacing-md) var(--spacing-lg);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-lg);
  animation: toastIn 0.3s ease;
}

@keyframes toastIn {
  from {
    opacity: 0;
    transform: translateX(100%);
  }
  to {
    opacity: 1;
    transform: translateX(0);
  }
}

.toast.toast-out {
  animation: toastOut 0.3s ease forwards;
}

@keyframes toastOut {
  to {
    opacity: 0;
    transform: translateX(100%);
  }
}

.toast-success { border-left: 4px solid var(--color-success); }
.toast-error { border-left: 4px solid var(--color-error); }
.toast-info { border-left: 4px solid var(--color-primary); }

/* ========================================
   Images
   ======================================== */
.image-figure {
  margin: var(--spacing-lg) 0;
  text-align: center;
}

.image-figure img {
  max-width: 100%;
  height: auto;
  border-radius: var(--radius-md);
  box-shadow: var(--shadow-md);
}

.image-figure figcaption {
  margin-top: var(--spacing-sm);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
  font-style: italic;
}

/* ========================================
   Tables
   ======================================== */
table {
  width: 100%;
  margin: var(--spacing-lg) 0;
  border-collapse: collapse;
  font-size: var(--text-sm);
}

th, td {
  padding: var(--spacing-sm) var(--spacing-md);
  text-align: left;
  border-bottom: 1px solid var(--color-border);
}

th {
  font-weight: 600;
  background: var(--color-bg-secondary);
}

tr:hover {
  background: var(--color-bg-secondary);
}

/* ========================================
   Responsive Design
   ======================================== */
@media (max-width: 1200px) {
  .toc-sidebar {
    display: none;
  }

  .main-content {
    margin-right: 0;
    max-width: calc(100% - var(--sidebar-width));
  }
}

@media (max-width: 768px) {
  .mobile-menu-toggle {
    display: flex;
  }

  .sidebar {
    transform: translateX(-100%);
    transition: transform var(--transition-normal);
    z-index: 150;
  }

  .sidebar.open {
    transform: translateX(0);
  }

  .main-content {
    margin-left: 0;
    max-width: 100%;
    padding: var(--spacing-lg);
  }

  .header-actions .search-shortcut {
    display: none;
  }

  .keyboard-shortcuts {
    grid-template-columns: 1fr;
  }
}

@media (max-width: 480px) {
  :root {
    --spacing-lg: 1rem;
    --spacing-xl: 1.5rem;
    --spacing-2xl: 2rem;
  }

  h1 { font-size: var(--text-2xl); }
  h2 { font-size: var(--text-xl); }
  h3 { font-size: var(--text-lg); }

  .search-modal-content,
  .tour-selector-content,
  .keyboard-help-content {
    width: 95%;
  }
}

/* ========================================
   AI Chat Side Panel (VS Code style)
   ======================================== */

/* Site container shrinks when chat is open */
.site-container {
  transition: margin-right var(--transition-normal);
}

body.chat-open .site-container {
  margin-right: var(--chat-panel-width, 380px);
}

/* When chat is open, hide TOC and let content expand */
body.chat-open .toc-sidebar {
  display: none;
}

body.chat-open .main-content {
  margin-right: 0;
  max-width: calc(100% - var(--sidebar-width));
}

/* Chat toggle button - always visible */
.chat-toggle-btn {
  position: fixed;
  right: 0;
  top: 50%;
  transform: translateY(-50%);
  z-index: 201;
  display: flex;
  align-items: center;
  justify-content: center;
  width: 36px;
  height: 72px;
  padding: 0;
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-right: none;
  border-radius: var(--radius-md) 0 0 var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  box-shadow: var(--shadow-md);
  transition: all var(--transition-fast);
}

.chat-toggle-btn:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text);
  width: 42px;
}

.chat-toggle-icon-close {
  display: none;
}

body.chat-open .chat-toggle-btn {
  right: var(--chat-panel-width, 380px);
}

body.chat-open .chat-toggle-icon-open {
  display: none;
}

body.chat-open .chat-toggle-icon-close {
  display: block;
}

/* Chat panel - right side panel */
.chat-panel {
  position: fixed;
  top: var(--header-height);
  right: 0;
  bottom: 0;
  width: 380px;
  min-width: 300px;
  max-width: 50vw;
  display: flex;
  flex-direction: column;
  background: var(--color-bg);
  border-left: 1px solid var(--color-border);
  z-index: 200;
  transform: translateX(100%);
  transition: transform var(--transition-normal), width 0s;
}

body.chat-open .chat-panel {
  transform: translateX(0);
}

/* Resize handle - wider for easier grabbing */
.chat-resize-handle {
  position: absolute;
  left: -4px;
  top: 0;
  bottom: 0;
  width: 12px;
  cursor: ew-resize;
  background: transparent;
  z-index: 10;
  transition: background var(--transition-fast);
}

.chat-resize-handle:hover,
.chat-resize-handle.dragging {
  background: var(--color-primary);
  opacity: 0.5;
}

.chat-resize-handle::before {
  content: '';
  position: absolute;
  left: 1px;
  top: 50%;
  transform: translateY(-50%);
  width: 4px;
  height: 32px;
  background: var(--color-border);
  border-radius: 2px;
  opacity: 0;
  transition: opacity var(--transition-fast);
}

.chat-resize-handle:hover::before {
  opacity: 1;
}

/* Prevent text selection during resize */
body.chat-resizing {
  user-select: none;
  cursor: ew-resize;
}

body.chat-resizing .chat-panel {
  transition: none;
}

body.chat-resizing .site-container {
  transition: none;
}

.chat-panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: var(--spacing-sm) var(--spacing-md);
  border-bottom: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  flex-shrink: 0;
  min-height: 44px;
}

.chat-panel-title {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  font-weight: 600;
  font-size: var(--text-sm);
  color: var(--color-text);
}

.chat-panel-controls {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.chat-panel-collapse {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 28px;
  height: 28px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-panel-collapse:hover {
  background: var(--color-bg-tertiary);
  color: var(--color-text);
}

.chat-mode-selector {
  display: flex;
  align-items: center;
}

.chat-mode-dropdown {
  padding: 4px 8px;
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text);
  font-size: var(--text-xs);
  font-weight: 500;
  cursor: pointer;
  outline: none;
  transition: all var(--transition-fast);
}

.chat-mode-dropdown:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-primary);
}

.chat-mode-dropdown:focus {
  border-color: var(--color-primary);
}

.chat-model-badge {
  font-size: var(--text-xs);
  padding: 2px 8px;
  background: linear-gradient(135deg, #404040, #525252);
  color: white;
  border-radius: var(--radius-full);
  font-weight: 500;
}

.chat-panel-close {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 32px;
  height: 32px;
  padding: 0;
  background: transparent;
  border: none;
  border-radius: var(--radius-md);
  color: var(--color-text-secondary);
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-panel-close:hover {
  background: var(--color-bg-secondary);
  color: var(--color-text);
}

.chat-panel-status {
  display: none;
  padding: var(--spacing-sm) var(--spacing-lg);
  background: var(--color-bg-secondary);
  border-bottom: 1px solid var(--color-border);
}

.chat-panel-status.visible {
  display: block;
}

.chat-loading-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
}

.chat-loading-spinner {
  width: 16px;
  height: 16px;
  border: 2px solid var(--color-border);
  border-top-color: var(--color-primary);
  border-radius: 50%;
  animation: chatSpin 1s linear infinite;
}

@keyframes chatSpin {
  to { transform: rotate(360deg); }
}

.chat-loading-text {
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.chat-loading-text .runtime-info {
  display: inline-block;
  padding: 2px 6px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  font-size: var(--text-xs);
  color: var(--color-text-muted);
  margin-left: var(--spacing-xs);
}

.chat-progress-container {
  margin-top: var(--spacing-sm);
  height: 4px;
  background: var(--color-bg-tertiary);
  border-radius: 2px;
  overflow: hidden;
}

.chat-progress-bar {
  height: 100%;
  width: 0;
  background: linear-gradient(90deg, #404040, #737373);
  border-radius: 2px;
  transition: width 0.3s ease;
}

/* Runtime badge variants - Monochromatic */
.chat-model-badge.runtime-webgpu {
  background: linear-gradient(135deg, #171717, #262626);
}

.chat-model-badge.runtime-wasm {
  background: linear-gradient(135deg, #404040, #525252);
}

.chat-model-badge.runtime-fallback {
  background: linear-gradient(135deg, #737373, #a3a3a3);
}

.chat-model-badge.runtime-error {
  background: linear-gradient(135deg, #525252, #737373);
}

/* Chat error notice */
.chat-error-notice {
  text-align: center;
  padding: var(--spacing-lg);
}

.chat-error-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 64px;
  height: 64px;
  margin-bottom: var(--spacing-md);
  background: rgba(239, 68, 68, 0.1);
  border-radius: 50%;
  color: var(--color-error);
}

.chat-error-notice h4 {
  margin: 0 0 var(--spacing-sm);
  font-size: var(--text-lg);
  color: var(--color-text);
}

.chat-error-reason {
  margin: 0 0 var(--spacing-lg);
  padding: var(--spacing-sm) var(--spacing-md);
  background: rgba(239, 68, 68, 0.1);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--text-sm);
}

.chat-error-alternatives {
  text-align: left;
  padding: var(--spacing-md);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
}

.chat-error-alternatives p {
  margin: 0 0 var(--spacing-sm);
  font-weight: 500;
  color: var(--color-text);
  font-size: var(--text-sm);
}

.chat-error-alternatives ul {
  margin: 0;
  padding-left: var(--spacing-lg);
  font-size: var(--text-sm);
  color: var(--color-text-secondary);
}

.chat-error-alternatives li {
  margin-bottom: var(--spacing-xs);
}

.chat-error-alternatives a {
  color: var(--color-primary);
  text-decoration: none;
}

.chat-error-alternatives a:hover {
  text-decoration: underline;
}

.chat-messages {
  flex: 1;
  overflow-y: auto;
  padding: var(--spacing-md);
  display: flex;
  flex-direction: column;
  gap: var(--spacing-md);
}

.chat-welcome {
  padding: var(--spacing-md);
}

.chat-welcome-icon {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 48px;
  height: 48px;
  margin-bottom: var(--spacing-sm);
  background: linear-gradient(135deg, #e5e5e5, #f5f5f5);
  border-radius: 50%;
  color: #404040;
}

.chat-welcome h4 {
  margin: 0 0 var(--spacing-xs);
  font-size: var(--text-base);
  color: var(--color-text);
}

.chat-welcome-desc {
  margin: 0 0 var(--spacing-md);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  line-height: 1.5;
}

.chat-suggestions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: var(--spacing-xs);
}

.chat-suggestion {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  padding: var(--spacing-sm);
  background: var(--color-bg-secondary);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-sm);
  color: var(--color-text-secondary);
  font-size: var(--text-xs);
  text-align: left;
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-suggestion svg {
  flex-shrink: 0;
  opacity: 0.5;
}

.chat-suggestion:hover {
  background: var(--color-bg-tertiary);
  border-color: var(--color-text-muted);
  color: var(--color-text);
}

.chat-suggestion:hover svg {
  opacity: 1;
}

.chat-message {
  display: flex;
  gap: var(--spacing-sm);
  max-width: 90%;
}

.chat-message.user {
  align-self: flex-end;
  flex-direction: row-reverse;
}

.chat-message-avatar {
  flex-shrink: 0;
  width: 28px;
  height: 28px;
  display: flex;
  align-items: center;
  justify-content: center;
  background: var(--color-bg-secondary);
  border-radius: 50%;
  font-size: var(--text-xs);
  color: var(--color-text-secondary);
}

.chat-message.user .chat-message-avatar {
  background: var(--color-primary);
  color: white;
}

.chat-message.assistant .chat-message-avatar {
  background: linear-gradient(135deg, #404040, #525252);
  color: white;
}

.chat-message-content {
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  font-size: var(--text-sm);
  line-height: 1.5;
}

.chat-message.user .chat-message-content {
  background: var(--color-primary);
  color: white;
}

.chat-message-content p {
  margin: 0 0 var(--spacing-xs);
}

.chat-message-content p:last-child {
  margin-bottom: 0;
}

.chat-message-content code {
  padding: 1px 4px;
  background: rgba(0, 0, 0, 0.1);
  border-radius: 3px;
  font-family: var(--font-mono);
  font-size: 0.9em;
}

.chat-message.user .chat-message-content code {
  background: rgba(255, 255, 255, 0.2);
}

.chat-message-content pre {
  margin: var(--spacing-sm) 0;
  padding: var(--spacing-sm);
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  overflow-x: auto;
}

.chat-message.user .chat-message-content pre {
  background: rgba(0, 0, 0, 0.2);
}

.chat-message-sources {
  margin-top: var(--spacing-sm);
  padding-top: var(--spacing-sm);
  border-top: 1px solid var(--color-border);
  font-size: var(--text-xs);
}

.sources-label {
  display: flex;
  align-items: center;
  gap: var(--spacing-xs);
  margin-bottom: var(--spacing-xs);
  font-weight: 500;
  color: var(--color-text-muted);
}

.sources-list {
  display: flex;
  flex-wrap: wrap;
  gap: var(--spacing-xs);
}

.source-link {
  display: inline-flex;
  align-items: center;
  gap: 4px;
  padding: 2px 8px;
  background: var(--color-bg-tertiary);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  text-decoration: none;
  font-size: var(--text-xs);
  transition: all var(--transition-fast);
}

.source-link:hover {
  background: var(--color-primary-light);
  color: var(--color-primary-hover);
}

.source-link .source-icon {
  width: 12px;
  height: 12px;
  opacity: 0.7;
}

.chat-message-sources a {
  color: var(--color-primary);
  text-decoration: none;
}

.chat-message-sources a:hover {
  text-decoration: underline;
}

/* Inline doc links in chat messages */
.inline-doc-link {
  display: inline-flex;
  align-items: center;
  gap: 2px;
  padding: 0 4px;
  background: var(--color-primary-light);
  border-radius: var(--radius-sm);
  color: var(--color-primary);
  text-decoration: none;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.inline-doc-link:hover {
  background: var(--color-primary);
  color: white;
}

.inline-doc-link .link-icon {
  width: 10px;
  height: 10px;
  opacity: 0.7;
}

/* Chat diagram container for codemap visualizations */
.chat-diagram-container {
  margin: var(--spacing-md) 0;
  padding: var(--spacing-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  overflow-x: auto;
}

.chat-diagram-container .mermaid {
  text-align: center;
}

.chat-diagram-container .mermaid svg {
  max-width: 100%;
  height: auto;
}

/* Monochrome mermaid styling in chat */
.chat-diagram-container .mermaid .node rect,
.chat-diagram-container .mermaid .node polygon,
.chat-diagram-container .mermaid .node circle {
  fill: var(--color-bg-secondary) !important;
  stroke: var(--color-text) !important;
}

.chat-diagram-container .mermaid .edgePath path {
  stroke: var(--color-text-secondary) !important;
}

.chat-diagram-container .mermaid .arrowheadPath {
  fill: var(--color-text-secondary) !important;
}

/* Clickable nodes styling */
.chat-diagram-container .mermaid .node {
  cursor: pointer;
  transition: all var(--transition-fast);
}

.chat-diagram-container .mermaid .node:hover rect,
.chat-diagram-container .mermaid .node:hover polygon {
  fill: var(--color-bg-tertiary) !important;
  stroke-width: 2px;
}

.chat-typing {
  display: flex;
  gap: 4px;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg-secondary);
  border-radius: var(--radius-md);
  width: fit-content;
}

.chat-typing-dot {
  width: 8px;
  height: 8px;
  background: var(--color-text-muted);
  border-radius: 50%;
  animation: chatTyping 1.4s infinite ease-in-out;
}

.chat-typing-dot:nth-child(1) { animation-delay: 0s; }
.chat-typing-dot:nth-child(2) { animation-delay: 0.2s; }
.chat-typing-dot:nth-child(3) { animation-delay: 0.4s; }

@keyframes chatTyping {
  0%, 60%, 100% {
    transform: translateY(0);
    opacity: 0.4;
  }
  30% {
    transform: translateY(-4px);
    opacity: 1;
  }
}

/* Streaming response indicator */
.chat-message.streaming .chat-message-content {
  min-height: 40px;
}

.streaming-indicator {
  display: flex;
  align-items: center;
  gap: var(--spacing-sm);
  color: var(--color-text-muted);
  font-size: var(--text-sm);
}

.streaming-dot {
  width: 8px;
  height: 8px;
  background: var(--color-primary);
  border-radius: 50%;
  animation: streamingPulse 1.5s ease-in-out infinite;
}

@keyframes streamingPulse {
  0%, 100% {
    opacity: 0.4;
    transform: scale(0.8);
  }
  50% {
    opacity: 1;
    transform: scale(1.2);
  }
}

.streaming-text {
  animation: streamingFade 2s ease-in-out infinite;
}

@keyframes streamingFade {
  0%, 100% { opacity: 0.6; }
  50% { opacity: 1; }
}

.chat-input-area {
  display: flex;
  gap: var(--spacing-sm);
  padding: var(--spacing-md);
  border-top: 1px solid var(--color-border);
  background: var(--color-bg-secondary);
  border-radius: 0 0 var(--radius-lg) var(--radius-lg);
}

.chat-input {
  flex: 1;
  padding: var(--spacing-sm) var(--spacing-md);
  background: var(--color-bg);
  border: 1px solid var(--color-border);
  border-radius: var(--radius-md);
  color: var(--color-text);
  font-family: var(--font-sans);
  font-size: var(--text-sm);
  resize: none;
  min-height: 40px;
  max-height: 120px;
  outline: none;
  transition: border-color var(--transition-fast);
}

.chat-input:focus {
  border-color: var(--color-primary);
}

.chat-input::placeholder {
  color: var(--color-text-muted);
}

.chat-send {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 40px;
  height: 40px;
  padding: 0;
  background: var(--color-primary);
  border: none;
  border-radius: var(--radius-md);
  color: white;
  cursor: pointer;
  transition: all var(--transition-fast);
  flex-shrink: 0;
}

.chat-send:hover:not(:disabled) {
  background: var(--color-primary-hover);
}

.chat-send:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.chat-error {
  padding: var(--spacing-sm) var(--spacing-md);
  background: rgba(239, 68, 68, 0.1);
  border: 1px solid rgba(239, 68, 68, 0.3);
  border-radius: var(--radius-md);
  color: var(--color-error);
  font-size: var(--text-sm);
}

/* Distinct link styling in chat responses - luxurious purple */
.chat-message-content a:not(.source-link) {
  color: var(--color-link);
  text-decoration: none;
  background: linear-gradient(to bottom, transparent 60%, rgba(147, 51, 234, 0.2) 60%);
  padding: 0 4px;
  border-radius: 3px;
  font-weight: 500;
  transition: all var(--transition-fast);
}

.chat-message-content a:not(.source-link):hover {
  color: var(--color-link-hover);
  background: rgba(147, 51, 234, 0.15);
}

.chat-message-content a:not(.source-link)::after {
  content: ' →';
  font-size: 0.85em;
  opacity: 0.7;
}

[data-theme="dark"] .chat-message-content a:not(.source-link) {
  background: linear-gradient(to bottom, transparent 60%, rgba(192, 132, 252, 0.25) 60%);
}

[data-theme="dark"] .chat-message-content a:not(.source-link):hover {
  background: rgba(192, 132, 252, 0.2);
}

/* Dark mode chat styling */
[data-theme="dark"] .chat-message-content {
  color: var(--color-text);
}

[data-theme="dark"] .chat-message.user .chat-message-content {
  color: white;
}

[data-theme="dark"] .chat-welcome-icon {
  background: linear-gradient(135deg, #404040, #525252);
}

[data-theme="dark"] .chat-suggestion {
  background: var(--color-bg-tertiary);
  border-color: var(--color-border);
  color: var(--color-text);
}

[data-theme="dark"] .chat-suggestion:hover {
  background: var(--color-bg-secondary);
  border-color: var(--color-primary);
}

[data-theme="dark"] .chat-mode-select {
  background: var(--color-bg-secondary);
  border-color: var(--color-border);
  color: var(--color-text);
}

[data-theme="dark"] .chat-header {
  border-bottom-color: var(--color-border);
}

/* SPA navigation loading state */
.chat-message-content a.loading {
  opacity: 0.6;
  pointer-events: none;
}

/* Mobile chat panel */
@media (max-width: 768px) {
  .chat-panel {
    top: auto;
    bottom: 0;
    left: 0;
    width: 100%;
    height: 70vh;
    border-left: none;
    border-top: 1px solid var(--color-border);
    border-radius: var(--radius-lg) var(--radius-lg) 0 0;
    transform: translateY(100%);
  }

  body.chat-open .chat-panel {
    transform: translateY(0);
  }

  body.chat-open .site-container {
    margin-right: 0;
  }

  .chat-toggle-btn {
    right: var(--spacing-md);
    bottom: var(--spacing-md);
    top: auto;
    transform: none;
    width: 48px;
    height: 48px;
    border: 1px solid var(--color-border);
    border-radius: 50%;
    box-shadow: var(--shadow-lg);
  }

  .chat-toggle-btn:hover {
    width: 48px;
  }

  body.chat-open .chat-toggle-btn {
    right: var(--spacing-md);
    bottom: calc(70vh + var(--spacing-md));
  }

  .chat-suggestions {
    grid-template-columns: 1fr;
  }
}

/* Smaller screens */
@media (max-width: 480px) {
  .chat-panel {
    height: 80vh;
  }

  body.chat-open .chat-toggle-btn {
    bottom: calc(80vh + var(--spacing-md));
  }
}
`;
}
