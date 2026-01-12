/**
 * AST-based Code Chunker
 *
 * Parses code using language-aware AST analysis to create semantically meaningful chunks.
 * Unlike line-based chunking, AST chunking preserves complete code constructs like
 * functions, classes, interfaces, and modules.
 *
 * Features:
 * - Language-aware parsing (TypeScript, JavaScript, Python, C#, Go, Java, etc.)
 * - Extracts semantic units: functions, classes, interfaces, types
 * - Includes context: imports, documentation, dependencies
 * - Provides rich metadata for business domain analysis
 * - Hierarchical chunking (module > class > method)
 */

import * as fs from 'fs';
import * as path from 'path';
import * as ts from 'typescript';

/**
 * Represents a semantic code chunk extracted from AST analysis
 */
export interface ASTChunk {
  /** Unique identifier: filePath:startLine-endLine */
  id: string;
  /** Relative file path */
  filePath: string;
  /** 1-indexed start line */
  startLine: number;
  /** 1-indexed end line */
  endLine: number;
  /** The actual code content */
  content: string;
  /** Programming language */
  language: string;
  /** Type of code construct */
  chunkType: ChunkType;
  /** Name of the construct (function name, class name, etc.) */
  name: string;
  /** Parent construct name if nested (e.g., class name for methods) */
  parentName?: string;
  /** Documentation/JSDoc/docstrings */
  documentation?: string;
  /** What this chunk exports (for modules/classes) */
  exports?: string[];
  /** What this chunk imports/depends on */
  imports?: string[];
  /** Inferred business domain from naming and context */
  domainHints?: DomainHint[];
  /** Hierarchical context path (e.g., "module > class > method") */
  contextPath?: string;
  /** Signature for functions/methods */
  signature?: string;
  /** Whether this is a public API surface */
  isPublicApi?: boolean;
  /** Annotations/decorators on this construct */
  decorators?: string[];
  /** Type information for parameters and return types */
  typeInfo?: TypeInfo;
}

export type ChunkType =
  | 'file'           // Entire file (for small files)
  | 'module'         // Module/namespace declaration
  | 'class'          // Class declaration
  | 'interface'      // Interface/protocol
  | 'type'           // Type alias
  | 'enum'           // Enumeration
  | 'function'       // Standalone function
  | 'method'         // Class method
  | 'constructor'    // Class constructor
  | 'property'       // Class property/field
  | 'constant'       // Constant/configuration
  | 'import-block'   // Import statements block
  | 'export-block'   // Export statements
  | 'config'         // Configuration object
  | 'test'           // Test function/describe block
  | 'hook'           // React hook / lifecycle method
  | 'component'      // UI component (React, Vue, etc.)
  | 'middleware'     // Middleware function
  | 'handler'        // Route handler / event handler
  | 'model'          // Data model / entity
  | 'service'        // Service class/module
  | 'repository'     // Data access layer
  | 'controller'     // Controller (MVC)
  | 'util'           // Utility function
  | 'unknown';       // Fallback

export interface DomainHint {
  /** The domain category */
  category: DomainCategory;
  /** Confidence level (0-1) */
  confidence: number;
  /** Source of the hint (name, comment, decorator, etc.) */
  source: string;
  /** Additional context */
  keywords?: string[];
}

export type DomainCategory =
  | 'authentication'
  | 'authorization'
  | 'user-management'
  | 'data-access'
  | 'api-endpoint'
  | 'business-logic'
  | 'validation'
  | 'error-handling'
  | 'logging'
  | 'caching'
  | 'messaging'
  | 'scheduling'
  | 'file-handling'
  | 'payment'
  | 'notification'
  | 'search'
  | 'analytics'
  | 'configuration'
  | 'testing'
  | 'infrastructure'
  | 'ui-component'
  | 'state-management'
  | 'routing'
  | 'middleware'
  | 'utility'
  | 'unknown';

export interface TypeInfo {
  parameters?: Array<{ name: string; type: string }>;
  returnType?: string;
  generics?: string[];
  extends?: string[];
  implements?: string[];
}

/**
 * Configuration for AST chunking behavior
 */
export interface ASTChunkerConfig {
  /** Maximum chunk size in characters (default: 3000) */
  maxChunkSize?: number;
  /** Minimum chunk size to include (default: 100) */
  minChunkSize?: number;
  /** Include import statements in chunks (default: true) */
  includeImports?: boolean;
  /** Include documentation/comments (default: true) */
  includeDocumentation?: boolean;
  /** Extract domain hints from naming (default: true) */
  extractDomainHints?: boolean;
  /** Preserve hierarchical context (default: true) */
  preserveHierarchy?: boolean;
  /** Chunk nested constructs separately (default: true for large constructs) */
  chunkNestedConstructs?: boolean;
}

const DEFAULT_CONFIG: Required<ASTChunkerConfig> = {
  maxChunkSize: 3000,
  minChunkSize: 100,
  includeImports: true,
  includeDocumentation: true,
  extractDomainHints: true,
  preserveHierarchy: true,
  chunkNestedConstructs: true
};

