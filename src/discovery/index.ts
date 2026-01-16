/**
 * Codebase Discovery Module
 *
 * Analyzes a codebase to discover its logical structure, domains,
 * and relationships. Creates a hierarchical wiki plan that mirrors
 * the actual architecture rather than just file types.
 *
 * Inspired by DeepWiki's approach of deep understanding before generation.
 */

import * as fs from 'fs';
import * as path from 'path';
import { glob } from 'glob';

/**
 * Represents a discovered domain/module in the codebase
 */
export interface DiscoveredDomain {
  /** Unique identifier for the domain */
  id: string;
  /** Human-readable name */
  name: string;
  /** Description of what this domain does */
  description: string;
  /** Business purpose of this domain */
  businessPurpose?: string;
  /** Files that belong to this domain */
  files: string[];
  /** Key components within this domain */
  components: DiscoveredComponent[];
  /** Related domains (by ID) */
  relatedDomains: string[];
  /** Suggested wiki page structure */
  suggestedPages: SuggestedPage[];
  /** Domain category for grouping */
  category: DomainCategory;
  /** Confidence score (0-1) */
  confidence: number;
}

/**
 * Represents a component within a domain
 */
export interface DiscoveredComponent {
  name: string;
  type: ComponentType;
  filePath: string;
  description?: string;
  /** For JCL jobs: the program/utility executed (IDCAMS, IEBGENER, etc.) */
  program?: string;
  /** Brief function description extracted from comments or inferred */
  function?: string;
  dependencies: string[];
  dependents: string[];
}

/**
 * Component types
 */
export type ComponentType =
  | 'entrypoint'
  | 'controller'
  | 'service'
  | 'repository'
  | 'model'
  | 'utility'
  | 'middleware'
  | 'config'
  | 'test'
  | 'script'
  | 'job'
  | 'screen'
  | 'copybook'
  | 'unknown';

/**
 * Domain categories for high-level grouping
 */
export type DomainCategory =
  | 'core-application'
  | 'data-layer'
  | 'presentation'
  | 'integration'
  | 'batch-processing'
  | 'infrastructure'
  | 'documentation'
  | 'testing'
  | 'configuration';

/**
 * Suggested wiki page
 */
export interface SuggestedPage {
  slug: string;
  title: string;
  description: string;
  sourcePaths: string[];
  pageType: 'overview' | 'feature' | 'reference' | 'guide' | 'relationship';
}

/**
 * Relationship between components/domains
 */
export interface DiscoveredRelationship {
  sourceId: string;
  targetId: string;
  type: RelationshipType;
  description: string;
}

export type RelationshipType =
  | 'calls'
  | 'imports'
  | 'includes'
  | 'references'
  | 'data-flow'
  | 'triggers'
  | 'extends';

/**
 * Complete discovery result
 */
export interface DiscoveryResult {
  /** Project metadata */
  project: {
    name: string;
    type: ProjectType;
    technologies: string[];
    description: string;
  };
  /** Discovered domains/modules */
  domains: DiscoveredDomain[];
  /** Relationships between domains */
  relationships: DiscoveredRelationship[];
  /** Hierarchical wiki structure */
  wikiStructure: WikiStructure;
  /** Statistics */
  stats: {
    totalFiles: number;
    totalDomains: number;
    totalRelationships: number;
  };
}

export type ProjectType =
  | 'mainframe-cobol'
  | 'web-application'
  | 'api-service'
  | 'cli-tool'
  | 'library'
  | 'monorepo'
  | 'unknown';

/**
 * Hierarchical wiki structure
 */
export interface WikiStructure {
  sections: WikiSection[];
}

export interface WikiSection {
  id: string;
  title: string;
  description: string;
  pages: SuggestedPage[];
  subsections?: WikiSection[];
}

/**
 * Discovery configuration
 */
export interface DiscoveryConfig {
  /** Repository path */
  repoPath: string;
  /** Target path within repo (optional) */
  targetPath?: string;
  /** Verbose logging */
  verbose?: boolean;
}

/**
 * File pattern configurations for different project types
 */
const FILE_PATTERNS = {
  cobol: {
    programs: '**/*.{cbl,cob,CBL,COB}',
    copybooks: '**/*.{cpy,CPY}',
    jcl: '**/*.{jcl,JCL}',
    bms: '**/*.{bms,BMS}',
    ddl: '**/*.{ddl,DDL,sql,SQL}',
  },
  web: {
    components: '**/*.{tsx,jsx,vue,svelte}',
    services: '**/services/**/*.{ts,js}',
    controllers: '**/controllers/**/*.{ts,js}',
    models: '**/models/**/*.{ts,js}',
    config: '**/config/**/*.{ts,js,json}',
  },
  general: {
    source: '**/*.{ts,tsx,js,jsx,py,java,go,rs,rb,php,cs,cpp,c,h}',
    config: '**/*.{json,yaml,yml,toml,ini}',
    docs: '**/*.{md,rst,txt}',
    scripts: '**/*.{sh,bash,ps1,bat}',
  },
};

/**
 * Domain detection patterns
 */
