import { query, tool, createSdkMcpServer, type Query } from '@anthropic-ai/claude-agent-sdk';
import { z } from 'zod';
import { FileOperations } from './tools/file-operations.js';
import { CommandRunner } from './tools/command-runner.js';
import { PermissionManager, type PermissionPolicy } from './permissions.js';
import { MCPConfigManager } from './mcp-config.js';
import { loadClaudeConfig, formatSkillsForPrompt, type ClaudeConfig } from './claude-config.js';

export interface DevelopmentAgentAgentConfig {
  verbose?: boolean;
  apiKey?: string;
  permissionManager?: PermissionManager;
  permissions?: PermissionPolicy;
  auditPath?: string;
  workingDir?: string;
}

export class DevelopmentAgentAgent {
  private config: DevelopmentAgentAgentConfig;
  private permissionManager: PermissionManager;
  private fileOps: FileOperations;
  private commandRunner: CommandRunner;
  private customServer: ReturnType<typeof createSdkMcpServer>;
  private mcpConfigManager: MCPConfigManager;
  private claudeConfig: ClaudeConfig;
  private sessionId?: string;

  constructor(config: DevelopmentAgentAgentConfig = {}) {
    this.config = config;

    if (config.apiKey) {
      process.env.ANTHROPIC_API_KEY = config.apiKey;
    }

    if (!process.env.ANTHROPIC_API_KEY) {
      throw new Error('Anthropic API key is required. Set it via config.apiKey or ANTHROPIC_API_KEY environment variable.');
    }

    this.permissionManager = config.permissionManager || new PermissionManager({ policy: config.permissions, auditPath: config.auditPath });
    this.fileOps = new FileOperations(this.permissionManager);
    this.commandRunner = new CommandRunner(this.permissionManager);

    // Create SDK MCP server with custom tools
    this.customServer = this.createToolServer();

    // Initialize MCP config manager
    this.mcpConfigManager = new MCPConfigManager();

    // Load Claude Code configuration (CLAUDE.md, skills, commands)
    this.claudeConfig = loadClaudeConfig(config.workingDir || process.cwd());
  }

  /**
   * Get loaded Claude Code configuration
   */
  getClaudeConfig(): ClaudeConfig {
    return this.claudeConfig;
  }

  private async loadExternalMcpServers(): Promise<Record<string, any>> {
    await this.mcpConfigManager.load();
    const servers: Record<string, any> = {};

    for (const [name, config] of Object.entries(this.mcpConfigManager.getEnabledServers())) {
      const resolved = this.mcpConfigManager.resolveEnvVariables(config);

      switch (resolved.type) {
        case 'stdio':
          servers[name] = {
            command: resolved.command,
            args: resolved.args || [],
            env: resolved.env || {}
          };
          break;
        case 'sse':
          servers[name] = {
            type: 'sse',
            url: resolved.url,
            headers: resolved.headers || {}
          };
          break;
        case 'http':
          servers[name] = {
            type: 'http',
            url: resolved.url,
            headers: resolved.headers || {}
          };
          break;
        case 'sdk':
          try {
            // For SDK servers, pass the module directly
            const mod = await import(resolved.serverModule);
            servers[name] = mod.default || mod;
          } catch (err) {
            console.warn(`Warning: Could not load SDK MCP server '${name}': ${err}`);
          }
          break;
      }
    }

    return servers;
  }

  async *query(userQuery: string, history: Array<{role: string, content: string}> = []) {
    const systemPrompt = this.buildSystemPrompt();

    // Load external MCP servers from .mcp.json
    const externalMcpServers = await this.loadExternalMcpServers();

    const options: any = {
      model: 'claude-sonnet-4-20250514',
      cwd: process.cwd(),
      systemPrompt,
      mcpServers: {
        // Pass SDK server directly
        'custom-tools': this.customServer,
        ...externalMcpServers
      },
      // Enable built-in web search and fetch tools from Claude Agent SDK
      allowedTools: ['WebSearch', 'WebFetch'],
      permissionMode: 'default',
      includePartialMessages: true,
      canUseTool: async (toolName: string, input: any) => {
        // Permission check happens in tool execution
        return { behavior: 'allow', updatedInput: input };
      }
    };

    // Resume previous session if we have one
    if (this.sessionId) {
      options.resume = this.sessionId;
    }

    // If history provided and no active session, prepend conversation context to prompt
    let effectivePrompt = userQuery;
    if (history.length > 0 && !this.sessionId) {
      const contextLines = history.map(h =>
        `${h.role === 'user' ? 'User' : 'Assistant'}: ${h.content}`
      ).join('\n\n');
      effectivePrompt = `Previous conversation:\n${contextLines}\n\nUser: ${userQuery}`;
    }

    const queryResult = query({
      prompt: effectivePrompt,
      options
    });

    // Stream messages and capture session ID
    for await (const message of queryResult) {
      // Capture session ID from system init message for future queries
      if (message.type === 'system' && (message as any).subtype === 'init') {
        this.sessionId = (message as any).session_id;
      }

      yield message;
    }
  }

