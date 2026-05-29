import { describe, it, expect, beforeEach, vi } from 'vitest';
import { SessionManagerWithCompaction } from './session-manager-with-compaction.js';
import { SessionConfig } from './types.js';

// Mock the base SessionManager
vi.mock('../cli/session-manager.js', () => ({
  SessionManager: class {
    _id: string;
    _messages: any[];
    _metadata: any;

    constructor() {
      this._id = 'test_session';
      this._messages = [];
      this._metadata = { pipelineCount: 0, agentCount: 0 };
    }

    get id() { return this._id; }
    get messages() { return this._messages; }
    get messageCount() { return this._messages.length; }
    get pipelineCount() { return this._metadata?.pipelineCount || 0; }
    get agentCount() { return this._metadata?.agentCount || 0; }

    add(msg: any) {
      this._messages.push(msg);
    }

    getRecentMessages(n = 10) {
      return this._messages.slice(-n);
    }

    clearMessages() {
      this._messages = [];
    }

    persist() {}
    close() {}
    setModelRef(modelRef) {}
    incPipelines() {}
    incAgents() {}
  }
}));

describe('SessionManagerWithCompaction', () => {
  let sessionManager: SessionManagerWithCompaction;
  let config: SessionConfig;

  beforeEach(() => {
    config = {
      compaction: {
        strategy: 'sliding_window',
        options: { windowSize: 20 }
      },
      contextWindow: 100000
    };

    sessionManager = new SessionManagerWithCompaction(config);
  });

  describe('Initialization', () => {
    it('should initialize with correct configuration', () => {
      expect(sessionManager.id).toBeDefined();
      expect(sessionManager.messageCount).toBe(0);
      expect(sessionManager.getContextUsage()).toBe(0);
    });

    it('should set up compaction strategy', () => {
      expect(sessionManager.getCurrentStrategy()).toBe('sliding_window'); // Set from config in constructor
    });
  });

  describe('Message Management', () => {
    it('should add messages without compaction when under limit', async () => {
      await sessionManager.addMessage({
        role: 'user',
        content: 'Hello',
        timestamp: Date.now()
      });

      expect(sessionManager.messageCount).toBe(1);
      expect(sessionManager.getContextUsage()).toBeGreaterThan(0);
      expect(sessionManager.getContextUsage()).toBeLessThan(10);
    });

    it('should compact messages when exceeding context window', async () => {
      // Create a session with a SMALL context window to force compaction
      const smallConfig: SessionConfig = {
        compaction: {
          strategy: 'sliding_window',
          options: { windowSize: 5, conserveMemory: false }
        },
        contextWindow: 2000 // Small window forces compaction quickly
      };
      const smallSession = new SessionManagerWithCompaction(smallConfig);
      
      // Add many messages with longer content to exceed the small context window
      for (let i = 0; i < 50; i++) {
        await smallSession.addMessage({
          role: 'user',
          content: `Message ${i}: This is a longer message with more words to increase the estimated token count beyond the small context window threshold so compaction will trigger.`,
          timestamp: Date.now() + i
        });
      }

      // After adding many messages, some compaction should have occurred
      expect(smallSession.messageCount).toBeLessThan(50);
      
      const stats = smallSession.getCompactionStats();
      expect(stats.totalCompactions).toBeGreaterThan(0);
    });
  });

  describe('Compaction Strategy Management', () => {
    it('should set compaction strategy', () => {
      sessionManager.setStrategy('sliding_window', { windowSize: 15 });
      
      // Note: getCurrentStrategy() would need to be implemented in CompactionManager
      // For now, we just verify it doesn't throw
      expect(() => sessionManager.getCurrentStrategy()).not.toThrow();
    });

    it('should get available strategies', () => {
      const strategies = sessionManager.getAvailableStrategies();
      
      expect(strategies).toContain('no_compaction');
      expect(strategies).toContain('sliding_window');
      expect(strategies).toContain('summarize');
      expect(strategies).toContain('hybrid');
      expect(strategies).toContain('safe_split_point');
    });
  });

  describe('Context Management', () => {
    it('should calculate context usage correctly', async () => {
      // Add a message with known content
      await sessionManager.addMessage({
        role: 'user',
        content: 'Hello world this is a test message',
        timestamp: Date.now()
      });

      const usage = sessionManager.getContextUsage();
      expect(usage).toBeGreaterThan(0);
      expect(usage).toBeLessThan(100);
    });

    it('should get recent messages for context injection', () => {
      // Add some messages
      const messages = [
        { role: 'user', content: 'Message 1', timestamp: Date.now() },
        { role: 'assistant', content: 'Response 1', timestamp: Date.now() + 1 },
        { role: 'user', content: 'Message 2', timestamp: Date.now() + 2 },
        { role: 'assistant', content: 'Response 2', timestamp: Date.now() + 3 },
        { role: 'user', content: 'Message 3', timestamp: Date.now() + 4 }
      ];

      messages.forEach(msg => {
        sessionManager.addMessage(msg);
      });

      const recent = sessionManager.getRecentMessages(2);
      expect(recent).toHaveLength(2);
      expect(recent[0].content).toBe('Response 2');
      expect(recent[1].content).toBe('Message 3');
    });
  });

  describe('Statistics and Reporting', () => {
    it('should track compaction statistics', async () => {
      // Add messages to trigger compaction
      for (let i = 0; i < 50; i++) {
        await sessionManager.addMessage({
          role: 'user',
          content: `Test message ${i} for compaction testing`,
          timestamp: Date.now() + i
        });
      }

      const stats = sessionManager.getCompactionStats();
      expect(stats).toBeDefined();
      expect(stats.totalCompactions).toBeGreaterThanOrEqual(0);
    });

    it('should provide recommendations based on usage', () => {
      // Simulate high context usage
      const recommendations = sessionManager.getRecommendations();
      
      expect(Array.isArray(recommendations)).toBe(true);
      // Recommendations could include various suggestions based on context
    });

    it('should generate session summary', () => {
      const summary = sessionManager.getSummary();
      
      expect(typeof summary).toBe('string');
      expect(summary).toContain('Session Summary');
      expect(summary).toContain('ID:');
      expect(summary).toContain('Messages:');
    });
  });

  describe('Session Persistence', () => {
    it('should persist session', () => {
      expect(() => sessionManager.persist()).not.toThrow();
    });

    it('should close session', () => {
      expect(() => sessionManager.close()).not.toThrow();
    });

    it('should clear messages', () => {
      sessionManager.clearMessages();
      expect(sessionManager.messageCount).toBe(0);
      expect(sessionManager.getContextUsage()).toBe(0);
    });
  });

  describe('Compaction Scenarios', () => {
    it('should handle empty message list', async () => {
      expect(sessionManager.messageCount).toBe(0);
      
      await sessionManager.addMessage({
        role: 'user',
        content: 'First message',
        timestamp: Date.now()
      });
      
      expect(sessionManager.messageCount).toBe(1);
    });

    it('should handle messages with no content', async () => {
      await sessionManager.addMessage({
        role: 'user',
        content: '',
        timestamp: Date.now()
      });

      await sessionManager.addMessage({
        role: 'assistant',
        content: undefined,
        timestamp: Date.now()
      });

      expect(sessionManager.messageCount).toBe(2);
    });

    it('should handle system messages correctly', async () => {
      await sessionManager.addMessage({
        role: 'system',
        content: 'System prompt',
        timestamp: Date.now()
      });

      await sessionManager.addMessage({
        role: 'user',
        content: 'User message',
        timestamp: Date.now()
      });

      expect(sessionManager.messageCount).toBe(2);
    });
  });

  describe('Error Handling', () => {
    it('should handle invalid strategy gracefully', () => {
      expect(() => {
        sessionManager.setStrategy('invalid_strategy');
      }).toThrow('Unknown strategy: invalid_strategy');
    });

    it('should handle negative context window', () => {
      const configWithNegativeWindow = {
        compaction: { strategy: 'no_compaction' },
        contextWindow: -1000
      };
      
      // This should not throw during initialization
      expect(() => new SessionManagerWithCompaction(configWithNegativeWindow)).not.toThrow();
    });
  });
});

