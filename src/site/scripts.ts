/**
 * Client-Side JavaScript for Interactive Wiki Features
 *
 * Provides:
 * - Full-text search
 * - Guided tours / onboarding
 * - Code explorer with syntax highlighting
 * - Keyboard navigation
 * - Theme switching
 * - Progress tracking
 * - Mermaid diagram interactions
 */

interface Features {
  guidedTour?: boolean;
  codeExplorer?: boolean;
  search?: boolean;
  progressTracking?: boolean;
  keyboardNav?: boolean;
}

export function getClientScripts(features: Features): string {
  return `
(function() {
  'use strict';

  // ========================================
  // Configuration & State
  // ========================================
  const config = window.WIKI_CONFIG || {};
  const state = {
    manifest: null,
    searchIndex: [],
    readPages: new Set(),
    currentTour: null,
    tourStep: 0
  };

  // ========================================
  // Initialization
  // ========================================
  document.addEventListener('DOMContentLoaded', async () => {
    // Load manifest
    await loadManifest();

    // Initialize features
    initTheme();
    initMobileMenu();
    initScrollToTop();
    initCopyButtons();
    initMermaid();
    initSourceLinks();
    initTocHighlight();

    ${features.search ? 'initSearch();' : ''}
    ${features.guidedTour ? 'initTours();' : ''}
    ${features.codeExplorer ? 'initCodeExplorer();' : ''}
    ${features.keyboardNav ? 'initKeyboardNav();' : ''}
    ${features.progressTracking ? 'initProgressTracking();' : ''}

    // Highlight code blocks
    if (window.Prism) {
      Prism.highlightAll();
    }
  });

  // ========================================
  // Manifest Loading
  // ========================================
  async function loadManifest() {
    try {
      const response = await fetch(config.rootPath + 'manifest.json');
      state.manifest = await response.json();
      state.searchIndex = state.manifest.searchIndex || [];
    } catch (e) {
      console.warn('Failed to load manifest:', e);
    }
  }

  // ========================================
  // Theme Management
  // ========================================
  function initTheme() {
    const toggle = document.querySelector('.theme-toggle');
    if (!toggle) return;

    // Load saved theme
    const savedTheme = localStorage.getItem('wiki-theme');
    if (savedTheme) {
      document.documentElement.setAttribute('data-theme', savedTheme);
    }

    toggle.addEventListener('click', () => {
      const current = document.documentElement.getAttribute('data-theme');
      const next = current === 'dark' ? 'light' : 'dark';
      document.documentElement.setAttribute('data-theme', next);
      localStorage.setItem('wiki-theme', next);
      showToast('Theme switched to ' + next, 'info');
    });
  }

  // ========================================
  // Mobile Menu
  // ========================================
  function initMobileMenu() {
    const toggle = document.querySelector('.mobile-menu-toggle');
    const sidebar = document.querySelector('.sidebar');

    if (!toggle || !sidebar) return;

    toggle.addEventListener('click', () => {
      sidebar.classList.toggle('open');
    });

    // Close on outside click
    document.addEventListener('click', (e) => {
      if (sidebar.classList.contains('open') &&
          !sidebar.contains(e.target) &&
          !toggle.contains(e.target)) {
        sidebar.classList.remove('open');
      }
    });
  }

  // ========================================
  // Scroll to Top
  // ========================================
  function initScrollToTop() {
    const btn = document.querySelector('.scroll-to-top');
    if (!btn) return;

    btn.addEventListener('click', () => {
      window.scrollTo({ top: 0, behavior: 'smooth' });
    });
  }

  // ========================================
  // Code Copy Buttons
  // ========================================
  function initCopyButtons() {
    document.querySelectorAll('.code-copy').forEach(btn => {
      btn.addEventListener('click', async () => {
        const codeBlock = btn.closest('.code-block');
        const code = codeBlock.querySelector('code').textContent;

        try {
          await navigator.clipboard.writeText(code);
          btn.classList.add('copied');
          showToast('Code copied!', 'success');

          setTimeout(() => {
            btn.classList.remove('copied');
          }, 2000);
        } catch (e) {
          showToast('Failed to copy', 'error');
        }
      });
    });
  }

  // ========================================
  // Mermaid Diagrams
  // ========================================
  function initMermaid() {
    // Initialize mermaid
    if (window.mermaid) {
      const isDark = document.documentElement.getAttribute('data-theme') === 'dark' ||
        (document.documentElement.getAttribute('data-theme') === 'auto' &&
         window.matchMedia('(prefers-color-scheme: dark)').matches);

      mermaid.initialize({
        startOnLoad: true,
        theme: isDark ? 'dark' : 'default',
        securityLevel: 'loose'
      });
    }

    // Fullscreen buttons
    document.querySelectorAll('.mermaid-fullscreen').forEach(btn => {
      btn.addEventListener('click', () => {
        const container = btn.closest('.mermaid-container');
        const diagram = container.querySelector('.mermaid');
        openMermaidFullscreen(diagram.innerHTML);
      });
    });

    // Close fullscreen
    const modal = document.querySelector('.mermaid-fullscreen-modal');
    if (modal) {
      modal.querySelector('.mermaid-fullscreen-backdrop')?.addEventListener('click', closeMermaidFullscreen);
      modal.querySelector('.mermaid-fullscreen-close')?.addEventListener('click', closeMermaidFullscreen);
    }
  }

  function openMermaidFullscreen(content) {
    const modal = document.querySelector('.mermaid-fullscreen-modal');
    const diagramContainer = modal.querySelector('.mermaid-fullscreen-diagram');
    diagramContainer.innerHTML = content;
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';
  }

  function closeMermaidFullscreen() {
    const modal = document.querySelector('.mermaid-fullscreen-modal');
    modal.classList.remove('open');
    document.body.style.overflow = '';
  }

  // ========================================
  // Source Links (Code Explorer)
  // ========================================
  function initSourceLinks() {
    document.querySelectorAll('.source-link, .code-source').forEach(link => {
      link.addEventListener('click', (e) => {
        e.preventDefault();
        const source = link.dataset.source;
        if (source && config.features?.codeExplorer) {
          openCodeExplorer(source);
        }
      });
    });
  }

  // ========================================
  // Table of Contents Highlighting
  // ========================================
  function initTocHighlight() {
    const toc = document.querySelector('.toc-list');
    if (!toc) return;

    const headings = document.querySelectorAll('.heading-anchor');
    const tocLinks = toc.querySelectorAll('a');

    const observer = new IntersectionObserver((entries) => {
      entries.forEach(entry => {
        if (entry.isIntersecting) {
          const id = entry.target.id;
          tocLinks.forEach(link => {
            link.classList.toggle('active', link.getAttribute('href') === '#' + id);
          });
        }
      });
    }, { rootMargin: '-100px 0px -66%' });

    headings.forEach(h => observer.observe(h));
  }

  // ========================================
  // Search
  // ========================================
  ${features.search ? `
  function initSearch() {
    const modal = document.querySelector('.search-modal');
    const trigger = document.querySelector('.search-trigger');
    const input = modal?.querySelector('.search-input');
    const results = modal?.querySelector('.search-results');
    const backdrop = modal?.querySelector('.search-modal-backdrop');

    if (!modal || !trigger || !input) return;

    let selectedIndex = -1;

    // Open search
    trigger.addEventListener('click', openSearch);

    function openSearch() {
      modal.classList.add('open');
      input.focus();
      document.body.style.overflow = 'hidden';
    }

    function closeSearch() {
      modal.classList.remove('open');
      input.value = '';
      results.innerHTML = '<div class="search-empty"><p>Start typing to search...</p></div>';
      document.body.style.overflow = '';
      selectedIndex = -1;
    }

    // Close on backdrop/escape
    backdrop?.addEventListener('click', closeSearch);
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && modal.classList.contains('open')) {
        closeSearch();
      }
      if (e.key === '/' && !e.ctrlKey && !e.metaKey && !isInputFocused()) {
        e.preventDefault();
        openSearch();
      }
    });

    // Search input handling
    let debounceTimer;
    input.addEventListener('input', () => {
      clearTimeout(debounceTimer);
      debounceTimer = setTimeout(() => {
        performSearch(input.value.trim());
      }, 200);
    });

    // Keyboard navigation in results
    input.addEventListener('keydown', (e) => {
      const items = results.querySelectorAll('.search-result');

      if (e.key === 'ArrowDown') {
        e.preventDefault();
        selectedIndex = Math.min(selectedIndex + 1, items.length - 1);
        updateSelection(items);
      } else if (e.key === 'ArrowUp') {
        e.preventDefault();
        selectedIndex = Math.max(selectedIndex - 1, 0);
        updateSelection(items);
      } else if (e.key === 'Enter' && selectedIndex >= 0) {
        e.preventDefault();
        items[selectedIndex]?.click();
      }
    });

    function updateSelection(items) {
      items.forEach((item, i) => {
        item.classList.toggle('selected', i === selectedIndex);
      });
      if (items[selectedIndex]) {
        items[selectedIndex].scrollIntoView({ block: 'nearest' });
      }
    }

    function performSearch(query) {
      selectedIndex = -1;

      if (!query || query.length < 2) {
        results.innerHTML = '<div class="search-empty"><p>Start typing to search...</p><div class="search-hints"><p><kbd>Enter</kbd> to select</p><p><kbd>↑</kbd> <kbd>↓</kbd> to navigate</p><p><kbd>ESC</kbd> to close</p></div></div>';
        return;
      }

      const queryLower = query.toLowerCase();
      const matches = state.searchIndex.filter(page => {
        return page.title.toLowerCase().includes(queryLower) ||
               page.content.toLowerCase().includes(queryLower) ||
               page.headings.some(h => h.toLowerCase().includes(queryLower));
      }).slice(0, 10);

      if (matches.length === 0) {
        results.innerHTML = '<div class="search-empty"><p>No results found for "' + escapeHtml(query) + '"</p></div>';
        return;
      }

      results.innerHTML = matches.map(match => {
        const snippet = getSnippet(match.content, query);
        return \`
          <a href="\${config.rootPath}\${match.path}" class="search-result">
            <div class="search-result-title">\${escapeHtml(match.title)}</div>
            <div class="search-result-snippet">\${snippet}</div>
          </a>
        \`;
      }).join('');

      // Add click handlers to close search
      results.querySelectorAll('.search-result').forEach(result => {
        result.addEventListener('click', closeSearch);
      });
    }

    function getSnippet(content, query) {
      const index = content.toLowerCase().indexOf(query.toLowerCase());
      if (index === -1) return '';

      const start = Math.max(0, index - 50);
      const end = Math.min(content.length, index + query.length + 50);
      let snippet = content.slice(start, end);

      if (start > 0) snippet = '...' + snippet;
      if (end < content.length) snippet = snippet + '...';

      // Highlight matches
      const regex = new RegExp('(' + escapeRegex(query) + ')', 'gi');
      return escapeHtml(snippet).replace(regex, '<mark>$1</mark>');
    }
  }
  ` : ''}

  // ========================================
  // Guided Tours
  // ========================================
  ${features.guidedTour ? `
  function initTours() {
    const triggerBtn = document.querySelector('.tour-trigger');
    const selectorModal = document.querySelector('.tour-selector-modal');
    const overlay = document.querySelector('.tour-overlay');

    if (!triggerBtn || !state.manifest?.tours) return;

    // Build tour list
    const tourList = selectorModal?.querySelector('.tour-list');
    if (tourList && state.manifest.tours.length > 0) {
      tourList.innerHTML = state.manifest.tours.map(tour => \`
        <button class="tour-item" data-tour-id="\${tour.id}">
          <div class="tour-item-name">\${escapeHtml(tour.name)}</div>
          <div class="tour-item-desc">\${escapeHtml(tour.description)}</div>
        </button>
      \`).join('');

      tourList.querySelectorAll('.tour-item').forEach(btn => {
        btn.addEventListener('click', () => {
          closeTourSelector();
          startTour(btn.dataset.tourId);
        });
      });
    }

    // Tour trigger button
    triggerBtn.addEventListener('click', () => {
      if (state.manifest.tours.length === 1) {
        startTour(state.manifest.tours[0].id);
      } else {
        openTourSelector();
      }
    });

    // Tour selector modal
    selectorModal?.querySelector('.tour-selector-backdrop')?.addEventListener('click', closeTourSelector);
    selectorModal?.querySelector('.tour-selector-close')?.addEventListener('click', closeTourSelector);

    // Tour overlay buttons
    overlay?.querySelector('.tour-btn-skip')?.addEventListener('click', endTour);
    overlay?.querySelector('.tour-btn-prev')?.addEventListener('click', prevTourStep);
    overlay?.querySelector('.tour-btn-next')?.addEventListener('click', nextTourStep);

    // Check if first visit - show tour offer
    if (!localStorage.getItem('wiki-tour-seen')) {
      setTimeout(() => {
        if (state.manifest.tours.length > 0) {
          openTourSelector();
          localStorage.setItem('wiki-tour-seen', 'true');
        }
      }, 1000);
    }
  }

  function openTourSelector() {
    document.querySelector('.tour-selector-modal')?.classList.add('open');
  }

  function closeTourSelector() {
    document.querySelector('.tour-selector-modal')?.classList.remove('open');
  }

  function startTour(tourId) {
    const tour = state.manifest?.tours?.find(t => t.id === tourId);
    if (!tour || tour.steps.length === 0) return;

    state.currentTour = tour;
    state.tourStep = 0;

    document.querySelector('.tour-overlay')?.classList.add('active');
    showTourStep();
  }

  function showTourStep() {
    const overlay = document.querySelector('.tour-overlay');
    const spotlight = overlay?.querySelector('.tour-spotlight');
    const tooltip = overlay?.querySelector('.tour-tooltip');
    const tour = state.currentTour;

    if (!tour || !overlay || !spotlight || !tooltip) return;

    const step = tour.steps[state.tourStep];
    if (!step) return;

    // Check if step is on a different page
    if (step.page && step.page !== config.currentPath) {
      // Navigate to the page
      window.location.href = config.rootPath + step.page + '?tour=' + tour.id + '&step=' + state.tourStep;
      return;
    }

    // Find target element
    const target = document.querySelector(step.targetSelector);
    if (!target) {
      // Skip to next step if target not found
      if (state.tourStep < tour.steps.length - 1) {
        state.tourStep++;
        showTourStep();
      } else {
        endTour();
      }
      return;
    }

    // Position spotlight
    const rect = target.getBoundingClientRect();
    const padding = 8;
    spotlight.style.top = (rect.top + window.scrollY - padding) + 'px';
    spotlight.style.left = (rect.left - padding) + 'px';
    spotlight.style.width = (rect.width + padding * 2) + 'px';
    spotlight.style.height = (rect.height + padding * 2) + 'px';

    // Scroll target into view
    target.scrollIntoView({ behavior: 'smooth', block: 'center' });

    // Position tooltip
    const pos = step.position || 'bottom';
    tooltip.className = 'tour-tooltip tour-tooltip-' + pos;

    // Update tooltip content
    tooltip.querySelector('.tour-step-title').textContent = step.title;
    tooltip.querySelector('.tour-step-description').textContent = step.description;
    tooltip.querySelector('.tour-step-counter').textContent =
      (state.tourStep + 1) + ' of ' + tour.steps.length;

    // Update buttons
    const prevBtn = tooltip.querySelector('.tour-btn-prev');
    const nextBtn = tooltip.querySelector('.tour-btn-next');

    prevBtn.style.display = state.tourStep === 0 ? 'none' : 'block';
    nextBtn.textContent = state.tourStep === tour.steps.length - 1 ? 'Finish' : 'Next';

    // Position tooltip based on direction
    setTimeout(() => {
      const tooltipRect = tooltip.getBoundingClientRect();
      let top, left;

      switch (pos) {
        case 'top':
          top = rect.top + window.scrollY - tooltipRect.height - 16;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          break;
        case 'bottom':
          top = rect.bottom + window.scrollY + 16;
          left = rect.left + (rect.width - tooltipRect.width) / 2;
          break;
        case 'left':
          top = rect.top + window.scrollY + (rect.height - tooltipRect.height) / 2;
          left = rect.left - tooltipRect.width - 16;
          break;
        case 'right':
          top = rect.top + window.scrollY + (rect.height - tooltipRect.height) / 2;
          left = rect.right + 16;
          break;
      }

      // Keep tooltip in viewport
      left = Math.max(16, Math.min(left, window.innerWidth - tooltipRect.width - 16));
      top = Math.max(16, top);

      tooltip.style.top = top + 'px';
      tooltip.style.left = left + 'px';
    }, 50);
  }

  function nextTourStep() {
    if (state.tourStep < state.currentTour.steps.length - 1) {
      state.tourStep++;
      showTourStep();
    } else {
      endTour();
      showToast('Tour complete! Explore freely.', 'success');
    }
  }

  function prevTourStep() {
    if (state.tourStep > 0) {
      state.tourStep--;
      showTourStep();
    }
  }

  function endTour() {
    state.currentTour = null;
    state.tourStep = 0;
    document.querySelector('.tour-overlay')?.classList.remove('active');
  }

  // Resume tour from URL parameters
  (function checkTourResume() {
    const params = new URLSearchParams(window.location.search);
    const tourId = params.get('tour');
    const step = parseInt(params.get('step'));

    if (tourId && !isNaN(step)) {
      // Clean URL
      history.replaceState({}, '', window.location.pathname);

      // Wait for manifest then resume
      const checkManifest = setInterval(() => {
        if (state.manifest?.tours) {
          clearInterval(checkManifest);
          const tour = state.manifest.tours.find(t => t.id === tourId);
          if (tour) {
            state.currentTour = tour;
            state.tourStep = step;
            document.querySelector('.tour-overlay')?.classList.add('active');
            showTourStep();
          }
        }
      }, 100);
    }
  })();
  ` : ''}

  // ========================================
  // Code Explorer
  // ========================================
  ${features.codeExplorer ? `
  function initCodeExplorer() {
    const modal = document.querySelector('.code-explorer-modal');
    if (!modal) return;

    modal.querySelector('.code-explorer-backdrop')?.addEventListener('click', closeCodeExplorer);
    modal.querySelector('.code-explorer-close')?.addEventListener('click', closeCodeExplorer);
  }

  function openCodeExplorer(sourceRef) {
    const modal = document.querySelector('.code-explorer-modal');
    if (!modal) return;

    // Parse source reference (e.g., "src/auth.ts:23-45")
    const match = sourceRef.match(/^(.+?)(?::(\\d+)(?:-(\\d+))?)?$/);
    if (!match) return;

    const [, filePath, startLine, endLine] = match;

    modal.querySelector('.code-explorer-file').textContent = filePath;
    modal.querySelector('.code-explorer-info').textContent =
      startLine ? 'Lines ' + startLine + (endLine ? '-' + endLine : '') : 'Full file';

    // Show loading state
    const codeEl = modal.querySelector('.code-explorer-code');
    codeEl.textContent = 'Loading...';
    modal.classList.add('open');
    document.body.style.overflow = 'hidden';

    // In a real implementation, this would fetch from the repo
    // For static sites, we show a placeholder with navigation hint
    setTimeout(() => {
      codeEl.innerHTML = \`<span class="comment">// Source: \${escapeHtml(sourceRef)}</span>
<span class="comment">// This code viewer shows source references from the documentation.</span>
<span class="comment">// In the full version, code is fetched from your repository.</span>

<span class="comment">// Navigate to:</span>
<span class="string">"\${escapeHtml(filePath)}"</span>
\${startLine ? '<span class="comment">// Lines: ' + startLine + (endLine ? '-' + endLine : '') + '</span>' : ''}

<span class="comment">// Tip: Use the source links in code blocks to navigate</span>
<span class="comment">// directly to the relevant code in your editor or IDE.</span>\`;

      if (window.Prism) {
        Prism.highlightElement(codeEl);
      }
    }, 300);
  }

  function closeCodeExplorer() {
    document.querySelector('.code-explorer-modal')?.classList.remove('open');
    document.body.style.overflow = '';
  }
  ` : ''}

  // ========================================
  // Keyboard Navigation
  // ========================================
  ${features.keyboardNav ? `
  function initKeyboardNav() {
    const helpModal = document.querySelector('.keyboard-help-modal');

    helpModal?.querySelector('.keyboard-help-backdrop')?.addEventListener('click', closeKeyboardHelp);
    helpModal?.querySelector('.keyboard-help-close')?.addEventListener('click', closeKeyboardHelp);

    // Track g key for gg command
    let lastKey = '';
    let lastKeyTime = 0;

    document.addEventListener('keydown', (e) => {
      // Ignore when typing in inputs
      if (isInputFocused()) return;

      // Ignore with modifiers (except shift for capital letters)
      if (e.ctrlKey || e.metaKey || e.altKey) return;

      const key = e.key;
      const now = Date.now();

      switch (key) {
        case 'j':
          e.preventDefault();
          navigateHeading(1);
          break;

        case 'k':
          e.preventDefault();
          navigateHeading(-1);
          break;

        case 'h':
          e.preventDefault();
          navigatePage(-1);
          break;

        case 'l':
          e.preventDefault();
          navigatePage(1);
          break;

        case 'g':
          if (lastKey === 'g' && now - lastKeyTime < 500) {
            e.preventDefault();
            window.scrollTo({ top: 0, behavior: 'smooth' });
          }
          break;

        case 'G':
          e.preventDefault();
          window.scrollTo({ top: document.body.scrollHeight, behavior: 'smooth' });
          break;

        case 't':
          document.querySelector('.theme-toggle')?.click();
          break;

        case '?':
          e.preventDefault();
          openKeyboardHelp();
          break;
      }

      lastKey = key;
      lastKeyTime = now;
    });
  }

  function navigateHeading(direction) {
    const headings = Array.from(document.querySelectorAll('.heading-anchor'));
    if (headings.length === 0) return;

    const scrollTop = window.scrollY + 100;
    let targetIndex = -1;

    if (direction > 0) {
      // Find next heading below current scroll
      targetIndex = headings.findIndex(h => h.offsetTop > scrollTop);
    } else {
      // Find previous heading above current scroll
      for (let i = headings.length - 1; i >= 0; i--) {
        if (headings[i].offsetTop < scrollTop - 10) {
          targetIndex = i;
          break;
        }
      }
    }

    if (targetIndex >= 0 && targetIndex < headings.length) {
      headings[targetIndex].scrollIntoView({ behavior: 'smooth', block: 'start' });
    }
  }

  function navigatePage(direction) {
    const navLinks = Array.from(document.querySelectorAll('.nav-link'));
    const currentIndex = navLinks.findIndex(link =>
      link.getAttribute('href').endsWith(config.currentPath)
    );

    const targetIndex = currentIndex + direction;
    if (targetIndex >= 0 && targetIndex < navLinks.length) {
      window.location.href = navLinks[targetIndex].href;
    }
  }

  function openKeyboardHelp() {
    document.querySelector('.keyboard-help-modal')?.classList.add('open');
  }

  function closeKeyboardHelp() {
    document.querySelector('.keyboard-help-modal')?.classList.remove('open');
  }
  ` : ''}

  // ========================================
  // Progress Tracking
  // ========================================
  ${features.progressTracking ? `
  function initProgressTracking() {
    // Load read pages from storage
    const saved = localStorage.getItem('wiki-read-pages');
    if (saved) {
      try {
        state.readPages = new Set(JSON.parse(saved));
      } catch (e) {}
    }

    // Mark current page as read
    state.readPages.add(config.currentPath);
    saveReadPages();

    // Update UI
    updateProgressUI();

    // Mark as read in sidebar
    document.querySelectorAll('.nav-link').forEach(link => {
      const href = link.getAttribute('href');
      const path = href.replace(config.rootPath, '').replace(/^\\.?\\//, '');
      if (state.readPages.has(path)) {
        link.closest('.nav-item')?.classList.add('read');
      }
    });
  }

  function saveReadPages() {
    localStorage.setItem('wiki-read-pages', JSON.stringify([...state.readPages]));
  }

  function updateProgressUI() {
    const totalPages = state.manifest?.pages?.length || 1;
    const readCount = state.readPages.size;
    const percentage = Math.round((readCount / totalPages) * 100);

    const fill = document.querySelector('.progress-fill');
    const text = document.querySelector('.progress-text');

    if (fill) fill.style.width = percentage + '%';
    if (text) text.textContent = percentage + '% complete (' + readCount + '/' + totalPages + ')';
  }
  ` : ''}

  // ========================================
  // Utility Functions
  // ========================================
  function isInputFocused() {
    const active = document.activeElement;
    return active && (
      active.tagName === 'INPUT' ||
      active.tagName === 'TEXTAREA' ||
      active.contentEditable === 'true'
    );
  }

  function escapeHtml(text) {
    const div = document.createElement('div');
    div.textContent = text;
    return div.innerHTML;
  }

  function escapeRegex(string) {
    return string.replace(/[.*+?^\${}()|[\\]\\\\]/g, '\\\\$&');
  }

  function showToast(message, type = 'info') {
    const container = document.querySelector('.toast-container');
    if (!container) return;

    const toast = document.createElement('div');
    toast.className = 'toast toast-' + type;
    toast.textContent = message;

    container.appendChild(toast);

    setTimeout(() => {
      toast.classList.add('toast-out');
      setTimeout(() => toast.remove(), 300);
    }, 3000);
  }
})();
`;
}
