/**
 * Tests for Chat UI Templates
 *
 * Tests that the chat UI components are correctly generated
 * in the HTML templates.
 */

import { describe, it, expect } from 'vitest';
import { getTemplates } from '../src/site/templates.js';

describe('Chat UI Templates', () => {
  const templates = getTemplates();

  const baseTemplateData = {
    title: 'Test Page',
    siteTitle: 'Test Wiki',
    description: 'A test page',
    content: '<p>Test content</p>',
    toc: '',
    breadcrumbs: '',
    relatedPages: '',
    navigation: { sections: [] },
    rootPath: './',
    currentPath: 'test.html',
    theme: 'auto' as const
  };

  describe('Chat Toggle Button', () => {
    it('should include chat toggle button when aiChat is enabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-toggle-btn');
      expect(html).toContain('AI Assistant');
    });

    it('should not include chat toggle button when aiChat is disabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: false }
      });

      expect(html).not.toContain('chat-toggle-btn');
    });

    it('should have correct SVG icon for chat toggle', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      // Chat icon path (message bubble)
      expect(html).toContain('M21 15a2 2 0 0 1-2 2H7l-4 4V5a2 2 0 0 1 2-2h14a2 2 0 0 1 2 2z');
    });
  });

  describe('Chat Panel Structure', () => {
    it('should include chat panel when aiChat is enabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-panel');
      expect(html).toContain('role="complementary"');
      expect(html).toContain('aria-label="AI Chat Assistant"');
    });

    it('should not include chat panel when aiChat is disabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: false }
      });

      expect(html).not.toContain('chat-panel');
    });

    it('should include chat panel header with title', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-panel-header');
      expect(html).toContain('chat-panel-title');
      expect(html).toContain('AI Assistant');
    });

    it('should include model badge showing SmolLM2', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-model-badge');
      expect(html).toContain('SmolLM2');
    });

    it('should include collapse button', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-panel-collapse');
      expect(html).toContain('aria-label="Collapse chat panel"');
    });
  });

  describe('Chat Status Indicator', () => {
    it('should include loading indicator', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-panel-status');
      expect(html).toContain('chat-loading-indicator');
      expect(html).toContain('chat-loading-spinner');
      expect(html).toContain('chat-loading-text');
      expect(html).toContain('Loading AI model...');
    });
  });

  describe('Chat Messages Area', () => {
    it('should include messages container', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-messages');
    });

    it('should include welcome message', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-welcome');
      expect(html).toContain('chat-welcome-icon');
      expect(html).toContain('Ask about these docs');
    });

    it('should include welcome description', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('answers with links');
      expect(html).toContain('SmolLM2');
    });
  });

  describe('Suggested Questions', () => {
    it('should include suggestion buttons', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-suggestions');
      expect(html).toContain('chat-suggestion');
    });

    it('should include default suggested questions', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('Overall architecture');
      expect(html).toContain('Component interactions');
      expect(html).toContain('Key concepts');
    });

    it('should have data-question attributes on suggestion buttons', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('data-question="What is the overall architecture?"');
      expect(html).toContain('data-question="How do the main components work together?"');
      expect(html).toContain('data-question="What are the key concepts I should understand?"');
    });
  });

  describe('Chat Input Area', () => {
    it('should include input area', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-input-area');
    });

    it('should include textarea input', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-input');
      expect(html).toContain('textarea');
      expect(html).toContain('placeholder="Ask a question..."');
    });

    it('should include send button', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('chat-send');
      expect(html).toContain('title="Send message"');
      expect(html).toContain('disabled');
    });

    it('should have correct send icon', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      // Paper airplane / send icon
      expect(html).toContain('polygon points="22 2 15 22 11 13 2 9 22 2"');
    });
  });

  describe('Feature Combinations', () => {
    it('should work with all features enabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: {
          aiChat: true,
          search: true,
          guidedTour: true,
          keyboardNav: true,
          progressTracking: true,
          codeExplorer: true
        }
      });

      expect(html).toContain('chat-panel');
      expect(html).toContain('search-trigger');
      expect(html).toContain('tour-trigger');
    });

    it('should work with only aiChat enabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: {
          aiChat: true,
          search: false,
          guidedTour: false,
          keyboardNav: false,
          progressTracking: false,
          codeExplorer: false
        }
      });

      expect(html).toContain('chat-panel');
      expect(html).not.toContain('search-modal');
      expect(html).not.toContain('tour-selector');
    });

    it('should work with aiChat disabled but other features enabled', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: {
          aiChat: false,
          search: true,
          guidedTour: true
        }
      });

      expect(html).not.toContain('chat-panel');
      expect(html).toContain('search-trigger');
      expect(html).toContain('tour-trigger');
    });
  });

  describe('Accessibility', () => {
    it('should have proper ARIA attributes on chat panel', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('role="complementary"');
      expect(html).toContain('aria-label="AI Chat Assistant"');
    });

    it('should have aria-label on collapse button', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('aria-label="Collapse chat panel"');
    });

    it('should have title attributes on buttons', () => {
      const html = templates.page({
        ...baseTemplateData,
        features: { aiChat: true }
      });

      expect(html).toContain('title="AI Assistant"');
      expect(html).toContain('title="Send message"');
    });
  });
});
