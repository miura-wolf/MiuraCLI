/**
 * Initialize MiuraSwarm with API key rotation
 * 
 * This script loads API keys from the env file and initializes the global rotator
 */

import { initializeGlobalRotator, getGlobalRotator } from './core/api-key-rotator.js';
import { readFileSync } from 'fs';
import { getRuntimeConfig } from './config.js';

export function initializeMiuraSwarm(envFilePath?: string): void {
  const runtime = getRuntimeConfig();
  const defaultPath = runtime.apiKeysPath;
  const pathToUse = envFilePath || process.env.API_KEYS_PATH || defaultPath;

  try {
    const content = readFileSync(pathToUse, 'utf-8');
    initializeGlobalRotator(content);
    
    const rotator = getGlobalRotator();
    const stats = rotator.getStats();
    
    console.log('✅ MiuraSwarm initialized with API key rotation');
    console.log('📊 Loaded keys by provider:');
    
    for (const [provider, stat] of Object.entries(stats)) {
      console.log(`   - ${provider.toUpperCase()}: ${stat.total} keys (${stat.healthy} healthy)`);
    }
  } catch (error) {
    console.warn('⚠️  Could not load API keys from:', pathToUse);
    console.warn('   Error:', error instanceof Error ? error.message : String(error));
    console.warn('   MiuraSwarm will use environment variables instead.');
  }
}

// Auto-initialize if this is the main entry point
if (import.meta.url === `file://${process.argv[1]}`) {
  const pathArg = process.argv[2];
  initializeMiuraSwarm(pathArg);
}
