/**
 * Contextual Retrieval for SemanticWiki
 *
 * Implements Anthropic's Contextual Retrieval technique to improve RAG quality.
 * For each chunk, generates a brief context explanation using the full file content.
 *
 * Supports three modes:
 * - Claude API (with prompt caching for cost efficiency)
 * - Ollama (external local server)
 * - Bundled local (node-llama-cpp, no external dependencies)
 *
 * Reference: https://www.anthropic.com/news/contextual-retrieval
 */

import * as fs from 'fs';
import * as path from 'path';
import Anthropic from '@anthropic-ai/sdk';
import type { ASTChunk } from '../ast-chunker.js';
import type { LLMProvider } from '../llm/types.js';

/**
 * Configuration for contextual retrieval
 */
export interface ContextualRetrievalConfig {
  /** Enable contextual retrieval (default: false) */
  enabled: boolean;
  /** Use local LLM instead of Claude API */
  useLocal?: boolean;
  /** Use Ollama server (requires useLocal: true) */
  useOllama?: boolean;
  /** Anthropic API key (for Claude API mode) */
  apiKey?: string;
  /** Claude model to use (default: claude-3-haiku for speed/cost) */
  model?: string;
  /** Ollama host URL (for Ollama mode) */
  ollamaHost?: string;
  /** Local model name (for Ollama or bundled local) */
  localModel?: string;
  /** Model family for bundled local (default: gpt-oss) */
  modelFamily?: string;
  /** Maximum concurrent requests (default: 5 for API, 1 for local) */
  concurrency?: number;
  /** Cache generated contexts to avoid regeneration */
  cacheDir?: string;
  /** Progress callback */
  onProgress?: (current: number, total: number) => void;
}

/**
 * Result of contextual enrichment
 */
export interface ContextualChunk extends ASTChunk {
  /** Generated context explaining the chunk within the file */
  contextualPrefix: string;
  /** Combined content for embedding (context + original) */
  enrichedContent: string;
}

/**
 * Context generation prompt template
 * Based on Anthropic's recommended approach
 */
const CONTEXT_PROMPT = `<document>
{WHOLE_DOCUMENT}
</document>

Here is the chunk we want to situate within the whole document:
<chunk>
{CHUNK_CONTENT}
</chunk>

Please give a short succinct context to situate this chunk within the overall document for the purposes of improving search retrieval of the chunk. The context should:
1. Identify what file/module this is from and its purpose
2. Explain what this specific code does in the context of the whole file
3. Note any important relationships to other parts of the codebase

Answer only with the context, nothing else. Keep it under 100 words.`;

/**
 * Contextual Retrieval Generator
 *
 * Enriches code chunks with contextual information for better retrieval.
 */
export class ContextualRetrieval {
  private config: Required<ContextualRetrievalConfig>;
  private anthropicClient?: Anthropic;
  private localProvider?: LLMProvider;
  private contextCache: Map<string, string> = new Map();
  private fileContentCache: Map<string, string> = new Map();

  constructor(config: ContextualRetrievalConfig) {
    this.config = {
      enabled: config.enabled,
      useLocal: config.useLocal ?? false,
      useOllama: config.useOllama ?? false,
      apiKey: config.apiKey ?? process.env.ANTHROPIC_API_KEY ?? '',
      model: config.model ?? 'claude-3-haiku-20240307',
      ollamaHost: config.ollamaHost ?? 'http://localhost:11434',
      localModel: config.localModel ?? 'qwen2.5-coder:7b',
      modelFamily: config.modelFamily ?? 'gpt-oss',
      concurrency: config.concurrency ?? (config.useLocal ? 1 : 5),
      cacheDir: config.cacheDir ?? '',
      onProgress: config.onProgress ?? (() => {}),
    };

    // Load cache if available
    if (this.config.cacheDir) {
      this.loadCache();
    }
  }

