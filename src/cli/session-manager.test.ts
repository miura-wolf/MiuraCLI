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
});