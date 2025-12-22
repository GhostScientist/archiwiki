import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import * as fs from 'fs';
import * as path from 'path';
import { simpleGit, SimpleGit } from 'simple-git';
import matter from 'gray-matter';
import { PermissionManager } from './permissions.js';
import { MCPConfigManager } from './mcp-config.js';
import { RAGSystem } from './rag/index.js';
import { WIKI_SYSTEM_PROMPT } from './prompts/wiki-system.js';

export interface WikiGenerationOptions {
  repoUrl: string;
  outputDir: string;
  configPath?: string;
  accessToken?: string;
  model?: string;
  targetPath?: string;
  forceRegenerate?: boolean;
  verbose?: boolean;
}

export interface WikiAgentConfig {
  verbose?: boolean;
  apiKey?: string;
  permissionManager?: PermissionManager;
  workingDir?: string;
}

export interface ProgressEvent {
  type: 'phase' | 'step' | 'file' | 'complete' | 'error';
  message: string;
  detail?: string;
  progress?: number;
}

export interface GenerationEstimate {
  files: number;
  estimatedChunks: number;
  estimatedTokens: number;
  estimatedCost: {
    input: number;
    output: number;
    total: number;
  };
  estimatedTime: {
    indexingMinutes: number;
    generationMinutes: number;
    totalMinutes: number;
  };
  breakdown: {
    byExtension: Record<string, number>;
    largestFiles: Array<{ path: string; size: number }>;
  };
}

export class ArchitecturalWikiAgent {
  private config: WikiAgentConfig;
  private permissionManager: PermissionManager;
  private mcpConfigManager: MCPConfigManager;
  private customServer: ReturnType<typeof createSdkMcpServer>;
  private ragSystem: RAGSystem | null = null;
  private repoPath: string = '';
  private outputDir: string = '';
  private sessionId?: string;

  constructor(config: WikiAgentConfig = {}) {
    this.config = config;

    if (config.apiKey) {
      process.env.ANTHROPIC_API_KEY = config.apiKey;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key required. Set ANTHROPIC_API_KEY environment variable.');
    }

    this.permissionManager = config.permissionManager || new PermissionManager({ policy: 'permissive' });
    this.mcpConfigManager = new MCPConfigManager();
    this.customServer = this.createCustomToolServer();
  }

  /**
   * Generate wiki documentation for a repository
   */
  async *generateWiki(
    options: WikiGenerationOptions
  ): AsyncGenerator<ProgressEvent | any> {
    // Phase 1: Clone or access repository
    yield { type: 'phase', message: 'Preparing repository', progress: 0 };
    this.repoPath = await this.prepareRepository(options.repoUrl, options.accessToken);
    this.outputDir = path.resolve(options.outputDir);

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Phase 2: Index codebase for RAG
    yield { type: 'phase', message: 'Indexing codebase for semantic search', progress: 10 };
    this.ragSystem = new RAGSystem({
      storePath: path.join(this.outputDir, '.ted-mosby-cache'),
      repoPath: this.repoPath
    });
    await this.ragSystem.indexRepository();
    yield { type: 'step', message: `Indexed ${this.ragSystem.getDocumentCount()} code chunks` };

    // Recreate tool server with RAG system initialized
    this.customServer = this.createCustomToolServer();

    // Phase 3: Run agent to generate wiki
    yield { type: 'phase', message: 'Generating architectural documentation', progress: 20 };

    const agentOptions = this.buildAgentOptions(options);
    const prompt = this.buildGenerationPrompt(options);

    // Stream agent execution using simple string prompt
    try {
      const queryResult = query({
        prompt,
        options: agentOptions
      });

      for await (const message of queryResult) {
        // Capture session ID
        if (message.type === 'system' && (message as any).subtype === 'init') {
          this.sessionId = (message as any).session_id;
        }

        // Log errors from the agent
        if (message.type === 'system' && (message as any).subtype === 'error') {
          console.error('Agent error:', (message as any).error || message);
        }

        yield message;
      }

      yield { type: 'complete', message: 'Wiki generation complete', progress: 100 };
    } catch (err: any) {
      // Capture stderr if available
      console.error('Query error details:', err.message);
      if (err.stderr) {
        console.error('Stderr:', err.stderr);
      }
      if (err.cause) {
        console.error('Cause:', err.cause);
      }
      throw err;
    }
  }