const DOMAIN_PATTERNS: Array<{
  pattern: RegExp;
  domain: string;
  category: DomainCategory;
  description: string;
}> = [
  // Authentication/Security
  {
    pattern: /auth|login|session|token|jwt|oauth|security|password|credential/i,
    domain: 'authentication',
    category: 'core-application',
    description: 'User authentication and security',
  },
  // User Management
  {
    pattern: /user|profile|account|member|customer/i,
    domain: 'user-management',
    category: 'core-application',
    description: 'User account and profile management',
  },
  // Transaction Processing
  {
    pattern: /transaction|payment|billing|invoice|order|checkout|cart/i,
    domain: 'transaction-processing',
    category: 'core-application',
    description: 'Financial transactions and order processing',
  },
  // Card/Account (Mainframe specific)
  {
    pattern: /card|acct|account|cust|customer/i,
    domain: 'account-management',
    category: 'core-application',
    description: 'Account and card management',
  },
  // Data Access
  {
    pattern: /repository|dao|database|db|query|storage|vsam|file/i,
    domain: 'data-access',
    category: 'data-layer',
    description: 'Data storage and retrieval',
  },
  // Batch Processing
  {
    pattern: /batch|job|scheduler|cron|task|queue/i,
    domain: 'batch-processing',
    category: 'batch-processing',
    description: 'Batch jobs and scheduled tasks',
  },
  // Screen/UI (Mainframe)
  {
    pattern: /screen|map|bms|panel|menu|display/i,
    domain: 'screen-handling',
    category: 'presentation',
    description: 'User interface and screen handling',
  },
  // API/Integration
  {
    pattern: /api|endpoint|route|controller|handler|service/i,
    domain: 'api-services',
    category: 'integration',
    description: 'API endpoints and services',
  },
  // Reports
  {
    pattern: /report|print|output|export/i,
    domain: 'reporting',
    category: 'core-application',
    description: 'Reports and data export',
  },
  // Configuration
  {
    pattern: /config|setting|env|parameter|option/i,
    domain: 'configuration',
    category: 'configuration',
    description: 'System configuration',
  },
  // Testing
  {
    pattern: /test|spec|mock|fixture/i,
    domain: 'testing',
    category: 'testing',
    description: 'Testing and quality assurance',
  },
];

/**
 * CodebaseDiscovery - Analyzes codebases to discover structure and domains
 */
export class CodebaseDiscovery {
  private config: DiscoveryConfig;
  private projectType: ProjectType = 'unknown';
  private fileIndex: Map<string, string[]> = new Map(); // domain -> files
  private componentIndex: Map<string, DiscoveredComponent> = new Map();

  constructor(config: DiscoveryConfig) {
    this.config = config;
  }

  private log(...args: any[]): void {
    if (this.config.verbose) {
      console.log('[Discovery]', ...args);
    }
  }

  /**
   * Run full discovery on the codebase
   */
  async discover(): Promise<DiscoveryResult> {
    console.log('🔍 Starting codebase discovery...\n');

    // Phase 1: Detect project type
    this.projectType = await this.detectProjectType();
    console.log(`  Project type: ${this.projectType}`);

    // Phase 2: Scan and categorize files
    const files = await this.scanFiles();
    console.log(`  Files scanned: ${files.length}`);

    // Phase 3: Analyze file contents and detect domains
    const domains = await this.detectDomains(files);
    console.log(`  Domains discovered: ${domains.length}`);

    // Phase 4: Discover relationships
    const relationships = await this.discoverRelationships(domains);
    console.log(`  Relationships found: ${relationships.length}`);

    // Phase 5: Generate hierarchical wiki structure
    const wikiStructure = this.generateWikiStructure(domains, relationships);
    console.log(`  Wiki sections: ${wikiStructure.sections.length}`);

    // Phase 6: Extract project metadata
    const project = await this.extractProjectMetadata();

    console.log('\n✅ Discovery complete!\n');

    return {
      project,
      domains,
      relationships,
      wikiStructure,
      stats: {
        totalFiles: files.length,
        totalDomains: domains.length,
        totalRelationships: relationships.length,
      },
    };
  }

  /**
   * Detect the project type based on files present
   */
  private async detectProjectType(): Promise<ProjectType> {
    const basePath = this.config.targetPath
      ? path.join(this.config.repoPath, this.config.targetPath)
      : this.config.repoPath;

    // Check for COBOL/Mainframe indicators
    const cobolFiles = await glob('**/*.{cbl,cob,CBL,COB}', {
      cwd: basePath,
      ignore: ['**/node_modules/**'],
    });
    if (cobolFiles.length > 0) {
      return 'mainframe-cobol';
    }

    // Check for web app indicators
    const hasPackageJson = fs.existsSync(path.join(basePath, 'package.json'));
    const hasReactOrVue = await glob('**/*.{tsx,jsx,vue}', {
      cwd: basePath,
      ignore: ['**/node_modules/**'],
    });
    if (hasPackageJson && hasReactOrVue.length > 0) {
      return 'web-application';
    }

    // Check for API service indicators
    const hasRoutes = await glob('**/routes/**/*.{ts,js}', {
      cwd: basePath,
      ignore: ['**/node_modules/**'],
    });
    const hasControllers = await glob('**/controllers/**/*.{ts,js}', {
      cwd: basePath,
      ignore: ['**/node_modules/**'],
    });
    if (hasRoutes.length > 0 || hasControllers.length > 0) {
      return 'api-service';
    }

    // Check for CLI tool indicators
    const hasBin = fs.existsSync(path.join(basePath, 'bin'));
    const hasCliInPackage = hasPackageJson && this.checkPackageJsonForCli(basePath);
    if (hasBin || hasCliInPackage) {
      return 'cli-tool';
    }

    return 'unknown';
  }

