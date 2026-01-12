/**
 * Static Site Generator for Architectural Wiki
 *
 * Transforms markdown wiki into an interactive, experiential static site
 * with guided tours, code exploration, and magical onboarding features.
 */

import * as fs from 'fs';
import * as path from 'path';
import matter from 'gray-matter';
import { marked } from 'marked';
import { getTemplates } from './site/templates.js';
import { getStyles } from './site/styles.js';
import { getClientScripts } from './site/scripts.js';
import { pipeline, env } from '@huggingface/transformers';

// Configure transformers.js for embeddings generation
env.cacheDir = './.ted-mosby-models';

export interface SiteGenerationOptions {
  wikiDir: string;
  outputDir: string;
  title?: string;
  description?: string;
  theme?: 'light' | 'dark' | 'auto';
  features?: {
    guidedTour?: boolean;
    codeExplorer?: boolean;
    search?: boolean;
    progressTracking?: boolean;
    keyboardNav?: boolean;
    aiChat?: boolean;
  };
  repoUrl?: string;
  repoPath?: string;
}

export interface WikiPage {
  path: string;
  relativePath: string;
  title: string;
  description?: string;
  content: string;
  htmlContent: string;
  frontmatter: Record<string, any>;
  sources?: string[];
  related?: string[];
  headings: Array<{ level: number; text: string; id: string }>;
  codeBlocks: Array<{ language: string; code: string; sourceRef?: string }>;
  mermaidDiagrams: string[];
}

export interface SiteNavigation {
  sections: Array<{
    title: string;
    path: string;
    pages: Array<{
      title: string;
      path: string;
      description?: string;
    }>;
  }>;
}

export interface OnboardingStep {
  id: string;
  title: string;
  description: string;
  targetSelector: string;
  page?: string;
  position?: 'top' | 'bottom' | 'left' | 'right';
}

export interface GuidedTour {
  id: string;
  name: string;
  description: string;
  steps: OnboardingStep[];
}

export interface SiteManifest {
  title: string;
  description: string;
  generated: string;
  pages: Array<{
    path: string;
    title: string;
    description?: string;
  }>;
  navigation: SiteNavigation;
  tours: GuidedTour[];
  searchIndex: Array<{
    path: string;
    title: string;
    content: string;
    headings: string[];
  }>;
}

export class SiteGenerator {
  private options: Required<SiteGenerationOptions>;
  private pages: WikiPage[] = [];
  private navigation: SiteNavigation = { sections: [] };
  private tours: GuidedTour[] = [];
  private mermaidPlaceholders: Map<string, string> = new Map();

  constructor(options: SiteGenerationOptions) {
    // Extract codebase name from wiki directory or use provided title
    const codebaseName = options.title || this.extractCodebaseName(options.wikiDir);

    this.options = {
      wikiDir: path.resolve(options.wikiDir),
      outputDir: path.resolve(options.outputDir),
      title: `👻 ${codebaseName}`,
      description: options.description || 'Interactive architectural documentation',
      theme: options.theme || 'auto',
      features: {
        guidedTour: true,
        codeExplorer: true,
        search: true,
        progressTracking: true,
        keyboardNav: true,
        aiChat: true,
        ...options.features
      },
      repoUrl: options.repoUrl || '',
      repoPath: options.repoPath || ''
    };

    this.configureMarked();
  }

  /**
   * Extract codebase name from wiki directory path
   * Looks for parent directory name or uses wiki folder name
   */
  private extractCodebaseName(wikiDir: string): string {
    const resolved = path.resolve(wikiDir);
    const parts = resolved.split(path.sep);

    // If wiki is in a 'wiki' or 'docs' folder, use parent name
    const lastPart = parts[parts.length - 1];
    if (lastPart.toLowerCase() === 'wiki' || lastPart.toLowerCase() === 'docs' || lastPart.toLowerCase() === '.wiki') {
      return parts[parts.length - 2] || 'Architecture Wiki';
    }

    // Otherwise use the folder name
    return lastPart || 'Architecture Wiki';
  }