  /**
   * Estimate generation time and cost without making API calls
   */
  async estimateGeneration(options: WikiGenerationOptions): Promise<GenerationEstimate> {
    // Prepare repository (clone if needed)
    const repoPath = await this.prepareRepository(options.repoUrl, options.accessToken);

    // Discover files
    const { glob } = await import('glob');

    const INDEXABLE_EXTENSIONS = [
      '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
      '.py', '.pyx', '.go', '.rs',
      '.java', '.kt', '.scala', '.rb', '.php',
      '.c', '.cpp', '.h', '.hpp', '.cs', '.swift',
      '.vue', '.svelte', '.json', '.yaml', '.yml', '.toml',
      '.md', '.mdx'
    ];

    const EXCLUDE_PATTERNS = [
      '**/node_modules/**', '**/.git/**', '**/dist/**',
      '**/build/**', '**/.next/**', '**/coverage/**',
      '**/__pycache__/**', '**/venv/**', '**/.venv/**',
      '**/vendor/**', '**/*.min.js', '**/*.bundle.js',
      '**/package-lock.json', '**/yarn.lock', '**/pnpm-lock.yaml'
    ];

    const files: string[] = [];
    const byExtension: Record<string, number> = {};
    const fileSizes: Array<{ path: string; size: number }> = [];

    for (const ext of INDEXABLE_EXTENSIONS) {
      const matches = await glob(`**/*${ext}`, {
        cwd: repoPath,
        ignore: EXCLUDE_PATTERNS,
        absolute: false
      });

      byExtension[ext] = matches.length;
      files.push(...matches);
    }

    // Remove duplicates and gather sizes
    const uniqueFiles = [...new Set(files)];
    let totalSize = 0;

    for (const file of uniqueFiles) {
      try {
        const fullPath = path.join(repoPath, file);
        const stats = fs.statSync(fullPath);
        totalSize += stats.size;
        fileSizes.push({ path: file, size: stats.size });
      } catch {
        // Skip files we can't read
      }
    }

    // Sort by size and get largest
    fileSizes.sort((a, b) => b.size - a.size);
    const largestFiles = fileSizes.slice(0, 10);

    // Estimate chunks (avg ~1500 chars per chunk)
    const avgChunkSize = 1500;
    const estimatedChunks = Math.ceil(totalSize / avgChunkSize);

    // Estimate tokens (~4 chars per token for code)
    const charsPerToken = 4;
    const tokensPerChunk = avgChunkSize / charsPerToken;
    const estimatedTokens = estimatedChunks * tokensPerChunk;

    // Estimate API costs (Claude Sonnet pricing as of 2024)
    // Input: $3 per 1M tokens, Output: $15 per 1M tokens
    // Wiki generation typically reads chunks and generates docs
    const inputTokensEstimate = estimatedTokens * 2;  // Chunks read + context
    const outputTokensEstimate = estimatedTokens * 0.5;  // Generated docs

    const inputCost = (inputTokensEstimate / 1_000_000) * 3;
    const outputCost = (outputTokensEstimate / 1_000_000) * 15;

    // Estimate time
    // Indexing: ~100 files/min for embedding generation
    // Generation: ~2 wiki pages/min with API calls
    const indexingMinutes = uniqueFiles.length / 100;
    const estimatedPages = Math.ceil(uniqueFiles.length / 10);  // ~1 page per 10 source files
    const generationMinutes = estimatedPages * 0.5;

    return {
      files: uniqueFiles.length,
      estimatedChunks,
      estimatedTokens: Math.round(estimatedTokens),
      estimatedCost: {
        input: Math.round(inputCost * 100) / 100,
        output: Math.round(outputCost * 100) / 100,
        total: Math.round((inputCost + outputCost) * 100) / 100
      },
      estimatedTime: {
        indexingMinutes: Math.round(indexingMinutes * 10) / 10,
        generationMinutes: Math.round(generationMinutes * 10) / 10,
        totalMinutes: Math.round((indexingMinutes + generationMinutes) * 10) / 10
      },
      breakdown: {
        byExtension: Object.fromEntries(
          Object.entries(byExtension).filter(([, count]) => count > 0)
        ),
        largestFiles
      }
    };
  }

