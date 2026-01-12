/**
 * Tests for Chat Client Scripts
 *
 * Tests that the chat JavaScript functionality is correctly generated
 * and includes all necessary functions.
 */

import { describe, it, expect } from 'vitest';
import { getClientScripts } from '../src/site/scripts.js';

describe('Chat Client Scripts', () => {
  describe('Script Generation with aiChat enabled', () => {
    const scriptsWithChat = getClientScripts({ aiChat: true });

    it('should include chat initialization function', () => {
      expect(scriptsWithChat).toContain('function initAIChat()');
    });

    it('should include chat state object', () => {
      expect(scriptsWithChat).toContain('const chatState');
      expect(scriptsWithChat).toContain('isModelLoaded');
      expect(scriptsWithChat).toContain('isLoading');
      expect(scriptsWithChat).toContain('generator');
      expect(scriptsWithChat).toContain('embedder');
      expect(scriptsWithChat).toContain('embeddingsIndex');
      expect(scriptsWithChat).toContain('messages');
    });

    it('should call initAIChat in DOMContentLoaded', () => {
      expect(scriptsWithChat).toContain("initAIChat()");
    });
  });

  describe('Script Generation with aiChat disabled', () => {
    const scriptsWithoutChat = getClientScripts({ aiChat: false });

    it('should not include chat initialization when disabled', () => {
      expect(scriptsWithoutChat).not.toContain('function initAIChat()');
    });

    it('should not include chat state when disabled', () => {
      expect(scriptsWithoutChat).not.toContain('const chatState');
    });
  });

  describe('Model Loading Functions', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should include loadAIModel function', () => {
      expect(scripts).toContain('async function loadAIModel()');
    });

    it('should include loadEmbeddingsIndex function', () => {
      expect(scripts).toContain('async function loadEmbeddingsIndex()');
    });

    it('should import transformers.js from CDN', () => {
      expect(scripts).toContain('@huggingface/transformers');
    });

    it('should configure SmolLM2 model', () => {
      expect(scripts).toContain('SmolLM2-135M-Instruct');
    });

    it('should configure embedding model', () => {
      expect(scripts).toContain('all-MiniLM-L6-v2');
    });

    it('should show loading progress', () => {
      expect(scripts).toContain('progress_callback');
      expect(scripts).toContain('loadingText');
    });
  });

  describe('Chat Message Functions', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should include sendChatMessage function', () => {
      expect(scripts).toContain('async function sendChatMessage()');
    });

    it('should include addChatMessage function', () => {
      expect(scripts).toContain('function addChatMessage(');
    });

    it('should include formatChatContent function', () => {
      expect(scripts).toContain('function formatChatContent(');
    });

    it('should include autoResizeTextarea function', () => {
      expect(scripts).toContain('function autoResizeTextarea(');
    });
  });

  describe('Search and Context Functions', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should include findRelevantContext function', () => {
      expect(scripts).toContain('async function findRelevantContext(');
    });

    it('should include cosineSimilarity function', () => {
      expect(scripts).toContain('function cosineSimilarity(');
    });

    it('should include generateResponse function', () => {
      expect(scripts).toContain('async function generateResponse(');
    });
  });

  describe('Event Handling', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should handle panel toggle', () => {
      expect(scripts).toContain("toggleBtn.addEventListener('click'");
      expect(scripts).toContain("collapseBtn?.addEventListener('click'");
    });

    it('should handle input events', () => {
      expect(scripts).toContain("input?.addEventListener('input'");
      expect(scripts).toContain("input?.addEventListener('keydown'");
    });

    it('should handle send button click', () => {
      expect(scripts).toContain("sendBtn?.addEventListener('click'");
    });

    it('should handle suggestion button clicks', () => {
      expect(scripts).toContain("querySelectorAll('.chat-suggestion')");
      expect(scripts).toContain("btn.addEventListener('click'");
    });

    it('should handle Enter key to send', () => {
      expect(scripts).toContain("e.key === 'Enter'");
      expect(scripts).toContain("!e.shiftKey");
    });
  });

  describe('UI State Management', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should toggle chat-open class on body', () => {
      expect(scripts).toContain("document.body.classList.toggle('chat-open')");
    });

    it('should remove chat-open class on close', () => {
      expect(scripts).toContain("classList.remove('chat-open')");
    });

    it('should manage send button disabled state', () => {
      expect(scripts).toContain('sendBtn.disabled');
    });

    it('should hide welcome message after first message', () => {
      expect(scripts).toContain("welcomeEl.style.display = 'none'");
    });
  });

  describe('Streaming Response Indicator', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should create streaming response element', () => {
      expect(scripts).toContain("streaming-indicator");
    });

    it('should include streaming dot and text', () => {
      expect(scripts).toContain('streaming-dot');
      expect(scripts).toContain('streaming-text');
    });

    it('should show thinking state initially', () => {
      expect(scripts).toContain('Thinking...');
    });

    it('should update to generating state', () => {
      expect(scripts).toContain('Generating response...');
    });
  });

  describe('Error Handling', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should handle model loading errors', () => {
      expect(scripts).toContain('catch (error)');
      expect(scripts).toContain('Failed to load AI model');
    });

    it('should have fallback mode when models fail', () => {
      expect(scripts).toContain('fallback');
      expect(scripts).toContain('keyword search');
    });

    it('should handle chat errors gracefully', () => {
      expect(scripts).toContain("Sorry, I encountered an error");
    });
  });

  describe('Semantic Search Implementation', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should check for embeddings availability', () => {
      expect(scripts).toContain('chatState.embedder');
      expect(scripts).toContain('chatState.embeddingsIndex');
    });

    it('should calculate cosine similarity', () => {
      expect(scripts).toContain('cosineSimilarity(queryVector, chunk.embedding)');
    });

    it('should use relevance threshold', () => {
      expect(scripts).toContain('chunk.score > 0.3');
    });

    it('should sort results by score', () => {
      expect(scripts).toContain('sort((a, b) => b.score - a.score)');
    });
  });

  describe('Keyword Search Fallback', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should fallback to keyword search', () => {
      expect(scripts).toContain('state.searchIndex');
    });

    it('should split question into keywords', () => {
      expect(scripts).toContain('questionLower.split');
    });

    it('should score based on title matches', () => {
      expect(scripts).toContain('titleLower.includes(kw)');
    });

    it('should score based on content matches', () => {
      expect(scripts).toContain('contentLower.includes(kw)');
    });

    it('should score based on heading matches', () => {
      expect(scripts).toContain('page.headings.some');
    });
  });

  describe('Response Generation', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should build context from search results', () => {
      expect(scripts).toContain("## ' + c.title");
    });

    it('should include system prompt', () => {
      expect(scripts).toContain('documentation assistant');
      expect(scripts).toContain('Be concise, accurate');
    });

    it('should format prompt with SmolLM2 chat template', () => {
      expect(scripts).toContain('formatChatPrompt');
      expect(scripts).toContain('<|im_start|>');
      expect(scripts).toContain('<|im_end|>');
    });

    it('should include conversation history in prompt', () => {
      expect(scripts).toContain('conversationHistory.slice(-4)');
    });

    it('should configure generation parameters', () => {
      expect(scripts).toContain('max_new_tokens');
      expect(scripts).toContain('temperature');
      expect(scripts).toContain('do_sample');
      expect(scripts).toContain('repetition_penalty');
    });

    it('should handle intelligent fallback response', () => {
      expect(scripts).toContain("generateIntelligentFallback");
      expect(scripts).toContain("Here\\'s what I found");
    });

    it('should provide no-result fallback', () => {
      expect(scripts).toContain("find specific information");
    });
  });

  describe('Message Formatting', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should format paragraphs', () => {
      expect(scripts).toContain("'<p>'");
      expect(scripts).toContain("'</p>'");
    });

    it('should format inline code', () => {
      expect(scripts).toContain('<code>$1</code>');
    });

    it('should format bold text', () => {
      expect(scripts).toContain('<strong>$1</strong>');
    });

    it('should format italic text', () => {
      expect(scripts).toContain('<em>$1</em>');
    });
  });

  describe('Source Links', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should include source links in messages', () => {
      expect(scripts).toContain('chat-message-sources');
    });

    it('should build proper source URLs', () => {
      expect(scripts).toContain("config.rootPath + s.path");
    });

    it('should escape HTML in source titles', () => {
      expect(scripts).toContain('escapeHtml(s.title)');
    });
  });

  describe('Toast Notifications', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should show success toast when model loads', () => {
      expect(scripts).toContain("showToast('AI assistant ready!'");
    });

    it('should show info toast for suggestions before model loads', () => {
      expect(scripts).toContain("showToast('Please wait for the AI model to load'");
    });
  });

  describe('Feature Combinations', () => {
    it('should include chat with other features enabled', () => {
      const scripts = getClientScripts({
        aiChat: true,
        search: true,
        guidedTour: true,
        keyboardNav: true
      });

      expect(scripts).toContain('initAIChat()');
      expect(scripts).toContain('initSearch()');
      expect(scripts).toContain('initTours()');
      expect(scripts).toContain('initKeyboardNav()');
    });

    it('should exclude chat when disabled alongside other features', () => {
      const scripts = getClientScripts({
        aiChat: false,
        search: true,
        guidedTour: true
      });

      expect(scripts).not.toContain('initAIChat()');
      expect(scripts).toContain('initSearch()');
      expect(scripts).toContain('initTours()');
    });
  });

  describe('Configuration Usage', () => {
    const scripts = getClientScripts({ aiChat: true });

    it('should use config.rootPath for embeddings index', () => {
      expect(scripts).toContain("config.rootPath + 'embeddings-index.json'");
    });
  });
});