// Domain keyword mappings for business context inference
const DOMAIN_KEYWORDS: Record<DomainCategory, string[]> = {
  'authentication': ['auth', 'login', 'logout', 'signin', 'signout', 'password', 'credential', 'jwt', 'token', 'oauth', 'sso', 'saml', 'identity', 'session'],
  'authorization': ['permission', 'role', 'policy', 'access', 'authorize', 'acl', 'rbac', 'scope', 'claim', 'grant', 'deny', 'allowed', 'forbidden'],
  'user-management': ['user', 'account', 'profile', 'member', 'registration', 'signup', 'onboard', 'invite', 'team', 'organization'],
  'data-access': ['repository', 'dao', 'query', 'database', 'db', 'sql', 'orm', 'entity', 'schema', 'migration', 'seed', 'connection', 'pool'],
  'api-endpoint': ['endpoint', 'route', 'controller', 'handler', 'request', 'response', 'rest', 'graphql', 'api', 'http', 'get', 'post', 'put', 'delete', 'patch'],
  'business-logic': ['service', 'domain', 'workflow', 'process', 'rule', 'calculation', 'business', 'logic', 'usecase', 'interactor'],
  'validation': ['validate', 'validator', 'schema', 'constraint', 'rule', 'sanitize', 'clean', 'check', 'verify', 'assert'],
  'error-handling': ['error', 'exception', 'catch', 'throw', 'handle', 'fault', 'failure', 'recovery', 'retry', 'fallback'],
  'logging': ['log', 'logger', 'trace', 'debug', 'info', 'warn', 'error', 'audit', 'track', 'telemetry', 'metric', 'monitor'],
  'caching': ['cache', 'redis', 'memcache', 'ttl', 'invalidate', 'store', 'retrieve', 'memo', 'buffer'],
  'messaging': ['queue', 'message', 'event', 'publish', 'subscribe', 'broker', 'kafka', 'rabbitmq', 'bus', 'notification', 'emit', 'listener'],
  'scheduling': ['schedule', 'cron', 'job', 'task', 'timer', 'interval', 'background', 'worker', 'batch', 'recurring'],
  'file-handling': ['file', 'upload', 'download', 'stream', 'blob', 'storage', 's3', 'attachment', 'document', 'media', 'image'],
  'payment': ['payment', 'invoice', 'billing', 'subscription', 'charge', 'refund', 'transaction', 'order', 'cart', 'checkout', 'stripe', 'price'],
  'notification': ['notify', 'notification', 'alert', 'email', 'sms', 'push', 'send', 'template', 'mail'],
  'search': ['search', 'query', 'filter', 'sort', 'index', 'elastic', 'fulltext', 'find', 'lookup', 'autocomplete'],
  'analytics': ['analytics', 'report', 'metric', 'dashboard', 'chart', 'aggregate', 'statistics', 'insight', 'tracking'],
  'configuration': ['config', 'setting', 'option', 'preference', 'environment', 'env', 'constant', 'feature', 'flag', 'toggle'],
  'testing': ['test', 'spec', 'mock', 'stub', 'fixture', 'assert', 'expect', 'describe', 'it', 'beforeEach', 'afterEach'],
  'infrastructure': ['deploy', 'build', 'ci', 'docker', 'kubernetes', 'terraform', 'aws', 'azure', 'gcp', 'infra', 'devops'],
  'ui-component': ['component', 'render', 'view', 'page', 'layout', 'widget', 'modal', 'form', 'button', 'input', 'table', 'list'],
  'state-management': ['state', 'store', 'reducer', 'action', 'dispatch', 'selector', 'context', 'provider', 'atom', 'signal'],
  'routing': ['route', 'router', 'navigate', 'redirect', 'path', 'url', 'link', 'history', 'breadcrumb'],
  'middleware': ['middleware', 'interceptor', 'filter', 'guard', 'pipe', 'transform', 'before', 'after', 'around'],
  'utility': ['util', 'helper', 'common', 'shared', 'lib', 'tool', 'format', 'parse', 'convert', 'transform'],
  'unknown': []
};

/**
 * AST-based code chunker that creates semantically meaningful chunks
 */
export class ASTChunker {
  private config: Required<ASTChunkerConfig>;

  constructor(config: ASTChunkerConfig = {}) {
    this.config = { ...DEFAULT_CONFIG, ...config };
  }

  /**
   * Chunk a file using AST analysis
   */
  async chunkFile(filePath: string, repoPath: string): Promise<ASTChunk[]> {
    const fullPath = path.join(repoPath, filePath);
    const content = fs.readFileSync(fullPath, 'utf-8');
    const ext = path.extname(filePath).toLowerCase();
    const language = this.getLanguage(ext);

    // Route to appropriate parser
    switch (language) {
      case 'typescript':
      case 'javascript':
      case 'tsx':
      case 'jsx':
        return this.chunkTypeScript(filePath, content, language);
      case 'python':
        return this.chunkPython(filePath, content);
      case 'csharp':
        return this.chunkCSharp(filePath, content);
      case 'go':
        return this.chunkGo(filePath, content);
      case 'java':
      case 'kotlin':
        return this.chunkJavaLike(filePath, content, language);
      default:
        // Fallback to pattern-based chunking for other languages
        return this.chunkGeneric(filePath, content, language);
    }
  }