  /**
   * Configure marked with custom renderers for enhanced features
   */
  private configureMarked(): void {
    const renderer = new marked.Renderer();

    // Enhanced code block rendering with copy button and source links
    renderer.code = (code: string, language?: string) => {
      const lang = language || 'text';
      const escapedCode = this.escapeHtml(code);

      // Check for source reference in the code block
      const sourceMatch = code.match(/^\/\/\s*Source:\s*(.+)$/m) ||
                          code.match(/^#\s*Source:\s*(.+)$/m);
      const sourceRef = sourceMatch ? sourceMatch[1].trim() : '';

      return `
        <div class="code-block" data-language="${lang}">
          <div class="code-header">
            <span class="code-language">${lang}</span>
            ${sourceRef ? `<a href="#" class="code-source" data-source="${sourceRef}">${sourceRef}</a>` : ''}
            <button class="code-copy" title="Copy code">
              <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
                <rect x="9" y="9" width="13" height="13" rx="2" ry="2"></rect>
                <path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"></path>
              </svg>
            </button>
          </div>
          <pre><code class="language-${lang}">${escapedCode}</code></pre>
        </div>
      `;
    };

    // Enhanced heading rendering with anchor links
    renderer.heading = (text: string, level: number) => {
      const id = this.slugify(text);
      return `
        <h${level} id="${id}" class="heading-anchor">
          <a href="#${id}" class="anchor-link" aria-hidden="true">#</a>
          ${text}
        </h${level}>
      `;
    };

    // Enhanced link rendering
    renderer.link = (href: string, title: string | null | undefined, text: string) => {
      const isExternal = href.startsWith('http://') || href.startsWith('https://');
      const isSourceLink = href.includes(':') && !isExternal && href.match(/\.(ts|js|py|go|rs|java|rb|php|c|cpp|swift):/);

      if (isSourceLink) {
        return `<a href="#" class="source-link" data-source="${href}" title="${title || 'View source'}">${text}</a>`;
      }

      if (isExternal) {
        return `<a href="${href}" title="${title || ''}" target="_blank" rel="noopener noreferrer" class="external-link">${text}<svg class="external-icon" width="12" height="12" viewBox="0 0 24 24"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6M15 3h6v6M10 14L21 3" stroke="currentColor" stroke-width="2" fill="none"/></svg></a>`;
      }

      // Convert .md links to .html
      const htmlHref = href.replace(/\.md(#.*)?$/, '.html$1');
      return `<a href="${htmlHref}" title="${title || ''}" class="internal-link">${text}</a>`;
    };

    // Enhanced image rendering
    renderer.image = (href: string, title: string | null, text: string) => {
      return `
        <figure class="image-figure">
          <img src="${href}" alt="${text}" title="${title || ''}" loading="lazy" />
          ${title ? `<figcaption>${title}</figcaption>` : ''}
        </figure>
      `;
    };

    // Enhanced blockquote rendering (for callouts)
    renderer.blockquote = (quote: string) => {
      // Check for callout type markers
      const calloutMatch = quote.match(/^\s*\[!(NOTE|TIP|IMPORTANT|WARNING|CAUTION)\]/i);
      if (calloutMatch) {
        const type = calloutMatch[1].toLowerCase();
        const content = quote.replace(calloutMatch[0], '').trim();
        return `<div class="callout callout-${type}"><div class="callout-title">${calloutMatch[1]}</div><div class="callout-content">${content}</div></div>`;
      }
      return `<blockquote>${quote}</blockquote>`;
    };

    marked.use({ renderer });
  }

  /**
   * Generate the complete static site
   */
  async generate(): Promise<void> {
    console.log('🌐 Generating static site...');

    // Step 1: Discover and parse all wiki pages
    await this.discoverPages();
    console.log(`  Found ${this.pages.length} wiki pages`);

    // Step 2: Build navigation structure
    this.buildNavigation();

    // Step 3: Generate guided tours from content analysis
    if (this.options.features.guidedTour) {
      this.generateTours();
    }

    // Step 4: Create output directory structure
    this.createOutputDirs();

    // Step 5: Write static assets (CSS, JS)
    await this.writeAssets();

    // Step 6: Generate HTML pages
    await this.generatePages();

    // Step 7: Generate site manifest for client-side features
    await this.generateManifest();

    // Step 8: Generate embeddings index for AI chat (if enabled)
    if (this.options.features.aiChat) {
      await this.generateEmbeddingsIndex();
    }

    console.log(`✅ Static site generated at: ${this.options.outputDir}`);
  }

  /**
   * Discover and parse all markdown files in the wiki directory
   */
  private async discoverPages(): Promise<void> {
    const files = this.findMarkdownFiles(this.options.wikiDir);

    for (const filePath of files) {
      const page = await this.parsePage(filePath);
      if (page) {
        this.pages.push(page);
      }
    }

    // Sort pages: README first, then alphabetically
    this.pages.sort((a, b) => {
      if (a.relativePath === 'README.md') return -1;
      if (b.relativePath === 'README.md') return 1;
      return a.relativePath.localeCompare(b.relativePath);
    });
  }

  /**
   * Recursively find all markdown files
   */
  private findMarkdownFiles(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) return files;

    const entries = fs.readdirSync(dir, { withFileTypes: true });

    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);

      if (entry.isDirectory()) {
        // Skip hidden directories and cache
        if (!entry.name.startsWith('.') && entry.name !== 'node_modules') {
          files.push(...this.findMarkdownFiles(fullPath));
        }
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Parse a single markdown page
   */
  private async parsePage(filePath: string): Promise<WikiPage | null> {
    try {
      const content = fs.readFileSync(filePath, 'utf-8');
      const { data: frontmatter, content: markdownContent } = matter(content);

      const relativePath = path.relative(this.options.wikiDir, filePath);

      // Extract title from frontmatter or first H1
      const extractedTitle = this.extractTitle(markdownContent);
      const title = frontmatter.title || extractedTitle || path.basename(filePath, '.md');

      // Always remove the first H1 if it exists and matches the title to prevent duplication
      // The title will be displayed in the page header template regardless of source
      let contentWithoutTitle = markdownContent;
      if (extractedTitle) {
        // Normalize both titles for comparison (case-insensitive, trim whitespace)
        const normalizedFrontmatter = (frontmatter.title || '').toLowerCase().trim();
        const normalizedExtracted = extractedTitle.toLowerCase().trim();

        // Remove H1 if:
        // 1. No frontmatter title exists (extracted becomes title), OR
        // 2. Frontmatter title matches extracted H1 (duplicate), OR
        // 3. Extracted H1 is present (template will handle title display)
        if (!frontmatter.title || normalizedFrontmatter === normalizedExtracted || extractedTitle) {
          // Remove the first H1 line from content (including any trailing newlines)
          contentWithoutTitle = markdownContent.replace(/^#\s+[^\n]+\n*/, '');
        }
      }

      // Extract headings (after potentially removing title)
      const headings = this.extractHeadings(contentWithoutTitle);

      // Extract code blocks
      const codeBlocks = this.extractCodeBlocks(contentWithoutTitle);

      // Extract mermaid diagrams
      const mermaidDiagrams = this.extractMermaidDiagrams(contentWithoutTitle);

      // Process mermaid blocks before markdown conversion (replaces with placeholders)
      const processedMarkdown = this.processMermaidBlocks(contentWithoutTitle);

      // Convert markdown to HTML
      const parsedHtml = await marked.parse(processedMarkdown);

      // Restore mermaid diagrams after markdown processing to preserve their syntax
      const htmlContent = this.restoreMermaidBlocks(parsedHtml);

      return {
        path: filePath,
        relativePath,
        title,
        description: frontmatter.description,
        content: contentWithoutTitle,
        htmlContent,
        frontmatter,
        sources: frontmatter.sources,
        related: frontmatter.related,
        headings,
        codeBlocks,
        mermaidDiagrams
      };
    } catch (error) {
      console.error(`Failed to parse ${filePath}:`, error);
      return null;
    }
  }

  /**
   * Extract headings from markdown content
   */
  private extractHeadings(content: string): Array<{ level: number; text: string; id: string }> {
    const headings: Array<{ level: number; text: string; id: string }> = [];
    const regex = /^(#{1,6})\s+(.+)$/gm;

    let match;
    while ((match = regex.exec(content)) !== null) {
      const level = match[1].length;
      const text = match[2].trim();
      headings.push({
        level,
        text,
        id: this.slugify(text)
      });
    }

    return headings;
  }

  /**
   * Extract code blocks from markdown
   */
  private extractCodeBlocks(content: string): Array<{ language: string; code: string; sourceRef?: string }> {
    const blocks: Array<{ language: string; code: string; sourceRef?: string }> = [];
    const regex = /```(\w*)\n([\s\S]*?)```/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      const language = match[1] || 'text';
      const code = match[2];

      // Skip mermaid blocks
      if (language === 'mermaid') continue;

      // Look for source reference
      const sourceMatch = code.match(/(?:\/\/|#)\s*Source:\s*(.+)/);

      blocks.push({
        language,
        code,
        sourceRef: sourceMatch ? sourceMatch[1].trim() : undefined
      });
    }

    return blocks;
  }

  /**
   * Extract mermaid diagram definitions
   */
  private extractMermaidDiagrams(content: string): string[] {
    const diagrams: string[] = [];
    const regex = /```mermaid\n([\s\S]*?)```/g;

    let match;
    while ((match = regex.exec(content)) !== null) {
      diagrams.push(match[1].trim());
    }

    return diagrams;
  }

  /**
   * Process mermaid blocks by replacing them with placeholders before markdown processing.
   * This prevents marked from corrupting the mermaid diagram syntax.
   */
  private processMermaidBlocks(content: string): string {
    this.mermaidPlaceholders.clear();
    let diagramIndex = 0;

    return content.replace(/```mermaid\n([\s\S]*?)```/g, (_, diagram) => {
      const id = `mermaid-${diagramIndex++}`;
      const placeholder = `MERMAID_PLACEHOLDER_${id}_END`;

      // Store the original diagram content with its HTML wrapper
      this.mermaidPlaceholders.set(placeholder, `<div class="mermaid-container" id="${id}">
        <div class="mermaid">${diagram.trim()}</div>
        <button class="mermaid-fullscreen" title="Fullscreen" data-diagram="${id}">
          <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
            <path d="M8 3H5a2 2 0 0 0-2 2v3m18 0V5a2 2 0 0 0-2-2h-3m0 18h3a2 2 0 0 0 2-2v-3M3 16v3a2 2 0 0 0 2 2h3"/>
          </svg>
        </button>
      </div>`);

      return placeholder;
    });
  }

  /**
   * Restore mermaid diagrams after markdown processing
   */
  private restoreMermaidBlocks(html: string): string {
    let result = html;
    for (const [placeholder, diagram] of this.mermaidPlaceholders) {
      // The placeholder might be wrapped in <p> tags by marked, so handle both cases
      result = result.replace(new RegExp(`<p>${placeholder}</p>`, 'g'), diagram);
      result = result.replace(new RegExp(placeholder, 'g'), diagram);
    }
    return result;
  }

  /**
   * Extract title from first H1 heading
   */
  private extractTitle(content: string): string | null {
    const match = content.match(/^#\s+(.+)$/m);
    return match ? match[1].trim() : null;
  }

  /**
   * Build navigation structure from pages
   */
  private buildNavigation(): void {
    const sections = new Map<string, Array<{ title: string; path: string; description?: string }>>();

    for (const page of this.pages) {
      const parts = page.relativePath.split(path.sep);
      const section = parts.length > 1 ? parts[0] : 'Overview';
      const htmlPath = page.relativePath.replace(/\.md$/, '.html');

      if (!sections.has(section)) {
        sections.set(section, []);
      }

      sections.get(section)!.push({
        title: page.title,
        path: htmlPath,
        description: page.description
      });
    }

    // Define section order
    const sectionOrder = ['Overview', 'architecture', 'components', 'guides', 'api', 'reference'];

    this.navigation.sections = Array.from(sections.entries())
      .sort((a, b) => {
        const aIndex = sectionOrder.indexOf(a[0]);
        const bIndex = sectionOrder.indexOf(b[0]);
        if (aIndex === -1 && bIndex === -1) return a[0].localeCompare(b[0]);
        if (aIndex === -1) return 1;
        if (bIndex === -1) return -1;
        return aIndex - bIndex;
      })
      .map(([title, pages]) => ({
        title: this.formatSectionTitle(title),
        path: pages[0]?.path || '',
        pages
      }));
  }

  /**
   * Format section title for display
   */
  private formatSectionTitle(title: string): string {
    return title
      .split('-')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Generate guided tours based on content analysis
   */
  private generateTours(): void {
    // Architecture Overview Tour
    const architectureTour: GuidedTour = {
      id: 'architecture-overview',
      name: 'Architecture Overview',
      description: 'Get a bird\'s-eye view of the system architecture',
      steps: []
    };

    // Find architecture pages and create tour steps
    const archPages = this.pages.filter(p =>
      p.relativePath.includes('architecture') ||
      p.relativePath === 'README.md'
    );

    for (const page of archPages.slice(0, 5)) {
      architectureTour.steps.push({
        id: `arch-${this.slugify(page.title)}`,
        title: page.title,
        description: page.description || `Learn about ${page.title}`,
        targetSelector: '.main-content',
        page: page.relativePath.replace(/\.md$/, '.html')
      });
    }

    if (architectureTour.steps.length > 0) {
      this.tours.push(architectureTour);
    }

    // Getting Started Tour
    const gettingStartedTour: GuidedTour = {
      id: 'getting-started',
      name: 'Getting Started',
      description: 'Quick introduction to navigating this documentation',
      steps: [
        {
          id: 'welcome',
          title: 'Welcome!',
          description: 'This is your interactive architecture wiki. Let\'s take a quick tour!',
          targetSelector: '.site-header',
          position: 'bottom'
        },
        {
          id: 'navigation',
          title: 'Navigation',
          description: 'Use the sidebar to browse different sections of the documentation.',
          targetSelector: '.sidebar-nav',
          position: 'right'
        },
        {
          id: 'search',
          title: 'Quick Search',
          description: 'Press "/" or click here to search across all documentation.',
          targetSelector: '.search-trigger',
          position: 'bottom'
        },
        {
          id: 'code-blocks',
          title: 'Interactive Code',
          description: 'Code blocks are syntax highlighted. Click the copy button or source link to explore.',
          targetSelector: '.code-block',
          position: 'top'
        },
        {
          id: 'diagrams',
          title: 'Architecture Diagrams',
          description: 'Diagrams are interactive! Click to zoom, or use fullscreen mode.',
          targetSelector: '.mermaid-container',
          position: 'top'
        },
        {
          id: 'progress',
          title: 'Track Your Progress',
          description: 'Your reading progress is saved. Pages you\'ve visited are marked in the sidebar.',
          targetSelector: '.progress-indicator',
          position: 'left'
        }
      ]
    };

    this.tours.push(gettingStartedTour);

    // Component Deep Dive Tour
    const componentPages = this.pages.filter(p => p.relativePath.includes('component'));
    if (componentPages.length > 0) {
      const componentTour: GuidedTour = {
        id: 'component-deep-dive',
        name: 'Component Deep Dive',
        description: 'Explore the core components of the system',
        steps: componentPages.slice(0, 8).map(page => ({
          id: `comp-${this.slugify(page.title)}`,
          title: page.title,
          description: page.description || `Understand the ${page.title} component`,
          targetSelector: '.main-content',
          page: page.relativePath.replace(/\.md$/, '.html')
        }))
      };
      this.tours.push(componentTour);
    }
  }

  /**
   * Create output directory structure
   */
  private createOutputDirs(): void {
    if (!fs.existsSync(this.options.outputDir)) {
      fs.mkdirSync(this.options.outputDir, { recursive: true });
    }

    // Create subdirectories for pages
    const dirs = new Set<string>();
    for (const page of this.pages) {
      const dir = path.dirname(page.relativePath);
      if (dir !== '.') {
        dirs.add(dir);
      }
    }

    for (const dir of dirs) {
      const fullPath = path.join(this.options.outputDir, dir);
      if (!fs.existsSync(fullPath)) {
        fs.mkdirSync(fullPath, { recursive: true });
      }
    }

    // Create assets directory
    const assetsDir = path.join(this.options.outputDir, 'assets');
    if (!fs.existsSync(assetsDir)) {
      fs.mkdirSync(assetsDir, { recursive: true });
    }
  }

  /**
   * Write static assets (CSS, JS)
   */
  private async writeAssets(): Promise<void> {
    const assetsDir = path.join(this.options.outputDir, 'assets');

    // Write CSS
    const styles = getStyles();
    fs.writeFileSync(path.join(assetsDir, 'styles.css'), styles);

    // Write JavaScript
    const scripts = getClientScripts(this.options.features);
    fs.writeFileSync(path.join(assetsDir, 'app.js'), scripts);

    console.log('  Wrote static assets');
  }

  /**
   * Generate HTML pages
   */
  private async generatePages(): Promise<void> {
    const templates = getTemplates();

    for (const page of this.pages) {
      const htmlPath = page.relativePath.replace(/\.md$/, '.html');
      const outputPath = path.join(this.options.outputDir, htmlPath);

      // Calculate relative path to root for asset links
      const depth = page.relativePath.split(path.sep).length - 1;
      const rootPath = depth > 0 ? '../'.repeat(depth) : './';

      // Generate table of contents
      const toc = this.generateTOC(page.headings);

      // Generate breadcrumbs
      const breadcrumbs = this.generateBreadcrumbs(page.relativePath);

      // Generate related pages section
      const relatedPages = this.generateRelatedPages(page);

      // Build the full HTML page
      const html = templates.page({
        title: page.title,
        siteTitle: this.options.title,
        description: page.description || this.options.description,
        content: page.htmlContent,
        toc,
        breadcrumbs,
        relatedPages,
        navigation: this.navigation,
        rootPath,
        currentPath: htmlPath,
        features: this.options.features,
        theme: this.options.theme
      });

      fs.writeFileSync(outputPath, html);
    }

    // Generate index.html (redirect to README.html or first page)
    const indexPage = this.pages.find(p => p.relativePath === 'README.md') || this.pages[0];
    if (indexPage) {
      const indexHtml = `<!DOCTYPE html>
<html>
<head>
  <meta charset="utf-8">
  <meta http-equiv="refresh" content="0; url=${indexPage.relativePath.replace(/\.md$/, '.html')}">
  <title>${this.options.title}</title>
</head>
<body>
  <p>Redirecting to <a href="${indexPage.relativePath.replace(/\.md$/, '.html')}">${indexPage.title}</a>...</p>
</body>
</html>`;
      fs.writeFileSync(path.join(this.options.outputDir, 'index.html'), indexHtml);
    }

    console.log(`  Generated ${this.pages.length} HTML pages`);
  }

  /**
   * Generate table of contents from headings
   */
  private generateTOC(headings: Array<{ level: number; text: string; id: string }>): string {
    if (headings.length === 0) return '';

    // Filter to h2 and h3 only for cleaner TOC
    const tocHeadings = headings.filter(h => h.level >= 2 && h.level <= 3);
    if (tocHeadings.length < 2) return '';

    let html = '<nav class="toc"><h3 class="toc-title">On This Page</h3><ul class="toc-list">';

    for (const heading of tocHeadings) {
      const indent = heading.level - 2;
      html += `<li class="toc-item toc-level-${indent}"><a href="#${heading.id}">${heading.text}</a></li>`;
    }

    html += '</ul></nav>';
    return html;
  }

  /**
   * Generate breadcrumb navigation
   */
  private generateBreadcrumbs(relativePath: string): string {
    const parts = relativePath.split(path.sep);
    if (parts.length === 1) return '';

    let html = '<nav class="breadcrumbs" aria-label="Breadcrumb"><ol>';
    let currentPath = '';

    // Add home link
    html += `<li><a href="${'../'.repeat(parts.length - 1)}index.html">Home</a></li>`;

    for (let i = 0; i < parts.length - 1; i++) {
      currentPath += parts[i] + '/';
      html += `<li><a href="${'../'.repeat(parts.length - 1 - i)}${currentPath}index.html">${this.formatSectionTitle(parts[i])}</a></li>`;
    }

    // Current page (not a link)
    const page = this.pages.find(p => p.relativePath === relativePath);
    html += `<li aria-current="page">${page?.title || parts[parts.length - 1]}</li>`;

    html += '</ol></nav>';
    return html;
  }

  /**
   * Generate related pages section
   */
  private generateRelatedPages(page: WikiPage): string {
    const related: WikiPage[] = [];

    // Add explicitly related pages
    if (page.related) {
      for (const relPath of page.related) {
        const relPage = this.pages.find(p => p.relativePath === relPath || p.relativePath === relPath + '.md');
        if (relPage) related.push(relPage);
      }
    }

    // Add pages in same section
    const section = path.dirname(page.relativePath);
    if (section !== '.') {
      const sectionPages = this.pages.filter(p =>
        path.dirname(p.relativePath) === section &&
        p.relativePath !== page.relativePath
      );
      for (const sp of sectionPages.slice(0, 3)) {
        if (!related.includes(sp)) related.push(sp);
      }
    }

    if (related.length === 0) return '';

    let html = '<aside class="related-pages"><h3>Related Pages</h3><ul>';

    for (const rp of related.slice(0, 5)) {
      const href = this.getRelativeLink(page.relativePath, rp.relativePath);
      html += `<li><a href="${href}">${rp.title}</a>${rp.description ? `<span class="related-desc">${rp.description}</span>` : ''}</li>`;
    }

    html += '</ul></aside>';
    return html;
  }

  /**
   * Get relative link between two pages
   */
  private getRelativeLink(fromPath: string, toPath: string): string {
    const fromDir = path.dirname(fromPath);
    const toHtml = toPath.replace(/\.md$/, '.html');

    if (fromDir === '.') {
      return toHtml;
    }

    const depth = fromDir.split(path.sep).length;
    return '../'.repeat(depth) + toHtml;
  }

  /**
   * Generate site manifest for client-side features
   */
  private async generateManifest(): Promise<void> {
    const manifest: SiteManifest = {
      title: this.options.title,
      description: this.options.description,
      generated: new Date().toISOString(),
      pages: this.pages.map(p => ({
        path: p.relativePath.replace(/\.md$/, '.html'),
        title: p.title,
        description: p.description
      })),
      navigation: this.navigation,
      tours: this.tours,
      searchIndex: this.pages.map(p => ({
        path: p.relativePath.replace(/\.md$/, '.html'),
        title: p.title,
        content: this.stripMarkdown(p.content).slice(0, 5000), // Limit for performance
        headings: p.headings.map(h => h.text)
      }))
    };

    fs.writeFileSync(
      path.join(this.options.outputDir, 'manifest.json'),
      JSON.stringify(manifest, null, 2)
    );

    console.log('  Generated site manifest');
  }

  /**
   * Generate embeddings index for AI chat feature
   * Creates pre-computed embeddings for faster semantic search in the browser
   */
  private async generateEmbeddingsIndex(): Promise<void> {
    console.log('  Generating embeddings index for AI chat...');

    try {
      // Load embedding model
      const embedder = await pipeline(
        'feature-extraction',
        'Xenova/all-MiniLM-L6-v2',
        { dtype: 'fp32' }
      );

      // Chunk wiki content for embedding
      const chunks: Array<{
        path: string;
        title: string;
        content: string;
        embedding: number[];
      }> = [];

      for (const page of this.pages) {
        // Split content into semantic chunks (800 chars for more context while staying focused)
        const pageChunks = this.chunkContent(page.content, 800, 0);
        const htmlPath = page.relativePath.replace(/\.md$/, '.html');

        for (const chunkContent of pageChunks) {
          // Generate embedding
          const output = await embedder(chunkContent, { pooling: 'mean', normalize: true });
          const embedding = Array.from(output.data as Float32Array);

          chunks.push({
            path: htmlPath,
            title: page.title,
            content: chunkContent,
            embedding
          });
        }

        // Progress indicator
        const idx = this.pages.indexOf(page);
        if ((idx + 1) % 5 === 0 || idx === this.pages.length - 1) {
          console.log(`    Embedded ${idx + 1}/${this.pages.length} pages (${chunks.length} chunks)`);
        }
      }

      // Save embeddings index
      const embeddingsIndex = {
        model: 'Xenova/all-MiniLM-L6-v2',
        dimension: 384,
        generated: new Date().toISOString(),
        chunks
      };

      fs.writeFileSync(
        path.join(this.options.outputDir, 'embeddings-index.json'),
        JSON.stringify(embeddingsIndex)
      );

      console.log(`  Generated embeddings index with ${chunks.length} chunks`);
    } catch (error) {
      console.warn('  Warning: Could not generate embeddings index:', error);
      console.log('  AI chat will use keyword search fallback');
    }
  }

  /**
   * Chunk content into semantic pieces for better embedding retrieval
   * Uses paragraph and section boundaries instead of arbitrary character counts
   */
  private chunkContent(content: string, chunkSize: number, overlap: number): string[] {
    const chunks: string[] = [];

    // Split by headers first to preserve section context
    const sections = content.split(/(?=^#{1,3}\s)/m);

    for (const section of sections) {
      if (!section.trim()) continue;

      // Extract section header if present
      const headerMatch = section.match(/^(#{1,3}\s+.+?)(?:\n|$)/);
      const header = headerMatch ? headerMatch[1].replace(/^#+\s*/, '').trim() : '';
      const sectionContent = headerMatch ? section.slice(headerMatch[0].length) : section;

      // Split section into paragraphs
      const paragraphs = sectionContent.split(/\n\n+/).filter(p => p.trim().length > 30);

      let currentChunk = header ? `[${header}] ` : '';
      let currentLength = currentChunk.length;

      for (const para of paragraphs) {
        const strippedPara = this.stripMarkdown(para).trim();

        // If adding this paragraph would exceed chunk size, save current and start new
        if (currentLength + strippedPara.length > chunkSize && currentChunk.length > 50) {
          chunks.push(currentChunk.trim());
          // Start new chunk with section context
          currentChunk = header ? `[${header}] ` : '';
          currentLength = currentChunk.length;
        }

        currentChunk += strippedPara + ' ';
        currentLength += strippedPara.length + 1;
      }

      // Don't forget the last chunk
      if (currentChunk.trim().length > 50) {
        chunks.push(currentChunk.trim());
      }
    }

    // If content had no clear sections, fall back to sentence-based chunking
    if (chunks.length === 0) {
      const stripped = this.stripMarkdown(content);
      const sentences = stripped.split(/(?<=[.!?])\s+/);
      let currentChunk = '';

      for (const sentence of sentences) {
        if (currentChunk.length + sentence.length > chunkSize && currentChunk.length > 50) {
          chunks.push(currentChunk.trim());
          currentChunk = '';
        }
        currentChunk += sentence + ' ';
      }

      if (currentChunk.trim().length > 50) {
        chunks.push(currentChunk.trim());
      }
    }

    return chunks;
  }

  /**
   * Strip markdown formatting from content
   */
  private stripMarkdown(content: string): string {
    return content
      .replace(/```[\s\S]*?```/g, '') // Remove code blocks
      .replace(/`[^`]+`/g, '') // Remove inline code
      .replace(/\[([^\]]+)\]\([^)]+\)/g, '$1') // Remove links
      .replace(/[*_~]+/g, '') // Remove emphasis
      .replace(/^#+\s*/gm, '') // Remove headings
      .replace(/\n{3,}/g, '\n\n') // Normalize newlines
      .trim();
  }

  /**
   * Create URL-safe slug from text
   */
  private slugify(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^\w\s-]/g, '')
      .replace(/\s+/g, '-')
      .replace(/-+/g, '-')
      .trim();
  }

  /**
   * Escape HTML entities
   */
  private escapeHtml(text: string): string {
    return text
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#039;');
  }
}
