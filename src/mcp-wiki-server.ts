/**
 * MCP Server for querying SemanticWiki generated documentation
 *
 * This server exposes tools for:
 * - Searching wiki pages by keyword or semantic similarity
 * - Getting wiki page content
 * - Asking questions about the codebase using RAG
 * - Getting codebase structure overview
 */

import { Server } from '@modelcontextprotocol/sdk/server/index.js';
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import {
  CallToolRequestSchema,
  ListToolsRequestSchema,
  ListResourcesRequestSchema,
  ReadResourceRequestSchema,
} from '@modelcontextprotocol/sdk/types.js';
import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import matter from 'gray-matter';
import { RAGSystem, type SearchResult, type SearchOptions } from './rag/index.js';

interface WikiPage {
  path: string;
  title: string;
  description?: string;
  category?: string;
  content: string;
  headings: string[];
  frontmatter: Record<string, any>;
}

interface WikiServerConfig {
  wikiPath: string;
  ragStorePath?: string;
  repoPath?: string;
}

export class WikiMCPServer {
  private server: Server;
  private config: WikiServerConfig;
  private wikiPages: Map<string, WikiPage> = new Map();
  private ragSystem: RAGSystem | null = null;
  private searchIndex: Map<string, Set<string>> = new Map(); // keyword -> page paths

  constructor(config: WikiServerConfig) {
    this.config = config;
    this.server = new Server(
      {
        name: 'semanticwiki',
        version: '1.0.0',
      },
      {
        capabilities: {
          tools: {},
          resources: {},
        },
      }
    );

    this.setupHandlers();
  }

  private async loadWikiPages(): Promise<void> {
    const wikiPath = this.config.wikiPath;

    if (!fs.existsSync(wikiPath)) {
      console.error(`Wiki path does not exist: ${wikiPath}`);
      return;
    }

    const mdFiles = await glob('**/*.md', { cwd: wikiPath });

    for (const file of mdFiles) {
      const fullPath = path.join(wikiPath, file);
      const content = fs.readFileSync(fullPath, 'utf-8');
      const { data: frontmatter, content: body } = matter(content);

      // Extract headings
      const headings: string[] = [];
      const headingRegex = /^#{1,6}\s+(.+)$/gm;
      let match;
      while ((match = headingRegex.exec(body)) !== null) {
        headings.push(match[1]);
      }

      const page: WikiPage = {
        path: file,
        title: frontmatter.title || path.basename(file, '.md'),
        description: frontmatter.description,
        category: frontmatter.category,
        content: body,
        headings,
        frontmatter,
      };

      this.wikiPages.set(file, page);

      // Build search index
      const keywords = this.extractKeywords(page);
      for (const keyword of keywords) {
        if (!this.searchIndex.has(keyword)) {
          this.searchIndex.set(keyword, new Set());
        }
        this.searchIndex.get(keyword)!.add(file);
      }
    }

    console.error(`Loaded ${this.wikiPages.size} wiki pages`);
  }

  private extractKeywords(page: WikiPage): string[] {
    const text = `${page.title} ${page.description || ''} ${page.content}`.toLowerCase();
    // Extract words, remove common stop words
    const words = text.match(/\b[a-z][a-z0-9_]{2,}\b/g) || [];
    const stopWords = new Set(['the', 'and', 'for', 'are', 'but', 'not', 'you', 'all', 'can', 'had', 'her', 'was', 'one', 'our', 'out', 'has', 'have', 'been', 'this', 'that', 'with', 'from', 'they', 'will', 'would', 'there', 'their', 'what', 'about', 'which', 'when', 'make', 'like', 'time', 'just', 'know', 'take', 'into', 'year', 'your', 'some', 'could', 'them', 'than', 'then', 'look', 'only', 'come', 'over', 'such', 'also', 'back', 'after', 'well', 'most', 'made', 'where', 'being', 'does', 'here', 'much', 'these', 'each', 'other']);
    return [...new Set(words.filter(w => !stopWords.has(w)))];
  }

  private async initRAG(): Promise<void> {
    if (this.config.ragStorePath && this.config.repoPath) {
      try {
        this.ragSystem = new RAGSystem({
          storePath: this.config.ragStorePath,
          repoPath: this.config.repoPath,
          useHybridSearch: true,
          useReranking: false, // Can be slow, disable by default for MCP
        });

        // Check if index exists (either FAISS or metadata-only)
        const metadataPath = path.join(this.config.ragStorePath, 'metadata.json');
        if (fs.existsSync(metadataPath)) {
          await this.ragSystem.loadMetadataOnly();
          console.error('Loaded RAG index for semantic code search');
        } else {
          console.error('No RAG index found - code search will be limited to wiki pages');
          this.ragSystem = null;
        }
      } catch (error) {
        console.error('Failed to initialize RAG system:', error);
        this.ragSystem = null;
      }
    }
  }

