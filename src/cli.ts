#!/usr/bin/env node

import { config as loadEnv } from 'dotenv';
import { resolve } from 'path';
import * as fs from 'fs';
import * as path from 'path';
import { Command } from 'commander';
import chalk from 'chalk';
import ora from 'ora';
import inquirer from 'inquirer';
import inquirerAutocomplete from 'inquirer-autocomplete-prompt';
import { DevelopmentAgentAgent } from './agent.js';
import { ArchitecturalWikiAgent, type ProgressEvent, type GenerationEstimate } from './wiki-agent.js';
import { SiteGenerator } from './site-generator.js';
import { ConfigManager } from './config.js';
import { PermissionManager, type PermissionPolicy } from './permissions.js';
import { PlanManager, formatAge, type Plan, type PlanStep } from './planner.js';
import { MCPConfigManager, type MCPServerConfig } from './mcp-config.js';
import { loadClaudeConfig, getCommand, expandCommand, type ClaudeConfig } from './claude-config.js';

// Register autocomplete prompt
inquirer.registerPrompt('autocomplete', inquirerAutocomplete);

// Load .env from current working directory (supports global installation)
const workingDir = process.cwd();
loadEnv({ path: resolve(workingDir, '.env') });

// Load Claude Code configuration (skills, commands, memory)
const claudeConfig = loadClaudeConfig(workingDir);

const program = new Command();

program
  .name('ted-mosby')
  .description('Generate architectural documentation wikis for code repositories with source traceability.')
  .version('1.0.0');

// Config command
program
  .command('config')
  .description('Configure the agent')
  .option('--show', 'Show current configuration')
  .action(async (options) => {
    const configManager = new ConfigManager();
    await configManager.load();

    if (options.show) {
      const config = configManager.get();
      console.log(chalk.cyan('\n📋 Current Configuration:'));
      console.log(chalk.gray('API Key:'), config.apiKey ? '***' + config.apiKey.slice(-4) : chalk.red('Not set'));
      console.log(chalk.gray('Source:'), process.env.CLAUDE_API_KEY ? 'Environment variable' : 'Config file');
      return;
    }

    console.log(chalk.yellow('\n🔐 API Key Configuration\n'));
    console.log(chalk.white('To configure your API key, create a .env file in the project root:\n'));
    console.log(chalk.gray('  echo "CLAUDE_API_KEY=your-key-here" > .env\n'));
    console.log(chalk.white('Or set the environment variable directly:\n'));
    console.log(chalk.gray('  export CLAUDE_API_KEY=your-key-here\n'));
    console.log(chalk.cyan('Tip: Copy .env.example to .env and fill in your API key.'));
  });

// Generate command - main wiki generation functionality
program
  .command('generate')
  .description('Generate architectural documentation wiki for a repository')
  .requiredOption('-r, --repo <url>', 'Repository URL (GitHub/GitLab) or local path')
  .option('-o, --output <dir>', 'Output directory for wiki', './wiki')
  .option('-c, --config <file>', 'Path to wiki configuration file (wiki.json)')
  .option('-t, --token <token>', 'Access token for private repositories')
  .option('-m, --model <model>', 'Claude model to use', 'claude-sonnet-4-20250514')
  .option('-p, --path <path>', 'Specific path within repo to focus on')
  .option('-f, --force', 'Force regeneration (ignore cache)')
  .option('-v, --verbose', 'Verbose output')
  .option('-e, --estimate', 'Estimate time and cost without running (dry run)')
  .option('-s, --site', 'Generate interactive static site from wiki')
  .option('--site-only', 'Only generate static site (skip wiki generation, use existing markdown)')
  .option('--site-title <title>', 'Site title for static site')
  .option('--theme <theme>', 'Site theme: light, dark, or auto', 'auto')
  .option('--max-chunks <number>', 'Maximum chunks to index (for large codebases, e.g., 5000)', parseInt)
  .option('--max-results <number>', 'Maximum search results per query (default 10, reduce for large codebases)', parseInt)
  .option('--batch-size <number>', 'Enable batched mode: process codebase in batches of N chunks (for very large repos)', parseInt)
  .option('--skip-index', 'Skip indexing and use existing cached index (for debugging agent behavior)')
  .option('--max-turns <number>', 'Maximum agent turns (default 200, lower to reduce cost estimate)', parseInt)
  .option('--direct-api', 'Use Anthropic API directly (bypasses Claude Code billing, uses your API credits)')
  .option('--ai-chat', 'Enable AI chat feature with semantic search in generated site')
  .action(async (options) => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();

      if (!configManager.hasApiKey()) {
        console.log(chalk.red('❌ No API key found.'));
        console.log(chalk.yellow('\nSet your Anthropic API key:'));
        console.log(chalk.gray('  export ANTHROPIC_API_KEY=your-key-here'));
        process.exit(1);
      }

      console.log(chalk.cyan.bold('\n📚 ArchitecturalWiki Generator\n'));
      console.log(chalk.white('Repository:'), chalk.green(options.repo));
      console.log(chalk.white('Output:'), chalk.green(path.resolve(options.output)));
      if (options.path) console.log(chalk.white('Focus path:'), chalk.green(options.path));
      console.log();

      const permissionManager = new PermissionManager({ policy: 'permissive' });
      const agent = new ArchitecturalWikiAgent({
        verbose: options.verbose,
        apiKey: config.apiKey,
        permissionManager
      });

      // Handle estimate mode (dry run)
      if (options.estimate) {
        const spinner = ora('Analyzing repository...').start();

        try {
          const estimate = await agent.estimateGeneration({
            repoUrl: options.repo,
            outputDir: options.output,
            accessToken: options.token || process.env.GITHUB_TOKEN
          });

          spinner.succeed('Analysis complete');
          console.log();

          // Display estimate
          console.log(chalk.cyan.bold('📊 Generation Estimate\n'));

          console.log(chalk.white('Files to process:'), chalk.yellow(estimate.files.toString()));
          console.log(chalk.white('Estimated chunks:'), chalk.yellow(estimate.estimatedChunks.toString()));
          console.log(chalk.white('Estimated tokens:'), chalk.yellow(estimate.estimatedTokens.toLocaleString()));
          console.log();

          console.log(chalk.white.bold('⏱️  Estimated Time'));
          console.log(chalk.gray('  Indexing:'), chalk.yellow(`${estimate.estimatedTime.indexingMinutes} min`));
          console.log(chalk.gray('  Generation:'), chalk.yellow(`${estimate.estimatedTime.generationMinutes} min`));
          console.log(chalk.gray('  Total:'), chalk.green.bold(`~${estimate.estimatedTime.totalMinutes} min`));
          console.log();

          console.log(chalk.white.bold('💰 Estimated Cost (Claude Sonnet)'));
          console.log(chalk.gray('  Input tokens:'), chalk.yellow(`$${estimate.estimatedCost.input.toFixed(2)}`));
          console.log(chalk.gray('  Output tokens:'), chalk.yellow(`$${estimate.estimatedCost.output.toFixed(2)}`));
          console.log(chalk.gray('  Total:'), chalk.green.bold(`$${estimate.estimatedCost.total.toFixed(2)}`));
          console.log();

          console.log(chalk.white.bold('📁 Files by Type'));
          const sortedExts = Object.entries(estimate.breakdown.byExtension)
            .sort(([, a], [, b]) => b - a)
            .slice(0, 10);
          for (const [ext, count] of sortedExts) {
            console.log(chalk.gray(`  ${ext}:`), chalk.yellow(count.toString()));
          }
          console.log();

          if (estimate.breakdown.largestFiles.length > 0) {
            console.log(chalk.white.bold('📄 Largest Files'));
            for (const file of estimate.breakdown.largestFiles.slice(0, 5)) {
              const sizeKb = Math.round(file.size / 1024);
              console.log(chalk.gray(`  ${file.path}`), chalk.yellow(`(${sizeKb} KB)`));
            }
            console.log();
          }

          console.log(chalk.gray('Run without --estimate to start generation.\n'));
        } catch (error) {
          spinner.fail('Analysis failed');
          throw error;
        }

        return;
      }

      // Handle --site-only mode (generate site from existing markdown)
      if (options.siteOnly) {
        await generateStaticSite(options);
        return;
      }

      const spinner = ora('Starting wiki generation...').start();
      let currentPhase = '';

      // Choose generation method based on options
      const generationOptions = {
        repoUrl: options.repo,
        outputDir: options.output,
        configPath: options.config,
        accessToken: options.token || process.env.GITHUB_TOKEN,
        model: options.model,
        targetPath: options.path,
        forceRegenerate: options.force,
        verbose: options.verbose,
        maxChunks: options.maxChunks,
        maxSearchResults: options.maxResults,
        batchSize: options.batchSize,
        skipIndex: options.skipIndex,
        maxTurns: options.maxTurns,
        directApi: options.directApi
      };

      // Choose generator based on options
      let generator;
      if (options.directApi) {
        console.log(chalk.yellow('\n⚡ Direct API mode: Using Anthropic API directly (bypasses Claude Code)\n'));
        generator = agent.generateWikiDirectApi(generationOptions);
      } else if (options.skipIndex) {
        console.log(chalk.yellow('\n⚡ Skip-index mode: Using existing cached index (debug mode)\n'));
        generator = agent.generateWikiAgentOnly(generationOptions);
      } else if (options.batchSize) {
        generator = agent.generateWikiBatched(generationOptions);
      } else {
        generator = agent.generateWiki(generationOptions);
      }

      try {
        for await (const event of generator) {
          // Handle progress events
          if (event.type === 'phase') {
            // Stop spinner during indexing/batch phases so RAG output is visible
            if (event.message.includes('Indexing') || event.message.includes('batch') || event.message.includes('Analyzing') || event.message.includes('Finalizing')) {
              spinner.stop();
              console.log(chalk.cyan(`\n📊 ${event.message}`));
            } else {
              spinner.text = event.message;
            }
            currentPhase = event.message;
            if (options.verbose) {
              spinner.succeed(currentPhase);
              spinner.start(event.message);
            }
          } else if (event.type === 'step') {
            // Show step messages for batch progress
            if (event.message.includes('Indexed') || event.message.includes('Batch') || event.message.includes('Found') || event.message.includes('Final index') || event.message.includes('chunks loaded')) {
              console.log(chalk.green(`  ✓ ${event.message}`));
              // Resume spinner after last step before agent runs
              if (event.message.includes('chunks loaded') || event.message.includes('Final index')) {
                spinner.start('Generating architectural documentation...');
              }
            } else if (options.verbose) {
              spinner.info(event.message);
              spinner.start(currentPhase);
            }
          } else if (event.type === 'file') {
            if (options.verbose) {
              console.log(chalk.gray(`  📄 ${event.message}`));
            }
          } else if (event.type === 'complete') {
            spinner.succeed(chalk.green('Wiki generation complete!'));
          } else if (event.type === 'error') {
            spinner.fail(chalk.red(event.message));
          }
          // Handle agent streaming messages
          else if ((event as any).type === 'stream_event') {
            const streamEvent = (event as any).event;
            if (streamEvent?.type === 'content_block_delta' && streamEvent.delta?.type === 'text_delta') {
              if (options.verbose) {
                process.stdout.write(streamEvent.delta.text || '');
              }
            } else if (streamEvent?.type === 'content_block_start' && streamEvent.content_block?.type === 'tool_use') {
              spinner.text = `Using tool: ${streamEvent.content_block.name}`;
            }
          } else if ((event as any).type === 'tool_result') {
            if (options.verbose) {
              spinner.info('Tool completed');
              spinner.start(currentPhase);
            }
          } else if ((event as any).type === 'result') {
            if ((event as any).subtype === 'success') {
              spinner.succeed(chalk.green('Wiki generation complete!'));
            }
          }
        }

        console.log();
        console.log(chalk.cyan('📁 Wiki generated at:'), chalk.white(path.resolve(options.output)));

        // Generate static site if requested
        if (options.site || options.siteOnly) {
          await generateStaticSite(options);
        } else {
          console.log(chalk.gray('Open wiki/README.md to start exploring the documentation.'));
          console.log(chalk.gray('Tip: Add --site flag to generate an interactive website.'));
        }
        console.log();
      } catch (error) {
        spinner.fail('Wiki generation failed');
        throw error;
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      if (options.verbose && error instanceof Error && error.stack) {
        console.error(chalk.gray(error.stack));
      }
      process.exit(1);
    }
  });