  /**
   * Parse TypeScript/JavaScript using the TypeScript compiler API
   */
  private chunkTypeScript(filePath: string, content: string, language: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Parse with TypeScript compiler
    const sourceFile = ts.createSourceFile(
      filePath,
      content,
      ts.ScriptTarget.Latest,
      true,
      language === 'tsx' || language === 'jsx' ? ts.ScriptKind.TSX : ts.ScriptKind.TS
    );

    // Extract imports block
    const imports = this.extractTypeScriptImports(sourceFile, content, filePath, language);
    if (imports) {
      chunks.push(imports);
    }

    // Process top-level declarations
    const visit = (node: ts.Node, parentName?: string, contextPath?: string) => {
      const chunk = this.processTypeScriptNode(node, sourceFile, content, filePath, language, parentName, contextPath);

      if (chunk) {
        chunks.push(chunk);

        // Process nested constructs (methods in classes, etc.)
        if (this.config.chunkNestedConstructs && this.shouldChunkNested(chunk)) {
          const newContext = contextPath ? `${contextPath} > ${chunk.name}` : chunk.name;
          ts.forEachChild(node, (child: ts.Node) => visit(child, chunk.name, newContext));
        }
      } else if (ts.isSourceFile(node)) {
        // Process top-level children
        ts.forEachChild(node, (child: ts.Node) => visit(child, parentName, contextPath));
      }
    };

    visit(sourceFile);

    // If file is small and we only got imports, chunk the whole file
    if (chunks.length <= 1 && content.length < this.config.maxChunkSize) {
      return [this.createWholeFileChunk(filePath, content, language, chunks[0]?.imports)];
    }

    return this.mergeSmallChunks(chunks, filePath, language);
  }

  /**
   * Process a TypeScript AST node into a chunk
   */
  private processTypeScriptNode(
    node: ts.Node,
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
    language: string,
    parentName?: string,
    contextPath?: string
  ): ASTChunk | null {
    const lines = content.split('\n');
    const startPos = node.getStart(sourceFile);
    const endPos = node.getEnd();
    const { line: startLine } = sourceFile.getLineAndCharacterOfPosition(startPos);
    const { line: endLine } = sourceFile.getLineAndCharacterOfPosition(endPos);

    let chunkType: ChunkType = 'unknown';
    let name = '';
    let documentation: string | undefined;
    let signature: string | undefined;
    let isPublicApi = false;
    let decorators: string[] = [];
    let typeInfo: TypeInfo | undefined;
    let exports: string[] = [];

    // Get leading comments/JSDoc
    const leadingComments = ts.getLeadingCommentRanges(content, node.getFullStart());
    if (leadingComments && leadingComments.length > 0) {
      const lastComment = leadingComments[leadingComments.length - 1];
      documentation = content.slice(lastComment.pos, lastComment.end);
    }

    // Process based on node kind
    if (ts.isClassDeclaration(node)) {
      chunkType = this.inferClassType(node);
      name = node.name?.getText(sourceFile) || 'AnonymousClass';
      isPublicApi = this.hasExportModifier(node);
      decorators = this.getDecorators(node, sourceFile);
      typeInfo = {
        extends: node.heritageClauses
          ?.filter((h: ts.HeritageClause) => h.token === ts.SyntaxKind.ExtendsKeyword)
          .flatMap((h: ts.HeritageClause) => h.types.map((t: ts.ExpressionWithTypeArguments) => t.getText(sourceFile))),
        implements: node.heritageClauses
          ?.filter((h: ts.HeritageClause) => h.token === ts.SyntaxKind.ImplementsKeyword)
          .flatMap((h: ts.HeritageClause) => h.types.map((t: ts.ExpressionWithTypeArguments) => t.getText(sourceFile)))
      };
      exports = this.getClassExports(node, sourceFile);
    } else if (ts.isInterfaceDeclaration(node)) {
      chunkType = 'interface';
      name = node.name.getText(sourceFile);
      isPublicApi = this.hasExportModifier(node);
      typeInfo = {
        extends: node.heritageClauses?.flatMap((h: ts.HeritageClause) => h.types.map((t: ts.ExpressionWithTypeArguments) => t.getText(sourceFile)))
      };
    } else if (ts.isTypeAliasDeclaration(node)) {
      chunkType = 'type';
      name = node.name.getText(sourceFile);
      isPublicApi = this.hasExportModifier(node);
    } else if (ts.isEnumDeclaration(node)) {
      chunkType = 'enum';
      name = node.name.getText(sourceFile);
      isPublicApi = this.hasExportModifier(node);
    } else if (ts.isFunctionDeclaration(node)) {
      chunkType = this.inferFunctionType(node, sourceFile);
      name = node.name?.getText(sourceFile) || 'anonymousFunction';
      isPublicApi = this.hasExportModifier(node);
      signature = this.getFunctionSignature(node, sourceFile);
      typeInfo = this.getFunctionTypeInfo(node, sourceFile);
    } else if (ts.isMethodDeclaration(node)) {
      chunkType = this.inferMethodType(node, sourceFile);
      name = node.name.getText(sourceFile);
      isPublicApi = !this.hasPrivateModifier(node);
      signature = this.getFunctionSignature(node, sourceFile);
      typeInfo = this.getFunctionTypeInfo(node, sourceFile);
      decorators = this.getDecorators(node, sourceFile);
    } else if (ts.isConstructorDeclaration(node)) {
      chunkType = 'constructor';
      name = 'constructor';
      signature = this.getConstructorSignature(node, sourceFile);
      typeInfo = this.getConstructorTypeInfo(node, sourceFile);
    } else if (ts.isVariableStatement(node)) {
      // Handle exported const, React components, etc.
      const declaration = node.declarationList.declarations[0];
      if (declaration && ts.isIdentifier(declaration.name)) {
        name = declaration.name.getText(sourceFile);
        isPublicApi = this.hasExportModifier(node);
        chunkType = this.inferVariableType(declaration, sourceFile);
      } else {
        return null;
      }
    } else if (ts.isModuleDeclaration(node)) {
      chunkType = 'module';
      name = node.name.getText(sourceFile);
      isPublicApi = true;
    } else {
      // Skip other node types
      return null;
    }

    // Extract content with documentation
    let chunkStart = startLine;
    if (documentation && leadingComments) {
      const { line: docLine } = sourceFile.getLineAndCharacterOfPosition(leadingComments[0].pos);
      chunkStart = docLine;
    }

    const chunkContent = lines.slice(chunkStart, endLine + 1).join('\n');

    // Skip if too small
    if (chunkContent.length < this.config.minChunkSize) {
      return null;
    }

    // Infer domain hints
    const domainHints = this.config.extractDomainHints
      ? this.inferDomainHints(name, documentation, decorators, chunkContent)
      : undefined;

    return {
      id: `${filePath}:${chunkStart + 1}-${endLine + 1}`,
      filePath,
      startLine: chunkStart + 1,
      endLine: endLine + 1,
      content: chunkContent,
      language,
      chunkType,
      name,
      parentName,
      documentation,
      exports: exports.length > 0 ? exports : undefined,
      domainHints: domainHints && domainHints.length > 0 ? domainHints : undefined,
      contextPath,
      signature,
      isPublicApi,
      decorators: decorators.length > 0 ? decorators : undefined,
      typeInfo
    };
  }