  private setupHandlers(): void {
    // List available tools
    this.server.setRequestHandler(ListToolsRequestSchema, async () => {
      return {
        tools: [
          {
            name: 'search_wiki',
            description: 'Search wiki documentation pages by keyword. Returns matching pages with titles and descriptions.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Search query (keywords to search for)',
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results to return (default: 10)',
                },
                category: {
                  type: 'string',
                  description: 'Filter by category (e.g., "Architecture", "Components")',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_wiki_page',
            description: 'Get the full content of a wiki page by its path.',
            inputSchema: {
              type: 'object',
              properties: {
                path: {
                  type: 'string',
                  description: 'Path to the wiki page (e.g., "overview.md" or "components/auth.md")',
                },
              },
              required: ['path'],
            },
          },
          {
            name: 'list_wiki_pages',
            description: 'List all wiki pages, optionally filtered by category.',
            inputSchema: {
              type: 'object',
              properties: {
                category: {
                  type: 'string',
                  description: 'Filter by category',
                },
              },
            },
          },
          {
            name: 'search_code',
            description: 'Search the codebase using semantic similarity (if RAG index is available). Returns relevant code snippets.',
            inputSchema: {
              type: 'object',
              properties: {
                query: {
                  type: 'string',
                  description: 'Natural language query about the code',
                },
                maxResults: {
                  type: 'number',
                  description: 'Maximum number of results (default: 5)',
                },
                mode: {
                  type: 'string',
                  enum: ['hybrid', 'vector', 'keyword'],
                  description: 'Search mode: hybrid (default), vector (semantic only), or keyword (BM25 only)',
                },
              },
              required: ['query'],
            },
          },
          {
            name: 'get_architecture_overview',
            description: 'Get a high-level overview of the codebase architecture from the wiki.',
            inputSchema: {
              type: 'object',
              properties: {},
            },
          },
        ],
      };
    });

    // Handle tool calls
    this.server.setRequestHandler(CallToolRequestSchema, async (request) => {
      const { name, arguments: args } = request.params;

      switch (name) {
        case 'search_wiki':
          return this.handleSearchWiki(args as { query: string; maxResults?: number; category?: string });
        case 'get_wiki_page':
          return this.handleGetWikiPage(args as { path: string });
        case 'list_wiki_pages':
          return this.handleListWikiPages(args as { category?: string });
        case 'search_code':
          return this.handleSearchCode(args as { query: string; maxResults?: number; mode?: 'hybrid' | 'vector' | 'keyword' });
        case 'get_architecture_overview':
          return this.handleGetArchitectureOverview();
        default:
          return {
            content: [{ type: 'text', text: `Unknown tool: ${name}` }],
            isError: true,
          };
      }
    });

    // List resources (wiki pages as resources)
    this.server.setRequestHandler(ListResourcesRequestSchema, async () => {
      const resources = Array.from(this.wikiPages.entries()).map(([pagePath, page]) => ({
        uri: `wiki://${pagePath}`,
        name: page.title,
        description: page.description,
        mimeType: 'text/markdown',
      }));

      return { resources };
    });

    // Read resource content
    this.server.setRequestHandler(ReadResourceRequestSchema, async (request) => {
      const uri = request.params.uri;

      if (uri.startsWith('wiki://')) {
        const pagePath = uri.replace('wiki://', '');
        const page = this.wikiPages.get(pagePath);

        if (page) {
          return {
            contents: [
              {
                uri,
                mimeType: 'text/markdown',
                text: page.content,
              },
            ],
          };
        }
      }

      return {
        contents: [
          {
            uri,
            mimeType: 'text/plain',
            text: `Resource not found: ${uri}`,
          },
        ],
      };
    });
  }

