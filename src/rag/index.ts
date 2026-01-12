/**
 * RAG (Retrieval Augmented Generation) System for ArchitecturalWiki
 *
 * Uses FAISS for vector similarity search over codebase embeddings.
 * Chunks code at logical boundaries and indexes for semantic retrieval.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';
import { simpleGit, SimpleGit } from 'simple-git';
import { createRequire } from 'module';
import { pipeline, env } from '@huggingface/transformers';
import {
  ASTChunker,
  ASTChunk,
  ChunkType,
  DomainCategory,
  generateDomainContext
} from '../ast-chunker.js';

// Configure transformers.js to use local cache
env.cacheDir = './.ted-mosby-models';

// FAISS types (faiss-node) - use createRequire for CommonJS module in ESM context
let faiss: any;
try {
  const require = createRequire(import.meta.url);
  faiss = require('faiss-node');
} catch (e) {
  console.warn('Warning: faiss-node not available, using fallback similarity search');
}

// Embedding model - will be initialized lazily
let embeddingPipeline: any = null;

export interface RAGConfig {
  storePath: string;
  repoPath: string;
  chunkSize?: number;
  chunkOverlap?: number;
  embeddingModel?: string;
  /** Maximum number of chunks to index (for large codebases, limit memory usage) */
  maxChunks?: number;
  /** Use AST-based chunking for semantic code understanding (default: true) */
  useASTChunking?: boolean;
  /** Extract business domain hints from code (default: true) */
  extractDomainHints?: boolean;
}

export interface BatchInfo {
  totalChunks: number;
  totalBatches: number;
  currentBatch: number;
  batchStart: number;
  batchEnd: number;
  chunksInBatch: number;
}

export interface CodeChunk {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  /** Type of code construct (function, class, etc.) */
  chunkType?: ChunkType;
  /** Name of the construct */
  name?: string;
  /** Parent construct name if nested */
  parentName?: string;
  /** Documentation/comments */
  documentation?: string;
  /** Inferred business domain categories */
  domainCategories?: DomainCategory[];
  /** Domain context string for embedding enrichment */
  domainContext?: string;
  /** Whether this is a public API */
  isPublicApi?: boolean;
  /** Function/method signature */
  signature?: string;
}

export interface SearchResult extends CodeChunk {
  score: number;
}

export interface SearchOptions {
  maxResults?: number;
  fileTypes?: string[];
  excludeTests?: boolean;
}

interface StoredMetadata {
  id: string;
  filePath: string;
  startLine: number;
  endLine: number;
  content: string;
  language: string;
  /** Type of code construct */
  chunkType?: ChunkType;
  /** Name of the construct */
  name?: string;
  /** Parent construct name */
  parentName?: string;
  /** Documentation/comments */
  documentation?: string;
  /** Inferred business domain categories */
  domainCategories?: DomainCategory[];
  /** Domain context for embedding enrichment */
  domainContext?: string;
  /** Whether this is public API */
  isPublicApi?: boolean;
  /** Function/method signature */
  signature?: string;
}

interface IndexState {
  commitHash: string;
  indexedAt: string;
  fileCount: number;
  chunkCount: number;
}

// File extensions to index
const INDEXABLE_EXTENSIONS = [
  '.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs',
  '.py', '.pyx',
  '.go',
  '.rs',
  '.java', '.kt', '.scala',
  '.rb',
  '.php',
  '.c', '.cpp', '.h', '.hpp',
  '.cs',
  '.swift',
  '.vue', '.svelte',
  '.json', '.yaml', '.yml', '.toml',
  '.md', '.mdx',
  // Mainframe / COBOL
  '.cbl', '.cob', '.cobol',  // COBOL source files
  '.cpy', '.copy',            // COBOL copybooks (like headers/includes)
  '.jcl',                     // Job Control Language
  '.pli', '.pl1',             // PL/I
  '.asm', '.s',               // Assembly
  '.sql',                     // SQL (embedded or standalone)
  '.bms',                     // BMS map definitions (CICS)
  '.prc', '.proc'             // JCL procedures
];