  /**
   * Extract import statements as a single chunk
   */
  private extractTypeScriptImports(
    sourceFile: ts.SourceFile,
    content: string,
    filePath: string,
    language: string
  ): ASTChunk | null {
    const imports: string[] = [];
    const lines = content.split('\n');
    let startLine = -1;
    let endLine = -1;

    ts.forEachChild(sourceFile, node => {
      if (ts.isImportDeclaration(node)) {
        const { line: start } = sourceFile.getLineAndCharacterOfPosition(node.getStart(sourceFile));
        const { line: end } = sourceFile.getLineAndCharacterOfPosition(node.getEnd());

        if (startLine === -1) startLine = start;
        endLine = end;

        // Extract import source
        const moduleSpecifier = node.moduleSpecifier;
        if (ts.isStringLiteral(moduleSpecifier)) {
          imports.push(moduleSpecifier.text);
        }
      }
    });

    if (startLine === -1) return null;

    const importContent = lines.slice(startLine, endLine + 1).join('\n');

    return {
      id: `${filePath}:${startLine + 1}-${endLine + 1}`,
      filePath,
      startLine: startLine + 1,
      endLine: endLine + 1,
      content: importContent,
      language,
      chunkType: 'import-block',
      name: 'imports',
      imports
    };
  }

  /**
   * Infer the type of a class from decorators, name, and heritage
   */
  private inferClassType(node: ts.ClassDeclaration): ChunkType {
    const name = node.name?.getText() || '';
    const nameLower = name.toLowerCase();

    // Check decorators (NestJS, Angular, etc.)
    const decorators = ts.getDecorators(node);
    if (decorators) {
      for (const decorator of decorators) {
        const decoratorName = decorator.expression.getText().split('(')[0];
        if (decoratorName === 'Controller') return 'controller';
        if (decoratorName === 'Injectable' || decoratorName === 'Service') return 'service';
        if (decoratorName === 'Entity' || decoratorName === 'Model') return 'model';
        if (decoratorName === 'Component') return 'component';
        if (decoratorName === 'Middleware') return 'middleware';
      }
    }

    // Check naming patterns
    if (nameLower.endsWith('controller')) return 'controller';
    if (nameLower.endsWith('service')) return 'service';
    if (nameLower.endsWith('repository') || nameLower.endsWith('repo')) return 'repository';
    if (nameLower.endsWith('model') || nameLower.endsWith('entity')) return 'model';
    if (nameLower.endsWith('middleware')) return 'middleware';
    if (nameLower.endsWith('handler')) return 'handler';
    if (nameLower.endsWith('component')) return 'component';

    return 'class';
  }

  /**
   * Infer function type from name and decorators
   */
  private inferFunctionType(node: ts.FunctionDeclaration, sourceFile: ts.SourceFile): ChunkType {
    const name = node.name?.getText(sourceFile) || '';
    const nameLower = name.toLowerCase();

    // Check for React hooks
    if (nameLower.startsWith('use') && nameLower.length > 3) {
      return 'hook';
    }

    // Check for test functions
    if (nameLower.startsWith('test') || nameLower.startsWith('it') || nameLower.includes('spec')) {
      return 'test';
    }

    // Check for handlers
    if (nameLower.includes('handler') || nameLower.includes('handle')) {
      return 'handler';
    }

    // Check for middleware patterns
    if (nameLower.includes('middleware') || (node.parameters.length === 3)) {
      const params = node.parameters.map((p: ts.ParameterDeclaration) => p.name.getText(sourceFile).toLowerCase());
      if (params.includes('req') && params.includes('res') && (params.includes('next') || params.length === 3)) {
        return 'middleware';
      }
    }

    return 'function';
  }

