/**
 * Tests for Chat Codemap and Doc Querying Features
 *
 * Tests that the chat mode selection, codemap visualization,
 * and document querying functionality works correctly.
 */

import { describe, it, expect } from 'vitest';
import { getClientScripts } from '../src/site/scripts.js';

describe('Chat Mode Selection', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include chat mode state', () => {
    expect(scripts).toContain("mode: 'auto'");
  });

  it('should handle mode dropdown change', () => {
    expect(scripts).toContain('.chat-mode-dropdown');
    expect(scripts).toContain("chatState.mode = e.target.value");
  });

  it('should show toast when mode changes', () => {
    expect(scripts).toContain("showToast('Switched to '");
  });

  it('should support auto mode', () => {
    expect(scripts).toContain("mode: 'auto'");
    expect(scripts).toContain("Auto mode");
  });

  it('should support chat mode', () => {
    expect(scripts).toContain("chatState.mode === 'chat'");
    expect(scripts).toContain("mode === 'chat'");
  });

  it('should support codemap mode', () => {
    expect(scripts).toContain("chatState.mode === 'codemap'");
    expect(scripts).toContain("mode === 'codemap'");
  });
});

describe('Diagram Type Detection', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include detectDiagramType function', () => {
    expect(scripts).toContain('function detectDiagramType(');
  });

  it('should detect sequence diagrams', () => {
    expect(scripts).toContain("return 'sequence'");
    expect(scripts).toContain('sequence|step|order|process|workflow');
  });

  it('should detect hierarchy diagrams', () => {
    expect(scripts).toContain("return 'hierarchy'");
    expect(scripts).toContain('hierarch|structure|organization|parent|child');
  });

  it('should detect dataflow diagrams', () => {
    expect(scripts).toContain("return 'dataflow'");
    expect(scripts).toContain('data.+flow|transform|input.+output');
  });

  it('should default to flowchart', () => {
    expect(scripts).toContain("return 'flowchart'");
  });
});

describe('Relationship Extraction', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include extractRelationships function', () => {
    expect(scripts).toContain('function extractRelationships(');
  });

  it('should define relationship keywords', () => {
    expect(scripts).toContain("'uses'");
    expect(scripts).toContain("'calls'");
    expect(scripts).toContain("'depends'");
    expect(scripts).toContain("'imports'");
    expect(scripts).toContain("'extends'");
    expect(scripts).toContain("'implements'");
  });

  it('should extract relationship types from content', () => {
    expect(scripts).toContain('relType = kw');
  });

  it('should return array of relationships', () => {
    expect(scripts).toContain('relationships.push');
    expect(scripts).toContain('from: i');
    expect(scripts).toContain('to: j');
    expect(scripts).toContain('type: relType');
  });
});

describe('Codemap Diagram Generation', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include generateCodemapDiagram function', () => {
    expect(scripts).toContain('function generateCodemapDiagram(');
  });

  it('should accept mode parameter', () => {
    expect(scripts).toContain('generateCodemapDiagram(question, context, mode)');
  });

  it('should return null for insufficient context', () => {
    expect(scripts).toContain('context.length < 2');
    expect(scripts).toContain('return null');
  });

  it('should create nodes with score attribute', () => {
    expect(scripts).toContain('score: item.score || 0');
  });

  it('should generate sequence diagram syntax', () => {
    expect(scripts).toContain("diagram = 'sequenceDiagram");
    expect(scripts).toContain('autonumber');
    expect(scripts).toContain('participant');
  });

  it('should generate flowchart diagram syntax', () => {
    expect(scripts).toContain("diagram = 'flowchart TD");
  });

  it('should support subgraphs for many nodes', () => {
    expect(scripts).toContain('subgraph Core');
    expect(scripts).toContain('subgraph Related');
  });

  it('should add edge labels when available', () => {
    expect(scripts).toContain("edge.label && edge.label !== 'uses'");
    expect(scripts).toContain('-->|');
  });

  it('should add click handlers for flowchart nodes', () => {
    expect(scripts).toContain("click ' + node.id");
  });

  it('should return diagram type in result', () => {
    expect(scripts).toContain('type: diagramType');
  });
});