  private checkPackageJsonForCli(basePath: string): boolean {
    try {
      const pkgJson = JSON.parse(fs.readFileSync(path.join(basePath, 'package.json'), 'utf-8'));
      return !!pkgJson.bin;
    } catch {
      return false;
    }
  }

  /**
   * Scan all relevant files in the codebase
   */
  private async scanFiles(): Promise<string[]> {
    const basePath = this.config.targetPath
      ? path.join(this.config.repoPath, this.config.targetPath)
      : this.config.repoPath;

    let patterns: string[];

    switch (this.projectType) {
      case 'mainframe-cobol':
        patterns = [
          FILE_PATTERNS.cobol.programs,
          FILE_PATTERNS.cobol.copybooks,
          FILE_PATTERNS.cobol.jcl,
          FILE_PATTERNS.cobol.bms,
          FILE_PATTERNS.cobol.ddl,
          FILE_PATTERNS.general.docs,
          FILE_PATTERNS.general.scripts,
        ];
        break;
      default:
        patterns = [
          FILE_PATTERNS.general.source,
          FILE_PATTERNS.general.config,
          FILE_PATTERNS.general.docs,
          FILE_PATTERNS.general.scripts,
        ];
    }

    const allFiles: string[] = [];
    for (const pattern of patterns) {
      const files = await glob(pattern, {
        cwd: basePath,
        ignore: [
          '**/node_modules/**',
          '**/dist/**',
          '**/build/**',
          '**/.git/**',
          '**/vendor/**',
          '**/__pycache__/**',
        ],
      });
      allFiles.push(...files);
    }

    return [...new Set(allFiles)]; // Deduplicate
  }

  /**
   * Detect domains by analyzing file paths and contents
   */
  private async detectDomains(files: string[]): Promise<DiscoveredDomain[]> {
    const basePath = this.config.targetPath
      ? path.join(this.config.repoPath, this.config.targetPath)
      : this.config.repoPath;

    // Group files by detected domain
    const domainFiles = new Map<string, string[]>();
    const domainMeta = new Map<string, { category: DomainCategory; description: string }>();

    for (const file of files) {
      const matchedDomain = this.matchFileToDomain(file, basePath);
      if (matchedDomain) {
        const existing = domainFiles.get(matchedDomain.domain) || [];
        existing.push(file);
        domainFiles.set(matchedDomain.domain, existing);
        domainMeta.set(matchedDomain.domain, {
          category: matchedDomain.category,
          description: matchedDomain.description,
        });
      }
    }

    // Also group by directory structure for mainframe projects
    if (this.projectType === 'mainframe-cobol') {
      this.groupByDirectoryStructure(files, domainFiles, domainMeta);
    }

    // Convert to DiscoveredDomain objects
    const domains: DiscoveredDomain[] = [];
    for (const [domainId, domainFileList] of domainFiles) {
      const meta = domainMeta.get(domainId) || {
        category: 'core-application' as DomainCategory,
        description: `${domainId} domain`,
      };

      const components = await this.extractComponents(domainFileList, basePath);
      const suggestedPages = this.generateSuggestedPages(domainId, domainFileList, components);

      domains.push({
        id: domainId,
        name: this.formatDomainName(domainId),
        description: meta.description,
        businessPurpose: this.inferBusinessPurpose(domainId, domainFileList),
        files: domainFileList,
        components,
        relatedDomains: [],
        suggestedPages,
        category: meta.category,
        confidence: 0.8,
      });
    }

    // Find related domains
    this.linkRelatedDomains(domains);

    return domains.sort((a, b) => {
      // Sort by category priority then by name
      const categoryOrder: DomainCategory[] = [
        'core-application',
        'presentation',
        'data-layer',
        'batch-processing',
        'integration',
        'configuration',
        'infrastructure',
        'documentation',
        'testing',
      ];
      const aIdx = categoryOrder.indexOf(a.category);
      const bIdx = categoryOrder.indexOf(b.category);
      if (aIdx !== bIdx) return aIdx - bIdx;
      return a.name.localeCompare(b.name);
    });
  }

  /**
   * Match a file to a domain based on patterns
   */
  private matchFileToDomain(
    file: string,
    basePath: string
  ): { domain: string; category: DomainCategory; description: string } | null {
    const fullPath = path.join(basePath, file);
    const fileName = path.basename(file);
    const dirName = path.dirname(file);

    // Try content-based matching for source files
    const ext = path.extname(file).toLowerCase();
    const sourceExts = ['.ts', '.js', '.tsx', '.jsx', '.py', '.java', '.cbl', '.cob'];

    let contentSample = '';
    if (sourceExts.includes(ext)) {
      try {
        contentSample = fs.readFileSync(fullPath, 'utf-8').slice(0, 2000);
      } catch {
        // Ignore read errors
      }
    }

    // Match against domain patterns
    for (const pattern of DOMAIN_PATTERNS) {
      if (
        pattern.pattern.test(fileName) ||
        pattern.pattern.test(dirName) ||
        pattern.pattern.test(contentSample)
      ) {
        return {
          domain: pattern.domain,
          category: pattern.category,
          description: pattern.description,
        };
      }
    }

    // Fallback: categorize by file type
    if (ext === '.cbl' || ext === '.cob') {
      return {
        domain: 'cobol-programs',
        category: 'core-application',
        description: 'COBOL application programs',
      };
    }
    if (ext === '.cpy') {
      return {
        domain: 'copybooks',
        category: 'data-layer',
        description: 'COBOL copybook definitions',
      };
    }
    if (ext === '.jcl') {
      return {
        domain: 'jcl-jobs',
        category: 'batch-processing',
        description: 'JCL batch job definitions',
      };
    }
    if (ext === '.bms') {
      return {
        domain: 'screen-maps',
        category: 'presentation',
        description: 'BMS screen map definitions',
      };
    }
    if (ext === '.ddl' || ext === '.sql') {
      return {
        domain: 'database-schema',
        category: 'data-layer',
        description: 'Database schema definitions',
      };
    }
    if (ext === '.md') {
      return {
        domain: 'documentation',
        category: 'documentation',
        description: 'Project documentation',
      };
    }
    if (ext === '.sh' || ext === '.bash') {
      return {
        domain: 'scripts',
        category: 'infrastructure',
        description: 'Shell scripts and utilities',
      };
    }

    return null;
  }

