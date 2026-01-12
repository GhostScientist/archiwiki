import { query, tool, createSdkMcpServer } from '@anthropic-ai/claude-agent-sdk';
import Anthropic from '@anthropic-ai/sdk';
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
  /** If set, only generate these specific missing pages */
  missingPages?: string[];
  /** Maximum number of chunks to index (for large codebases) */
  maxChunks?: number;
  /** Maximum search results to return per query (default 10) */
  maxSearchResults?: number;
  /**
   * Batch size for chunked generation mode.
   * When set, processes the codebase in sequential batches of this size.
   * Useful for very large codebases that exceed memory limits.
   * Each batch runs a separate agent session to avoid memory buildup.
   */
  batchSize?: number;
  /**
   * Skip indexing and use existing cached index.
   * Useful for testing agent behavior without waiting for embeddings.
   */
  skipIndex?: boolean;
  /**
   * Maximum agent turns (default 200).
   * Lower this to reduce the cost estimate and avoid "Credit balance is too low" errors.
   */
  maxTurns?: number;
  /**
   * Use the Anthropic API directly instead of Claude Agent SDK.
   * Bypasses Claude Code subprocess and its billing check.
   * Uses your ANTHROPIC_API_KEY credits directly.
   */
  directApi?: boolean;
}

export interface WikiAgentConfig {
  verbose?: boolean;
  apiKey?: string;
  permissionManager?: PermissionManager;
  workingDir?: string;
}

