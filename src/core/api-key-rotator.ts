/**
 * API Key Rotator for MiuraSwarm
 * 
 * Features:
 * - Load multiple API keys from env file
 * - Automatic rotation on 429/404 errors
 * - Health tracking per key
 * - Fallback chain for each provider
 */

export interface ApiKeyEntry {
  key: string;
  provider: string;
  baseUrl?: string;
  failures: number;
  lastFailure?: number;
  successCount: number;
}

export interface RotatorConfig {
  maxFailuresBeforeSkip: number;
  cooldownMs: number;
}

export class ApiKeyRotator {
  private keysByProvider: Map<string, ApiKeyEntry[]> = new Map();
  private currentIndex: Map<string, number> = new Map();
  private config: RotatorConfig;

  constructor(config?: Partial<RotatorConfig>) {
    this.config = {
      maxFailuresBeforeSkip: 3,
      cooldownMs: 60000, // 1 minute cooldown
      ...config,
    };
  }

  /**
   * Load API keys from env file content
   */
  loadFromEnvFile(content: string): void {
    const lines = content.split('\n');
    
    for (const line of lines) {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) continue;

      const match = trimmed.match(/^(\w+)_API_KEY=(.+)$/);
      if (match) {
        const [, provider, key] = match;
        this.addKey(provider.toLowerCase(), key.trim());
      }
    }
  }

  /**
   * Add a single API key
   */
  addKey(provider: string, key: string, baseUrl?: string): void {
    const providerLower = provider.toLowerCase();
    const keys = this.keysByProvider.get(providerLower) || [];
    
    // Check if key already exists
    const exists = keys.some(k => k.key === key);
    if (!exists) {
      keys.push({
        key,
        provider: providerLower,
        baseUrl,
        failures: 0,
        successCount: 0,
      });
      this.keysByProvider.set(providerLower, keys);
      
      if (!this.currentIndex.has(providerLower)) {
        this.currentIndex.set(providerLower, 0);
      }
    }
  }

  /**
   * Get next available key for provider
   */
  getKey(provider: string): ApiKeyEntry | null {
    const providerLower = provider.toLowerCase();
    const keys = this.keysByProvider.get(providerLower);
    
    if (!keys || keys.length === 0) {
      return null;
    }

    const current = this.currentIndex.get(providerLower) || 0;
    
    // Try keys starting from current index
    for (let i = 0; i < keys.length; i++) {
      const index = (current + i) % keys.length;
      const keyEntry = keys[index];
      
      // Check if key is healthy
      if (this.isKeyHealthy(keyEntry)) {
        return keyEntry;
      }
    }

    // All keys might be unhealthy, return least bad one
    return keys.reduce((best, curr) => 
      curr.failures < best.failures ? curr : best
    );
  }

  /**
   * Report success for a key
   */
  reportSuccess(key: string): void {
    const entry = this.findKey(key);
    if (entry) {
      entry.successCount++;
      entry.failures = Math.max(0, entry.failures - 1); // Decay failures
    }
  }

  /**
   * Report failure for a key
   */
  reportFailure(key: string, statusCode?: number): void {
    const entry = this.findKey(key);
    if (entry) {
      entry.failures++;
      entry.lastFailure = Date.now();
      
      // If this key is too bad, move to next
      if (entry.failures >= this.config.maxFailuresBeforeSkip) {
        this.rotateToNext(entry.provider);
      }
    }
  }

  /**
   * Get all keys for provider (for manual iteration)
   */
  getAllKeys(provider: string): ApiKeyEntry[] {
    return this.keysByProvider.get(provider.toLowerCase()) || [];
  }

  /**
   * Get statistics
   */
  getStats(): Record<string, { total: number; healthy: number; totalFailures: number }> {
    const stats: Record<string, { total: number; healthy: number; totalFailures: number }> = {};
    
    for (const [provider, keys] of this.keysByProvider.entries()) {
      const healthy = keys.filter(k => this.isKeyHealthy(k)).length;
      const totalFailures = keys.reduce((sum, k) => sum + k.failures, 0);
      
      stats[provider] = {
        total: keys.length,
        healthy,
        totalFailures,
      };
    }
    
    return stats;
  }

  private isKeyHealthy(entry: ApiKeyEntry): boolean {
    // Too many failures
    if (entry.failures >= this.config.maxFailuresBeforeSkip) {
      return false;
    }
    
    // In cooldown period
    if (entry.lastFailure) {
      const timeSinceFailure = Date.now() - entry.lastFailure;
      if (timeSinceFailure < this.config.cooldownMs) {
        return false;
      }
    }
    
    return true;
  }

  private rotateToNext(provider: string): void {
    const current = this.currentIndex.get(provider.toLowerCase()) || 0;
    const keys = this.keysByProvider.get(provider.toLowerCase());
    
    if (keys && keys.length > 0) {
      this.currentIndex.set(provider.toLowerCase(), (current + 1) % keys.length);
    }
  }

  private findKey(key: string): ApiKeyEntry | null {
    for (const keys of this.keysByProvider.values()) {
      const found = keys.find(k => k.key === key);
      if (found) return found;
    }
    return null;
  }
}

// Singleton instance for global access
let globalRotator: ApiKeyRotator | null = null;

export function getGlobalRotator(): ApiKeyRotator {
  if (!globalRotator) {
    globalRotator = new ApiKeyRotator();
  }
  return globalRotator;
}

export function initializeGlobalRotator(envFileContent: string): ApiKeyRotator {
  globalRotator = new ApiKeyRotator();
  globalRotator.loadFromEnvFile(envFileContent);
  return globalRotator;
}
