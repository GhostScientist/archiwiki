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

Or create a `.env` file in your project:
```bash
echo "ANTHROPIC_API_KEY=your-api-key-here" > .env
```

### 2. Generate documentation

```bash
# For a local project
ted-mosby generate -r ./my-project

# For a GitHub repository
ted-mosby generate -r https://github.com/user/repo
```

### 3. View the results

Open the generated `wiki/README.md` to explore your architectural documentation.

---

## Usage

### Basic Commands

```bash
# Generate wiki for current directory
ted-mosby generate -r .

# Generate wiki for a specific directory
ted-mosby generate -r /path/to/project

# Generate wiki from a GitHub URL
ted-mosby generate -r https://github.com/user/repo

# Specify output directory
ted-mosby generate -r ./my-project -o ./docs/architecture

# Focus on a specific subdirectory
ted-mosby generate -r ./my-project -p src/core

# Verbose output (see what the agent is doing)
ted-mosby generate -r ./my-project -v

# Estimate time/cost before running (dry run)
ted-mosby generate -r ./my-project -e
```

### All Options

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

---

## What to Expect

When you run Ted Mosby:

1. **Repository Analysis** - The agent scans your codebase structure
2. **Semantic Indexing** - Creates embeddings for intelligent code search
3. **Architecture Discovery** - Identifies patterns, components, and relationships
4. **Documentation Generation** - Writes markdown pages with diagrams
5. **Source Linking** - Every concept links to specific file:line references

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
└── glossary.md                  # Concept index
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

## How It Works

Ted Mosby is built with:

- **[Claude Agent SDK](https://github.com/anthropics/claude-agent-sdk)** - Orchestrates the AI agent workflow
- **RAG (Retrieval Augmented Generation)** - Semantic code search using embeddings
- **[Model Context Protocol (MCP)](https://modelcontextprotocol.io)** - Tool integration for file operations
- **Mermaid** - Architecture diagram generation

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
