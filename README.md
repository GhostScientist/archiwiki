# Ted Mosby

> "Kids, I'm going to tell you an incredible story... the story of your codebase architecture."

An AI-powered CLI tool that generates comprehensive architectural documentation wikis for code repositories with source code traceability.

**Built with [buildanagentworkshop.com](https://buildanagentworkshop.com)**

---

## What is Ted Mosby?

Ted Mosby is an AI agent that reads your codebase and automatically generates professional architectural documentation. Unlike generic documentation tools, every concept in the generated wiki links directly to the source code (`file:line` references), making it easy to navigate from documentation to implementation.

### Generated Documentation Includes:

- **Architecture Overview** - High-level system design with Mermaid diagrams
- **Module Documentation** - Per-component breakdowns with source traceability
- **Data Flow Documentation** - How data moves through your system
- **Getting Started Guides** - Onboarding documentation for new developers
- **Glossary** - Key concepts and terminology

---

## Installation

```bash
npm install -g ted-mosby
```

## Prerequisites

- **Node.js** >= 18.0.0
- **Anthropic API key** - Get one at [console.anthropic.com](https://console.anthropic.com)

---

## Quick Start

### 1. Set your API key

```bash
export ANTHROPIC_API_KEY=your-api-key-here
```

### 2. Generate wiki + interactive site

```bash
# Generate wiki with interactive site in one command
ted-mosby generate -r ./my-project --site

# Or for a GitHub repository
ted-mosby generate -r https://github.com/user/repo --site
```

### 3. View the results

- **Markdown wiki**: Open `wiki/README.md`
- **Interactive site**: Open `wiki/site/index.html` in your browser

The static site includes search, navigation, keyboard shortcuts, and works offline.

---

## Usage

### Generate Command

```bash
# Basic: Generate wiki for current directory
ted-mosby generate -r .

# With interactive static site
ted-mosby generate -r ./my-project --site

# Custom site title and theme
ted-mosby generate -r ./my-project --site --site-title "My Project Docs" --theme dark

# Generate site only (if wiki already exists)
ted-mosby generate -r ./my-project --site-only

# Specify output directory
ted-mosby generate -r ./my-project -o ./docs/architecture

# Focus on a specific subdirectory
ted-mosby generate -r ./my-project -p src/core

# Verbose output (see what the agent is doing)
ted-mosby generate -r ./my-project -v

# Estimate time/cost before running (dry run)
ted-mosby generate -r ./my-project -e
```

### Continue Command

Resume generation to fix broken links or add missing pages:

```bash
# Check for and generate missing pages
ted-mosby continue -r ./my-project -o ./wiki

# Just verify (don't generate)
ted-mosby continue -r ./my-project -o ./wiki --verify-only

# Use cached index for faster iteration
ted-mosby continue -r ./my-project -o ./wiki --skip-index
```

### Large Codebase Options

For repositories with 10,000+ files:

```bash
# Limit indexed chunks (reduces memory usage)
ted-mosby generate -r ./large-project --max-chunks 5000

# Reduce search results per query
ted-mosby generate -r ./large-project --max-results 5

# Batched processing (for very large repos)
ted-mosby generate -r ./large-project --batch-size 3000
```

### Direct API Mode

Bypass Claude Code billing and use your API credits directly:

```bash
# Uses ANTHROPIC_API_KEY directly
ted-mosby generate -r ./my-project --direct-api

# Combine with skip-index for fast iteration
ted-mosby generate -r ./my-project --direct-api --skip-index
```

### Debug & Development

```bash
# Skip re-indexing (use cached embeddings)
ted-mosby generate -r ./my-project --skip-index

# Limit agent turns (reduces cost)
ted-mosby generate -r ./my-project --max-turns 50
```

---

## Command Reference

### `generate` - Create wiki documentation

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --repo <path/url>` | Repository path or GitHub URL (required) | - |
| `-o, --output <dir>` | Output directory for wiki | `./wiki` |
| `-c, --config <file>` | Path to wiki.json config file | - |
| `-t, --token <token>` | GitHub token for private repos | - |
| `-m, --model <model>` | Claude model to use | `claude-sonnet-4-20250514` |
| `-p, --path <path>` | Focus on specific directory | - |
| `-f, --force` | Force regeneration (ignore cache) | - |
| `-v, --verbose` | Show detailed progress | - |
| `-e, --estimate` | Estimate time/cost (dry run) | - |
| `-s, --site` | Generate interactive static site | - |
| `--site-only` | Generate site only (skip wiki) | - |
| `--site-title <title>` | Custom site title | Project name |
| `--theme <theme>` | Site theme: `light`, `dark`, `auto` | `auto` |
| `--max-chunks <n>` | Limit indexed chunks | unlimited |
| `--max-results <n>` | Max search results per query | `10` |
| `--batch-size <n>` | Enable batched processing | - |
| `--skip-index` | Use cached embeddings index | - |
| `--max-turns <n>` | Limit agent iterations | `200` |
| `--direct-api` | Use Anthropic API directly | - |

### `continue` - Resume/fix wiki generation

| Option | Description | Default |
|--------|-------------|---------|
| `-r, --repo <path>` | Repository path (required) | - |
| `-o, --output <dir>` | Wiki output directory | `./wiki` |
| `-m, --model <model>` | Claude model to use | `claude-sonnet-4-20250514` |
| `-v, --verbose` | Show detailed progress | - |
| `--verify-only` | Only check, don't generate | - |
| `--skip-index` | Use cached embeddings index | - |
| `--direct-api` | Use Anthropic API directly | - |
| `--max-turns <n>` | Limit agent iterations | `200` |

---

## Static Site Features

When you use `--site`, Ted Mosby generates a fully interactive documentation site:

- **Full-text search** - Instant search across all pages (Cmd/Ctrl+K)
- **Keyboard navigation** - Arrow keys, vim-style (j/k/h/l)
- **Dark/light mode** - Respects system preference or manual toggle
- **Table of contents** - Auto-generated from headings
- **Mobile responsive** - Works on all devices
- **Offline capable** - No server required
- **Mermaid diagrams** - Rendered automatically

---

## What to Expect

When you run Ted Mosby:

1. **Repository Analysis** - The agent scans your codebase structure
2. **Semantic Indexing** - Creates embeddings for intelligent code search
3. **Architecture Discovery** - Identifies patterns, components, and relationships
4. **Documentation Generation** - Writes markdown pages with diagrams
5. **Verification Loop** - Checks all links and generates missing pages
6. **Source Linking** - Every concept links to specific file:line references

### Typical Runtime

| Codebase Size | Approximate Time |
|---------------|------------------|
| Small (<50 files) | 1-2 minutes |
| Medium (50-200 files) | 2-5 minutes |
| Large (200+ files) | 5-10 minutes |

Use `--estimate` to get a cost/time estimate before running.

---

## Example Output

The generated wiki structure:

```
wiki/
├── README.md                    # Navigation entry point
├── architecture/
│   ├── overview.md              # System architecture + diagrams
│   └── data-flow.md             # Data flow documentation
├── components/
│   └── {module}/
│       └── index.md             # Per-module documentation
├── guides/
│   └── getting-started.md       # Quick start guide
├── glossary.md                  # Concept index
└── site/                        # (with --site flag)
    ├── index.html               # Interactive site entry
    ├── styles.css
    └── scripts.js
```

### Source Traceability Example

Every architectural concept includes clickable source references:

```markdown
## Authentication Flow

The authentication system uses JWT tokens for stateless auth.

**Source:** [`src/auth/jwt-provider.ts:23-67`](../../../src/auth/jwt-provider.ts#L23-L67)

```typescript
export class JwtProvider {
  async generateToken(user: User): Promise<string> {
    // Token generation logic...
  }
}
```
```

---

## Configuration (Optional)

Create a `wiki.json` file in your project root to customize generation:

```json
{
  "repo_notes": [
    { "content": "Focus on the src/core directory for main logic" }
  ],
  "pages": [
    { "title": "Architecture Overview", "purpose": "High-level design", "parent": null },
    { "title": "Authentication", "parent": "Architecture Overview" }
  ],
  "exclude_patterns": ["**/*.test.ts", "**/__mocks__/**"],
  "output": {
    "format": "markdown",
    "diagrams": true
  }
}
```

---

## Technical Details

### RAG Chunking System

Ted Mosby uses a sophisticated RAG (Retrieval Augmented Generation) system:

- **Chunk size**: 1,500 characters with 200 character overlap
- **Language-aware boundaries**: Chunks end at logical points (`}`, `};`, `end`)
- **Embedding model**: `all-MiniLM-L6-v2` (384 dimensions, runs locally)
- **Vector search**: FAISS with `IndexFlatIP` for cosine similarity
- **Fallback**: Keyword search when FAISS unavailable

### Chunk Prioritization

For large codebases, chunks are prioritized by importance:
- Core directories (`src/`, `lib/`, `app/`): +100 points
- Entry points (`index.*`, `main.*`): +50 points
- Config files: +30 points
- Test files: -50 points
- Vendor/generated code: -100 points

---

## How It Works

Ted Mosby is built with:

- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)** - Orchestrates the AI agent workflow
- **RAG (Retrieval Augmented Generation)** - Semantic code search using embeddings
- **[Model Context Protocol (MCP)](https://modelcontextprotocol.io)** - Tool integration for file operations
- **Mermaid** - Architecture diagram generation
- **FAISS** - High-performance vector similarity search

---

## Troubleshooting

### "Credit balance is too low" error

Use `--direct-api` to bypass Claude Code's billing check:
```bash
ted-mosby generate -r ./my-project --direct-api
```

### Out of memory on large repos

Limit the indexed chunks:
```bash
ted-mosby generate -r ./large-project --max-chunks 5000 --batch-size 3000
```

### Slow re-runs during development

Skip re-indexing with cached embeddings:
```bash
ted-mosby generate -r ./my-project --skip-index
```

### Missing pages / broken links

Use the continue command to fix:
```bash
ted-mosby continue -r ./my-project -o ./wiki
```

---

## Development

```bash
# Clone the repo
git clone https://github.com/your-username/ted-mosby.git
cd ted-mosby

# Install dependencies
npm install

# Build
npm run build

# Run locally
npm start -- generate -r ./my-project

# Watch mode for development
npm run dev
```

---

## Built With

This project was created using the [Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk) at the **Build an Agent Workshop**.

**Learn to build your own AI agents at [buildanagentworkshop.com](https://buildanagentworkshop.com)**

---

## License

MIT
