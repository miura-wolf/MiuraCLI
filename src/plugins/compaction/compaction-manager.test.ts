import { describe, it, expect, beforeEach } from 'vitest';
import { 
  NoCompaction, 
  SlidingWindow, 
  Summarize, 
  SafeSplitPoint, 
  Hybrid,
  CompactionManager 
} from './compaction-manager.js';

// Define types for testing
interface TestLLMMessage {
  role: 'user' | 'assistant' | 'system' | 'tool_use' | 'tool_result';
  content?: string;
  timestamp: string;
  metadata?: Record<string, unknown>;
}

function createTestMessage(role: TestLLMMessage['role'], content?: string, timestamp?: string): TestLLMMessage {
  return {
    role,
    content,
    timestamp: timestamp ?? Date.now().toString()
  };
}

describe('Compaction Strategies', () => {
  let messages: TestLLMMessage[];
  
  beforeEach(() => {
    messages = [
      createTestMessage('system', 'system_prompt'),
      createTestMessage('user', 'Hello'),
      createTestMessage('assistant', 'Hi there!'),
      createTestMessage('user', 'Explain React components'),
      createTestMessage('assistant', 'React components are...'),
      createTestMessage('user', 'How about state management?'),
      createTestMessage('assistant', 'State management can be done with...'),
      createTestMessage('user', 'Show me an example'),
      createTestMessage('assistant', 'Here is an example:'),
      // Create many more messages to test compaction
      ...Array.from({ length: 45 }, (_, i) => 
        createTestMessage(
          i % 2 === 0 ? 'user' : 'assistant',
          `Message ${i + 1} about various technical topics`
        )
      )
    ];
  });

  describe('NoCompaction', () => {
    it('should not modify messages', () => {
      const strategy = new NoCompaction();
      const result = strategy.compact(messages, 100000);
      
      expect(result.compactedMessages).toHaveLength(messages.length);
      expect(result.removedMessages).toHaveLength(0);
      expect(result.stats.strategyUsed).toBe('no_compaction');
      expect(result.stats.compressionRatio).toBe(1);
    });
  });

  describe('SlidingWindow', () => {
    it('should preserve last N messages', () => {
      const strategy = new SlidingWindow(5, true);
      const result = strategy.compact(messages, 100000);
      
      expect(result.compactedMessages).toHaveLength(5);
      expect(result.removedMessages).toHaveLength(messages.length - 5);
      // The system message is too old to fit in a window of 5
      expect(result.compactedMessages.some(m => m.role === 'user')).toBe(true);
      expect(result.stats.strategyUsed).toBe('sliding_window');
    });

    it('should not compact if messages within window size', () => {
      const smallMessages = messages.slice(0, 3);
      const strategy = new SlidingWindow(10, true);
      const result = strategy.compact(smallMessages, 100000);
      
      expect(result.compactedMessages).toHaveLength(smallMessages.length);
      expect(result.removedMessages).toHaveLength(0);
    });

    it('should filter system messages when preserveSystem=false', () => {
      const strategy = new SlidingWindow(5, false);
      const result = strategy.compact(messages, 100000);
      
      expect(result.compactedMessages).toHaveLength(5);
      expect(result.compactedMessages[0].role).not.toBe('system');
    });
  });

  describe('Summarize', () => {
    it('should summarize when exceeding threshold', () => {
      const strategy = new Summarize(5, undefined, true);
      const result = strategy.compact(messages, 100000);
      
      expect(result.compactedMessages).toHaveLength(6); // 5 preserved + 1 summary
      expect(result.removedMessages).toHaveLength(messages.length - 5); // first 49 summarized
      expect(result.stats.strategyUsed).toBe('summarize');
      
      // Check that summary message exists
      const summaryMessage = result.compactedMessages[0];
      expect(summaryMessage.role).toBe('assistant');
      expect(summaryMessage.content).toContain('SUMMARY OF PREVIOUS CONVERSATION');
    });

    it('should not summarize when within threshold', () => {
      const smallMessages = messages.slice(0, 3);
      const strategy = new Summarize(10, undefined, true);
      const result = strategy.compact(smallMessages, 100000);
      
      expect(result.compactedMessages).toHaveLength(smallMessages.length);
      expect(result.removedMessages).toHaveLength(0);
    });

    it('should extract topics from messages', () => {
      const strategy = new Summarize(5, undefined, true);
      // Add database messages EARLY so they end up in messagesToSummarize, not the preserved set
      const messagesWithTopics = [
        createTestMessage('user', 'I need help with database optimization'),
        createTestMessage('assistant', 'Database indexing can improve performance'),
        ...messages,
      ];
      
      const result = strategy.compact(messagesWithTopics, 100000);
      expect(result.compactedMessages[0].content).toContain('database');
    });
  });

  describe('SafeSplitPoint', () => {
    it('should not split tool_use + tool_result pairs', () => {
      const messagesWithTools = [
        ...messages,
        createTestMessage('tool_use', 'tool call for database query'),
        createTestMessage('tool_result', 'tool result with data'),
        createTestMessage('user', 'Thanks for the help'),
      ];
      
      const innerStrategy = new SlidingWindow(10);
      const strategy = new SafeSplitPoint(innerStrategy);
      const result = strategy.compact(messagesWithTools, 100000);
      
      // Check that tool_use and tool_result are together
      const toolUseIndex = result.compactedMessages.findIndex(m => m.role === 'tool_use');
      const toolResultIndex = result.compactedMessages.findIndex(m => m.role === 'tool_result');
      
      expect(toolResultIndex).toBe(toolUseIndex + 1);
    });

    it('should fall back to inner strategy when no safe points', () => {
      const messagesWithoutSafePoints = messages.map(msg => ({
        ...msg,
        content: msg.content?.replace(/```/g, '') // Remove code blocks
      }));
      
      const innerStrategy = new SlidingWindow(5);
      const strategy = new SafeSplitPoint(innerStrategy);
      const result = strategy.compact(messagesWithoutSafePoints, 100000);
      
      // When no safe points, the inner strategy is used directly
      expect(result.stats.strategyUsed).toBe('sliding_window');
    });
  });

  describe('Hybrid', () => {
    it('should combine sliding window and summarize', () => {
      const strategy = new Hybrid(10, true, true);
      const result = strategy.compact(messages, 100000);
      
      expect(result.compactedMessages.length).toBeLessThan(messages.length);
      expect(result.stats.strategyUsed).toBe('hybrid');
      
      // Should preserve some recent messages
      const recentMessages = result.compactedMessages.slice(-5);
      expect(recentMessages.length).toBeGreaterThan(0);
    });

    it('should use sliding window only when few older messages', () => {
      const strategy = new Hybrid(10, true, false); // disable summarize for older
      const result = strategy.compact(messages, 100000);
      
      expect(result.stats.strategyUsed).toBe('hybrid');
      expect(result.compactedMessages.length).toBeLessThan(messages.length);
    });
  });

  describe('CompactionManager', () => {
    let manager: CompactionManager;
    
    beforeEach(() => {
      manager = new CompactionManager();
    });

    it('should register all strategies', () => {
      const strategies = manager.getAvailableStrategies();
      expect(strategies).toContain('no_compaction');
      expect(strategies).toContain('sliding_window');
      expect(strategies).toContain('summarize');
      expect(strategies).toContain('hybrid');
      expect(strategies).toContain('safe_split_point');
    });

    it('should set and get strategy', () => {
      manager.setStrategy('sliding_window', { windowSize: 25 });
      expect(manager.getCurrentStrategy()).toBe('sliding_window');
    });

    it('should throw error for unknown strategy', () => {
      expect(() => {
        manager.setStrategy('unknown_strategy');
      }).toThrow('Unknown strategy: unknown_strategy');
    });

    it('should describe strategies correctly', () => {
      expect(manager.describeStrategy('no_compaction')).toContain('No message compression');
      expect(manager.describeStrategy('sliding_window')).toContain('Keep last');
      expect(manager.describeStrategy('summarize')).toContain('Summarize');
    });

    it('should get strategy configuration', () => {
      const config = manager.getStrategyConfig('sliding_window');
      expect(config).toEqual({ windowSize: 50, preserveSystem: true });
    });

    it('should compact with current strategy', () => {
      manager.setStrategy('sliding_window', { windowSize: 10 });
      const result = manager.compact(messages, 100000);
      
      expect(result.stats.strategyUsed).toBe('sliding_window');
      expect(result.compactedMessages.length).toBeLessThanOrEqual(10);
    });
  });
});

describe('Compaction Integration Tests', () => {
  it('should handle edge cases gracefully', () => {
    const emptyMessages: TestLLMMessage[] = [];
    const strategy = new SlidingWindow(10);
    
    const result = strategy.compact(emptyMessages, 100000);
    expect(result.compactedMessages).toHaveLength(0);
    expect(result.removedMessages).toHaveLength(0);
  });

  it('should handle messages without content', () => {
    const messagesWithoutContent = [
      createTestMessage('user', ''),
      createTestMessage('assistant', undefined),
      createTestMessage('system', 'system_prompt')
    ];
    
    const strategy = new SlidingWindow(5);
    const result = strategy.compact(messagesWithoutContent, 100000);
    
    expect(result.compactedMessages).toHaveLength(3);
  });

  it('should preserve timestamps in compacted messages', () => {
    const messages = [
      createTestMessage('user', 'First message', '1'),
      createTestMessage('assistant', 'Second message', '2'),
      createTestMessage('user', 'Third message', '3')
    ];
    
    const strategy = new SlidingWindow(2);
    const result = strategy.compact(messages, 100000);
    
    expect(result.compactedMessages[0].timestamp).toBe('2');
    expect(result.compactedMessages[1].timestamp).toBe('3');
  });

  it('should handle very large context window', () => {
    const manyMessages = Array.from({ length: 200 }, (_, i) =>
      createTestMessage('user', `Message ${i}`)
    );
    
    const strategy = new SlidingWindow(100);
    const result = strategy.compact(manyMessages, 1000000); // Very large context
    
    expect(result.compactedMessages).toHaveLength(100);
    expect(result.removedMessages).toHaveLength(100);
  });
});

describe('Compaction Performance Tests', () => {
  it('should handle large numbers of messages efficiently', () => {
    const largeMessages = Array.from({ length: 1000 }, (_, i) =>
      createTestMessage('user', `Message ${i} with some content to make it longer`)
    );
    
    const strategy = new SlidingWindow(100);
    const startTime = Date.now();
    
    const result = strategy.compact(largeMessages, 100000);
    
    const endTime = Date.now();
    const duration = endTime - startTime;
    
    expect(result.compactedMessages).toHaveLength(100);
    expect(duration).toBeLessThan(100); // Should complete quickly
    console.log(`SlidingWindow with 1000 messages took ${duration}ms`);
  });
});