// Store generation options for use in tool server
let currentGenerationOptions: WikiGenerationOptions | null = null;

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
    // Store options for tool server to access
    currentGenerationOptions = options;

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
      repoPath: this.repoPath,
      maxChunks: options.maxChunks  // Limit chunks for large codebases
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
    // Track if we've yielded the complete event (wiki is done even if subprocess exits uncleanly)
    let wikiComplete = false;

    try {
      if (options.verbose) {
        console.log('[Debug] Starting agent with options:', JSON.stringify({
          model: agentOptions.model,
          cwd: agentOptions.cwd,
          maxTurns: agentOptions.maxTurns,
          allowedTools: agentOptions.allowedTools?.length,
          ragChunks: this.ragSystem?.getDocumentCount()
        }, null, 2));
      }

      const queryResult = query({
        prompt,
        options: agentOptions
      });

      for await (const message of queryResult) {
        // Capture session ID
        if (message.type === 'system' && (message as any).subtype === 'init') {
          this.sessionId = (message as any).session_id;
          if (options.verbose) {
            console.log('[Debug] Agent initialized, session:', this.sessionId);
          }
        }

        // Log errors from the agent
        if (message.type === 'system' && (message as any).subtype === 'error') {
          console.error('Agent error:', JSON.stringify(message, null, 2));
        }

        // Log tool calls in verbose mode
        if (options.verbose && message.type === 'assistant' && (message as any).tool_use) {
          const tools = (message as any).tool_use;
          console.log('[Debug] Tool calls:', tools.map((t: any) => t.name).join(', '));
        }

        // Check if agent has finished its work (result message indicates completion)
        if (message.type === 'result' && (message as any).subtype === 'success') {
          wikiComplete = true;
        }

        yield message;
      }

      yield { type: 'complete', message: 'Wiki generation complete', progress: 100 };
    } catch (err: any) {
      // If wiki was already complete when the error occurred, treat as success
      // This handles the case where the subprocess exits during cleanup
      if (wikiComplete) {
        if (options.verbose) {
          console.log('[Debug] Wiki generation completed successfully (subprocess cleanup error ignored)');
        }
        yield { type: 'complete', message: 'Wiki generation complete', progress: 100 };
        return;  // Don't throw - wiki is done
      }

      // Enhanced error capture for actual failures
      console.error('Query error details:', err.message);

      // Log full error object for debugging
      if (options.verbose) {
        console.error('[Debug] Full error:', JSON.stringify(err, Object.getOwnPropertyNames(err), 2));
      }

      if (err.stderr) {
        console.error('Stderr:', err.stderr);
      }
      if (err.stdout) {
        console.error('Stdout:', err.stdout);
      }
      if (err.cause) {
        console.error('Cause:', err.cause);
      }
      if (err.code) {
        console.error('Exit code:', err.code);
      }
      if (err.signal) {
        console.error('Signal:', err.signal);
      }

      // Check for common issues
      if (err.message?.includes('exit')) {
        console.error('\nPossible causes:');
        console.error('  1. MCP server failed to start (check npx is available)');
        console.error('  2. Out of memory (try with smaller codebase or increase Node memory)');
        console.error('  3. API rate limit exceeded');
        console.error('\nTry running with --verbose for more details.');
        console.error('\nTip: For large codebases, try --max-chunks 5000 to limit index size.');
      }

      throw err;
    }
  }

  /**
   * Generate wiki in batched mode for very large codebases.
   * Processes the codebase in sequential batches to avoid memory issues.
   */
  async *generateWikiBatched(
    options: WikiGenerationOptions
  ): AsyncGenerator<ProgressEvent | any> {
    const batchSize = options.batchSize || 3000;  // Default 3000 chunks per batch

    // Store options for tool server to access
    currentGenerationOptions = options;

    // Phase 1: Clone or access repository
    yield { type: 'phase', message: 'Preparing repository', progress: 0 };
    this.repoPath = await this.prepareRepository(options.repoUrl, options.accessToken);
    this.outputDir = path.resolve(options.outputDir);

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Phase 2: Discover codebase size
    yield { type: 'phase', message: 'Analyzing codebase size', progress: 5 };
    const tempRag = new RAGSystem({
      storePath: path.join(this.outputDir, '.ted-mosby-cache'),
      repoPath: this.repoPath
    });

    const discovery = await tempRag.discoverChunkCount();
    const totalBatches = Math.ceil(discovery.chunks / batchSize);

    yield {
      type: 'step',
      message: `Found ${discovery.files} files, ${discovery.chunks} chunks → ${totalBatches} batch(es) of ${batchSize}`
    };

    // Phase 3: Process batches sequentially
    for (let batchNum = 0; batchNum < totalBatches; batchNum++) {
      const batchProgress = 10 + (batchNum / totalBatches) * 60;  // 10-70% for batches

      yield {
        type: 'phase',
        message: `Processing batch ${batchNum + 1}/${totalBatches}`,
        progress: batchProgress
      };

      // Create fresh RAG system for this batch (memory isolation)
      this.ragSystem = new RAGSystem({
        storePath: path.join(this.outputDir, '.ted-mosby-cache'),
        repoPath: this.repoPath
      });

      // Index this batch
      const batchInfo = await this.ragSystem.indexBatch(batchNum, batchSize);

      if (batchInfo.chunksInBatch === 0) {
        yield { type: 'step', message: `Batch ${batchNum + 1} empty, skipping` };
        continue;
      }

      yield {
        type: 'step',
        message: `Batch ${batchNum + 1}: indexed chunks ${batchInfo.batchStart + 1}-${batchInfo.batchEnd}`
      };
    }

    // Phase 4: Finalize the index
    // For batched mode, we load metadata only (embeddings were generated per batch but not persisted to FAISS)
    // This uses keyword search which is slower but doesn't require re-generating all embeddings
    yield { type: 'phase', message: 'Finalizing search index', progress: 70 };
    this.ragSystem = new RAGSystem({
      storePath: path.join(this.outputDir, '.ted-mosby-cache'),
      repoPath: this.repoPath
    });

    // Load the accumulated metadata - keyword search will be used since no FAISS index exists
    await this.ragSystem.loadMetadataOnly();
    const searchMode = this.ragSystem['index'] ? 'vector search' : 'keyword search';
    yield { type: 'step', message: `Final index: ${this.ragSystem.getDocumentCount()} chunks loaded (${searchMode})` };

    // Recreate tool server with finalized RAG system
    this.customServer = this.createCustomToolServer();

    // Phase 5: Run agent to generate wiki (single session now that index is ready)
    yield { type: 'phase', message: 'Generating architectural documentation', progress: 75 };

    const agentOptions = this.buildAgentOptions(options);
    const prompt = this.buildGenerationPrompt(options);

    let wikiComplete = false;
    let messageCount = 0;

    try {
      console.log('[Batched] Starting agent with', this.ragSystem.getDocumentCount(), 'chunks indexed');
      console.log('[Batched] RAG system status:', {
        documentCount: this.ragSystem.getDocumentCount(),
        hasIndex: this.ragSystem['index'] !== null,
        metadataSize: this.ragSystem['metadata'].size
      });
      console.log('[Batched] Agent options:', JSON.stringify({
        model: agentOptions.model,
        maxTurns: agentOptions.maxTurns,
        mcpServers: Object.keys(agentOptions.mcpServers || {}),
        allowedTools: agentOptions.allowedTools?.length,
        cwd: agentOptions.cwd,
        permissionMode: agentOptions.permissionMode
      }, null, 2));
      console.log('[Batched] Prompt length:', prompt.length, 'chars');
      console.log('[Batched] System prompt length:', WIKI_SYSTEM_PROMPT.length, 'chars');

      const queryResult = query({
        prompt,
        options: agentOptions
      });

      for await (const message of queryResult) {
        messageCount++;

        // Log every message type for debugging
        const subtype = (message as any).subtype || 'none';
        console.log(`[Batched] Message ${messageCount}: type=${message.type}, subtype=${subtype}`);

        if (message.type === 'system' && subtype === 'init') {
          this.sessionId = (message as any).session_id;
          console.log('[Batched] Agent session started:', this.sessionId);
        }

        // Log assistant messages with content preview
        if (message.type === 'assistant') {
          const content = (message as any).message?.content || [];
          const textParts = content.filter((c: any) => c.type === 'text');
          const toolUses = content.filter((c: any) => c.type === 'tool_use');

          if (textParts.length > 0) {
            const textPreview = textParts[0].text?.slice(0, 200) || '';
            console.log('[Batched] Assistant text:', textPreview + (textPreview.length >= 200 ? '...' : ''));
          }
          if (toolUses.length > 0) {
            console.log('[Batched] Tool calls:', toolUses.map((t: any) => t.name).join(', '));
          }
          if (content.length === 0) {
            console.log('[Batched] Assistant message with empty content');
          }
        }

        // Log user/tool results
        if (message.type === 'user') {
          const content = (message as any).message?.content || [];
          const toolResults = content.filter((c: any) => c.type === 'tool_result');
          if (toolResults.length > 0) {
            console.log('[Batched] Tool results:', toolResults.map((t: any) => `${t.tool_use_id}: ${t.is_error ? 'ERROR' : 'ok'}`).join(', '));
          }
        }

        // Log system errors
        if (message.type === 'system' && subtype === 'error') {
          console.error('[Batched] Agent error:', JSON.stringify(message, null, 2));
        }

        // Log result messages
        if (message.type === 'result') {
          console.log('[Batched] Result:', subtype, JSON.stringify(message).slice(0, 500));
          if (subtype === 'success') {
            wikiComplete = true;
            console.log('[Batched] Agent completed successfully after', messageCount, 'messages');
          }
        }

        yield message;
      }

      if (!wikiComplete) {
        console.log('[Batched] Warning: Agent finished without success signal after', messageCount, 'messages');
      }

      yield { type: 'complete', message: 'Wiki generation complete', progress: 100 };
    } catch (err: any) {
      console.log('[Batched] Agent error after', messageCount, 'messages:', err.message);
      console.log('[Batched] Error details:', {
        name: err.name,
        code: err.code,
        signal: err.signal,
        stderr: err.stderr?.slice?.(0, 500),
        stdout: err.stdout?.slice?.(0, 500)
      });

      if (wikiComplete) {
        console.log('[Batched] Wiki was already complete, treating as success');
        yield { type: 'complete', message: 'Wiki generation complete', progress: 100 };
        return;
      }

      console.error('Query error:', err.message);
      if (err.message?.includes('exit')) {
        console.error('\nThe agent subprocess exited unexpectedly.');
        console.error('Tips:');
        console.error('  1. Try running with --verbose for more details');
        console.error('  2. Try reducing --batch-size (e.g., --batch-size 2000)');
        console.error('  3. Check if the wiki has partial content in', this.outputDir);
      }
      throw err;
    }
  }

  /**
   * Run only the agent part using an existing cached index.
   * Useful for debugging agent behavior without re-indexing.
   */
  async *generateWikiAgentOnly(
    options: WikiGenerationOptions
  ): AsyncGenerator<ProgressEvent | any> {
    currentGenerationOptions = options;

    // Setup paths
    yield { type: 'phase', message: 'Loading existing index', progress: 0 };
    this.repoPath = await this.prepareRepository(options.repoUrl, options.accessToken);
    this.outputDir = path.resolve(options.outputDir);

    const cachePath = path.join(this.outputDir, '.ted-mosby-cache');
    const metadataPath = path.join(cachePath, 'metadata.json');

    if (!fs.existsSync(metadataPath)) {
      throw new Error(`No cached index found at ${cachePath}. Run without --skip-index first to build the index.`);
    }

    // Ensure output directory exists
    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Load existing RAG index
    this.ragSystem = new RAGSystem({
      storePath: cachePath,
      repoPath: this.repoPath
    });
    await this.ragSystem.loadMetadataOnly();

    const searchMode = this.ragSystem['index'] ? 'vector search' : 'keyword search';
    yield {
      type: 'step',
      message: `Loaded ${this.ragSystem.getDocumentCount()} chunks (${searchMode})`
    };

    // Recreate tool server with RAG system
    this.customServer = this.createCustomToolServer();

    // Run the agent
    yield { type: 'phase', message: 'Running agent (debug mode)', progress: 50 };

    const agentOptions = this.buildAgentOptions(options);
    const prompt = this.buildGenerationPrompt(options);

    // Enhanced debug output
    console.log('\n' + '='.repeat(60));
    console.log('[AgentOnly] DEBUG MODE - Detailed Agent Execution');
    console.log('='.repeat(60));
    console.log('[AgentOnly] Repository:', this.repoPath);
    console.log('[AgentOnly] Output:', this.outputDir);
    console.log('[AgentOnly] Chunks loaded:', this.ragSystem.getDocumentCount());
    console.log('[AgentOnly] Search mode:', searchMode);
    console.log('[AgentOnly] Model:', agentOptions.model);
    console.log('[AgentOnly] Max turns:', agentOptions.maxTurns);
    console.log('[AgentOnly] Permission mode:', agentOptions.permissionMode);
    console.log('[AgentOnly] CWD:', agentOptions.cwd);
    console.log('[AgentOnly] MCP servers:', Object.keys(agentOptions.mcpServers || {}));
    console.log('[AgentOnly] Allowed tools count:', agentOptions.allowedTools?.length);
    console.log('[AgentOnly] Allowed tools:', agentOptions.allowedTools);
    console.log('[AgentOnly] System prompt length:', WIKI_SYSTEM_PROMPT.length, 'chars');
    console.log('[AgentOnly] User prompt length:', prompt.length, 'chars');
    console.log('[AgentOnly] User prompt preview:', prompt.slice(0, 500));
    console.log('='.repeat(60) + '\n');

    let wikiComplete = false;
    let messageCount = 0;
    let toolCallCount = 0;

    try {
      console.log('[AgentOnly] Calling query()...');
      const queryResult = query({
        prompt,
        options: agentOptions
      });

      console.log('[AgentOnly] Got queryResult, starting iteration...');

      for await (const message of queryResult) {
        messageCount++;
        const subtype = (message as any).subtype || 'none';
        const timestamp = new Date().toISOString().split('T')[1];

        console.log(`\n[AgentOnly] === Message ${messageCount} ===`);
        console.log(`[AgentOnly] Time: ${timestamp}`);
        console.log(`[AgentOnly] Type: ${message.type}`);
        console.log(`[AgentOnly] Subtype: ${subtype}`);

        // System messages
        if (message.type === 'system') {
          if (subtype === 'init') {
            this.sessionId = (message as any).session_id;
            console.log(`[AgentOnly] Session ID: ${this.sessionId}`);
            console.log(`[AgentOnly] Tools available: ${(message as any).tools?.length || 'unknown'}`);
          } else if (subtype === 'error') {
            console.error('[AgentOnly] SYSTEM ERROR:');
            console.error(JSON.stringify(message, null, 2));
          } else {
            console.log(`[AgentOnly] System message:`, JSON.stringify(message, null, 2).slice(0, 500));
          }
        }

        // Assistant messages
        if (message.type === 'assistant') {
          const content = (message as any).message?.content || [];
          console.log(`[AgentOnly] Content blocks: ${content.length}`);

          for (const block of content) {
            if (block.type === 'text') {
              console.log(`[AgentOnly] TEXT (${block.text?.length || 0} chars):`);
              console.log(block.text?.slice(0, 300) + (block.text?.length > 300 ? '...' : ''));
            } else if (block.type === 'tool_use') {
              toolCallCount++;
              console.log(`[AgentOnly] TOOL_USE #${toolCallCount}:`);
              console.log(`  Name: ${block.name}`);
              console.log(`  ID: ${block.id}`);
              console.log(`  Input: ${JSON.stringify(block.input).slice(0, 200)}`);
            } else {
              console.log(`[AgentOnly] Block type: ${block.type}`);
            }
          }

          if (content.length === 0) {
            console.log('[AgentOnly] WARNING: Assistant message with no content!');
            console.log('[AgentOnly] Full message:', JSON.stringify(message, null, 2));
          }
        }

        // User messages (tool results)
        if (message.type === 'user') {
          const content = (message as any).message?.content || [];
          const toolResults = content.filter((c: any) => c.type === 'tool_result');
          console.log(`[AgentOnly] Tool results: ${toolResults.length}`);
          for (const tr of toolResults) {
            const resultPreview = typeof tr.content === 'string'
              ? tr.content.slice(0, 200)
              : JSON.stringify(tr.content).slice(0, 200);
            console.log(`  ${tr.tool_use_id}: ${tr.is_error ? 'ERROR' : 'ok'} - ${resultPreview}`);
          }
        }

        // Result messages
        if (message.type === 'result') {
          console.log(`[AgentOnly] RESULT: ${subtype}`);
          console.log(`[AgentOnly] Full result:`, JSON.stringify(message, null, 2).slice(0, 1000));
          if (subtype === 'success') {
            wikiComplete = true;
          }
        }

        yield message;
      }

      console.log('\n' + '='.repeat(60));
      console.log('[AgentOnly] AGENT FINISHED');
      console.log(`[AgentOnly] Total messages: ${messageCount}`);
      console.log(`[AgentOnly] Total tool calls: ${toolCallCount}`);
      console.log(`[AgentOnly] Wiki complete: ${wikiComplete}`);
      console.log('='.repeat(60) + '\n');

      if (!wikiComplete) {
        console.log('[AgentOnly] WARNING: Agent finished without success signal!');
      }

      if (toolCallCount === 0) {
        console.log('[AgentOnly] WARNING: No tool calls were made! The agent may not have access to tools.');
      }

      yield { type: 'complete', message: 'Agent-only run complete', progress: 100 };
    } catch (err: any) {
      console.log('\n' + '='.repeat(60));
      console.log('[AgentOnly] AGENT ERROR');
      console.log(`[AgentOnly] Messages before error: ${messageCount}`);
      console.log(`[AgentOnly] Tool calls before error: ${toolCallCount}`);
      console.log('[AgentOnly] Error:', err.message);
      console.log('[AgentOnly] Error name:', err.name);
      console.log('[AgentOnly] Error code:', err.code);
      console.log('[AgentOnly] Error signal:', err.signal);
      if (err.stderr) console.log('[AgentOnly] Stderr:', err.stderr.slice(0, 1000));
      if (err.stdout) console.log('[AgentOnly] Stdout:', err.stdout.slice(0, 1000));
      if (err.stack) console.log('[AgentOnly] Stack:', err.stack);
      console.log('='.repeat(60) + '\n');

      if (wikiComplete) {
        console.log('[AgentOnly] Wiki was complete before error, treating as success');
        yield { type: 'complete', message: 'Agent-only run complete (with cleanup error)', progress: 100 };
        return;
      }

      throw err;
    }
  }

  /**
   * Generate wiki using Anthropic API directly (bypasses Claude Code billing check).
   * This method handles tool calls manually and uses your ANTHROPIC_API_KEY credits.
   */
  async *generateWikiDirectApi(
    options: WikiGenerationOptions
  ): AsyncGenerator<ProgressEvent | any> {
    currentGenerationOptions = options;

    // Phase 1: Prepare repository
    yield { type: 'phase', message: 'Preparing repository', progress: 0 };
    this.repoPath = await this.prepareRepository(options.repoUrl, options.accessToken);
    this.outputDir = path.resolve(options.outputDir);

    if (!fs.existsSync(this.outputDir)) {
      fs.mkdirSync(this.outputDir, { recursive: true });
    }

    // Phase 2: Index codebase (or load existing)
    const cachePath = path.join(this.outputDir, '.ted-mosby-cache');
    const metadataPath = path.join(cachePath, 'metadata.json');

    if (options.skipIndex && fs.existsSync(metadataPath)) {
      yield { type: 'phase', message: 'Loading existing index', progress: 10 };
      this.ragSystem = new RAGSystem({
        storePath: cachePath,
        repoPath: this.repoPath
      });
      await this.ragSystem.loadMetadataOnly();
    } else {
      yield { type: 'phase', message: 'Indexing codebase', progress: 10 };
      this.ragSystem = new RAGSystem({
        storePath: cachePath,
        repoPath: this.repoPath,
        maxChunks: options.maxChunks
      });
      await this.ragSystem.indexRepository();
    }

    const searchMode = this.ragSystem['index'] ? 'vector search' : 'keyword search';
    yield { type: 'step', message: `Loaded ${this.ragSystem.getDocumentCount()} chunks (${searchMode})` };

    // Phase 3: Run direct API agent
    yield { type: 'phase', message: 'Generating wiki (Direct API mode)', progress: 20 };

    const client = new Anthropic();
    const model = options.model || 'claude-sonnet-4-20250514';
    const maxTurns = options.maxTurns || 200;
    const prompt = this.buildGenerationPrompt(options);

    // Define tools for the API
    const tools = this.buildDirectApiTools();

    console.log('\n' + '='.repeat(60));
    console.log('[DirectAPI] Starting direct API mode');
    console.log('[DirectAPI] Model:', model);
    console.log('[DirectAPI] Max turns:', maxTurns);
    console.log('[DirectAPI] Tools:', tools.length);
    console.log('[DirectAPI] Repository:', this.repoPath);
    console.log('[DirectAPI] Output:', this.outputDir);
    console.log('[DirectAPI] Chunks:', this.ragSystem.getDocumentCount());
    console.log('='.repeat(60) + '\n');

    // Build initial messages
    const messages: Anthropic.MessageParam[] = [
      { role: 'user', content: prompt }
    ];

    let turnCount = 0;
    let totalToolCalls = 0;
    let done = false;

    try {
      while (!done && turnCount < maxTurns) {
        turnCount++;
        const progress = 20 + Math.min(70, (turnCount / maxTurns) * 70);
        yield { type: 'step', message: `Turn ${turnCount}/${maxTurns}`, progress };

        if (options.verbose) {
          console.log(`\n[DirectAPI] === Turn ${turnCount} ===`);
        }

        // Call the API
        const response = await client.messages.create({
          model,
          max_tokens: 8192,
          system: WIKI_SYSTEM_PROMPT,
          tools,
          messages
        });

        if (options.verbose) {
          console.log(`[DirectAPI] Stop reason: ${response.stop_reason}`);
          console.log(`[DirectAPI] Usage: input=${response.usage.input_tokens}, output=${response.usage.output_tokens}`);
        }

        // Process response content
        const assistantContent: Anthropic.ContentBlock[] = [];
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

        for (const block of response.content) {
          assistantContent.push(block);

          if (block.type === 'text') {
            if (options.verbose) {
              console.log(`[DirectAPI] Text: ${block.text.slice(0, 200)}${block.text.length > 200 ? '...' : ''}`);
            }
            yield { type: 'assistant', content: block.text };
          } else if (block.type === 'tool_use') {
            totalToolCalls++;
            if (options.verbose) {
              console.log(`[DirectAPI] Tool call #${totalToolCalls}: ${block.name}`);
              console.log(`[DirectAPI] Input: ${JSON.stringify(block.input).slice(0, 200)}`);
            }

            // Execute the tool
            const result = await this.executeDirectApiTool(block.name, block.input as Record<string, any>);

            if (options.verbose) {
              console.log(`[DirectAPI] Result: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);
            }

            toolResults.push({
              type: 'tool_result',
              tool_use_id: block.id,
              content: result
            });
          }
        }

        // Add assistant message
        messages.push({ role: 'assistant', content: assistantContent });

        // If there were tool uses, add results and continue
        if (toolResults.length > 0) {
          messages.push({ role: 'user', content: toolResults });
        }

        // Check if we're done
        if (response.stop_reason === 'end_turn' && toolResults.length === 0) {
          done = true;
          console.log(`[DirectAPI] Agent finished naturally after ${turnCount} turns`);
        } else if (response.stop_reason === 'max_tokens') {
          console.log(`[DirectAPI] Warning: Hit max_tokens, continuing...`);
        }
      }

      if (!done && turnCount >= maxTurns) {
        console.log(`[DirectAPI] Warning: Reached max turns (${maxTurns})`);
        yield { type: 'error', message: `Reached maximum turns (${maxTurns})` };
      }

      console.log('\n' + '='.repeat(60));
      console.log('[DirectAPI] Initial generation complete');
      console.log(`[DirectAPI] Total turns: ${turnCount}`);
      console.log(`[DirectAPI] Total tool calls: ${totalToolCalls}`);
      console.log('='.repeat(60) + '\n');

      // Phase 4: Verification loop - keep generating until all links are valid
      yield { type: 'phase', message: 'Verifying wiki completeness', progress: 90 };

      let verificationAttempts = 0;
      const maxVerificationAttempts = 5;  // Prevent infinite loops

      while (verificationAttempts < maxVerificationAttempts) {
        verificationAttempts++;
        const verification = await this.verifyWikiCompleteness(this.outputDir);

        console.log(`[DirectAPI] Verification #${verificationAttempts}: ${verification.totalPages} pages, ${verification.brokenLinks.length} broken links`);

        if (verification.isComplete) {
          console.log('[DirectAPI] Wiki is complete! All links are valid.');
          break;
        }

        yield {
          type: 'step',
          message: `Found ${verification.brokenLinks.length} broken links, generating missing pages...`,
          progress: 90 + verificationAttempts
        };

        // Get unique missing pages
        const missingPages = [...new Set(verification.brokenLinks.map(l => l.target))];
        console.log(`[DirectAPI] Missing pages: ${missingPages.join(', ')}`);

        // Generate missing pages
        const continuationPrompt = `Continue generating wiki pages. The following pages are referenced but do not exist:

${missingPages.map(p => `- ${p}`).join('\n')}

For EACH missing page:
1. Use search_codebase to find relevant code for that topic
2. Use read_file to read the specific source files
3. Use write_wiki_page to create the page with proper source traceability

Remember: Every architectural concept MUST include file:line references to the source code.
Create all ${missingPages.length} missing pages now.`;

        // Reset for continuation
        const continuationMessages: Anthropic.MessageParam[] = [
          { role: 'user', content: continuationPrompt }
        ];

        let continuationTurns = 0;
        const maxContinuationTurns = Math.min(50, maxTurns - turnCount);  // Don't exceed remaining turns

        while (continuationTurns < maxContinuationTurns) {
          continuationTurns++;
          turnCount++;

          const response = await client.messages.create({
            model,
            max_tokens: 8192,
            system: WIKI_SYSTEM_PROMPT,
            tools,
            messages: continuationMessages
          });

          if (options.verbose) {
            console.log(`[DirectAPI] Continuation turn ${continuationTurns}: ${response.stop_reason}`);
          }

          const assistantContent: Anthropic.ContentBlock[] = [];
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

          for (const block of response.content) {
            assistantContent.push(block);

            if (block.type === 'tool_use') {
              totalToolCalls++;
              const result = await this.executeDirectApiTool(block.name, block.input as Record<string, any>);
              toolResults.push({
                type: 'tool_result',
                tool_use_id: block.id,
                content: result
              });

              if (options.verbose) {
                console.log(`[DirectAPI] Tool: ${block.name}`);
              }
            }
          }

          continuationMessages.push({ role: 'assistant', content: assistantContent });

          if (toolResults.length > 0) {
            continuationMessages.push({ role: 'user', content: toolResults });
          }

          if (response.stop_reason === 'end_turn' && toolResults.length === 0) {
            break;
          }
        }
      }

      if (verificationAttempts >= maxVerificationAttempts) {
        console.log(`[DirectAPI] Warning: Max verification attempts (${maxVerificationAttempts}) reached`);
        const finalCheck = await this.verifyWikiCompleteness(this.outputDir);
        if (!finalCheck.isComplete) {
          console.log(`[DirectAPI] ${finalCheck.brokenLinks.length} broken links remain`);
          yield { type: 'step', message: `Warning: ${finalCheck.brokenLinks.length} broken links remain`, progress: 95 };
        }
      }

      console.log('\n' + '='.repeat(60));
      console.log('[DirectAPI] GENERATION COMPLETE');
      console.log(`[DirectAPI] Total turns: ${turnCount}`);
      console.log(`[DirectAPI] Total tool calls: ${totalToolCalls}`);
      console.log('='.repeat(60) + '\n');

      yield { type: 'complete', message: 'Wiki generation complete (Direct API)', progress: 100 };
    } catch (err: any) {
      console.error('[DirectAPI] Error:', err.message);
      if (options.verbose) {
        console.error('[DirectAPI] Full error:', err);
      }
      yield { type: 'error', message: err.message };
      throw err;
    }
  }

  /**
   * Build tool definitions for direct API calls
   */
  private buildDirectApiTools(): Anthropic.Tool[] {
    return [
      // Filesystem tools
      {
        name: 'read_file',
        description: 'Read the contents of a file from the repository',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Path to the file relative to repository root' }
          },
          required: ['path']
        }
      },
      {
        name: 'list_directory',
        description: 'List files and directories in a path',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Path to the directory relative to repository root' }
          },
          required: ['path']
        }
      },
      {
        name: 'directory_tree',
        description: 'Get a tree view of the directory structure',
        input_schema: {
          type: 'object' as const,
          properties: {
            path: { type: 'string', description: 'Path to the directory relative to repository root' },
            depth: { type: 'number', description: 'Maximum depth to traverse (default 3)' }
          },
          required: ['path']
        }
      },
      // RAG/Wiki tools
      {
        name: 'search_codebase',
        description: 'Semantic search over the codebase using embeddings. Returns relevant code snippets with file paths and line numbers.',
        input_schema: {
          type: 'object' as const,
          properties: {
            query: { type: 'string', description: 'Natural language search query' },
            maxResults: { type: 'number', description: 'Maximum results (default 10)' }
          },
          required: ['query']
        }
      },
      {
        name: 'write_wiki_page',
        description: 'Write a wiki documentation page to the output directory',
        input_schema: {
          type: 'object' as const,
          properties: {
            pagePath: { type: 'string', description: 'Path relative to wiki root (e.g., "architecture/overview.md")' },
            title: { type: 'string', description: 'Page title' },
            content: { type: 'string', description: 'Full markdown content (excluding H1 title)' },
            description: { type: 'string', description: 'Brief page description' },
            sources: {
              type: 'array',
              items: { type: 'string' },
              description: 'Source files referenced'
            }
          },
          required: ['pagePath', 'title', 'content']
        }
      },
      {
        name: 'analyze_code_structure',
        description: 'Analyze a code file to extract functions, classes, imports, and exports',
        input_schema: {
          type: 'object' as const,
          properties: {
            filePath: { type: 'string', description: 'Path to the file to analyze' }
          },
          required: ['filePath']
        }
      },
      {
        name: 'verify_wiki_completeness',
        description: 'Check for broken internal links in the wiki. Returns missing pages that need to be created.',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      },
      {
        name: 'list_wiki_pages',
        description: 'List all wiki pages that have been created',
        input_schema: {
          type: 'object' as const,
          properties: {}
        }
      }
    ];
  }

  /**
   * Execute a tool call for direct API mode
   */
  private async executeDirectApiTool(name: string, input: Record<string, any>): Promise<string> {
    try {
      switch (name) {
        case 'read_file': {
          const filePath = path.join(this.repoPath, input.path);
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${input.path}`;
          }
          const content = fs.readFileSync(filePath, 'utf-8');
          return content;
        }

        case 'list_directory': {
          const dirPath = path.join(this.repoPath, input.path || '');
          if (!fs.existsSync(dirPath)) {
            return `Error: Directory not found: ${input.path}`;
          }
          const entries = fs.readdirSync(dirPath, { withFileTypes: true });
          const result = entries.map(e => {
            const type = e.isDirectory() ? '[DIR]' : '[FILE]';
            return `${type} ${e.name}`;
          }).join('\n');
          return result;
        }

        case 'directory_tree': {
          const dirPath = path.join(this.repoPath, input.path || '');
          const maxDepth = input.depth || 3;
          const tree = this.buildDirectoryTree(dirPath, maxDepth, 0);
          return tree;
        }

        case 'search_codebase': {
          if (!this.ragSystem) {
            return 'Error: RAG system not initialized';
          }
          const maxResults = input.maxResults || 10;
          const results = await this.ragSystem.search(input.query, { maxResults });

          if (results.length === 0) {
            return 'No relevant code found for this query.';
          }

          const formatted = results.map((r, i) => {
            // Build domain context section if available
            let domainSection = '';
            if (r.chunkType || r.name || r.domainCategories?.length) {
              domainSection = '\n**Domain Context:**\n';
              if (r.chunkType) domainSection += `- Type: ${r.chunkType}\n`;
              if (r.name) domainSection += `- Name: ${r.name}\n`;
              if (r.parentName) domainSection += `- Parent: ${r.parentName}\n`;
              if (r.domainCategories?.length) {
                domainSection += `- Business Domains: ${r.domainCategories.join(', ')}\n`;
              }
              if (r.signature) domainSection += `- Signature: \`${r.signature}\`\n`;
              if (r.isPublicApi) domainSection += `- Public API: yes\n`;
            }

            // Add documentation snippet if available
            let docSection = '';
            if (r.documentation) {
              const docSnippet = r.documentation.slice(0, 300);
              docSection = `\n**Documentation:**\n\`\`\`\n${docSnippet}${docSnippet.length < r.documentation.length ? '...' : ''}\n\`\`\`\n`;
            }

            return `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n` +
              `**Source:** \`${r.filePath}:${r.startLine}-${r.endLine}\`\n` +
              domainSection +
              docSection +
              '\n```' + (r.language || '') + '\n' + r.content + '\n```';
          }).join('\n\n');

          return `Found ${results.length} relevant code snippets:\n\n${formatted}`;
        }

        case 'write_wiki_page': {
          const fullPath = path.join(this.outputDir, input.pagePath);
          const dir = path.dirname(fullPath);

          if (!fs.existsSync(dir)) {
            fs.mkdirSync(dir, { recursive: true });
          }

          const frontmatterData: Record<string, any> = {
            title: input.title,
            generated: new Date().toISOString(),
            description: input.description,
            sources: input.sources
          };

          // Do NOT add H1 title - the site generator adds it from frontmatter
          // This prevents duplicate titles in the rendered output
          const fullContent = matter.stringify(input.content, frontmatterData);

          fs.writeFileSync(fullPath, fullContent, 'utf-8');
          return `Successfully wrote wiki page: ${input.pagePath}`;
        }

        case 'analyze_code_structure': {
          const filePath = path.join(this.repoPath, input.filePath);
          if (!fs.existsSync(filePath)) {
            return `Error: File not found: ${input.filePath}`;
          }

          const content = fs.readFileSync(filePath, 'utf-8');
          const lines = content.split('\n');
          const ext = path.extname(input.filePath);

          const analysis = {
            functions: [] as Array<{ name: string; line: number }>,
            classes: [] as Array<{ name: string; line: number }>,
            imports: [] as Array<{ module: string; line: number }>,
            exports: [] as Array<{ name: string; line: number }>
          };

          if (['.ts', '.tsx', '.js', '.jsx'].includes(ext)) {
            lines.forEach((line, idx) => {
              const lineNum = idx + 1;
              const funcMatch = line.match(/(?:export\s+)?(?:async\s+)?function\s+(\w+)/);
              if (funcMatch) analysis.functions.push({ name: funcMatch[1], line: lineNum });

              const classMatch = line.match(/(?:export\s+)?class\s+(\w+)/);
              if (classMatch) analysis.classes.push({ name: classMatch[1], line: lineNum });

              const importMatch = line.match(/import\s+.*\s+from\s+['"]([^'"]+)['"]/);
              if (importMatch) analysis.imports.push({ module: importMatch[1], line: lineNum });

              const exportMatch = line.match(/export\s+(?:default\s+)?(?:class|function|const|let|var|interface|type)\s+(\w+)/);
              if (exportMatch) analysis.exports.push({ name: exportMatch[1], line: lineNum });
            });
          }

          let output = `# Code Analysis: ${input.filePath}\n`;
          output += `Lines: ${lines.length}\n\n`;
          output += `Functions (${analysis.functions.length}): ${analysis.functions.map(f => `${f.name}:${f.line}`).join(', ')}\n`;
          output += `Classes (${analysis.classes.length}): ${analysis.classes.map(c => `${c.name}:${c.line}`).join(', ')}\n`;
          output += `Imports (${analysis.imports.length}): ${analysis.imports.map(i => i.module).join(', ')}\n`;
          output += `Exports (${analysis.exports.length}): ${analysis.exports.map(e => e.name).join(', ')}`;

          return output;
        }

        case 'verify_wiki_completeness': {
          const result = await this.verifyWikiCompleteness(this.outputDir);

          let response = `# Wiki Completeness Report\n\n`;
          response += `Total pages: ${result.totalPages}\n`;
          response += `Missing pages: ${result.missingPages.length}\n`;
          response += `Broken links: ${result.brokenLinks.length}\n\n`;

          if (result.isComplete) {
            response += '✅ All internal links are valid! The wiki is complete.';
          } else {
            response += '❌ Missing Pages (MUST CREATE):\n\n';
            for (const link of result.brokenLinks) {
              response += `- ${link.target} (referenced from ${link.source})\n`;
            }
          }

          return response;
        }

        case 'list_wiki_pages': {
          const wikiFiles = this.findAllWikiFiles(this.outputDir);
          const pages = wikiFiles.map(f => {
            const relativePath = path.relative(this.outputDir, f).replace(/\\/g, '/');
            return relativePath;
          });

          return `Wiki Pages (${pages.length} total):\n${pages.sort().map(p => `- ${p}`).join('\n')}`;
        }

        default:
          return `Error: Unknown tool: ${name}`;
      }
    } catch (error) {
      return `Error executing ${name}: ${error instanceof Error ? error.message : String(error)}`;
    }
  }

  /**
   * Build a directory tree string
   */
  private buildDirectoryTree(dirPath: string, maxDepth: number, currentDepth: number, prefix: string = ''): string {
    if (currentDepth >= maxDepth || !fs.existsSync(dirPath)) {
      return '';
    }

    const entries = fs.readdirSync(dirPath, { withFileTypes: true })
      .filter(e => !e.name.startsWith('.') && e.name !== 'node_modules');

    let result = '';
    entries.forEach((entry, index) => {
      const isLast = index === entries.length - 1;
      const connector = isLast ? '└── ' : '├── ';
      const childPrefix = isLast ? '    ' : '│   ';

      result += `${prefix}${connector}${entry.name}\n`;

      if (entry.isDirectory()) {
        const childPath = path.join(dirPath, entry.name);
        result += this.buildDirectoryTree(childPath, maxDepth, currentDepth + 1, prefix + childPrefix);
      }
    });

    return result;
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
        'mcp__tedmosby__analyze_code_structure',
        'mcp__tedmosby__verify_wiki_completeness',
        'mcp__tedmosby__list_wiki_pages'
      ],
      maxTurns: wikiOptions.maxTurns || 200,
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

    // Continuation mode - only generate missing pages
    if (options.missingPages && options.missingPages.length > 0) {
      const missingList = options.missingPages.map(p => `- ${p}`).join('\n');
      return `Continue generating the architectural documentation wiki. Some pages are missing and need to be created.

**Repository:** ${options.repoUrl}
**Output Directory:** ${this.outputDir}

## Missing Pages That MUST Be Created

The following wiki pages are referenced but do not exist. You MUST create each of these:

${missingList}

## Instructions

1. First, use \`mcp__tedmosby__list_wiki_pages\` to see what pages already exist
2. For each missing page above:
   - Use \`mcp__tedmosby__search_codebase\` to find relevant code for that topic
   - Use \`mcp__filesystem__read_file\` to read the specific source files
   - Use \`mcp__tedmosby__write_wiki_page\` to create the page with proper source traceability
3. After creating all pages, use \`mcp__tedmosby__verify_wiki_completeness\` to confirm all links are valid

Remember: Every architectural concept MUST include file:line references to the source code.
Do NOT modify existing pages unless they have broken internal links that need fixing.`;
    }

    // Full generation mode
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