  /**
   * Group files by directory structure (for mainframe projects)
   */
  private groupByDirectoryStructure(
    files: string[],
    domainFiles: Map<string, string[]>,
    domainMeta: Map<string, { category: DomainCategory; description: string }>
  ): void {
    // Find top-level directories
    const topDirs = new Set<string>();
    for (const file of files) {
      const parts = file.split('/');
      if (parts.length > 1) {
        topDirs.add(parts[0]);
      }
    }

    // Create domain for each significant directory
    for (const dir of topDirs) {
      const dirFiles = files.filter((f) => f.startsWith(dir + '/'));
      if (dirFiles.length >= 3) {
        // Only create domain for dirs with multiple files
        const domainId = `${dir}-module`;
        if (!domainFiles.has(domainId)) {
          domainFiles.set(domainId, dirFiles);
          domainMeta.set(domainId, {
            category: this.inferCategoryFromDir(dir),
            description: `${this.formatDomainName(dir)} module`,
          });
        }
      }
    }
  }

  private inferCategoryFromDir(dir: string): DomainCategory {
    const lower = dir.toLowerCase();
    if (lower.includes('app') || lower.includes('src')) return 'core-application';
    if (lower.includes('sample') || lower.includes('example')) return 'documentation';
    if (lower.includes('test')) return 'testing';
    if (lower.includes('script') || lower.includes('tool')) return 'infrastructure';
    if (lower.includes('doc')) return 'documentation';
    return 'core-application';
  }

  /**
   * Check if a file is documentation/noise that should be excluded from component listings
   */
  private isDocumentationFile(file: string): boolean {
    const fileName = path.basename(file).toLowerCase();
    const ext = path.extname(file).toLowerCase();

    // Documentation file extensions
    const docExtensions = ['.md', '.txt', '.rst', '.adoc', '.pdf', '.doc', '.docx'];
    if (docExtensions.includes(ext)) {
      return true;
    }

    // Common documentation file names
    const docFileNames = [
      'readme', 'license', 'changelog', 'contributing', 'authors',
      'copying', 'todo', 'history', 'news', 'thanks', 'credits',
      'security', 'code_of_conduct', 'codeowners', 'makefile'
    ];
    const baseNameLower = fileName.replace(ext, '');
    if (docFileNames.includes(baseNameLower)) {
      return true;
    }

    // Hidden config files
    if (fileName.startsWith('.')) {
      return true;
    }

    return false;
  }

  /**
   * Extract components from files
   */
  private async extractComponents(
    files: string[],
    basePath: string
  ): Promise<DiscoveredComponent[]> {
    const components: DiscoveredComponent[] = [];

    // Filter out documentation/noise files - only include actual source code
    const sourceFiles = files.filter(f => !this.isDocumentationFile(f));

    for (const file of sourceFiles.slice(0, 100)) {
      // Increased limit for better coverage
      const fullPath = path.join(basePath, file);
      const ext = path.extname(file).toLowerCase();
      const fileName = path.basename(file, ext);

      let type: ComponentType = 'unknown';
      let program: string | undefined;
      let functionDesc: string | undefined;

      // Detect component type
      if (file.includes('controller') || file.includes('handler')) {
        type = 'controller';
      } else if (file.includes('service')) {
        type = 'service';
      } else if (file.includes('repository') || file.includes('dao')) {
        type = 'repository';
      } else if (file.includes('model') || file.includes('entity')) {
        type = 'model';
      } else if (file.includes('util') || file.includes('helper')) {
        type = 'utility';
      } else if (file.includes('middleware')) {
        type = 'middleware';
      } else if (file.includes('config')) {
        type = 'config';
      } else if (file.includes('test') || file.includes('spec')) {
        type = 'test';
      } else if (ext === '.jcl') {
        type = 'job';
        // Extract program and function from JCL content
        const jclInfo = this.extractJclInfo(fullPath, fileName);
        program = jclInfo.program;
        functionDesc = jclInfo.function;
      } else if (ext === '.bms') {
        type = 'screen';
        functionDesc = this.inferBmsFunction(fileName);
      } else if (ext === '.cpy') {
        type = 'copybook';
        functionDesc = this.inferCopybookFunction(fileName);
      } else if (ext === '.sh' || ext === '.bash') {
        type = 'script';
      } else if (ext === '.cbl' || ext === '.cob') {
        type = 'entrypoint';
        functionDesc = this.extractCobolFunction(fullPath, fileName);
      }

      components.push({
        name: fileName,
        type,
        filePath: file,
        description: functionDesc,
        program,
        function: functionDesc,
        dependencies: [],
        dependents: [],
      });
    }

    return components;
  }