  /**
   * Infer method type from name and context
   */
  private inferMethodType(node: ts.MethodDeclaration, sourceFile: ts.SourceFile): ChunkType {
    const name = node.name.getText(sourceFile).toLowerCase();

    // Lifecycle methods
    if (['constructor', 'ngOnInit', 'ngOnDestroy', 'componentDidMount', 'componentWillUnmount', 'render'].includes(name)) {
      return 'hook';
    }

    // Check decorators for route handlers
    const decorators = ts.getDecorators(node);
    if (decorators) {
      for (const decorator of decorators) {
        const decoratorName = decorator.expression.getText().split('(')[0];
        if (['Get', 'Post', 'Put', 'Delete', 'Patch', 'HttpGet', 'HttpPost'].includes(decoratorName)) {
          return 'handler';
        }
      }
    }

    return 'method';
  }

  /**
   * Infer variable declaration type (component, constant, config, etc.)
   */
  private inferVariableType(declaration: ts.VariableDeclaration, sourceFile: ts.SourceFile): ChunkType {
    const name = declaration.name.getText(sourceFile);
    const nameLower = name.toLowerCase();
    const initializer = declaration.initializer;

    // React component (arrow function or function expression)
    if (initializer) {
      if (ts.isArrowFunction(initializer) || ts.isFunctionExpression(initializer)) {
        // Check if returns JSX
        if (name[0] === name[0].toUpperCase() && name.length > 1) {
          // PascalCase - likely a component
          return 'component';
        }
        // Check for hook pattern
        if (nameLower.startsWith('use')) {
          return 'hook';
        }
        return 'function';
      }

      // Configuration object
      if (ts.isObjectLiteralExpression(initializer)) {
        if (nameLower.includes('config') || nameLower.includes('options') || nameLower.includes('settings')) {
          return 'config';
        }
      }
    }

    // All-caps = constant
    if (name === name.toUpperCase()) {
      return 'constant';
    }

    return 'constant';
  }

  /**
   * Get function signature
   */
  private getFunctionSignature(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): string {
    const params = node.parameters.map((p: ts.ParameterDeclaration) => {
      const name = p.name.getText(sourceFile);
      const type = p.type ? `: ${p.type.getText(sourceFile)}` : '';
      const optional = p.questionToken ? '?' : '';
      return `${name}${optional}${type}`;
    }).join(', ');

    const returnType = node.type ? `: ${node.type.getText(sourceFile)}` : '';
    const name = ts.isFunctionDeclaration(node) && node.name
      ? node.name.getText(sourceFile)
      : ts.isMethodDeclaration(node)
        ? node.name.getText(sourceFile)
        : '';

    return `${name}(${params})${returnType}`;
  }

  /**
   * Get constructor signature
   */
  private getConstructorSignature(node: ts.ConstructorDeclaration, sourceFile: ts.SourceFile): string {
    const params = node.parameters.map((p: ts.ParameterDeclaration) => {
      const name = p.name.getText(sourceFile);
      const type = p.type ? `: ${p.type.getText(sourceFile)}` : '';
      return `${name}${type}`;
    }).join(', ');

    return `constructor(${params})`;
  }

  /**
   * Get function type information
   */
  private getFunctionTypeInfo(node: ts.FunctionLikeDeclaration, sourceFile: ts.SourceFile): TypeInfo {
    return {
      parameters: node.parameters.map((p: ts.ParameterDeclaration) => ({
        name: p.name.getText(sourceFile),
        type: p.type?.getText(sourceFile) || 'any'
      })),
      returnType: node.type?.getText(sourceFile),
      generics: node.typeParameters?.map((t: ts.TypeParameterDeclaration) => t.getText(sourceFile))
    };
  }

  /**
   * Get constructor type information
   */
  private getConstructorTypeInfo(node: ts.ConstructorDeclaration, sourceFile: ts.SourceFile): TypeInfo {
    return {
      parameters: node.parameters.map((p: ts.ParameterDeclaration) => ({
        name: p.name.getText(sourceFile),
        type: p.type?.getText(sourceFile) || 'any'
      }))
    };
  }

  /**
   * Get decorators from a node
   */
  private getDecorators(node: ts.Node, sourceFile: ts.SourceFile): string[] {
    const decorators = ts.getDecorators(node as ts.HasDecorators);
    if (!decorators) return [];
    return decorators.map((d: ts.Decorator) => d.expression.getText(sourceFile));
  }

  /**
   * Get exported members from a class
   */
  private getClassExports(node: ts.ClassDeclaration, sourceFile: ts.SourceFile): string[] {
    const exports: string[] = [];
    node.members.forEach((member: ts.ClassElement) => {
      if (ts.isMethodDeclaration(member) || ts.isPropertyDeclaration(member)) {
        if (!this.hasPrivateModifier(member)) {
          exports.push(member.name.getText(sourceFile));
        }
      }
    });
    return exports;
  }

