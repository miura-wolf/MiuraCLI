// src/env.ts - Zero-dependency .env loader for MiuraSwarm
// Searches for .env in multiple locations:
// 1. Current working directory (process.cwd())
// 2. User home ~/.miura/.env
// 3. Project directory (where package.json is)
import { readFileSync, existsSync } from "node:fs";
import { join, dirname } from "node:path";
import { homedir } from "node:os";
import { fileURLToPath } from "node:url";

function parseEnvFile(filePath: string): Record<string, string> {
	const vars: Record<string, string> = {};
	if (!existsSync(filePath)) return vars;

	const content = readFileSync(filePath, "utf-8");
	for (const line of content.split("\n")) {
		const trimmed = line.trim();
		if (!trimmed || trimmed.startsWith("#")) continue;

		const eqIndex = trimmed.indexOf("=");
		if (eqIndex === -1) continue;

		const key = trimmed.slice(0, eqIndex).trim();
		let value = trimmed.slice(eqIndex + 1).trim();

		// Strip inline comments (e.g., VALUE # comment)
		if (!value.startsWith('"') && !value.startsWith("'")) {
			const hashIndex = value.indexOf("#");
			if (hashIndex !== -1) {
				value = value.slice(0, hashIndex).trim();
			}
		}

		if (
			(value.startsWith('"') && value.endsWith('"')) ||
			(value.startsWith("'") && value.endsWith("'"))
		) {
			value = value.slice(1, -1);
		}

		vars[key] = value;
	}
	return vars;
}

export function loadEnv(): void {
	// Determine project root (where package.json lives)
	const __filename = fileURLToPath(import.meta.url);
	const __dirname = dirname(__filename);

	// Try multiple .env locations in order of priority
	const searchPaths = [
		join(process.cwd(), ".env"), // CWD
		join(homedir(), ".miura", ".env"), // ~/.miura/.env
		join(__dirname, "..", ".env"), // Project root (from src/env.ts)
		join(__dirname, "..", "..", ".env"), // Project root (from dist/env.js)
	];

	// Deduplicate
	const seen = new Set<string>();
	const envFiles = searchPaths.filter((p) => {
		if (seen.has(p)) return false;
		seen.add(p);
		return true;
	});

	// Load all env files (later files don't override earlier ones)
	const allVars: Record<string, string> = {};
	for (const envPath of envFiles) {
		const vars = parseEnvFile(envPath);
		Object.assign(allVars, vars); // First file wins
	}

	// Apply to process.env (existing env vars take precedence)
	for (const [key, value] of Object.entries(allVars)) {
		if (!process.env[key]) {
			process.env[key] = value;
		}
	}
}