  /**
   * Initialize the contextual retrieval system
   */
  async initialize(): Promise<void> {
    if (!this.config.enabled) return;

    if (!this.config.useLocal) {
      // Initialize Anthropic client
      if (!this.config.apiKey) {
        throw new Error('Anthropic API key required for contextual retrieval. Set ANTHROPIC_API_KEY or use --contextual-local');
      }
      this.anthropicClient = new Anthropic({ apiKey: this.config.apiKey });
      console.log('  Using Claude API for contextual retrieval');
    } else if (this.config.useOllama) {
      // Verify Ollama is available
      try {
        const response = await fetch(`${this.config.ollamaHost}/api/tags`);
        if (!response.ok) {
          throw new Error(`Ollama not available at ${this.config.ollamaHost}`);
        }
        console.log(`  Using Ollama (${this.config.localModel}) for contextual retrieval`);
      } catch (error) {
        throw new Error(`Cannot connect to Ollama at ${this.config.ollamaHost}: ${(error as Error).message}`);
      }
    } else {
      // Use bundled local inference (node-llama-cpp)
      // Use the 'completion' model family (Qwen2.5-Coder-1.5B) instead of gpt-oss
      // because gpt-oss has function-calling tokens that cause empty responses
      // for simple text completion tasks
      console.log('  Initializing bundled local LLM for contextual retrieval...');
      try {
        const { createLLMProvider } = await import('../llm/index.js');
        // Use 'completion' family - smaller model optimized for text completion
        this.localProvider = await createLLMProvider({
          fullLocal: true,
          modelFamily: 'completion',
        });
        console.log(`  Using bundled local LLM (Qwen2.5-Coder) for contextual retrieval`);
      } catch (error) {
        throw new Error(`Failed to initialize local LLM: ${(error as Error).message}`);
      }
    }
  }

  /**
   * Enrich chunks with contextual information
   *
   * @param chunks - Code chunks to enrich
   * @param repoPath - Path to the repository
   * @returns Enriched chunks with contextual prefixes
   */
  async enrichChunks(
    chunks: ASTChunk[],
    repoPath: string
  ): Promise<ContextualChunk[]> {
    if (!this.config.enabled) {
      // Return chunks as-is with empty context
      return chunks.map(chunk => ({
        ...chunk,
        contextualPrefix: '',
        enrichedContent: chunk.content,
      }));
    }

    console.log(`  Generating contextual enrichment for ${chunks.length} chunks...`);

    // Group chunks by file for efficient processing
    const chunksByFile = new Map<string, ASTChunk[]>();
    for (const chunk of chunks) {
      const existing = chunksByFile.get(chunk.filePath) || [];
      existing.push(chunk);
      chunksByFile.set(chunk.filePath, existing);
    }

    const enrichedChunks: ContextualChunk[] = [];
    let processedCount = 0;
    let successCount = 0;
    let emptyCount = 0;
    let fallbackCount = 0;
    let sequenceResetCount = 0;

    // For bundled local mode, we need to reinitialize periodically to avoid "No sequences left" error
    // The node-llama-cpp context has limited sequences (20), and they don't get released fast enough
    const SEQUENCE_RESET_THRESHOLD = 15; // Reset before hitting the 20 sequence limit
    let localChunksSinceReset = 0;

    // Process files in batches (or sequentially for local)
    const fileEntries = Array.from(chunksByFile.entries());
    const concurrency = this.config.useLocal && !this.config.useOllama ? 1 : this.config.concurrency;

    // Helper to reinitialize local provider when sequences are exhausted
    const reinitializeLocalProvider = async () => {
      if (this.localProvider && this.config.useLocal && !this.config.useOllama) {
        try {
          // Shutdown existing provider
          if ('shutdown' in this.localProvider) {
            await (this.localProvider as any).shutdown();
          }
          // Reinitialize with 'completion' family (Qwen2.5-Coder-1.5B)
          const { createLLMProvider } = await import('../llm/index.js');
          this.localProvider = await createLLMProvider({
            fullLocal: true,
            modelFamily: 'completion',
          });
          localChunksSinceReset = 0;
          sequenceResetCount++;
        } catch (error) {
          console.warn(`  Warning: Failed to reinitialize local provider: ${(error as Error).message}`);
        }
      }
    };

    for (let i = 0; i < fileEntries.length; i += concurrency) {
      const batch = fileEntries.slice(i, i + concurrency);

      const batchPromises = batch.map(async ([filePath, fileChunks]) => {
        // Read file content (with caching)
        let fileContent = this.fileContentCache.get(filePath);
        if (!fileContent) {
          try {
            const fullPath = path.join(repoPath, filePath);
            fileContent = fs.readFileSync(fullPath, 'utf-8');
            this.fileContentCache.set(filePath, fileContent);
          } catch {
            // If file can't be read, use chunk content as context
            fileContent = fileChunks.map(c => c.content).join('\n\n');
          }
        }

        // Generate context for each chunk in this file
        const results: ContextualChunk[] = [];
        for (const chunk of fileChunks) {
          const cacheKey = `${chunk.id}:${chunk.content.length}`;

          // Check cache first
          let contextualPrefix = this.contextCache.get(cacheKey);
          let usedFallback = false;

          if (!contextualPrefix) {
            // For bundled local mode, check if we need to reset sequences
            if (this.config.useLocal && !this.config.useOllama) {
              if (localChunksSinceReset >= SEQUENCE_RESET_THRESHOLD) {
                console.log(`  Resetting local LLM context (sequence limit reached)...`);
                await reinitializeLocalProvider();
              }
              localChunksSinceReset++;
            }

            try {
              contextualPrefix = await this.generateContext(fileContent, chunk);

              // If LLM returned empty, use fallback
              if (!contextualPrefix || contextualPrefix.trim().length === 0) {
                emptyCount++;
                contextualPrefix = this.generateFallbackContext(chunk);
                usedFallback = true;
              } else {
                successCount++;
              }

              this.contextCache.set(cacheKey, contextualPrefix);
            } catch (error) {
              const errorMsg = (error as Error).message;
              // If we hit sequence limit, try to recover
              if (errorMsg.includes('No sequences left')) {
                console.log(`  Recovering from sequence exhaustion...`);
                await reinitializeLocalProvider();
                // Retry once after reset
                try {
                  contextualPrefix = await this.generateContext(fileContent, chunk);
                  if (!contextualPrefix || contextualPrefix.trim().length === 0) {
                    emptyCount++;
                    contextualPrefix = this.generateFallbackContext(chunk);
                    usedFallback = true;
                  } else {
                    successCount++;
                  }
                  this.contextCache.set(cacheKey, contextualPrefix);
                } catch {
                  contextualPrefix = this.generateFallbackContext(chunk);
                  usedFallback = true;
                  fallbackCount++;
                }
              } else {
                console.warn(`  Warning: Failed to generate context for ${chunk.id}: ${errorMsg}`);
                contextualPrefix = this.generateFallbackContext(chunk);
                usedFallback = true;
                fallbackCount++;
              }
            }
          }

          results.push({
            ...chunk,
            contextualPrefix,
            enrichedContent: `${contextualPrefix}\n\n${chunk.content}`,
          });

          processedCount++;
          this.config.onProgress(processedCount, chunks.length);
        }

        return results;
      });

      const batchResults = await Promise.all(batchPromises);
      for (const results of batchResults) {
        enrichedChunks.push(...results);
      }

      // Log progress
      const progress = Math.round((processedCount / chunks.length) * 100);
      console.log(`  Contextual enrichment: ${processedCount}/${chunks.length} (${progress}%)`);
    }

    // Log summary stats
    console.log(`  Contextual enrichment complete:`);
    console.log(`    ✓ ${successCount} chunks enriched by LLM`);
    if (emptyCount > 0) {
      console.log(`    ⚠ ${emptyCount} empty responses (fallback used)`);
    }
    if (fallbackCount > 0) {
      console.log(`    ✗ ${fallbackCount} errors (fallback used)`);
    }
    if (sequenceResetCount > 0) {
      console.log(`    🔄 ${sequenceResetCount} context resets (sequence management)`);
    }

    // Save cache
    if (this.config.cacheDir) {
      this.saveCache();
    }

    return enrichedChunks;
  }

