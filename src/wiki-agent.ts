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
import { createLLMProvider, type LLMProvider, type LLMMessage, type LLMTool } from './llm/index.js';
import { CodebaseDiscovery, generateHierarchicalIndex, generateComponentTable, type DiscoveryResult, type DiscoveredDomain } from './discovery/index.js';

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

  // Local mode options
  /**
   * Run entirely locally without cloud APIs.
   * Uses node-llama-cpp for in-process inference.
   */
  fullLocal?: boolean;
  /**
   * Local model to use (default: auto-selected based on hardware).
   * Can be a model ID from registry or an Ollama model name.
   */
  localModel?: string;
  /**
   * Model family for local mode. Currently only 'gpt-oss' (21B) is supported.
   */
  modelFamily?: 'gpt-oss';
  /**
   * Path to a local GGUF model file.
   */
  modelPath?: string;
  /**
   * Use Ollama server instead of bundled inference.
   */
  useOllama?: boolean;
  /**
   * Ollama server URL (default: http://localhost:11434).
   */
  ollamaHost?: string;
  /**
   * Number of GPU layers to offload (default: auto).
   */
  gpuLayers?: number;
  /**
   * Context window size for local models (default: 32768).
   */
  contextSize?: number;
  /**
   * CPU threads for local inference (default: auto).
   */
  threads?: number;

  /**
   * Update context for surgical wiki updates based on code changes.
   * When provided, the agent will focus on updating specific pages
   * rather than regenerating the entire wiki.
   */
  updateContext?: {
    /** New files added since last index */
    newFiles: string[];
    /** Files modified since last index */
    modifiedFiles: string[];
    /** Files deleted since last index */
    deletedFiles: string[];
    /** Existing wiki pages that reference changed files */
    affectedPages: string[];
    /** New wiki pages that should be created */
    pagesToCreate: string[];
  };

  // Contextual retrieval options
  /** Enable contextual retrieval for improved chunk understanding */
  useContextualRetrieval?: boolean;
  /** Use local LLM for contextual retrieval instead of Claude API */
  contextualLocal?: boolean;
  /** Use Ollama server for contextual retrieval (requires contextualLocal) */
  contextualUseOllama?: boolean;
  /** Anthropic API key for contextual retrieval */
  contextualApiKey?: string;
  /** Model for contextual retrieval (default: claude-3-haiku) */
  contextualModel?: string;
  /** Ollama host for contextual retrieval */
  contextualOllamaHost?: string;
  /** Local model name for contextual retrieval */
  contextualLocalModel?: string;
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