  /**
   * Extract program and function from JCL file content
   */
  private extractJclInfo(fullPath: string, fileName: string): { program?: string; function?: string } {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8').toUpperCase();

      // Extract program from EXEC PGM= or EXEC statement
      let program: string | undefined;
      const pgmMatch = content.match(/EXEC\s+PGM=(\w+)/);
      if (pgmMatch) {
        program = pgmMatch[1];
      } else {
        // Check for common utilities
        if (content.includes('IDCAMS')) program = 'IDCAMS';
        else if (content.includes('IEBGENER')) program = 'IEBGENER';
        else if (content.includes('IEFBR14')) program = 'IEFBR14';
        else if (content.includes('SORT')) program = 'SORT';
        else if (content.includes('IKJEFT01')) program = 'IKJEFT01';
        else if (content.includes('DFSRRC00')) program = 'DFSRRC00';
      }

      // Infer function from job name patterns and content
      let functionDesc = this.inferJclFunction(fileName, content);

      return { program, function: functionDesc };
    } catch {
      return { function: this.inferJclFunction(fileName, '') };
    }
  }

  /**
   * Infer JCL job function from name and content patterns
   */
  private inferJclFunction(jobName: string, content: string): string {
    const name = jobName.toUpperCase();

    // Common JCL job name patterns
    const patterns: Array<{ pattern: RegExp; function: string }> = [
      { pattern: /USRSEC|SECURITY|SEC/i, function: 'Load/Manage User Security' },
      { pattern: /DEFGDG|GDG/i, function: 'Setup GDG Bases' },
      { pattern: /ACCTFILE|ACCT/i, function: 'Refresh Account Master' },
      { pattern: /CARDFILE|CARD(?!DEMO)/i, function: 'Refresh Card Master' },
      { pattern: /CUSTFILE|CUST/i, function: 'Refresh Customer Master' },
      { pattern: /DISCGRP|DISCL/i, function: 'Load Disclosure Group File' },
      { pattern: /TRANFILE|TRNFILE/i, function: 'Load Transaction Master' },
      { pattern: /TRANCATG|TRANCAT/i, function: 'Load Transaction Category Types' },
      { pattern: /TRANTYPE|TRNTYPE/i, function: 'Load Transaction Type File' },
      { pattern: /XREFFILE|XREF/i, function: 'Account/Card/Customer Cross Reference' },
      { pattern: /CLOSEFIL|CLOSE/i, function: 'Close VSAM Files in CICS' },
      { pattern: /TCATBALF?|CATBAL/i, function: 'Refresh Transaction Category Balance' },
      { pattern: /LISTCAT/i, function: 'List VSAM Catalog Entries' },
      { pattern: /OPENFIL|OPEN/i, function: 'Open VSAM Files in CICS' },
      { pattern: /READCARD/i, function: 'Read Card Master File' },
      { pattern: /BACKUP|BKP/i, function: 'Backup Data Files' },
      { pattern: /RESTORE|RST/i, function: 'Restore Data Files' },
      { pattern: /LOAD/i, function: 'Initial Data Load' },
      { pattern: /DAILY|DLY/i, function: 'Daily Processing' },
      { pattern: /WEEKLY|WKY/i, function: 'Weekly Processing' },
      { pattern: /MONTHLY|MTH/i, function: 'Monthly Processing' },
      { pattern: /REPORT|RPT/i, function: 'Generate Reports' },
      { pattern: /DELETE|DEL/i, function: 'Delete/Cleanup Records' },
      { pattern: /CREATE|CRT/i, function: 'Create Data Structures' },
    ];

    for (const { pattern, function: func } of patterns) {
      if (pattern.test(name)) {
        return func;
      }
    }

    // Check content for clues
    if (content.includes('DEFINE CLUSTER')) return 'Define VSAM Cluster';
    if (content.includes('REPRO')) return 'Copy/Refresh Data';
    if (content.includes('DELETE')) return 'Delete Data/Files';
    if (content.includes('PRINT')) return 'Print/List Data';

    return 'Batch Job Processing';
  }

  /**
   * Infer BMS screen function from name
   */
  private inferBmsFunction(fileName: string): string {
    const name = fileName.toUpperCase();

    const patterns: Array<{ pattern: RegExp; function: string }> = [
      { pattern: /MENU/i, function: 'Main Menu Screen' },
      { pattern: /SIGNON|LOGIN|LOGON/i, function: 'Sign-on/Login Screen' },
      { pattern: /ACCT/i, function: 'Account Display/Entry Screen' },
      { pattern: /CARD/i, function: 'Card Information Screen' },
      { pattern: /CUST/i, function: 'Customer Information Screen' },
      { pattern: /TRAN/i, function: 'Transaction Entry/Display Screen' },
      { pattern: /REPORT|RPT/i, function: 'Report Display Screen' },
      { pattern: /ADMIN/i, function: 'Administration Screen' },
      { pattern: /HELP/i, function: 'Help Screen' },
      { pattern: /ERROR|ERR/i, function: 'Error Display Screen' },
    ];

    for (const { pattern, function: func } of patterns) {
      if (pattern.test(name)) {
        return func;
      }
    }

    return 'CICS Screen Map';
  }

  /**
   * Infer copybook function from name
   */
  private inferCopybookFunction(fileName: string): string {
    const name = fileName.toUpperCase();

    const patterns: Array<{ pattern: RegExp; function: string }> = [
      { pattern: /ACCT/i, function: 'Account Record Layout' },
      { pattern: /CARD/i, function: 'Card Record Layout' },
      { pattern: /CUST/i, function: 'Customer Record Layout' },
      { pattern: /TRAN/i, function: 'Transaction Record Layout' },
      { pattern: /USER/i, function: 'User Record Layout' },
      { pattern: /XREF/i, function: 'Cross-Reference Layout' },
      { pattern: /COMM|COMMON/i, function: 'Common Data Structures' },
      { pattern: /DATE/i, function: 'Date Handling Structures' },
      { pattern: /ERROR|ERR/i, function: 'Error Handling Structures' },
    ];

    for (const { pattern, function: func } of patterns) {
      if (pattern.test(name)) {
        return func;
      }
    }

    return 'Data Structure Definition';
  }

  /**
   * Extract COBOL program function from content
   */
  private extractCobolFunction(fullPath: string, fileName: string): string {
    try {
      const content = fs.readFileSync(fullPath, 'utf-8');
      const lines = content.split('\n').slice(0, 50); // Check first 50 lines

      // Look for PROGRAM-ID comment or description
      for (const line of lines) {
        // Check for descriptive comments
        if (line.match(/^\s*\*.*(?:PROGRAM|MODULE|ROUTINE).*(?:FOR|TO|:)/i)) {
          const desc = line.replace(/^\s*\*+\s*/, '').trim();
          if (desc.length > 10 && desc.length < 100) {
            return desc;
          }
        }
      }

      // Infer from program name patterns
      return this.inferCobolFunction(fileName);
    } catch {
      return this.inferCobolFunction(fileName);
    }
  }

  /**
   * Infer COBOL program function from name
   */
  private inferCobolFunction(fileName: string): string {
    const name = fileName.toUpperCase();

    const patterns: Array<{ pattern: RegExp; function: string }> = [
      { pattern: /MENU/i, function: 'Main Menu Handler' },
      { pattern: /SIGNON|LOGIN|LOGON/i, function: 'User Sign-on Processing' },
      { pattern: /ACCTVIEW|ACTVW/i, function: 'Account View/Display' },
      { pattern: /ACCTADD|ACTADD/i, function: 'Account Add/Create' },
      { pattern: /ACCTUPD|ACTUPD/i, function: 'Account Update' },
      { pattern: /CARDVIEW|CRDVW/i, function: 'Card View/Display' },
      { pattern: /CARDADD|CRDADD/i, function: 'Card Add/Create' },
      { pattern: /TRANVIEW|TRNVW/i, function: 'Transaction View' },
      { pattern: /TRANADD|TRNADD/i, function: 'Transaction Add' },
      { pattern: /REPORT|RPT/i, function: 'Report Generation' },
      { pattern: /ADMIN/i, function: 'Administration Functions' },
      { pattern: /BATCH|BAT/i, function: 'Batch Processing' },
      { pattern: /UTIL/i, function: 'Utility Functions' },
    ];

    for (const { pattern, function: func } of patterns) {
      if (pattern.test(name)) {
        return func;
      }
    }

    return 'COBOL Program';
  }

  /**
   * Generate suggested wiki pages for a domain
   */
  private generateSuggestedPages(
    domainId: string,
    files: string[],
    components: DiscoveredComponent[]
  ): SuggestedPage[] {
    const pages: SuggestedPage[] = [];
    const domainName = this.formatDomainName(domainId);

    // Always create an overview page
    pages.push({
      slug: `${domainId}.md`,
      title: domainName,
      description: `Overview of the ${domainName} domain`,
      sourcePaths: files.slice(0, 10),
      pageType: 'overview',
    });

    // Create feature pages for significant components
    const significantComponents = components.filter((c) =>
      ['controller', 'service', 'entrypoint', 'job'].includes(c.type)
    );

    for (const comp of significantComponents.slice(0, 5)) {
      pages.push({
        slug: `${domainId}-${comp.name.toLowerCase()}.md`,
        title: `${domainName}: ${comp.name}`,
        description: `Detailed documentation for ${comp.name}`,
        sourcePaths: [comp.filePath],
        pageType: 'feature',
      });
    }

    return pages;
  }

  /**
   * Format domain ID into human-readable name
   */
  private formatDomainName(domainId: string): string {
    return domainId
      .split('-')
      .map((word) => word.charAt(0).toUpperCase() + word.slice(1))
      .join(' ');
  }

  /**
   * Infer business purpose from domain and files
   */
  private inferBusinessPurpose(domainId: string, files: string[]): string {
    const purposes: Record<string, string> = {
      authentication: 'Secure user access and session management',
      'user-management': 'Manage user accounts, profiles, and preferences',
      'transaction-processing': 'Handle financial transactions and order processing',
      'account-management': 'Manage customer accounts and card information',
      'data-access': 'Provide reliable data storage and retrieval',
      'batch-processing': 'Execute scheduled background tasks and reports',
      'screen-handling': 'Present user interface and capture input',
      'api-services': 'Expose functionality via API endpoints',
      reporting: 'Generate business reports and analytics',
      configuration: 'Manage system settings and parameters',
      'cobol-programs': 'Core business logic and processing',
      copybooks: 'Shared data structure definitions',
      'jcl-jobs': 'Batch job execution and scheduling',
      'screen-maps': 'Terminal screen layouts and field definitions',
      'database-schema': 'Database table and relationship definitions',
    };

    return purposes[domainId] || `Supports ${this.formatDomainName(domainId)} functionality`;
  }

  /**
   * Link related domains based on file proximity and naming
   */
  private linkRelatedDomains(domains: DiscoveredDomain[]): void {
    for (const domain of domains) {
      const related: string[] = [];

      for (const other of domains) {
        if (other.id === domain.id) continue;

        // Check for file path overlap
        const overlap = domain.files.some((f1) =>
          other.files.some((f2) => {
            const dir1 = path.dirname(f1);
            const dir2 = path.dirname(f2);
            return dir1 === dir2 || dir1.startsWith(dir2) || dir2.startsWith(dir1);
          })
        );

        // Check for naming similarity
        const nameSimilarity =
          domain.id.includes(other.id.split('-')[0]) || other.id.includes(domain.id.split('-')[0]);

        if (overlap || nameSimilarity) {
          related.push(other.id);
        }
      }

      domain.relatedDomains = related.slice(0, 5);
    }
  }

  /**
   * Discover relationships between domains
   */
  private async discoverRelationships(
    domains: DiscoveredDomain[]
  ): Promise<DiscoveredRelationship[]> {
    const relationships: DiscoveredRelationship[] = [];

    // Create relationships based on domain links
    for (const domain of domains) {
      for (const relatedId of domain.relatedDomains) {
        relationships.push({
          sourceId: domain.id,
          targetId: relatedId,
          type: 'references',
          description: `${domain.name} references ${this.formatDomainName(relatedId)}`,
        });
      }
    }

    // Add data flow relationships
    const dataLayer = domains.find((d) => d.category === 'data-layer');
    const coreApps = domains.filter((d) => d.category === 'core-application');

    if (dataLayer) {
      for (const app of coreApps) {
        relationships.push({
          sourceId: app.id,
          targetId: dataLayer.id,
          type: 'data-flow',
          description: `${app.name} reads/writes data via ${dataLayer.name}`,
        });
      }
    }

    return relationships;
  }

  /**
   * Generate hierarchical wiki structure
   */
  private generateWikiStructure(
    domains: DiscoveredDomain[],
    relationships: DiscoveredRelationship[]
  ): WikiStructure {
    const sections: WikiSection[] = [];

    // Group domains by category
    const byCategory = new Map<DomainCategory, DiscoveredDomain[]>();
    for (const domain of domains) {
      const existing = byCategory.get(domain.category) || [];
      existing.push(domain);
      byCategory.set(domain.category, existing);
    }

    // Create section for each category with domains
    const categoryMeta: Record<DomainCategory, { title: string; description: string }> = {
      'core-application': {
        title: 'Core Application',
        description: 'Main application logic and business processes',
      },
      presentation: {
        title: 'User Interface',
        description: 'Screen handling and user interaction',
      },
      'data-layer': {
        title: 'Data Layer',
        description: 'Data storage, schemas, and access patterns',
      },
      'batch-processing': {
        title: 'Batch Processing',
        description: 'Scheduled jobs and background processing',
      },
      integration: {
        title: 'Integration',
        description: 'External services and API integrations',
      },
      configuration: {
        title: 'Configuration',
        description: 'System configuration and settings',
      },
      infrastructure: {
        title: 'Infrastructure',
        description: 'Deployment scripts and utilities',
      },
      documentation: {
        title: 'Documentation',
        description: 'Project documentation and guides',
      },
      testing: {
        title: 'Testing',
        description: 'Test suites and quality assurance',
      },
    };

    for (const [category, categoryDomains] of byCategory) {
      if (categoryDomains.length === 0) continue;

      const meta = categoryMeta[category];
      const sectionPages: SuggestedPage[] = [];

      // Add overview page for the section
      sectionPages.push({
        slug: `${category}.md`,
        title: meta.title,
        description: meta.description,
        sourcePaths: categoryDomains.flatMap((d) => d.files.slice(0, 5)),
        pageType: 'overview',
      });

      // Add pages from each domain
      for (const domain of categoryDomains) {
        sectionPages.push(...domain.suggestedPages);
      }

      sections.push({
        id: category,
        title: meta.title,
        description: meta.description,
        pages: sectionPages,
      });
    }

    // Add relationship section if we have cross-cutting concerns
    if (relationships.length > 5) {
      sections.push({
        id: 'relationships',
        title: 'System Relationships',
        description: 'How components interact and data flows through the system',
        pages: [
          {
            slug: 'data-flow.md',
            title: 'Data Flow',
            description: 'How data moves through the system',
            sourcePaths: [],
            pageType: 'relationship',
          },
          {
            slug: 'integration-points.md',
            title: 'Integration Points',
            description: 'How modules connect and communicate',
            sourcePaths: [],
            pageType: 'relationship',
          },
        ],
      });
    }

    return { sections };
  }

  /**
   * Extract project metadata
   */
  private async extractProjectMetadata(): Promise<DiscoveryResult['project']> {
    const basePath = this.config.repoPath;

    let name = path.basename(basePath);
    let description = '';
    const technologies: string[] = [];

    // Try to read from package.json
    try {
      const pkgPath = path.join(basePath, 'package.json');
      if (fs.existsSync(pkgPath)) {
        const pkg = JSON.parse(fs.readFileSync(pkgPath, 'utf-8'));
        name = pkg.name || name;
        description = pkg.description || '';
        if (pkg.dependencies) {
          technologies.push(...Object.keys(pkg.dependencies).slice(0, 10));
        }
      }
    } catch {
      // Ignore
    }

    // Try to read from README
    try {
      const readmePath = path.join(basePath, 'README.md');
      if (fs.existsSync(readmePath) && !description) {
        const readme = fs.readFileSync(readmePath, 'utf-8');
        // Extract first paragraph as description
        const firstPara = readme.split('\n\n')[0]?.replace(/^#.*\n/, '').trim();
        if (firstPara && firstPara.length < 500) {
          description = firstPara;
        }
      }
    } catch {
      // Ignore
    }

    // Add technology indicators
    if (this.projectType === 'mainframe-cobol') {
      technologies.push('COBOL', 'CICS', 'JCL', 'VSAM');
    }

    return {
      name,
      type: this.projectType,
      technologies,
      description: description || `${name} project`,
    };
  }
}

