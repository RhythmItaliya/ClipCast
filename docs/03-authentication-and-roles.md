# ClipCast — 03 — Authentication & roles

`clipcast-frontend/src/server/auth/config.ts` (config) +
`src/server/auth/index.ts` (exports `auth()`, wired into
`src/app/api/auth/[...nextauth]/route.ts`).

## Providers

Three, registered in `authConfig.providers`:

1. **Credentials** — email + password. `authorize()` looks the user up by
   email, compares the password with `comparePasswords()`
   (`src/lib/auth.ts`, bcrypt), and rejects if `user.banned` is true. Signup
   (`signUp()` in `src/actions/auth.ts`) hashes the password with
   `hashPassword()` before creating the `User` row.
2. **Discord** — always registered.
3. **Google** — conditionally registered, only when both `GOOGLE_CLIENT_ID`
   and `GOOGLE_CLIENT_SECRET` are set, so a missing OAuth app never crashes
   auth setup in an environment that doesn't need it. This is the *same*
   Google OAuth client used for the YouTube channel-connect feature
   (`src/actions/youtube.ts`), though that flow does its own separate
   authorization-code exchange rather than going through NextAuth's session.

`allowDangerousEmailAccountLinking: true` on both OAuth providers — a user who
signed up with email/password and later clicks "Sign in with Google" using the
same email address gets linked to the same account rather than blocked.

## Sessions: JWT, not database

`session: { strategy: "jwt" }`. Two callbacks make this work with roles:

- **`jwt({ token, user })`** — on sign-in only (`user` is only present then),
  re-fetches the user's `role` from the DB and stamps it (plus `id`) onto the
  token. This means a role change takes effect on the user's *next* sign-in,
  not instantly — the admin panel's `setUserRole()` action correctly returns a
  cache-revalidation, not a session-forcing one.
- **`session({ session, token })`** — copies `id`/`role` from the token onto
  `session.user`, and the module augments NextAuth's `Session`/`JWT` types
  (`declare module "next-auth"` / `"@auth/core/jwt"`) so `session.user.role`
  and `session.user.id` are typed everywhere without casts.

## Role-based access control

Two independent layers, deliberately redundant:

1. **Route layout guards** — every `/admin/*` page is under
   `src/app/admin/layout.tsx`, which calls `auth()` and:
   - redirects to `/login` if there's no session,
   - **redirects to `/dashboard` (not a 403) if `role !== "ADMIN"`** — regular
     users never see evidence that `/admin` exists.
   `src/app/dashboard/layout.tsx` does the equivalent "must be signed in"
   check for the regular app.
2. **Per-action guards** — every mutating/reading function in
   `src/actions/admin.ts` calls a `requireAdmin()` helper that independently
   re-checks the session and role, throwing if the caller isn't an admin. This
   means the check holds even if a server action were ever called from
   somewhere other than an `/admin` page — the UI guard is not the only line
   of defense.

`requireAdmin()` returns `{ id, email }` (not just the id) specifically so
mutations can attribute an `AdminAuditLog` entry (see
[08-admin-panel.md](08-admin-panel.md)) without an extra DB round-trip.

## How to build it from scratch

**Step 1 — install.**

```bash
npm install next-auth@beta @auth/prisma-adapter bcryptjs
npx auth secret   # generates AUTH_SECRET
```

**Step 2 — password hashing helpers** (`src/lib/auth.ts` — the entire file):

```ts
import { hash, compare } from "bcryptjs";

export async function hashPassword(password: string) {
  return hash(password, 12);
}

export async function comparePasswords(plainPassword: string, hashedPassword: string) {
  return compare(plainPassword, hashedPassword);
}
```

**Step 3 — the config**, `src/server/auth/config.ts`. First, augment
NextAuth's types so `role`/`id` are typed everywhere without a cast:

```ts
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: { id: string; role: "USER" | "ADMIN" } & DefaultSession["user"];
  }
}
declare module "@auth/core/jwt" {
  interface JWT { id?: string; role?: "USER" | "ADMIN"; }
}
```

Then the actual config object:

```ts
export const authConfig = {
  trustHost: true, // required for `next start` on self-hosted/localhost
  pages: { signIn: "/login" },
  providers: [
    // Only registered when both are set — a missing OAuth app config never
    // crashes auth setup in an environment that doesn't need it.
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [GoogleProvider({
          clientId: env.GOOGLE_CLIENT_ID,
          clientSecret: env.GOOGLE_CLIENT_SECRET,
          allowDangerousEmailAccountLinking: true,
        })]
      : []),
    DiscordProvider({
      clientId: env.AUTH_DISCORD_ID,
      clientSecret: env.AUTH_DISCORD_SECRET,
      allowDangerousEmailAccountLinking: true,
    }),
    CredentialsProvider({
      name: "credentials",
      credentials: {
        email: { label: "Email", type: "email" },
        password: { label: "Password", type: "password" },
      },
      async authorize(credentials) {
        if (!credentials?.email || !credentials?.password) return null;
        const user = await db.user.findUnique({ where: { email: credentials.email as string } });
        if (!user) return null;
        const ok = await comparePasswords(credentials.password as string, user.password ?? "");
        if (!ok) return null;
        if (user.banned) return null; // banned users cannot sign in at all
        return user;
      },
    }),
  ],
  session: { strategy: "jwt" },
  adapter: PrismaAdapter(db),
  callbacks: {
    // Runs on sign-in only (`user` present). Pull the fresh role from the DB
    // so it can't go stale inside a long-lived JWT.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        const dbUser = await db.user.findUnique({ where: { id: user.id }, select: { role: true } });
        token.role = dbUser?.role ?? "USER";
      }
      return token;
    },
    session({ session, token }) {
      return { ...session, user: { ...session.user, id: token.sub ?? token.id ?? "", role: token.role ?? "USER" } };
    },
  },
} satisfies NextAuthConfig;
```

**Step 4 — wire up the route + `auth()` helper.** `src/server/auth/index.ts`
exports `auth`, `handlers`, `signIn`, `signOut` from `NextAuth(authConfig)`,
and `src/app/api/auth/[...nextauth]/route.ts` just re-exports
`{ GET, POST } = handlers`. Anywhere else in the app (server components,
server actions), `await auth()` gets the typed session.

**Step 5 — the two RBAC layers.** First, the layout guard —
`src/app/admin/layout.tsx`:

```tsx
export default async function AdminLayout({ children }: { children: ReactNode }) {
  const session = await auth();
  if (!session?.user?.id) redirect("/login");
  if (session.user.role !== "ADMIN") redirect("/dashboard"); // not a 403 — regular users never learn /admin exists
  // ...fetch fresh user, render <AdminShell>
}
```

Second, the per-action guard — every function in `src/actions/admin.ts`
starts with this (real code):

```ts
async function requireAdmin() {
  const session = await auth();
  if (!session?.user?.id || session.user.role !== "ADMIN") {
    throw new Error("Unauthorized: admin access required.");
  }
  return { id: session.user.id, email: session.user.email ?? "" };
}

// then, in every exported action:
export async function setUserBanned(userId: string, banned: boolean) {
  const admin = await requireAdmin();
  // ...
}
```

Returning `{ id, email }` (not just the id) means mutations can write an
`AdminAuditLog` entry (see [08-admin-panel.md](08-admin-panel.md)) without a
second query to look up the admin's email.

## Next

[04-frontend-app-structure.md](04-frontend-app-structure.md) — how the rest of
the app is organized around this.