export interface LocalGenerationEstimate extends GenerationEstimate {
  isLocal: true;
  hardware: {
    gpuVendor: string;
    gpuName?: string;
    gpuVram: number;
    systemRam: number;
    cpuCores: number;
  };
  recommendedModel: {
    modelId: string;
    quality: string;
    fileSizeGb: number;
    contextLength: number;
    minVram: number;
    downloaded: boolean;
  };
  localEstimate: {
    tokensPerSecond: number;
    generationMinutes: number;
    downloadRequired: boolean;
    downloadSizeGb: number;
    diskSpaceRequired: number;
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
      storePath: path.join(this.outputDir, '.semanticwiki-cache'),
      repoPath: this.repoPath,
      maxChunks: options.maxChunks,  // Limit chunks for large codebases
      // Contextual retrieval options
      useContextualRetrieval: options.useContextualRetrieval,
      contextualLocal: options.contextualLocal,
      contextualUseOllama: options.contextualUseOllama,
      contextualApiKey: options.contextualApiKey || this.config.apiKey,
      contextualModel: options.contextualModel,
      contextualOllamaHost: options.contextualOllamaHost || options.ollamaHost,
      contextualLocalModel: options.contextualLocalModel
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
      storePath: path.join(this.outputDir, '.semanticwiki-cache'),
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
        storePath: path.join(this.outputDir, '.semanticwiki-cache'),
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
      storePath: path.join(this.outputDir, '.semanticwiki-cache'),
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

    const cachePath = path.join(this.outputDir, '.semanticwiki-cache');
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
    const cachePath = path.join(this.outputDir, '.semanticwiki-cache');
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
        maxChunks: options.maxChunks,
        // Contextual retrieval options
        useContextualRetrieval: options.useContextualRetrieval,
        contextualLocal: options.contextualLocal,
        contextualUseOllama: options.contextualUseOllama,
        contextualApiKey: options.contextualApiKey || this.config.apiKey,
        contextualModel: options.contextualModel,
        contextualOllamaHost: options.contextualOllamaHost || options.ollamaHost,
        contextualLocalModel: options.contextualLocalModel
      });
      await this.ragSystem.indexRepository();
    }

    const searchMode = this.ragSystem['index'] ? 'vector search' : 'keyword search';
    yield { type: 'step', message: `Loaded ${this.ragSystem.getDocumentCount()} chunks (${searchMode})` };

    // Phase 3: Run direct API agent (or local mode)
    const modeLabel = options.fullLocal ? 'Local Mode' : 'Direct API mode';
    yield { type: 'phase', message: `Generating wiki (${modeLabel})`, progress: 20 };

    // Create the appropriate LLM provider
    let provider: LLMProvider;
    try {
      provider = await createLLMProvider({
        fullLocal: options.fullLocal,
        useOllama: options.useOllama,
        ollamaHost: options.ollamaHost,
        localModel: options.localModel,
        modelFamily: options.modelFamily,
        modelPath: options.modelPath,
        gpuLayers: options.gpuLayers,
        contextSize: options.contextSize,
        threads: options.threads,
        model: options.model,
        apiKey: this.config.apiKey,
        verbose: options.verbose,
      });
    } catch (error) {
      const err = error as Error;
      yield { type: 'error', message: `Failed to initialize LLM provider: ${err.message}` };
      return;
    }

    const modelInfo = provider.getModelInfo();
    const maxTurns = options.maxTurns || 200;
    const prompt = this.buildGenerationPrompt(options);

    // Define tools for the API
    const tools = this.buildDirectApiTools();
    const llmTools: LLMTool[] = tools.map(t => ({
      name: t.name,
      description: t.description || '',
      parameters: t.input_schema as any
    }));

    console.log('\n' + '='.repeat(60));
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Starting ${modeLabel}`);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Model:`, modelInfo.name);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Max turns:`, maxTurns);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Tools:`, tools.length);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Repository:`, this.repoPath);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Output:`, this.outputDir);
    console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Chunks:`, this.ragSystem.getDocumentCount());
    if (options.fullLocal) {
      console.log(`[Local] Context size:`, modelInfo.contextLength);
      console.log(`[Local] Local inference:`, modelInfo.isLocal ? 'Yes' : 'No');
    }
    console.log('='.repeat(60) + '\n');

    // Build initial messages for our abstraction
    const messages: LLMMessage[] = [
      { role: 'user', content: prompt }
    ];

    // Also keep Anthropic format for backwards compatibility when not in local mode
    const anthropicMessages: Anthropic.MessageParam[] = [
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
          console.log(`\n[${options.fullLocal ? 'Local' : 'DirectAPI'}] === Turn ${turnCount} ===`);
        }

        // Call the LLM provider
        const response = await provider.chat(messages, llmTools, {
          maxTokens: 8192,
          systemPrompt: WIKI_SYSTEM_PROMPT,
          temperature: 0.7,
        });

        if (options.verbose) {
          console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Stop reason: ${response.stopReason}`);
          console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Usage: input=${response.usage.inputTokens}, output=${response.usage.outputTokens}`);
        }

        // Process response content - use explicit type for our content blocks
        type LocalContentBlock =
          | { type: 'text'; text: string }
          | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> };

        const assistantContent: LocalContentBlock[] = [];
        const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

        // Handle text content
        if (response.content) {
          assistantContent.push({ type: 'text', text: response.content });
          if (options.verbose) {
            console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Text: ${response.content.slice(0, 200)}${response.content.length > 200 ? '...' : ''}`);
          }
          yield { type: 'assistant', content: response.content };
        }

        // Handle tool calls
        for (const toolCall of response.toolCalls) {
          totalToolCalls++;
          if (options.verbose) {
            console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Tool call #${totalToolCalls}: ${toolCall.name}`);
            console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Input: ${JSON.stringify(toolCall.arguments).slice(0, 200)}`);
          }

          // Add tool use to assistant content
          assistantContent.push({
            type: 'tool_use',
            id: toolCall.id,
            name: toolCall.name,
            input: toolCall.arguments as Record<string, unknown>
          });

          // Execute the tool
          const result = await this.executeDirectApiTool(toolCall.name, toolCall.arguments as Record<string, any>);

          if (options.verbose) {
            console.log(`[${options.fullLocal ? 'Local' : 'DirectAPI'}] Result: ${result.slice(0, 200)}${result.length > 200 ? '...' : ''}`);
          }

          toolResults.push({
            type: 'tool_result',
            tool_use_id: toolCall.id,
            content: result
          });
        }

        // Add assistant message with text and tool uses
        // Map to our ContentBlock types from ./llm/types
        const mappedContent = assistantContent.map(block => {
          if (block.type === 'text') {
            return { type: 'text' as const, text: block.text };
          } else {
            return {
              type: 'tool_use' as const,
              id: block.id,
              name: block.name,
              input: block.input
            };
          }
        });

        const assistantMsg: LLMMessage = {
          role: 'assistant',
          content: mappedContent
        };
        messages.push(assistantMsg);

        // If there were tool uses, add results and continue
        if (toolResults.length > 0) {
          const toolResultMsg: LLMMessage = {
            role: 'user',
            content: toolResults.map(r => ({
              type: 'tool_result' as const,
              tool_use_id: r.tool_use_id,
              content: r.content
            }))
          };
          messages.push(toolResultMsg);
        }

        // Check if we're done
        const logPrefix = options.fullLocal ? 'Local' : 'DirectAPI';
        if (response.stopReason === 'end_turn' && toolResults.length === 0) {
          done = true;
          console.log(`[${logPrefix}] Agent finished naturally after ${turnCount} turns`);
        } else if (response.stopReason === 'max_tokens') {
          console.log(`[${logPrefix}] Warning: Hit max_tokens, continuing...`);
        }
      }

      const logPrefix = options.fullLocal ? 'Local' : 'DirectAPI';
      if (!done && turnCount >= maxTurns) {
        console.log(`[${logPrefix}] Warning: Reached max turns (${maxTurns})`);
        yield { type: 'error', message: `Reached maximum turns (${maxTurns})` };
      }

      console.log('\n' + '='.repeat(60));
      console.log(`[${logPrefix}] Initial generation complete`);
      console.log(`[${logPrefix}] Total turns: ${turnCount}`);
      console.log(`[${logPrefix}] Total tool calls: ${totalToolCalls}`);
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
        console.log(`[${logPrefix}] Missing pages: ${missingPages.join(', ')}`);

        // Generate missing pages
        const continuationPrompt = `Continue generating wiki pages. The following pages are referenced but do not exist:

${missingPages.map(p => `- ${p}`).join('\n')}

For EACH missing page:
1. Use search_codebase to find relevant code for that topic
2. Use read_file to read the specific source files
3. Use write_wiki_page to create the page with proper source traceability

Remember: Every architectural concept MUST include file:line references to the source code.
Create all ${missingPages.length} missing pages now.`;

        // Reset for continuation using LLM provider format
        const continuationMessages: LLMMessage[] = [
          { role: 'user', content: continuationPrompt }
        ];

        let continuationTurns = 0;
        const maxContinuationTurns = Math.min(50, maxTurns - turnCount);  // Don't exceed remaining turns

        while (continuationTurns < maxContinuationTurns) {
          continuationTurns++;
          turnCount++;

          const response = await provider.chat(continuationMessages, llmTools, {
            maxTokens: 8192,
            systemPrompt: WIKI_SYSTEM_PROMPT,
            temperature: 0.7,
          });

          if (options.verbose) {
            console.log(`[${logPrefix}] Continuation turn ${continuationTurns}: ${response.stopReason}`);
          }

          const assistantContentBlocks: Array<{ type: 'text'; text: string } | { type: 'tool_use'; id: string; name: string; input: Record<string, unknown> }> = [];
          const toolResults: Array<{ type: 'tool_result'; tool_use_id: string; content: string }> = [];

          // Handle text content
          if (response.content) {
            assistantContentBlocks.push({ type: 'text', text: response.content });
          }

          // Handle tool calls
          for (const toolCall of response.toolCalls) {
            totalToolCalls++;
            assistantContentBlocks.push({
              type: 'tool_use',
              id: toolCall.id,
              name: toolCall.name,
              input: toolCall.arguments
            });

            const result = await this.executeDirectApiTool(toolCall.name, toolCall.arguments as Record<string, any>);
            toolResults.push({
              type: 'tool_result',
              tool_use_id: toolCall.id,
              content: result
            });

            if (options.verbose) {
              console.log(`[${logPrefix}] Tool: ${toolCall.name}`);
            }
          }

          continuationMessages.push({ role: 'assistant', content: assistantContentBlocks });

          if (toolResults.length > 0) {
            continuationMessages.push({
              role: 'user',
              content: toolResults.map(r => ({
                type: 'tool_result' as const,
                tool_use_id: r.tool_use_id,
                content: r.content
              }))
            });
          }

          if (response.stopReason === 'end_turn' && toolResults.length === 0) {
            break;
          }
        }
      }

      if (verificationAttempts >= maxVerificationAttempts) {
        console.log(`[${logPrefix}] Warning: Max verification attempts (${maxVerificationAttempts}) reached`);
        const finalCheck = await this.verifyWikiCompleteness(this.outputDir);
        if (!finalCheck.isComplete) {
          console.log(`[${logPrefix}] ${finalCheck.brokenLinks.length} broken links remain`);
          yield { type: 'step', message: `Warning: ${finalCheck.brokenLinks.length} broken links remain`, progress: 95 };
        }
      }

      // Shutdown the provider
      await provider.shutdown();

      console.log('\n' + '='.repeat(60));
      console.log(`[${logPrefix}] GENERATION COMPLETE`);
      console.log(`[${logPrefix}] Total turns: ${turnCount}`);
      console.log(`[${logPrefix}] Total tool calls: ${totalToolCalls}`);
      console.log('='.repeat(60) + '\n');

      yield { type: 'complete', message: `Wiki generation complete (${modeLabel})`, progress: 100 };
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
   * Generate wiki using local LLM with page-by-page approach.
   * Simpler and more reliable than full agent loop for local models.
   */
  async *generateWikiLocalPageByPage(
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
    const cachePath = path.join(this.outputDir, '.semanticwiki-cache');
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
        maxChunks: options.maxChunks,
        // Contextual retrieval options
        useContextualRetrieval: options.useContextualRetrieval,
        contextualLocal: options.contextualLocal,
        contextualUseOllama: options.contextualUseOllama,
        contextualApiKey: options.contextualApiKey || this.config.apiKey,
        contextualModel: options.contextualModel,
        contextualOllamaHost: options.contextualOllamaHost || options.ollamaHost,
        contextualLocalModel: options.contextualLocalModel
      });
      await this.ragSystem.indexRepository();
    }

    const searchMode = this.ragSystem['index'] ? 'vector search' : 'keyword search';
    yield { type: 'step', message: `Loaded ${this.ragSystem.getDocumentCount()} chunks (${searchMode})` };

    // Phase 2.5: Run codebase discovery for hierarchical structure
    yield { type: 'phase', message: 'Discovering codebase structure', progress: 12 };

    const discovery = new CodebaseDiscovery({
      repoPath: this.repoPath,
      targetPath: options.targetPath,
      verbose: options.verbose,
    });

    const discoveryResult = await discovery.discover();
    yield { type: 'step', message: `Discovered ${discoveryResult.domains.length} domains, ${discoveryResult.wikiStructure.sections.length} sections` };

    // Phase 3: Initialize local LLM provider
    yield { type: 'phase', message: 'Initializing local LLM', progress: 15 };

    let provider: LLMProvider | null = null;
    let pagesSinceProviderInit = 0;
    const PROVIDER_RESET_THRESHOLD = 15; // Reset before hitting 20 sequence limit

    // Helper to (re)initialize provider
    const initializeProvider = async (): Promise<LLMProvider> => {
      if (provider && 'shutdown' in provider) {
        try {
          await (provider as any).shutdown();
        } catch {
          // Ignore shutdown errors
        }
      }
      const newProvider = await createLLMProvider({
        fullLocal: true,
        useOllama: options.useOllama,
        ollamaHost: options.ollamaHost,
        localModel: options.localModel,
        modelFamily: options.modelFamily,
        modelPath: options.modelPath,
        gpuLayers: options.gpuLayers,
        contextSize: options.contextSize,
        threads: options.threads,
        verbose: options.verbose,
      });
      provider = newProvider;
      pagesSinceProviderInit = 0;
      return newProvider;
    };

    try {
      provider = await initializeProvider();
    } catch (error) {
      const err = error as Error;
      yield { type: 'error', message: `Failed to initialize local LLM: ${err.message}` };
      return;
    }

    const modelInfo = provider.getModelInfo();
    console.log('\n' + '='.repeat(60));
    console.log('[Local] Page-by-Page Generation Mode');
    console.log('[Local] Model:', modelInfo.name);
    console.log('[Local] Context:', modelInfo.contextLength, 'tokens');
    console.log('[Local] Repository:', this.repoPath);
    console.log('[Local] Output:', this.outputDir);
    console.log('='.repeat(60) + '\n');

    // Phase 4: Use discovery results + LLM to plan pages
    yield { type: 'phase', message: 'Planning wiki pages from discovery', progress: 20 };

    const pagesToGenerate = await this.planPagesFromDiscovery(provider, discoveryResult, options);
    console.log(`[Local] Identified ${pagesToGenerate.length} pages to generate\n`);

    // Generate hierarchical index.md first
    console.log('[Local] Generating hierarchical index.md');
    const indexContent = this.generateEnhancedIndex(discoveryResult, pagesToGenerate);
    fs.writeFileSync(path.join(this.outputDir, 'index.md'), indexContent, 'utf-8');
    yield { type: 'file', message: 'index.md', detail: 'Hierarchical Index' };

    // Phase 5: Generate each page one at a time
    yield { type: 'phase', message: `Generating ${pagesToGenerate.length} wiki pages`, progress: 25 };

    let pagesGenerated = 0;
    let pagesFailed = 0;

    for (const pageSpec of pagesToGenerate) {
      const progress = 25 + ((pagesGenerated / pagesToGenerate.length) * 70);
      yield { type: 'step', message: `Generating: ${pageSpec.title}`, progress };

      console.log(`\n[Local] ─── Page ${pagesGenerated + 1}/${pagesToGenerate.length}: ${pageSpec.title} ───`);

      // Check if we need to reinitialize provider before hitting sequence limit
      if (pagesSinceProviderInit >= PROVIDER_RESET_THRESHOLD) {
        console.log(`[Local] Resetting LLM provider (${pagesSinceProviderInit} pages since last reset)...`);
        try {
          await initializeProvider();
        } catch (error) {
          console.error(`[Local] Failed to reinitialize provider: ${(error as Error).message}`);
        }
      }

      try {
        const content = await this.generateSinglePage(provider, pageSpec, pagesToGenerate, options);
        pagesSinceProviderInit++;

        if (content) {
          // Write the page
          const pagePath = path.join(this.outputDir, pageSpec.filename);
          const pageDir = path.dirname(pagePath);
          if (!fs.existsSync(pageDir)) {
            fs.mkdirSync(pageDir, { recursive: true });
          }
          fs.writeFileSync(pagePath, content, 'utf-8');

          console.log(`[Local] ✓ Generated: ${pageSpec.filename}`);
          pagesGenerated++;
          yield { type: 'file', message: pageSpec.filename, detail: pageSpec.title };
        } else {
          console.log(`[Local] ⚠ Empty content for: ${pageSpec.title}`);
          pagesFailed++;
        }
      } catch (error) {
        const err = error as Error;
        // Handle sequence exhaustion - reinitialize and retry once
        if (err.message.includes('No sequences left')) {
          console.log(`[Local] Sequence exhausted, reinitializing provider and retrying...`);
          try {
            await initializeProvider();
            const content = await this.generateSinglePage(provider, pageSpec, pagesToGenerate, options);
            pagesSinceProviderInit++;

            if (content) {
              const pagePath = path.join(this.outputDir, pageSpec.filename);
              const pageDir = path.dirname(pagePath);
              if (!fs.existsSync(pageDir)) {
                fs.mkdirSync(pageDir, { recursive: true });
              }
              fs.writeFileSync(pagePath, content, 'utf-8');
              console.log(`[Local] ✓ Generated (after retry): ${pageSpec.filename}`);
              pagesGenerated++;
              yield { type: 'file', message: pageSpec.filename, detail: pageSpec.title };
            } else {
              console.log(`[Local] ⚠ Empty content for: ${pageSpec.title}`);
              pagesFailed++;
            }
          } catch (retryError) {
            console.error(`[Local] ✗ Failed after retry: ${pageSpec.title} - ${(retryError as Error).message}`);
            pagesFailed++;
          }
        } else {
          console.error(`[Local] ✗ Failed: ${pageSpec.title} - ${err.message}`);
          pagesFailed++;
        }
      }
    }

    // Phase 6: Verification loop - generate missing pages until all cross-links resolve
    yield { type: 'phase', message: 'Verifying cross-links', progress: 85 };

    const maxVerificationAttempts = 5;
    let verificationAttempts = 0;
    const generatedFilenames = new Set(pagesToGenerate.map(p => p.filename));

    while (verificationAttempts < maxVerificationAttempts) {
      verificationAttempts++;
      const verification = await this.verifyWikiCompleteness(this.outputDir);

      console.log(`[Local] Verification #${verificationAttempts}: ${verification.totalPages} pages, ${verification.brokenLinks.length} broken links`);

      if (verification.isComplete) {
        console.log('[Local] ✓ Wiki is complete! All cross-links are valid.');
        yield { type: 'step', message: 'All cross-links verified', progress: 90 };
        break;
      }

      // Get unique missing pages we haven't generated yet
      const missingPages = [...new Set(verification.brokenLinks.map(l => l.resolvedTarget))]
        .filter(target => !generatedFilenames.has(target));

      if (missingPages.length === 0) {
        console.log('[Local] No new pages to generate, but some links remain broken');
        break;
      }

      yield {
        type: 'step',
        message: `Found ${missingPages.length} missing pages, generating...`,
        progress: 85 + verificationAttempts
      };

      // Generate missing pages
      for (const missingFile of missingPages.slice(0, 5)) { // Limit to 5 per iteration
        const pageName = path.basename(missingFile, '.md');
        const pageTitle = this.formatDirectoryName(pageName);

        console.log(`[Local] ─── Generating missing page: ${pageTitle} ───`);

        // Check if we need to reinitialize provider
        if (pagesSinceProviderInit >= PROVIDER_RESET_THRESHOLD) {
          console.log(`[Local] Resetting LLM provider (${pagesSinceProviderInit} pages since last reset)...`);
          try {
            await initializeProvider();
          } catch (error) {
            console.error(`[Local] Failed to reinitialize provider: ${(error as Error).message}`);
          }
        }

        // Find broken links that reference this page to get context
        const referencingLinks = verification.brokenLinks.filter(l => l.resolvedTarget === missingFile);
        const linkContexts = referencingLinks.map(l => l.linkText).join(', ');

        const missingPageSpec = {
          title: pageTitle,
          filename: missingFile,
          type: 'module' as const,
          context: `Documentation for ${pageTitle}. Referenced from: ${linkContexts || 'other pages'}`,
          sourceFiles: [] as string[],
        };

        // Try to find relevant source files for this page
        const sourceFiles = await this.scanSourceFiles(this.repoPath);
        const relevantFiles = sourceFiles.filter(f =>
          f.toLowerCase().includes(pageName.toLowerCase()) ||
          path.basename(f, path.extname(f)).toLowerCase() === pageName.toLowerCase()
        );
        missingPageSpec.sourceFiles = relevantFiles.slice(0, 10);

        try {
          const content = await this.generateSinglePage(
            provider,
            missingPageSpec,
            [...pagesToGenerate, missingPageSpec],
            options
          );
          pagesSinceProviderInit++;

          if (content) {
            const pagePath = path.join(this.outputDir, missingFile);
            const pageDir = path.dirname(pagePath);
            if (!fs.existsSync(pageDir)) {
              fs.mkdirSync(pageDir, { recursive: true });
            }
            fs.writeFileSync(pagePath, content, 'utf-8');

            console.log(`[Local] ✓ Generated missing page: ${missingFile}`);
            pagesGenerated++;
            generatedFilenames.add(missingFile);
            pagesToGenerate.push(missingPageSpec);
            yield { type: 'file', message: missingFile, detail: pageTitle };
          }
        } catch (error) {
          const err = error as Error;
          // Handle sequence exhaustion
          if (err.message.includes('No sequences left')) {
            console.log(`[Local] Sequence exhausted, reinitializing provider and retrying...`);
            try {
              await initializeProvider();
              const content = await this.generateSinglePage(
                provider,
                missingPageSpec,
                [...pagesToGenerate, missingPageSpec],
                options
              );
              pagesSinceProviderInit++;

              if (content) {
                const pagePath = path.join(this.outputDir, missingFile);
                const pageDir = path.dirname(pagePath);
                if (!fs.existsSync(pageDir)) {
                  fs.mkdirSync(pageDir, { recursive: true });
                }
                fs.writeFileSync(pagePath, content, 'utf-8');
                console.log(`[Local] ✓ Generated missing page (after retry): ${missingFile}`);
                pagesGenerated++;
                generatedFilenames.add(missingFile);
                pagesToGenerate.push(missingPageSpec);
                yield { type: 'file', message: missingFile, detail: pageTitle };
              }
            } catch (retryError) {
              console.error(`[Local] ✗ Failed to generate missing page after retry: ${missingFile}`);
              pagesFailed++;
            }
          } else {
            console.error(`[Local] ✗ Failed to generate missing page: ${missingFile}`);
            pagesFailed++;
          }
        }
      }
    }

    if (verificationAttempts >= maxVerificationAttempts) {
      const finalCheck = await this.verifyWikiCompleteness(this.outputDir);
      if (!finalCheck.isComplete) {
        console.log(`[Local] ⚠ Max verification attempts reached. ${finalCheck.brokenLinks.length} broken links remain.`);
        yield { type: 'step', message: `Warning: ${finalCheck.brokenLinks.length} broken links remain`, progress: 90 };
      }
    }

    // Phase 7: Generate index page
    yield { type: 'phase', message: 'Generating index page', progress: 95 };

    try {
      const indexContent = await this.generateIndexPage(provider, pagesToGenerate, options);
      if (indexContent) {
        fs.writeFileSync(path.join(this.outputDir, 'index.md'), indexContent, 'utf-8');
        console.log(`[Local] ✓ Generated: index.md`);
      }
    } catch (error) {
      console.error(`[Local] ✗ Failed to generate index page`);
    }

    // Shutdown provider
    await provider.shutdown();

    console.log('\n' + '='.repeat(60));
    console.log('[Local] GENERATION COMPLETE');
    console.log(`[Local] Pages generated: ${pagesGenerated}`);
    console.log(`[Local] Pages failed: ${pagesFailed}`);
    console.log('='.repeat(60) + '\n');

    yield { type: 'complete', message: `Local generation complete: ${pagesGenerated} pages`, progress: 100 };
  }

  /**
   * Use LLM to intelligently analyze project files and determine what pages to generate.
   * This is project-agnostic and doesn't rely on hardcoded patterns.
   */
  private async analyzeProjectWithLLM(
    provider: LLMProvider,
    options: WikiGenerationOptions
  ): Promise<Array<{
    title: string;
    filename: string;
    type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config';
    context: string;
    sourceFiles: string[];
  }>> {
    // 1. Gather all files with metadata
    const allFiles = await this.gatherProjectFiles(this.repoPath);
    console.log(`[Local] Gathered ${allFiles.length} project files for LLM analysis`);

    // 2. Calculate minimum pages based on source file count
    const docExtensions = new Set(['.md', '.txt', '.rst', '.adoc']);
    const sourceFiles = allFiles.filter(f => !docExtensions.has(f.extension));
    const minPages = Math.max(5, Math.min(25, Math.ceil(sourceFiles.length / 8)));
    console.log(`[Local] Source files: ${sourceFiles.length}, minimum pages: ${minPages}`);

    // 3. Build a compact representation for the LLM
    const fileList = allFiles.map(f => {
      const sizeLabel = f.size < 1000 ? 'small' : f.size < 10000 ? 'medium' : 'large';
      return `${f.relativePath} (${f.extension}, ${sizeLabel})`;
    }).join('\n');

    // 4. Summarize file types for the LLM
    const extCounts = new Map<string, number>();
    for (const f of allFiles) {
      extCounts.set(f.extension, (extCounts.get(f.extension) || 0) + 1);
    }
    const extSummary = Array.from(extCounts.entries())
      .sort((a, b) => b[1] - a[1])
      .map(([ext, count]) => `${ext}: ${count} files`)
      .join(', ');

    // 5. Generate language-aware grouping suggestions
    const groupingSuggestions = this.generateGroupingSuggestions(extCounts, sourceFiles.length);

    // 6. Ask LLM to analyze and categorize files
    const analysisPrompt = `You are analyzing a software project to create comprehensive architectural documentation.

## Project Statistics
- Total source files: ${sourceFiles.length}
- File types: ${extSummary}
- **Required pages: ${minPages}-${minPages + 10}** (based on project size)

## Project Files
${fileList}

## Task
Create a documentation plan with ${minPages}-${minPages + 10} pages. Return ONLY valid JSON:
{
  "projectType": "description of project type, language, and platform",
  "pages": [
    {
      "title": "Page Title",
      "filename": "page-slug.md",
      "type": "overview|component|module|guide|config",
      "context": "What this page documents - be specific about functionality",
      "files": ["path/to/file1.ext", "path/to/file2.ext"]
    }
  ]
}

## Grouping Suggestions for This Project
${groupingSuggestions}

## Requirements
1. **MINIMUM ${minPages} pages required** - the project has ${sourceFiles.length} source files
2. Every major program/module should be documented
3. Group by FUNCTIONALITY, not just file type
4. Each page should document 2-8 related files
5. Include specific file paths in the "files" array

## Page Types to Consider
- **overview**: System architecture, data flow, key concepts
- **component**: A functional unit (e.g., "User Authentication", "Payment Processing", "Report Generation")
- **module**: A technical module (e.g., "Database Layer", "API Handlers", "Utility Functions")
- **guide**: Setup, deployment, testing procedures
- **config**: Configuration, environment setup, build process

Return only the JSON, no markdown code blocks.`;

    const messages: LLMMessage[] = [{ role: 'user', content: analysisPrompt }];

    console.log(`[Local] Asking LLM to analyze project structure...`);

    try {
      const response = await provider.chat(messages, [], {
        maxTokens: 8192, // Increased for larger page lists
        systemPrompt: 'You are a software architect creating documentation plans. Return only valid JSON with comprehensive coverage.',
        temperature: 0.3,
      });

      if (!response.content) {
        console.log(`[Local] LLM returned empty response, falling back to pattern-based analysis`);
        return this.generateComprehensivePages(allFiles, minPages);
      }

      // Parse the JSON response
      let analysis: {
        projectType: string;
        pages: Array<{
          title: string;
          filename: string;
          type: string;
          context: string;
          files: string[];
        }>;
      };

      try {
        let jsonStr = response.content.trim();
        if (jsonStr.startsWith('```')) {
          jsonStr = jsonStr.replace(/^```(?:json)?\n?/, '').replace(/\n?```$/, '');
        }
        analysis = JSON.parse(jsonStr);
      } catch (parseErr) {
        console.log(`[Local] Failed to parse LLM response as JSON: ${(parseErr as Error).message}`);
        console.log(`[Local] Response was: ${response.content.slice(0, 500)}...`);
        return this.generateComprehensivePages(allFiles, minPages);
      }

      console.log(`[Local] LLM identified project as: ${analysis.projectType}`);
      console.log(`[Local] LLM suggested ${analysis.pages.length} documentation pages`);

      // Validate and filter the files (ensure they exist)
      const existingFiles = new Set(allFiles.map(f => f.relativePath));
      const validatedPages: Array<{
        title: string;
        filename: string;
        type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config';
        context: string;
        sourceFiles: string[];
      }> = [];

      for (const page of analysis.pages) {
        const validFiles = (page.files || []).filter(f => existingFiles.has(f));

        // Include pages even with no valid files for overview/guide types
        if (validFiles.length > 0 || page.type === 'overview' || page.type === 'guide') {
          validatedPages.push({
            title: page.title,
            filename: page.filename.endsWith('.md') ? page.filename : `${page.filename}.md`,
            type: this.normalizePageType(page.type),
            context: page.context,
            sourceFiles: validFiles,
          });
        }
      }

      // If LLM returned too few pages, augment with pattern-based pages
      if (validatedPages.length < minPages) {
        console.log(`[Local] LLM returned ${validatedPages.length} pages, augmenting to reach minimum ${minPages}`);
        const additionalPages = this.augmentWithPatternPages(allFiles, validatedPages, minPages, analysis.projectType);
        validatedPages.push(...additionalPages);
      }

      // Ensure we have an architecture overview
      if (!validatedPages.some(p => p.type === 'overview')) {
        const entryPoints = allFiles
          .filter(f => this.isEntryPoint(f.relativePath))
          .map(f => f.relativePath);

        validatedPages.unshift({
          title: 'Architecture Overview',
          filename: 'architecture.md',
          type: 'overview',
          context: `High-level architecture of this ${analysis.projectType} project.`,
          sourceFiles: entryPoints.slice(0, 10),
        });
      }

      // Always add Getting Started
      if (!validatedPages.some(p => p.title.toLowerCase().includes('getting started'))) {
        const setupFiles = allFiles
          .filter(f =>
            f.relativePath.toLowerCase().includes('readme') ||
            f.relativePath.includes('package.json') ||
            f.relativePath.includes('Makefile') ||
            f.relativePath.includes('setup.') ||
            f.relativePath.includes('install'))
          .map(f => f.relativePath);

        validatedPages.push({
          title: 'Getting Started',
          filename: 'getting-started.md',
          type: 'guide',
          context: 'Installation, setup, and development workflow',
          sourceFiles: setupFiles,
        });
      }

      console.log(`[Local] Final page count: ${validatedPages.length} pages`);
      return validatedPages;

    } catch (error) {
      console.error(`[Local] LLM analysis failed: ${(error as Error).message}`);
      console.log(`[Local] Falling back to comprehensive pattern-based analysis`);
      return this.generateComprehensivePages(allFiles, minPages);
    }
  }

  /**
   * Generate language-aware grouping suggestions based on detected file types
   */
  private generateGroupingSuggestions(extCounts: Map<string, number>, totalFiles: number): string {
    const suggestions: string[] = [];

    // Detect project type and provide specific suggestions
    const hasCobol = extCounts.has('.cbl') || extCounts.has('.cob');
    const hasCopybooks = extCounts.has('.cpy');
    const hasJcl = extCounts.has('.jcl');
    const hasBms = extCounts.has('.bms');
    const hasTypeScript = extCounts.has('.ts') || extCounts.has('.tsx');
    const hasJava = extCounts.has('.java');
    const hasPython = extCounts.has('.py');
    const hasGo = extCounts.has('.go');
    const hasRust = extCounts.has('.rs');
    const hasCpp = extCounts.has('.cpp') || extCounts.has('.c');
    const hasSwift = extCounts.has('.swift');

    // Mainframe/COBOL projects
    if (hasCobol || hasCopybooks || hasJcl || hasBms) {
      suggestions.push(`**Mainframe/COBOL Project Detected** - Consider these page groupings:`);
      if (hasCobol) {
        const count = (extCounts.get('.cbl') || 0) + (extCounts.get('.cob') || 0);
        suggestions.push(`- **Online Programs** (${count} COBOL files): Group CICS transaction programs by function (e.g., Account Management, Transaction Processing, Reports)`);
        suggestions.push(`- **Batch Programs**: Group batch processing programs and their JCL`);
      }
      if (hasCopybooks) {
        suggestions.push(`- **Copybooks & Data Structures** (${extCounts.get('.cpy')} files): Document shared data definitions, record layouts, communication areas`);
      }
      if (hasJcl) {
        suggestions.push(`- **Job Control (JCL)** (${extCounts.get('.jcl')} files): Document batch jobs, procedures, job streams`);
      }
      if (hasBms) {
        suggestions.push(`- **Screen Maps (BMS)** (${extCounts.get('.bms')} files): Document terminal screens, field layouts, user interface`);
      }
      suggestions.push(`- **Data Layer**: Document VSAM files, DB2 tables, IMS segments`);
    }

    // TypeScript/JavaScript projects
    else if (hasTypeScript) {
      suggestions.push(`**TypeScript/JavaScript Project** - Consider these groupings:`);
      suggestions.push(`- **API Routes/Handlers**: Group by domain (auth, users, products, etc.)`);
      suggestions.push(`- **Components/UI**: Group React/Vue/Svelte components by feature`);
      suggestions.push(`- **Services/Business Logic**: Group service classes and utilities`);
      suggestions.push(`- **State Management**: Document stores, reducers, context`);
      suggestions.push(`- **Configuration**: Build config, environment, types`);
    }

    // Java projects
    else if (hasJava) {
      suggestions.push(`**Java Project** - Consider these groupings:`);
      suggestions.push(`- **Controllers/Endpoints**: REST or web controllers`);
      suggestions.push(`- **Services**: Business logic layer`);
      suggestions.push(`- **Repositories/DAOs**: Data access layer`);
      suggestions.push(`- **Models/Entities**: Domain objects and DTOs`);
      suggestions.push(`- **Configuration**: Spring config, application properties`);
    }

    // Python projects
    else if (hasPython) {
      suggestions.push(`**Python Project** - Consider these groupings:`);
      suggestions.push(`- **API/Views**: Flask routes, Django views, FastAPI endpoints`);
      suggestions.push(`- **Models**: Database models, data classes`);
      suggestions.push(`- **Services/Logic**: Business logic modules`);
      suggestions.push(`- **Utils/Helpers**: Utility functions and helpers`);
    }

    // Go projects
    else if (hasGo) {
      suggestions.push(`**Go Project** - Consider these groupings:`);
      suggestions.push(`- **Handlers**: HTTP handlers, gRPC services`);
      suggestions.push(`- **Domain/Models**: Core business types`);
      suggestions.push(`- **Repository/Storage**: Database and storage layer`);
      suggestions.push(`- **Pkg/Internal**: Shared packages and internal modules`);
    }

    // C/C++ projects
    else if (hasCpp) {
      suggestions.push(`**C/C++ Project** - Consider these groupings:`);
      suggestions.push(`- **Core/Src**: Main application logic`);
      suggestions.push(`- **Lib**: Libraries and reusable modules`);
      suggestions.push(`- **Include/Headers**: Header files and interfaces`);
      suggestions.push(`- **Drivers/HAL**: Hardware abstraction (if embedded)`);
    }

    // Generic fallback
    else {
      suggestions.push(`**General Project** - Consider these groupings:`);
      suggestions.push(`- Group files by **directory** (each major folder = 1 page)`);
      suggestions.push(`- Group files by **functionality** (what they do together)`);
      suggestions.push(`- Create separate pages for **configuration** and **utilities**`);
    }

    // Universal suggestions
    suggestions.push(`\n**Universal Guidelines:**`);
    suggestions.push(`- Create ${Math.ceil(totalFiles / 8)}-${Math.ceil(totalFiles / 5)} pages for ${totalFiles} source files`);
    suggestions.push(`- Each page should have 2-8 related files, not more`);
    suggestions.push(`- Name pages by WHAT they do, not WHERE they are`);

    return suggestions.join('\n');
  }

  /**
   * Augment LLM-generated pages with pattern-based pages if count is too low
   */
  private augmentWithPatternPages(
    allFiles: Array<{ relativePath: string; extension: string; size: number }>,
    existingPages: Array<{ title: string; filename: string; type: string; context: string; sourceFiles: string[] }>,
    minPages: number,
    projectType: string
  ): Array<{ title: string; filename: string; type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config'; context: string; sourceFiles: string[] }> {
    const additionalPages: Array<{ title: string; filename: string; type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config'; context: string; sourceFiles: string[] }> = [];
    const existingTitles = new Set(existingPages.map(p => p.title.toLowerCase()));
    const coveredFiles = new Set(existingPages.flatMap(p => p.sourceFiles));

    // Group uncovered files by directory
    const uncoveredByDir = new Map<string, Array<{ relativePath: string; extension: string; size: number }>>();
    for (const f of allFiles) {
      if (!coveredFiles.has(f.relativePath)) {
        const dir = f.relativePath.split('/').slice(0, -1).join('/') || 'root';
        if (!uncoveredByDir.has(dir)) {
          uncoveredByDir.set(dir, []);
        }
        uncoveredByDir.get(dir)!.push(f);
      }
    }

    // Sort directories by file count (most files first)
    const sortedDirs = Array.from(uncoveredByDir.entries())
      .sort((a, b) => b[1].length - a[1].length);

    // Create pages for uncovered directories
    for (const [dir, files] of sortedDirs) {
      if (existingPages.length + additionalPages.length >= minPages) break;
      if (files.length < 2) continue; // Skip dirs with only 1 file

      const title = this.formatDirectoryTitle(dir);
      if (existingTitles.has(title.toLowerCase())) continue;

      additionalPages.push({
        title,
        filename: this.toSlug(title) + '.md',
        type: 'module',
        context: `Source files in ${dir || 'root directory'} - part of ${projectType}`,
        sourceFiles: files.slice(0, 10).map(f => f.relativePath),
      });
      existingTitles.add(title.toLowerCase());
    }

    // Group remaining by extension type
    if (existingPages.length + additionalPages.length < minPages) {
      const byExt = new Map<string, string[]>();
      for (const f of allFiles) {
        if (!coveredFiles.has(f.relativePath)) {
          if (!byExt.has(f.extension)) byExt.set(f.extension, []);
          byExt.get(f.extension)!.push(f.relativePath);
        }
      }

      const extTitles: Record<string, string> = {
        '.cbl': 'COBOL Programs', '.cob': 'COBOL Programs',
        '.cpy': 'Copybooks & Data Structures',
        '.jcl': 'Job Control (JCL)',
        '.bms': 'Screen Maps (BMS)',
        '.ts': 'TypeScript Modules', '.tsx': 'React Components',
        '.js': 'JavaScript Modules', '.jsx': 'React Components',
        '.py': 'Python Modules',
        '.java': 'Java Classes',
        '.go': 'Go Packages',
        '.rs': 'Rust Modules',
        '.sql': 'Database Scripts',
      };

      for (const [ext, files] of byExt.entries()) {
        if (existingPages.length + additionalPages.length >= minPages) break;
        if (files.length < 3) continue;

        const title = extTitles[ext] || `${ext.replace('.', '').toUpperCase()} Files`;
        if (existingTitles.has(title.toLowerCase())) continue;

        additionalPages.push({
          title,
          filename: this.toSlug(title) + '.md',
          type: 'module',
          context: `${files.length} ${ext} files in the project`,
          sourceFiles: files.slice(0, 10),
        });
        existingTitles.add(title.toLowerCase());
      }
    }

    console.log(`[Local] Added ${additionalPages.length} pattern-based pages`);
    return additionalPages;
  }

  /**
   * Generate comprehensive pages when LLM analysis fails completely
   */
  private generateComprehensivePages(
    allFiles: Array<{ relativePath: string; extension: string; size: number }>,
    minPages: number
  ): Array<{ title: string; filename: string; type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config'; context: string; sourceFiles: string[] }> {
    const pages: Array<{ title: string; filename: string; type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config'; context: string; sourceFiles: string[] }> = [];

    // Detect project type from extensions
    const extCounts = new Map<string, number>();
    for (const f of allFiles) {
      extCounts.set(f.extension, (extCounts.get(f.extension) || 0) + 1);
    }
    const topExt = Array.from(extCounts.entries()).sort((a, b) => b[1] - a[1])[0]?.[0] || '';
    const projectType = this.getProjectTypeFromExtension(topExt);

    // 1. Architecture Overview
    pages.push({
      title: 'Architecture Overview',
      filename: 'architecture.md',
      type: 'overview',
      context: `High-level architecture of this ${projectType} project`,
      sourceFiles: allFiles
        .filter(f => this.isEntryPoint(f.relativePath))
        .slice(0, 10)
        .map(f => f.relativePath),
    });

    // 2. Group by top-level directories
    const byDir = new Map<string, string[]>();
    for (const f of allFiles) {
      const topDir = f.relativePath.split('/')[0] || 'root';
      if (!byDir.has(topDir)) byDir.set(topDir, []);
      byDir.get(topDir)!.push(f.relativePath);
    }

    const sortedDirs = Array.from(byDir.entries())
      .filter(([dir]) => !['node_modules', '.git', 'dist', 'build'].includes(dir))
      .sort((a, b) => b[1].length - a[1].length);

    for (const [dir, files] of sortedDirs) {
      if (pages.length >= minPages - 1) break;
      if (files.length < 2) continue;

      pages.push({
        title: this.formatDirectoryTitle(dir),
        filename: this.toSlug(dir) + '.md',
        type: 'module',
        context: `Files in the ${dir} directory`,
        sourceFiles: files.slice(0, 10),
      });
    }

    // 3. Group by file type if still under minimum
    if (pages.length < minPages) {
      for (const [ext, count] of extCounts.entries()) {
        if (pages.length >= minPages - 1) break;
        if (count < 3) continue;

        const files = allFiles.filter(f => f.extension === ext).map(f => f.relativePath);
        const title = this.getExtensionTitle(ext);

        if (!pages.some(p => p.title === title)) {
          pages.push({
            title,
            filename: this.toSlug(title) + '.md',
            type: 'module',
            context: `${count} ${ext} files in the project`,
            sourceFiles: files.slice(0, 10),
          });
        }
      }
    }

    // 4. Getting Started
    pages.push({
      title: 'Getting Started',
      filename: 'getting-started.md',
      type: 'guide',
      context: 'Setup and development workflow',
      sourceFiles: allFiles
        .filter(f => f.relativePath.toLowerCase().includes('readme') || f.relativePath.includes('package.json'))
        .map(f => f.relativePath),
    });

    console.log(`[Local] Generated ${pages.length} comprehensive pages`);
    return pages;
  }

  /**
   * Get project type name from file extension (synchronous helper)
   */
  private getProjectTypeFromExtension(ext: string): string {
    const types: Record<string, string> = {
      '.ts': 'TypeScript', '.tsx': 'TypeScript/React', '.js': 'JavaScript', '.jsx': 'JavaScript/React',
      '.py': 'Python', '.java': 'Java', '.kt': 'Kotlin', '.scala': 'Scala',
      '.go': 'Go', '.rs': 'Rust', '.c': 'C', '.cpp': 'C++',
      '.cs': 'C#/.NET', '.rb': 'Ruby', '.php': 'PHP',
      '.swift': 'Swift/iOS', '.dart': 'Dart/Flutter',
      '.cbl': 'COBOL/Mainframe', '.cob': 'COBOL/Mainframe', '.cpy': 'COBOL/Mainframe',
      '.jcl': 'Mainframe/JCL', '.bms': 'CICS/Mainframe',
    };
    return types[ext] || 'Software';
  }

  /**
   * Convert a string to a URL-safe slug
   */
  private toSlug(text: string): string {
    return text
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-+|-+$/g, '');
  }

  /**
   * Get a readable title for a file extension
   */
  private getExtensionTitle(ext: string): string {
    const titles: Record<string, string> = {
      '.ts': 'TypeScript Modules', '.tsx': 'React Components',
      '.js': 'JavaScript Modules', '.jsx': 'React Components',
      '.py': 'Python Modules', '.java': 'Java Classes',
      '.go': 'Go Packages', '.rs': 'Rust Modules',
      '.cbl': 'COBOL Programs', '.cob': 'COBOL Programs',
      '.cpy': 'Copybooks', '.jcl': 'JCL Jobs',
      '.bms': 'BMS Screen Maps', '.sql': 'Database Scripts',
      '.c': 'C Source Files', '.cpp': 'C++ Source Files',
      '.cs': 'C# Classes', '.rb': 'Ruby Files',
    };
    return titles[ext] || `${ext.replace('.', '').toUpperCase()} Files`;
  }

  /**
   * Format a directory name as a page title
   */
  private formatDirectoryTitle(dir: string): string {
    if (!dir || dir === 'root') return 'Core Modules';
    return dir
      .split(/[-_\/]/)
      .map(word => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Plan wiki pages from discovery results
   * Uses the hierarchical domain structure to create a comprehensive page plan
   */
  private async planPagesFromDiscovery(
    provider: LLMProvider,
    discoveryResult: DiscoveryResult,
    options: WikiGenerationOptions
  ): Promise<Array<{
    title: string;
    filename: string;
    type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config' | 'relationship';
    context: string;
    sourceFiles: string[];
    section?: string;
    domain?: string;
  }>> {
    const pages: Array<{
      title: string;
      filename: string;
      type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config' | 'relationship';
      context: string;
      sourceFiles: string[];
      section?: string;
      domain?: string;
    }> = [];

    // 1. Add architecture overview page
    pages.push({
      title: 'Architecture Overview',
      filename: 'architecture.md',
      type: 'overview',
      context: `High-level architecture of ${discoveryResult.project.name}. Project type: ${discoveryResult.project.type}. Technologies: ${discoveryResult.project.technologies.join(', ')}. Cover system components, data flow, and integration points.`,
      sourceFiles: discoveryResult.domains.flatMap(d => d.files.slice(0, 3)),
      section: 'Architecture',
    });

    // 2. Add getting started page
    pages.push({
      title: 'Getting Started',
      filename: 'getting-started.md',
      type: 'guide',
      context: `Setup and development guide for ${discoveryResult.project.name}. Include installation, configuration, and basic usage.`,
      sourceFiles: ['README.md', 'package.json', '.env.example'].filter(f =>
        discoveryResult.domains.some(d => d.files.includes(f))
      ),
      section: 'Guides',
    });

    // 3. Add pages for each section from discovery
    // Create a map of domain IDs to domains for quick lookup
    const domainMap = new Map(discoveryResult.domains.map(d => [d.id, d]));

    for (const section of discoveryResult.wikiStructure.sections) {
      // Find all domains in this section for component tables
      const sectionDomains = discoveryResult.domains.filter(d =>
        this.categoryToSection(d.category) === section.title
      );

      // Generate combined component tables for section overview
      const sectionComponentTables = sectionDomains
        .map(d => generateComponentTable(d))
        .filter(t => t.length > 0)
        .join('\n');

      // Add section overview if multiple pages
      if (section.pages.length > 1) {
        let overviewContext = section.description;
        if (sectionComponentTables) {
          overviewContext += `\n\n## Component Reference\n\n${sectionComponentTables}`;
        }

        pages.push({
          title: section.title,
          filename: `${section.id}.md`,
          type: 'overview',
          context: overviewContext,
          sourceFiles: section.pages.flatMap(p => p.sourcePaths).slice(0, 10),
          section: section.title,
        });
      }

      // Add pages for each domain in this section
      for (const page of section.pages) {
        // Skip if it's the same as section overview
        if (page.slug === `${section.id}.md`) continue;

        // Extract domain ID from page slug (e.g., "domain-id.md" -> "domain-id")
        const domainId = page.slug.replace('.md', '').replace(/-\w+$/, '');
        const domain = domainMap.get(domainId);

        // Generate component table for this domain if available
        let pageContext = page.description;
        if (domain) {
          const componentTable = generateComponentTable(domain);
          if (componentTable) {
            pageContext += `\n\n${componentTable}`;
          }
        }

        pages.push({
          title: page.title,
          filename: page.slug,
          type: page.pageType === 'overview' ? 'module' : page.pageType === 'feature' ? 'component' : 'module',
          context: pageContext,
          sourceFiles: page.sourcePaths,
          section: section.title,
        });
      }
    }

    // 4. Add relationship pages if significant cross-domain interactions
    if (discoveryResult.relationships.length > 5) {
      pages.push({
        title: 'Data Flow',
        filename: 'data-flow.md',
        type: 'relationship',
        context: 'How data moves through the system. Include data transformations, storage patterns, and integration points.',
        sourceFiles: discoveryResult.domains
          .filter(d => d.category === 'data-layer' || d.category === 'core-application')
          .flatMap(d => d.files.slice(0, 5)),
        section: 'System Relationships',
      });

      pages.push({
        title: 'Integration Points',
        filename: 'integration-points.md',
        type: 'relationship',
        context: 'How modules connect and communicate. Include APIs, data contracts, and dependencies.',
        sourceFiles: discoveryResult.domains
          .filter(d => d.category === 'integration' || d.relatedDomains.length > 2)
          .flatMap(d => d.files.slice(0, 5)),
        section: 'System Relationships',
      });
    }

    // 5. Ensure minimum page count by adding domain-specific pages
    const minPages = Math.max(8, discoveryResult.domains.length);
    if (pages.length < minPages) {
      for (const domain of discoveryResult.domains) {
        const existingPage = pages.find(p => p.filename === `${domain.id}.md`);
        if (!existingPage && pages.length < minPages + 5) {
          // Generate component table for this domain
          const componentTable = generateComponentTable(domain);
          let domainContext = `${domain.description}. ${domain.businessPurpose || ''}`;
          if (componentTable) {
            domainContext += `\n\n${componentTable}`;
          }

          pages.push({
            title: domain.name,
            filename: `${domain.id}.md`,
            type: 'module',
            context: domainContext,
            sourceFiles: domain.files.slice(0, 10),
            section: this.categoryToSection(domain.category),
            domain: domain.id,
          });
        }
      }
    }

    console.log(`[Local] Planned ${pages.length} pages from discovery (${discoveryResult.domains.length} domains)`);
    return pages;
  }

  /**
   * Map domain category to section name
   */
  private categoryToSection(category: string): string {
    const sectionMap: Record<string, string> = {
      'core-application': 'Core Application',
      'presentation': 'User Interface',
      'data-layer': 'Data Layer',
      'batch-processing': 'Batch Processing',
      'integration': 'Integration',
      'configuration': 'Configuration',
      'infrastructure': 'Infrastructure',
      'documentation': 'Documentation',
      'testing': 'Testing',
    };
    return sectionMap[category] || 'Components';
  }

  /**
   * Generate enhanced hierarchical index from discovery results
   */
  private generateEnhancedIndex(
    discoveryResult: DiscoveryResult,
    pages: Array<{ title: string; filename: string; type: string; context: string; section?: string; domain?: string }>
  ): string {
    const lines: string[] = [];

    // Header with project info
    lines.push(`# ${discoveryResult.project.name}`);
    lines.push('');
    lines.push(discoveryResult.project.description);
    lines.push('');

    // Technology badges
    if (discoveryResult.project.technologies.length > 0) {
      lines.push('**Technologies:** ' + discoveryResult.project.technologies.slice(0, 8).join(' • '));
      lines.push('');
    }

    // Project type indicator
    lines.push(`**Project Type:** ${this.formatProjectType(discoveryResult.project.type)}`);
    lines.push('');
    lines.push('---');
    lines.push('');

    // Overview section
    lines.push('## Overview');
    lines.push('');
    lines.push('> High-level documentation and getting started guides.');
    lines.push('');
    const overviewPages = pages.filter(p => p.type === 'overview' || p.type === 'guide');
    for (const page of overviewPages.slice(0, 5)) {
      lines.push(`- 📚 [${page.title}](./${page.filename}) – ${this.truncateContext(page.context)}`);
    }
    lines.push('');

    // Group remaining pages by section
    const sectionPages = new Map<string, typeof pages>();
    for (const page of pages) {
      if (page.type === 'overview' || page.type === 'guide') continue;
      const section = page.section || 'Components';
      const existing = sectionPages.get(section) || [];
      existing.push(page);
      sectionPages.set(section, existing);
    }

    // Output each section
    const sectionOrder = [
      'Core Application',
      'User Interface',
      'Data Layer',
      'Batch Processing',
      'Integration',
      'System Relationships',
      'Configuration',
      'Infrastructure',
      'Components',
    ];

    for (const sectionName of sectionOrder) {
      const sectionPageList = sectionPages.get(sectionName);
      if (!sectionPageList || sectionPageList.length === 0) continue;

      lines.push(`## ${sectionName}`);
      lines.push('');

      // Find matching section in discovery for description
      const discoveredSection = discoveryResult.wikiStructure.sections.find(s => s.title === sectionName);
      if (discoveredSection) {
        lines.push(`> ${discoveredSection.description}`);
        lines.push('');
      }

      for (const page of sectionPageList) {
        const icon = this.getPageIcon(page.type);
        lines.push(`- ${icon} [${page.title}](./${page.filename}) – ${this.truncateContext(page.context)}`);
      }
      lines.push('');
    }

    // Quick reference table
    lines.push('---');
    lines.push('');
    lines.push('## Quick Reference');
    lines.push('');
    lines.push('| Domain | Description | Files | Category |');
    lines.push('|--------|-------------|-------|----------|');

    for (const domain of discoveryResult.domains.slice(0, 12)) {
      const pageLink = pages.find(p => p.domain === domain.id || p.filename === `${domain.id}.md`);
      const nameCell = pageLink ? `[${domain.name}](./${pageLink.filename})` : domain.name;
      lines.push(`| ${nameCell} | ${this.truncateContext(domain.description, 40)} | ${domain.files.length} | ${domain.category} |`);
    }

    lines.push('');
    lines.push('---');
    lines.push('');
    lines.push(`*Generated by SemanticWiki with hierarchical discovery • ${discoveryResult.stats.totalFiles} files analyzed • ${discoveryResult.stats.totalDomains} domains discovered*`);

    return lines.join('\n');
  }

  /**
   * Format project type for display
   */
  private formatProjectType(type: string): string {
    const typeMap: Record<string, string> = {
      'mainframe-cobol': '🖥️ Mainframe COBOL Application',
      'web-application': '🌐 Web Application',
      'api-service': '🔌 API Service',
      'cli-tool': '⌨️ CLI Tool',
      'library': '📦 Library',
      'monorepo': '📁 Monorepo',
      'unknown': '📄 Software Project',
    };
    return typeMap[type] || type;
  }

  /**
   * Get icon for page type
   */
  private getPageIcon(type: string): string {
    const iconMap: Record<string, string> = {
      'overview': '📚',
      'component': '⚙️',
      'module': '📦',
      'guide': '📝',
      'config': '🔧',
      'api': '🔌',
      'relationship': '🔗',
    };
    return iconMap[type] || '📄';
  }

  /**
   * Truncate context string for display
   */
  private truncateContext(context: string, maxLength: number = 60): string {
    if (context.length <= maxLength) return context;
    return context.slice(0, maxLength - 3) + '...';
  }

  /**
   * Gather all project files with metadata for LLM analysis
   */
  private async gatherProjectFiles(repoPath: string): Promise<Array<{
    relativePath: string;
    extension: string;
    size: number;
  }>> {
    const files: Array<{ relativePath: string; extension: string; size: number }> = [];

    const ignoreDirs = [
      'node_modules', '.git', 'dist', 'build', '.next', 'coverage',
      '__pycache__', 'venv', '.venv', 'vendor', '.cache', '.turbo'
    ];

    const scan = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              scan(fullPath, relPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            // Include source files from many languages and paradigms
            const includeExts = [
              // Web/JavaScript ecosystem
              '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs', '.vue', '.svelte',
              // Systems programming
              '.c', '.h', '.cpp', '.hpp', '.cc', '.cxx', '.rs', '.go',
              // JVM languages
              '.java', '.kt', '.kts', '.scala', '.groovy', '.gradle',
              // Scripting languages
              '.py', '.rb', '.php', '.pl', '.pm', '.lua', '.r', '.R',
              // .NET ecosystem
              '.cs', '.fs', '.vb',
              // Mainframe / Legacy
              '.cbl', '.cob', '.cpy', '.jcl', '.prc', '.bms', '.asm', '.s',
              '.pli', '.pl1', '.rpg', '.rpgle', '.clp', '.clle', '.dspf', '.pf',
              // Functional languages
              '.hs', '.lhs', '.ml', '.mli', '.erl', '.ex', '.exs', '.elm', '.clj', '.cljs',
              // Shell and scripting
              '.sh', '.bash', '.zsh', '.ps1', '.psm1', '.bat', '.cmd',
              // Data and config
              '.json', '.yaml', '.yml', '.toml', '.xml', '.ini', '.conf', '.cfg',
              // SQL and database
              '.sql', '.ddl', '.dml', '.plsql', '.pgsql',
              // Documentation (for context)
              '.md', '.mdx', '.rst', '.txt',
              // Styles (for web projects)
              '.css', '.scss', '.less', '.sass',
              // Mobile
              '.swift', '.m', '.mm', '.dart',
              // Other
              '.proto', '.graphql', '.gql', '.tf', '.hcl'
            ];

            if (includeExts.includes(ext)) {
              try {
                const stats = fs.statSync(fullPath);
                files.push({
                  relativePath: relPath,
                  extension: ext,
                  size: stats.size,
                });
              } catch {
                // Skip files we can't stat
              }
            }
          }
        }
      } catch {
        // Ignore directories we can't read
      }
    };

    scan(repoPath);
    return files;
  }

  /**
   * Check if a file is likely an entry point (language-agnostic)
   */
  private isEntryPoint(filePath: string): boolean {
    const lowerPath = filePath.toLowerCase();
    const basename = path.basename(lowerPath);

    // Common entry point patterns across languages
    const patterns = [
      // JavaScript/TypeScript
      /^(src\/)?index\.[tj]sx?$/i,
      /^(src\/)?main\.[tj]sx?$/i,
      /^(src\/)?app\.[tj]sx?$/i,
      /package\.json$/i,
      /vite\.config\.[tj]s$/i,
      /next\.config\.[tj]s$/i,
      /webpack\.config\.[tj]s$/i,
      // Python
      /^(src\/)?main\.py$/i,
      /^(src\/)?app\.py$/i,
      /^(src\/)?__main__\.py$/i,
      /setup\.py$/i,
      /pyproject\.toml$/i,
      // Java/Kotlin
      /Main\.(java|kt)$/i,
      /Application\.(java|kt)$/i,
      /pom\.xml$/i,
      /build\.gradle(\.kts)?$/i,
      // .NET
      /Program\.cs$/i,
      /Startup\.cs$/i,
      /\.csproj$/i,
      // Go
      /^(cmd\/)?main\.go$/i,
      /go\.mod$/i,
      // Rust
      /^src\/main\.rs$/i,
      /^src\/lib\.rs$/i,
      /Cargo\.toml$/i,
      // Ruby
      /^(lib\/)?.*\.rb$/i,
      /Gemfile$/i,
      /Rakefile$/i,
      // Swift/iOS
      /AppDelegate\.swift$/i,
      /ContentView\.swift$/i,
      /\.xcodeproj/i,
      /Package\.swift$/i,
      // COBOL/Mainframe
      /MAINPGM\.cbl$/i,
      /COBOL\/.*\.cbl$/i,
      /\.jcl$/i,  // Job control is often entry point for batch
      // General config
      /Makefile$/i,
      /Dockerfile$/i,
      /docker-compose\.ya?ml$/i,
    ];

    // Check patterns
    if (patterns.some(p => p.test(filePath))) {
      return true;
    }

    // Check common entry point basenames
    const entryNames = ['main', 'index', 'app', 'application', 'program', 'start', 'server', 'bootstrap'];
    const nameWithoutExt = basename.replace(/\.[^.]+$/, '').toLowerCase();
    return entryNames.includes(nameWithoutExt);
  }

  /**
   * Normalize page type to valid enum value
   */
  private normalizePageType(type: string): 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config' {
    const normalized = type.toLowerCase();
    if (normalized === 'overview') return 'overview';
    if (normalized === 'component' || normalized === 'components') return 'component';
    if (normalized === 'api' || normalized === 'endpoint' || normalized === 'routes') return 'api';
    if (normalized === 'guide' || normalized === 'tutorial' || normalized === 'getting-started') return 'guide';
    if (normalized === 'config' || normalized === 'configuration') return 'config';
    return 'module'; // Default fallback
  }

  /**
   * Analyze codebase to determine which pages to generate dynamically.
   * This is the fallback method using pattern-based analysis.
   */
  private async analyzeCodebaseForPages(options: WikiGenerationOptions): Promise<Array<{
    title: string;
    filename: string;
    type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config';
    context: string;
    sourceFiles: string[];
  }>> {
    const pages: Array<{
      title: string;
      filename: string;
      type: 'overview' | 'component' | 'api' | 'guide' | 'module' | 'config';
      context: string;
      sourceFiles: string[];
    }> = [];

    // Get all source files by scanning the repository
    const sourceFiles = await this.scanSourceFiles(this.repoPath);
    console.log(`[Local] Found ${sourceFiles.length} source files to analyze`);

    // Detect project type from package.json or other indicators
    const projectType = await this.detectProjectType();
    console.log(`[Local] Detected project type: ${projectType.type} (${projectType.framework || 'no framework'})`);

    // 1. Architecture Overview (always included)
    const entryPoints = this.findEntryPoints(sourceFiles, projectType);
    pages.push({
      title: 'Architecture Overview',
      filename: 'architecture.md',
      type: 'overview',
      context: `High-level architecture of this ${projectType.type} project. Main entry points and how components interact.`,
      sourceFiles: entryPoints.slice(0, 20),
    });

    // 2. Analyze directory structure intelligently
    const dirAnalysis = this.analyzeDirectoryStructure(sourceFiles);

    // Add pages for significant directories
    for (const [dirPath, info] of dirAnalysis.entries()) {
      if (info.files.length < 2) continue; // Skip trivial directories

      const pageType = this.inferPageType(dirPath, info);
      if (!pageType) continue;

      pages.push({
        title: pageType.title,
        filename: pageType.filename,
        type: pageType.type,
        context: pageType.context,
        sourceFiles: info.files.slice(0, 20),
      });
    }

    // 3. Add specialized pages based on project patterns
    // Use lower thresholds for smaller projects (< 50 files)
    const isSmallProject = sourceFiles.length < 50;
    const componentThreshold = isSmallProject ? 2 : 5;
    const hookThreshold = isSmallProject ? 1 : 3;
    const apiThreshold = isSmallProject ? 1 : 2;
    const utilThreshold = isSmallProject ? 1 : 3;
    const stateThreshold = isSmallProject ? 1 : 2;
    const typeThreshold = isSmallProject ? 1 : 2;

    // React/Vue/Svelte: Components page
    const componentFiles = sourceFiles.filter(f =>
      f.includes('/components/') ||
      f.includes('/Components/') ||
      (f.endsWith('.tsx') && !f.includes('/pages/'))
    );
    if (componentFiles.length >= componentThreshold && !pages.some(p => p.title.includes('Component'))) {
      pages.push({
        title: 'UI Components',
        filename: 'components.md',
        type: 'component',
        context: 'Reusable UI components, their props, and usage patterns',
        sourceFiles: componentFiles.slice(0, 20),
      });
    }

    // Hooks (React)
    const hookFiles = sourceFiles.filter(f =>
      f.includes('/hooks/') ||
      (f.includes('use') && f.endsWith('.ts'))
    );
    if (hookFiles.length >= hookThreshold) {
      pages.push({
        title: 'Custom Hooks',
        filename: 'hooks.md',
        type: 'module',
        context: 'Custom React hooks, their purpose, and usage examples',
        sourceFiles: hookFiles,
      });
    }

    // API/Routes
    const apiFiles = sourceFiles.filter(f =>
      f.includes('/api/') ||
      f.includes('/routes/') ||
      f.includes('/endpoints/') ||
      f.includes('router') ||
      f.includes('handler')
    );
    if (apiFiles.length >= apiThreshold) {
      pages.push({
        title: 'API Reference',
        filename: 'api.md',
        type: 'api',
        context: 'API endpoints, route handlers, and request/response formats',
        sourceFiles: apiFiles.slice(0, 20),
      });
    }

    // Utils/Helpers
    const utilFiles = sourceFiles.filter(f =>
      f.includes('/utils/') ||
      f.includes('/helpers/') ||
      f.includes('/lib/') ||
      f.includes('util') ||
      f.includes('helper')
    );
    if (utilFiles.length >= utilThreshold) {
      pages.push({
        title: 'Utilities & Helpers',
        filename: 'utilities.md',
        type: 'module',
        context: 'Utility functions, helper modules, and shared logic',
        sourceFiles: utilFiles.slice(0, 15),
      });
    }

    // State Management
    const stateFiles = sourceFiles.filter(f =>
      f.includes('/store/') ||
      f.includes('/state/') ||
      f.includes('/redux/') ||
      f.includes('/context/') ||
      f.includes('store') ||
      f.includes('slice')
    );
    if (stateFiles.length >= stateThreshold) {
      pages.push({
        title: 'State Management',
        filename: 'state-management.md',
        type: 'module',
        context: 'Application state, stores, reducers, and data flow patterns',
        sourceFiles: stateFiles,
      });
    }

    // Types/Interfaces (TypeScript)
    const typeFiles = sourceFiles.filter(f =>
      f.includes('/types/') ||
      f.includes('/interfaces/') ||
      f.includes('.d.ts') ||
      f.includes('types.ts')
    );
    if (typeFiles.length >= typeThreshold) {
      pages.push({
        title: 'Type Definitions',
        filename: 'types.md',
        type: 'module',
        context: 'TypeScript types, interfaces, and type utilities',
        sourceFiles: typeFiles,
      });
    }

    // Pages/Views (for React/Vue apps with page-based routing)
    const pageFiles = sourceFiles.filter(f =>
      f.includes('/pages/') ||
      f.includes('/views/') ||
      f.includes('/screens/')
    );
    if (pageFiles.length >= 2) {
      pages.push({
        title: 'Pages & Routing',
        filename: 'pages.md',
        type: 'component',
        context: 'Page components, routing structure, and navigation',
        sourceFiles: pageFiles.slice(0, 20),
      });
    }

    // For small projects, add individual page docs for key files
    if (isSmallProject && sourceFiles.length > 5) {
      // Find main application files that deserve their own page
      const keyFiles = sourceFiles.filter(f => {
        const basename = path.basename(f).toLowerCase();
        return (
          basename === 'app.tsx' ||
          basename === 'app.ts' ||
          basename === 'main.tsx' ||
          basename === 'main.ts' ||
          basename.includes('router') ||
          basename.includes('provider') ||
          basename.includes('context')
        );
      });

      for (const keyFile of keyFiles.slice(0, 3)) {
        const basename = path.basename(keyFile, path.extname(keyFile));
        const title = this.formatDirectoryName(basename);
        const filename = `${basename.toLowerCase()}.md`;

        // Don't duplicate if we already have a page for this
        if (!pages.some(p => p.filename === filename)) {
          pages.push({
            title: `${title} (Core)`,
            filename,
            type: 'module',
            context: `Core application file: ${keyFile}. Entry point or main configuration.`,
            sourceFiles: [keyFile],
          });
        }
      }
    }

    // Configuration
    const configFiles = sourceFiles.filter(f =>
      f.includes('config') ||
      f.includes('.config.') ||
      f.endsWith('.json') ||
      f.endsWith('.yaml') ||
      f.endsWith('.yml') ||
      f.endsWith('.toml')
    );
    if (configFiles.length >= 2) {
      pages.push({
        title: 'Configuration',
        filename: 'configuration.md',
        type: 'config',
        context: 'Project configuration, environment setup, and build settings',
        sourceFiles: configFiles.slice(0, 10),
      });
    }

    // 4. Getting Started guide (always included)
    const setupFiles = sourceFiles.filter(f =>
      f.includes('package.json') ||
      f.includes('README') ||
      f.includes('CONTRIBUTING') ||
      f.includes('setup') ||
      f.includes('install')
    );
    pages.push({
      title: 'Getting Started',
      filename: 'getting-started.md',
      type: 'guide',
      context: 'Installation, setup, development workflow, and quick start guide',
      sourceFiles: [...setupFiles, ...entryPoints.slice(0, 5)],
    });

    // Remove duplicates (by filename)
    const seen = new Set<string>();
    const uniquePages = pages.filter(p => {
      if (seen.has(p.filename)) return false;
      seen.add(p.filename);
      return true;
    });

    console.log(`[Local] Generated ${uniquePages.length} page specs for this project`);
    return uniquePages;
  }

  /**
   * Detect the project type from package.json and file patterns
   */
  private async detectProjectType(): Promise<{ type: string; framework?: string; language: string }> {
    const packageJsonPath = path.join(this.repoPath, 'package.json');

    if (fs.existsSync(packageJsonPath)) {
      try {
        const pkg = JSON.parse(fs.readFileSync(packageJsonPath, 'utf-8'));
        const deps = { ...pkg.dependencies, ...pkg.devDependencies };

        // Detect framework
        if (deps['next']) return { type: 'web app', framework: 'Next.js', language: 'TypeScript' };
        if (deps['react']) return { type: 'web app', framework: 'React', language: 'TypeScript' };
        if (deps['vue']) return { type: 'web app', framework: 'Vue', language: 'TypeScript' };
        if (deps['svelte']) return { type: 'web app', framework: 'Svelte', language: 'TypeScript' };
        if (deps['express']) return { type: 'server', framework: 'Express', language: 'TypeScript' };
        if (deps['fastify']) return { type: 'server', framework: 'Fastify', language: 'TypeScript' };
        if (deps['@anthropic-ai/sdk']) return { type: 'AI application', framework: 'Anthropic SDK', language: 'TypeScript' };

        // CLI tool detection
        if (pkg.bin) return { type: 'CLI tool', language: 'TypeScript' };

        return { type: 'Node.js project', language: 'TypeScript' };
      } catch {
        // Ignore parse errors
      }
    }

    // Check for other project types
    if (fs.existsSync(path.join(this.repoPath, 'Cargo.toml'))) {
      return { type: 'Rust project', language: 'Rust' };
    }
    if (fs.existsSync(path.join(this.repoPath, 'go.mod'))) {
      return { type: 'Go project', language: 'Go' };
    }
    if (fs.existsSync(path.join(this.repoPath, 'requirements.txt')) ||
        fs.existsSync(path.join(this.repoPath, 'pyproject.toml'))) {
      return { type: 'Python project', language: 'Python' };
    }

    return { type: 'software project', language: 'unknown' };
  }

  /**
   * Find entry points based on project type
   */
  private findEntryPoints(sourceFiles: string[], projectType: { type: string; framework?: string }): string[] {
    const entryPatterns = [
      // Common entry points
      /^src\/index\.[tj]sx?$/,
      /^src\/main\.[tj]sx?$/,
      /^src\/app\.[tj]sx?$/,
      /^src\/App\.[tj]sx?$/,
      /^index\.[tj]sx?$/,
      /^main\.[tj]sx?$/,
      // Next.js
      /^src\/pages\/_app\.[tj]sx?$/,
      /^src\/app\/layout\.[tj]sx?$/,
      /^pages\/_app\.[tj]sx?$/,
      // Config files
      /^package\.json$/,
      /vite\.config\.[tj]s$/,
      /next\.config\.[tj]s$/,
      /webpack\.config\.[tj]s$/,
    ];

    const entries: string[] = [];

    for (const file of sourceFiles) {
      for (const pattern of entryPatterns) {
        if (pattern.test(file)) {
          entries.push(file);
          break;
        }
      }
    }

    // Also include any index files as they're often entry points
    const indexFiles = sourceFiles.filter(f =>
      f.endsWith('/index.ts') ||
      f.endsWith('/index.tsx') ||
      f.endsWith('/index.js')
    );

    return [...new Set([...entries, ...indexFiles])].slice(0, 20);
  }

  /**
   * Analyze directory structure and return info about significant directories
   */
  private analyzeDirectoryStructure(sourceFiles: string[]): Map<string, {
    files: string[];
    depth: number;
    hasIndex: boolean;
  }> {
    const dirMap = new Map<string, { files: string[]; depth: number; hasIndex: boolean }>();

    for (const file of sourceFiles) {
      const dir = path.dirname(file);
      if (dir === '.' || dir === '') continue;

      // Get the most specific meaningful directory
      const parts = dir.split(path.sep).filter(p => p !== 'src' && p !== 'lib' && p !== 'app');
      if (parts.length === 0) continue;

      // Use the first meaningful directory segment
      const meaningfulDir = parts[0];

      if (!dirMap.has(meaningfulDir)) {
        dirMap.set(meaningfulDir, { files: [], depth: parts.length, hasIndex: false });
      }

      const info = dirMap.get(meaningfulDir)!;
      info.files.push(file);

      if (file.endsWith('/index.ts') || file.endsWith('/index.tsx')) {
        info.hasIndex = true;
      }
    }

    return dirMap;
  }

  /**
   * Infer what type of page to create for a directory
   */
  private inferPageType(dirPath: string, info: { files: string[]; hasIndex: boolean }): {
    title: string;
    filename: string;
    type: 'component' | 'module' | 'api' | 'guide';
    context: string;
  } | null {
    const dirLower = dirPath.toLowerCase();

    // Skip common non-documentation directories
    if (['node_modules', 'dist', 'build', '.git', 'coverage', '__tests__', '__mocks__'].includes(dirLower)) {
      return null;
    }

    // Map directory names to page types
    const dirMappings: Record<string, { type: 'component' | 'module' | 'api' | 'guide'; contextPrefix: string }> = {
      'components': { type: 'component', contextPrefix: 'UI components' },
      'pages': { type: 'component', contextPrefix: 'Page components and routing' },
      'views': { type: 'component', contextPrefix: 'View components' },
      'layouts': { type: 'component', contextPrefix: 'Layout components' },
      'hooks': { type: 'module', contextPrefix: 'Custom React hooks' },
      'utils': { type: 'module', contextPrefix: 'Utility functions' },
      'helpers': { type: 'module', contextPrefix: 'Helper functions' },
      'lib': { type: 'module', contextPrefix: 'Library code' },
      'services': { type: 'module', contextPrefix: 'Service layer' },
      'api': { type: 'api', contextPrefix: 'API endpoints' },
      'routes': { type: 'api', contextPrefix: 'Route handlers' },
      'controllers': { type: 'api', contextPrefix: 'Controllers' },
      'models': { type: 'module', contextPrefix: 'Data models' },
      'store': { type: 'module', contextPrefix: 'State management' },
      'context': { type: 'module', contextPrefix: 'React context providers' },
      'types': { type: 'module', contextPrefix: 'Type definitions' },
      'config': { type: 'guide', contextPrefix: 'Configuration' },
      'scripts': { type: 'guide', contextPrefix: 'Build and utility scripts' },
    };

    const mapping = dirMappings[dirLower];
    if (mapping) {
      return {
        title: this.formatDirectoryName(dirPath),
        filename: `${dirLower}.md`,
        type: mapping.type,
        context: `${mapping.contextPrefix} in the ${this.formatDirectoryName(dirPath)} directory`,
      };
    }

    // For other directories with enough files, create a module page
    if (info.files.length >= 5) {
      return {
        title: this.formatDirectoryName(dirPath),
        filename: `${dirLower.replace(/[^a-z0-9]/g, '-')}.md`,
        type: 'module',
        context: `The ${this.formatDirectoryName(dirPath)} module and its functionality`,
      };
    }

    return null;
  }

  /**
   * Format a directory name into a readable title
   */
  private formatDirectoryName(name: string): string {
    return name
      .replace(/[-_]/g, ' ')
      .replace(/([a-z])([A-Z])/g, '$1 $2')
      .split(' ')
      .map(word => word.charAt(0).toUpperCase() + word.slice(1).toLowerCase())
      .join(' ');
  }

  /**
   * Convert plain-text source references to clickable markdown links.
   * Handles various formats like:
   * - `See: path/file.ts:123`
   * - `(path/file.ts:123)`
   * - `Source: path/file.ts:123`
   * And converts them to: `📄 [path/file.ts:123](../path/file.ts#L123)`
   */
  private makeSourceReferencesClickable(content: string): string {
    let processed = content;

    // Pattern 1: `See: path/file.ts:123` or `See path/file.ts:123`
    processed = processed.replace(
      /(?:See:?\s*)`?([a-zA-Z0-9_\-./]+\.[a-zA-Z]+):(\d+)`?/g,
      (_, filePath, line) => `📄 [${filePath}:${line}](../${filePath}#L${line})`
    );

    // Pattern 2: `Source: path/file.ts:123`
    processed = processed.replace(
      /(?:Source:?\s*)`?([a-zA-Z0-9_\-./]+\.[a-zA-Z]+):(\d+)`?/g,
      (_, filePath, line) => `📄 [${filePath}:${line}](../${filePath}#L${line})`
    );

    // Pattern 3: Plain references in backticks like `path/file.ts:123` (but not already linked)
    processed = processed.replace(
      /(?<!\[)`([a-zA-Z0-9_\-./]+\.[tj]sx?):(\d+)`(?!\])/g,
      (_, filePath, line) => `📄 [${filePath}:${line}](../${filePath}#L${line})`
    );

    // Pattern 4: References in parentheses like (path/file.ts:123)
    processed = processed.replace(
      /\(([a-zA-Z0-9_\-./]+\.[tj]sx?):(\d+)\)(?!\])/g,
      (_, filePath, line) => `(📄 [${filePath}:${line}](../${filePath}#L${line}))`
    );

    // Pattern 5: Bare references at end of sentences like "in file.ts:123."
    processed = processed.replace(
      /(?:in|from|at)\s+([a-zA-Z0-9_\-./]+\.[tj]sx?):(\d+)([.,])/g,
      (_, filePath, line, punct) => `in 📄 [${filePath}:${line}](../${filePath}#L${line})${punct}`
    );

    return processed;
  }

  /**
   * Generate a single wiki page using RAG for semantic context
   */
  private async generateSinglePage(
    provider: LLMProvider,
    pageSpec: {
      title: string;
      filename: string;
      type: string;
      context: string;
      sourceFiles: string[];
    },
    allPages: Array<{ title: string; filename: string; type: string }>,
    options: WikiGenerationOptions
  ): Promise<string | null> {
    console.log(`\n[Local] ════════════════════════════════════════════════════════`);
    console.log(`[Local] generateSinglePage: ${pageSpec.title}`);
    console.log(`[Local]   Type: ${pageSpec.type}`);
    console.log(`[Local]   Filename: ${pageSpec.filename}`);
    console.log(`[Local]   Source files: ${pageSpec.sourceFiles.slice(0, 5).join(', ')}${pageSpec.sourceFiles.length > 5 ? '...' : ''}`);

    // Build cross-reference info for the model
    const otherPages = allPages
      .filter(p => p.filename !== pageSpec.filename)
      .map(p => `- [${p.title}](./${p.filename})`)
      .join('\n');

    // Use RAG to get semantically relevant code chunks
    let ragContext = '';
    if (this.ragSystem && this.ragSystem.getDocumentCount() > 0) {
      console.log(`[Local]   RAG system: ${this.ragSystem.getDocumentCount()} chunks indexed`);

      // Search for content relevant to this page's topic
      const searchQueries = [
        pageSpec.title,
        pageSpec.context,
        ...pageSpec.sourceFiles.slice(0, 3).map(f => path.basename(f, path.extname(f)))
      ];
      console.log(`[Local]   Search queries: ${JSON.stringify(searchQueries)}`);

      const seenChunks = new Set<string>();
      const chunkFiles: string[] = [];
      for (const query of searchQueries) {
        try {
          console.log(`[Local]   Searching for: "${query.slice(0, 50)}..."`);
          const results = await this.ragSystem.search(query, { maxResults: 5 });
          console.log(`[Local]     Found ${results.length} results`);

          for (const result of results) {
            const chunkKey = `${result.filePath}:${result.startLine}`;
            if (seenChunks.has(chunkKey)) continue;
            seenChunks.add(chunkKey);
            chunkFiles.push(result.filePath);

            // Include rich metadata from AST chunking
            const chunkHeader = result.name
              ? `### ${result.chunkType || 'Code'}: ${result.name} (${result.filePath}:${result.startLine})`
              : `### ${result.filePath}:${result.startLine}-${result.endLine}`;

            const docComment = result.documentation
              ? `\n**Documentation:** ${result.documentation.slice(0, 200)}...\n`
              : '';

            const signature = result.signature ? `\n**Signature:** \`${result.signature}\`\n` : '';

            ragContext += `\n${chunkHeader}${docComment}${signature}\n\`\`\`${result.language || ''}\n${result.content.slice(0, 1500)}\n\`\`\`\n`;

            if (ragContext.length > 12000) break; // Context budget - 21B model can handle more
          }
        } catch (err) {
          console.log(`[Local]   RAG search error for "${query}": ${(err as Error).message}`);
        }
        if (ragContext.length > 12000) break;
      }
      console.log(`[Local]   RAG context: ${ragContext.length} chars from ${seenChunks.size} chunks`);
      console.log(`[Local]   Files in context: ${[...new Set(chunkFiles)].join(', ')}`);
    }

    // Fallback: read source files directly if RAG didn't provide enough context
    if (ragContext.length < 500) {
      console.log(`[Local]   Using file fallback (RAG context insufficient)`);
      for (const file of pageSpec.sourceFiles.slice(0, 5)) {
        try {
          const fullPath = path.join(this.repoPath, file);
          if (fs.existsSync(fullPath)) {
            const content = fs.readFileSync(fullPath, 'utf-8');
            const preview = content.slice(0, 1500);
            ragContext += `\n### File: ${file}\n\`\`\`\n${preview}\n${content.length > 1500 ? '\n... (truncated)' : ''}\n\`\`\`\n`;
          }
        } catch {
          // Skip unreadable files
        }
      }
    }

    // Build a detailed prompt that produces high-quality documentation
    const relatedLinks = otherPages ? otherPages.split('\n').slice(0, 5).join('\n') : 'none';

    const prompt = `# Documentation Task: "${pageSpec.title}"

You are documenting a ${pageSpec.type} for a software project. Based on the source code below, write comprehensive technical documentation.

## Source Code Context
${ragContext || 'No source code available'}

## Documentation Requirements

Write a well-structured Markdown page with the following sections:

### 1. Overview (required)
- Start with \`# ${pageSpec.title}\`
- Write 3-4 sentences explaining what this ${pageSpec.type} does and why it exists
- Mention the key technologies used (React, TypeScript, etc.)

### 2. Key Components (required)
For each important file, function, or class you see in the code:
- Explain its purpose and responsibility
- Describe how it works at a high level
- Add a clickable source reference using this exact format: \`📄 [path/to/file.ts:line](../path/to/file.ts#Lline)\`
  Example: \`📄 [src/hooks/useAuth.ts:42](../src/hooks/useAuth.ts#L42)\`

### 3. How It Works (required)
- Explain the data flow or control flow
- Describe any patterns used (e.g., hooks, state management)
- Include code snippets where helpful
- Reference source files using the clickable link format above

### 4. Related Documentation
Link to these related pages:
${relatedLinks}

## Important Rules
- Base ALL content on the actual source code shown above
- ALWAYS use clickable source references: \`📄 [path/file.ts:line](../path/file.ts#Lline)\`
- Do not invent features or files not shown in the code
- Write for developers who need to understand and work with this code

Generate the documentation now:`;

    const messages: LLMMessage[] = [
      { role: 'user', content: prompt }
    ];

    const systemPrompt = `You are a senior technical writer creating internal documentation for a software development team. Your documentation is thorough, accurate, and always grounded in the actual source code. You explain not just WHAT the code does, but HOW it works and WHY it's designed that way. You include clickable source file references using this format: 📄 [path/file.ts:line](../path/file.ts#Lline)`;

    // Debug: show prompt stats
    console.log(`[Local]   ─────────────────────────────────────────────────────`);
    console.log(`[Local]   PROMPT STATS:`);
    console.log(`[Local]     System prompt: ${systemPrompt.length} chars`);
    console.log(`[Local]     User prompt: ${prompt.length} chars`);
    console.log(`[Local]     RAG context portion: ${ragContext.length} chars`);
    console.log(`[Local]     Total input: ~${Math.round((systemPrompt.length + prompt.length) / 4)} tokens (est.)`);
    console.log(`[Local]   ─────────────────────────────────────────────────────`);

    // Try up to 2 times
    for (let attempt = 1; attempt <= 2; attempt++) {
      try {
        console.log(`[Local]   Attempt ${attempt}: calling provider.chat()...`);

        const response = await provider.chat(messages, [], {
          maxTokens: 4096,
          systemPrompt,
          temperature: attempt === 1 ? 0.3 : 0.1, // Low temperature to reduce hallucination
        });

        console.log(`[Local]   Response: ${response.content?.length || 0} chars, stopReason: ${response.stopReason}`);

        if (response.content && response.content.length > 200) {
          // Post-process to ensure source references are clickable links
          const processedContent = this.makeSourceReferencesClickable(response.content);
          return processedContent;
        }

        if (attempt === 1) {
          console.log(`[Local]   Content too short (${response.content?.length || 0} chars), retrying...`);
        }
      } catch (error) {
        console.error(`[Local]   Attempt ${attempt} error: ${(error as Error).message}`);
        if (options.verbose) {
          console.error(`[Local]   Stack: ${(error as Error).stack}`);
        }
      }
    }

    console.log(`[Local]   Failed to generate content after 2 attempts`);
    return null;
  }

  /**
   * Generate the index page linking all generated pages
   */
  private async generateIndexPage(
    provider: LLMProvider,
    pages: Array<{ title: string; filename: string; type: string }>,
    options: WikiGenerationOptions
  ): Promise<string | null> {
    const pageLinks = pages.map(p =>
      `- [${p.title}](./${p.filename}) - ${p.type}`
    ).join('\n');

    const prompt = `Generate an index page for a technical wiki documentation site.

Project: ${path.basename(this.repoPath)}

Available Pages:
${pageLinks}

Requirements:
1. Create an engaging introduction to the project
2. Organize the page links into logical sections (Overview, Components, Guides, API)
3. Add a brief description for each section
4. Use proper Markdown formatting with a clear hierarchy
5. Keep it professional and helpful for developers

Generate the complete Markdown content for the index page:`;

    const messages: LLMMessage[] = [
      { role: 'user', content: prompt }
    ];

    try {
      const response = await provider.chat(messages, [], {
        maxTokens: 2048,
        systemPrompt: 'You are a technical documentation expert. Generate clear, well-organized index pages.',
        temperature: 0.7,
      });

      return response.content || null;
    } catch {
      // Fallback to a simple index
      return `# ${path.basename(this.repoPath)} Documentation\n\nWelcome to the documentation.\n\n## Pages\n\n${pageLinks}`;
    }
  }

  /**
   * Scan repository for source files
   */
  private async scanSourceFiles(repoPath: string): Promise<string[]> {
    const sourceFiles: string[] = [];
    const extensions = ['.ts', '.js', '.tsx', '.jsx', '.py', '.go', '.rs', '.java', '.rb', '.php', '.cs', '.cpp', '.c', '.h'];
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'coverage', '.next', '__pycache__', 'vendor'];

    const scan = (dir: string, relativePath: string = '') => {
      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true });
        for (const entry of entries) {
          const fullPath = path.join(dir, entry.name);
          const relPath = path.join(relativePath, entry.name);

          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              scan(fullPath, relPath);
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name).toLowerCase();
            if (extensions.includes(ext)) {
              sourceFiles.push(relPath);
            }
          }
        }
      } catch {
        // Ignore directories we can't read
      }
    };

    scan(repoPath);
    return sourceFiles;
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
   * Estimate generation for local mode - includes hardware detection and model recommendation
   */
  async estimateLocalGeneration(options: WikiGenerationOptions): Promise<LocalGenerationEstimate> {
    // Get base estimates
    const baseEstimate = await this.estimateGeneration(options);

    // Import model manager for hardware detection
    const { ModelManager } = await import('./llm/model-manager.js');
    const modelManager = new ModelManager();

    // Detect hardware
    const hardware = await modelManager.detectHardware();

    // Get recommended model
    const recommendation = modelManager.recommendModel(hardware);

    // Check if model is already downloaded
    const downloadedModels = modelManager.listDownloadedModels();
    const isDownloaded = downloadedModels.some(m => m.model.modelId === recommendation.modelId);

    // Estimate tokens per second based on hardware
    // These are rough estimates based on typical performance
    let tokensPerSecond: number;
    if (hardware.gpuVram >= 24) {
      tokensPerSecond = 40; // High-end GPU
    } else if (hardware.gpuVram >= 16) {
      tokensPerSecond = 30; // Mid-range GPU
    } else if (hardware.gpuVram >= 8) {
      tokensPerSecond = 20; // Lower GPU
    } else if (hardware.gpuVendor === 'apple') {
      // Apple Silicon - estimate based on unified memory
      tokensPerSecond = Math.min(35, 15 + (hardware.systemRam / 4));
    } else {
      // CPU-only or low VRAM
      tokensPerSecond = 5;
    }

    // Estimate generation time for local mode
    // Local models are slower but don't have API latency
    const tokensNeeded = baseEstimate.estimatedTokens * 2.5; // Input + output
    const generationSeconds = tokensNeeded / tokensPerSecond;
    const localGenerationMinutes = Math.round((generationSeconds / 60) * 10) / 10;

    // Calculate disk space needed
    const modelSizeGb = recommendation.fileSizeBytes / 1e9;
    const cacheSpaceGb = baseEstimate.estimatedChunks * 0.001; // ~1KB per chunk for embeddings
    const diskSpaceRequired = Math.round((modelSizeGb + cacheSpaceGb) * 10) / 10;

    return {
      ...baseEstimate,
      isLocal: true,
      // Override cost - local mode is free
      estimatedCost: {
        input: 0,
        output: 0,
        total: 0
      },
      // Override time estimates for local
      estimatedTime: {
        indexingMinutes: baseEstimate.estimatedTime.indexingMinutes,
        generationMinutes: localGenerationMinutes,
        totalMinutes: Math.round((baseEstimate.estimatedTime.indexingMinutes + localGenerationMinutes) * 10) / 10
      },
      hardware: {
        gpuVendor: hardware.gpuVendor,
        gpuName: hardware.gpuName,
        gpuVram: hardware.gpuVram,
        systemRam: hardware.systemRam,
        cpuCores: hardware.cpuCores
      },
      recommendedModel: {
        modelId: recommendation.modelId,
        quality: recommendation.quality,
        fileSizeGb: Math.round(modelSizeGb * 10) / 10,
        contextLength: recommendation.contextLength,
        minVram: recommendation.minVram,
        downloaded: isDownloaded
      },
      localEstimate: {
        tokensPerSecond,
        generationMinutes: localGenerationMinutes,
        downloadRequired: !isDownloaded,
        downloadSizeGb: isDownloaded ? 0 : Math.round(modelSizeGb * 10) / 10,
        diskSpaceRequired
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
    const tempDir = path.join(process.cwd(), '.semanticwiki-repos');
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
        'semanticwiki': this.customServer
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
        // Custom semanticwiki tools
        'mcp__semanticwiki__search_codebase',
        'mcp__semanticwiki__write_wiki_page',
        'mcp__semanticwiki__analyze_code_structure',
        'mcp__semanticwiki__verify_wiki_completeness',
        'mcp__semanticwiki__list_wiki_pages'
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

    // Surgical update mode - update specific pages based on code changes
    if (options.updateContext) {
      const ctx = options.updateContext;
      const newFilesList = ctx.newFiles.length > 0
        ? `### New Files (need new documentation)\n${ctx.newFiles.map(f => `- \`${f}\``).join('\n')}\n`
        : '';
      const modifiedFilesList = ctx.modifiedFiles.length > 0
        ? `### Modified Files (update existing docs)\n${ctx.modifiedFiles.map(f => `- \`${f}\``).join('\n')}\n`
        : '';
      const deletedFilesList = ctx.deletedFiles.length > 0
        ? `### Deleted Files (remove references)\n${ctx.deletedFiles.map(f => `- \`${f}\``).join('\n')}\n`
        : '';
      const affectedPagesList = ctx.affectedPages.length > 0
        ? `### Wiki Pages to Update\n${ctx.affectedPages.map(p => `- ${p}`).join('\n')}\n`
        : '';
      const pagesToCreateList = ctx.pagesToCreate.length > 0
        ? `### New Wiki Pages to Create\n${ctx.pagesToCreate.map(p => `- ${p}`).join('\n')}\n`
        : '';

      return `You are performing a SURGICAL UPDATE to the architectural documentation wiki based on recent code changes.

**Repository:** ${options.repoUrl}
**Output Directory:** ${this.outputDir}

## Code Changes Since Last Update

${newFilesList}
${modifiedFilesList}
${deletedFilesList}

## Documentation Updates Required

${affectedPagesList}
${pagesToCreateList}

## Instructions for Surgical Update

**For Modified Files:**
1. Use \`mcp__semanticwiki__search_codebase\` to understand what changed in the modified files
2. Read the affected wiki pages with \`mcp__filesystem__read_file\`
3. Update the specific sections that reference the changed code
4. Preserve all other content - only change what's necessary
5. Update any outdated code snippets, line numbers, or function references

**For New Files:**
1. Analyze the new files to understand their purpose
2. If they belong to an existing module, update that module's documentation
3. If they represent a new module/feature, create a new wiki page
4. Add appropriate cross-references to related existing pages

**For Deleted Files:**
1. Find all references to deleted files in wiki pages
2. Either remove the references or mark them as deprecated
3. Update any architectural diagrams that showed the deleted components

**IMPORTANT Guidelines:**
- Make MINIMAL changes - only update what's directly affected by the code changes
- Preserve existing formatting, structure, and cross-references
- Update line numbers in source references (file:line format) to match the new code
- After all updates, use \`mcp__semanticwiki__verify_wiki_completeness\` to check for broken links
- Do NOT regenerate entire pages unless absolutely necessary

Remember: Every architectural concept MUST include accurate file:line references to the source code.`;
    }

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

1. First, use \`mcp__semanticwiki__list_wiki_pages\` to see what pages already exist
2. For each missing page above:
   - Use \`mcp__semanticwiki__search_codebase\` to find relevant code for that topic
   - Use \`mcp__filesystem__read_file\` to read the specific source files
   - Use \`mcp__semanticwiki__write_wiki_page\` to create the page with proper source traceability
3. After creating all pages, use \`mcp__semanticwiki__verify_wiki_completeness\` to confirm all links are valid

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
5. Use \`mcp__semanticwiki__verify_wiki_completeness\` to check for broken links
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
              response += `Use \`mcp__semanticwiki__write_wiki_page\` to create each missing page above.\n`;
              response += `After creating all pages, run \`mcp__semanticwiki__verify_wiki_completeness\` again to confirm.\n`;
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
      name: 'semanticwiki',
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
