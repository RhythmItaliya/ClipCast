import { PrismaAdapter } from "@auth/prisma-adapter";
import { type DefaultSession, type NextAuthConfig } from "next-auth";
import CredentialsProvider from "next-auth/providers/credentials";
import DiscordProvider from "next-auth/providers/discord";
import GoogleProvider from "next-auth/providers/google";
import { env } from "~/env";
import { comparePasswords } from "~/lib/auth";
import { db } from "~/server/db";

// ── Type augmentation — adds `id` and `role` to the session user object ──────
declare module "next-auth" {
  interface Session extends DefaultSession {
    user: {
      id: string;
      role: "USER" | "ADMIN";
    } & DefaultSession["user"];
  }
}

declare module "@auth/core/jwt" {
  interface JWT {
    id?: string;
    role?: "USER" | "ADMIN";
  }
}

export const authConfig = {
  // Required for production (`next start`) on self-hosted/localhost.
  trustHost: true,
  pages: {
    signIn: "/login",
  },
  providers: [
    // Google OAuth is only registered when credentials are present so a
    // missing GOOGLE_CLIENT_ID never crashes the auth setup.
    ...(env.GOOGLE_CLIENT_ID && env.GOOGLE_CLIENT_SECRET
      ? [
          GoogleProvider({
            clientId: env.GOOGLE_CLIENT_ID,
            clientSecret: env.GOOGLE_CLIENT_SECRET,
            allowDangerousEmailAccountLinking: true,
          }),
        ]
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

        const user = await db.user.findUnique({
          where: { email: credentials.email as string },
        });
        if (!user) return null;

        const ok = await comparePasswords(
          credentials.password as string,
          user.password ?? "",
        );
        if (!ok) return null;

        // Banned users cannot sign in at all.
        if (user.banned) return null;

        return user;
      },
    }),
  ],
  session: { strategy: "jwt" },
  adapter: PrismaAdapter(db),
  callbacks: {
    // Persist role + id from the DB into the JWT on every sign-in.
    async jwt({ token, user }) {
      if (user) {
        token.id = user.id;
        // Pull the role from the DB so it's always fresh on sign-in.
        const dbUser = await db.user.findUnique({
          where: { id: user.id },
          select: { role: true },
        });
        token.role = dbUser?.role ?? "USER";
      }
      return token;
    },
    // Expose id + role to every `useSession` / `auth()` call.
    session({ session, token }) {
      return {
        ...session,
        user: {
          ...session.user,
          id: token.sub ?? token.id ?? "",
          role: token.role ?? "USER",
        },
      };
    },
  },
} satisfies NextAuthConfig;