  private createToolServer() {
    const tools: any[] = [];

    // File operation tools
    tools.push(
      tool(
        'read_file',
        'Read the contents of a file',
        {
          filePath: z.string().describe('Path to the file to read')
        },
        async (args) => {
          const content = await this.fileOps.readFile(args.filePath);
          return {
            content: [{
              type: 'text',
              text: content
            }]
          };
        }
      )
    );

    tools.push(
      tool(
        'write_file',
        'Write content to a file (creates or overwrites)',
        {
          filePath: z.string().describe('Path to the file to write'),
          content: z.string().describe('Content to write to the file')
        },
        async (args) => {
          await this.fileOps.writeFile(args.filePath, args.content);
          return {
            content: [{
              type: 'text',
              text: `Successfully wrote to ${args.filePath}`
            }]
          };
        }
      )
    );

    tools.push(
      tool(
        'find_files',
        'Find files matching a glob pattern',
        {
          pattern: z.string().describe('Glob pattern to match files (e.g., "**/*.ts")')
        },
        async (args) => {
          const files = await this.fileOps.findFiles(args.pattern);
          return {
            content: [{
              type: 'text',
              text: files.join('\n')
            }]
          };
        }
      )
    );

    // Command execution tools
    tools.push(
      tool(
        'run_command',
        'Execute a shell command',
        {
          command: z.string().describe('Command to execute')
        },
        async (args) => {
          const result = await this.commandRunner.execute(args.command);
          return {
            content: [{
              type: 'text',
              text: this.commandRunner.formatResult(result)
            }]
          };
        }
      )
    );

    return createSdkMcpServer({
      name: 'custom-tools',
      version: '1.0.0',
      tools
    });
  }

  private buildSystemPrompt(): string {
    // Build memory section from CLAUDE.md if available
    const memorySection = this.claudeConfig.memory
      ? `## Project Context (from CLAUDE.md):
${this.claudeConfig.memory}

`
      : '';

    // Build skills section if any skills are loaded
    const skillsSection = this.claudeConfig.skills.length > 0
      ? `## Available Skills:
${formatSkillsForPrompt(this.claudeConfig.skills)}

When the user asks you to use a skill (e.g., "run the api-design skill" or "use code-review"), apply the skill's instructions to the current context. Skills provide specialized expertise and workflows.

`
      : '';

    // Build subagents section if any are loaded
    const subagentsSection = this.claudeConfig.subagents.length > 0
      ? '## Available Subagents:\n' + this.claudeConfig.subagents.map(a => '- **' + a.name + '**: ' + a.description).join('\n') + '\n\nYou can delegate specialized tasks to these subagents when appropriate.\n\n'
      : '';

    // Build commands info if any are loaded
    const commandsSection = this.claudeConfig.commands.length > 0
      ? '## Slash Commands:\nThe user can invoke these commands with /command-name:\n' + this.claudeConfig.commands.map(c => '- **/' + c.name + '**: ' + (c.description || 'No description')).join('\n') + '\n\n'
      : '';

    return `You are Development Agent, a specialized AI assistant for development.

${memorySection}A comprehensive development assistant that can read, write, and modify code files, execute build commands, manage git repositories, and help with debugging and optimization.

## Your Capabilities:
- **Read File**: Read contents of any file in the project
- **Find Files**: Search for files using glob patterns
- **Search in Files**: Search for text content across files
- **Write File**: Create new files with specified content
- **Edit File**: Modify existing files with find-and-replace
- **Git Operations**: Git commands for version control
- **Run Command**: Execute shell commands and scripts
- **Web Search**: Search the web for information
- **Web Fetch**: Fetch and analyze web page content
- **Database Query**: Query SQL databases
- **API Client**: Make HTTP requests to external APIs

${skillsSection}${subagentsSection}${commandsSection}## Instructions:
- Provide helpful, accurate, and actionable assistance
- Use your available tools when appropriate
- Be thorough and explain your reasoning

Always be helpful, accurate, and focused on development tasks.`;
  }

  // File operation helpers
  async readFile(filePath: string): Promise<string> {
    return this.fileOps.readFile(filePath);
  }

  async writeFile(filePath: string, content: string): Promise<void> {
    return this.fileOps.writeFile(filePath, content);
  }

  async findFiles(pattern: string): Promise<string[]> {
    return this.fileOps.findFiles(pattern);
  }

  // Command execution helpers
  async runCommand(command: string): Promise<void> {
    const result = await this.commandRunner.execute(command);
    console.log(this.commandRunner.formatResult(result));
  }
}