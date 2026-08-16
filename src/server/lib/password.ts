import { argon2id, argon2Verify } from "hash-wasm";
import { randomBytes } from "node:crypto";

/**
 * argon2id via hash-wasm (pure WASM, no native build toolchain) — see
 * docs/specs/pilot-foundations.md §7. Minimum 12 chars, no composition rules,
 * no forced rotation: both increase password reuse rather than reducing risk.
 */
export async function hashPassword(password: string): Promise<string> {
  if (password.length < 12) {
    throw new Error("Password must be at least 12 characters");
  }
  const salt = randomBytes(16);
  return argon2id({
    password,
    salt,
    parallelism: 1,
    iterations: 3,
    memorySize: 19456, // ~19 MiB, OWASP minimum recommendation for argon2id
    hashLength: 32,
    outputType: "encoded",
  });
}

export async function verifyPassword(password: string, hash: string): Promise<boolean> {
  return argon2Verify({ password, hash });
}