/**
 * Generate a hierarchical index.md from discovery results
 */
export function generateHierarchicalIndex(result: DiscoveryResult): string {
  const lines: string[] = [];

  // Header
  lines.push(`# ${result.project.name}`);
  lines.push('');
  lines.push(result.project.description);
  lines.push('');

  // Technology badges
  if (result.project.technologies.length > 0) {
    lines.push(
      '**Technologies:** ' + result.project.technologies.slice(0, 8).join(' • ')
    );
    lines.push('');
  }

  lines.push('---');
  lines.push('');

  // Navigation sections
  for (const section of result.wikiStructure.sections) {
    lines.push(`## ${section.title}`);
    lines.push('');
    lines.push(`> ${section.description}`);
    lines.push('');

    // Pages in this section
    for (const page of section.pages) {
      const icon = getPageIcon(page.pageType);
      lines.push(`- ${icon} [${page.title}](./${page.slug}) – ${page.description}`);
    }
    lines.push('');
  }

  // Quick reference table
  lines.push('---');
  lines.push('');
  lines.push('## Quick Reference');
  lines.push('');
  lines.push('| Domain | Files | Category |');
  lines.push('|--------|-------|----------|');

  for (const domain of result.domains.slice(0, 15)) {
    lines.push(
      `| [${domain.name}](./${domain.id}.md) | ${domain.files.length} | ${domain.category} |`
    );
  }

  lines.push('');
  lines.push('---');
  lines.push('');
  lines.push('*Generated by SemanticWiki with hierarchical discovery*');

  return lines.join('\n');
}