describe('Visualization Decision Logic', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should check mode for visualization decisions', () => {
    expect(scripts).toContain("chatState.mode === 'codemap'");
    expect(scripts).toContain("chatState.mode === 'chat'");
  });

  it('should always show visualization in codemap mode', () => {
    expect(scripts).toContain('Always show visualization in codemap mode');
    expect(scripts).toContain('wantsVisualization = true');
  });

  it('should never show visualization in chat mode', () => {
    expect(scripts).toContain('Never show visualization in chat mode');
    expect(scripts).toContain('wantsVisualization = false');
  });

  it('should detect trace questions in auto mode', () => {
    expect(scripts).toContain('Auto mode: detect based on question');
    expect(scripts).toContain('wantsVisualization = isTraceQ');
  });

  it('should check for sufficient context before generating diagram', () => {
    expect(scripts).toContain('context.length >= 2');
  });
});

describe('Trace Question Detection', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include isTraceQuestion function', () => {
    expect(scripts).toContain('function isTraceQuestion(');
  });

  it('should detect "how does work" questions', () => {
    expect(scripts).toContain('how does .+ work');
  });

  it('should detect "what happens when" questions', () => {
    expect(scripts).toContain('what happens when');
  });

  it('should detect flow-related questions', () => {
    expect(scripts).toContain('trace .+ flow');
    expect(scripts).toContain('show .+ flow');
    expect(scripts).toContain('data flow');
    expect(scripts).toContain('call flow');
  });

  it('should detect step-by-step requests', () => {
    expect(scripts).toContain('walk.* through');
    expect(scripts).toContain('step.* by.* step');
  });

  it('should detect visualization requests', () => {
    expect(scripts).toContain('visualize');
    expect(scripts).toContain('diagram');
  });

  it('should detect architecture questions', () => {
    expect(scripts).toContain('architecture of');
    expect(scripts).toContain('components.* interact');
  });
});

describe('Hub-Spoke Pattern for Codemap Mode', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should use hub-spoke pattern in codemap mode with many nodes', () => {
    expect(scripts).toContain("mode === 'codemap' && nodes.length > 3");
    expect(scripts).toContain('first node as hub');
  });

  it('should fallback to sequential pattern otherwise', () => {
    expect(scripts).toContain('Sequential flow based on relevance order');
  });
});

describe('Relevance-Based Grouping', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should filter nodes by relevance score', () => {
    expect(scripts).toContain('n.score > 0.5');
    expect(scripts).toContain('n.score <= 0.5');
  });

  it('should create high relevance subgraph', () => {
    expect(scripts).toContain('highRelevance');
    expect(scripts).toContain('Core Components');
  });

  it('should create lower relevance subgraph', () => {
    expect(scripts).toContain('lowerRelevance');
    expect(scripts).toContain('Related');
  });
});

describe('Edge Detection and Deduplication', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should track seen edges to prevent duplicates', () => {
    expect(scripts).toContain('seenEdges = new Set()');
    expect(scripts).toContain('seenEdges.has(edgeKey)');
    expect(scripts).toContain('seenEdges.add(edgeKey)');
  });

  it('should create edge key from node IDs', () => {
    expect(scripts).toContain("edgeKey = fromId + '-' + toId");
  });
});

describe('Context Search Relevance', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should include findRelevantContext function', () => {
    expect(scripts).toContain('async function findRelevantContext(');
  });

  it('should use semantic search when embeddings available', () => {
    expect(scripts).toContain('chatState.embedder && chatState.embeddingsIndex');
  });

  it('should calculate embedding for query', () => {
    expect(scripts).toContain("chatState.embedder(question");
    expect(scripts).toContain("pooling: 'mean'");
    expect(scripts).toContain("normalize: true");
  });

  it('should calculate similarity scores', () => {
    expect(scripts).toContain('cosineSimilarity(queryVector, chunk.embedding)');
  });

  it('should sort results by score', () => {
    expect(scripts).toContain('sort((a, b) => b.score - a.score)');
  });

  it('should apply relevance threshold', () => {
    expect(scripts).toContain('chunk.score > 0.3');
  });

  it('should limit results to top matches', () => {
    expect(scripts).toContain('slice(0, 5)');
  });
});

