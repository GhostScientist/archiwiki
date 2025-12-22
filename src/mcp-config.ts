import * as fs from 'fs';
import * as path from 'path';

export type MCPServerType = 'stdio' | 'http' | 'sse' | 'sdk';

export interface MCPServerBase {
  type: MCPServerType;
  enabled?: boolean;
  description?: string;
}

export interface MCPStdioServer extends MCPServerBase {
  type: 'stdio';
  command: string;
  args?: string[];
  env?: Record<string, string>;
}

export interface MCPHttpServer extends MCPServerBase {
  type: 'http';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPSseServer extends MCPServerBase {
  type: 'sse';
  url: string;
  headers?: Record<string, string>;
}

export interface MCPSdkServer extends MCPServerBase {
  type: 'sdk';
  serverModule: string;
}

export type MCPServerConfig = MCPStdioServer | MCPHttpServer | MCPSseServer | MCPSdkServer;

export interface MCPConfig {
  mcpServers: Record<string, MCPServerConfig>;
}

export class MCPConfigManager {
  private configPath: string;
  private config: MCPConfig = { mcpServers: {} };

  constructor(configPath?: string) {
    this.configPath = configPath || path.join(process.cwd(), '.mcp.json');
  }

  async load(): Promise<MCPConfig> {
    try {
      if (fs.existsSync(this.configPath)) {
        const content = fs.readFileSync(this.configPath, 'utf-8');
        this.config = JSON.parse(content);
      }
    } catch (error) {
      console.warn(`Warning: Could not load MCP config from ${this.configPath}`);
    }
    return this.config;
  }

  async save(): Promise<void> {
    fs.writeFileSync(this.configPath, JSON.stringify(this.config, null, 2));
  }

  getServers(): Record<string, MCPServerConfig> {
    return this.config.mcpServers || {};
  }

  getEnabledServers(): Record<string, MCPServerConfig> {
    const servers: Record<string, MCPServerConfig> = {};
    for (const [name, config] of Object.entries(this.config.mcpServers || {})) {
      if (config.enabled !== false) {
        servers[name] = config;
      }
    }
    return servers;
  }

  async addServer(name: string, config: MCPServerConfig): Promise<void> {
    this.config.mcpServers[name] = { ...config, enabled: true };
    await this.save();
  }

  async removeServer(name: string): Promise<boolean> {
    if (this.config.mcpServers[name]) {
      delete this.config.mcpServers[name];
      await this.save();
      return true;
    }
    return false;
  }

  async toggleServer(name: string, enabled?: boolean): Promise<boolean> {
    if (this.config.mcpServers[name]) {
      const current = this.config.mcpServers[name].enabled !== false;
      this.config.mcpServers[name].enabled = enabled !== undefined ? enabled : !current;
      await this.save();
      return true;
    }
    return false;
  }

  resolveEnvVariables(config: MCPServerConfig): MCPServerConfig {
    const resolved = JSON.parse(JSON.stringify(config));

    const resolveValue = (value: string): string => {
      return value.replace(/\$\{([^}]+)\}/g, (match, varName) => {
        // Support default values: ${VAR:-default}
        const [name, defaultValue] = varName.split(':-');
        return process.env[name] || defaultValue || match;
      });
    };

    const resolveObject = (obj: any): any => {
      if (typeof obj === 'string') {
        return resolveValue(obj);
      }
      if (Array.isArray(obj)) {
        return obj.map(resolveObject);
      }
      if (obj && typeof obj === 'object') {
        const result: any = {};
        for (const [key, value] of Object.entries(obj)) {
          result[key] = resolveObject(value);
        }
        return result;
      }
      return obj;
    };

    return resolveObject(resolved);
  }

  formatServerList(): string {
    const servers = this.getServers();
    const entries = Object.entries(servers);

    if (entries.length === 0) {
      return 'No MCP servers configured.';
    }

    return entries.map(([name, config]) => {
      const status = config.enabled !== false ? '●' : '○';
      const statusText = config.enabled !== false ? 'enabled' : 'disabled';
      const typeLabel = config.type.toUpperCase();

      let details = '';
      switch (config.type) {
        case 'stdio':
          details = `Command: ${config.command}${config.args?.length ? ' ' + config.args.join(' ') : ''}`;
          break;
        case 'http':
        case 'sse':
          details = `URL: ${config.url}`;
          break;
        case 'sdk':
          details = `Module: ${config.serverModule}`;
          break;
      }

      return `${status} ${name} (${typeLabel}) - ${statusText}\n   ${config.description || ''}\n   ${details}`;
    }).join('\n\n');
  }
}
