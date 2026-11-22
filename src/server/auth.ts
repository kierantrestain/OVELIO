import { createHash, randomBytes } from 'node:crypto';
import { cookies } from 'next/headers';
import type { Role, User } from '../contracts';
import { AppError, appOrigin, emailKey } from './config';
import { db, transaction } from './db';
import { hashPassword, verifyPassword } from './password';

const SESSION = 'ovelio_session';
const lifetime = 12 * 60 * 60;
const digest = (value: string) => createHash('sha256').update(value).digest('hex');
const rank: Record<Role, number> = { admin: 3, marketer: 2, analyst: 1 };
const columns = 'id, email, name, role';
type UserWithPassword = User & { password_hash: string };

export async function rateLimit(bucket: string, limit: number, seconds: number) {
  const result = await db.query<{ count: number }>(
    `INSERT INTO rate_limits (bucket, window_start, count)
     VALUES ($1, date_bin(make_interval(secs => $2), now(), '2000-01-01'::timestamptz), 1)
     ON CONFLICT (bucket, window_start) DO UPDATE SET count = rate_limits.count + 1
     RETURNING count`,
    [bucket, seconds],
  );
  if (result.rows[0].count > limit) throw new AppError(429, 'Too many attempts. Try again after a short wait.');
}

export async function signIn(email: string, password: string) {
  const normalized = email.trim().toLowerCase();
  await rateLimit('login:global', 180, 900);
  await rateLimit('login:' + emailKey(normalized), 10, 900);
  const entry = await db.query<UserWithPassword>(
    `SELECT ${columns}, password_hash FROM users WHERE email = $1 AND disabled_at IS NULL`,
    [normalized],
  );
  const match = entry.rows[0];
  if (!await verifyPassword(password, match?.password_hash) || !match) {
    throw new AppError(401, 'The email or password is incorrect.');
  }
  const jar = await cookies();
  const current = jar.get(SESSION)?.value;
  const token = randomBytes(32).toString('base64url');
  await transaction(async client => {
    if (current) await client.query('DELETE FROM sessions WHERE token_hash = $1', [digest(current)]);
    await client.query(
      'INSERT INTO sessions (token_hash, user_id, expires_at) VALUES ($1, $2, now() + make_interval(secs => $3))',
      [digest(token), match.id, lifetime],
    );
  });
  jar.set(SESSION, token, { httpOnly: true, secure: appOrigin().startsWith('https:'), sameSite: 'lax', maxAge: lifetime, path: '/' });
  return { id: match.id, email: match.email, name: match.name, role: match.role } satisfies User;
}

export async function currentUser(): Promise<User | null> {
  const token = (await cookies()).get(SESSION)?.value;
  if (!token) return null;
  const user = await db.query<User>(
    `SELECT u.id, u.email, u.name, u.role FROM sessions s JOIN users u ON u.id = s.user_id
     WHERE s.token_hash = $1 AND s.expires_at > now() AND u.disabled_at IS NULL`,
    [digest(token)],
  );
  return user.rows[0] ?? null;
}

export async function requireUser(role: Role = 'analyst') {
  const user = await currentUser();
  if (!user) throw new AppError(401, 'Sign in to continue.');
  if (rank[user.role] < rank[role]) throw new AppError(403, 'Your role does not have permission for this action.');
  return user;
}

export async function signOut() {
  const jar = await cookies();
  const token = jar.get(SESSION)?.value;
  if (token) await db.query('DELETE FROM sessions WHERE token_hash = $1', [digest(token)]);
  jar.delete(SESSION);
}

export async function team() {
  return (await db.query<User>(
    `SELECT ${columns}, (disabled_at IS NOT NULL) AS disabled FROM users ORDER BY (disabled_at IS NOT NULL), created_at`,
  )).rows;
}

export async function addUser(input: { email: string; name: string; role: Role; password: string }) {
  const passwordHash = await hashPassword(input.password);
  const result = await db.query<User>(
    `INSERT INTO users (email, name, role, password_hash) VALUES ($1, $2, $3, $4)
     ON CONFLICT (email) DO NOTHING RETURNING ${columns}, (disabled_at IS NOT NULL) AS disabled`,
    [input.email.trim().toLowerCase(), input.name, input.role, passwordHash],
  );
  if (!result.rows[0]) throw new AppError(409, 'There is already a team account with that email.');
  return result.rows[0];
}

export async function changeUser(id: string, input: { role?: Role; disabled?: boolean; password?: string }) {
  const password = input.password ? await hashPassword(input.password) : null;
  return transaction(async client => {
    await client.query('SELECT pg_advisory_xact_lock(64337001)');
    const existing = (await client.query<User & { disabled: boolean }>(
      'SELECT id, email, name, role, (disabled_at IS NOT NULL) AS disabled FROM users WHERE id = $1',
      [id],
    )).rows[0];
    if (!existing) throw new AppError(404, 'Team account not found.');
    if (!existing.disabled && existing.role === 'admin' && (input.disabled === true || (input.role && input.role !== 'admin'))) {
      const admins = await client.query<{ count: string }>(`SELECT count(*) FROM users WHERE role = 'admin' AND disabled_at IS NULL`);
      if (Number(admins.rows[0].count) < 2) throw new AppError(409, 'Keep at least one active administrator.');
    }
    const disabledOp = input.disabled === true ? 'disable' : input.disabled === false ? 'enable' : 'keep';
    const result = await client.query<User>(
      `UPDATE users SET role = COALESCE($2, role), password_hash = COALESCE($3, password_hash),
       disabled_at = CASE WHEN $4 = 'disable' THEN now() WHEN $4 = 'enable' THEN NULL ELSE disabled_at END
       WHERE id = $1 RETURNING ${columns}, (disabled_at IS NOT NULL) AS disabled`,
      [id, input.role ?? null, password, disabledOp],
    );
    if (password || input.disabled === true) await client.query('DELETE FROM sessions WHERE user_id = $1', [id]);
    return result.rows[0];
  });
}