describe('Keyword Search Fallback', () => {
  const scripts = getClientScripts({ aiChat: true, search: true });

  it('should fallback when semantic search has few results', () => {
    expect(scripts).toContain('results.length < 3 && state.searchIndex');
  });

  it('should filter keywords by length', () => {
    expect(scripts).toContain('filter(w => w.length > 2)');
  });

  it('should weight title matches higher', () => {
    expect(scripts).toContain('titleLower.includes(kw)');
    expect(scripts).toContain('score += 3');
  });

  it('should weight content matches', () => {
    expect(scripts).toContain('contentLower.includes(kw)');
    expect(scripts).toContain('score += 1');
  });

  it('should weight heading matches', () => {
    expect(scripts).toContain('page.headings.some');
    expect(scripts).toContain('score += 2');
  });

  it('should avoid duplicate paths', () => {
    expect(scripts).toContain('results.some(r => r.path === page.path)');
  });
});

describe('Response Generation with Diagrams', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should pass mode to generateCodemapDiagram', () => {
    expect(scripts).toContain('generateCodemapDiagram(question, context, chatState.mode)');
  });

  it('should include diagram in response when visualization enabled', () => {
    expect(scripts).toContain('codemapDiagram = generateCodemapDiagram');
  });

  it('should add visual flow header to response', () => {
    expect(scripts).toContain('Visual Flow:');
  });

  it('should wrap diagram in mermaid code block', () => {
    expect(scripts).toContain("```mermaid");
    expect(scripts).toContain('codemapDiagram.diagram');
  });

  it('should include navigation hint for clickable nodes', () => {
    expect(scripts).toContain('Click on any box to navigate');
  });

  it('should return diagram in response object', () => {
    expect(scripts).toContain('diagram: codemapDiagram');
  });
});

describe('Mermaid Rendering in Chat', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should detect mermaid code blocks in content', () => {
    expect(scripts).toContain('mermaid');
  });

  it('should create unique diagram IDs', () => {
    expect(scripts).toContain("diagramId = 'chat-diagram-' + Date.now()");
    // Also includes index for multiple diagrams in one message
    expect(scripts).toContain('mermaidPlaceholders.length');
  });

  it('should schedule mermaid initialization after DOM update', () => {
    expect(scripts).toContain('setTimeout(() => {');
    expect(scripts).toContain('window.mermaid.render');
  });

  it('should handle mermaid rendering errors', () => {
    expect(scripts).toContain('Mermaid render error');
  });

  it('should wrap diagram in styled container', () => {
    expect(scripts).toContain('chat-diagram-container');
  });
});

describe('Browser Compatibility Detection', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should check for WebGPU support', () => {
    expect(scripts).toContain('navigator.gpu');
    expect(scripts).toContain('requestAdapter');
    expect(scripts).toContain('hasWebGPU');
  });

  it('should check for WebAssembly support', () => {
    expect(scripts).toContain('hasWasm');
    expect(scripts).toContain('WebAssembly');
  });

  it('should detect mobile devices', () => {
    expect(scripts).toContain('isMobile');
    expect(scripts).toContain('iPhone|iPad|iPod|Android');
  });

  it('should check available memory', () => {
    expect(scripts).toContain('memoryGB');
    expect(scripts).toContain('navigator.deviceMemory');
  });

  it('should recommend configuration based on capabilities', () => {
    expect(scripts).toContain('getRecommendedConfig');
  });
});

