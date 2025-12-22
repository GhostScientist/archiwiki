/**
 * Claude Config Loader
 *
 * Loads Claude Code configuration files at runtime:
 * - CLAUDE.md (project memory/context)
 * - .claude/skills/*.md (model-invoked skills)
 * - .claude/commands/*.md (slash commands)
 * - .claude/agents/*.md (subagents)
 */

import * as fs from 'fs';
import * as path from 'path';

export interface SkillDefinition {
  name: string;
  description: string;
  tools: string[];
  instructions: string;
  filePath: string;
}

export interface CommandDefinition {
  name: string;
  description?: string;
  template: string;
  filePath: string;
}

export interface SubagentDefinition {
  name: string;
  description: string;
  tools: string[];
  model: string;
  permissionMode?: string;
  systemPrompt: string;
  filePath: string;
}

export interface ClaudeConfig {
  memory: string | null;
  skills: SkillDefinition[];
  commands: CommandDefinition[];
  subagents: SubagentDefinition[];
}

/**
 * Parse YAML-like frontmatter from a markdown file
 */
function parseFrontmatter(content: string): { frontmatter: Record<string, string>; body: string } {
  const frontmatterMatch = content.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);

  if (!frontmatterMatch) {
    return { frontmatter: {}, body: content };
  }

  const frontmatterRaw = frontmatterMatch[1];
  const body = frontmatterMatch[2].trim();
  const frontmatter: Record<string, string> = {};

  for (const line of frontmatterRaw.split('\n')) {
    const colonIndex = line.indexOf(':');
    if (colonIndex > 0) {
      const key = line.slice(0, colonIndex).trim();
      const value = line.slice(colonIndex + 1).trim();
      frontmatter[key] = value;
    }
  }

  return { frontmatter, body };
}

/**
 * Load all Claude Code configuration from the working directory
 */
export function loadClaudeConfig(workingDir: string = process.cwd()): ClaudeConfig {
  const config: ClaudeConfig = {
    memory: null,
    skills: [],
    commands: [],
    subagents: []
  };

  // 1. Load CLAUDE.md (memory)
  const claudeMdPath = path.join(workingDir, 'CLAUDE.md');
  if (fs.existsSync(claudeMdPath)) {
    try {
      config.memory = fs.readFileSync(claudeMdPath, 'utf-8');
    } catch (e) {
      console.warn('Warning: Could not read CLAUDE.md:', e);
    }
  }

  // 2. Load skills from .claude/skills/*/SKILL.md
  const skillsDir = path.join(workingDir, '.claude', 'skills');
  if (fs.existsSync(skillsDir)) {
    try {
      const skillFolders = fs.readdirSync(skillsDir, { withFileTypes: true })
        .filter(d => d.isDirectory())
        .map(d => d.name);

      for (const folder of skillFolders) {
        const skillFile = path.join(skillsDir, folder, 'SKILL.md');
        if (fs.existsSync(skillFile)) {
          const content = fs.readFileSync(skillFile, 'utf-8');
          const { frontmatter, body } = parseFrontmatter(content);

          config.skills.push({
            name: frontmatter.name || folder,
            description: frontmatter.description || '',
            tools: frontmatter.tools ? frontmatter.tools.split(',').map(t => t.trim()) : [],
            instructions: body,
            filePath: skillFile
          });
        }
      }
    } catch (e) {
      console.warn('Warning: Could not load skills:', e);
    }
  }

  // 3. Load commands from .claude/commands/*.md
  const commandsDir = path.join(workingDir, '.claude', 'commands');
  if (fs.existsSync(commandsDir)) {
    try {
      const commandFiles = fs.readdirSync(commandsDir)
        .filter(f => f.endsWith('.md'));

      for (const file of commandFiles) {
        const filePath = path.join(commandsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const name = file.replace('.md', '');

        config.commands.push({
          name,
          template: content,
          filePath
        });
      }
    } catch (e) {
      console.warn('Warning: Could not load commands:', e);
    }
  }

  // 4. Load subagents from .claude/agents/*.md
  const agentsDir = path.join(workingDir, '.claude', 'agents');
  if (fs.existsSync(agentsDir)) {
    try {
      const agentFiles = fs.readdirSync(agentsDir)
        .filter(f => f.endsWith('.md'));

      for (const file of agentFiles) {
        const filePath = path.join(agentsDir, file);
        const content = fs.readFileSync(filePath, 'utf-8');
        const { frontmatter, body } = parseFrontmatter(content);
        const name = frontmatter.name || file.replace('.md', '');

        config.subagents.push({
          name,
          description: frontmatter.description || '',
          tools: frontmatter.tools ? frontmatter.tools.split(',').map(t => t.trim()) : [],
          model: frontmatter.model || 'sonnet',
          permissionMode: frontmatter.permissionMode,
          systemPrompt: body,
          filePath
        });
      }
    } catch (e) {
      console.warn('Warning: Could not load subagents:', e);
    }
  }

  return config;
}

/**
 * Format skills as a system prompt section
 */
export function formatSkillsForPrompt(skills: SkillDefinition[]): string {
  if (skills.length === 0) return '';

  let prompt = '\n\n## Available Skills\n\n';
  prompt += 'You have access to the following specialized skills. When the user\'s request matches a skill\'s purpose, you should apply that skill\'s instructions.\n\n';

  for (const skill of skills) {
    prompt += `### Skill: ${skill.name}\n`;
    prompt += `**When to use:** ${skill.description}\n\n`;
    prompt += `**Instructions:**\n${skill.instructions}\n\n`;
  }

  return prompt;
}

/**
 * Format commands for display/autocomplete
 */
export function formatCommandsForDisplay(commands: CommandDefinition[]): string[] {
  return commands.map(cmd => `/${cmd.name}`);
}

/**
 * Get a specific command by name
 */
export function getCommand(commands: CommandDefinition[], name: string): CommandDefinition | undefined {
  return commands.find(cmd => cmd.name === name || cmd.name === name.replace(/^\//, ''));
}

/**
 * Expand a command template with arguments
 */
export function expandCommand(command: CommandDefinition, args: string): string {
  let expanded = command.template;

  // Replace $ARGUMENTS with the full args string
  expanded = expanded.replace(/\$ARGUMENTS/g, args);

  // Replace $1, $2, etc. with positional args
  const argParts = args.split(/\s+/).filter(Boolean);
  for (let i = 0; i < argParts.length; i++) {
    expanded = expanded.replace(new RegExp(`\\$${i + 1}`, 'g'), argParts[i]);
  }

  return expanded;
}