**IMPORTANT:** After generating all pages, you MUST:
5. Use \`mcp__tedmosby__verify_wiki_completeness\` to check for broken links
6. If any pages are missing, create them immediately
7. Repeat verification until all links are valid

Remember: Every architectural concept MUST include file:line references to the source code.`;
  }

  /**
   * Create custom MCP tool server for wiki-specific operations
   */
  private createCustomToolServer() {
    const tools: any[] = [];

    // Tool 1: search_codebase - RAG-powered semantic search
    // Get configured max results (default 10, can be limited for large codebases)
    const configuredMaxResults = currentGenerationOptions?.maxSearchResults || 10;

    tools.push(
      tool(
        'search_codebase',
        'Semantic search over the codebase using embeddings. Returns relevant code snippets with file paths and line numbers. Use this to find code related to architectural concepts you are documenting.',
        {
          query: z.string().describe('Natural language search query (e.g., "authentication handling", "database connection")'),
          maxResults: z.number().min(1).max(20).optional().default(configuredMaxResults).describe('Maximum number of results to return'),
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
            // Apply configured limit
            const effectiveMaxResults = Math.min(args.maxResults || configuredMaxResults, configuredMaxResults);
            const results = await this.ragSystem.search(args.query, {
              maxResults: effectiveMaxResults,
              fileTypes: args.fileTypes,
              excludeTests: args.excludeTests ?? true
            });

            const formatted = results.map((r, i) => {
              // Build domain context section if available
              let domainSection = '';
              if (r.chunkType || r.name || r.domainCategories?.length) {
                domainSection = '\n**Domain Context:**\n';
                if (r.chunkType) domainSection += `- Type: ${r.chunkType}\n`;
                if (r.name) domainSection += `- Name: ${r.name}\n`;
                if (r.parentName) domainSection += `- Parent: ${r.parentName}\n`;
                if (r.domainCategories?.length) {
                  domainSection += `- Business Domains: ${r.domainCategories.join(', ')}\n`;
                }
                if (r.signature) domainSection += `- Signature: \`${r.signature}\`\n`;
                if (r.isPublicApi) domainSection += `- Public API: yes\n`;
              }

              // Add documentation snippet if available
              let docSection = '';
              if (r.documentation) {
                const docSnippet = r.documentation.slice(0, 300);
                docSection = `\n**Documentation:**\n\`\`\`\n${docSnippet}${docSnippet.length < r.documentation.length ? '...' : ''}\n\`\`\`\n`;
              }

              return `### Result ${i + 1} (score: ${r.score.toFixed(3)})\n` +
                `**Source:** \`${r.filePath}:${r.startLine}-${r.endLine}\`\n` +
                domainSection +
                docSection +
                '\n```' + (r.language || '') + '\n' + r.content + '\n```';
            }).join('\n\n');

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
            // Do NOT add H1 title - the site generator adds it from frontmatter
            // This prevents duplicate titles in the rendered output
            const frontmatterData: Record<string, any> = {
              title: args.title,
              generated: new Date().toISOString(),
              ...args.frontmatter
            };

            const fullContent = matter.stringify(args.content, frontmatterData);

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

    // Tool 4: verify_wiki_completeness - Check for broken internal links and missing pages
    tools.push(
      tool(
        'verify_wiki_completeness',
        'Verify that all internal links in the wiki resolve to actual pages. Returns a list of missing pages that need to be created. ALWAYS run this after generating wiki pages to ensure completeness.',
        {
          fixBrokenLinks: z.boolean().optional().default(false).describe('If true, returns suggested content for missing pages')
        },
        async (args) => {
          try {
            const wikiFiles = this.findAllWikiFiles(this.outputDir);
            const existingPages = new Set(wikiFiles.map(f =>
              path.relative(this.outputDir, f).replace(/\\/g, '/')
            ));

            const brokenLinks: Array<{
              sourcePage: string;
              targetLink: string;
              linkText: string;
            }> = [];

            const allReferencedPages = new Set<string>();

            // Scan all wiki files for internal links
            for (const file of wikiFiles) {
              const content = fs.readFileSync(file, 'utf-8');
              const relativePath = path.relative(this.outputDir, file).replace(/\\/g, '/');
              const fileDir = path.dirname(file);

              // Find all markdown links
              const linkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
              let match;

              while ((match = linkRegex.exec(content)) !== null) {
                const linkText = match[1];
                const linkPath = match[2];

                // Skip external links, anchors, and source code references
                if (linkPath.startsWith('http://') ||
                    linkPath.startsWith('https://') ||
                    linkPath.startsWith('#') ||
                    linkPath.includes('github.com') ||
                    linkPath.match(/\.(ts|js|py|go|rs|java|tsx|jsx)[:L#]/)) {
                  continue;
                }

                // Resolve internal markdown links
                if (linkPath.endsWith('.md') || linkPath.includes('.md#')) {
                  const cleanPath = linkPath.split('#')[0];
                  const resolvedPath = path.resolve(fileDir, cleanPath);
                  const relativeResolved = path.relative(this.outputDir, resolvedPath).replace(/\\/g, '/');

                  allReferencedPages.add(relativeResolved);

                  if (!fs.existsSync(resolvedPath)) {
                    brokenLinks.push({
                      sourcePage: relativePath,
                      targetLink: cleanPath,
                      linkText
                    });
                  }
                }
              }
            }

            // Find missing pages (referenced but not created)
            const missingPages = [...allReferencedPages].filter(p => !existingPages.has(p));

            // Build response
            let response = `# Wiki Completeness Report\n\n`;
            response += `**Total pages:** ${existingPages.size}\n`;
            response += `**Referenced pages:** ${allReferencedPages.size}\n`;
            response += `**Missing pages:** ${missingPages.length}\n`;
            response += `**Broken links:** ${brokenLinks.length}\n\n`;

            if (brokenLinks.length === 0) {
              response += `✅ **All internal links are valid!** The wiki is complete.\n`;
            } else {
              response += `## ❌ Missing Pages (MUST CREATE)\n\n`;
              response += `The following pages are referenced but do not exist. You MUST create these pages:\n\n`;

              // Group by missing page
              const byMissingPage = new Map<string, Array<{ source: string; text: string }>>();
              for (const link of brokenLinks) {
                const key = link.targetLink;
                if (!byMissingPage.has(key)) {
                  byMissingPage.set(key, []);
                }
                byMissingPage.get(key)!.push({ source: link.sourcePage, text: link.linkText });
              }

              for (const [missingPage, references] of byMissingPage) {
                response += `### ${missingPage}\n`;
                response += `Referenced by:\n`;
                for (const ref of references) {
                  response += `- \`${ref.source}\` (link text: "${ref.text}")\n`;
                }
                response += `\n`;
              }

              response += `\n## Action Required\n\n`;
              response += `Use \`mcp__tedmosby__write_wiki_page\` to create each missing page above.\n`;
              response += `After creating all pages, run \`mcp__tedmosby__verify_wiki_completeness\` again to confirm.\n`;
            }

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
                text: `Verification error: ${error instanceof Error ? error.message : String(error)}`
              }]
            };
          }
        }
      )
    );

    // Tool 5: list_wiki_pages - List all created wiki pages
    tools.push(
      tool(
        'list_wiki_pages',
        'List all wiki pages that have been created in the output directory.',
        {},
        async () => {
          try {
            const wikiFiles = this.findAllWikiFiles(this.outputDir);
            const pages = wikiFiles.map(f => {
              const relativePath = path.relative(this.outputDir, f).replace(/\\/g, '/');
              const content = fs.readFileSync(f, 'utf-8');
              const titleMatch = content.match(/^#\s+(.+)$/m);
              return {
                path: relativePath,
                title: titleMatch ? titleMatch[1] : path.basename(f, '.md')
              };
            });

            let response = `# Wiki Pages (${pages.length} total)\n\n`;
            for (const page of pages.sort((a, b) => a.path.localeCompare(b.path))) {
              response += `- \`${page.path}\` - ${page.title}\n`;
            }

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
                text: `Error listing pages: ${error instanceof Error ? error.message : String(error)}`
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

  /**
   * Find all markdown files in a directory recursively
   */
  private findAllWikiFiles(dir: string): string[] {
    const files: string[] = [];

    if (!fs.existsSync(dir)) {
      return files;
    }

    const entries = fs.readdirSync(dir, { withFileTypes: true });
    for (const entry of entries) {
      const fullPath = path.join(dir, entry.name);
      if (entry.isDirectory() && !entry.name.startsWith('.')) {
        files.push(...this.findAllWikiFiles(fullPath));
      } else if (entry.isFile() && entry.name.endsWith('.md')) {
        files.push(fullPath);
      }
    }

    return files;
  }

  /**
   * Verify wiki completeness and return missing pages
   */
  async verifyWikiCompleteness(wikiDir: string): Promise<{
    totalPages: number;
    brokenLinks: Array<{ source: string; target: string; linkText: string; resolvedTarget: string }>;
    missingPages: string[];
    isComplete: boolean;
  }> {
    const wikiFiles = this.findAllWikiFiles(wikiDir);
    const absoluteWikiDir = path.resolve(wikiDir);

    // Build set of existing pages using normalized absolute paths
    const existingPagesAbsolute = new Set(wikiFiles.map(f => path.resolve(f)));
    const existingPagesRelative = new Set(wikiFiles.map(f =>
      path.relative(wikiDir, f).replace(/\\/g, '/')
    ));

    const brokenLinks: Array<{ source: string; target: string; linkText: string; resolvedTarget: string }> = [];
    const allReferencedPages = new Set<string>();
    const seenBrokenTargets = new Set<string>(); // Track unique broken targets by resolved path

    for (const file of wikiFiles) {
      const content = fs.readFileSync(file, 'utf-8');
      const relativePath = path.relative(wikiDir, file).replace(/\\/g, '/');
      const fileDir = path.dirname(file);

      // Match markdown links: [text](path) and also wiki-style [[links]]
      const mdLinkRegex = /\[([^\]]+)\]\(([^)]+)\)/g;
      const wikiLinkRegex = /\[\[([^\]|]+)(?:\|[^\]]+)?\]\]/g;

      const processLink = (linkText: string, linkPath: string) => {
        // Skip external links, anchors, and source code references
        if (linkPath.startsWith('http://') ||
            linkPath.startsWith('https://') ||
            linkPath.startsWith('#') ||
            linkPath.startsWith('mailto:') ||
            linkPath.includes('github.com') ||
            linkPath.match(/\.(ts|js|py|go|rs|java|tsx|jsx|cbl|cob|cpy|jcl)[:L#]/i)) {
          return;
        }

        // Handle .md links
        if (linkPath.endsWith('.md') || linkPath.includes('.md#')) {
          const cleanPath = linkPath.split('#')[0];

          // Resolve the path relative to the source file's directory
          const resolvedPath = path.resolve(fileDir, cleanPath);

          // Normalize to relative path from wiki root
          const relativeResolved = path.relative(absoluteWikiDir, resolvedPath).replace(/\\/g, '/');

          // Skip links that resolve outside the wiki directory
          if (relativeResolved.startsWith('..')) {
            return;
          }

          allReferencedPages.add(relativeResolved);

          // Check if the file exists
          if (!existingPagesAbsolute.has(resolvedPath)) {
            // Only add if we haven't seen this resolved target before
            if (!seenBrokenTargets.has(relativeResolved)) {
              seenBrokenTargets.add(relativeResolved);
              brokenLinks.push({
                source: relativePath,
                target: cleanPath,  // Original link for display
                linkText,
                resolvedTarget: relativeResolved  // Normalized path for deduplication
              });
            }
          }
        }
      };

      // Process markdown links
      let match;
      while ((match = mdLinkRegex.exec(content)) !== null) {
        processLink(match[1], match[2]);
      }

      // Process wiki-style links [[Page Name]] or [[path/to/page|Display Name]]
      while ((match = wikiLinkRegex.exec(content)) !== null) {
        const linkTarget = match[1].trim();
        // Convert wiki-style to .md path if needed
        const linkPath = linkTarget.endsWith('.md') ? linkTarget : `${linkTarget}.md`;
        processLink(linkTarget, linkPath);
      }
    }

    // Missing pages are referenced pages that don't exist
    const missingPages = [...allReferencedPages].filter(p => !existingPagesRelative.has(p));

    return {
      totalPages: existingPagesRelative.size,
      brokenLinks,
      missingPages,
      isComplete: brokenLinks.length === 0
    };
  }
}