  /**
   * Check if node has export modifier
   */
  private hasExportModifier(node: ts.Node): boolean {
    const modifiers = ts.getModifiers(node as ts.HasModifiers);
    return modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.ExportKeyword) || false;
  }

  /**
   * Check if node has private modifier
   */
  private hasPrivateModifier(node: ts.Node): boolean {
    const modifiers = ts.getModifiers(node as ts.HasModifiers);
    return modifiers?.some((m: ts.Modifier) => m.kind === ts.SyntaxKind.PrivateKeyword) || false;
  }

  /**
   * Determine if nested constructs should be chunked separately
   */
  private shouldChunkNested(chunk: ASTChunk): boolean {
    // Large classes should have methods chunked separately
    return chunk.content.length > this.config.maxChunkSize * 0.7 &&
           ['class', 'service', 'controller', 'component', 'model'].includes(chunk.chunkType);
  }

  /**
   * Infer domain hints from naming, documentation, and content
   */
  private inferDomainHints(
    name: string,
    documentation: string | undefined,
    decorators: string[],
    content: string
  ): DomainHint[] {
    const hints: DomainHint[] = [];
    const searchText = `${name} ${documentation || ''} ${decorators.join(' ')} ${content}`.toLowerCase();

    for (const [category, keywords] of Object.entries(DOMAIN_KEYWORDS)) {
      if (category === 'unknown') continue;

      const matchedKeywords: string[] = [];
      let score = 0;

      for (const keyword of keywords) {
        if (searchText.includes(keyword)) {
          matchedKeywords.push(keyword);

          // Higher score for name matches
          if (name.toLowerCase().includes(keyword)) {
            score += 3;
          } else if (documentation?.toLowerCase().includes(keyword)) {
            score += 2;
          } else {
            score += 1;
          }
        }
      }

      if (matchedKeywords.length > 0) {
        const confidence = Math.min(score / 10, 1);
        hints.push({
          category: category as DomainCategory,
          confidence,
          source: matchedKeywords.length > 0 && name.toLowerCase().includes(matchedKeywords[0])
            ? 'name'
            : documentation?.toLowerCase().includes(matchedKeywords[0])
              ? 'documentation'
              : 'content',
          keywords: matchedKeywords
        });
      }
    }

    // Sort by confidence descending
    hints.sort((a, b) => b.confidence - a.confidence);

    // Return top 3 most confident hints
    return hints.slice(0, 3);
  }

  /**
   * Create a whole-file chunk for small files
   */
  private createWholeFileChunk(
    filePath: string,
    content: string,
    language: string,
    imports?: string[]
  ): ASTChunk {
    const lines = content.split('\n');
    const name = path.basename(filePath, path.extname(filePath));

    return {
      id: `${filePath}:1-${lines.length}`,
      filePath,
      startLine: 1,
      endLine: lines.length,
      content,
      language,
      chunkType: 'file',
      name,
      imports,
      domainHints: this.inferDomainHints(name, undefined, [], content)
    };
  }

  /**
   * Merge small adjacent chunks to avoid too many tiny chunks
   */
  private mergeSmallChunks(chunks: ASTChunk[], filePath: string, language: string): ASTChunk[] {
    if (chunks.length <= 1) return chunks;

    const result: ASTChunk[] = [];
    let pendingChunks: ASTChunk[] = [];
    let pendingSize = 0;

    for (const chunk of chunks) {
      if (chunk.content.length >= this.config.minChunkSize * 2) {
        // Large enough chunk - flush pending and add this one
        if (pendingChunks.length > 0) {
          result.push(this.mergePendingChunks(pendingChunks, filePath, language));
          pendingChunks = [];
          pendingSize = 0;
        }
        result.push(chunk);
      } else {
        // Small chunk - accumulate
        pendingChunks.push(chunk);
        pendingSize += chunk.content.length;

        // If accumulated enough, merge and add
        if (pendingSize >= this.config.minChunkSize * 2) {
          result.push(this.mergePendingChunks(pendingChunks, filePath, language));
          pendingChunks = [];
          pendingSize = 0;
        }
      }
    }

    // Flush any remaining
    if (pendingChunks.length > 0) {
      result.push(this.mergePendingChunks(pendingChunks, filePath, language));
    }

    return result;
  }

  /**
   * Merge pending chunks into one
   */
  private mergePendingChunks(chunks: ASTChunk[], filePath: string, language: string): ASTChunk {
    if (chunks.length === 1) return chunks[0];

    const startLine = Math.min(...chunks.map(c => c.startLine));
    const endLine = Math.max(...chunks.map(c => c.endLine));
    const content = chunks.map(c => c.content).join('\n\n');
    const names = chunks.map(c => c.name).join(', ');
    const allDomainHints = chunks.flatMap(c => c.domainHints || []);

    return {
      id: `${filePath}:${startLine}-${endLine}`,
      filePath,
      startLine,
      endLine,
      content,
      language,
      chunkType: 'file',
      name: names,
      domainHints: allDomainHints.slice(0, 3)
    };
  }

  /**
   * Pattern-based Python chunking
   */
  private chunkPython(filePath: string, content: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Patterns for Python constructs
    const classPattern = /^class\s+(\w+).*?:/;
    const funcPattern = /^(?:async\s+)?def\s+(\w+)\s*\(/;
    const decoratorPattern = /^@(\w+)/;

    let currentChunk: { start: number; name: string; type: ChunkType; decorators: string[] } | null = null;
    let decorators: string[] = [];
    let indentLevel = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trimStart();
      const currentIndent = line.length - trimmed.length;

      // Check for decorator
      const decoratorMatch = trimmed.match(decoratorPattern);
      if (decoratorMatch) {
        decorators.push(decoratorMatch[1]);
        continue;
      }

      // Check for class definition
      const classMatch = trimmed.match(classPattern);
      if (classMatch) {
        if (currentChunk) {
          chunks.push(this.createPythonChunk(currentChunk, i, lines, filePath, decorators));
        }
        currentChunk = { start: i - decorators.length, name: classMatch[1], type: 'class', decorators };
        indentLevel = currentIndent;
        decorators = [];
        continue;
      }

      // Check for function definition
      const funcMatch = trimmed.match(funcPattern);
      if (funcMatch && currentIndent === 0) {
        if (currentChunk) {
          chunks.push(this.createPythonChunk(currentChunk, i, lines, filePath, decorators));
        }
        currentChunk = { start: i - decorators.length, name: funcMatch[1], type: 'function', decorators };
        indentLevel = currentIndent;
        decorators = [];
      }
    }

    // Finalize last chunk
    if (currentChunk) {
      chunks.push(this.createPythonChunk(currentChunk, lines.length, lines, filePath, []));
    }

    return chunks.length > 0 ? chunks : [this.createWholeFileChunk(filePath, content, 'python')];
  }

  private createPythonChunk(
    chunk: { start: number; name: string; type: ChunkType; decorators: string[] },
    endLine: number,
    lines: string[],
    filePath: string,
    nextDecorators: string[]
  ): ASTChunk {
    // Adjust end line to exclude next decorators
    const actualEnd = endLine - nextDecorators.length;
    const content = lines.slice(chunk.start, actualEnd).join('\n');

    return {
      id: `${filePath}:${chunk.start + 1}-${actualEnd}`,
      filePath,
      startLine: chunk.start + 1,
      endLine: actualEnd,
      content,
      language: 'python',
      chunkType: chunk.type,
      name: chunk.name,
      decorators: chunk.decorators.length > 0 ? chunk.decorators : undefined,
      domainHints: this.inferDomainHints(chunk.name, undefined, chunk.decorators, content)
    };
  }

  /**
   * Pattern-based C# chunking
   */
  private chunkCSharp(filePath: string, content: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Patterns for C# constructs
    const namespacePattern = /^\s*namespace\s+([\w.]+)/;
    const classPattern = /^\s*(?:public|private|internal|protected)?\s*(?:static|abstract|sealed|partial)?\s*class\s+(\w+)/;
    const interfacePattern = /^\s*(?:public|private|internal)?\s*interface\s+(\w+)/;
    const methodPattern = /^\s*(?:public|private|protected|internal)?\s*(?:static|virtual|override|async)?\s*[\w<>[\],\s]+\s+(\w+)\s*\(/;
    const propertyPattern = /^\s*(?:public|private|protected|internal)?\s*(?:static|virtual|override)?\s*[\w<>[\],\s]+\s+(\w+)\s*\{/;

    let braceCount = 0;
    let currentConstruct: { start: number; name: string; type: ChunkType; braceLevel: number } | null = null;
    let constructStack: Array<{ start: number; name: string; type: ChunkType; braceLevel: number }> = [];

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      // Track braces
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Check for new constructs
      let match = line.match(namespacePattern);
      if (match) {
        constructStack.push({ start: i, name: match[1], type: 'module', braceLevel: braceCount });
      }

      match = line.match(classPattern);
      if (match) {
        constructStack.push({ start: i, name: match[1], type: 'class', braceLevel: braceCount });
      }

      match = line.match(interfacePattern);
      if (match) {
        constructStack.push({ start: i, name: match[1], type: 'interface', braceLevel: braceCount });
      }

      match = line.match(methodPattern);
      if (match && !line.includes(';')) {  // Not a method signature only
        constructStack.push({ start: i, name: match[1], type: 'method', braceLevel: braceCount });
      }

      braceCount += openBraces - closeBraces;

      // Check if any constructs are closed
      while (constructStack.length > 0) {
        const top = constructStack[constructStack.length - 1];
        if (braceCount <= top.braceLevel) {
          constructStack.pop();
          const chunkContent = lines.slice(top.start, i + 1).join('\n');
          if (chunkContent.length >= this.config.minChunkSize) {
            chunks.push({
              id: `${filePath}:${top.start + 1}-${i + 1}`,
              filePath,
              startLine: top.start + 1,
              endLine: i + 1,
              content: chunkContent,
              language: 'csharp',
              chunkType: top.type,
              name: top.name,
              domainHints: this.inferDomainHints(top.name, undefined, [], chunkContent)
            });
          }
        } else {
          break;
        }
      }
    }

    return chunks.length > 0 ? chunks : [this.createWholeFileChunk(filePath, content, 'csharp')];
  }

  /**
   * Pattern-based Go chunking
   */
  private chunkGo(filePath: string, content: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Patterns for Go constructs
    const funcPattern = /^func\s+(?:\([\w\s*]+\)\s+)?(\w+)\s*\(/;
    const typePattern = /^type\s+(\w+)\s+(struct|interface)\s*{/;
    const constPattern = /^(?:const|var)\s+\(/;

    let currentChunk: { start: number; name: string; type: ChunkType } | null = null;
    let braceCount = 0;
    let inMultiLineConst = false;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      const trimmed = line.trim();

      // Track braces
      const openBraces = (line.match(/{/g) || []).length;
      const closeBraces = (line.match(/}/g) || []).length;

      // Check for function
      const funcMatch = line.match(funcPattern);
      if (funcMatch && braceCount === 0) {
        if (currentChunk) {
          chunks.push(this.finalizeGoChunk(currentChunk, i, lines, filePath));
        }
        currentChunk = { start: i, name: funcMatch[1], type: 'function' };
      }

      // Check for type definition
      const typeMatch = line.match(typePattern);
      if (typeMatch && braceCount === 0) {
        if (currentChunk) {
          chunks.push(this.finalizeGoChunk(currentChunk, i, lines, filePath));
        }
        currentChunk = {
          start: i,
          name: typeMatch[1],
          type: typeMatch[2] === 'struct' ? 'model' : 'interface'
        };
      }

      braceCount += openBraces - closeBraces;

      // Finalize chunk when braces close
      if (currentChunk && braceCount === 0 && closeBraces > 0) {
        chunks.push(this.finalizeGoChunk(currentChunk, i + 1, lines, filePath));
        currentChunk = null;
      }
    }

    if (currentChunk) {
      chunks.push(this.finalizeGoChunk(currentChunk, lines.length, lines, filePath));
    }

    return chunks.length > 0 ? chunks : [this.createWholeFileChunk(filePath, content, 'go')];
  }

  private finalizeGoChunk(
    chunk: { start: number; name: string; type: ChunkType },
    endLine: number,
    lines: string[],
    filePath: string
  ): ASTChunk {
    const content = lines.slice(chunk.start, endLine).join('\n');
    return {
      id: `${filePath}:${chunk.start + 1}-${endLine}`,
      filePath,
      startLine: chunk.start + 1,
      endLine,
      content,
      language: 'go',
      chunkType: chunk.type,
      name: chunk.name,
      domainHints: this.inferDomainHints(chunk.name, undefined, [], content)
    };
  }

  /**
   * Pattern-based Java/Kotlin chunking
   */
  private chunkJavaLike(filePath: string, content: string, language: string): ASTChunk[] {
    // Similar to C# chunking
    return this.chunkCSharp(filePath, content).map(chunk => ({
      ...chunk,
      language
    }));
  }

  /**
   * Generic pattern-based chunking for unsupported languages
   */
  private chunkGeneric(filePath: string, content: string, language: string): ASTChunk[] {
    const chunks: ASTChunk[] = [];
    const lines = content.split('\n');

    // Generic function patterns
    const patterns = [
      /^(?:export\s+)?(?:async\s+)?function\s+(\w+)/,  // JS/TS function
      /^(?:export\s+)?const\s+(\w+)\s*=/,              // Const assignment
      /^def\s+(\w+)/,                                   // Python
      /^func\s+(\w+)/,                                  // Go
      /^pub\s+fn\s+(\w+)/,                             // Rust
      /^(?:public|private)?\s*(?:static)?\s*\w+\s+(\w+)\s*\(/,  // Java/C#
    ];

    let chunkStart = 0;
    let chunkName = 'module';
    let braceCount = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];

      for (const pattern of patterns) {
        const match = line.match(pattern);
        if (match && braceCount === 0) {
          if (i > chunkStart) {
            const chunkContent = lines.slice(chunkStart, i).join('\n').trim();
            if (chunkContent.length >= this.config.minChunkSize) {
              chunks.push({
                id: `${filePath}:${chunkStart + 1}-${i}`,
                filePath,
                startLine: chunkStart + 1,
                endLine: i,
                content: chunkContent,
                language,
                chunkType: 'function',
                name: chunkName,
                domainHints: this.inferDomainHints(chunkName, undefined, [], chunkContent)
              });
            }
          }
          chunkStart = i;
          chunkName = match[1];
          break;
        }
      }

      braceCount += (line.match(/{/g) || []).length;
      braceCount -= (line.match(/}/g) || []).length;
    }

    // Final chunk
    const finalContent = lines.slice(chunkStart).join('\n').trim();
    if (finalContent.length >= this.config.minChunkSize) {
      chunks.push({
        id: `${filePath}:${chunkStart + 1}-${lines.length}`,
        filePath,
        startLine: chunkStart + 1,
        endLine: lines.length,
        content: finalContent,
        language,
        chunkType: 'function',
        name: chunkName,
        domainHints: this.inferDomainHints(chunkName, undefined, [], finalContent)
      });
    }

    return chunks.length > 0 ? chunks : [this.createWholeFileChunk(filePath, content, language)];
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
      '.mjs': 'javascript',
      '.cjs': 'javascript',
      '.py': 'python',
      '.pyx': 'python',
      '.go': 'go',
      '.rs': 'rust',
      '.java': 'java',
      '.kt': 'kotlin',
      '.scala': 'scala',
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
    };
    return langMap[ext] || 'unknown';
  }
}

