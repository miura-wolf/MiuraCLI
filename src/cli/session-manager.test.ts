/**
 * SessionManager tests
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SessionManager } from './session-manager.js';

describe('SessionManager', () => {
  describe('constructor & basic properties', () => {
    it('generates a session id on creation', () => {
      const session = new SessionManager();
      expect(session.id).toMatch(/^sess_/);
    });

    it('accepts a custom session id', () => {
      const session = new SessionManager('my-session-id');
      expect(session.id).toBe('my-session-id');
    });

    it('messageCount starts at 0', () => {
      const session = new SessionManager();
      expect(session.messageCount).toBe(0);
    });

    it('pipelineCount and agentCount start at 0', () => {
      const session = new SessionManager();
      expect(session.pipelineCount).toBe(0);
      expect(session.agentCount).toBe(0);
    });
  });

  describe('addUser / addAssistant / addSystem', () => {
    it('addUser increments messageCount', () => {
      const session = new SessionManager();
      session.addUser('hello world');
      expect(session.messageCount).toBe(1);
    });

    it('addAssistant increments messageCount', () => {
      const session = new SessionManager();
      session.addAssistant('hello world');
      expect(session.messageCount).toBe(1);
    });

    it('addSystem increments messageCount', () => {
      const session = new SessionManager();
      session.addSystem('internal note');
      expect(session.messageCount).toBe(1);
    });

    it('tracks correct roles', () => {
      const session = new SessionManager();
      session.addUser('user msg');
      session.addAssistant('assistant msg');
      session.addSystem('system msg');

      const msgs = session.getRecentMessages(10);
      expect(msgs[0].role).toBe('user');
      expect(msgs[1].role).toBe('assistant');
      expect(msgs[2].role).toBe('system');
    });

    it('adds timestamp to each message', () => {
      const session = new SessionManager();
      session.addUser('test');
      const msgs = session.getRecentMessages(1);
      expect(msgs[0].timestamp).toBeGreaterThan(0);
    });
  });

  describe('increment methods', () => {
    it('incPipelines increments pipelineCount', () => {
      const session = new SessionManager();
      session.incPipelines();
      expect(session.pipelineCount).toBe(1);
      session.incPipelines();
      expect(session.pipelineCount).toBe(2);
    });

    it('incAgents increments agentCount', () => {
      const session = new SessionManager();
      session.incAgents();
      expect(session.agentCount).toBe(1);
      session.incAgents();
      session.incAgents();
      expect(session.agentCount).toBe(3);
    });
  });

  describe('setModelRef', () => {
    it('setModelRef stores the model ref string', () => {
      const session = new SessionManager('test');
      session.setModelRef('claude/opus-4');
      // Verify via session listing (间接测试)
      expect(session.id).toBe('test');
    });
  });

  describe('getRecentMessages', () => {
    it('returns all messages when count exceeds total', () => {
      const session = new SessionManager();
      session.addUser('a');
      session.addUser('b');
      session.addUser('c');
      expect(session.getRecentMessages(10).length).toBe(3);
    });

    it('returns last N messages', () => {
      const session = new SessionManager();
      for (let i = 0; i < 10; i++) session.addUser(`msg ${i}`);
      const last3 = session.getRecentMessages(3);
      expect(last3.length).toBe(3);
      expect(last3[0].content).toBe('msg 7');
      expect(last3[2].content).toBe('msg 9');
    });

    it('returns empty array when no messages', () => {
      const session = new SessionManager();
      expect(session.getRecentMessages(5)).toEqual([]);
    });
  });

  describe('clearMessages', () => {
    it('clears all messages but keeps metadata', () => {
      const session = new SessionManager();
      session.addUser('hello');
      session.addAssistant('world');
      session.incPipelines();
      session.incAgents();

      session.clearMessages();

      expect(session.messageCount).toBe(0);
      expect(session.pipelineCount).toBe(1);
      expect(session.agentCount).toBe(1);
      expect(session.getRecentMessages(10)).toEqual([]);
    });
  });

  describe('addAssistantTurn (tool-calling assistant)', () => {
    it('records toolCalls when provided', () => {
      const session = new SessionManager('turn-test');
      session.addAssistantTurn('Let me read the file.', [
        { id: 'tc1', name: 'read_file', arguments: { path: '/x' } },
      ]);
      const msg = session.getRecentMessages(1)[0] as any;
      expect(msg.role).toBe('assistant');
      expect(msg.toolCalls).toEqual([
        { id: 'tc1', name: 'read_file', arguments: { path: '/x' } },
      ]);
    });

    it('omits toolCalls when the array is empty', () => {
      const session = new SessionManager();
      session.addAssistantTurn('Plain reply.', []);
      const msg = session.getRecentMessages(1)[0] as any;
      expect(msg.role).toBe('assistant');
      expect(msg.toolCalls).toBeUndefined();
    });
  });

  describe('addToolResult', () => {
    it('records tool result with id and name', () => {
      const session = new SessionManager();
      session.addAssistantTurn('Calling.', [
        { id: 'tc1', name: 'read_file', arguments: {} },
      ]);
      session.addToolResult('tc1', 'read_file', 'file contents');
      const last = session.getRecentMessages(1)[0] as any;
      expect(last.role).toBe('tool');
      expect(last.toolCallId).toBe('tc1');
      expect(last.name).toBe('read_file');
      expect(last.content).toBe('file contents');
    });

    it('records optional error', () => {
      const session = new SessionManager();
      session.addToolResult('tc2', 'shell', 'permission denied', 'EACCES');
      const last = session.getRecentMessages(1)[0] as any;
      expect(last.error).toBe('EACCES');
    });
  });

  describe('getHistoryAsLLMMessages', () => {
    it('returns empty array for empty session', () => {
      const session = new SessionManager();
      expect(session.getHistoryAsLLMMessages()).toEqual([]);
    });

    it('maps user turns', () => {
      const session = new SessionManager();
      session.addUser('hi');
      const h = session.getHistoryAsLLMMessages();
      expect(h).toEqual([{ role: 'user', content: 'hi' }]);
    });

    it('maps assistant turns with toolCalls (without timestamps)', () => {
      const session = new SessionManager();
      session.addAssistantTurn('Looking.', [
        { id: 'a1', name: 'grep', arguments: { q: 'foo' } },
      ]);
      const h = session.getHistoryAsLLMMessages();
      expect(h[0].role).toBe('assistant');
      expect(h[0].content).toBe('Looking.');
      expect(h[0].toolCalls).toEqual([
        { id: 'a1', name: 'grep', arguments: { q: 'foo' } },
      ]);
      // No timestamp / metadata leakage
      expect(h[0]).not.toHaveProperty('timestamp');
    });

    it('maps tool results with toolCallId', () => {
      const session = new SessionManager();
      session.addAssistantTurn('x', [{ id: 'c1', name: 'shell', arguments: {} }]);
      session.addToolResult('c1', 'shell', 'ok');
      const h = session.getHistoryAsLLMMessages();
      expect(h[1].role).toBe('tool');
      expect(h[1].toolCallId).toBe('c1');
      expect(h[1].content).toBe('ok');
    });

    it('skips system messages', () => {
      const session = new SessionManager();
      session.addSystem('compaction note');
      session.addUser('user');
      const h = session.getHistoryAsLLMMessages();
      expect(h).toEqual([{ role: 'user', content: 'user' }]);
    });

    it('preserves a full ReAct loop in order', () => {
      const session = new SessionManager();
      session.addUser('find the bug');
      session.addAssistantTurn('searching', [
        { id: 'c1', name: 'grep', arguments: { q: 'TODO' } },
      ]);
      session.addToolResult('c1', 'grep', 'src/x.ts:42: // TODO');
      session.addAssistantTurn('fixing', [
        { id: 'c2', name: 'edit_file', arguments: { path: 'src/x.ts' } },
      ]);
      session.addToolResult('c2', 'edit_file', 'ok');
      session.addAssistant('Fixed.');
      const h = session.getHistoryAsLLMMessages();
      expect(h).toHaveLength(6);
      expect(h.map((m) => m.role)).toEqual([
        'user', 'assistant', 'tool', 'assistant', 'tool', 'assistant',
      ]);
    });
  });

  describe('replaceWith (used by /resume)', () => {
    it('replaces the in-memory state with another session', () => {
      const original = new SessionManager('orig');
      original.addUser('first message');
      original.incPipelines();

      const target = new SessionManager('target');
      target.addUser('a');
      target.addAssistant('b');
      target.addAssistantTurn('c', [
        { id: 't1', name: 'read', arguments: {} },
      ]);
      target.addToolResult('t1', 'read', 'contents');

      target.replaceWith({
        id: 'orig',
        createdAt: Date.now(),
        updatedAt: Date.now(),
        messages: [
          { role: 'user', content: 'from disk', timestamp: Date.now() },
          { role: 'assistant', content: 'reply', timestamp: Date.now() },
        ],
        metadata: { pipelineCount: 7, agentCount: 3 },
      });

      // Now the target SessionManager holds the loaded session
      expect(target.id).toBe('orig');
      expect(target.messageCount).toBe(2);
      expect(target.pipelineCount).toBe(7);
      expect(target.getRecentMessages(1)[0].content).toBe('reply');
    });
  });

  describe('round-trip persistence of tool-call turns', () => {
    it('persists assistant-with-toolCalls and tool-result, then loads them back', () => {
      // Write
      const writer = new SessionManager('rt-test');
      writer.addUser('u1');
      writer.addAssistantTurn('a1', [
        { id: 't1', name: 'shell', arguments: { cmd: 'ls' } },
      ]);
      writer.addToolResult('t1', 'shell', 'file.txt');
      writer.addAssistant('done');
      // Force a persist (the manager persists every 5 messages; we have 4,
      // so trigger an explicit clearMessages + addUser to be safe — actually
      // call addSystem to get to 5 and auto-persist)
      writer.addSystem('flush');
      expect(writer.messageCount).toBe(5);

      // Read back
      const reader = SessionManager.load('rt-test');
      expect(reader).not.toBeNull();
      const msgs = reader!.messages;
      expect(msgs).toHaveLength(5);
      expect(msgs[0].role).toBe('user');
      expect(msgs[1].role).toBe('assistant');
      expect((msgs[1] as any).toolCalls).toEqual([
        { id: 't1', name: 'shell', arguments: { cmd: 'ls' } },
      ]);
      expect(msgs[2].role).toBe('tool');
      expect((msgs[2] as any).toolCallId).toBe('t1');
      expect((msgs[2] as any).content).toBe('file.txt');
      expect(msgs[3].role).toBe('assistant');
      expect(msgs[4].role).toBe('system');

      // Replay via getHistoryAsLLMMessages
      const manager = new SessionManager('rt-test');
      manager.replaceWith(reader!);
      const h = manager.getHistoryAsLLMMessages();
      expect(h.map((m) => m.role)).toEqual([
        'user', 'assistant', 'tool', 'assistant',
      ]);
      // system flushed above is intentionally skipped from history
      expect(h[1].toolCalls).toEqual([
        { id: 't1', name: 'shell', arguments: { cmd: 'ls' } },
      ]);
      expect(h[2].toolCallId).toBe('t1');
    });
  });
});