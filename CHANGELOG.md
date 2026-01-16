# Changelog

All notable changes to semanticwiki will be documented in this file.

## [1.2.0] - 2026-01-16

### Added

#### AI Chat in Static Sites (`--ai-chat`)
Interactive AI assistant embedded in generated sites:
- Client-side SmolLM2 model via transformers.js (works offline)
- Semantic search using page embeddings
- Intelligent fallback responses when model unavailable
- Codemap visualization mode for architecture questions

#### Hybrid Search System
Advanced retrieval combining multiple search strategies:
- **BM25 keyword search** for exact term matching
- **Vector similarity** with BGE-small-en-v1.5 embeddings (better than MiniLM)
- **Reciprocal Rank Fusion (RRF)** to combine results
- Optional cross-encoder reranking for precision

#### MCP Wiki Server (`semanticwiki mcp-server`)
Model Context Protocol server for AI assistant integration:
- `search_wiki` - Semantic search across documentation
- `get_wiki_page` - Retrieve full page content
- `list_wiki_pages` - Browse available pages
- `search_code` - RAG-powered code search
- `get_architecture_overview` - Quick architecture summary

#### Portable Package Format (`semanticwiki pack/unpack`)
Bundle wikis with RAG indexes for sharing:
- `.semantics` compressed format with manifest
- Includes wiki content + embeddings + BM25 index
- Extract wiki-only or full package

#### New CLI Commands
- `semanticwiki search <query>` - Search wiki from command line
- `semanticwiki mcp-server` - Start MCP server for AI assistants
- `semanticwiki pack` - Create portable wiki package
- `semanticwiki unpack` - Extract wiki package

#### Incremental Embedding Updates
- Tracks file changes via content hashing
- Only re-embeds modified files on subsequent runs
- Stores index state for efficient updates

### Changed
- Site title now derived from wiki index page (not folder name)
- Upgraded embedding model from MiniLM to BGE-small-en-v1.5
- Chat panel hides TOC for better space utilization
- Improved dark mode styling for chat interface

### Fixed
- Chat response formatting (no more malformed markdown links)
- Reduced repetition in chat "Related pages" section
- Title duplication in generated pages

## [1.1.2] - 2026-01-10

### Changed
- README rewrite highlighting two main capabilities upfront:
  - **Wiki Generation** (`semanticwiki generate`) - Point at any codebase, get architectural docs
  - **Agentic Codebase Assistant** - RAG-powered agent that explores, searches, and reasons about code
- New "Two Ways to Use SemanticWiki" section explaining both use cases

## [1.1.1] - 2026-01-10

### Changed
- Comprehensive README rewrite with complete usage documentation
- Added Quick Start guide for generating wiki + interactive site
- Added command reference tables for all options
- Added troubleshooting section for common issues
- Added technical details section explaining RAG chunking system

## [1.1.0] - 2026-01-10

### Added

#### Direct API Mode (`--direct-api`)
Bypass Claude Code subprocess and use Anthropic API directly with your `ANTHROPIC_API_KEY`. This resolves "Credit balance is too low" errors by avoiding Claude Code's billing pre-flight check.

- Implements full tool loop with 8 tools: `read_file`, `list_directory`, `directory_tree`, `search_codebase`, `write_wiki_page`, `analyze_code_structure`, `verify_wiki_completeness`, `list_wiki_pages`
- **Automatic completeness verification**: After initial generation, runs verification loop up to 5 times, automatically generating any missing pages until all internal links resolve
- Works with `--skip-index` for fast iteration

#### Skip Index Mode (`--skip-index`)
Reuse existing cached embeddings index for faster debugging and iteration.

- Loads metadata from `.semanticwiki-cache/metadata.json`
- Falls back to keyword search if FAISS index unavailable
- Now available on both `generate` and `continue` commands

#### Batched Generation (`--batch-size`)
Memory-efficient processing for very large codebases (10,000+ files).

- Default batch size: 3,000 chunks
- Creates fresh RAG system per batch to prevent memory buildup
- Automatic keyword search fallback when FAISS unavailable

#### Continue Command Enhancements
The `continue` command now supports:
- `--skip-index` - Use cached index
- `--direct-api` - Direct Anthropic API mode
- `--max-turns` - Limit agent iterations

### Technical Details: RAG Chunking System

#### Chunking Algorithm (`src/rag/index.ts:404-463`)
- **Chunk size**: 1,500 characters (configurable via `chunkSize`)
- **Overlap**: 200 characters for context continuity
- **Language-aware boundary detection**: Extends chunks to logical boundaries (empty lines, `}`, `};`, `end` keywords)
- **Quality filtering**: Discards chunks under 50 characters

#### Embedding Pipeline
- **Model**: `Xenova/all-MiniLM-L6-v2` (384 dimensions)
- **Library**: `@huggingface/transformers` for local inference
- **Batch processing**: 32 chunks per batch with progress reporting
- **Normalization**: L2 normalization for cosine similarity search

#### Vector Search (FAISS)
- **Index type**: `IndexFlatIP` (Inner Product)
- **Persistence**: Saves to `index.faiss`, loads on subsequent runs
- **Smart filtering**: Excludes test files, respects `--max-results`
- **Over-fetching**: Requests 2x results to account for post-filtering

#### Keyword Search Fallback
Activates automatically when FAISS unavailable:
- Term-based scoring with regex matching
- Ranked by occurrence frequency
- Zero external dependencies

#### Large Codebase Optimizations
- **`--max-chunks`**: Limit indexed chunks for memory control
- **Chunk prioritization scoring**:
  - Core directories (`src/`, `lib/`, `app/`): +100 points
  - Entry points (`index.*`, `main.*`): +50 points
  - Config files (`.json`, `.yaml`): +30 points
  - Test files: -50 points
  - Vendor/generated code: -100 points

## [1.0.0] - 2026-01-09

### Added
- Initial release
- AI-powered architectural documentation generation
- Source code traceability with `file:line` references
- GitHub repository support (public and private)
- Interactive static site generation (`--site`)
- Mermaid diagram generation for architecture visualization
- RAG-based semantic code search with FAISS
- Configurable `wiki.json` for custom documentation structure
- Dry-run mode (`--estimate`) for time/cost estimation
- MCP tool integration (filesystem, mermaid, custom semanticwiki tools)