describe('Graceful Degradation', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should detect browser issues', () => {
    expect(scripts).toContain('detectBrowserIssues');
  });

  it('should check localStorage availability', () => {
    expect(scripts).toContain("localStorage.setItem('__test__'");
    expect(scripts).toContain("localStorage.removeItem('__test__'");
    expect(scripts).toContain('Private browsing mode');
  });

  it('should check fetch API support', () => {
    expect(scripts).toContain('window.fetch');
    expect(scripts).toContain('browser is outdated');
  });

  it('should check dynamic imports', () => {
    expect(scripts).toContain("new Function('return import");
    expect(scripts).toContain('Dynamic imports not supported');
  });

  it('should show unsupported notice when needed', () => {
    expect(scripts).toContain('showChatUnsupportedNotice');
    expect(scripts).toContain('Chat Not Available');
  });

  it('should suggest alternatives when chat unavailable', () => {
    expect(scripts).toContain('Use the search feature');
    expect(scripts).toContain('Browse the sidebar navigation');
    expect(scripts).toContain('View the architecture diagrams');
  });
});

describe('Error Recovery', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should handle network errors', () => {
    expect(scripts).toContain('NetworkError');
    expect(scripts).toContain('Failed to fetch');
    expect(scripts).toContain('Network unavailable');
  });

  it('should handle memory errors', () => {
    expect(scripts).toContain('out of memory');
    expect(scripts).toContain('OOM');
    expect(scripts).toContain('Not enough memory');
  });

  it('should handle GPU errors', () => {
    expect(scripts).toContain('WebGPU');
    expect(scripts).toContain('GPU unavailable');
  });

  it('should fallback to search mode on errors', () => {
    expect(scripts).toContain("runtime = 'fallback'");
    expect(scripts).toContain('smart search mode');
  });

  it('should update runtime badge on error', () => {
    expect(scripts).toContain('updateRuntimeBadge');
    expect(scripts).toContain('runtime-error');
  });
});

describe('Inline Document Links', () => {
  const scripts = getClientScripts({ aiChat: true });

  it('should create page lookup map', () => {
    expect(scripts).toContain('pageLookup');
    expect(scripts).toContain('page.title.toLowerCase()');
  });

  it('should convert page references to links', () => {
    expect(scripts).toContain('inline-doc-link');
  });

  it('should avoid linking inside existing elements', () => {
    expect(scripts).toContain("before.includes('<a ')");
    expect(scripts).toContain("before.includes('<code')");
  });

  it('should add hover title to inline links', () => {
    expect(scripts).toContain("title=\"View: '");
  });
});

describe('Feature Flag Integration', () => {
  it('should not include codemap features when aiChat disabled', () => {
    const scripts = getClientScripts({ aiChat: false });

    expect(scripts).not.toContain('generateCodemapDiagram');
    expect(scripts).not.toContain('isTraceQuestion');
    expect(scripts).not.toContain('detectDiagramType');
    expect(scripts).not.toContain('extractRelationships');
  });

  it('should include all codemap features when aiChat enabled', () => {
    const scripts = getClientScripts({ aiChat: true });

    expect(scripts).toContain('generateCodemapDiagram');
    expect(scripts).toContain('isTraceQuestion');
    expect(scripts).toContain('detectDiagramType');
    expect(scripts).toContain('extractRelationships');
  });
});

