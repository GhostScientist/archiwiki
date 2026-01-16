/**
 * RAG (Retrieval Augmented Generation) System for ArchitecturalWiki
 *
 * Enhanced with:
 * - Hybrid search: Vector similarity + BM25 keyword search
 * - Reciprocal Rank Fusion (RRF) for combining search results
 * - BGE-small-en-v1.5 embeddings for better retrieval quality
 * - Optional cross-encoder reranking for improved precision
 * - Chunks code at logical boundaries and indexes for semantic retrieval.
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
env.cacheDir = './.semanticwiki-models';

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
// Reranking model - will be initialized lazily
let rerankPipeline: any = null;

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
  /** Enable hybrid search combining vector + BM25 (default: true) */
  useHybridSearch?: boolean;
  /** Enable reranking for improved precision (default: false - slower but more accurate) */
  useReranking?: boolean;
  /** RRF constant k for rank fusion (default: 60) */
  rrfK?: number;
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
  /** Individual scores from hybrid search */
  vectorScore?: number;
  bm25Score?: number;
  rerankScore?: number;
}

export interface SearchOptions {
  maxResults?: number;
  fileTypes?: string[];
  excludeTests?: boolean;
  /** Search mode: 'hybrid' (default), 'vector', or 'keyword' */
  mode?: 'hybrid' | 'vector' | 'keyword';
  /** Enable reranking for this search (overrides config) */
  rerank?: boolean;
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
  /** Embedding model used */
  embeddingModel?: string;
  /** Whether hybrid search index is available */
  hasHybridIndex?: boolean;
}

/**
 * BM25 index for keyword search
 */
interface BM25Index {
  /** Document frequency for each term */
  df: Map<string, number>;
  /** Term frequency for each document */
  tf: Map<number, Map<string, number>>;
  /** Document lengths */
  docLengths: Map<number, number>;
  /** Average document length */
  avgDocLength: number;
  /** Total number of documents */
  docCount: number;
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
  '**/pnpm-lock.yaml',
  // Content/blog directories - not architectural source code
  '**/posts/**',
  '**/blog/**',
  '**/content/**',
  '**/articles/**',
  '**/_posts/**',
];

// Default embedding model - BGE-small-en-v1.5 is better for retrieval than MiniLM
const DEFAULT_EMBEDDING_MODEL = 'Xenova/bge-small-en-v1.5';
// Fallback if BGE fails
const FALLBACK_EMBEDDING_MODEL = 'Xenova/all-MiniLM-L6-v2';

export class RAGSystem {
  private config: RAGConfig;
  private index: any = null;  // FAISS index
  private metadata: Map<number, StoredMetadata> = new Map();
  private embeddingDimension = 384;  // BGE-small-en-v1.5 and MiniLM both use 384
  private documentCount = 0;
  private indexState: IndexState | null = null;
  private astChunker: ASTChunker;
  private bm25Index: BM25Index | null = null;
  private embeddingModelName: string;