  private handleSearchWiki(args: { query: string; maxResults?: number; category?: string }): { content: Array<{ type: string; text: string }> } {
    const { query, maxResults = 10, category } = args;
    const queryKeywords = query.toLowerCase().split(/\s+/).filter(w => w.length > 2);

    // Score each page based on keyword matches
    const scored: Array<{ page: WikiPage; score: number }> = [];

    for (const page of this.wikiPages.values()) {
      if (category && page.category !== category) continue;

      let score = 0;
      const titleLower = page.title.toLowerCase();
      const contentLower = page.content.toLowerCase();
      const descLower = (page.description || '').toLowerCase();

      for (const kw of queryKeywords) {
        // Title matches are most important
        if (titleLower.includes(kw)) score += 10;
        // Description matches
        if (descLower.includes(kw)) score += 5;
        // Heading matches
        if (page.headings.some(h => h.toLowerCase().includes(kw))) score += 3;
        // Content matches
        if (contentLower.includes(kw)) score += 1;
      }

      if (score > 0) {
        scored.push({ page, score });
      }
    }

    // Sort by score and limit results
    scored.sort((a, b) => b.score - a.score);
    const results = scored.slice(0, maxResults);

    if (results.length === 0) {
      return {
        content: [{ type: 'text', text: `No wiki pages found matching "${query}"` }],
      };
    }

    const resultText = results.map(({ page, score }) => {
      return `## ${page.title}\n**Path:** ${page.path}\n${page.description ? `**Description:** ${page.description}\n` : ''}${page.category ? `**Category:** ${page.category}\n` : ''}**Relevance Score:** ${score}`;
    }).join('\n\n---\n\n');

    return {
      content: [{ type: 'text', text: `Found ${results.length} matching wiki pages:\n\n${resultText}` }],
    };
  }

  private handleGetWikiPage(args: { path: string }): { content: Array<{ type: string; text: string }>; isError?: boolean } {
    const { path: pagePath } = args;

    // Try exact match first
    let page = this.wikiPages.get(pagePath);

    // Try with .md extension
    if (!page && !pagePath.endsWith('.md')) {
      page = this.wikiPages.get(pagePath + '.md');
    }

    // Try case-insensitive search
    if (!page) {
      const lowerPath = pagePath.toLowerCase();
      for (const [p, pg] of this.wikiPages.entries()) {
        if (p.toLowerCase() === lowerPath || p.toLowerCase() === lowerPath + '.md') {
          page = pg;
          break;
        }
      }
    }

    if (!page) {
      return {
        content: [{ type: 'text', text: `Wiki page not found: ${pagePath}\n\nAvailable pages:\n${Array.from(this.wikiPages.keys()).slice(0, 20).join('\n')}${this.wikiPages.size > 20 ? '\n...' : ''}` }],
        isError: true,
      };
    }

    const header = `# ${page.title}\n${page.description ? `> ${page.description}\n` : ''}\n**Category:** ${page.category || 'Uncategorized'}\n\n---\n\n`;

    return {
      content: [{ type: 'text', text: header + page.content }],
    };
  }

  private handleListWikiPages(args: { category?: string }): { content: Array<{ type: string; text: string }> } {
    const { category } = args;

    const pages = Array.from(this.wikiPages.values())
      .filter(p => !category || p.category === category)
      .sort((a, b) => a.title.localeCompare(b.title));

    if (pages.length === 0) {
      return {
        content: [{ type: 'text', text: category ? `No pages found in category "${category}"` : 'No wiki pages found' }],
      };
    }

    // Group by category
    const byCategory = new Map<string, WikiPage[]>();
    for (const page of pages) {
      const cat = page.category || 'Uncategorized';
      if (!byCategory.has(cat)) byCategory.set(cat, []);
      byCategory.get(cat)!.push(page);
    }

    let text = `# Wiki Pages (${pages.length} total)\n\n`;

    for (const [cat, catPages] of byCategory.entries()) {
      text += `## ${cat}\n`;
      for (const page of catPages) {
        text += `- **${page.title}** (${page.path})${page.description ? ` - ${page.description}` : ''}\n`;
      }
      text += '\n';
    }

    return {
      content: [{ type: 'text', text }],
    };
  }