describe('Cosine Similarity Algorithm', () => {
  // Test the mathematical correctness of cosine similarity
  // This tests the algorithm logic that's embedded in the scripts

  function cosineSimilarity(a: number[], b: number[]): number {
    let dotProduct = 0;
    let normA = 0;
    let normB = 0;
    for (let i = 0; i < a.length; i++) {
      dotProduct += a[i] * b[i];
      normA += a[i] * a[i];
      normB += b[i] * b[i];
    }
    return dotProduct / (Math.sqrt(normA) * Math.sqrt(normB));
  }

  it('should return 1 for identical vectors', () => {
    const vec = [0.1, 0.2, 0.3, 0.4];
    expect(cosineSimilarity(vec, vec)).toBeCloseTo(1);
  });

  it('should return 0 for orthogonal vectors', () => {
    const vec1 = [1, 0, 0, 0];
    const vec2 = [0, 1, 0, 0];
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0);
  });

  it('should return -1 for opposite vectors', () => {
    const vec1 = [1, 0, 0, 0];
    const vec2 = [-1, 0, 0, 0];
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(-1);
  });

  it('should handle normalized vectors correctly', () => {
    // Normalized vectors (length = 1)
    const vec1 = [0.6, 0.8]; // sqrt(0.36 + 0.64) = 1
    const vec2 = [0.8, 0.6];
    // dot product = 0.48 + 0.48 = 0.96
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(0.96);
  });

  it('should handle high-dimensional vectors', () => {
    const dim = 384; // Same as embedding dimension
    const vec1 = new Array(dim).fill(1);
    const vec2 = new Array(dim).fill(1);
    expect(cosineSimilarity(vec1, vec2)).toBeCloseTo(1);
  });
});