  /**
   * Generate context for a single chunk using the LLM
   */
  private async generateContext(
    fileContent: string,
    chunk: ASTChunk
  ): Promise<string> {
    const prompt = CONTEXT_PROMPT
      .replace('{WHOLE_DOCUMENT}', this.truncateContent(fileContent, 8000))
      .replace('{CHUNK_CONTENT}', this.truncateContent(chunk.content, 2000));

    if (!this.config.useLocal) {
      return this.generateContextClaude(prompt, fileContent);
    } else if (this.config.useOllama) {
      return this.generateContextOllama(prompt);
    } else {
      return this.generateContextBundledLocal(prompt);
    }
  }

  /**
   * Generate context using Claude API with prompt caching
   */
  private async generateContextClaude(
    prompt: string,
    _fileContent: string
  ): Promise<string> {
    if (!this.anthropicClient) {
      throw new Error('Anthropic client not initialized');
    }

    try {
      const response = await this.anthropicClient.messages.create({
        model: this.config.model,
        max_tokens: 150,
        messages: [
          {
            role: 'user',
            content: prompt,
          },
        ],
      });

      const textBlock = response.content.find(block => block.type === 'text');
      return textBlock && 'text' in textBlock ? textBlock.text.trim() : '';
    } catch (error) {
      throw new Error(`Claude API error: ${(error as Error).message}`);
    }
  }