// Patterns to exclude
const EXCLUDE_PATTERNS = [
  '**/node_modules/**',
  '**/.git/**',
  '**/dist/**',
  '**/build/**',
  '**/.next/**',
  '**/coverage/**',
  '**/__pycache__/**',
  '**/venv/**',
  '**/.venv/**',
  '**/vendor/**',
  '**/*.min.js',
  '**/*.bundle.js',
  '**/package-lock.json',
  '**/yarn.lock',
  '**/pnpm-lock.yaml'
];

export class RAGSystem {
  private config: RAGConfig;
  private index: any = null;  // FAISS index
  private metadata: Map<number, StoredMetadata> = new Map();
  private embeddingDimension = 384;  // all-MiniLM-L6-v2 dimension
  private documentCount = 0;
  private indexState: IndexState | null = null;
  private astChunker: ASTChunker;

  constructor(config: RAGConfig) {
    this.config = {
      chunkSize: 1500,
      chunkOverlap: 200,
      useASTChunking: true,  // Enable AST chunking by default
      extractDomainHints: true,  // Extract domain hints by default
      ...config
    };

    // Initialize AST chunker
    this.astChunker = new ASTChunker({
      maxChunkSize: this.config.chunkSize,
      minChunkSize: 100,
      extractDomainHints: this.config.extractDomainHints
    });

    // Ensure cache directory exists
    if (!fs.existsSync(this.config.storePath)) {
      fs.mkdirSync(this.config.storePath, { recursive: true });
    }
  }

  /**
   * Initialize the embedding model (lazy loading)
   */
  private async getEmbeddingPipeline(): Promise<any> {
    if (!embeddingPipeline) {
      console.log('  Loading embedding model (first run only)...');
      // Use all-MiniLM-L6-v2 - small, fast, good quality for code search
      embeddingPipeline = await pipeline('feature-extraction', 'Xenova/all-MiniLM-L6-v2');
    }
    return embeddingPipeline;
  }

  /**
   * Get the current git commit hash for the repository
   */
  private async getCurrentCommitHash(): Promise<string> {
    try {
      const git: SimpleGit = simpleGit(this.config.repoPath);
      const log = await git.log({ maxCount: 1 });
      return log.latest?.hash || 'unknown';
    } catch {
      return 'unknown';
    }
  }

  /**
   * Get the index state (last indexed commit)
   */
  getIndexState(): IndexState | null {
    return this.indexState;
  }

  /**
   * Get files changed since a specific commit
   */
  async getChangedFilesSince(commitHash: string): Promise<string[]> {
    try {
      const git: SimpleGit = simpleGit(this.config.repoPath);
      const diff = await git.diff(['--name-only', commitHash, 'HEAD']);
      return diff.split('\n').filter(f => f.trim().length > 0);
    } catch {
      return [];
    }
  }

