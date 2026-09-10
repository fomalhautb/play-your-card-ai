-- better-auth 的建表语句，由它自己的 CLI 生成，不要手改。
-- 加插件或改字段之后重新生成的办法写在 packages/server/README.md「账号与鉴权」一节。
--
-- 五张表分别是：账号（user）、会话（session）、第三方登录的绑定关系（account）、
-- 一次性验证码（verification）、签 JWT 用的密钥对（jwks）。
-- 现在只开了游客登录，account 和 verification 是空的，
-- 但表得先建好——邮箱 / OAuth / Steam 接进来（迁移第 35 条）时就不用再动库了。
--
-- `user.isAnonymous` 是 anonymous 插件加的：绑定了正式账号之后它变回 0。
-- `jwks` 一行就是一对密钥：`publicKey` 是明文 JWK，`privateKey` 用 BETTER_AUTH_SECRET
-- 加密过（所以换密钥就得连这张表一起清）。握手验签只读 `id` / `publicKey` / `alg` / `crv`
-- 这四列，见 src/auth/verify.ts。

create table "user" ("id" text not null primary key, "name" text not null, "email" text not null unique, "emailVerified" integer not null, "image" text, "createdAt" date not null, "updatedAt" date not null, "isAnonymous" integer);

create table "session" ("id" text not null primary key, "expiresAt" date not null, "token" text not null unique, "createdAt" date not null, "updatedAt" date not null, "ipAddress" text, "userAgent" text, "userId" text not null references "user" ("id") on delete cascade);

create table "account" ("id" text not null primary key, "accountId" text not null, "providerId" text not null, "userId" text not null references "user" ("id") on delete cascade, "accessToken" text, "refreshToken" text, "idToken" text, "accessTokenExpiresAt" date, "refreshTokenExpiresAt" date, "scope" text, "password" text, "createdAt" date not null, "updatedAt" date not null);

create table "verification" ("id" text not null primary key, "identifier" text not null, "value" text not null, "expiresAt" date not null, "createdAt" date not null, "updatedAt" date not null);

create table "jwks" ("id" text not null primary key, "publicKey" text not null, "privateKey" text not null, "createdAt" date not null, "expiresAt" date, "alg" text, "crv" text);

create index "session_userId_idx" on "session" ("userId");

create index "account_userId_idx" on "account" ("userId");

create index "verification_identifier_idx" on "verification" ("identifier");