  /**
   * Generate context using Ollama
   */
  private async generateContextOllama(prompt: string): Promise<string> {
    try {
      const response = await fetch(`${this.config.ollamaHost}/api/generate`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          model: this.config.localModel,
          prompt: prompt,
          stream: false,
          options: {
            num_predict: 150,
            temperature: 0.3,
          },
        }),
      });

      if (!response.ok) {
        throw new Error(`Ollama error: ${response.statusText}`);
      }

      const data = await response.json() as { response: string };
      return data.response?.trim() || '';
    } catch (error) {
      throw new Error(`Ollama error: ${(error as Error).message}`);
    }
  }

  /**
   * Generate context using bundled local LLM (node-llama-cpp)
   */
  private async generateContextBundledLocal(prompt: string): Promise<string> {
    if (!this.localProvider) {
      throw new Error('Local LLM provider not initialized');
    }

    // System prompt to guide the local model
    const systemPrompt = `You are a code documentation assistant. Your task is to write a brief context description (under 100 words) that explains what a code chunk does within its file. Be concise and factual. Output ONLY the context description, nothing else.`;

    try {
      const response = await this.localProvider.chat(
        [{ role: 'user', content: prompt }],
        [],  // No tools needed for simple completion
        {
          maxTokens: 150,
          temperature: 0.3,
          systemPrompt,
        }
      );

      return response.content.trim();
    } catch (error) {
      throw new Error(`Local LLM error: ${(error as Error).message}`);
    }
  }

  /**
   * Generate fallback context when LLM is unavailable
   * Uses AST metadata to create a basic context
   */
  private generateFallbackContext(chunk: ASTChunk): string {
    const parts: string[] = [];

    // File info
    const fileName = path.basename(chunk.filePath);
    parts.push(`This code is from ${fileName}.`);

    // Chunk type and name
    if (chunk.chunkType && chunk.name) {
      const typeMap: Record<string, string> = {
        'function': 'function',
        'class': 'class',
        'method': 'method',
        'interface': 'interface',
        'service': 'service',
        'controller': 'controller',
        'handler': 'handler',
        'model': 'data model',
        'repository': 'data access',
      };
      const type = typeMap[chunk.chunkType] || chunk.chunkType;
      parts.push(`It defines ${chunk.name}, a ${type}.`);
    }

    // Parent context
    if (chunk.parentName) {
      parts.push(`It belongs to ${chunk.parentName}.`);
    }

    // Domain hints
    if (chunk.domainHints && chunk.domainHints.length > 0) {
      const domains = chunk.domainHints
        .filter(h => h.confidence > 0.5)
        .map(h => h.category.replace('-', ' '))
        .slice(0, 2);
      if (domains.length > 0) {
        parts.push(`Related to ${domains.join(' and ')}.`);
      }
    }

    return parts.join(' ');
  }

  /**
   * Truncate content to fit within token limits
   */
  private truncateContent(content: string, maxChars: number): string {
    if (content.length <= maxChars) return content;

    // Truncate at a natural boundary (newline)
    const truncated = content.slice(0, maxChars);
    const lastNewline = truncated.lastIndexOf('\n');
    if (lastNewline > maxChars * 0.8) {
      return truncated.slice(0, lastNewline) + '\n... [truncated]';
    }
    return truncated + '\n... [truncated]';
  }

  /**
   * Load context cache from disk
   */
  private loadCache(): void {
    const cachePath = path.join(this.config.cacheDir, 'contextual-cache.json');
    if (fs.existsSync(cachePath)) {
      try {
        const data = JSON.parse(fs.readFileSync(cachePath, 'utf-8'));
        this.contextCache = new Map(Object.entries(data));
        console.log(`  Loaded ${this.contextCache.size} cached contexts`);
      } catch {
        // Ignore cache errors
      }
    }
  }

  /**
   * Save context cache to disk
   */
  private saveCache(): void {
    if (!this.config.cacheDir) return;

    const cachePath = path.join(this.config.cacheDir, 'contextual-cache.json');
    try {
      fs.mkdirSync(this.config.cacheDir, { recursive: true });
      const data = Object.fromEntries(this.contextCache);
      fs.writeFileSync(cachePath, JSON.stringify(data, null, 2));
    } catch {
      // Ignore cache errors
    }
  }

  /**
   * Preview contextual enrichment for a sample of chunks
   * Useful for debugging and validating the enrichment quality
   */
  async previewEnrichment(
    chunks: ASTChunk[],
    repoPath: string,
    sampleSize: number = 10
  ): Promise<{
    mode: string;
    totalChunks: number;
    sampleSize: number;
    samples: Array<{
      id: string;
      filePath: string;
      chunkType?: string;
      name?: string;
      contentPreview: string;
      contextualPrefix: string;
      status: 'success' | 'empty' | 'fallback' | 'error';
    }>;
  }> {
    // Determine mode
    let mode = 'claude-api';
    if (this.config.useLocal) {
      mode = this.config.useOllama ? 'ollama' : 'bundled-local';
    }

    // Sample chunks (spread across different files)
    const sampleChunks: ASTChunk[] = [];
    const filesSeen = new Set<string>();

    for (const chunk of chunks) {
      if (sampleChunks.length >= sampleSize) break;
      if (!filesSeen.has(chunk.filePath) || sampleChunks.length < sampleSize / 2) {
        sampleChunks.push(chunk);
        filesSeen.add(chunk.filePath);
      }
    }

    const samples: Array<{
      id: string;
      filePath: string;
      chunkType?: string;
      name?: string;
      contentPreview: string;
      contextualPrefix: string;
      status: 'success' | 'empty' | 'fallback' | 'error';
    }> = [];

    for (const chunk of sampleChunks) {
      let contextualPrefix = '';
      let status: 'success' | 'empty' | 'fallback' | 'error' = 'success';

      // Read file content
      let fileContent = '';
      try {
        const fullPath = path.join(repoPath, chunk.filePath);
        fileContent = fs.readFileSync(fullPath, 'utf-8');
      } catch {
        fileContent = chunk.content;
      }

      try {
        contextualPrefix = await this.generateContext(fileContent, chunk);

        if (!contextualPrefix || contextualPrefix.trim().length === 0) {
          status = 'empty';
          contextualPrefix = this.generateFallbackContext(chunk);
        }
      } catch (error) {
        status = 'error';
        contextualPrefix = this.generateFallbackContext(chunk);
      }

      samples.push({
        id: chunk.id,
        filePath: chunk.filePath,
        chunkType: chunk.chunkType,
        name: chunk.name,
        contentPreview: chunk.content.slice(0, 100) + (chunk.content.length > 100 ? '...' : ''),
        contextualPrefix,
        status,
      });
    }

    return {
      mode,
      totalChunks: chunks.length,
      sampleSize: samples.length,
      samples,
    };
  }

  /**
   * Get statistics about contextual enrichment
   */
  getStats(): {
    cacheHits: number;
    cacheSize: number;
    filesProcessed: number;
  } {
    return {
      cacheHits: this.contextCache.size,
      cacheSize: this.contextCache.size,
      filesProcessed: this.fileContentCache.size,
    };
  }

  /**
   * Cleanup resources
   */
  async cleanup(): Promise<void> {
    if (this.localProvider && 'cleanup' in this.localProvider) {
      await (this.localProvider as any).cleanup();
    }
  }
}