  /**
   * Clone or access repository
   */
  private async prepareRepository(repoUrl: string, accessToken?: string): Promise<string> {
    // Check if it's a local path
    if (fs.existsSync(repoUrl)) {
      return path.resolve(repoUrl);
    }

    // Clone remote repository
    const tempDir = path.join(process.cwd(), '.ted-mosby-repos');
    if (!fs.existsSync(tempDir)) {
      fs.mkdirSync(tempDir, { recursive: true });
    }

    // Extract repo name from URL
    const repoName = repoUrl.split('/').pop()?.replace('.git', '') || 'repo';
    const clonePath = path.join(tempDir, repoName);

    // If already cloned, pull latest
    if (fs.existsSync(clonePath)) {
      const git: SimpleGit = simpleGit(clonePath);
      await git.pull();
      return clonePath;
    }

    // Clone with auth if token provided
    let cloneUrl = repoUrl;
    if (accessToken && repoUrl.includes('github.com')) {
      cloneUrl = repoUrl.replace('https://', `https://${accessToken}@`);
    }

    const git: SimpleGit = simpleGit();
    await git.clone(cloneUrl, clonePath, ['--depth', '1']);

    return clonePath;
  }

  /**
   * Build agent options with MCP servers
   */
  private buildAgentOptions(wikiOptions: WikiGenerationOptions): any {
    return {
      model: wikiOptions.model || 'claude-sonnet-4-20250514',
      cwd: this.repoPath,
      systemPrompt: WIKI_SYSTEM_PROMPT,
      mcpServers: {
        // External MCP servers
        'filesystem': {
          command: 'npx',
          args: ['-y', '@modelcontextprotocol/server-filesystem', this.repoPath]
        },
        // Custom in-process tools - pass SDK server directly
        'tedmosby': this.customServer
      },
      allowedTools: [
        // Filesystem tools
        'mcp__filesystem__read_file',
        'mcp__filesystem__read_multiple_files',
        'mcp__filesystem__write_file',
        'mcp__filesystem__list_directory',
        'mcp__filesystem__directory_tree',
        'mcp__filesystem__search_files',
        'mcp__filesystem__get_file_info',
        // Custom tedmosby tools
        'mcp__tedmosby__search_codebase',
        'mcp__tedmosby__write_wiki_page',
        'mcp__tedmosby__analyze_code_structure'
      ],
      maxTurns: 200,
      permissionMode: 'acceptEdits',
      includePartialMessages: true,
      // Capture stderr from Claude Code subprocess
      stderr: (data: string) => {
        console.error('[Claude Code stderr]:', data);
      }
    };
  }

  /**
   * Build the generation prompt
   */
  private buildGenerationPrompt(options: WikiGenerationOptions): string {
    const configNote = options.configPath && fs.existsSync(options.configPath)
      ? `\n\nConfiguration file provided at: ${options.configPath}\nPlease read it first to understand the wiki structure requirements.`
      : '';

    return `Generate a comprehensive architectural documentation wiki for this repository.

**Repository:** ${options.repoUrl}
**Output Directory:** ${this.outputDir}
${options.targetPath ? `**Focus Area:** ${options.targetPath}` : ''}
${configNote}

Begin by:
1. Scanning the repository structure to understand the codebase layout
2. Identifying the key architectural components and patterns
3. Planning the wiki structure
4. Generating documentation with source code traceability

Remember: Every architectural concept MUST include file:line references to the source code.`;
  }

