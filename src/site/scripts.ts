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
  aiChat?: boolean;
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
    initSPANavigation();

    ${features.search ? 'initSearch();' : ''}
    ${features.guidedTour ? 'initTours();' : ''}
    ${features.codeExplorer ? 'initCodeExplorer();' : ''}
    ${features.keyboardNav ? 'initKeyboardNav();' : ''}
    ${features.progressTracking ? 'initProgressTracking();' : ''}
    ${features.aiChat ? 'initAIChat();' : ''}

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
  // SPA Navigation (no page reload for internal links)
  // ========================================
  function initSPANavigation() {
    // Intercept clicks on internal links for SPA-like navigation
    document.addEventListener('click', async (e) => {
      const link = e.target.closest('a[href]');
      if (!link) return;

      // Skip if modifier keys are pressed (let browser handle normally)
      if (e.ctrlKey || e.metaKey || e.shiftKey || e.altKey) return;

      // Skip anchor links (same page)
      if (link.getAttribute('href')?.startsWith('#')) return;

      // Skip external links
      const linkUrl = new URL(link.href, window.location.origin);
      if (linkUrl.origin !== window.location.origin) return;

      // Skip non-HTML links (downloads, etc.)
      if (link.getAttribute('download')) return;

      // Skip links with target="_blank"
      if (link.target === '_blank') return;

      // Skip source links (handled separately)
      if (link.classList.contains('source-link') || link.classList.contains('code-source')) return;

      // Check if it's an internal wiki link (.html file)
      const path = linkUrl.pathname;
      if (!path.endsWith('.html') && !path.endsWith('/')) return;

      // Prevent default and navigate via SPA
      e.preventDefault();
      await navigateSPA(link.href, link);
    });

    // Handle browser back/forward
    window.addEventListener('popstate', async (e) => {
      if (e.state?.spaUrl) {
        await navigateSPA(e.state.spaUrl, null, true);
      }
    });
  }

  async function navigateSPA(url, linkElement, isPopState = false) {
    // Add loading state to clicked link
    if (linkElement) {
      linkElement.classList.add('loading');
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Page not found');

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract key elements from new page
      const newContent = doc.querySelector('.page-content');
      const newTitle = doc.querySelector('title')?.textContent || 'Documentation';
      const newToc = doc.querySelector('.toc-list');
      const newBreadcrumbs = doc.querySelector('.breadcrumbs');

      const currentContent = document.querySelector('.page-content');
      const currentToc = document.querySelector('.toc-list');
      const currentBreadcrumbs = document.querySelector('.breadcrumbs');

      if (newContent && currentContent) {
        // Smooth transition
        currentContent.style.opacity = '0.5';

        // Small delay for visual feedback
        await new Promise(r => setTimeout(r, 100));

        // Update content
        currentContent.innerHTML = newContent.innerHTML;
        currentContent.style.opacity = '1';

        // Update TOC if present
        if (newToc && currentToc) {
          currentToc.innerHTML = newToc.innerHTML;
        }

        // Update breadcrumbs if present
        if (newBreadcrumbs && currentBreadcrumbs) {
          currentBreadcrumbs.innerHTML = newBreadcrumbs.innerHTML;
        }

        // Update title
        document.title = newTitle;

        // Update URL (don't push state if this is a popstate navigation)
        if (!isPopState) {
          window.history.pushState({ spaUrl: url }, newTitle, url);
        }

        // Update config.currentPath for other features
        const urlPath = new URL(url).pathname;
        config.currentPath = urlPath.replace(config.rootPath, '').replace(/^\\//, '');

        // Scroll to top of main content, or to hash if present
        const hash = new URL(url).hash;
        if (hash) {
          const targetEl = document.querySelector(hash);
          if (targetEl) {
            targetEl.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }
        } else {
          document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });
        }

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
          item.classList.remove('active');
          const navLink = item.querySelector('a');
          if (navLink && (navLink.href === url || navLink.getAttribute('href') === urlPath)) {
            item.classList.add('active');
          }
        });

        // Re-initialize dynamic features
        if (window.mermaid) {
          document.querySelectorAll('.page-content .mermaid:not([data-processed])').forEach(el => {
            try {
              window.mermaid.init(undefined, el);
            } catch (err) {
              console.warn('Mermaid init error:', err);
            }
          });
        }

        if (window.Prism) {
          Prism.highlightAllUnder(currentContent);
        }

        // Reinitialize TOC highlighting
        initTocHighlight();

        showToast('Navigated to: ' + newTitle.split(' | ')[0], 'success');
      }
    } catch (error) {
      console.error('SPA navigation failed:', error);
      // Fallback to traditional navigation
      window.location.href = url;
    } finally {
      if (linkElement) {
        linkElement.classList.remove('loading');
      }
    }
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
  // AI Chat (using SmolLM2 via transformers.js)
  // ========================================
  ${features.aiChat ? `
  const chatState = {
    isModelLoaded: false,
    isLoading: false,
    generator: null,
    embedder: null,
    embeddingsIndex: null,
    messages: [],
    abortController: null,
    runtime: null, // 'webgpu', 'wasm', or 'fallback'
    modelSize: null,
    error: null, // Track any critical errors
    mode: 'auto' // 'auto', 'chat', or 'codemap'
  };

  // Browser capability detection
  const browserCapabilities = {
    hasWebGPU: false,
    hasWasm: typeof WebAssembly !== 'undefined',
    isMobile: /iPhone|iPad|iPod|Android/i.test(navigator.userAgent),
    memoryGB: navigator.deviceMemory || 4,

    async detect() {
      // Check WebGPU support
      if (navigator.gpu) {
        try {
          const adapter = await navigator.gpu.requestAdapter();
          this.hasWebGPU = !!adapter;
        } catch (e) {
          this.hasWebGPU = false;
        }
      }
      return this;
    },

    getRecommendedConfig() {
      // Choose optimal configuration based on device capabilities
      if (this.hasWebGPU && !this.isMobile && this.memoryGB >= 4) {
        return { device: 'webgpu', dtype: 'q4', model: 'HuggingFaceTB/SmolLM2-360M-Instruct', label: 'WebGPU' };
      } else if (this.hasWebGPU && this.memoryGB >= 2) {
        return { device: 'webgpu', dtype: 'q4', model: 'HuggingFaceTB/SmolLM2-135M-Instruct', label: 'WebGPU' };
      } else if (this.hasWasm) {
        return { device: 'wasm', dtype: 'q8', model: 'HuggingFaceTB/SmolLM2-135M-Instruct', label: 'WASM' };
      }
      return { device: null, dtype: null, model: null, label: 'Search Only' };
    }
  };

  function initAIChat() {
    const panel = document.querySelector('.chat-panel');
    const toggleBtn = document.querySelector('.chat-toggle-btn');
    const collapseBtn = panel?.querySelector('.chat-panel-collapse');
    const input = panel?.querySelector('.chat-input');
    const sendBtn = panel?.querySelector('.chat-send');
    const messagesContainer = panel?.querySelector('.chat-messages');

    if (!panel || !toggleBtn) return;

    // Detect browser capabilities on init
    browserCapabilities.detect().then(() => {
      updateRuntimeBadge();
    });

    // Toggle chat panel open/close
    function toggleChatPanel() {
      const isOpen = document.body.classList.toggle('chat-open');
      if (isOpen) {
        loadAIModel();
        input?.focus();
      }
    }

    toggleBtn.addEventListener('click', toggleChatPanel);
    collapseBtn?.addEventListener('click', toggleChatPanel);

    // Resize handle functionality
    const resizeHandle = panel.querySelector('.chat-resize-handle');
    if (resizeHandle) {
      let isResizing = false;
      let startX = 0;
      let startWidth = 0;

      resizeHandle.addEventListener('mousedown', (e) => {
        isResizing = true;
        startX = e.clientX;
        startWidth = panel.offsetWidth;
        document.body.classList.add('chat-resizing');
        resizeHandle.classList.add('dragging');
        e.preventDefault();
      });

      document.addEventListener('mousemove', (e) => {
        if (!isResizing) return;

        const deltaX = startX - e.clientX;
        const newWidth = Math.min(
          Math.max(startWidth + deltaX, 300), // min 300px
          window.innerWidth * 0.5 // max 50% viewport
        );

        panel.style.width = newWidth + 'px';
        document.documentElement.style.setProperty('--chat-panel-width', newWidth + 'px');
      });

      document.addEventListener('mouseup', () => {
        if (isResizing) {
          isResizing = false;
          document.body.classList.remove('chat-resizing');
          resizeHandle.classList.remove('dragging');
          // Save width preference
          try {
            localStorage.setItem('chat-panel-width', panel.style.width);
          } catch (e) {}
        }
      });

      // Restore saved width
      try {
        const savedWidth = localStorage.getItem('chat-panel-width');
        if (savedWidth) {
          panel.style.width = savedWidth;
          document.documentElement.style.setProperty('--chat-panel-width', savedWidth);
        }
      } catch (e) {}
    }

    // Close on escape key
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && document.body.classList.contains('chat-open')) {
        document.body.classList.remove('chat-open');
      }
    });

    // SPA navigation for links in chat (including source links)
    messagesContainer?.addEventListener('click', (e) => {
      const link = e.target.closest('a[href]');
      if (link && link.href) {
        // Check if it's an internal link (same origin)
        const linkUrl = new URL(link.href, window.location.origin);
        const isInternal = linkUrl.origin === window.location.origin;
        const isExternal = link.href.startsWith('http') && !isInternal;

        if (isInternal && !isExternal) {
          e.preventDefault();
          e.stopPropagation();
          navigateWithSPA(link.href, link);
        }
      }
    });

    // Handle input
    input?.addEventListener('input', () => {
      sendBtn.disabled = !input.value.trim() || !chatState.isModelLoaded;
      autoResizeTextarea(input);
    });

    input?.addEventListener('keydown', (e) => {
      if (e.key === 'Enter' && !e.shiftKey) {
        e.preventDefault();
        if (!sendBtn.disabled) {
          sendChatMessage();
        }
      }
    });

    sendBtn?.addEventListener('click', sendChatMessage);

    // Handle suggestion buttons
    panel.querySelectorAll('.chat-suggestion').forEach(btn => {
      btn.addEventListener('click', () => {
        const question = btn.dataset.question;
        if (question && chatState.isModelLoaded) {
          input.value = question;
          sendChatMessage();
        } else if (!chatState.isModelLoaded) {
          showToast('Please wait for the AI model to load', 'info');
        }
      });
    });

    // Handle mode selector dropdown
    const modeDropdown = panel.querySelector('.chat-mode-dropdown');
    if (modeDropdown) {
      modeDropdown.addEventListener('change', (e) => {
        chatState.mode = e.target.value;
        const modeLabels = { auto: 'Auto-detect', chat: 'Chat Mode', codemap: 'Codemap Mode' };
        showToast('Switched to ' + modeLabels[chatState.mode], 'info');
      });
    }

    // Load embeddings index
    loadEmbeddingsIndex();
  }

  function updateRuntimeBadge() {
    const badge = document.querySelector('.chat-model-badge');
    if (!badge) return;

    const config = browserCapabilities.getRecommendedConfig();
    if (chatState.error) {
      badge.textContent = 'Unavailable';
      badge.className = 'chat-model-badge runtime-error';
    } else if (chatState.runtime) {
      badge.textContent = chatState.runtime === 'webgpu' ? 'SmolLM2 (WebGPU)' :
                          chatState.runtime === 'wasm' ? 'SmolLM2 (WASM)' : 'Search Mode';
      badge.className = 'chat-model-badge runtime-' + chatState.runtime;
    } else {
      badge.textContent = 'Detecting...';
    }
  }

  function showChatUnsupportedNotice(reason) {
    const messagesContainer = document.querySelector('.chat-messages');
    const welcomeEl = messagesContainer?.querySelector('.chat-welcome');
    const inputArea = document.querySelector('.chat-input-area');

    if (welcomeEl) {
      welcomeEl.innerHTML = \`
        <div class="chat-error-notice">
          <div class="chat-error-icon">
            <svg width="48" height="48" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.5">
              <circle cx="12" cy="12" r="10"></circle>
              <line x1="12" y1="8" x2="12" y2="12"></line>
              <line x1="12" y1="16" x2="12.01" y2="16"></line>
            </svg>
          </div>
          <h4>Chat Not Available</h4>
          <p class="chat-error-reason">\${reason}</p>
          <div class="chat-error-alternatives">
            <p>You can still:</p>
            <ul>
              <li><a href="#" class="use-search-link">Use the search feature</a> to find documentation</li>
              <li>Browse the sidebar navigation</li>
              <li>View the architecture diagrams</li>
            </ul>
          </div>
        </div>
      \`;

      // Add click handler for search link
      welcomeEl.querySelector('.use-search-link')?.addEventListener('click', (e) => {
        e.preventDefault();
        document.querySelector('.chat-panel')?.classList.remove('open');
        document.querySelector('.search-trigger')?.click();
      });
    }

    if (inputArea) {
      inputArea.style.display = 'none';
    }
  }

  function detectBrowserIssues() {
    const issues = [];

    // Check for private/incognito mode (localStorage may be unavailable)
    try {
      localStorage.setItem('__test__', '1');
      localStorage.removeItem('__test__');
    } catch (e) {
      issues.push('Private browsing mode detected - storage unavailable');
    }

    // Check for outdated browser
    if (!window.fetch) {
      issues.push('Your browser is outdated - fetch API not supported');
    }

    // Check for dynamic imports
    try {
      new Function('return import("")');
    } catch (e) {
      issues.push('Dynamic imports not supported');
    }

    // Check WebAssembly
    if (!browserCapabilities.hasWasm) {
      issues.push('WebAssembly not supported');
    }

    return issues;
  }

  async function loadEmbeddingsIndex() {
    try {
      const response = await fetch(config.rootPath + 'embeddings-index.json');
      if (response.ok) {
        chatState.embeddingsIndex = await response.json();
        console.log('Loaded embeddings index with', chatState.embeddingsIndex?.chunks?.length || 0, 'chunks');
      }
    } catch (e) {
      console.warn('Embeddings index not available, falling back to keyword search');
    }
  }

  async function loadAIModel() {
    if (chatState.isModelLoaded || chatState.isLoading) return;

    // Check for critical browser issues first
    const browserIssues = detectBrowserIssues();
    if (browserIssues.length > 0) {
      chatState.error = browserIssues.join('. ');
      showChatUnsupportedNotice(chatState.error);
      updateRuntimeBadge();
      return;
    }

    chatState.isLoading = true;
    const statusEl = document.querySelector('.chat-panel-status');
    const loadingText = statusEl?.querySelector('.chat-loading-text');
    const sendBtn = document.querySelector('.chat-send');
    const progressBar = statusEl?.querySelector('.chat-progress-bar');

    statusEl?.classList.add('visible');

    // Get recommended configuration for this browser
    await browserCapabilities.detect();
    const runtimeConfig = browserCapabilities.getRecommendedConfig();

    if (loadingText) {
      loadingText.innerHTML = 'Detecting capabilities... <span class="runtime-info">' +
        (browserCapabilities.hasWebGPU ? 'WebGPU available' : 'Using WASM') + '</span>';
    }

    try {
      // Dynamically import transformers.js from CDN
      if (loadingText) loadingText.textContent = 'Loading AI library...';

      // Import the transformers library from CDN
      const { pipeline, env } = await import('https://cdn.jsdelivr.net/npm/@huggingface/transformers@3.0.0');

      // Configure for browser
      env.allowLocalModels = false;
      env.useBrowserCache = true;

      // Only load LLM if we have a suitable runtime
      if (runtimeConfig.device) {
        if (loadingText) {
          loadingText.innerHTML = 'Loading ' + runtimeConfig.model.split('/')[1] +
            ' <span class="runtime-info">(' + runtimeConfig.label + ')</span>';
        }

        chatState.generator = await pipeline(
          'text-generation',
          runtimeConfig.model,
          {
            dtype: runtimeConfig.dtype,
            device: runtimeConfig.device,
            progress_callback: (progress) => {
              if (progress.status === 'progress') {
                const pct = Math.round((progress.loaded / progress.total) * 100);
                if (loadingText) loadingText.textContent = 'Downloading model: ' + pct + '%';
                if (progressBar) progressBar.style.width = pct + '%';
              }
            }
          }
        );
        chatState.runtime = runtimeConfig.device;
        chatState.modelSize = runtimeConfig.model.includes('360M') ? '360M' : '135M';
      } else {
        chatState.runtime = 'fallback';
      }

      // Also load embedding model for semantic search (works on all runtimes)
      if (loadingText) loadingText.textContent = 'Loading embedding model...';
      if (progressBar) progressBar.style.width = '0%';

      chatState.embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        {
          dtype: 'q8',
          progress_callback: (progress) => {
            if (progress.status === 'progress') {
              const pct = Math.round((progress.loaded / progress.total) * 100);
              if (loadingText) loadingText.textContent = 'Loading embeddings: ' + pct + '%';
              if (progressBar) progressBar.style.width = pct + '%';
            }
          }
        }
      );

      chatState.isModelLoaded = true;
      chatState.isLoading = false;

      statusEl?.classList.remove('visible');
      updateRuntimeBadge();
      if (sendBtn) sendBtn.disabled = !document.querySelector('.chat-input')?.value?.trim();

      const runtimeMsg = chatState.runtime === 'webgpu' ? ' (WebGPU accelerated)' :
                         chatState.runtime === 'wasm' ? ' (WASM runtime)' : '';
      showToast('AI assistant ready!' + runtimeMsg, 'success');
    } catch (error) {
      console.error('Failed to load AI model:', error);
      chatState.isLoading = false;

      // Determine the type of error and respond appropriately
      const errorMsg = error.message || String(error);

      if (errorMsg.includes('NetworkError') || errorMsg.includes('Failed to fetch')) {
        // Network error - might work offline or with retry
        chatState.runtime = 'fallback';
        if (loadingText) loadingText.textContent = 'Network unavailable - using search mode';

        setTimeout(() => {
          statusEl?.classList.remove('visible');
          chatState.isModelLoaded = true;
          updateRuntimeBadge();
          if (sendBtn) sendBtn.disabled = false;
          showToast('Chat ready in offline mode', 'info');
        }, 1500);
      } else if (errorMsg.includes('out of memory') || errorMsg.includes('OOM')) {
        // Memory error - show notice and disable
        chatState.error = 'Not enough memory to load AI model. Try closing other tabs.';
        showChatUnsupportedNotice(chatState.error);
        updateRuntimeBadge();
        statusEl?.classList.remove('visible');
      } else if (errorMsg.includes('WebGPU') || errorMsg.includes('GPU')) {
        // GPU error - fall back to WASM
        chatState.runtime = 'fallback';
        if (loadingText) loadingText.textContent = 'GPU unavailable - using smart search';

        setTimeout(() => {
          statusEl?.classList.remove('visible');
          chatState.isModelLoaded = true;
          updateRuntimeBadge();
          if (sendBtn) sendBtn.disabled = false;
          showToast('Chat ready in search mode', 'info');
        }, 1500);
      } else {
        // Generic fallback
        chatState.runtime = 'fallback';
        if (loadingText) loadingText.textContent = 'Using smart search mode';

        setTimeout(() => {
          statusEl?.classList.remove('visible');
          chatState.isModelLoaded = true;
          updateRuntimeBadge();
          if (sendBtn) sendBtn.disabled = false;
          showToast('Chat ready in search mode', 'info');
        }, 1500);
      }
    }
  }

  function autoResizeTextarea(textarea) {
    textarea.style.height = 'auto';
    textarea.style.height = Math.min(textarea.scrollHeight, 120) + 'px';
  }

  async function sendChatMessage() {
    const input = document.querySelector('.chat-input');
    const sendBtn = document.querySelector('.chat-send');
    const messagesContainer = document.querySelector('.chat-messages');
    const welcomeEl = messagesContainer?.querySelector('.chat-welcome');

    const question = input?.value?.trim();
    if (!question) return;

    // Hide welcome message
    if (welcomeEl) welcomeEl.style.display = 'none';

    // Add user message
    addChatMessage('user', question);
    input.value = '';
    autoResizeTextarea(input);
    sendBtn.disabled = true;

    // Create placeholder for streaming response
    const responseEl = document.createElement('div');
    responseEl.className = 'chat-message assistant streaming';
    responseEl.setAttribute('data-role', 'assistant');
    responseEl.innerHTML = \`
      <div class="chat-message-avatar">
        <svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>
      </div>
      <div class="chat-message-content">
        <div class="streaming-indicator">
          <span class="streaming-dot"></span>
          <span class="streaming-text">Thinking...</span>
        </div>
      </div>
    \`;
    messagesContainer?.appendChild(responseEl);
    messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });

    try {
      // Find relevant context
      const context = await findRelevantContext(question);

      // Update streaming indicator
      const streamingText = responseEl.querySelector('.streaming-text');
      if (streamingText) {
        streamingText.textContent = chatState.generator ? 'Generating response...' : 'Searching documentation...';
      }

      // Generate response
      const response = await generateResponse(question, context);

      // Remove streaming class and indicator
      responseEl.classList.remove('streaming');

      // Stream the response word by word
      const contentEl = responseEl.querySelector('.chat-message-content');
      const fullResponse = response.diagram
        ? response.answer + '\\n\\n**Visual Flow:**\\n\\n\`\`\`mermaid\\n' + response.diagram.diagram + '\`\`\`\\n\\n*Click on any box to navigate to that documentation page.*'
        : response.answer;

      // Build sources HTML with section targeting
      let sourcesHtml = '';
      if (response.sources && response.sources.length > 0) {
        sourcesHtml = '<div class="chat-message-sources"><span class="sources-label">📚 Related docs:</span><div class="sources-list">' +
          response.sources.map(s => {
            // Build URL with section anchor if available
            const url = config.rootPath + s.path + (s.sectionAnchor ? '#' + s.sectionAnchor : '');
            // Display section title if different from page title, otherwise show page title
            const displayTitle = s.sectionTitle && s.sectionTitle !== s.title
              ? s.title + ' → ' + s.sectionTitle
              : s.title;
            const shortDisplay = displayTitle.length > 35 ? displayTitle.slice(0, 32) + '...' : displayTitle;
            return '<a href="' + url + '" class="source-link" title="' + escapeHtml(displayTitle) + '">' +
              '<span class="source-icon">📄</span>' +
              '<span class="source-title">' + escapeHtml(shortDisplay) + '</span>' +
              '</a>';
          }).join('') +
          '</div></div>';
      }

      // Simulate streaming effect
      const words = fullResponse.split(' ');
      let displayed = '';

      for (let i = 0; i < words.length; i++) {
        displayed += (i > 0 ? ' ' : '') + words[i];
        const formattedContent = formatChatContent(displayed, response.sources);
        contentEl.innerHTML = formattedContent + (i === words.length - 1 ? sourcesHtml : '');

        // Scroll to keep new content visible
        messagesContainer?.scrollTo({ top: messagesContainer.scrollHeight, behavior: 'smooth' });

        // Delay between words (faster for longer responses)
        const delay = words.length > 50 ? 8 : 20;
        if (i < words.length - 1) {
          await new Promise(r => setTimeout(r, delay));
        }
      }

      // Save to message history
      chatState.messages.push({ role: 'user', content: question });
      chatState.messages.push({ role: 'assistant', content: response.answer });

    } catch (error) {
      console.error('Chat error:', error);
      responseEl.classList.remove('streaming');
      const contentEl = responseEl.querySelector('.chat-message-content');
      if (contentEl) {
        contentEl.innerHTML = '<p>Sorry, I encountered an error. Please try again.</p>';
      }
    }

    sendBtn.disabled = !chatState.isModelLoaded;
  }

  function addChatMessage(role, content, sources) {
    const messagesContainer = document.querySelector('.chat-messages');
    if (!messagesContainer) return;

    const messageEl = document.createElement('div');
    messageEl.className = 'chat-message ' + role;
    messageEl.setAttribute('data-role', role);

    const avatarIcon = role === 'user'
      ? '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M12 12c2.21 0 4-1.79 4-4s-1.79-4-4-4-4 1.79-4 4 1.79 4 4 4zm0 2c-2.67 0-8 1.34-8 4v2h16v-2c0-2.66-5.33-4-8-4z"/></svg>'
      : '<svg width="14" height="14" viewBox="0 0 24 24" fill="currentColor"><path d="M21 11.5a8.38 8.38 0 01-.9 3.8 8.5 8.5 0 01-7.6 4.7 8.38 8.38 0 01-3.8-.9L3 21l1.9-5.7a8.38 8.38 0 01-.9-3.8 8.5 8.5 0 014.7-7.6 8.38 8.38 0 013.8-.9h.5a8.48 8.48 0 018 8v.5z"/></svg>';

    let sourcesHtml = '';
    if (sources && sources.length > 0) {
      sourcesHtml = '<div class="chat-message-sources"><span class="sources-label">📚 Related docs:</span><div class="sources-list">' +
        sources.map(s =>
          '<a href="' + config.rootPath + s.path + '" class="source-link" title="' + escapeHtml(s.title) + '">' +
          '<span class="source-icon">📄</span>' +
          '<span class="source-title">' + escapeHtml(s.title) + '</span>' +
          '</a>'
        ).join('') +
        '</div></div>';
    }

    // Format content with inline doc links
    const formattedContent = formatChatContent(content, sources);

    messageEl.innerHTML = \`
      <div class="chat-message-avatar">\${avatarIcon}</div>
      <div class="chat-message-content">
        \${formattedContent}
        \${sourcesHtml}
      </div>
    \`;

    // Add click handlers for inline doc links
    messageEl.querySelectorAll('.inline-doc-link').forEach(link => {
      link.addEventListener('click', (e) => {
        // Add a visual feedback before navigation
        link.classList.add('clicked');
      });
    });

    messagesContainer.appendChild(messageEl);

    // Smooth scroll to new message
    requestAnimationFrame(() => {
      messagesContainer.scrollTo({
        top: messagesContainer.scrollHeight,
        behavior: 'smooth'
      });
    });
  }

  function formatChatContent(content, sources) {
    // Extract and process mermaid diagrams BEFORE paragraph handling
    const mermaidPlaceholders = [];
    let processedContent = content.replace(/\`\`\`mermaid\\n([\\s\\S]*?)\`\`\`/g, (match, diagram) => {
      const diagramId = 'chat-diagram-' + Date.now() + '-' + mermaidPlaceholders.length;
      mermaidPlaceholders.push({ id: diagramId, diagram: diagram.trim() });
      return '%%%MERMAID_' + (mermaidPlaceholders.length - 1) + '%%%';
    });

    // Extract other code blocks before paragraph handling
    const codeBlocks = [];
    processedContent = processedContent.replace(/\`\`\`(\\w*)\\n([\\s\\S]*?)\`\`\`/g, (match, lang, code) => {
      codeBlocks.push({ lang, code });
      return '%%%CODE_' + (codeBlocks.length - 1) + '%%%';
    });

    // Now handle paragraphs
    let formatted = processedContent
      .split('\\n\\n')
      .filter(p => p.trim())
      .map(p => '<p>' + p.replace(/\\n/g, '<br>') + '</p>')
      .join('');

    // Restore mermaid diagrams with proper rendering
    mermaidPlaceholders.forEach((item, idx) => {
      // Schedule mermaid rendering after DOM update
      setTimeout(() => {
        const el = document.getElementById(item.id);
        if (el && window.mermaid) {
          try {
            window.mermaid.render(item.id + '-svg', item.diagram).then(result => {
              el.innerHTML = result.svg;
            }).catch(e => {
              console.warn('Mermaid render error:', e);
              el.innerHTML = '<pre>' + item.diagram + '</pre>';
            });
          } catch (e) {
            console.warn('Mermaid render error:', e);
            el.innerHTML = '<pre>' + item.diagram + '</pre>';
          }
        }
      }, 100);
      formatted = formatted.replace('%%%MERMAID_' + idx + '%%%', '<div class="chat-diagram-container"><div class="mermaid" id="' + item.id + '">' + item.diagram + '</div></div>');
    });

    // Restore code blocks
    codeBlocks.forEach((item, idx) => {
      formatted = formatted.replace('%%%CODE_' + idx + '%%%', '<pre><code class="language-' + item.lang + '">' + item.code + '</code></pre>');
    });

    // Inline code
    formatted = formatted.replace(/\`([^\`]+)\`/g, '<code>$1</code>');

    // Markdown links [text](url)
    formatted = formatted.replace(/\\[([^\\]]+)\\]\\(([^)]+)\\)/g, '<a href="$2">$1</a>');

    // Bold and italic
    formatted = formatted
      .replace(/\\*\\*([^*]+)\\*\\*/g, '<strong>$1</strong>')
      .replace(/\\*([^*]+)\\*/g, '<em>$1</em>');

    // Lists
    formatted = formatted.replace(/<p>\\s*[-•]\\s+(.+?)(<\\/p>|<br>)/g, '<li>$1</li>');
    formatted = formatted.replace(/(<li>.*<\\/li>)+/g, '<ul>$&</ul>');

    // Convert wiki page references to clickable links
    if (sources && sources.length > 0 && state.searchIndex) {
      // Create a map of page titles to paths for linking
      const pageLookup = {};
      state.searchIndex.forEach(page => {
        pageLookup[page.title.toLowerCase()] = { path: page.path, title: page.title };
        // Also add without common prefixes
        const shortTitle = page.title.replace(/^(The |A |An )/i, '');
        pageLookup[shortTitle.toLowerCase()] = { path: page.path, title: page.title };
      });

      // Look for potential page references in the content
      Object.keys(pageLookup).forEach(key => {
        if (key.length > 3) { // Only match titles longer than 3 chars
          const page = pageLookup[key];
          const regex = new RegExp('\\\\b(' + escapeRegex(key) + ')\\\\b', 'gi');
          formatted = formatted.replace(regex, (match, p1, offset, string) => {
            // Don't replace if already inside a link or code
            const before = string.substring(Math.max(0, offset - 50), offset);
            if (before.includes('<a ') || before.includes('<code')) return match;
            return '<a href="' + config.rootPath + page.path + '" class="inline-doc-link" title="View: ' + page.title + '">' + p1 + '</a>';
          });
        }
      });
    }

    return formatted;
  }

  // Convert a heading text to an anchor ID (matching how we generate anchors in the wiki)
  function headingToAnchor(heading) {
    return heading
      .toLowerCase()
      .replace(/[^a-z0-9\\s-]/g, '')
      .replace(/\\s+/g, '-')
      .replace(/-+/g, '-')
      .replace(/^-|-$/g, '');
  }

  // Extract the most relevant section heading from content
  function extractRelevantSection(content, query) {
    const headings = content.match(/^#+\\s+(.+)$/gm) || [];
    const queryWords = query.toLowerCase().split(/\\s+/).filter(w => w.length > 2);

    let bestHeading = null;
    let bestScore = 0;

    for (const h of headings) {
      const headingText = h.replace(/^#+\\s+/, '');
      const headingLower = headingText.toLowerCase();
      let score = 0;

      for (const word of queryWords) {
        if (headingLower.includes(word)) score++;
      }

      if (score > bestScore) {
        bestScore = score;
        bestHeading = headingText;
      }
    }

    return bestHeading ? { text: bestHeading, anchor: headingToAnchor(bestHeading) } : null;
  }

  async function findRelevantContext(question) {
    const results = [];
    const questionLower = question.toLowerCase();

    // First try semantic search if embeddings are available
    if (chatState.embedder && chatState.embeddingsIndex?.chunks) {
      try {
        const queryEmb = await chatState.embedder(question, { pooling: 'mean', normalize: true });
        const queryVector = Array.from(queryEmb.data);

        // Calculate similarity with all chunks
        const scored = chatState.embeddingsIndex.chunks.map(chunk => ({
          ...chunk,
          score: cosineSimilarity(queryVector, chunk.embedding)
        }));

        // Sort by score and take top results
        scored.sort((a, b) => b.score - a.score);
        const topChunks = scored.slice(0, 5);

        for (const chunk of topChunks) {
          if (chunk.score > 0.3) { // Relevance threshold
            // Try to extract section anchor for more targeted linking
            const section = extractRelevantSection(chunk.content, question);
            results.push({
              path: chunk.path,
              title: chunk.title,
              content: chunk.content,
              score: chunk.score,
              sectionAnchor: section?.anchor || chunk.sectionAnchor,
              sectionTitle: section?.text || chunk.sectionTitle
            });
          }
        }
      } catch (e) {
        console.warn('Semantic search failed, using keyword fallback:', e);
      }
    }

    // Fallback or supplement with keyword search
    if (results.length < 3 && state.searchIndex) {
      const keywords = questionLower.split(/\\s+/).filter(w => w.length > 2);

      for (const page of state.searchIndex) {
        const contentLower = page.content.toLowerCase();
        const titleLower = page.title.toLowerCase();

        let score = 0;
        let matchedHeading = null;

        for (const kw of keywords) {
          if (titleLower.includes(kw)) score += 3;
          if (contentLower.includes(kw)) score += 1;
          // Check headings and track which one matched best
          for (const h of page.headings) {
            if (h.toLowerCase().includes(kw)) {
              score += 2;
              matchedHeading = h;
            }
          }
        }

        if (score > 0 && !results.some(r => r.path === page.path)) {
          results.push({
            path: page.path,
            title: page.title,
            content: page.content.slice(0, 1500),
            score,
            sectionAnchor: matchedHeading ? headingToAnchor(matchedHeading) : null,
            sectionTitle: matchedHeading
          });
        }
      }

      // Sort by score
      results.sort((a, b) => b.score - a.score);
    }

    return results.slice(0, 5);
  }

  function cosineSimilarity(a, b) {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  // Detect if question is asking for a flow/trace visualization
  function isTraceQuestion(question) {
    const tracePatterns = [
      /how does .+ work/i,
      /what happens when/i,
      /trace .+ flow/i,
      /show .+ flow/i,
      /walk.* through/i,
      /step.* by.* step/i,
      /sequence of/i,
      /data flow/i,
      /call flow/i,
      /explain the flow/i,
      /show me how/i,
      /visualize/i,
      /diagram/i,
      /architecture of/i,
      /components.* interact/i
    ];
    return tracePatterns.some(p => p.test(question));
  }

  // Detect diagram type from question and context
  function detectDiagramType(question, context) {
    const q = question.toLowerCase();

    // Check for sequence/flow indicators
    if (/sequence|step|order|process|workflow|when.+then|after.+before/i.test(q)) {
      return 'sequence';
    }

    // Check for hierarchy/structure indicators
    if (/hierarch|structure|organization|parent|child|inherit|extends/i.test(q)) {
      return 'hierarchy';
    }

    // Check for data flow indicators
    if (/data.+flow|transform|input.+output|pipeline/i.test(q)) {
      return 'dataflow';
    }

    // Default to flowchart
    return 'flowchart';
  }

  // Extract relationships from content
  function extractRelationships(context) {
    const relationships = [];
    const keywords = ['uses', 'calls', 'depends', 'imports', 'extends', 'implements',
                      'sends', 'receives', 'triggers', 'creates', 'returns', 'handles'];

    context.forEach((item, i) => {
      const contentLower = item.content.toLowerCase();
      context.forEach((other, j) => {
        if (i !== j) {
          const otherTitleLower = other.title.toLowerCase();
          const titleWords = otherTitleLower.split(/\\s+/).filter(w => w.length > 3);

          // Check for direct title mentions
          if (contentLower.includes(otherTitleLower) ||
              titleWords.some(word => contentLower.includes(word))) {

            // Try to detect relationship type from context
            let relType = 'uses';
            for (const kw of keywords) {
              const pattern = new RegExp(kw + '.{0,30}' + titleWords[0], 'i');
              if (pattern.test(contentLower)) {
                relType = kw;
                break;
              }
            }

            relationships.push({
              from: i,
              to: j,
              type: relType
            });
          }
        }
      });
    });

    return relationships;
  }

  // Extract a meaningful section title from content chunk
  function extractSectionTitle(content, pageTitle) {
    // Try to find a heading in the content
    const headingMatch = content.match(/^#+\\s+(.+)$/m) || content.match(/^(.{10,50}?)(?:\\n|\\.|:)/);
    if (headingMatch) {
      let heading = headingMatch[1].trim();
      // Clean up markdown formatting
      heading = heading.replace(/[*_#\`]/g, '').trim();
      if (heading.length > 5 && heading.length < 50 && heading !== pageTitle) {
        return heading;
      }
    }

    // Try to extract key concept from first sentence
    const firstSentence = content.split(/[.!?\\n]/)[0].trim();
    if (firstSentence.length > 10 && firstSentence.length < 60) {
      // Extract key noun phrases
      const keyPhrases = firstSentence.match(/(?:the\\s+)?([A-Z][a-z]+(?:\\s+[A-Z]?[a-z]+){0,2})/);
      if (keyPhrases && keyPhrases[1] && keyPhrases[1] !== pageTitle) {
        return keyPhrases[1];
      }
    }

    // Try extracting from code identifiers
    const codeMatch = content.match(/(?:class|function|interface|type|const|export)\\s+([A-Za-z_][A-Za-z0-9_]*)/);
    if (codeMatch && codeMatch[1]) {
      return codeMatch[1];
    }

    return null;
  }

  // Generate a mermaid flowchart from context
  function generateCodemapDiagram(question, context, mode) {
    if (context.length < 2) return null;

    const diagramType = detectDiagramType(question, context);
    const nodes = [];
    const nodeIds = new Map();
    const titleCounts = new Map(); // Track duplicate titles

    // First pass: count title occurrences
    context.forEach(item => {
      const count = titleCounts.get(item.title) || 0;
      titleCounts.set(item.title, count + 1);
    });

    // Create nodes from each context item with unique titles
    const usedTitles = new Map(); // Track index for duplicate titles
    context.forEach((item, i) => {
      const nodeId = 'N' + i;
      let displayTitle = item.title;

      // If this title appears multiple times, try to make it unique
      if (titleCounts.get(item.title) > 1) {
        // Try to extract a section-specific title from content
        const sectionTitle = extractSectionTitle(item.content, item.title);
        if (sectionTitle) {
          displayTitle = sectionTitle;
        } else {
          // Use index suffix to differentiate
          const idx = (usedTitles.get(item.title) || 0) + 1;
          usedTitles.set(item.title, idx);
          // Try to extract key terms from content for better label
          const keyTerms = item.content.match(/\\b([A-Z][a-z]+(?:[A-Z][a-z]+)+)\\b/); // CamelCase
          if (keyTerms) {
            displayTitle = keyTerms[1];
          } else {
            displayTitle = item.title + ' §' + idx;
          }
        }
      }

      // Truncate for display
      const shortTitle = displayTitle.length > 28 ? displayTitle.slice(0, 25) + '...' : displayTitle;

      nodeIds.set(item.path + '_' + i, nodeId);
      nodes.push({
        id: nodeId,
        title: shortTitle,
        path: item.path,
        fullTitle: item.title,
        sectionTitle: displayTitle,
        score: item.score || 0,
        content: item.content
      });
    });

    // Extract relationships using content analysis
    const relationships = extractRelationships(context);

    // Build edges from relationships
    const edges = [];
    const seenEdges = new Set();

    relationships.forEach(rel => {
      const fromId = 'N' + rel.from;
      const toId = 'N' + rel.to;
      const edgeKey = fromId + '-' + toId;

      if (!seenEdges.has(edgeKey)) {
        seenEdges.add(edgeKey);
        edges.push({ from: fromId, to: toId, label: rel.type });
      }
    });

    // If no edges found, create a hub-spoke or sequential pattern
    if (edges.length === 0 && nodes.length >= 2) {
      if (mode === 'codemap' && nodes.length > 3) {
        // In codemap mode with many nodes, use hub-spoke (first node as hub)
        for (let i = 1; i < nodes.length; i++) {
          edges.push({ from: nodes[0].id, to: nodes[i].id, label: '' });
        }
      } else {
        // Sequential flow based on relevance order
        for (let i = 0; i < nodes.length - 1; i++) {
          edges.push({ from: nodes[i].id, to: nodes[i + 1].id, label: '' });
        }
      }
    }

    // Generate mermaid syntax based on diagram type
    let diagram = '';

    if (diagramType === 'sequence' && nodes.length <= 5) {
      // Generate sequence diagram for process flows
      diagram = 'sequenceDiagram\\n';
      diagram += '    autonumber\\n';

      // Create participants
      nodes.forEach(node => {
        diagram += '    participant ' + node.id + ' as ' + node.title + '\\n';
      });

      // Add interactions based on edges
      edges.forEach(edge => {
        const label = edge.label || 'interacts';
        diagram += '    ' + edge.from + '->>' + edge.to + ': ' + label + '\\n';
      });
    } else {
      // Default flowchart
      diagram = 'flowchart TD\\n';

      // Add subgraph if we have many nodes to group by relevance
      if (nodes.length > 4) {
        const highRelevance = nodes.filter(n => n.score > 0.5);
        const lowerRelevance = nodes.filter(n => n.score <= 0.5);

        if (highRelevance.length > 0 && lowerRelevance.length > 0) {
          diagram += '    subgraph Core["Core Components"]\\n';
          highRelevance.forEach(node => {
            diagram += '        ' + node.id + '["' + node.title + '"]\\n';
          });
          diagram += '    end\\n';

          diagram += '    subgraph Related["Related"]\\n';
          lowerRelevance.forEach(node => {
            diagram += '        ' + node.id + '["' + node.title + '"]\\n';
          });
          diagram += '    end\\n';
        } else {
          // Just add all nodes
          nodes.forEach(node => {
            diagram += '    ' + node.id + '["' + node.title + '"]\\n';
          });
        }
      } else {
        // Add nodes directly
        nodes.forEach(node => {
          diagram += '    ' + node.id + '["' + node.title + '"]\\n';
        });
      }

      // Add edges with labels where available
      edges.forEach(edge => {
        if (edge.label && edge.label !== 'uses') {
          diagram += '    ' + edge.from + ' -->|' + edge.label + '| ' + edge.to + '\\n';
        } else {
          diagram += '    ' + edge.from + ' --> ' + edge.to + '\\n';
        }
      });

      // Add click handlers for navigation (flowchart only)
      nodes.forEach(node => {
        diagram += '    click ' + node.id + ' "' + config.rootPath + node.path + '" "' + node.fullTitle + '"\\n';
      });
    }

    return { diagram, nodes, type: diagramType };
  }

  // Format prompt for SmolLM2-Instruct chat template
  function formatChatPrompt(systemPrompt, userQuestion, conversationHistory) {
    let prompt = '<|im_start|>system\\n' + systemPrompt + '<|im_end|>\\n';

    // Add conversation history (last 2 exchanges max for context window)
    const recentHistory = conversationHistory.slice(-4);
    for (const msg of recentHistory) {
      prompt += '<|im_start|>' + msg.role + '\\n' + msg.content + '<|im_end|>\\n';
    }

    prompt += '<|im_start|>user\\n' + userQuestion + '<|im_end|>\\n';
    prompt += '<|im_start|>assistant\\n';

    return prompt;
  }

  // Stream response to UI for better UX
  async function streamResponseToUI(messageEl, responsePromise, sources, codemapDiagram) {
    const contentEl = messageEl.querySelector('.chat-message-content');
    if (!contentEl) return;

    try {
      const result = await responsePromise;
      let fullResponse = result.answer || result;

      // Add diagram if present
      if (codemapDiagram) {
        fullResponse += '\\n\\n**Visual Flow:**\\n\\n\`\`\`mermaid\\n' + codemapDiagram.diagram + '\`\`\`\\n\\n*Click on any box to navigate to that documentation page.*';
      }

      // Simulate streaming by revealing characters progressively
      const words = fullResponse.split(' ');
      let displayed = '';

      for (let i = 0; i < words.length; i++) {
        displayed += (i > 0 ? ' ' : '') + words[i];
        const formattedContent = formatChatContent(displayed, sources);

        // Build sources HTML
        let sourcesHtml = '';
        if (sources && sources.length > 0) {
          sourcesHtml = '<div class="chat-message-sources">Sources: ' +
            sources.map(s => '<a href="' + config.rootPath + s.path + '">' + escapeHtml(s.title) + '</a>').join(', ') +
            '</div>';
        }

        contentEl.innerHTML = formattedContent + sourcesHtml;

        // Scroll to bottom
        const messagesContainer = document.querySelector('.chat-messages');
        if (messagesContainer) {
          messagesContainer.scrollTop = messagesContainer.scrollHeight;
        }

        // Small delay between words for streaming effect
        if (i < words.length - 1) {
          await new Promise(r => setTimeout(r, 15));
        }
      }

      return fullResponse;
    } catch (e) {
      console.error('Streaming error:', e);
      contentEl.innerHTML = '<p>Sorry, I encountered an error generating a response.</p>';
      return null;
    }
  }

  async function generateResponse(question, context) {
    // Map context to sources, including section anchors for targeted linking
    const sources = context.map(c => ({
      path: c.path,
      title: c.title,
      sectionAnchor: c.sectionAnchor || null,
      sectionTitle: c.sectionTitle || null
    }));

    // Determine if we should show visualization based on mode and question type
    const isTraceQ = isTraceQuestion(question);
    let wantsVisualization = false;

    if (chatState.mode === 'codemap') {
      // Always show visualization in codemap mode
      wantsVisualization = true;
    } else if (chatState.mode === 'chat') {
      // Never show visualization in chat mode
      wantsVisualization = false;
    } else {
      // Auto mode: detect based on question
      wantsVisualization = isTraceQ;
    }

    let codemapDiagram = null;

    if (wantsVisualization && context.length >= 2) {
      codemapDiagram = generateCodemapDiagram(question, context, chatState.mode);
    }

    // Build context string - summarize for token efficiency
    const contextText = context.slice(0, 3).map(c => {
      // Truncate content to most relevant portion
      const content = c.content.length > 800 ? c.content.slice(0, 800) + '...' : c.content;
      return '## ' + c.title + '\\n' + content;
    }).join('\\n\\n');

    // If we have the model, use it for real inference
    if (chatState.generator) {
      try {
        const systemPrompt = 'You are a documentation assistant. Answer the user\\'s question directly based on the context below. Provide a clear, informative answer in 2-4 sentences. Do not mention "the documentation" - just answer naturally as if you know the project.\\n\\nContext:\\n' + contextText;

        // Format prompt using SmolLM2 chat template
        const formattedPrompt = formatChatPrompt(
          systemPrompt,
          question,
          chatState.messages
        );

        console.log('Generating response with prompt length:', formattedPrompt.length);

        // Generate with proper parameters for SmolLM2
        const output = await chatState.generator(formattedPrompt, {
          max_new_tokens: 256,
          temperature: 0.7,
          do_sample: true,
          top_p: 0.9,
          repetition_penalty: 1.1,
          return_full_text: false  // Only return the generated part
        });

        let assistantResponse = '';

        if (output && output[0]) {
          // Get generated text
          assistantResponse = output[0].generated_text || '';

          // Clean up response - remove any trailing special tokens
          assistantResponse = assistantResponse
            .replace(/<\\|im_end\\|>/g, '')
            .replace(/<\\|im_start\\|>/g, '')
            .replace(/<\\|endoftext\\|>/g, '')
            .trim();
        }

        if (!assistantResponse || assistantResponse.length < 10) {
          // Model produced empty/short output, use intelligent fallback
          assistantResponse = generateIntelligentFallback(question, context);
        }

        return { answer: assistantResponse, sources, diagram: codemapDiagram };
      } catch (e) {
        console.error('Generation error:', e);
        // Fall through to fallback
      }
    }

    // Intelligent fallback for when model fails or is unavailable
    const fallbackAnswer = generateIntelligentFallback(question, context);
    return { answer: fallbackAnswer, sources, diagram: codemapDiagram };
  }

  // Generate an intelligent response without the LLM
  function generateIntelligentFallback(question, context) {
    if (context.length === 0) {
      return 'I couldn\\'t find specific information about that in the documentation. Try browsing the navigation menu or using the search feature to explore the available content.';
    }

    const questionLower = question.toLowerCase();
    const topResult = context[0];

    // Helper to clean markdown from text
    function cleanMarkdown(text) {
      return text
        .replace(/^#+\\s+[^\\n]*/gm, '') // Remove markdown headers
        .replace(/\\[([^\\]]+)\\]\\([^)]+\\)/g, '$1') // [text](url) -> text
        .replace(/\\*\\*([^*]+)\\*\\*/g, '$1') // **bold** -> bold
        .replace(/\\*([^*]+)\\*/g, '$1') // *italic* -> italic
        .replace(/\\\`([^\\\`]+)\\\`/g, '$1') // \`code\` -> code
        .replace(/\\n{3,}/g, '\\n\\n') // Multiple newlines -> double
        .trim();
    }

    // Extract key terms from the question
    const stopWords = new Set(['the', 'a', 'an', 'is', 'are', 'was', 'were', 'what', 'how', 'why', 'where', 'when', 'which', 'who', 'this', 'that', 'these', 'those', 'and', 'or', 'but', 'in', 'on', 'at', 'to', 'for', 'of', 'with', 'by', 'you', 'do', 'run', 'can', 'does']);
    const questionWords = questionLower
      .replace(/[^a-z0-9\\s]/g, '')
      .split(/\\s+/)
      .filter(w => w.length > 2 && !stopWords.has(w));

    // Clean the content first
    const cleanContent = cleanMarkdown(topResult.content);

    // Split into sentences
    const sentences = cleanContent
      .split(/(?<=[.!?])\\s+/)
      .map(s => s.trim())
      .filter(s => s.length > 15 && s.length < 500);

    // Score sentences by relevance
    const scoredSentences = sentences.map(s => {
      const sLower = s.toLowerCase();
      let score = 0;
      for (const word of questionWords) {
        if (sLower.includes(word)) score += 1;
      }
      return { text: s, score };
    }).sort((a, b) => b.score - a.score);

    // Build answer from best sentences
    let answer = '';
    const relevantSentences = scoredSentences.filter(s => s.score > 0).slice(0, 3);

    if (relevantSentences.length > 0) {
      answer = relevantSentences.map(s => s.text).join(' ');
    } else {
      // No matches - use first few sentences as overview
      answer = sentences.slice(0, 2).join(' ');
    }

    // Ensure answer doesn't end abruptly
    if (answer && !answer.match(/[.!?]$/)) {
      answer += '.';
    }

    // Add source - just the title, clean
    answer += '\\n\\n*Source: ' + topResult.title + '*';

    // Add related pages (skip the first one since we just showed it)
    if (context.length > 1) {
      answer += '\\n\\n**Related pages:**';
      for (let i = 1; i < Math.min(context.length, 4); i++) {
        const ctx = context[i];
        answer += '\\n- ' + ctx.title;
      }
    }

    return answer;
  }

  // SPA-like navigation for chat links
  async function navigateWithSPA(url, linkElement) {
    // Add loading state
    if (linkElement) {
      linkElement.classList.add('loading');
    }

    try {
      const response = await fetch(url);
      if (!response.ok) throw new Error('Failed to fetch page');

      const html = await response.text();
      const parser = new DOMParser();
      const doc = parser.parseFromString(html, 'text/html');

      // Extract the main content
      const newContent = doc.querySelector('.page-content');
      const newTitle = doc.querySelector('.page-title')?.textContent || document.title;
      const currentContent = document.querySelector('.page-content');

      if (newContent && currentContent) {
        // Update the page content
        currentContent.innerHTML = newContent.innerHTML;

        // Update the page title
        document.title = newTitle;

        // Update browser history
        window.history.pushState({ url }, newTitle, url);

        // Scroll main content to top
        document.querySelector('.main-content')?.scrollTo({ top: 0, behavior: 'smooth' });

        // Update active nav item
        document.querySelectorAll('.nav-item').forEach(item => {
          item.classList.remove('active');
          const link = item.querySelector('a');
          if (link && link.href === url) {
            item.classList.add('active');
          }
        });

        // Re-initialize any dynamic features in new content
        if (window.mermaid) {
          document.querySelectorAll('.page-content .mermaid').forEach(el => {
            try {
              window.mermaid.init(undefined, el);
            } catch (e) {
              console.warn('Mermaid init error:', e);
            }
          });
        }

        showToast('Navigated to: ' + newTitle, 'success');
      }
    } catch (error) {
      console.error('SPA navigation error:', error);
      // Fallback to regular navigation
      window.location.href = url;
    } finally {
      if (linkElement) {
        linkElement.classList.remove('loading');
      }
    }
  }

  // Handle browser back/forward
  window.addEventListener('popstate', (e) => {
    if (e.state?.url) {
      navigateWithSPA(e.state.url, null);
    }
  });
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
