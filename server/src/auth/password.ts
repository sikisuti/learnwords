import { randomBytes, scrypt, timingSafeEqual, type ScryptOptions } from 'node:crypto';

// N=2^14 keeps a hash at ~16 MB RAM and well under a second on a Raspberry Pi 3.
const PARAMS: ScryptOptions = { N: 16384, r: 8, p: 1 };
const KEY_LENGTH = 32;

function derive(password: string, salt: Buffer): Promise<Buffer> {
  return new Promise((resolve, reject) =>
    scrypt(password.normalize('NFKC'), salt, KEY_LENGTH, PARAMS, (err, key) => (err ? reject(err) : resolve(key))),
  );
}

/** Returns a self-describing hash: scrypt$N$r$p$salt$key (base64). */
export async function hashPassword(password: string): Promise<string> {
  const salt = randomBytes(16);
  const key = await derive(password, salt);
  return ['scrypt', PARAMS.N, PARAMS.r, PARAMS.p, salt.toString('base64'), key.toString('base64')].join('$');
}

export async function verifyPassword(password: string, stored: string): Promise<boolean> {
  const [scheme, n, r, p, salt, key] = stored.split('$');
  if (scheme !== 'scrypt' || !salt || !key) return false;
  const expected = Buffer.from(key, 'base64');
  const actual = await new Promise<Buffer>((resolve, reject) =>
    scrypt(password.normalize('NFKC'), Buffer.from(salt, 'base64'), expected.length, { N: +n, r: +r, p: +p }, (err, k) =>
      err ? reject(err) : resolve(k),
    ),
  );
  return timingSafeEqual(actual, expected);
}