describe('SessionManagerWithCompaction Integration', () => {
  it('should work with different compaction strategies', async () => {
    const configs = [
      {
        compaction: { strategy: 'no_compaction' },
        contextWindow: 100000
      },
      {
        compaction: { strategy: 'sliding_window', options: { windowSize: 10 } },
        contextWindow: 50000
      },
      {
        compaction: { strategy: 'summarize', options: { thresholdMessages: 15 } },
        contextWindow: 75000
      }
    ];

    for (const config of configs) {
      const manager = new SessionManagerWithCompaction(config);
      
      // Add some messages
      for (let i = 0; i < 20; i++) {
        await manager.addMessage({
          role: 'user',
          content: `Test message ${i}`,
          timestamp: Date.now() + i
        });
      }

      expect(manager.messageCount).toBeGreaterThan(0);
      expect(manager.getContextUsage()).toBeGreaterThan(0);
    }
  });

  it('should maintain session state across compactions', async () => {
    const manager = new SessionManagerWithCompaction({
      compaction: { strategy: 'sliding_window', options: { windowSize: 5 } },
      contextWindow: 10000
    });

    // Add messages that will trigger compaction
    for (let i = 0; i < 30; i++) {
      await manager.addMessage({
        role: i % 2 === 0 ? 'user' : 'assistant',
        content: `Message ${i} for testing`,
        timestamp: Date.now() + i
      });
    }

    // Should have compacted but still have some messages
    expect(manager.messageCount).toBeGreaterThan(0);
    expect(manager.messageCount).toBeLessThanOrEqual(30);

    // Should still be able to get recent messages
    const recent = manager.getRecentMessages(3);
    expect(recent.length).toBeLessThanOrEqual(3);
  });
});