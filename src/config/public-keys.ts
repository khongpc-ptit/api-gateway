import crypto from 'crypto';

export interface PublicKeyConfig {
  [kid: string]: string;
}

/**
 * In-memory manager for RS256 Public Keys with Key ID (kid) support.
 * Complies with BA - SOA.md §19 for zero-downtime key rotation with >= 16 min overlap.
 */
export class PublicKeyStore {
  private keys: Map<string, string> = new Map();

  constructor(initialKeysJson?: string) {
    if (initialKeysJson) {
      this.loadFromJson(initialKeysJson);
    }
  }

  /**
   * Load and parse keys from a JSON string mapping kid -> PEM public key.
   */
  public loadFromJson(jsonString: string): void {
    let parsed: Record<string, unknown>;
    try {
      parsed = JSON.parse(jsonString);
    } catch (err) {
      throw new Error(`Failed to parse JWT_PUBLIC_KEYS_JSON: ${(err as Error).message}`);
    }

    if (typeof parsed !== 'object' || parsed === null) {
      throw new Error('JWT_PUBLIC_KEYS_JSON must be an object');
    }

    for (const [kid, pem] of Object.entries(parsed)) {
      if (typeof pem !== 'string') {
        throw new Error(`Public key for kid '${kid}' must be a PEM string`);
      }
      this.addKey(kid, pem);
    }
  }

  /**
   * Add or update a public key for a given kid.
   * Validates that the PEM string is a valid RSA public key.
   */
  public addKey(kid: string, pem: string): void {
    if (!kid || typeof kid !== 'string') {
      throw new Error('kid must be a non-empty string');
    }

    const normalizedPem = pem.replace(/\\n/g, '\n').trim();

    try {
      crypto.createPublicKey(normalizedPem);
    } catch (err) {
      throw new Error(`Invalid RSA Public Key for kid '${kid}': ${(err as Error).message}`);
    }

    this.keys.set(kid, normalizedPem);
  }

  /**
   * Retrieve the public key PEM for a given kid.
   */
  public getKey(kid: string): string | undefined {
    return this.keys.get(kid);
  }

  /**
   * Check if a given kid exists.
   */
  public hasKey(kid: string): boolean {
    return this.keys.has(kid);
  }

  /**
   * Get all registered Key IDs.
   */
  public getAvailableKids(): string[] {
    return Array.from(this.keys.keys());
  }

  /**
   * Clear all registered keys (useful for tests).
   */
  public clear(): void {
    this.keys.clear();
  }
}

// Global default instance initialized with environment variables
let defaultStore: PublicKeyStore | null = null;

export function getPublicKeyStore(initialKeysJson?: string): PublicKeyStore {
  if (!defaultStore) {
    defaultStore = new PublicKeyStore(initialKeysJson);
  }
  return defaultStore;
}

export function resetPublicKeyStore(): void {
  defaultStore = null;
}