// Update-docs command - incremental documentation updates
program
  .command('update-docs')
  .description('Update documentation based on changes since last index')
  .requiredOption('-r, --repo <path>', 'Repository path (local)')
  .option('-o, --output <dir>', 'Output directory for wiki', './wiki')
  .option('-m, --model <model>', 'Claude model to use', 'claude-sonnet-4-20250514')
  .option('-v, --verbose', 'Verbose output')
  .action(async (options) => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();

      if (!configManager.hasApiKey()) {
        console.log(chalk.red('❌ No API key found.'));
        console.log(chalk.yellow('\nSet your Anthropic API key:'));
        console.log(chalk.gray('  export ANTHROPIC_API_KEY=your-key-here'));
        process.exit(1);
      }

      const wikiDir = path.resolve(options.output);
      const cacheDir = path.join(wikiDir, '.ted-mosby-cache');
      const indexStatePath = path.join(cacheDir, 'index-state.json');

      // Check if we have an existing index
      if (!fs.existsSync(indexStatePath)) {
        console.log(chalk.yellow('⚠️  No existing index found.'));
        console.log(chalk.gray('Run `ted-mosby generate` first to create the initial documentation.'));
        process.exit(1);
      }

      const indexState = JSON.parse(fs.readFileSync(indexStatePath, 'utf-8'));
      console.log(chalk.cyan.bold('\n📝 Documentation Update\n'));
      console.log(chalk.white('Last indexed:'), chalk.green(indexState.commitHash.slice(0, 7)));
      console.log(chalk.white('Indexed at:'), chalk.green(new Date(indexState.indexedAt).toLocaleString()));
      console.log();

      // Get changed files since last index
      const git = (await import('simple-git')).simpleGit(options.repo);
      const currentLog = await git.log({ maxCount: 1 });
      const currentCommit = currentLog.latest?.hash || 'unknown';

      if (currentCommit === indexState.commitHash) {
        console.log(chalk.green('✓ Documentation is up to date. No changes since last index.'));
        return;
      }

      const diffResult = await git.diff(['--name-only', indexState.commitHash, 'HEAD']);
      const changedFiles = diffResult.split('\n').filter(f => f.trim().length > 0);

      if (changedFiles.length === 0) {
        console.log(chalk.green('✓ No relevant file changes detected.'));
        return;
      }

      console.log(chalk.white('Current commit:'), chalk.green(currentCommit.slice(0, 7)));
      console.log(chalk.white('Changed files:'), chalk.yellow(changedFiles.length.toString()));
      console.log();

      // Show changed files
      console.log(chalk.white.bold('Files changed since last index:'));
      const relevantExts = ['.ts', '.tsx', '.js', '.jsx', '.py', '.go', '.rs', '.java'];
      const relevantFiles = changedFiles.filter(f => relevantExts.some(ext => f.endsWith(ext)));

      for (const file of relevantFiles.slice(0, 15)) {
        console.log(chalk.gray(`  • ${file}`));
      }
      if (relevantFiles.length > 15) {
        console.log(chalk.gray(`  ... and ${relevantFiles.length - 15} more`));
      }
      console.log();

      // Prompt for confirmation
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Update documentation for ${relevantFiles.length} changed files?`,
        default: true
      }]);

      if (!confirm) {
        console.log(chalk.yellow('\nUpdate cancelled.'));
        return;
      }

      // Run incremental update
      const spinner = ora('Updating documentation...').start();

      const permissionManager = new PermissionManager({ policy: 'permissive' });
      const agent = new ArchitecturalWikiAgent({
        verbose: options.verbose,
        apiKey: config.apiKey,
        permissionManager
      });

      // TODO: Implement incremental update mode in agent
      // For now, re-run full generation but the RAG index is cached
      // Future: Pass changedFiles to agent for targeted updates

      try {
        for await (const event of agent.generateWiki({
          repoUrl: options.repo,
          outputDir: options.output,
          model: options.model,
          verbose: options.verbose,
          forceRegenerate: true  // Force re-index to update commit hash
        })) {
          if (event.type === 'phase') {
            spinner.text = event.message;
          } else if (event.type === 'complete') {
            spinner.succeed(chalk.green('Documentation updated!'));
          } else if (event.type === 'error') {
            spinner.fail(chalk.red(event.message));
          }
        }

        console.log();
        console.log(chalk.cyan('📁 Wiki updated at:'), chalk.white(wikiDir));
        console.log(chalk.gray('Tip: Run with --site flag to regenerate the static site.'));
        console.log();
      } catch (error) {
        spinner.fail('Update failed');
        throw error;
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Continue-generation command - complete missing wiki pages
program
  .command('continue')
  .description('Continue generating missing wiki pages (verifies completeness and creates missing pages)')
  .requiredOption('-r, --repo <path>', 'Repository path (local)')
  .option('-o, --output <dir>', 'Output directory for wiki', './wiki')
  .option('-m, --model <model>', 'Claude model to use', 'claude-sonnet-4-20250514')
  .option('-v, --verbose', 'Verbose output')
  .option('--verify-only', 'Only verify completeness, do not generate missing pages')
  .option('--skip-index', 'Skip indexing and use existing cached index')
  .option('--direct-api', 'Use Anthropic API directly (bypasses Claude Code billing)')
  .option('--max-turns <number>', 'Maximum agent turns (default 200)', parseInt)
  .action(async (options) => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();

      if (!configManager.hasApiKey()) {
        console.log(chalk.red('❌ No API key found.'));
        console.log(chalk.yellow('\nSet your Anthropic API key:'));
        console.log(chalk.gray('  export ANTHROPIC_API_KEY=your-key-here'));
        process.exit(1);
      }

      const wikiDir = path.resolve(options.output);

      // Check if wiki directory exists
      if (!fs.existsSync(wikiDir)) {
        console.log(chalk.red('❌ Wiki directory not found: ' + wikiDir));
        console.log(chalk.gray('Run `ted-mosby generate` first to create the wiki.'));
        process.exit(1);
      }

      console.log(chalk.cyan.bold('\n📋 Wiki Completeness Check\n'));

      // Use the agent's verification method
      const permissionManager = new PermissionManager({ policy: 'permissive' });
      const agent = new ArchitecturalWikiAgent({
        verbose: options.verbose,
        apiKey: config.apiKey,
        permissionManager
      });

      const verification = await agent.verifyWikiCompleteness(wikiDir);

      console.log(chalk.white('Total pages:'), chalk.green(verification.totalPages.toString()));
      console.log(chalk.white('Broken links:'), verification.brokenLinks.length > 0
        ? chalk.red(verification.brokenLinks.length.toString())
        : chalk.green('0'));
      console.log(chalk.white('Missing pages:'), verification.missingPages.length > 0
        ? chalk.red(verification.missingPages.length.toString())
        : chalk.green('0'));
      console.log();

      if (verification.isComplete) {
        console.log(chalk.green('✅ Wiki is complete! All internal links are valid.'));
        return;
      }

      // Show missing pages
      console.log(chalk.yellow.bold('Missing pages:'));
      const uniqueMissing = [...new Set(verification.brokenLinks.map(l => l.target))];
      for (const page of uniqueMissing.slice(0, 20)) {
        console.log(chalk.gray(`  • ${page}`));
      }
      if (uniqueMissing.length > 20) {
        console.log(chalk.gray(`  ... and ${uniqueMissing.length - 20} more`));
      }
      console.log();

      if (options.verifyOnly) {
        console.log(chalk.yellow('Verification complete. Run without --verify-only to generate missing pages.'));
        process.exit(verification.isComplete ? 0 : 1);
      }

      // Prompt for confirmation
      const { confirm } = await inquirer.prompt([{
        type: 'confirm',
        name: 'confirm',
        message: `Generate ${uniqueMissing.length} missing pages?`,
        default: true
      }]);

      if (!confirm) {
        console.log(chalk.yellow('\nGeneration cancelled.'));
        return;
      }

      // Run continuation
      const spinner = ora('Generating missing pages...').start();

      // Choose generator based on options
      const generationOptions = {
        repoUrl: options.repo,
        outputDir: options.output,
        model: options.model,
        verbose: options.verbose,
        missingPages: uniqueMissing,  // Pass missing pages to agent for targeted generation
        skipIndex: options.skipIndex,
        directApi: options.directApi,
        maxTurns: options.maxTurns
      };

      let generator;
      if (options.directApi) {
        console.log(chalk.yellow('\n⚡ Direct API mode: Using Anthropic API directly\n'));
        generator = agent.generateWikiDirectApi(generationOptions);
      } else if (options.skipIndex) {
        console.log(chalk.yellow('\n⚡ Skip-index mode: Using existing cached index\n'));
        generator = agent.generateWikiAgentOnly(generationOptions);
      } else {
        generator = agent.generateWiki(generationOptions);
      }

      try {
        for await (const event of generator) {
          if ((event as ProgressEvent).type === 'phase') {
            spinner.text = (event as ProgressEvent).message;
          } else if ((event as ProgressEvent).type === 'complete') {
            spinner.succeed(chalk.green('Missing pages generated!'));
          } else if ((event as ProgressEvent).type === 'error') {
            spinner.fail(chalk.red((event as ProgressEvent).message));
          }
        }

        // Verify again
        console.log();
        console.log(chalk.cyan('Verifying completeness...'));
        const postVerification = await agent.verifyWikiCompleteness(wikiDir);

        if (postVerification.isComplete) {
          console.log(chalk.green('✅ Wiki is now complete! All internal links are valid.'));
        } else {
          console.log(chalk.yellow(`⚠️  ${postVerification.brokenLinks.length} broken links remain.`));
          console.log(chalk.gray('Run `ted-mosby continue` again to generate remaining pages.'));
        }

        console.log();
        console.log(chalk.cyan('📁 Wiki at:'), chalk.white(wikiDir));
        console.log();
      } catch (error) {
        spinner.fail('Generation failed');
        throw error;
      }
    } catch (error) {
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Verify command - check wiki completeness without generating
program
  .command('verify')
  .description('Verify wiki completeness and report broken links')
  .option('-o, --output <dir>', 'Wiki directory to verify', './wiki')
  .option('--json', 'Output as JSON')
  .action(async (options) => {
    try {
      const wikiDir = path.resolve(options.output);

      if (!fs.existsSync(wikiDir)) {
        console.log(chalk.red('❌ Wiki directory not found: ' + wikiDir));
        process.exit(1);
      }

      const configManager = new ConfigManager();
      const config = await configManager.load();
      const permissionManager = new PermissionManager({ policy: 'permissive' });
      const agent = new ArchitecturalWikiAgent({
        apiKey: config.apiKey,
        permissionManager
      });

      const verification = await agent.verifyWikiCompleteness(wikiDir);

      if (options.json) {
        console.log(JSON.stringify(verification, null, 2));
        process.exit(verification.isComplete ? 0 : 1);
      }

      console.log(chalk.cyan.bold('\n📋 Wiki Completeness Report\n'));
      console.log(chalk.white('Total pages:'), chalk.green(verification.totalPages.toString()));
      console.log(chalk.white('Broken links:'), verification.brokenLinks.length > 0
        ? chalk.red(verification.brokenLinks.length.toString())
        : chalk.green('0'));
      console.log();

      if (verification.isComplete) {
        console.log(chalk.green('✅ Wiki is complete! All internal links are valid.'));
      } else {
        console.log(chalk.yellow.bold('Broken links found:'));

        // Group by target
        const byTarget = new Map<string, string[]>();
        for (const link of verification.brokenLinks) {
          if (!byTarget.has(link.target)) {
            byTarget.set(link.target, []);
          }
          byTarget.get(link.target)!.push(link.source);
        }

        for (const [target, sources] of byTarget) {
          console.log(chalk.red(`\n  Missing: ${target}`));
          console.log(chalk.gray(`  Referenced by:`));
          for (const source of sources.slice(0, 3)) {
            console.log(chalk.gray(`    - ${source}`));
          }
          if (sources.length > 3) {
            console.log(chalk.gray(`    ... and ${sources.length - 3} more`));
          }
        }

        console.log();
        console.log(chalk.yellow('Run `ted-mosby continue` to generate missing pages.'));
      }

      process.exit(verification.isComplete ? 0 : 1);
    } catch (error) {
      console.error(chalk.red('\nError:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

// Static site generation helper
async function generateStaticSite(options: {
  output: string;
  repo?: string;
  siteTitle?: string;
  theme?: 'light' | 'dark' | 'auto';
  verbose?: boolean;
  aiChat?: boolean;
}) {
  console.log(chalk.cyan.bold('\n🌐 Generating Interactive Static Site\n'));

  const wikiDir = path.resolve(options.output);
  const siteDir = path.join(path.dirname(wikiDir), 'site');

  // Check if wiki directory exists
  if (!fs.existsSync(wikiDir)) {
    console.log(chalk.red('❌ Wiki directory not found: ' + wikiDir));
    console.log(chalk.gray('Run without --site-only to generate wiki first.'));
    process.exit(1);
  }

  const spinner = ora('Building static site...').start();

  try {
    const siteGenerator = new SiteGenerator({
      wikiDir,
      outputDir: siteDir,
      title: options.siteTitle || 'Architecture Wiki',
      description: 'Interactive architectural documentation',
      theme: (options.theme as 'light' | 'dark' | 'auto') || 'auto',
      features: {
        guidedTour: false,  // Disabled by default - can be enabled via flag
        codeExplorer: true,
        search: true,
        progressTracking: true,
        keyboardNav: true,
        aiChat: options.aiChat || false
      },
      repoUrl: options.repo || ''
    });

    await siteGenerator.generate();

    spinner.succeed(chalk.green('Static site generated!'));

    console.log();
    console.log(chalk.cyan('🌐 Site generated at:'), chalk.white(siteDir));
    console.log();
    console.log(chalk.white.bold('Features included:'));
    console.log(chalk.gray('  ✓ Interactive search (press "/" to open)'));
    console.log(chalk.gray('  ✓ Guided tours for onboarding'));
    console.log(chalk.gray('  ✓ Code explorer with syntax highlighting'));
    console.log(chalk.gray('  ✓ Live Mermaid diagrams (click to zoom)'));
    console.log(chalk.gray('  ✓ Dark/light theme toggle'));
    console.log(chalk.gray('  ✓ Keyboard navigation (press "?" for help)'));
    console.log(chalk.gray('  ✓ Progress tracking'));
    if (options.aiChat) {
      console.log(chalk.gray('  ✓ AI Chat with SmolLM2 (browser-based)'));
      console.log(chalk.gray('  ✓ Semantic search with embeddings'));
    }
    console.log();
    console.log(chalk.white('To preview locally:'));
    console.log(chalk.gray('  npx serve ' + siteDir));
    console.log();
  } catch (error) {
    spinner.fail('Static site generation failed');
    throw error;
  }
}

program
  .argument('[query]', 'Direct query to the agent')
  .option('-i, --interactive', 'Start interactive session')
  .option('-v, --verbose', 'Verbose output')
  .option('-p, --plan', 'Planning mode - create plan before executing')
  .action(async (query?: string, options?: { interactive?: boolean; verbose?: boolean; plan?: boolean }) => {
    try {
      const configManager = new ConfigManager();
      const config = await configManager.load();

      if (!configManager.hasApiKey()) {
        console.log(chalk.red('❌ No API key found.'));
        console.log(chalk.yellow('\nCreate a .env file with your API key:'));
        console.log(chalk.gray('  echo "CLAUDE_API_KEY=your-key-here" > .env'));
        console.log(chalk.yellow('\nOr set the environment variable:'));
        console.log(chalk.gray('  export CLAUDE_API_KEY=your-key-here'));
        process.exit(1);
      }

      const permissionManager = new PermissionManager({ policy: 'permissive' });
      const agent = new DevelopmentAgentAgent({
        verbose: options?.verbose || false,
        apiKey: config.apiKey,
        permissionManager
      });

      console.log(chalk.cyan.bold('\n🤖 Development Agent'));
      console.log(chalk.gray('Full-stack development assistant with file operations, build tools, and code analysis capabilities.'));
      console.log(chalk.gray(`📁 Working directory: ${workingDir}\n`));

      if (query && options?.plan) {
        // Planning mode with query
        await handlePlanningMode(agent, query, permissionManager);
      } else if (query) {
        await handleSingleQuery(agent, query, options?.verbose);
      } else {
        await handleInteractiveMode(agent, permissionManager, options?.verbose);
      }
    } catch (error) {
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      process.exit(1);
    }
  });

function parseSlashCommand(input: string): { command: string; args: Record<string, any>; error?: string } {
  // Remove leading slash
  const trimmed = input.slice(1).trim();

  // Split by spaces, but respect quotes
  const parts: string[] = [];
  let current = '';
  let inQuotes = false;
  let quoteChar = '';

  for (let i = 0; i < trimmed.length; i++) {
    const char = trimmed[i];

    if ((char === '"' || char === "'") && (i === 0 || trimmed[i - 1] !== '\\')) {
      if (!inQuotes) {
        inQuotes = true;
        quoteChar = char;
      } else if (char === quoteChar) {
        inQuotes = false;
        quoteChar = '';
      } else {
        current += char;
      }
    } else if (char === ' ' && !inQuotes) {
      if (current) {
        parts.push(current);
        current = '';
      }
    } else {
      current += char;
    }
  }

  if (current) {
    parts.push(current);
  }

  if (inQuotes) {
    return { command: '', args: {}, error: 'Unclosed quote in command' };
  }

  const command = parts[0];
  const args: Record<string, any> = {};

  for (let i = 1; i < parts.length; i++) {
    const part = parts[i];

    if (part.startsWith('--')) {
      const key = part.slice(2);
      const nextPart = parts[i + 1];

      if (!nextPart || nextPart.startsWith('--')) {
        args[key] = true;
      } else {
        // Try to parse as number
        const numValue = Number(nextPart);
        args[key] = isNaN(numValue) ? nextPart : numValue;
        i++;
      }
    }
  }

  return { command, args };
}

/** Global to store stdin history - read at startup before commander parses */
let stdinHistory: Array<{role: string, content: string}> = [];

/** Read conversation history from stdin synchronously using fs */
function initStdinHistory(): void {
  // If stdin is a TTY (interactive), no history
  if (process.stdin.isTTY) {
    return;
  }

  try {
    // Read stdin synchronously using fs
    const fs = require('fs');
    const data = fs.readFileSync(0, 'utf8');  // fd 0 is stdin
    if (data.trim()) {
      const history = JSON.parse(data);
      if (Array.isArray(history)) {
        stdinHistory = history;
      }
    }
  } catch (e) {
    // No stdin data or invalid JSON, ignore
  }
}

async function handleSingleQuery(agent: any, query: string, verbose?: boolean) {
  // Use the global stdin history (read before commander.parse())
  const history = stdinHistory;

  const spinner = ora('Processing...').start();

  try {
    // Pass history to agent for multi-turn context
    const response = agent.query(query, history);
    spinner.stop();

    console.log(chalk.yellow('Query:'), query);
    console.log(chalk.green('Response:') + '\n');

    for await (const message of response) {
      // Handle streaming text deltas for real-time output
      if (message.type === 'stream_event') {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          process.stdout.write(event.delta.text || '');
        } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
          // Show tool being called
          console.log(chalk.cyan(`\n🔧 Using tool: ${event.content_block.name}`));
        } else if (event?.type === 'content_block_stop') {
          // Tool finished or content block ended
        }
      } else if (message.type === 'tool_result') {
        // Show tool result summary
        const result = (message as any).content;
        if (verbose && result) {
          console.log(chalk.gray(`   ↳ Tool completed`));
        }
      } else if (message.type === 'result') {
        // Display statistics (verbose mode only)
        if (verbose) {
          const stats = (message as any).content || message;
          if (stats.durationMs) {
            console.log(chalk.gray('\n--- Statistics ---'));
            console.log(chalk.gray(`Duration: ${stats.durationMs}ms`));
            console.log(chalk.gray(`Input tokens: ${stats.inputTokens}`));
            console.log(chalk.gray(`Output tokens: ${stats.outputTokens}`));
            if (stats.cacheReadTokens) console.log(chalk.gray(`Cache read: ${stats.cacheReadTokens}`));
          }
        }
      } else if (message.type === 'system') {
        // System messages (verbose mode only)
        if (verbose) console.log(chalk.blue(`[system] ${(message as any).content || (message as any).subtype || ''}`));
      }
    }

    console.log('\n');
  } catch (error) {
    spinner.fail('Failed to process query');
    throw error;
  }
}

async function handleInteractiveMode(agent: any, permissionManager: PermissionManager, verbose?: boolean) {
  // Load workflow executor
  const { WorkflowExecutor } = await import('./workflows.js');
  const workflowExecutor = new WorkflowExecutor(agent.permissionManager);
  const planManager = new PlanManager();

  // Build list of all available slash commands
  const builtinCommands = [
    { name: 'help', description: 'Show available commands' },
    { name: 'quit', description: 'Exit the agent' },
    { name: 'exit', description: 'Exit the agent' },
    { name: 'plan', description: 'Create a plan for a task' },
    { name: 'plans', description: 'List all pending plans' },
    { name: 'execute', description: 'Execute plan by number' },
    { name: 'plan-delete', description: 'Delete plans' },
    { name: 'mcp-list', description: 'List configured MCP servers' },
    { name: 'mcp-add', description: 'Add a new MCP server' },
    { name: 'mcp-remove', description: 'Remove an MCP server' },
    { name: 'mcp-toggle', description: 'Enable/disable an MCP server' },
    { name: 'command-add', description: 'Create a new custom slash command' },
    { name: 'command-list', description: 'List all custom commands' },
    { name: 'skill-add', description: 'Create a new skill' },
    { name: 'skill-list', description: 'List all available skills' },
    { name: 'files', description: 'List files in current directory' },
    { name: 'run', description: 'Execute a command' },
    { name: 'code-audit', description: 'Comprehensive code audit for technical debt and security' },
    { name: 'test-suite', description: 'Generate comprehensive test suite' },
    { name: 'refactor-analysis', description: 'Analyze code for refactoring opportunities' },
  ];

  // Add Claude Code commands from .claude/commands/
  const allCommands = [
    ...builtinCommands,
    ...claudeConfig.commands.map(c => ({ name: c.name, description: c.description || 'Custom command' }))
  ];

  // Autocomplete source function
  const commandSource = async (answers: any, input: string) => {
    input = input || '';

    // Only show autocomplete when typing slash commands
    if (!input.startsWith('/')) {
      return [];
    }

    const search = input.slice(1).toLowerCase();
    const matches = allCommands.filter(cmd =>
      cmd.name.toLowerCase().startsWith(search)
    );

    return matches.map(cmd => ({
      name: `/${cmd.name} - ${cmd.description}`,
      value: `/${cmd.name}`,
      short: `/${cmd.name}`
    }));
  };

  console.log(chalk.gray('Type your questions, or:'));
  console.log(chalk.gray('• /help - Show available commands'));
  console.log(chalk.gray('• /plan <query> - Create a plan before executing'));
  console.log(chalk.gray('• /quit or Ctrl+C - Exit'));
  if (claudeConfig.commands.length > 0) {
    console.log(chalk.gray(`• ${claudeConfig.commands.length} custom commands available (type / to see them)`));
  }
  console.log();

  while (true) {
    try {
      const { input } = await inquirer.prompt([
        {
          type: 'autocomplete',
          name: 'input',
          message: chalk.cyan('ted-mosby>'),
          prefix: '',
          source: commandSource,
          suggestOnly: true,  // Allow free text input
          emptyText: '',      // Don't show "no results" message
        }
      ]);

      if (!input.trim()) continue;

      if (input === '/quit' || input === '/exit') {
        console.log(chalk.yellow('\n👋 Goodbye!'));
        break;
      }

      if (input === '/help') {
        console.log(chalk.cyan.bold('\n📚 Available Commands:'));
        console.log(chalk.gray('• /help - Show this help'));
        console.log(chalk.gray('• /quit - Exit the agent'));
        console.log(chalk.gray('• /files - List files in current directory'));
        console.log(chalk.gray('• /run <command> - Execute a command'));
        console.log(chalk.gray('\n📋 Planning Commands:'));
        console.log(chalk.gray('• /plan <query> - Create a plan for a task'));
        console.log(chalk.gray('• /plans - List all pending plans'));
        console.log(chalk.gray('• /execute <num> - Execute plan by number'));
        console.log(chalk.gray('• /plan-delete <num|all|all-completed> - Delete plans'));
        console.log(chalk.gray('• <number> - Quick shortcut to execute plan by number'));
        console.log(chalk.gray('\n🔌 MCP Server Commands:'));
        console.log(chalk.gray('• /mcp-list - List configured MCP servers'));
        console.log(chalk.gray('• /mcp-add - Add a new MCP server (interactive)'));
        console.log(chalk.gray('• /mcp-remove [name] - Remove an MCP server'));
        console.log(chalk.gray('• /mcp-toggle [name] - Enable/disable an MCP server'));
        console.log(chalk.gray('\n✨ Customization Commands:'));
        console.log(chalk.gray('• /command-add - Create a new custom slash command'));
        console.log(chalk.gray('• /command-list - List all custom commands'));
        console.log(chalk.gray('• /skill-add - Create a new skill'));
        console.log(chalk.gray('• /skill-list - List all available skills'));
        console.log(chalk.gray('\n🔮 Workflow Commands:'));
        console.log(chalk.gray('• /code-audit --path <dir> [--output <path>] [--focus <area>]'));
        console.log(chalk.gray('  Comprehensive code audit for technical debt and security'));
        console.log(chalk.gray('• /test-suite --target <file> [--framework <name>] [--output <path>]'));
        console.log(chalk.gray('  Generate comprehensive test suite'));
        console.log(chalk.gray('• /refactor-analysis --target <file> [--goal <objective>]'));
        console.log(chalk.gray('  Analyze code for refactoring opportunities'));

        // Show custom Claude Code commands if any
        if (claudeConfig.commands.length > 0) {
          console.log(chalk.gray('\n📌 Custom Commands:'));
          claudeConfig.commands.forEach(cmd => {
            console.log(chalk.gray(`• /${cmd.name} - ${cmd.description || 'Custom command'}`));
          });
        }

        // Show available skills if any
        if (claudeConfig.skills.length > 0) {
          console.log(chalk.gray('\n🎯 Available Skills:'));
          claudeConfig.skills.forEach(skill => {
            console.log(chalk.gray(`• ${skill.name} - ${skill.description}`));
          });
          console.log(chalk.gray('  (Say "use <skill>" or "run the <skill> skill" to invoke)'));
        }

        console.log(chalk.gray('\n💡 Ask me anything about development!\n'));
        continue;
      }

      // Handle planning commands
      if (input.startsWith('/plan ')) {
        const query = input.slice(6).trim();
        await handlePlanningMode(agent, query, permissionManager);
        continue;
      }

      if (input === '/plans') {
        await listPlans(planManager);
        continue;
      }

      if (input.startsWith('/execute ')) {
        const arg = input.slice(9).trim();
        await executePlanByRef(arg, agent, permissionManager, planManager);
        continue;
      }

      if (input.startsWith('/plan-delete ')) {
        const arg = input.slice(13).trim();
        await deletePlanByRef(arg, planManager);
        continue;
      }

      // Quick shortcut: just type a number to execute that plan
      if (/^\d+$/.test(input.trim())) {
        const planNum = parseInt(input.trim());
        await executePlanByNumber(planNum, agent, permissionManager, planManager);
        continue;
      }

      // Handle MCP commands
      if (input === '/mcp-list') {
        await handleMcpList();
        continue;
      }

      if (input === '/mcp-add') {
        await handleMcpAdd();
        continue;
      }

      if (input.startsWith('/mcp-remove')) {
        const name = input.slice(11).trim();
        await handleMcpRemove(name);
        continue;
      }

      if (input.startsWith('/mcp-toggle')) {
        const name = input.slice(11).trim();
        await handleMcpToggle(name);
        continue;
      }

      // Handle command/skill creation
      if (input === '/command-add') {
        await handleCommandAdd();
        continue;
      }

      if (input === '/command-list') {
        handleCommandList();
        continue;
      }

      if (input === '/skill-add') {
        await handleSkillAdd();
        continue;
      }

      if (input === '/skill-list') {
        handleSkillList();
        continue;
      }

      // Handle slash commands (including custom Claude Code commands)
      if (input.startsWith('/')) {
        const { command, args, error} = parseSlashCommand(input);

        if (error) {
          console.log(chalk.red(`Error: ${error}`));
          continue;
        }

        // Check for custom Claude Code command first
        const customCmd = getCommand(claudeConfig.commands, command);
        if (customCmd) {
          // Get any positional arguments after the command name
          const inputAfterCommand = input.slice(command.length + 2).trim();
          const positionalArgs = inputAfterCommand.split(/\s+/).filter(Boolean);

          // Expand the command template with arguments
          const expandedPrompt = expandCommand(customCmd, inputAfterCommand);

          console.log(chalk.cyan(`\n📋 Running /${command}...\n`));

          // Send the expanded prompt to the agent
          const spinner = ora('Processing command...').start();
          try {
            const response = agent.query(expandedPrompt);
            spinner.stop();

            for await (const message of response) {
              if (message.type === 'stream_event') {
                const event = (message as any).event;
                if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
                  process.stdout.write(event.delta.text || '');
                } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
                  console.log(chalk.cyan(`\n🔧 Using tool: ${event.content_block.name}`));
                }
              } else if (message.type === 'tool_result') {
                if (verbose) console.log(chalk.gray(`   ↳ Tool completed`));
              }
            }
            console.log('\n');
          } catch (error) {
            spinner.fail('Command failed');
            console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
          }
          continue;
        }

        // List of all possible workflow commands
        const validCommands = [
          'literature-review', 'experiment-log',
          'code-audit', 'test-suite', 'refactor-analysis',
          'invoice-batch', 'contract-review', 'meeting-summary',
          'content-calendar', 'blog-outline', 'campaign-brief',
          'dataset-profile', 'chart-report'
        ];

        if (validCommands.includes(command)) {
          try {
            const workflow = await workflowExecutor.loadWorkflow(command);
            const context = {
              variables: new Map(),
              agent,
              permissionManager: agent.permissionManager
            };

            await workflowExecutor.execute(workflow, args, context);
            continue;
          } catch (error) {
            console.error(chalk.red('Workflow error:'), error instanceof Error ? error.message : String(error));
            continue;
          }
        }

        console.log(chalk.yellow(`Unknown command: /${command}`));
        console.log(chalk.gray('Type /help to see available commands'));
        continue;
      }

      const spinner = ora('Processing...').start();

      try {
        const response = agent.query(input);
        spinner.stop();

        console.log();

        for await (const message of response) {
          // Handle streaming text deltas for real-time output
          if (message.type === 'stream_event') {
            const event = (message as any).event;
            if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
              process.stdout.write(event.delta.text || '');
            } else if (event?.type === 'content_block_start' && event.content_block?.type === 'tool_use') {
              // Show tool being called
              console.log(chalk.cyan(`\n🔧 Using tool: ${event.content_block.name}`));
            }
          } else if (message.type === 'tool_result') {
            // Show tool result summary
            const result = (message as any).content;
            if (verbose && result) {
              console.log(chalk.gray(`   ↳ Tool completed`));
            }
          } else if (message.type === 'result') {
            // Display statistics (verbose mode only)
            if (verbose) {
              const stats = (message as any).content || message;
              if (stats.durationMs) {
                console.log(chalk.gray('\n--- Statistics ---'));
                console.log(chalk.gray(`Duration: ${stats.durationMs}ms`));
                console.log(chalk.gray(`Input tokens: ${stats.inputTokens}`));
                console.log(chalk.gray(`Output tokens: ${stats.outputTokens}`));
                if (stats.cacheReadTokens) console.log(chalk.gray(`Cache read: ${stats.cacheReadTokens}`));
              }
            }
          } else if (message.type === 'system') {
            // System messages (verbose mode only)
            if (verbose) console.log(chalk.blue(`[system] ${(message as any).content || (message as any).subtype || ''}`));
          }
        }

        console.log('\n');
      } catch (error) {
        spinner.fail('Failed to process query');
        console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
      }
    } catch (error) {
      if (error instanceof Error && error.message.includes('User force closed')) {
        console.log(chalk.yellow('\n\n👋 Goodbye!'));
        break;
      }
      console.error(chalk.red('Unexpected error:'), error);
    }
  }
}

// MCP Server management functions
async function handleMcpList() {
  const mcpConfig = new MCPConfigManager();
  await mcpConfig.load();

  console.log(chalk.cyan.bold('\n📦 MCP Servers\n'));
  console.log(mcpConfig.formatServerList());
  console.log(chalk.gray(`\nConfig: ${process.cwd()}/.mcp.json\n`));
}

async function handleMcpAdd() {
  const mcpConfig = new MCPConfigManager();
  await mcpConfig.load();

  console.log(chalk.cyan.bold('\n📦 Add MCP Server\n'));

  // Step 1: Server name
  const { name } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Server name (lowercase, alphanumeric, hyphens):',
      validate: (input: string) => {
        if (!input.trim()) return 'Name is required';
        if (!/^[a-z][a-z0-9-]*$/.test(input)) {
          return 'Name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens';
        }
        if (mcpConfig.getServers()[input]) {
          return 'A server with this name already exists';
        }
        return true;
      }
    }
  ]);

  // Step 2: Transport type
  const { transportType } = await inquirer.prompt([
    {
      type: 'list',
      name: 'transportType',
      message: 'Transport type:',
      choices: [
        { name: 'Stdio (local command)', value: 'stdio' },
        { name: 'HTTP (REST endpoint)', value: 'http' },
        { name: 'SSE (Server-Sent Events)', value: 'sse' },
        { name: 'SDK (in-process module)', value: 'sdk' }
      ]
    }
  ]);

  let serverConfig: MCPServerConfig;

  if (transportType === 'stdio') {
    const { command, args } = await inquirer.prompt([
      {
        type: 'input',
        name: 'command',
        message: 'Command to run:',
        default: 'npx',
        validate: (input: string) => input.trim() ? true : 'Command is required'
      },
      {
        type: 'input',
        name: 'args',
        message: 'Arguments (space-separated):',
        default: '-y @modelcontextprotocol/server-filesystem'
      }
    ]);

    serverConfig = {
      type: 'stdio',
      command: command.trim(),
      args: args.trim() ? args.trim().split(/\s+/) : [],
      enabled: true
    };
  } else if (transportType === 'http' || transportType === 'sse') {
    const { url } = await inquirer.prompt([
      {
        type: 'input',
        name: 'url',
        message: 'Server URL:',
        validate: (input: string) => {
          if (!input.trim()) return 'URL is required';
          try {
            const testUrl = input.replace(/\$\{[^}]+\}/g, 'placeholder');
            new URL(testUrl);
            return true;
          } catch {
            return 'Invalid URL format';
          }
        }
      }
    ]);

    serverConfig = {
      type: transportType,
      url: url.trim(),
      enabled: true
    } as MCPServerConfig;
  } else {
    const { serverModule } = await inquirer.prompt([
      {
        type: 'input',
        name: 'serverModule',
        message: 'Module path:',
        default: './custom-mcp-server.js',
        validate: (input: string) => input.trim() ? true : 'Module path is required'
      }
    ]);

    serverConfig = {
      type: 'sdk',
      serverModule: serverModule.trim(),
      enabled: true
    };
  }

  // Step 3: Optional description
  const { description } = await inquirer.prompt([
    {
      type: 'input',
      name: 'description',
      message: 'Description (optional):'
    }
  ]);

  if (description.trim()) {
    serverConfig.description = description.trim();
  }

  await mcpConfig.addServer(name, serverConfig);
  console.log(chalk.green(`\n✓ Server '${name}' added successfully!\n`));
  console.log(chalk.yellow('Note: Restart the agent to load the new server.\n'));
}

async function handleMcpRemove(name?: string) {
  const mcpConfig = new MCPConfigManager();
  await mcpConfig.load();

  const servers = Object.keys(mcpConfig.getServers());

  if (servers.length === 0) {
    console.log(chalk.yellow('\nNo MCP servers configured.\n'));
    return;
  }

  let serverName = name?.trim();

  if (!serverName) {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select server to remove:',
        choices: servers
      }
    ]);
    serverName = selected;
  }

  if (!servers.includes(serverName!)) {
    console.log(chalk.red(`\nServer '${serverName}' not found.\n`));
    return;
  }

  const { confirm } = await inquirer.prompt([
    {
      type: 'confirm',
      name: 'confirm',
      message: `Remove server '${serverName}'?`,
      default: false
    }
  ]);

  if (confirm) {
    await mcpConfig.removeServer(serverName!);
    console.log(chalk.green(`\n✓ Server '${serverName}' removed.\n`));
  } else {
    console.log(chalk.gray('\nCancelled.\n'));
  }
}

async function handleMcpToggle(name?: string) {
  const mcpConfig = new MCPConfigManager();
  await mcpConfig.load();

  const servers = mcpConfig.getServers();
  const serverNames = Object.keys(servers);

  if (serverNames.length === 0) {
    console.log(chalk.yellow('\nNo MCP servers configured.\n'));
    return;
  }

  let serverName = name?.trim();

  if (!serverName) {
    const { selected } = await inquirer.prompt([
      {
        type: 'list',
        name: 'selected',
        message: 'Select server to toggle:',
        choices: serverNames.map(n => ({
          name: `${n} (${servers[n].enabled !== false ? 'enabled' : 'disabled'})`,
          value: n
        }))
      }
    ]);
    serverName = selected;
  }

  if (!serverNames.includes(serverName!)) {
    console.log(chalk.red(`\nServer '${serverName}' not found.\n`));
    return;
  }

  const wasEnabled = servers[serverName!].enabled !== false;
  await mcpConfig.toggleServer(serverName!);
  console.log(chalk.green(`\n✓ Server '${serverName}' ${wasEnabled ? 'disabled' : 'enabled'}.\n`));
  console.log(chalk.yellow('Note: Restart the agent to apply changes.\n'));
}

// Custom command creation handler
async function handleCommandAdd() {
  console.log(chalk.cyan.bold('\n✨ Create New Slash Command\n'));

  const { name, description, template } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Command name (without /):',
      validate: (input: string) => {
        if (!input.trim()) return 'Name is required';
        if (!/^[a-z][a-z0-9-]*$/.test(input)) {
          return 'Name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      validate: (input: string) => input.trim() ? true : 'Description is required'
    },
    {
      type: 'editor',
      name: 'template',
      message: 'Command template (use $ARGUMENTS for all args, $1, $2 for positional):',
      default: 'Perform the following task:\n\n$ARGUMENTS'
    }
  ]);

  // Create .claude/commands directory if it doesn't exist
  const commandsDir = path.join(workingDir, '.claude', 'commands');
  if (!fs.existsSync(commandsDir)) {
    fs.mkdirSync(commandsDir, { recursive: true });
  }

  // Create the command file
  const content = `---
description: ${description}
---

${template}
`;

  const filePath = path.join(commandsDir, `${name}.md`);
  fs.writeFileSync(filePath, content);

  console.log(chalk.green(`\n✓ Created command /${name}`));
  console.log(chalk.gray(`  File: ${filePath}`));
  console.log(chalk.yellow('\nRestart the agent to use the new command.\n'));

  // Reload the config to pick up the new command
  Object.assign(claudeConfig, loadClaudeConfig(workingDir));
}

function handleCommandList() {
  console.log(chalk.cyan.bold('\n📋 Custom Slash Commands\n'));

  if (claudeConfig.commands.length === 0) {
    console.log(chalk.gray('No custom commands defined.'));
    console.log(chalk.gray('Use /command-add to create one.\n'));
    return;
  }

  claudeConfig.commands.forEach(cmd => {
    console.log(chalk.white(`  /${cmd.name}`));
    console.log(chalk.gray(`    ${cmd.description || 'No description'}`));
    console.log(chalk.gray(`    File: ${cmd.filePath}\n`));
  });
}

// Custom skill creation handler
async function handleSkillAdd() {
  console.log(chalk.cyan.bold('\n🎯 Create New Skill\n'));

  const { name, description, tools, instructions } = await inquirer.prompt([
    {
      type: 'input',
      name: 'name',
      message: 'Skill name:',
      validate: (input: string) => {
        if (!input.trim()) return 'Name is required';
        if (!/^[a-z][a-z0-9-]*$/.test(input)) {
          return 'Name must be lowercase, start with a letter, and contain only letters, numbers, and hyphens';
        }
        return true;
      }
    },
    {
      type: 'input',
      name: 'description',
      message: 'Description:',
      validate: (input: string) => input.trim() ? true : 'Description is required'
    },
    {
      type: 'checkbox',
      name: 'tools',
      message: 'Select tools this skill can use:',
      choices: [
        { name: 'Read files', value: 'Read' },
        { name: 'Write files', value: 'Write' },
        { name: 'Run commands', value: 'Bash' },
        { name: 'Web search', value: 'WebSearch' },
        { name: 'Web fetch', value: 'WebFetch' }
      ],
      default: ['Read']
    },
    {
      type: 'editor',
      name: 'instructions',
      message: 'Skill instructions (what should the agent do when this skill is invoked?):',
      default: '# Skill Instructions\n\nWhen this skill is invoked:\n\n1. First, understand the user\'s request\n2. Apply your expertise to solve the problem\n3. Provide a clear, actionable response'
    }
  ]);

  // Create .claude/skills/<name> directory
  const skillDir = path.join(workingDir, '.claude', 'skills', name);
  if (!fs.existsSync(skillDir)) {
    fs.mkdirSync(skillDir, { recursive: true });
  }

  // Create the SKILL.md file
  const content = `---
description: ${description}
tools: ${tools.join(', ')}
---

${instructions}
`;

  const filePath = path.join(skillDir, 'SKILL.md');
  fs.writeFileSync(filePath, content);

  console.log(chalk.green(`\n✓ Created skill: ${name}`));
  console.log(chalk.gray(`  File: ${filePath}`));
  console.log(chalk.yellow('\nRestart the agent to use the new skill.'));
  console.log(chalk.gray('Invoke it by saying "use ' + name + '" or "run the ' + name + ' skill"\n'));

  // Reload the config to pick up the new skill
  Object.assign(claudeConfig, loadClaudeConfig(workingDir));
}

function handleSkillList() {
  console.log(chalk.cyan.bold('\n🎯 Available Skills\n'));

  if (claudeConfig.skills.length === 0) {
    console.log(chalk.gray('No skills defined.'));
    console.log(chalk.gray('Use /skill-add to create one.\n'));
    return;
  }

  claudeConfig.skills.forEach(skill => {
    console.log(chalk.white(`  ${skill.name}`));
    console.log(chalk.gray(`    ${skill.description}`));
    console.log(chalk.gray(`    Tools: ${skill.tools.join(', ') || 'none'}`));
    console.log(chalk.gray(`    File: ${skill.filePath}\n`));
  });
}


// Planning mode helper functions
async function handlePlanningMode(agent: any, query: string, pm: PermissionManager) {
  const planManager = new PlanManager();

  console.log(chalk.cyan('\n📋 Planning Mode'));
  console.log(chalk.gray('Analyzing: ' + query + '\n'));

  const spinner = ora('Creating plan...').start();

  try {
    // Query the agent in planning mode to analyze and create a plan
    const planPrompt = `You are in PLANNING MODE. Analyze this request and create a structured plan.

REQUEST: ${query}

Create a plan with the following format:
1. A brief summary (1 sentence)
2. Your analysis of what needs to be done
3. Step-by-step actions with risk assessment
4. Rollback strategy if something goes wrong

Output your plan in this exact format:

SUMMARY: [one sentence describing what will be accomplished]

ANALYSIS:
[what you discovered and your approach]

STEPS:
1. [Step Name] | Action: [read/write/edit/command/query] | Target: [file or command] | Purpose: [why] | Risk: [low/medium/high]
2. [Next step...]

ROLLBACK:
- [How to undo if needed]
- [Additional recovery steps]`;

    let planText = '';
    const response = agent.query(planPrompt);

    for await (const message of response) {
      if (message.type === 'stream_event') {
        const event = (message as any).event;
        if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
          planText += event.delta.text || '';
        }
      }
    }

    spinner.stop();

    // Parse the plan response
    const plan = parsePlanResponse(planText, query, planManager);

    // Display plan
    displayPlan(plan);

    // Save plan
    const planPath = await planManager.savePlan(plan);
    console.log(chalk.gray('\nPlan saved: ' + planPath));

    // Prompt for action
    const { action } = await inquirer.prompt([{
      type: 'list',
      name: 'action',
      message: 'What would you like to do?',
      choices: [
        { name: 'Execute now', value: 'execute' },
        { name: 'Edit plan first (opens in editor)', value: 'edit' },
        { name: 'Save for later', value: 'save' },
        { name: 'Discard', value: 'discard' }
      ]
    }]);

    if (action === 'execute') {
      await executePlan(plan, agent, pm, planManager);
    } else if (action === 'edit') {
      console.log(chalk.yellow('\nEdit: ' + planPath));
      console.log(chalk.gray('Then run: /execute ' + planPath));
    } else if (action === 'save') {
      const pending = (await planManager.listPlans()).filter(p => p.plan.status === 'pending').length;
      console.log(chalk.green(`\n✅ Plan saved. You now have ${pending} pending plan(s).`));
      console.log(chalk.cyan('\nTo return to this plan later:'));
      console.log(chalk.gray('  /plans          - List all pending plans'));
      console.log(chalk.gray('  /execute 1      - Execute plan #1'));
      console.log(chalk.gray('  1               - Shortcut: just type the number'));
    } else if (action === 'discard') {
      await planManager.deletePlan(plan.id);
      console.log(chalk.yellow('Plan discarded.'));
    }
  } catch (error) {
    spinner.fail('Failed to create plan');
    console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));
  }
}

function parsePlanResponse(text: string, query: string, planManager: PlanManager): Plan {
  const summaryMatch = text.match(/SUMMARY:\s*(.+?)(?=\n|ANALYSIS:)/s);
  const analysisMatch = text.match(/ANALYSIS:\s*([\s\S]+?)(?=STEPS:|$)/);
  const stepsMatch = text.match(/STEPS:\s*([\s\S]+?)(?=ROLLBACK:|$)/);
  const rollbackMatch = text.match(/ROLLBACK:\s*([\s\S]+?)$/);

  const steps: PlanStep[] = [];
  if (stepsMatch) {
    const stepLines = stepsMatch[1].trim().split('\n').filter(l => l.trim());
    let stepNum = 1;
    for (const line of stepLines) {
      const match = line.match(/\d+\.\s*(.+?)\s*\|\s*Action:\s*(\w+)\s*\|\s*Target:\s*(.+?)\s*\|\s*Purpose:\s*(.+?)\s*\|\s*Risk:\s*(\w+)/i);
      if (match) {
        steps.push({
          id: `step-${stepNum++}`,
          name: match[1].trim(),
          action: match[2].toLowerCase() as PlanStep['action'],
          target: match[3].trim(),
          purpose: match[4].trim(),
          risk: match[5].toLowerCase() as PlanStep['risk'],
          status: 'pending'
        });
      }
    }
  }

  const rollbackStrategy: string[] = [];
  if (rollbackMatch) {
    const rollbackLines = rollbackMatch[1].trim().split('\n');
    for (const line of rollbackLines) {
      const clean = line.replace(/^-\s*/, '').trim();
      if (clean) rollbackStrategy.push(clean);
    }
  }

  const now = new Date();
  const date = now.toISOString().split('T')[0].replace(/-/g, '');
  const time = now.toTimeString().split(' ')[0].replace(/:/g, '').slice(0, 6);

  return {
    id: `plan-${date}-${time}`,
    created: now,
    status: 'pending',
    query,
    summary: summaryMatch?.[1]?.trim() || 'Plan for: ' + query.slice(0, 50),
    analysis: analysisMatch?.[1]?.trim() || '',
    steps,
    rollbackStrategy
  };
}

function displayPlan(plan: Plan) {
  console.log(chalk.cyan.bold('\n📋 Plan Created'));
  console.log(chalk.white('\nSummary: ') + plan.summary);

  if (plan.analysis) {
    console.log(chalk.white('\nAnalysis:'));
    console.log(chalk.gray(plan.analysis));
  }

  console.log(chalk.white('\nSteps:'));
  plan.steps.forEach((step, i) => {
    const riskColor = step.risk === 'high' ? chalk.red : step.risk === 'medium' ? chalk.yellow : chalk.green;
    console.log(chalk.white(`  ${i + 1}. ${step.name}`));
    console.log(chalk.gray(`     Action: ${step.action}`) + (step.target ? chalk.gray(` → ${step.target}`) : ''));
    console.log(chalk.gray(`     Purpose: ${step.purpose}`));
    console.log(`     Risk: ` + riskColor(step.risk));
  });

  if (plan.rollbackStrategy.length > 0) {
    console.log(chalk.white('\nRollback Strategy:'));
    plan.rollbackStrategy.forEach(s => console.log(chalk.gray(`  - ${s}`)));
  }
}

async function executePlan(plan: Plan, agent: any, pm: PermissionManager, planManager: PlanManager) {
  console.log(chalk.cyan('\n⚡ Executing plan: ' + plan.summary));

  await planManager.updateStatus(plan.id, 'executing');

  for (const step of plan.steps) {
    console.log(chalk.white(`\n→ Step ${step.id.replace('step-', '')}: ${step.name}`));

    const spinner = ora(`Executing: ${step.action}`).start();

    try {
      // Execute based on action type
      const stepPrompt = `Execute this step of the plan:
Step: ${step.name}
Action: ${step.action}
Target: ${step.target || 'N/A'}
Purpose: ${step.purpose}

Please execute this step now.`;

      const response = agent.query(stepPrompt);
      spinner.stop();

      for await (const message of response) {
        if (message.type === 'stream_event') {
          const event = (message as any).event;
          if (event?.type === 'content_block_delta' && event.delta?.type === 'text_delta') {
            process.stdout.write(event.delta.text || '');
          }
        }
      }

      await planManager.updateStepStatus(plan.id, step.id, 'completed');
      console.log(chalk.green(`\n✓ Step ${step.id.replace('step-', '')} completed`));
    } catch (error) {
      spinner.fail(`Step ${step.id.replace('step-', '')} failed`);
      await planManager.updateStepStatus(plan.id, step.id, 'failed');
      console.error(chalk.red('Error:'), error instanceof Error ? error.message : String(error));

      const { cont } = await inquirer.prompt([{
        type: 'confirm',
        name: 'cont',
        message: 'Continue with remaining steps?',
        default: false
      }]);

      if (!cont) {
        await planManager.updateStatus(plan.id, 'failed');
        return;
      }
    }
  }

  await planManager.updateStatus(plan.id, 'completed');
  console.log(chalk.green('\n✅ Plan completed successfully!'));
  console.log(chalk.gray('Plan archived. Run /plan-delete all-completed to clean up.'));
}

async function listPlans(planManager: PlanManager) {
  const plans = await planManager.listPlans();

  const pending = plans.filter(p => p.plan.status === 'pending');
  const completed = plans.filter(p => p.plan.status === 'completed');

  if (pending.length === 0 && completed.length === 0) {
    console.log(chalk.gray('\nNo plans found. Use /plan <query> to create one.'));
    return;
  }

  if (pending.length > 0) {
    console.log(chalk.cyan('\n📋 Pending Plans:'));
    pending.forEach((p, i) => {
      const age = formatAge(p.plan.created);
      console.log(chalk.white(`  ${i + 1}. ${p.plan.summary}`));
      console.log(chalk.gray(`     Created ${age} • ${p.plan.steps.length} steps`));
    });
    console.log(chalk.gray('\n  Type a number to execute, or /execute <num>'));
  }

  if (completed.length > 0) {
    console.log(chalk.gray(`\n✅ ${completed.length} completed plan(s) - run /plan-delete all-completed to clean up`));
  }
}

async function executePlanByRef(ref: string, agent: any, pm: PermissionManager, planManager: PlanManager) {
  if (/^\d+$/.test(ref)) {
    await executePlanByNumber(parseInt(ref), agent, pm, planManager);
    return;
  }

  // Assume it's a path
  try {
    const plan = await planManager.loadPlan(ref);
    await executePlan(plan, agent, pm, planManager);
  } catch (error) {
    console.log(chalk.red(`Error loading plan: ${ref}`));
  }
}

async function executePlanByNumber(num: number, agent: any, pm: PermissionManager, planManager: PlanManager) {
  const plans = await planManager.listPlans();
  const pending = plans.filter(p => p.plan.status === 'pending');

  if (num < 1 || num > pending.length) {
    console.log(chalk.red(`Invalid plan number. You have ${pending.length} pending plan(s).`));
    return;
  }

  const planEntry = pending[num - 1];
  await executePlan(planEntry.plan, agent, pm, planManager);
}

async function deletePlanByRef(ref: string, planManager: PlanManager) {
  if (ref === 'all-completed') {
    const deleted = await planManager.deleteCompleted();
    console.log(chalk.green(`\n✅ Deleted ${deleted} completed plan(s).`));
    return;
  }

  if (ref === 'all') {
    const { confirm } = await inquirer.prompt([{
      type: 'confirm',
      name: 'confirm',
      message: 'Delete ALL plans (pending and completed)?',
      default: false
    }]);
    if (confirm) {
      const deleted = await planManager.deleteAll();
      console.log(chalk.green(`\n✅ Deleted ${deleted} plan(s).`));
    }
    return;
  }

  // Delete by number
  if (/^\d+$/.test(ref)) {
    const plans = await planManager.listPlans();
    const pending = plans.filter(p => p.plan.status === 'pending');
    const num = parseInt(ref);
    if (num >= 1 && num <= pending.length) {
      await planManager.deletePlan(pending[num - 1].plan.id);
      console.log(chalk.green('\n✅ Plan deleted.'));
      return;
    }
  }

  // Try as plan ID
  await planManager.deletePlan(ref);
  console.log(chalk.green('\n✅ Plan deleted.'));
}

// Robust signal handling - force exit even with hanging child processes
let isExiting = false;

function handleExit(signal: string) {
  if (isExiting) {
    // Force exit on second signal
    console.log(chalk.red('\n\nForce quitting...'));
    process.exit(1);
  }
  isExiting = true;
  console.log(chalk.yellow(`\n\n👋 Received ${signal}, shutting down...`));

  // Give processes 2 seconds to clean up, then force exit
  setTimeout(() => {
    console.log(chalk.red('Force exit after timeout'));
    process.exit(1);
  }, 2000).unref();

  // Try graceful exit
  process.exit(0);
}

process.on('SIGINT', () => handleExit('SIGINT'));
process.on('SIGTERM', () => handleExit('SIGTERM'));

// Prevent unhandled rejections from hanging
process.on('unhandledRejection', (reason, promise) => {
  console.error(chalk.red('Unhandled Rejection:'), reason);
});

// Read stdin history before parsing commander args (synchronous)
initStdinHistory();
program.parse();