  constructor(config: RAGConfig) {
    this.config = {
      chunkSize: 1500,
      chunkOverlap: 200,
      useASTChunking: true,  // Enable AST chunking by default
      extractDomainHints: true,  // Extract domain hints by default
      useHybridSearch: true,  // Enable hybrid search by default
      useReranking: false,  // Disable reranking by default (slower)
      rrfK: 60,  // Standard RRF constant
      ...config
    };

    this.embeddingModelName = this.config.embeddingModel || DEFAULT_EMBEDDING_MODEL;

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
   * Uses BGE-small-en-v1.5 by default for better retrieval quality
   */
  private async getEmbeddingPipeline(): Promise<any> {
    if (!embeddingPipeline) {
      console.log(`  Loading embedding model: ${this.embeddingModelName}...`);
      try {
        embeddingPipeline = await pipeline('feature-extraction', this.embeddingModelName);
        console.log(`  ✓ Loaded ${this.embeddingModelName}`);
      } catch (err) {
        console.warn(`  Failed to load ${this.embeddingModelName}, falling back to ${FALLBACK_EMBEDDING_MODEL}`);
        this.embeddingModelName = FALLBACK_EMBEDDING_MODEL;
        embeddingPipeline = await pipeline('feature-extraction', FALLBACK_EMBEDDING_MODEL);
      }
    }
    return embeddingPipeline;
  }

  /**
   * Initialize the reranking model (lazy loading)
   * Uses a cross-encoder for more accurate relevance scoring
   */
  private async getRerankPipeline(): Promise<any> {
    if (!rerankPipeline) {
      console.log('  Loading reranking model...');
      try {
        // Use a text-classification pipeline for reranking
        // This model scores query-document pairs for relevance
        rerankPipeline = await pipeline('text-classification', 'Xenova/ms-marco-MiniLM-L-6-v2');
        console.log('  ✓ Loaded reranking model');
      } catch (err) {
        console.warn('  Reranking model not available, skipping reranking');
        rerankPipeline = null;
      }
    }
    return rerankPipeline;
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
   * Tokenize text for BM25 indexing
   * Handles code-specific tokenization (camelCase, snake_case, etc.)
   */
  private tokenize(text: string): string[] {
    // Split camelCase and PascalCase BEFORE lowercasing (regex needs case info)
    const withSpaces = text
      .replace(/([a-z])([A-Z])/g, '$1 $2')      // camelCase -> camel Case
      .replace(/([A-Z]+)([A-Z][a-z])/g, '$1 $2'); // XMLParser -> XML Parser

    // Now convert to lowercase
    const lower = withSpaces.toLowerCase();

    // Split on whitespace and punctuation
    const tokens = lower
      // Split snake_case
      .replace(/_/g, ' ')
      // Split on common delimiters
      .split(/[\s\.\,\;\:\!\?\(\)\[\]\{\}\<\>\=\+\-\*\/\&\|\^\~\`\"\'\#\@\$\%\\]+/)
      // Filter out empty strings and very short tokens
      .filter(t => t.length >= 2);

    return tokens;
  }

  /**
   * Build BM25 index from metadata
   */
  private buildBM25Index(): void {
    const df = new Map<string, number>();
    const tf = new Map<number, Map<string, number>>();
    const docLengths = new Map<number, number>();
    let totalLength = 0;

    for (const [docId, meta] of this.metadata) {
      // Combine content, name, documentation for indexing
      const text = [
        meta.content,
        meta.name || '',
        meta.documentation || '',
        meta.domainContext || '',
        meta.filePath
      ].join(' ');

      const tokens = this.tokenize(text);
      const termFreq = new Map<string, number>();

      for (const token of tokens) {
        termFreq.set(token, (termFreq.get(token) || 0) + 1);
      }

      // Update document frequency
      for (const term of termFreq.keys()) {
        df.set(term, (df.get(term) || 0) + 1);
      }

      tf.set(docId, termFreq);
      docLengths.set(docId, tokens.length);
      totalLength += tokens.length;
    }

    this.bm25Index = {
      df,
      tf,
      docLengths,
      avgDocLength: this.metadata.size > 0 ? totalLength / this.metadata.size : 0,
      docCount: this.metadata.size
    };
  }

  /**
   * Calculate BM25 score for a document given a query
   * Uses standard BM25 parameters: k1=1.2, b=0.75
   */
  private calculateBM25Score(docId: number, queryTokens: string[]): number {
    if (!this.bm25Index) return 0;

    const k1 = 1.2;
    const b = 0.75;
    const { df, tf, docLengths, avgDocLength, docCount } = this.bm25Index;

    const docTf = tf.get(docId);
    if (!docTf) return 0;

    const docLength = docLengths.get(docId) || 0;
    let score = 0;

    for (const term of queryTokens) {
      const termDf = df.get(term) || 0;
      const termTf = docTf.get(term) || 0;

      if (termTf === 0) continue;

      // IDF component
      const idf = Math.log((docCount - termDf + 0.5) / (termDf + 0.5) + 1);

      // TF component with length normalization
      const tfNorm = (termTf * (k1 + 1)) /
        (termTf + k1 * (1 - b + b * (docLength / avgDocLength)));

      score += idf * tfNorm;
    }

    return score;
  }

  /**
   * Reciprocal Rank Fusion (RRF) to combine multiple ranked lists
   * RRF score = sum(1 / (k + rank_i)) for each list i
   */
  private reciprocalRankFusion(
    rankedLists: Array<{ docId: number; score: number }[]>,
    k: number = 60
  ): Map<number, number> {
    const fusedScores = new Map<number, number>();

    for (const list of rankedLists) {
      for (let rank = 0; rank < list.length; rank++) {
        const { docId } = list[rank];
        const rrfScore = 1 / (k + rank + 1);  // rank is 0-indexed
        fusedScores.set(docId, (fusedScores.get(docId) || 0) + rrfScore);
      }
    }

    return fusedScores;
  }

  /**
   * Rerank results using a cross-encoder model
   */
  private async rerankResults(
    query: string,
    results: SearchResult[],
    maxResults: number
  ): Promise<SearchResult[]> {
    const reranker = await this.getRerankPipeline();
    if (!reranker || results.length === 0) return results;

    try {
      // Score each result with the cross-encoder
      const scored: Array<{ result: SearchResult; rerankScore: number }> = [];

      for (const result of results) {
        // Create query-document pair
        const docText = [
          result.name || '',
          result.documentation?.slice(0, 200) || '',
          result.content.slice(0, 500)
        ].join(' ');

        try {
          const output = await reranker(`${query} [SEP] ${docText}`);
          // Extract score from classification output
          const rerankScore = Array.isArray(output) && output[0]?.score
            ? output[0].score
            : 0;
          scored.push({ result, rerankScore });
        } catch {
          scored.push({ result, rerankScore: 0 });
        }
      }

      // Sort by rerank score
      scored.sort((a, b) => b.rerankScore - a.rerankScore);

      // Return top results with rerank scores
      return scored.slice(0, maxResults).map(s => ({
        ...s.result,
        rerankScore: s.rerankScore
      }));
    } catch (err) {
      console.warn('Reranking failed, returning original results:', err);
      return results;
    }
  }

  /**
   * Index the repository for semantic search
   */
  async indexRepository(): Promise<void> {
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const cachedMetaPath = path.join(this.config.storePath, 'metadata.json');
    const indexStatePath = path.join(this.config.storePath, 'index-state.json');
    const bm25IndexPath = path.join(this.config.storePath, 'bm25-index.json');

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

        // Build or load BM25 index for hybrid search
        if (this.config.useHybridSearch) {
          if (fs.existsSync(bm25IndexPath)) {
            try {
              const bm25Data = JSON.parse(fs.readFileSync(bm25IndexPath, 'utf-8'));
              this.bm25Index = {
                df: new Map(Object.entries(bm25Data.df)),
                tf: new Map(Object.entries(bm25Data.tf).map(([k, v]: [string, any]) =>
                  [parseInt(k), new Map(Object.entries(v))]
                )),
                docLengths: new Map(Object.entries(bm25Data.docLengths).map(([k, v]: [string, any]) =>
                  [parseInt(k), v]
                )),
                avgDocLength: bm25Data.avgDocLength,
                docCount: bm25Data.docCount
              };
              console.log('  ✓ Loaded BM25 index for hybrid search');
            } catch {
              console.log('  Building BM25 index...');
              this.buildBM25Index();
            }
          } else {
            console.log('  Building BM25 index...');
            this.buildBM25Index();
          }
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

        // Build and save BM25 index for hybrid search
        if (this.config.useHybridSearch) {
          console.log('  Building BM25 index for hybrid search...');
          this.buildBM25Index();

          // Save BM25 index
          if (this.bm25Index) {
            const bm25Data = {
              df: Object.fromEntries(this.bm25Index.df),
              tf: Object.fromEntries(
                Array.from(this.bm25Index.tf.entries()).map(([k, v]) =>
                  [k.toString(), Object.fromEntries(v)]
                )
              ),
              docLengths: Object.fromEntries(
                Array.from(this.bm25Index.docLengths.entries()).map(([k, v]) =>
                  [k.toString(), v]
                )
              ),
              avgDocLength: this.bm25Index.avgDocLength,
              docCount: this.bm25Index.docCount
            };
            fs.writeFileSync(bm25IndexPath, JSON.stringify(bm25Data), 'utf-8');
            console.log('  ✓ BM25 index built and saved');
          }
        }

        // Save index state with commit hash
        this.indexState = {
          commitHash: currentCommit,
          indexedAt: new Date().toISOString(),
          fileCount: files.length,
          chunkCount: chunksToIndex.length,
          embeddingModel: this.embeddingModelName,
          hasHybridIndex: this.config.useHybridSearch
        };
        fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

        this.documentCount = chunksToIndex.length;
        console.log(`  ✓ Indexed ${this.documentCount} chunks with FAISS + BM25 (commit ${currentCommit.slice(0, 7)})`);
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

    // Build BM25 index even in fallback mode
    console.log('  Building BM25 index...');
    this.buildBM25Index();

    // Save index state with commit hash (even in fallback mode)
    this.indexState = {
      commitHash: currentCommit,
      indexedAt: new Date().toISOString(),
      fileCount: files.length,
      chunkCount: chunksToIndex.length,
      embeddingModel: this.embeddingModelName,
      hasHybridIndex: true
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
   * Uses BGE-small-en-v1.5 by default for better retrieval quality
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
   * Search the codebase for relevant code using hybrid search
   * Combines vector similarity (semantic) with BM25 (keyword) using RRF
   */
  async search(query: string, options: SearchOptions = {}): Promise<SearchResult[]> {
    const maxResults = options.maxResults || 10;
    const mode = options.mode || (this.config.useHybridSearch ? 'hybrid' : 'vector');
    const shouldRerank = options.rerank ?? this.config.useReranking;

    if (this.metadata.size === 0) {
      return [];
    }

    let results: SearchResult[] = [];

    if (mode === 'keyword') {
      // Pure keyword search using BM25
      results = await this.searchBM25(query, options, maxResults * 2);
    } else if (mode === 'vector' || !this.bm25Index) {
      // Pure vector search
      results = await this.searchVector(query, options, maxResults * 2);
    } else {
      // Hybrid search: combine vector and BM25 using RRF
      const vectorResults = await this.searchVector(query, options, maxResults * 3);
      const bm25Results = await this.searchBM25(query, options, maxResults * 3);

      // Apply RRF to combine results
      const k = this.config.rrfK || 60;
      const fusedScores = this.reciprocalRankFusion(
        [
          vectorResults.map(r => ({ docId: this.getDocIdFromResult(r), score: r.score })),
          bm25Results.map(r => ({ docId: this.getDocIdFromResult(r), score: r.score }))
        ],
        k
      );

      // Create map of vector and BM25 scores for each doc
      const vectorScoreMap = new Map(
        vectorResults.map(r => [this.getDocIdFromResult(r), r.score])
      );
      const bm25ScoreMap = new Map(
        bm25Results.map(r => [this.getDocIdFromResult(r), r.score])
      );

      // Build final results
      const allDocIds = new Set([
        ...vectorResults.map(r => this.getDocIdFromResult(r)),
        ...bm25Results.map(r => this.getDocIdFromResult(r))
      ]);

      for (const docId of allDocIds) {
        const meta = this.metadata.get(docId);
        if (!meta) continue;

        // Apply filters
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        const fusedScore = fusedScores.get(docId) || 0;
        results.push({
          ...meta,
          score: fusedScore,
          vectorScore: vectorScoreMap.get(docId),
          bm25Score: bm25ScoreMap.get(docId)
        });
      }

      // Sort by fused score
      results.sort((a, b) => b.score - a.score);
      results = results.slice(0, maxResults * 2);
    }

    // Apply reranking if enabled
    if (shouldRerank && results.length > 0) {
      results = await this.rerankResults(query, results, maxResults);
    } else {
      results = results.slice(0, maxResults);
    }

    return results;
  }

  /**
   * Get document ID from a search result
   */
  private getDocIdFromResult(result: SearchResult): number {
    // Find the document ID by matching the id field
    for (const [docId, meta] of this.metadata) {
      if (meta.id === result.id) {
        return docId;
      }
    }
    return -1;
  }

  /**
   * Vector-only search using FAISS
   */
  private async searchVector(
    query: string,
    options: SearchOptions,
    maxResults: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Generate query embedding using local model
    const queryEmbedding = await this.generateSingleEmbedding(query);

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
          score: distances[i],
          vectorScore: distances[i]
        });

        if (results.length >= maxResults) break;
      }
    } else {
      // Fallback: cosine similarity computation
      for (const [docId, meta] of this.metadata) {
        if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
        if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

        // Simple fallback - use keyword matching as approximation
        const queryTerms = query.toLowerCase().split(/\s+/);
        const content = meta.content.toLowerCase();
        let score = 0;
        for (const term of queryTerms) {
          const matches = (content.match(new RegExp(term, 'g')) || []).length;
          score += matches;
        }

        if (score > 0) {
          results.push({ ...meta, score, vectorScore: score });
        }
      }

      results.sort((a, b) => b.score - a.score);
    }

    return results.slice(0, maxResults);
  }

  /**
   * BM25-only keyword search
   */
  private async searchBM25(
    query: string,
    options: SearchOptions,
    maxResults: number
  ): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Ensure BM25 index exists
    if (!this.bm25Index) {
      this.buildBM25Index();
    }

    const queryTokens = this.tokenize(query);

    for (const [docId, meta] of this.metadata) {
      // Apply filters
      if (options.excludeTests && this.isTestFile(meta.filePath)) continue;
      if (options.fileTypes && !options.fileTypes.some(ext => meta.filePath.endsWith(ext))) continue;

      const score = this.calculateBM25Score(docId, queryTokens);
      if (score > 0) {
        results.push({
          ...meta,
          score,
          bm25Score: score
        });
      }
    }

    // Sort by BM25 score descending
    results.sort((a, b) => b.score - a.score);

    return results.slice(0, maxResults);
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
   * Get search configuration info
   */
  getSearchConfig(): { hybridEnabled: boolean; rerankEnabled: boolean; embeddingModel: string } {
    return {
      hybridEnabled: this.config.useHybridSearch || false,
      rerankEnabled: this.config.useReranking || false,
      embeddingModel: this.embeddingModelName
    };
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
    const bm25IndexPath = path.join(this.config.storePath, 'bm25-index.json');

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
        console.log(`  FAISS index not available, using hybrid/keyword search (${this.documentCount} chunks)`);
      }
    } else {
      console.log(`  Loaded ${this.documentCount} chunks (keyword search mode)`);
    }

    // Load or build BM25 index
    if (this.config.useHybridSearch) {
      if (fs.existsSync(bm25IndexPath)) {
        try {
          const bm25Data = JSON.parse(fs.readFileSync(bm25IndexPath, 'utf-8'));
          this.bm25Index = {
            df: new Map(Object.entries(bm25Data.df)),
            tf: new Map(Object.entries(bm25Data.tf).map(([k, v]: [string, any]) =>
              [parseInt(k), new Map(Object.entries(v))]
            )),
            docLengths: new Map(Object.entries(bm25Data.docLengths).map(([k, v]: [string, any]) =>
              [parseInt(k), v]
            )),
            avgDocLength: bm25Data.avgDocLength,
            docCount: bm25Data.docCount
          };
          console.log('  ✓ Loaded BM25 index');
        } catch {
          this.buildBM25Index();
        }
      } else {
        this.buildBM25Index();
      }
    }
  }

  /**
   * Build FAISS index from all accumulated metadata (call after all batches complete)
   */
  async finalizeIndex(): Promise<void> {
    const mainMetaPath = path.join(this.config.storePath, 'metadata.json');
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const indexStatePath = path.join(this.config.storePath, 'index-state.json');
    const bm25IndexPath = path.join(this.config.storePath, 'bm25-index.json');

    if (!fs.existsSync(mainMetaPath)) {
      console.warn('No metadata found to finalize');
      return;
    }

    const metaData = JSON.parse(fs.readFileSync(mainMetaPath, 'utf-8'));
    this.metadata = new Map(Object.entries(metaData).map(([k, v]) => [parseInt(k), v as StoredMetadata]));
    this.documentCount = this.metadata.size;

    console.log(`  Finalizing index with ${this.documentCount} chunks...`);

    // Build BM25 index
    console.log('  Building BM25 index...');
    this.buildBM25Index();
    if (this.bm25Index) {
      const bm25Data = {
        df: Object.fromEntries(this.bm25Index.df),
        tf: Object.fromEntries(
          Array.from(this.bm25Index.tf.entries()).map(([k, v]) =>
            [k.toString(), Object.fromEntries(v)]
          )
        ),
        docLengths: Object.fromEntries(
          Array.from(this.bm25Index.docLengths.entries()).map(([k, v]) =>
            [k.toString(), v]
          )
        ),
        avgDocLength: this.bm25Index.avgDocLength,
        docCount: this.bm25Index.docCount
      };
      fs.writeFileSync(bm25IndexPath, JSON.stringify(bm25Data), 'utf-8');
    }

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
        chunkCount: this.documentCount,
        embeddingModel: this.embeddingModelName,
        hasHybridIndex: true
      };
      fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

      console.log(`  ✓ Finalized FAISS + BM25 index with ${this.documentCount} chunks`);
    } catch (err) {
      console.warn(`  FAISS indexing failed, using keyword search: ${err}`);
    }
  }

  /**
   * Update the index incrementally based on changed files.
   * This is more efficient than full re-indexing when only a few files change.
   *
   * @param changedFiles - List of file paths that have changed (relative to repo root)
   * @returns Object with update statistics
   */
  async updateIndex(changedFiles: string[]): Promise<{
    filesUpdated: number;
    chunksRemoved: number;
    chunksAdded: number;
    newCommitHash: string;
  }> {
    const cachedIndexPath = path.join(this.config.storePath, 'index.faiss');
    const cachedMetaPath = path.join(this.config.storePath, 'metadata.json');
    const indexStatePath = path.join(this.config.storePath, 'index-state.json');
    const bm25IndexPath = path.join(this.config.storePath, 'bm25-index.json');

    // Load existing metadata
    if (!fs.existsSync(cachedMetaPath)) {
      throw new Error('No existing index found. Run full indexing first.');
    }

    const existingMeta = JSON.parse(fs.readFileSync(cachedMetaPath, 'utf-8'));
    this.metadata = new Map(Object.entries(existingMeta).map(([k, v]) => [parseInt(k), v as StoredMetadata]));

    // Normalize changed file paths (remove leading ./ if present)
    const normalizedChangedFiles = new Set(
      changedFiles.map(f => f.replace(/^\.\//, ''))
    );

    console.log(`  Updating index for ${normalizedChangedFiles.size} changed files...`);

    // Find chunks to remove (from changed files)
    const chunksToRemove = new Set<number>();
    const unchangedChunks: Array<{ index: number; meta: StoredMetadata }> = [];

    for (const [index, meta] of this.metadata) {
      const normalizedPath = meta.filePath.replace(/^\.\//, '');
      if (normalizedChangedFiles.has(normalizedPath)) {
        chunksToRemove.add(index);
      } else {
        unchangedChunks.push({ index, meta });
      }
    }

    console.log(`  Found ${chunksToRemove.size} chunks to update from changed files`);

    // Re-chunk the changed files
    const newChunks: CodeChunk[] = [];
    let filesProcessed = 0;

    for (const filePath of normalizedChangedFiles) {
      const fullPath = path.join(this.config.repoPath, filePath);

      // Skip files that no longer exist (deleted files)
      if (!fs.existsSync(fullPath)) {
        console.log(`    Skipping deleted file: ${filePath}`);
        continue;
      }

      try {
        const fileChunks = await this.chunkFile(filePath);
        newChunks.push(...fileChunks);
        filesProcessed++;
        console.log(`    Chunked ${filePath}: ${fileChunks.length} chunks`);
      } catch (err) {
        console.warn(`    Failed to chunk ${filePath}: ${err}`);
      }
    }

    console.log(`  Generated ${newChunks.length} new chunks from ${filesProcessed} files`);

    // Combine unchanged chunks with new chunks
    const allChunks: CodeChunk[] = [
      // Convert unchanged metadata back to CodeChunk format
      ...unchangedChunks.map(({ meta }) => ({
        id: meta.id,
        filePath: meta.filePath,
        startLine: meta.startLine,
        endLine: meta.endLine,
        content: meta.content,
        language: meta.language,
        chunkType: meta.chunkType,
        name: meta.name,
        parentName: meta.parentName,
        documentation: meta.documentation,
        domainCategories: meta.domainCategories,
        domainContext: meta.domainContext,
        isPublicApi: meta.isPublicApi,
        signature: meta.signature
      } as CodeChunk)),
      // Add new chunks from changed files
      ...newChunks
    ];

    if (allChunks.length === 0) {
      console.warn('No chunks to index after update');
      return {
        filesUpdated: filesProcessed,
        chunksRemoved: chunksToRemove.size,
        chunksAdded: 0,
        newCommitHash: await this.getCurrentCommitHash()
      };
    }

    // Generate embeddings for ALL chunks (we need to rebuild the FAISS index)
    // This is because FAISS doesn't support in-place updates
    console.log(`  Regenerating embeddings for ${allChunks.length} total chunks...`);
    const embeddings = await this.generateEmbeddings(allChunks);

    // Rebuild FAISS index
    console.log(`  Rebuilding search index...`);
    if (faiss && embeddings.length > 0) {
      const actualDimension = embeddings[0].length;
      if (actualDimension !== this.embeddingDimension) {
        this.embeddingDimension = actualDimension;
      }

      this.index = new faiss.IndexFlatIP(this.embeddingDimension);

      // Build new metadata map
      this.metadata = new Map();
      const normalizedEmbeddings: number[][] = [];

      for (let i = 0; i < embeddings.length; i++) {
        const normalized = this.normalizeVector(embeddings[i]);
        normalizedEmbeddings.push(normalized);

        const chunk = allChunks[i];
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

      try {
        const flatEmbeddings = normalizedEmbeddings.flat();
        this.index.add(flatEmbeddings);

        // Save updated index and metadata
        this.index.write(cachedIndexPath);
        fs.writeFileSync(
          cachedMetaPath,
          JSON.stringify(Object.fromEntries(this.metadata)),
          'utf-8'
        );

        // Rebuild BM25 index
        console.log('  Rebuilding BM25 index...');
        this.buildBM25Index();
        if (this.bm25Index) {
          const bm25Data = {
            df: Object.fromEntries(this.bm25Index.df),
            tf: Object.fromEntries(
              Array.from(this.bm25Index.tf.entries()).map(([k, v]) =>
                [k.toString(), Object.fromEntries(v)]
              )
            ),
            docLengths: Object.fromEntries(
              Array.from(this.bm25Index.docLengths.entries()).map(([k, v]) =>
                [k.toString(), v]
              )
            ),
            avgDocLength: this.bm25Index.avgDocLength,
            docCount: this.bm25Index.docCount
          };
          fs.writeFileSync(bm25IndexPath, JSON.stringify(bm25Data), 'utf-8');
        }

        // Update index state
        const currentCommit = await this.getCurrentCommitHash();
        const uniqueFiles = new Set(allChunks.map(c => c.filePath));

        this.indexState = {
          commitHash: currentCommit,
          indexedAt: new Date().toISOString(),
          fileCount: uniqueFiles.size,
          chunkCount: allChunks.length,
          embeddingModel: this.embeddingModelName,
          hasHybridIndex: true
        };
        fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

        this.documentCount = allChunks.length;
        console.log(`  ✓ Updated index: ${this.documentCount} chunks (commit ${currentCommit.slice(0, 7)})`);

        return {
          filesUpdated: filesProcessed,
          chunksRemoved: chunksToRemove.size,
          chunksAdded: newChunks.length,
          newCommitHash: currentCommit
        };
      } catch (faissError) {
        console.warn(`  FAISS update failed: ${faissError}`);
        throw new Error(`Failed to update FAISS index: ${faissError}`);
      }
    }

    // Fallback: keyword search mode
    this.metadata = new Map();
    allChunks.forEach((chunk, i) => {
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

    fs.writeFileSync(
      cachedMetaPath,
      JSON.stringify(Object.fromEntries(this.metadata)),
      'utf-8'
    );

    // Build BM25 index
    this.buildBM25Index();

    const currentCommit = await this.getCurrentCommitHash();
    const uniqueFiles = new Set(allChunks.map(c => c.filePath));

    this.indexState = {
      commitHash: currentCommit,
      indexedAt: new Date().toISOString(),
      fileCount: uniqueFiles.size,
      chunkCount: allChunks.length,
      embeddingModel: this.embeddingModelName,
      hasHybridIndex: true
    };
    fs.writeFileSync(indexStatePath, JSON.stringify(this.indexState, null, 2), 'utf-8');

    this.documentCount = allChunks.length;
    console.log(`  ✓ Updated index: ${this.documentCount} chunks (keyword mode, commit ${currentCommit.slice(0, 7)})`);

    return {
      filesUpdated: filesProcessed,
      chunksRemoved: chunksToRemove.size,
      chunksAdded: newChunks.length,
      newCommitHash: currentCommit
    };
  }

  /**
   * Get list of files in the current index
   */
  getIndexedFiles(): string[] {
    const files = new Set<string>();
    for (const [, meta] of this.metadata) {
      files.add(meta.filePath);
    }
    return Array.from(files);
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