  /**
   * Index the repository for semantic search
   */
  async indexRepository(): Promise<void> {
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const cachedMetaPath = path.join(this.config.storePath, 'metadata.json');
    const indexStatePath = path.join(this.config.storePath, 'index-state.json');

    // Get current commit hash
    const currentCommit = await this.getCurrentCommitHash();

    // Try to load cached index
    if (fs.existsSync(cachedIndexPath) && fs.existsSync(cachedMetaPath) && faiss) {
      try {
        // faiss-node API: IndexFlatIP.read(path) to load index
        this.index = faiss.IndexFlatIP.read(cachedIndexPath);
        const metaData = JSON.parse(fs.readFileSync(cachedMetaPath, 'utf-8'));
        this.metadata = new Map(Object.entries(metaData).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
        this.documentCount = this.metadata.size;

        // Load index state if available
        if (fs.existsSync(indexStatePath)) {
          this.indexState = JSON.parse(fs.readFileSync(indexStatePath, 'utf-8'));
          console.log(`Loaded cached index with ${this.documentCount} chunks (indexed at commit ${this.indexState?.commitHash?.slice(0, 7) || 'unknown'})`);
        } else {
          console.log(`Loaded cached index with ${this.documentCount} chunks`);
        }
        return;
      } catch (e) {
        console.warn('Could not load cached index, rebuilding...');
      }
    }

    // Discover files
    console.log('  Discovering files...');
    const files = await this.discoverFiles();
    console.log(`  Found ${files.length} files to index`);

    // Chunk files with progress
    const chunks: CodeChunk[] = [];
    let lastProgress = -1;

    for (let i = 0; i < files.length; i++) {
      // Yield to event loop every 10 files to allow Ctrl+C
      if (i % 10 === 0) {
        await new Promise(resolve => setImmediate(resolve));
      }

      const file = files[i];

      // Show progress every 5%
      const progress = Math.floor((i + 1) / files.length * 100);
      if (progress >= lastProgress + 5) {
        console.log(`  Chunking... ${i + 1}/${files.length} (${progress}%)`);
        lastProgress = progress;
      }

      try {
        const fileChunks = await this.chunkFile(file);
        chunks.push(...fileChunks);
      } catch (err) {
        // Skip files that fail to chunk
      }
    }
    console.log(`  Chunking complete: ${chunks.length} chunks from ${files.length} files`);

    if (chunks.length === 0) {
      console.warn('No code chunks to index');
      return;
    }

    // Apply maxChunks limit if configured (for large codebases)
    let chunksToIndex = chunks;
    if (this.config.maxChunks && chunks.length > this.config.maxChunks) {
      console.log(`  ⚠️  Limiting to ${this.config.maxChunks} chunks (was ${chunks.length}) to manage memory`);
      // Prioritize chunks from smaller files and main source directories
      chunksToIndex = this.prioritizeChunks(chunks, this.config.maxChunks);
    }

    // Generate embeddings
    console.log(`  Generating embeddings for ${chunksToIndex.length} chunks...`);
    const embeddings = await this.generateEmbeddings(chunksToIndex);

    // Build FAISS index
    console.log(`  Building search index...`);
    if (faiss && embeddings.length > 0) {
      // Get actual dimension from first embedding
      const actualDimension = embeddings[0].length;
      if (actualDimension !== this.embeddingDimension) {
        console.log(`  Adjusting dimension: expected ${this.embeddingDimension}, got ${actualDimension}`);
        this.embeddingDimension = actualDimension;
      }

      this.index = new faiss.IndexFlatIP(this.embeddingDimension);  // Inner product for cosine similarity

      // Normalize all embeddings and prepare for batch add
      const normalizedEmbeddings: number[][] = [];
      for (let i = 0; i < embeddings.length; i++) {
        const normalized = this.normalizeVector(embeddings[i]);
        normalizedEmbeddings.push(normalized);
        const chunk = chunksToIndex[i];
        this.metadata.set(i, {
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          language: chunk.language,
          chunkType: chunk.chunkType,
          name: chunk.name,
          parentName: chunk.parentName,
          documentation: chunk.documentation,
          domainCategories: chunk.domainCategories,
          domainContext: chunk.domainContext,
          isPublicApi: chunk.isPublicApi,
          signature: chunk.signature
        });
      }

      // Add all vectors in one batch to avoid threading issues
      // IMPORTANT: faiss-node expects a flat array, not array of arrays
      // e.g., [v1_d1, v1_d2, ..., v2_d1, v2_d2, ...] not [[v1], [v2], ...]
      try {
        const flatEmbeddings = normalizedEmbeddings.flat();
        this.index.add(flatEmbeddings);
      } catch (faissError) {
        console.warn(`  FAISS batch add failed, falling back to keyword search: ${faissError}`);
        // Fall through to keyword search fallback
        this.index = null;
      }

      if (this.index) {
        // Save index and metadata
        // faiss-node API: index.write(path) to save index
        this.index.write(cachedIndexPath);
        fs.writeFileSync(
          cachedMetaPath,
          JSON.stringify(Object.fromEntries(this.metadata)),
          'utf-8'
        );

        // Save index state with commit hash
        this.indexState = {
          commitHash: currentCommit,
          indexedAt: new Date().toISOString(),
          fileCount: files.length,
          chunkCount: chunksToIndex.length
        };
        fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

        this.documentCount = chunksToIndex.length;
        console.log(`  ✓ Indexed ${this.documentCount} chunks with FAISS (commit ${currentCommit.slice(0, 7)})`);
        return;
      }
    }

    // Fallback: keyword search mode (when FAISS not available or failed)
    // Metadata may already be populated from the FAISS attempt, but ensure it's complete
    if (this.metadata.size === 0) {
      chunksToIndex.forEach((chunk, i) => {
        this.metadata.set(i, {
          id: chunk.id,
          filePath: chunk.filePath,
          startLine: chunk.startLine,
          endLine: chunk.endLine,
          content: chunk.content,
          language: chunk.language,
          chunkType: chunk.chunkType,
          name: chunk.name,
          parentName: chunk.parentName,
          documentation: chunk.documentation,
          domainCategories: chunk.domainCategories,
          domainContext: chunk.domainContext,
          isPublicApi: chunk.isPublicApi,
          signature: chunk.signature
        });
      });
    }

    // Save metadata for fallback search
    fs.writeFileSync(
      cachedMetaPath,
      JSON.stringify(Object.fromEntries(this.metadata)),
      'utf-8'
    );

    // Save index state with commit hash (even in fallback mode)
    this.indexState = {
      commitHash: currentCommit,
      indexedAt: new Date().toISOString(),
      fileCount: files.length,
      chunkCount: chunksToIndex.length
    };
    fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

    this.documentCount = chunksToIndex.length;
    console.log(`  ✓ Indexed ${this.documentCount} chunks (keyword search mode, commit ${currentCommit.slice(0, 7)})`);
  }

  /**
   * Discover all indexable files in the repository
   */
  private async discoverFiles(): Promise<string[]> {
    const files: string[] = [];

    // Process extensions one at a time with event loop yields
    for (let i = 0; i < INDEXABLE_EXTENSIONS.length; i++) {
      const ext = INDEXABLE_EXTENSIONS[i];

      // Yield to event loop to allow Ctrl+C to work
      await new Promise(resolve => setImmediate(resolve));

      try {
        const matches = await glob(`**/*${ext}`, {
          cwd: this.config.repoPath,
          ignore: EXCLUDE_PATTERNS,
          absolute: false
        });
        files.push(...matches);

        // Show progress for large repos
        if (matches.length > 0) {
          console.log(`    Found ${matches.length} ${ext} files`);
        }
      } catch (err) {
        // Skip on error, continue with other extensions
      }
    }

    return [...new Set(files)];  // Remove duplicates
  }

  /**
   * Chunk a file into logical segments using AST analysis or fallback line-based chunking
   */
  private async chunkFile(filePath: string): Promise<CodeChunk[]> {
    const fullPath = path.join(this.config.repoPath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const lines = content.split('\n');
    const ext = path.extname(filePath);
    const language = this.getLanguage(ext);

    // Try AST-based chunking first if enabled
    if (this.config.useASTChunking) {
      try {
        const astChunks = await this.astChunker.chunkFile(filePath, this.config.repoPath);

        // Convert ASTChunk to CodeChunk with domain context
        return astChunks.map(astChunk => {
          const domainCategories = astChunk.domainHints
            ?.filter(h => h.confidence > 0.3)
            .map(h => h.category);

          return {
            id: astChunk.id,
            filePath: astChunk.filePath,
            startLine: astChunk.startLine,
            endLine: astChunk.endLine,
            content: astChunk.content,
            language: astChunk.language,
            chunkType: astChunk.chunkType,
            name: astChunk.name,
            parentName: astChunk.parentName,
            documentation: astChunk.documentation,
            domainCategories,
            domainContext: generateDomainContext(astChunk),
            isPublicApi: astChunk.isPublicApi,
            signature: astChunk.signature
          };
        });
      } catch (err) {
        // Fall back to line-based chunking if AST parsing fails
        console.warn(`  AST chunking failed for ${filePath}, using line-based: ${err}`);
      }
    }

    // Fallback: Line-based chunking
    const chunks: CodeChunk[] = [];
    const chunkSize = this.config.chunkSize!;
    const overlap = this.config.chunkOverlap!;

    let startLine = 0;

    while (startLine < lines.length) {
      // Calculate chunk boundaries
      let endLine = startLine;
      let charCount = 0;

      while (endLine < lines.length && charCount < chunkSize) {
        charCount += lines[endLine].length + 1;  // +1 for newline
        endLine++;
      }

      // Try to end at a logical boundary (empty line, closing brace)
      const lookAhead = Math.min(endLine + 10, lines.length);
      for (let i = endLine; i < lookAhead; i++) {
        const line = lines[i].trim();
        if (line === '' || line === '}' || line === '};' || line === 'end') {
          endLine = i + 1;
          break;
        }
      }

      const chunkContent = lines.slice(startLine, endLine).join('\n');

      if (chunkContent.trim().length > 50) {  // Skip tiny chunks
        chunks.push({
          id: `${filePath}:${startLine + 1}-${endLine}`,
          filePath,
          startLine: startLine + 1,  // 1-indexed
          endLine,
          content: chunkContent,
          language
        });
      }

      // Move to next chunk with overlap
      const prevStartLine = startLine;
      startLine = endLine - Math.floor(overlap / 50);  // Overlap in lines

      // Prevent infinite loop - ensure we always make progress
      if (startLine <= prevStartLine) {
        startLine = endLine;
      }
    }

    return chunks;
  }

  /**
   * Generate embeddings for code chunks using local Transformers.js model
   * Uses all-MiniLM-L6-v2 - a fast, high-quality embedding model
   *
   * When domain context is available, prepends it to improve retrieval quality
   * by making the embedding more semantically aware of the code's purpose.
   */
  private async generateEmbeddings(chunks: CodeChunk[]): Promise<number[][]> {
    const embeddings: number[][] = [];
    const extractor = await this.getEmbeddingPipeline();

    // Process in batches for memory efficiency
    const batchSize = 32;
    for (let i = 0; i < chunks.length; i += batchSize) {
      const batch = chunks.slice(i, i + batchSize);

      try {
        // Generate embeddings for the batch
        for (const chunk of batch) {
          // Build embedding text with domain context for better semantic retrieval
          // Domain context helps the model understand what the code does, not just what it is
          let textForEmbedding = '';

          // Prepend domain context if available
          if (chunk.domainContext) {
            textForEmbedding = `${chunk.domainContext}\n\n`;
          }

          // Add documentation if available (often describes purpose)
          if (chunk.documentation) {
            const docSnippet = chunk.documentation.slice(0, 300);
            textForEmbedding += `${docSnippet}\n\n`;
          }

          // Add the code content
          // Truncate total to avoid memory issues (model max is 512 tokens)
          const remainingBudget = 2000 - textForEmbedding.length;
          textForEmbedding += chunk.content.slice(0, Math.max(remainingBudget, 500));

          const output = await extractor(textForEmbedding, { pooling: 'mean', normalize: true });
          // Convert to array
          embeddings.push(Array.from(output.data));
        }

        // Progress update every batch
        const processed = Math.min(i + batchSize, chunks.length);
        const percent = Math.floor(processed / chunks.length * 100);
        console.log(`  Embedding... ${processed}/${chunks.length} (${percent}%)`);

      } catch (error) {
        console.warn(`Embedding error at batch ${i}: ${error}`);
        // Add zero vectors as fallback
        for (let j = 0; j < batch.length; j++) {
          embeddings.push(new Array(this.embeddingDimension).fill(0));
        }
      }
    }

    console.log(`  Embedding complete: ${embeddings.length} vectors generated`);
    return embeddings;
  }

  /**
   * Generate embedding for a single text (used for queries)
   */
  private async generateSingleEmbedding(text: string): Promise<number[]> {
    const extractor = await this.getEmbeddingPipeline();
    const truncated = text.slice(0, 2000);
    const output = await extractor(truncated, { pooling: 'mean', normalize: true });
    return Array.from(output.data);
  }

  /**
   * Normalize a vector for cosine similarity
   */
  private normalizeVector(vector: number[]): number[] {
    const norm = Math.sqrt(vector.reduce((sum, val) => sum + val * val, 0));
    if (norm === 0) return vector;
    return vector.map(val => val / norm);
  }

  /**
   * Search the codebase for relevant code
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults || 10;

    if (this.metadata.size === 0) {
      return [];
    }

    // Generate query embedding using local model
    const queryEmbedding = await this.generateSingleEmbedding(query);

    let results: SearchResult[] = [];

    if (this.index && faiss) {
      // FAISS search - pass flat array (faiss-node expects flat, not nested)
      // Results are also flat arrays: { distances: [d1, d2, ...], labels: [l1, l2, ...] }
      const normalized = this.normalizeVector(queryEmbedding);
      const { distances, labels } = this.index.search(normalized, maxResults * 2);

      for (let i = 0; i < labels.length; i++) {
        const label = labels[i];
        if (label === -1) continue;

        const meta = this.metadata.get(label);
        if (!meta) continue;

        // Apply filters
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        results.push({
          ...meta,
          score: distances[i]
        });

        if (results.length >= maxResults) break;
      }
    } else {
      // Fallback: simple keyword matching
      const queryTerms = query.toLowerCase().split(/\s+/);

      const scored: Array<{ meta: StoredMetadata; score: number }> = [];
      for (const [, meta] of this.metadata) {
        // Apply filters
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        // Simple relevance score
        const content = meta.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          const matches = (content.match(new RegExp(term, 'g')) || []).length;
          score += matches;
        }

        if (score > 0) {
          scored.push({ meta, score });
        }
      }

      // Sort by score descending
      scored.sort((a, b) => b.score - a.score);

      results = scored.slice(0, maxResults).map(s => ({
        ...s.meta,
        score: s.score
      }));
    }

    return results;
  }

  /**
   * Check if a file is a test file
   */
  private isTestFile(filePath: string): boolean {
    const testPatterns = [
      /\.test\./,
      /\.spec\./,
      /_test\./,
      /test_/,
      /__tests__/,
      /tests\//,
      /\.stories\./,
      /__mocks__/
    ];
    return testPatterns.some(pattern => pattern.test(filePath));
  }

  /**
   * Get language from file extension
   */
  private getLanguage(ext: string): string {
    const langMap: Record<string, string> = {
      '.ts': 'typescript',
      '.tsx': 'tsx',
      '.js': 'javascript',
      '.jsx': 'jsx',
      '.py': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.rb': 'ruby',
      '.php': 'php',
      '.c': 'c',
      '.cpp': 'cpp',
      '.h': 'c',
      '.hpp': 'cpp',
      '.cs': 'csharp',
      '.swift': 'swift',
      '.vue': 'vue',
      '.svelte': 'svelte',
      '.json': 'json',
      '.yaml': 'yaml',
      '.yml': 'yaml',
      '.md': 'markdown',
      // Mainframe / COBOL
      '.cbl': 'cobol',
      '.cob': 'cobol',
      '.cobol': 'cobol',
      '.cpy': 'cobol',      // Copybooks are COBOL
      '.copy': 'cobol',
      '.jcl': 'jcl',
      '.pli': 'pli',
      '.pl1': 'pli',
      '.asm': 'asm',
      '.s': 'asm',
      '.sql': 'sql',
      '.bms': 'bms',
      '.prc': 'jcl',
      '.proc': 'jcl'
    };
    return langMap[ext.toLowerCase()] || '';
  }

  /**
   * Get the number of indexed documents
   */
  getDocumentCount(): number {
    return this.documentCount;
  }

  /**
   * Discover total chunk count without indexing (for batch planning)
   */
  async discoverChunkCount(): Promise<{ files: number; chunks: number }> {
    const files = await this.discoverFiles();
    let totalChunks = 0;

    for (const file of files) {
      try {
        const fileChunks = await this.chunkFile(file);
        totalChunks += fileChunks.length;
      } catch {
        // Skip files that fail
      }
    }

    return { files: files.length, chunks: totalChunks };
  }

  /**
   * Index a specific batch of chunks (for chunked generation mode).
   * Returns batch info for progress tracking.
   */
  async indexBatch(batchNumber: number, batchSize: number): Promise<BatchInfo> {
    const batchStatePath = path.join(this.config.storePath, `batch-${batchNumber}-state.json`);

    // Discover all files and chunks
    console.log(`  [Batch ${batchNumber}] Discovering files...`);
    const files = await this.discoverFiles();

    // Chunk all files
    const allChunks: CodeChunk[] = [];
    for (const file of files) {
      try {
        const fileChunks = await this.chunkFile(file);
        allChunks.push(...fileChunks);
      } catch {
        // Skip files that fail
      }
    }

    const totalChunks = allChunks.length;
    const totalBatches = Math.ceil(totalChunks / batchSize);
    const batchStart = batchNumber * batchSize;
    const batchEnd = Math.min(batchStart + batchSize, totalChunks);

    if (batchStart >= totalChunks) {
      return {
        totalChunks,
        totalBatches,
        currentBatch: batchNumber,
        batchStart,
        batchEnd: batchStart,
        chunksInBatch: 0
      };
    }

    // Get chunks for this batch
    const batchChunks = allChunks.slice(batchStart, batchEnd);
    console.log(`  [Batch ${batchNumber}] Processing chunks ${batchStart + 1}-${batchEnd} of ${totalChunks}`);

    // Generate embeddings for batch (validates chunks are processable)
    console.log(`  [Batch ${batchNumber}] Generating embeddings for ${batchChunks.length} chunks...`);
    await this.generateEmbeddings(batchChunks);

    // Store metadata for this batch (append to main metadata)
    const mainMetaPath = path.join(this.config.storePath, 'metadata.json');
    let existingMeta: Record<string, StoredMetadata> = {};

    if (fs.existsSync(mainMetaPath)) {
      existingMeta = JSON.parse(fs.readFileSync(mainMetaPath, 'utf-8'));
    }

    // Add batch chunks to metadata with global indices
    batchChunks.forEach((chunk, i) => {
      const globalIndex = batchStart + i;
      existingMeta[globalIndex.toString()] = {
        id: chunk.id,
        filePath: chunk.filePath,
        startLine: chunk.startLine,
        endLine: chunk.endLine,
        content: chunk.content,
        language: chunk.language
      };
    });

    // Save updated metadata
    fs.writeFileSync(mainMetaPath, JSON.stringify(existingMeta), 'utf-8');

    // Save batch state
    const batchState = {
      batchNumber,
      batchSize,
      batchStart,
      batchEnd,
      chunksProcessed: batchChunks.length,
      completedAt: new Date().toISOString()
    };
    fs.writeFileSync(batchStatePath, JSON.stringify(batchState, null, 2), 'utf-8');

    // Update in-memory metadata
    this.metadata = new Map(Object.entries(existingMeta).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
    this.documentCount = this.metadata.size;

    console.log(`  [Batch ${batchNumber}] ✓ Indexed ${batchChunks.length} chunks (total: ${this.documentCount})`);

    return {
      totalChunks,
      totalBatches,
      currentBatch: batchNumber,
      batchStart,
      batchEnd,
      chunksInBatch: batchChunks.length
    };
  }

  /**
   * Load metadata only (for batched mode - metadata was already saved during batches)
   * This avoids regenerating embeddings which is expensive and was causing the issue.
   */
  async loadMetadataOnly(): Promise<void> {
    const mainMetaPath = path.join(this.config.storePath, 'metadata.json');
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');

    if (!fs.existsSync(mainMetaPath)) {
      console.warn('No metadata found to load');
      return;
    }

    // Load metadata
    const metaData = JSON.parse(fs.readFileSync(mainMetaPath, 'utf-8'));
    this.metadata = new Map(Object.entries(metaData).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
    this.documentCount = this.metadata.size;

    // Try to load FAISS index if it exists
    if (fs.existsSync(cachedIndexPath) && faiss) {
      try {
        this.index = faiss.IndexFlatIP.read(cachedIndexPath);
        console.log(`  Loaded FAISS index with ${this.documentCount} chunks`);
      } catch (e) {
        console.log(`  FAISS index not available, using keyword search (${this.documentCount} chunks)`);
      }
    } else {
      console.log(`  Loaded ${this.documentCount} chunks (keyword search mode)`);
    }
  }

  /**
   * Build FAISS index from all accumulated metadata (call after all batches complete)
   */
  async finalizeIndex(): Promise<void> {
    const mainMetaPath = path.join(this.config.storePath, 'metadata.json');
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const indexStatePath = path.join(this.config.storePath, 'index-state.json');

    if (!fs.existsSync(mainMetaPath)) {
      console.warn('No metadata found to finalize');
      return;
    }

    const metaData = JSON.parse(fs.readFileSync(mainMetaPath, 'utf-8'));
    this.metadata = new Map(Object.entries(metaData).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
    this.documentCount = this.metadata.size;

    console.log(`  Finalizing index with ${this.documentCount} chunks...`);

    if (!faiss || this.documentCount === 0) {
      console.log('  Using keyword search mode (FAISS not available or no chunks)');
      return;
    }

    // Regenerate embeddings for FAISS index
    const chunks = Array.from(this.metadata.values());
    console.log(`  Generating embeddings for final index...`);
    const embeddings = await this.generateEmbeddings(chunks as CodeChunk[]);

    // Build FAISS index
    this.index = new faiss.IndexFlatIP(this.embeddingDimension);
    const normalizedEmbeddings: number[][] = [];

    for (let i = 0; i < embeddings.length; i++) {
      normalizedEmbeddings.push(this.normalizeVector(embeddings[i]));
    }

    try {
      const flatEmbeddings = normalizedEmbeddings.flat();
      this.index.add(flatEmbeddings);
      this.index.write(cachedIndexPath);

      const currentCommit = await this.getCurrentCommitHash();
      this.indexState = {
        commitHash: currentCommit,
        indexedAt: new Date().toISOString(),
        fileCount: new Set(chunks.map(c => (c as any).filePath)).size,
        chunkCount: this.documentCount
      };
      fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

      console.log(`  ✓ Finalized FAISS index with ${this.documentCount} chunks`);
    } catch (err) {
      console.warn(`  FAISS indexing failed, using keyword search: ${err}`);
    }
  }

  /**
   * Prioritize chunks for indexing when maxChunks limit is set.
   * Prioritizes:
   * 1. Core source directories (src/, lib/, app/)
   * 2. Entry points and config files
   * 3. Non-test files over test files
   * 4. Smaller chunks (more complete code units)
   */
  private prioritizeChunks(chunks: CodeChunk[], maxChunks: number): CodeChunk[] {
    // Score each chunk by priority
    const scored = chunks.map(chunk => {
      let score = 0;
      const fp = chunk.filePath.toLowerCase();

      // Prioritize core source directories
      if (fp.startsWith('src/') || fp.startsWith('lib/') || fp.startsWith('app/')) {
        score += 100;
      }

      // Entry points and important files
      if (fp.includes('index.') || fp.includes('main.') || fp.includes('app.')) {
        score += 50;
      }

      // Config files are important for understanding architecture
      if (fp.includes('config') || fp.endsWith('.json') || fp.endsWith('.yaml')) {
        score += 30;
      }

      // Deprioritize test files
      if (this.isTestFile(chunk.filePath)) {
        score -= 50;
      }

      // Deprioritize vendor/generated
      if (fp.includes('vendor/') || fp.includes('generated/') || fp.includes('.min.')) {
        score -= 100;
      }

      // Prefer smaller chunks (more likely to be complete logical units)
      const chunkSize = chunk.content.length;
      if (chunkSize < 1000) score += 20;
      else if (chunkSize > 3000) score -= 10;

      return { chunk, score };
    });

    // Sort by score descending and take top maxChunks
    scored.sort((a, b) => b.score - a.score);
    return scored.slice(0, maxChunks).map(s => s.chunk);
  }
}
