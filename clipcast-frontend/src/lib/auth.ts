/**
 * Password hashing helpers shared by sign-up, the credentials login provider,
 * and the login-OTP flow (which hashes the emailed code, not just passwords).
 *
 * Uses bcrypt (via bcryptjs, a pure-JS impl with no native build step) because
 * it's deliberately slow and salts each hash automatically — the standard
 * defence against offline brute-forcing of leaked hashes.
 */
import { hash, compare } from "bcryptjs";

// Cost factor 12 = 2^12 rounds: the usual balance between login latency and
// resistance to brute force. Raise it as hardware gets faster.
export async function hashPassword(password: string) {
  return hash(password, 12);
}

export async function comparePasswords(
  plainPassword: string,
  hashedPassword: string,
) {
  return compare(plainPassword, hashedPassword);
}
