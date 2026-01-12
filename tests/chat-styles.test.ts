/**
 * Tests for Chat CSS Styles
 *
 * Tests that all necessary CSS classes and styles are included
 * for the chat feature.
 */

import { describe, it, expect } from 'vitest';
import { getStyles } from '../src/site/styles.js';

describe('Chat CSS Styles', () => {
  const styles = getStyles();

  describe('Chat Toggle Button Styles', () => {
    it('should include chat-toggle-btn class', () => {
      expect(styles).toContain('.chat-toggle-btn');
    });

    it('should include icon visibility toggles', () => {
      expect(styles).toContain('.chat-toggle-icon-close');
      expect(styles).toContain('.chat-toggle-icon-open');
    });
  });

  describe('Chat Panel Styles', () => {
    it('should include chat-panel class', () => {
      expect(styles).toContain('.chat-panel');
    });

    it('should have fixed positioning', () => {
      expect(styles).toContain('position: fixed');
    });

    it('should have defined dimensions for side panel', () => {
      expect(styles).toContain('width: 380px');
    });

    it('should include body.chat-open state', () => {
      expect(styles).toContain('body.chat-open .chat-panel');
    });

    it('should have transition animations', () => {
      expect(styles).toContain('transition:');
      expect(styles).toContain('transform:');
    });
  });

  describe('Chat Header Styles', () => {
    it('should include header class', () => {
      expect(styles).toContain('.chat-panel-header');
    });

    it('should include title class', () => {
      expect(styles).toContain('.chat-panel-title');
    });

    it('should include model badge class', () => {
      expect(styles).toContain('.chat-model-badge');
    });

    it('should style model badge with gradient', () => {
      expect(styles).toMatch(/\.chat-model-badge[\s\S]*?background.*gradient/);
    });

    it('should include close button class', () => {
      expect(styles).toContain('.chat-panel-close');
    });

    it('should include close button hover state', () => {
      expect(styles).toContain('.chat-panel-close:hover');
    });
  });

  describe('Chat Status Styles', () => {
    it('should include status class', () => {
      expect(styles).toContain('.chat-panel-status');
    });

    it('should include visible state', () => {
      expect(styles).toContain('.chat-panel-status.visible');
    });

    it('should include loading indicator', () => {
      expect(styles).toContain('.chat-loading-indicator');
    });

    it('should include loading spinner', () => {
      expect(styles).toContain('.chat-loading-spinner');
    });

    it('should include spinner animation', () => {
      expect(styles).toContain('@keyframes chatSpin');
    });

    it('should include loading text', () => {
      expect(styles).toContain('.chat-loading-text');
    });
  });

  describe('Chat Messages Styles', () => {
    it('should include messages container class', () => {
      expect(styles).toContain('.chat-messages');
    });

    it('should have flexbox layout for messages', () => {
      expect(styles).toMatch(/\.chat-messages[\s\S]*?display:\s*flex/);
      expect(styles).toMatch(/\.chat-messages[\s\S]*?flex-direction:\s*column/);
    });

    it('should include message class', () => {
      expect(styles).toContain('.chat-message');
    });

    it('should include user message variant', () => {
      expect(styles).toContain('.chat-message.user');
    });

    it('should include assistant message variant', () => {
      expect(styles).toContain('.chat-message.assistant');
    });

    it('should include message avatar', () => {
      expect(styles).toContain('.chat-message-avatar');
    });

    it('should include message content', () => {
      expect(styles).toContain('.chat-message-content');
    });

    it('should include message sources', () => {
      expect(styles).toContain('.chat-message-sources');
    });
  });

  describe('Chat Welcome Styles', () => {
    it('should include welcome class', () => {
      expect(styles).toContain('.chat-welcome');
    });

    it('should include welcome icon', () => {
      expect(styles).toContain('.chat-welcome-icon');
    });

    it('should center welcome text', () => {
      expect(styles).toMatch(/\.chat-welcome[\s\S]*?text-align:\s*center/);
    });
  });

  describe('Chat Suggestions Styles', () => {
    it('should include suggestions container', () => {
      expect(styles).toContain('.chat-suggestions');
    });

    it('should include suggestion button', () => {
      expect(styles).toContain('.chat-suggestion');
    });

    it('should include suggestion hover state', () => {
      expect(styles).toContain('.chat-suggestion:hover');
    });
  });

  describe('Chat Typing Indicator Styles', () => {
    it('should include typing class', () => {
      expect(styles).toContain('.chat-typing');
    });

    it('should include typing dot', () => {
      expect(styles).toContain('.chat-typing-dot');
    });

    it('should include typing animation', () => {
      expect(styles).toContain('@keyframes chatTyping');
    });

    it('should have animation delays for dots', () => {
      expect(styles).toContain('.chat-typing-dot:nth-child(1)');
      expect(styles).toContain('.chat-typing-dot:nth-child(2)');
      expect(styles).toContain('.chat-typing-dot:nth-child(3)');
      expect(styles).toContain('animation-delay:');
    });
  });

  describe('Chat Input Styles', () => {
    it('should include input area class', () => {
      expect(styles).toContain('.chat-input-area');
    });

    it('should include input class', () => {
      expect(styles).toContain('.chat-input');
    });

    it('should include input focus state', () => {
      expect(styles).toContain('.chat-input:focus');
    });

    it('should include input placeholder', () => {
      expect(styles).toContain('.chat-input::placeholder');
    });

    it('should include send button', () => {
      expect(styles).toContain('.chat-send');
    });

    it('should include send button hover state', () => {
      expect(styles).toContain('.chat-send:hover');
    });

    it('should include send button disabled state', () => {
      expect(styles).toContain('.chat-send:disabled');
    });
  });

  describe('Chat Error Styles', () => {
    it('should include error class', () => {
      expect(styles).toContain('.chat-error');
    });
  });

  describe('Mobile Responsive Styles', () => {
    it('should include mobile media query for chat panel', () => {
      expect(styles).toMatch(/@media[\s\S]*max-width:\s*768px[\s\S]*\.chat-panel/);
    });

    it('should make chat panel full-width on mobile', () => {
      expect(styles).toMatch(/@media[\s\S]*max-width:\s*768px[\s\S]*width:\s*100%/);
    });

    it('should adjust border radius on mobile', () => {
      expect(styles).toMatch(/@media[\s\S]*max-width:\s*768px[\s\S]*border-radius.*0\s*0/);
    });
  });

  describe('Z-Index Layering', () => {
    it('should have appropriate z-index for chat panel', () => {
      expect(styles).toMatch(/\.chat-panel[\s\S]*?z-index:\s*200/);
    });
  });

  describe('CSS Variables Usage', () => {
    it('should use CSS variables for colors', () => {
      expect(styles).toContain('var(--color-');
    });

    it('should use CSS variables for spacing', () => {
      expect(styles).toContain('var(--spacing-');
    });

    it('should use CSS variables for radius', () => {
      expect(styles).toContain('var(--radius-');
    });

    it('should use CSS variables for transitions', () => {
      expect(styles).toContain('var(--transition-');
    });
  });

  describe('Message Formatting Styles', () => {
    it('should include paragraph styles in messages', () => {
      expect(styles).toContain('.chat-message-content p');
    });

    it('should include code styles in messages', () => {
      expect(styles).toContain('.chat-message-content code');
    });

    it('should include pre styles in messages', () => {
      expect(styles).toContain('.chat-message-content pre');
    });

    it('should have distinct user message code styling', () => {
      expect(styles).toContain('.chat-message.user .chat-message-content code');
    });
  });
});