  private async handleSearchCode(args: { query: string; maxResults?: number; mode?: 'hybrid' | 'vector' | 'keyword' }): Promise<{ content: Array<{ type: string; text: string }> }> {
    const { query, maxResults = 5, mode = 'hybrid' } = args;

    if (!this.ragSystem) {
      return {
        content: [{ type: 'text', text: 'Code search is not available. RAG index has not been initialized. Generate the wiki with indexing enabled first.' }],
      };
    }

    try {
      const searchOptions: SearchOptions = {
        maxResults,
        mode,
      };

      const results = await this.ragSystem.search(query, searchOptions);

      if (results.length === 0) {
        return {
          content: [{ type: 'text', text: `No code matches found for "${query}"` }],
        };
      }

      const resultText = results.map((result: SearchResult, i: number) => {
        const scoreInfo = [
          `Combined: ${result.score.toFixed(3)}`,
          result.vectorScore !== undefined ? `Vector: ${result.vectorScore.toFixed(3)}` : null,
          result.bm25Score !== undefined ? `BM25: ${result.bm25Score.toFixed(3)}` : null,
        ].filter(Boolean).join(', ');

        return `### ${i + 1}. ${result.filePath}:${result.startLine}-${result.endLine}\n**Type:** ${result.chunkType || 'code'}${result.name ? ` | **Name:** ${result.name}` : ''}\n**Scores:** ${scoreInfo}\n\n\`\`\`${result.language}\n${result.content.slice(0, 1000)}${result.content.length > 1000 ? '\n// ... truncated' : ''}\n\`\`\``;
      }).join('\n\n---\n\n');

      return {
        content: [{ type: 'text', text: `Found ${results.length} code matches for "${query}":\n\n${resultText}` }],
      };
    } catch (error) {
      return {
        content: [{ type: 'text', text: `Error searching code: ${error instanceof Error ? error.message : String(error)}` }],
      };
    }
  }

  private handleGetArchitectureOverview(): { content: Array<{ type: string; text: string }> } {
    // Look for overview/architecture pages
    const overviewPaths = ['overview.md', 'index.md', 'architecture.md', 'README.md', 'architecture/overview.md'];

    for (const pagePath of overviewPaths) {
      const page = this.wikiPages.get(pagePath);
      if (page) {
        return {
          content: [{ type: 'text', text: `# ${page.title}\n\n${page.content}` }],
        };
      }
    }

    // Try to find any page with "overview" or "architecture" in the title
    for (const page of this.wikiPages.values()) {
      const titleLower = page.title.toLowerCase();
      if (titleLower.includes('overview') || titleLower.includes('architecture')) {
        return {
          content: [{ type: 'text', text: `# ${page.title}\n\n${page.content}` }],
        };
      }
    }

    // Fallback: generate a summary from categories
    const categories = new Map<string, number>();
    for (const page of this.wikiPages.values()) {
      const cat = page.category || 'Uncategorized';
      categories.set(cat, (categories.get(cat) || 0) + 1);
    }

    let summary = '# Architecture Overview\n\nNo dedicated overview page found. Here is a summary of documented areas:\n\n';
    for (const [cat, count] of categories.entries()) {
      summary += `- **${cat}**: ${count} page${count > 1 ? 's' : ''}\n`;
    }
    summary += `\n**Total Documentation:** ${this.wikiPages.size} pages\n\nUse \`list_wiki_pages\` to see all available pages, or \`search_wiki\` to find specific topics.`;

    return {
      content: [{ type: 'text', text: summary }],
    };
  }

  async start(): Promise<void> {
    await this.loadWikiPages();
    await this.initRAG();

    const transport = new StdioServerTransport();
    await this.server.connect(transport);
    console.error('SemanticWiki MCP Server started');
  }
}

// CLI entry point
async function main() {
  const args = process.argv.slice(2);

  // Parse arguments
  let wikiPath = './wiki';
  let ragStorePath: string | undefined;
  let repoPath: string | undefined;

  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--wiki' && args[i + 1]) {
      wikiPath = args[++i];
    } else if (args[i] === '--rag-store' && args[i + 1]) {
      ragStorePath = args[++i];
    } else if (args[i] === '--repo' && args[i + 1]) {
      repoPath = args[++i];
    } else if (args[i] === '--help' || args[i] === '-h') {
      console.log(`
SemanticWiki MCP Server

Usage: npx ts-node src/mcp-wiki-server.ts [options]

Options:
  --wiki <path>       Path to wiki directory (default: ./wiki)
  --rag-store <path>  Path to RAG index store (enables code search)
  --repo <path>       Path to repository (required with --rag-store)
  --help, -h          Show this help message

The server exposes the following tools:
  - search_wiki: Search wiki documentation pages
  - get_wiki_page: Get full content of a wiki page
  - list_wiki_pages: List all wiki pages
  - search_code: Search codebase using semantic search (if RAG enabled)
  - get_architecture_overview: Get high-level architecture overview
`);
      process.exit(0);
    }
  }

  const config: WikiServerConfig = {
    wikiPath: path.resolve(wikiPath),
    ragStorePath: ragStorePath ? path.resolve(ragStorePath) : undefined,
    repoPath: repoPath ? path.resolve(repoPath) : undefined,
  };

  const server = new WikiMCPServer(config);
  await server.start();
}

// Export for use as module
export type { WikiServerConfig };

// Run if executed directly
if (import.meta.url === `file://${process.argv[1]}`) {
  main().catch(console.error);
}