/**
 * Convenience function to chunk a single file
 */
export async function chunkFileWithAST(
  filePath: string,
  repoPath: string,
  config?: ASTChunkerConfig
): Promise<ASTChunk[]> {
  const chunker = new ASTChunker(config);
  return chunker.chunkFile(filePath, repoPath);
}

/**
 * Generate a summary of chunk domain hints for embedding enrichment
 */
export function generateDomainContext(chunk: ASTChunk): string {
  const parts: string[] = [];

  // Add type context
  if (chunk.chunkType !== 'unknown' && chunk.chunkType !== 'file') {
    parts.push(`[${chunk.chunkType.toUpperCase()}]`);
  }

  // Add name
  if (chunk.name) {
    parts.push(chunk.name);
  }

  // Add parent context
  if (chunk.parentName) {
    parts.push(`in ${chunk.parentName}`);
  }

  // Add domain hints
  if (chunk.domainHints && chunk.domainHints.length > 0) {
    const domains = chunk.domainHints
      .filter(h => h.confidence > 0.3)
      .map(h => h.category.replace('-', ' '))
      .join(', ');
    if (domains) {
      parts.push(`(${domains})`);
    }
  }

  // Add signature for functions
  if (chunk.signature) {
    parts.push(`- ${chunk.signature}`);
  }

  return parts.join(' ');
}