  /**
   * Create custom MCP tool server for wiki-specific operations
   */
  private createCustomToolServer() {
    const tools: any[] = [];

    // Tool 1: search_codebase - RAG-powered semantic search
    tools.push(
      tool(
        'search_codebase',
        'Semantic search over the codebase using embeddings. Returns relevant code snippets with file paths and line numbers. Use this to find code related to architectural concepts you are documenting.',
        {
          query: z.string().describe('Natural language search query (e.g., "authentication handling", "database connection")'),
          maxResults: z.number().min(1).max(20).optional().default(10).describe('Maximum number of results to return'),
          fileTypes: z.array(z.string()).optional().describe('Filter by file extensions (e.g., [".ts", ".js"])'),
          excludeTests: z.boolean().optional().default(true).describe('Exclude test files from results')
        },
        async (args) => {
          if (!this.ragSystem) {
            return {
              content: [{
                type: 'text',
                text: 'Error: RAG system not initialized. Repository must be indexed first.'
              }]
            };
          }

          try {
            const results = await this.ragSystem.search(args.query, {
              maxResults: args.maxResults || 10,
              fileTypes: args.fileTypes,
              excludeTests: args.excludeTests ?? true
            });

            const formatted = results.map((r, i) =>
              `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n` +
              `**Source:** \`${r.filePath}:${r.startLine}-${r.endLine}\`\n\n` +
              '```' + (r.language || '') + '\n' + r.content + '\n```'
            ).join('\n\n');

            return {
              content: [{
                type: 'text',
                text: results.length > 0
                  ? `Found ${results.length} relevant code snippets:\n\n${formatted}`
                  : 'No relevant code found for this query.'
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Search error: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
      )
    );

    // Tool 2: write_wiki_page - Write wiki documentation with validation
    tools.push(
      tool(
        'write_wiki_page',
        'Write a wiki documentation page to the output directory. Validates markdown structure and adds frontmatter metadata.',
        {
          pagePath: z.string().describe('Path relative to wiki root (e.g., "architecture/overview.md", "components/auth/index.md")'),
          title: z.string().describe('Page title (used as H1 heading)'),
          content: z.string().describe('Full markdown content (excluding the H1 title, which is added automatically)'),
          frontmatter: z.object({
            description: z.string().optional().describe('Brief page description for metadata'),
            related: z.array(z.string()).optional().describe('Related page paths'),
            sources: z.array(z.string()).optional().describe('Source files referenced in this page')
          }).optional().describe('Page metadata')
        },
        async (args) => {
          try {
            const fullPath = path.join(this.outputDir, args.pagePath);
            const dir = path.dirname(fullPath);

            // Create directory if needed
            if (!fs.existsSync(dir)) {
              fs.mkdirSync(dir, { recursive: true });
            }

            // Build content with frontmatter
            const frontmatterData: Record<string, any> = {
              title: args.title,
              generated: new Date().toISOString(),
              ...args.frontmatter
            };

            const fullContent = matter.stringify(
              `# ${args.title}\n\n${args.content}`,
              frontmatterData
            );

            // Write file
            fs.writeFileSync(fullPath, fullContent, 'utf-8');

            // Validate links and structure
            const warnings: string[] = [];

            // Check for broken internal links
            const linkMatches = args.content.matchAll(/\[([^\]]+)\]\(([^)]+)\)/g);
            for (const match of linkMatches) {
              const linkPath = match[2];
              if (linkPath.startsWith('./') || linkPath.startsWith('../')) {
                const resolvedPath = path.resolve(dir, linkPath.split('#')[0]);
                if (!fs.existsSync(resolvedPath) && !resolvedPath.endsWith('.md')) {
                  warnings.push(`Potential broken link: ${linkPath}`);
                }
              }
            }

            // Check for source traceability
            const hasSourceRefs = args.content.includes('**Source:**') ||
                                  args.content.includes('`src/') ||
                                  args.content.includes('`lib/');
            if (!hasSourceRefs && args.pagePath !== 'README.md' && args.pagePath !== 'glossary.md') {
              warnings.push('Page may be missing source code references');
            }

            const response = `Successfully wrote wiki page: ${args.pagePath}` +
              (warnings.length > 0 ? `\n\nWarnings:\n${warnings.map(w => `- ${w}`).join('\n')}` : '');

            return {
              content: [{
                type: 'text',
                text: response
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Failed to write wiki page: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
      )
    );

    // Tool 3: analyze_code_structure - AST analysis for understanding code
    tools.push(
      tool(
        'analyze_code_structure',
        'Analyze the structure of a code file to extract functions, classes, imports, and exports. Useful for understanding the architecture before documenting.',
        {
          filePath: z.string().describe('Path to the file to analyze (relative to repo root)'),
          analysisType: z.enum(['all', 'functions', 'classes', 'imports', 'exports', 'structure'])
            .default('all')
            .describe('Type of analysis to perform')
        },
        async (args) => {
          try {
            const fullPath = path.join(this.repoPath, args.filePath);

            if (!fs.existsSync(fullPath)) {
              return {
                content: [{
                  type: 'text',
                  text: `File not found: ${args.filePath}`
                }]
              };
            }

            const content = fs.readFileSync(fullPath, 'utf-8');
            const lines = content.split('\n');
            const ext = path.extname(args.filePath);

            // Simple regex-based analysis (can be enhanced with tree-sitter later)
            const analysis: {
              functions: Array<{ name: string; line: number; signature: string }>;
              classes: Array<{ name: string; line: number; methods: string[] }>;
              imports: Array<{ module: string; line: number }>;
              exports: Array<{ name: string; line: number }>;
            } = {
              functions: [],
              classes: [],
              imports: [],
              exports: []
            };

            // TypeScript/JavaScript analysis
            if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
              lines.forEach((line, idx) => {
                const lineNum = idx + 1;

                // Functions
                const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)\s*(\([^)]*\))/);
                if (funcMatch) {
                  analysis.functions.push({
                    name: funcMatch[1],
                    line: lineNum,
                    signature: `${funcMatch[1]}${funcMatch[2]}`
                  });
                }

                // Arrow functions assigned to const
                const arrowMatch = line.match(/(?:export\s+)?const\s+(\w+)\s*=\s*(?:async\s+)?\([^)]*\)\s*(?::\s*[^=]+)?\s*=>/);
                if (arrowMatch) {
                  analysis.functions.push({
                    name: arrowMatch[1],
                    line: lineNum,
                    signature: arrowMatch[1]
                  });
                }

                // Classes
                const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
                if (classMatch) {
                  analysis.classes.push({
                    name: classMatch[1],
                    line: lineNum,
                    methods: []
                  });
                }

                // Imports
                const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
                if (importMatch) {
                  analysis.imports.push({
                    module: importMatch[1],
                    line: lineNum
                  });
                }

                // Exports
                const exportMatch = line.match(/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type|enum)\s+(\w+)/);
                if (exportMatch) {
                  analysis.exports.push({
                    name: exportMatch[1],
                    line: lineNum
                  });
                }
              });
            }

            // Python analysis
            if (ext === '.py') {
              lines.forEach((line, idx) => {
                const lineNum = idx + 1;

                const funcMatch = line.match(/^(?:async\s+)?def\s+(\w+)\s*\(([^)]*)\)/);
                if (funcMatch) {
                  analysis.functions.push({
                    name: funcMatch[1],
                    line: lineNum,
                    signature: `${funcMatch[1]}(${funcMatch[2]})`
                  });
                }

                const classMatch = line.match(/^class\s+(\w+)/);
                if (classMatch) {
                  analysis.classes.push({
                    name: classMatch[1],
                    line: lineNum,
                    methods: []
                  });
                }

                const importMatch = line.match(/^(?:from\s+(\S+)\s+)?import\s+(.+)/);
                if (importMatch) {
                  analysis.imports.push({
                    module: importMatch[1] || importMatch[2],
                    line: lineNum
                  });
                }
              });
            }

            // Format output
            let output = `# Code Analysis: ${args.filePath}\n\n`;
            output += `**Lines of Code:** ${lines.length}\n`;
            output += `**Language:** ${ext.slice(1).toUpperCase()}\n\n`;

            if (args.analysisType === 'all' || args.analysisType === 'structure') {
              output += `## Summary\n`;
              output += `- Functions: ${analysis.functions.length}\n`;
              output += `- Classes: ${analysis.classes.length}\n`;
              output += `- Imports: ${analysis.imports.length}\n`;
              output += `- Exports: ${analysis.exports.length}\n\n`;
            }

            if ((args.analysisType === 'all' || args.analysisType === 'functions') && analysis.functions.length > 0) {
              output += `## Functions\n`;
              analysis.functions.forEach(f => {
                output += `- \`${f.signature}\` (line ${f.line})\n`;
              });
              output += '\n';
            }

            if ((args.analysisType === 'all' || args.analysisType === 'classes') && analysis.classes.length > 0) {
              output += `## Classes\n`;
              analysis.classes.forEach(c => {
                output += `- \`${c.name}\` (line ${c.line})\n`;
              });
              output += '\n';
            }

            if ((args.analysisType === 'all' || args.analysisType === 'imports') && analysis.imports.length > 0) {
              output += `## Imports\n`;
              analysis.imports.forEach(i => {
                output += `- \`${i.module}\` (line ${i.line})\n`;
              });
              output += '\n';
            }

            if ((args.analysisType === 'all' || args.analysisType === 'exports') && analysis.exports.length > 0) {
              output += `## Exports\n`;
              analysis.exports.forEach(e => {
                output += `- \`${e.name}\` (line ${e.line})\n`;
              });
            }

            return {
              content: [{
                type: 'text',
                text: output
              }]
            };
          } catch (error) {
            return {
              content: [{
                type: 'text',
                text: `Analysis error: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
      )
    );

    return createSdkMcpServer({
      name: 'tedmosby',
      version: '1.0.0',
      tools
    });
  }
}