/**
 * Estimate cost of contextual retrieval for a codebase
 *
 * @param chunkCount - Number of chunks to process
 * @param avgFileSize - Average file size in characters
 * @returns Estimated cost in USD
 */
export function estimateContextualRetrievalCost(
  chunkCount: number,
  avgFileSize: number = 5000
): {
  inputTokens: number;
  outputTokens: number;
  estimatedCost: number;
  withCaching: number;
} {
  // Estimate tokens (roughly 4 chars per token)
  const tokensPerChunk = Math.ceil(avgFileSize / 4) + 500; // file + chunk + prompt
  const outputTokensPerChunk = 100;

  const inputTokens = chunkCount * tokensPerChunk;
  const outputTokens = chunkCount * outputTokensPerChunk;

  // Claude 3 Haiku pricing (as of 2024)
  // Input: $0.25 per million tokens
  // Output: $1.25 per million tokens
  const inputCost = (inputTokens / 1_000_000) * 0.25;
  const outputCost = (outputTokens / 1_000_000) * 1.25;
  const estimatedCost = inputCost + outputCost;

  // With prompt caching, input costs are reduced by ~90%
  // (same file content cached across chunks)
  const withCaching = (inputCost * 0.1) + outputCost;

  return {
    inputTokens,
    outputTokens,
    estimatedCost,
    withCaching,
  };
}