function getPageIcon(pageType: SuggestedPage['pageType']): string {
  switch (pageType) {
    case 'overview':
      return '📚';
    case 'feature':
      return '⚙️';
    case 'reference':
      return '📖';
    case 'guide':
      return '📝';
    case 'relationship':
      return '🔗';
    default:
      return '📄';
  }
}

/**
 * Generate a component summary table for a domain (DeepWiki style)
 * Creates tables like: "Job | Program | Function" for batch jobs
 */
export function generateComponentTable(
  domain: DiscoveredDomain,
  options: { includeFilePath?: boolean } = {}
): string {
  const lines: string[] = [];
  const components = domain.components.filter(c =>
    c.type !== 'unknown' && c.function
  );

  if (components.length === 0) {
    return '';
  }

  // Different table formats based on component types
  const jobs = components.filter(c => c.type === 'job');
  const screens = components.filter(c => c.type === 'screen');
  const copybooks = components.filter(c => c.type === 'copybook');
  const programs = components.filter(c => c.type === 'entrypoint' || c.type === 'service');

  // Batch Components table (JCL jobs)
  if (jobs.length > 0) {
    lines.push('### Batch Components');
    lines.push('');
    lines.push('| Job | Program | Function |');
    lines.push('|-----|---------|----------|');
    for (const job of jobs) {
      const jobName = job.name.toUpperCase();
      const program = job.program || '-';
      const func = job.function || '-';
      lines.push(`| ${jobName} | ${program} | ${func} |`);
    }
    lines.push('');
  }

  // Screen Components table (BMS maps)
  if (screens.length > 0) {
    lines.push('### Screen Components');
    lines.push('');
    lines.push('| Screen | Function |');
    lines.push('|--------|----------|');
    for (const screen of screens) {
      const screenName = screen.name.toUpperCase();
      const func = screen.function || 'Screen Map';
      lines.push(`| ${screenName} | ${func} |`);
    }
    lines.push('');
  }

  // Data Structures table (Copybooks)
  if (copybooks.length > 0) {
    lines.push('### Data Structures');
    lines.push('');
    lines.push('| Copybook | Purpose |');
    lines.push('|----------|---------|');
    for (const copybook of copybooks) {
      const name = copybook.name.toUpperCase();
      const func = copybook.function || 'Data Definition';
      lines.push(`| ${name} | ${func} |`);
    }
    lines.push('');
  }

  // Program Components table
  if (programs.length > 0) {
    lines.push('### Program Components');
    lines.push('');
    lines.push('| Program | Function |');
    lines.push('|---------|----------|');
    for (const program of programs) {
      const name = program.name.toUpperCase();
      const func = program.function || 'Application Logic';
      lines.push(`| ${name} | ${func} |`);
    }
    lines.push('');
  }

  return lines.join('\n');
}

/**
 * Get all component tables for all domains in a discovery result
 */
export function generateAllComponentTables(result: DiscoveryResult): Map<string, string> {
  const tables = new Map<string, string>();

  for (const domain of result.domains) {
    const table = generateComponentTable(domain);
    if (table) {
      tables.set(domain.id, table);
    }
  }

  return tables;
}

export default CodebaseDiscovery;