describe('Codemap Algorithm Tests', () => {
  // Test the core algorithms used in codemap generation

  describe('Trace Pattern Matching', () => {
    const tracePatterns = [
      /how does .+ work/i,
      /what happens when/i,
      /trace .+ flow/i,
      /show .+ flow/i,
      /walk.* through/i,
      /step.* by.* step/i,
      /sequence of/i,
      /data flow/i,
      /call flow/i,
      /explain the flow/i,
      /show me how/i,
      /visualize/i,
      /diagram/i,
      /architecture of/i,
      /components.* interact/i
    ];

    function isTraceQuestion(question: string): boolean {
      return tracePatterns.some(p => p.test(question));
    }

    it('should detect "how does X work" questions', () => {
      expect(isTraceQuestion('How does authentication work?')).toBe(true);
      expect(isTraceQuestion('how does the database work')).toBe(true);
    });

    it('should detect "what happens when" questions', () => {
      expect(isTraceQuestion('What happens when a user logs in?')).toBe(true);
    });

    it('should detect flow requests', () => {
      expect(isTraceQuestion('Show me the data flow')).toBe(true);
      expect(isTraceQuestion('Trace the request flow')).toBe(true);
    });

    it('should detect visualization requests', () => {
      expect(isTraceQuestion('Visualize the architecture')).toBe(true);
      expect(isTraceQuestion('Can you create a diagram?')).toBe(true);
    });

    it('should not match simple questions', () => {
      expect(isTraceQuestion('What is the API?')).toBe(false);
      expect(isTraceQuestion('Where is the config file?')).toBe(false);
    });
  });

  describe('Diagram Type Detection', () => {
    function detectDiagramType(question: string): string {
      const q = question.toLowerCase();

      if (/sequence|step|order|process|workflow|when.+then|after.+before/i.test(q)) {
        return 'sequence';
      }

      if (/hierarch|structure|organization|parent|child|inherit|extends/i.test(q)) {
        return 'hierarchy';
      }

      if (/data.+flow|transform|input.+output|pipeline/i.test(q)) {
        return 'dataflow';
      }

      return 'flowchart';
    }

    it('should detect sequence diagrams', () => {
      expect(detectDiagramType('What is the step by step process?')).toBe('sequence');
      expect(detectDiagramType('Show me the workflow')).toBe('sequence');
      expect(detectDiagramType('What is the order of operations?')).toBe('sequence');
    });

    it('should detect hierarchy diagrams', () => {
      expect(detectDiagramType('What is the class hierarchy?')).toBe('hierarchy');
      expect(detectDiagramType('Show the parent child relationships')).toBe('hierarchy');
      expect(detectDiagramType('What extends what?')).toBe('hierarchy');
    });

    it('should detect dataflow diagrams', () => {
      expect(detectDiagramType('How does data flow through the system?')).toBe('dataflow');
      expect(detectDiagramType('Show the pipeline')).toBe('dataflow');
      expect(detectDiagramType('What is the input output transformation?')).toBe('dataflow');
    });

    it('should default to flowchart', () => {
      expect(detectDiagramType('How do components interact?')).toBe('flowchart');
      expect(detectDiagramType('What is the architecture?')).toBe('flowchart');
    });
  });

  describe('Relevance Scoring', () => {
    function scoreKeywordMatch(
      page: { title: string; content: string; headings: string[] },
      keywords: string[]
    ): number {
      const titleLower = page.title.toLowerCase();
      const contentLower = page.content.toLowerCase();

      let score = 0;
      for (const kw of keywords) {
        if (titleLower.includes(kw)) score += 3;
        if (contentLower.includes(kw)) score += 1;
        if (page.headings.some(h => h.toLowerCase().includes(kw))) score += 2;
      }
      return score;
    }

    it('should prioritize title matches', () => {
      const page = {
        title: 'Authentication',
        content: 'This module handles login',
        headings: ['Overview']
      };

      expect(scoreKeywordMatch(page, ['authentication'])).toBe(3);
      expect(scoreKeywordMatch(page, ['login'])).toBe(1);
    });

    it('should score heading matches', () => {
      const page = {
        title: 'Users',
        content: 'User management',
        headings: ['Authentication Methods']
      };

      expect(scoreKeywordMatch(page, ['authentication'])).toBe(2);
    });

    it('should accumulate scores for multiple matches', () => {
      const page = {
        title: 'Authentication Service',
        content: 'Handles user authentication and login flows',
        headings: ['Authentication Flow']
      };

      // 'authentication' in title (3) + content (1) + heading (2) = 6
      expect(scoreKeywordMatch(page, ['authentication'])).toBe(6);
    });

    it('should handle multiple keywords', () => {
      const page = {
        title: 'User Authentication',
        content: 'Manages user login',
        headings: []
      };

      // 'user' in title (3) + content (1) = 4
      // 'authentication' in title (3) = 3
      expect(scoreKeywordMatch(page, ['user', 'authentication'])).toBe(7);
    });
  });
});
