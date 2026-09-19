// server/_core/index.ts
import "dotenv/config";
import express2 from "express";
import { createServer } from "http";
import net from "net";
import { createExpressMiddleware } from "@trpc/server/adapters/express";

// shared/const.ts
var COOKIE_NAME = "app_session_id";
var ONE_YEAR_MS = 1e3 * 60 * 60 * 24 * 365;
var AXIOS_TIMEOUT_MS = 3e4;
var UNAUTHED_ERR_MSG = "Please login (10001)";
var NOT_ADMIN_ERR_MSG = "You do not have required permission (10002)";
var OAUTH_STATE_COOKIE = "__Host-oauth_state";
var decodeOAuthState = (state) => {
  let decoded;
  try {
    decoded = atob(state);
  } catch {
    return { redirectUri: "" };
  }
  try {
    const parsed = JSON.parse(decoded);
    if (parsed && typeof parsed.redirectUri === "string") return parsed;
  } catch {
  }
  return { redirectUri: decoded };
};

// server/_core/oauth.ts
import { parse as parseCookieHeader2 } from "cookie";

// server/db.ts
import { asc, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";

// drizzle/schema.ts
import { index, int, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";
var users = mysqlTable("users", {
  id: int("id").autoincrement().primaryKey(),
  openId: varchar("openId", { length: 64 }).notNull().unique(),
  name: text("name"),
  email: varchar("email", { length: 320 }),
  loginMethod: varchar("loginMethod", { length: 64 }),
  role: mysqlEnum("role", ["user", "admin"]).default("user").notNull(),
  username: varchar("username", { length: 32 }).unique(),
  bio: varchar("bio", { length: 240 }),
  lastSeenAt: timestamp("lastSeenAt").defaultNow().notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull()
}, (table) => ({ usernameIdx: index("users_username_idx").on(table.username) }));
var messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: varchar("content", { length: 600 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ userIdx: index("messages_user_idx").on(table.userId), createdIdx: index("messages_created_idx").on(table.createdAt) }));
var plans = mysqlTable("plans", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description"),
  planDate: timestamp("planDate").notNull(),
  location: varchar("location", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ dateIdx: index("plans_date_idx").on(table.planDate), creatorIdx: index("plans_creator_idx").on(table.creatorId) }));
var planParticipants = mysqlTable("planParticipants", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull().references(() => plans.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["going", "not_going"]).notNull().default("going"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
}, (table) => ({ pair: unique("plan_participant_pair").on(table.planId, table.userId), planIdx: index("participants_plan_idx").on(table.planId) }));
var announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  authorId: int("authorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 140 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
}, (table) => ({ createdIdx: index("announcements_created_idx").on(table.createdAt) }));
var albums = mysqlTable("albums", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  description: varchar("description", { length: 240 }),
  coverUrl: text("coverUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var photos = mysqlTable("photos", {
  id: int("id").autoincrement().primaryKey(),
  albumId: int("albumId").notNull().references(() => albums.id, { onDelete: "cascade" }),
  uploaderId: int("uploaderId").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  fileKey: text("fileKey").notNull(),
  caption: varchar("caption", { length: 180 }),
  createdAt: timestamp("createdAt").defaultNow().notNull()
});
var settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 80 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull()
});

// server/_core/env.ts
var ENV = {
  appId: process.env.VITE_APP_ID ?? "",
  cookieSecret: process.env.JWT_SECRET ?? "",
  databaseUrl: process.env.DATABASE_URL ?? "",
  oAuthServerUrl: process.env.OAUTH_SERVER_URL ?? "",
  ownerOpenId: process.env.OWNER_OPEN_ID ?? "",
  isProduction: process.env.NODE_ENV === "production",
  forgeApiUrl: process.env.BUILT_IN_FORGE_API_URL ?? "",
  forgeApiKey: process.env.BUILT_IN_FORGE_API_KEY ?? ""
};

// server/db.ts
var _db = null;
async function getDb() {
  if (!_db && process.env.DATABASE_URL) {
    try {
      _db = drizzle(process.env.DATABASE_URL);
    } catch (error) {
      console.warn("[Database] Failed to connect:", error);
      _db = null;
    }
  }
  return _db;
}
async function upsertUser(user) {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const isOwner = user.openId === ENV.ownerOpenId;
  const values = { openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: user.role ?? (isOwner ? "admin" : "user"), lastSignedIn: user.lastSignedIn ?? /* @__PURE__ */ new Date() };
  const updateSet = { name: values.name, email: values.email, loginMethod: values.loginMethod, lastSignedIn: values.lastSignedIn };
  if (user.role) updateSet.role = user.role;
  else if (isOwner) updateSet.role = "admin";
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}
async function getUserByOpenId(openId) {
  const db = await getDb();
  if (!db) return void 0;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}
async function touchUser(userId) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSeenAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId));
}
async function getOverview() {
  const db = await getDb();
  if (!db) return { members: [], messages: [], plans: [], announcements: [], albums: [], stats: { memberCount: 10, onlineCount: 4, messageCount: 0, albumCount: 0 } };
  const expiry = new Date(Date.now() - 24 * 60 * 60 * 1e3);
  await db.delete(messages).where(lt(messages.createdAt, expiry));
  const [memberRows, messageRows, planRows, announcementRows, albumRows] = await Promise.all([
    db.select({ id: users.id, username: users.username, name: users.name, bio: users.bio, role: users.role, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt }).from(users).orderBy(desc(users.lastSeenAt)).limit(20),
    db.select({ id: messages.id, content: messages.content, createdAt: messages.createdAt, userId: users.id, username: users.username, name: users.name }).from(messages).leftJoin(users, eq(messages.userId, users.id)).where(gte(messages.createdAt, expiry)).orderBy(asc(messages.createdAt)).limit(100),
    db.select({ id: plans.id, title: plans.title, description: plans.description, planDate: plans.planDate, location: plans.location, createdAt: plans.createdAt, creatorId: users.id, creatorUsername: users.username, creatorName: users.name }).from(plans).leftJoin(users, eq(plans.creatorId, users.id)).orderBy(asc(plans.planDate)).limit(20),
    db.select({ id: announcements.id, title: announcements.title, content: announcements.content, createdAt: announcements.createdAt, authorId: users.id, authorUsername: users.username, authorName: users.name }).from(announcements).leftJoin(users, eq(announcements.authorId, users.id)).orderBy(desc(announcements.createdAt)).limit(10),
    db.select({ id: albums.id, title: albums.title, description: albums.description, coverUrl: albums.coverUrl, createdAt: albums.createdAt, creatorUsername: users.username }).from(albums).leftJoin(users, eq(albums.creatorId, users.id)).orderBy(desc(albums.createdAt)).limit(12)
  ]);
  return { members: memberRows, messages: messageRows, plans: planRows, announcements: announcementRows, albums: albumRows, stats: { memberCount: memberRows.length, onlineCount: memberRows.filter((m) => m.lastSeenAt && m.lastSeenAt.getTime() > Date.now() - 15 * 60 * 1e3).length, messageCount: messageRows.length, albumCount: albumRows.length } };
}
async function searchMembers(search) {
  const db = await getDb();
  if (!db) return [];
  const query = search?.trim();
  const condition = query ? or(like(users.username, `%${query}%`), like(users.name, `%${query}%`)) : void 0;
  return db.select({ id: users.id, username: users.username, name: users.name, bio: users.bio, role: users.role, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt }).from(users).where(condition).orderBy(asc(users.username)).limit(30);
}
async function updateProfile(userId, username, bio) {
  const db = await getDb();
  if (!db) return void 0;
  await db.update(users).set({ username, bio, updatedAt: /* @__PURE__ */ new Date() }).where(eq(users.id, userId));
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}
async function addMessage(userId, content) {
  const db = await getDb();
  if (!db) return { id: Date.now(), userId, content, createdAt: /* @__PURE__ */ new Date() };
  const result = await db.insert(messages).values({ userId, content }).$returningId();
  return { id: result[0]?.id ?? Date.now(), userId, content, createdAt: /* @__PURE__ */ new Date() };
}
async function addPlan(userId, title, description, planDate, location) {
  const db = await getDb();
  if (!db) return { id: Date.now(), creatorId: userId, title, description, planDate, location, createdAt: /* @__PURE__ */ new Date() };
  const result = await db.insert(plans).values({ creatorId: userId, title, description, planDate, location }).$returningId();
  return { id: result[0]?.id ?? Date.now(), creatorId: userId, title, description, planDate, location, createdAt: /* @__PURE__ */ new Date() };
}
async function addAnnouncement(userId, title, content) {
  const db = await getDb();
  if (!db) return { id: Date.now(), authorId: userId, title, content, createdAt: /* @__PURE__ */ new Date() };
  const result = await db.insert(announcements).values({ authorId: userId, title, content }).$returningId();
  return { id: result[0]?.id ?? Date.now(), authorId: userId, title, content, createdAt: /* @__PURE__ */ new Date() };
}
async function setSetting(key, value) {
  const db = await getDb();
  if (!db) return;
  await db.insert(settings).values({ key, value }).onDuplicateKeyUpdate({ set: { value, updatedAt: /* @__PURE__ */ new Date() } });
}
async function getSettings() {
  const db = await getDb();
  if (!db) return { siteName: "PIE", slogan: "Made to be connected." };
  const rows = await db.select().from(settings);
  return rows.reduce((acc, row) => {
    acc[row.key] = row.value;
    return acc;
  }, { siteName: "PIE", slogan: "Made to be connected." });
}
async function getAlbumPhotos(albumId) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: photos.id, url: photos.url, caption: photos.caption, createdAt: photos.createdAt, uploaderUsername: users.username }).from(photos).leftJoin(users, eq(photos.uploaderId, users.id)).where(eq(photos.albumId, albumId)).orderBy(desc(photos.createdAt));
}
async function createAlbum(userId, title, description) {
  const db = await getDb();
  if (!db) return { id: Date.now(), creatorId: userId, title, description, createdAt: /* @__PURE__ */ new Date() };
  const result = await db.insert(albums).values({ creatorId: userId, title, description }).$returningId();
  return { id: result[0]?.id ?? Date.now(), creatorId: userId, title, description, createdAt: /* @__PURE__ */ new Date() };
}
async function addPhoto(albumId, uploaderId, url, fileKey, caption) {
  const db = await getDb();
  if (!db) return { id: Date.now(), albumId, uploaderId, url, fileKey, caption: caption ?? null, createdAt: /* @__PURE__ */ new Date() };
  const result = await db.insert(photos).values({ albumId, uploaderId, url, fileKey, caption }).$returningId();
  return { id: result[0]?.id ?? Date.now(), albumId, uploaderId, url, fileKey, caption: caption ?? null, createdAt: /* @__PURE__ */ new Date() };
}
async function setAttendance(userId, planId, status) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.insert(planParticipants).values({ planId, userId, status }).onDuplicateKeyUpdate({ set: { status } });
  return { success: true };
}
async function removePlan(planId) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(plans).where(eq(plans.id, planId));
  return { success: true };
}
async function removeAnnouncement(announcementId) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(announcements).where(eq(announcements.id, announcementId));
  return { success: true };
}
async function removeAlbum(albumId) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(albums).where(eq(albums.id, albumId));
  return { success: true };
}
async function removeMessage(messageId) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(messages).where(eq(messages.id, messageId));
  return { success: true };
}

// server/_core/cookies.ts
function isSecureRequest(req) {
  if (req.protocol === "https") return true;
  const forwardedProto = req.headers["x-forwarded-proto"];
  if (!forwardedProto) return false;
  const protoList = Array.isArray(forwardedProto) ? forwardedProto : forwardedProto.split(",");
  return protoList.some((proto) => proto.trim().toLowerCase() === "https");
}
function getSessionCookieOptions(req) {
  return {
    httpOnly: true,
    path: "/",
    sameSite: "none",
    secure: isSecureRequest(req)
  };
}

// shared/_core/errors.ts
var HttpError = class extends Error {
  constructor(statusCode, message) {
    super(message);
    this.statusCode = statusCode;
    this.name = "HttpError";
  }
};
var ForbiddenError = (msg) => new HttpError(403, msg);

// server/_core/sdk.ts
import axios from "axios";
import { parse as parseCookieHeader } from "cookie";
import { SignJWT, jwtVerify } from "jose";
var isNonEmptyString = (value) => typeof value === "string" && value.length > 0;
var EXCHANGE_TOKEN_PATH = `/webdev.v1.WebDevAuthPublicService/ExchangeToken`;
var GET_USER_INFO_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfo`;
var GET_USER_INFO_WITH_JWT_PATH = `/webdev.v1.WebDevAuthPublicService/GetUserInfoWithJwt`;
var OAuthService = class {
  constructor(client) {
    this.client = client;
    console.log("[OAuth] Initialized with baseURL:", ENV.oAuthServerUrl);
    if (!ENV.oAuthServerUrl) {
      console.error(
        "[OAuth] ERROR: OAUTH_SERVER_URL is not configured! Set OAUTH_SERVER_URL environment variable."
      );
    }
  }
  decodeState(state) {
    return decodeOAuthState(state).redirectUri;
  }
  async getTokenByCode(code, state) {
    const payload = {
      clientId: ENV.appId,
      grantType: "authorization_code",
      code,
      redirectUri: this.decodeState(state)
    };
    const { data } = await this.client.post(
      EXCHANGE_TOKEN_PATH,
      payload
    );
    return data;
  }
  async getUserInfoByToken(token) {
    const { data } = await this.client.post(
      GET_USER_INFO_PATH,
      {
        accessToken: token.accessToken
      }
    );
    return data;
  }
};
var createOAuthHttpClient = () => axios.create({
  baseURL: ENV.oAuthServerUrl,
  timeout: AXIOS_TIMEOUT_MS
});
var SDKServer = class {
  client;
  oauthService;
  constructor(client = createOAuthHttpClient()) {
    this.client = client;
    this.oauthService = new OAuthService(this.client);
  }
  deriveLoginMethod(platforms, fallback) {
    if (fallback && fallback.length > 0) return fallback;
    if (!Array.isArray(platforms) || platforms.length === 0) return null;
    const set = new Set(
      platforms.filter((p) => typeof p === "string")
    );
    if (set.has("REGISTERED_PLATFORM_EMAIL")) return "email";
    if (set.has("REGISTERED_PLATFORM_GOOGLE")) return "google";
    if (set.has("REGISTERED_PLATFORM_APPLE")) return "apple";
    if (set.has("REGISTERED_PLATFORM_MICROSOFT") || set.has("REGISTERED_PLATFORM_AZURE"))
      return "microsoft";
    if (set.has("REGISTERED_PLATFORM_GITHUB")) return "github";
    const first = Array.from(set)[0];
    return first ? first.toLowerCase() : null;
  }
  /**
   * Exchange OAuth authorization code for access token
   * @example
   * const tokenResponse = await sdk.exchangeCodeForToken(code, state);
   */
  async exchangeCodeForToken(code, state) {
    return this.oauthService.getTokenByCode(code, state);
  }
  /**
   * Get user information using access token
   * @example
   * const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
   */
  async getUserInfo(accessToken) {
    const data = await this.oauthService.getUserInfoByToken({
      accessToken
    });
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  parseCookies(cookieHeader) {
    if (!cookieHeader) {
      return /* @__PURE__ */ new Map();
    }
    const parsed = parseCookieHeader(cookieHeader);
    return new Map(Object.entries(parsed));
  }
  getSessionSecret() {
    const secret = ENV.cookieSecret;
    return new TextEncoder().encode(secret);
  }
  /**
   * Create a session token for a Manus user openId
   * @example
   * const sessionToken = await sdk.createSessionToken(userInfo.openId);
   */
  async createSessionToken(openId, options = {}) {
    return this.signSession(
      {
        openId,
        appId: ENV.appId,
        name: options.name || ""
      },
      options
    );
  }
  async signSession(payload, options = {}) {
    const issuedAt = Date.now();
    const expiresInMs = options.expiresInMs ?? ONE_YEAR_MS;
    const expirationSeconds = Math.floor((issuedAt + expiresInMs) / 1e3);
    const secretKey = this.getSessionSecret();
    return new SignJWT({
      openId: payload.openId,
      appId: payload.appId,
      name: payload.name
    }).setProtectedHeader({ alg: "HS256", typ: "JWT" }).setExpirationTime(expirationSeconds).sign(secretKey);
  }
  async verifySession(cookieValue) {
    if (!cookieValue) {
      console.warn("[Auth] Missing session cookie");
      return null;
    }
    try {
      const secretKey = this.getSessionSecret();
      const { payload } = await jwtVerify(cookieValue, secretKey, {
        algorithms: ["HS256"]
      });
      const { openId, appId, name } = payload;
      if (!isNonEmptyString(openId) || !isNonEmptyString(appId) || !isNonEmptyString(name)) {
        console.warn("[Auth] Session payload missing required fields");
        return null;
      }
      return {
        openId,
        appId,
        name
      };
    } catch (error) {
      console.warn("[Auth] Session verification failed", String(error));
      return null;
    }
  }
  async getUserInfoWithJwt(jwtToken) {
    const payload = {
      jwtToken,
      projectId: ENV.appId
    };
    const { data } = await this.client.post(
      GET_USER_INFO_WITH_JWT_PATH,
      payload
    );
    const loginMethod = this.deriveLoginMethod(
      data?.platforms,
      data?.platform ?? data.platform ?? null
    );
    return {
      ...data,
      platform: loginMethod,
      loginMethod
    };
  }
  async authenticateRequest(req) {
    const cookies = this.parseCookies(req.headers.cookie);
    let sessionToken = cookies.get(COOKIE_NAME);
    if (!sessionToken) {
      const authHeader = req.headers.authorization;
      if (typeof authHeader === "string" && authHeader.startsWith("Bearer ")) {
        sessionToken = authHeader.slice(7);
      }
    }
    const session = await this.verifySession(sessionToken);
    if (!session) {
      throw ForbiddenError("Invalid session cookie");
    }
    if (session.openId.startsWith(CRON_OPEN_ID_PREFIX)) {
      const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
      const taskUid = userInfo.taskUid ?? null;
      if (!taskUid) {
        throw ForbiddenError("Cron session missing task_uid");
      }
      return buildCronUser(userInfo);
    }
    const sessionUserId = session.openId;
    const signedInAt = /* @__PURE__ */ new Date();
    let user = await getUserByOpenId(sessionUserId);
    if (!user) {
      try {
        const userInfo = await this.getUserInfoWithJwt(sessionToken ?? "");
        await upsertUser({
          openId: userInfo.openId,
          name: userInfo.name || null,
          email: userInfo.email ?? null,
          loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
          lastSignedIn: signedInAt
        });
        user = await getUserByOpenId(userInfo.openId);
      } catch (error) {
        console.error("[Auth] Failed to sync user from OAuth:", error);
        throw ForbiddenError("Failed to sync user info");
      }
    }
    if (!user) {
      throw ForbiddenError("User not found");
    }
    await upsertUser({
      openId: user.openId,
      lastSignedIn: signedInAt
    });
    return user;
  }
};
var CRON_OPEN_ID_PREFIX = "cron_";
function buildCronUser(userInfo) {
  const now = /* @__PURE__ */ new Date();
  return {
    id: -1,
    openId: userInfo.openId,
    name: userInfo.name || "Manus Scheduled Task",
    email: null,
    loginMethod: null,
    role: "user",
    createdAt: now,
    updatedAt: now,
    lastSignedIn: now,
    taskUid: userInfo.taskUid ?? void 0,
    isCron: true
  };
}
var sdk = new SDKServer();

// server/_core/oauth.ts
function getQueryParam(req, key) {
  const value = req.query[key];
  return typeof value === "string" ? value : void 0;
}
function registerOAuthRoutes(app) {
  app.get("/api/oauth/callback", async (req, res) => {
    const code = getQueryParam(req, "code");
    const state = getQueryParam(req, "state");
    if (!code || !state) {
      res.status(400).json({ error: "code and state are required" });
      return;
    }
    const { nonce } = decodeOAuthState(state);
    const expectedNonce = parseCookieHeader2(req.headers.cookie ?? "")[OAUTH_STATE_COOKIE];
    if (!nonce || nonce !== expectedNonce) {
      res.status(403).json({ error: "invalid oauth state" });
      return;
    }
    res.clearCookie(OAUTH_STATE_COOKIE, { path: "/", secure: true, sameSite: "none" });
    try {
      const tokenResponse = await sdk.exchangeCodeForToken(code, state);
      const userInfo = await sdk.getUserInfo(tokenResponse.accessToken);
      if (!userInfo.openId) {
        res.status(400).json({ error: "openId missing from user info" });
        return;
      }
      await upsertUser({
        openId: userInfo.openId,
        name: userInfo.name || null,
        email: userInfo.email ?? null,
        loginMethod: userInfo.loginMethod ?? userInfo.platform ?? null,
        lastSignedIn: /* @__PURE__ */ new Date()
      });
      const sessionToken = await sdk.createSessionToken(userInfo.openId, {
        name: userInfo.name || "",
        expiresInMs: ONE_YEAR_MS
      });
      const cookieOptions = getSessionCookieOptions(req);
      res.cookie(COOKIE_NAME, sessionToken, { ...cookieOptions, maxAge: ONE_YEAR_MS });
      res.redirect(302, "/");
    } catch (error) {
      console.error("[OAuth] Callback failed", error);
      res.status(500).json({ error: "OAuth callback failed" });
    }
  });
}

// server/_core/storageProxy.ts
function registerStorageProxy(app) {
  app.get("/manus-storage/*", async (req, res) => {
    const key = req.params[0];
    if (!key) {
      res.status(400).send("Missing storage key");
      return;
    }
    if (!ENV.forgeApiUrl || !ENV.forgeApiKey) {
      res.status(500).send("Storage proxy not configured");
      return;
    }
    try {
      const forgeUrl = new URL(
        "v1/storage/presign/get",
        ENV.forgeApiUrl.replace(/\/+$/, "") + "/"
      );
      forgeUrl.searchParams.set("path", key);
      const forgeResp = await fetch(forgeUrl, {
        headers: { Authorization: `Bearer ${ENV.forgeApiKey}` }
      });
      if (!forgeResp.ok) {
        const body = await forgeResp.text().catch(() => "");
        console.error(`[StorageProxy] forge error: ${forgeResp.status} ${body}`);
        res.status(502).send("Storage backend error");
        return;
      }
      const { url } = await forgeResp.json();
      if (!url) {
        res.status(502).send("Empty signed URL from backend");
        return;
      }
      res.set("Cache-Control", "no-store");
      res.redirect(307, url);
    } catch (err) {
      console.error("[StorageProxy] failed:", err);
      res.status(502).send("Storage proxy error");
    }
  });
}

// server/routers.ts
import { z as z2 } from "zod";

// server/_core/systemRouter.ts
import { z } from "zod";

// server/_core/notification.ts
import { TRPCError } from "@trpc/server";
var TITLE_MAX_LENGTH = 1200;
var CONTENT_MAX_LENGTH = 2e4;
var trimValue = (value) => value.trim();
var isNonEmptyString2 = (value) => typeof value === "string" && value.trim().length > 0;
var buildEndpointUrl = (baseUrl) => {
  const normalizedBase = baseUrl.endsWith("/") ? baseUrl : `${baseUrl}/`;
  return new URL(
    "webdevtoken.v1.WebDevService/SendNotification",
    normalizedBase
  ).toString();
};
var validatePayload = (input) => {
  if (!isNonEmptyString2(input.title)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification title is required."
    });
  }
  if (!isNonEmptyString2(input.content)) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: "Notification content is required."
    });
  }
  const title = trimValue(input.title);
  const content = trimValue(input.content);
  if (title.length > TITLE_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification title must be at most ${TITLE_MAX_LENGTH} characters.`
    });
  }
  if (content.length > CONTENT_MAX_LENGTH) {
    throw new TRPCError({
      code: "BAD_REQUEST",
      message: `Notification content must be at most ${CONTENT_MAX_LENGTH} characters.`
    });
  }
  return { title, content };
};
async function notifyOwner(payload) {
  const { title, content } = validatePayload(payload);
  if (!ENV.forgeApiUrl) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service URL is not configured."
    });
  }
  if (!ENV.forgeApiKey) {
    throw new TRPCError({
      code: "INTERNAL_SERVER_ERROR",
      message: "Notification service API key is not configured."
    });
  }
  const endpoint = buildEndpointUrl(ENV.forgeApiUrl);
  try {
    const response = await fetch(endpoint, {
      method: "POST",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${ENV.forgeApiKey}`,
        "content-type": "application/json",
        "connect-protocol-version": "1"
      },
      body: JSON.stringify({ title, content })
    });
    if (!response.ok) {
      const detail = await response.text().catch(() => "");
      console.warn(
        `[Notification] Failed to notify owner (${response.status} ${response.statusText})${detail ? `: ${detail}` : ""}`
      );
      return false;
    }
    return true;
  } catch (error) {
    console.warn("[Notification] Error calling notification service:", error);
    return false;
  }
}

// server/_core/trpc.ts
import { initTRPC, TRPCError as TRPCError2 } from "@trpc/server";
import superjson from "superjson";
var t = initTRPC.context().create({
  transformer: superjson
});
var router = t.router;
var publicProcedure = t.procedure;
var requireUser = t.middleware(async (opts) => {
  const { ctx, next } = opts;
  if (!ctx.user) {
    throw new TRPCError2({ code: "UNAUTHORIZED", message: UNAUTHED_ERR_MSG });
  }
  return next({
    ctx: {
      ...ctx,
      user: ctx.user
    }
  });
});
var protectedProcedure = t.procedure.use(requireUser);
var adminProcedure = t.procedure.use(
  t.middleware(async (opts) => {
    const { ctx, next } = opts;
    if (!ctx.user || ctx.user.role !== "admin") {
      throw new TRPCError2({ code: "FORBIDDEN", message: NOT_ADMIN_ERR_MSG });
    }
    return next({
      ctx: {
        ...ctx,
        user: ctx.user
      }
    });
  })
);

// server/_core/systemRouter.ts
var systemRouter = router({
  health: publicProcedure.input(
    z.object({
      timestamp: z.number().min(0, "timestamp cannot be negative")
    })
  ).query(() => ({
    ok: true
  })),
  notifyOwner: adminProcedure.input(
    z.object({
      title: z.string().min(1, "title is required"),
      content: z.string().min(1, "content is required")
    })
  ).mutation(async ({ input }) => {
    const delivered = await notifyOwner(input);
    return {
      success: delivered
    };
  })
});

// server/routers.ts
import { TRPCError as TRPCError3 } from "@trpc/server";

// server/storage.ts
function getForgeConfig() {
  const forgeUrl = ENV.forgeApiUrl;
  const forgeKey = ENV.forgeApiKey;
  if (!forgeUrl || !forgeKey) {
    throw new Error(
      "Storage config missing: set BUILT_IN_FORGE_API_URL and BUILT_IN_FORGE_API_KEY"
    );
  }
  return { forgeUrl: forgeUrl.replace(/\/+$/, ""), forgeKey };
}
function normalizeKey(relKey) {
  return relKey.replace(/^\/+/, "");
}
function appendHashSuffix(relKey) {
  const hash = crypto.randomUUID().replace(/-/g, "").slice(0, 8);
  const lastDot = relKey.lastIndexOf(".");
  if (lastDot === -1) return `${relKey}_${hash}`;
  return `${relKey.slice(0, lastDot)}_${hash}${relKey.slice(lastDot)}`;
}
async function storagePut(relKey, data, contentType = "application/octet-stream") {
  const { forgeUrl, forgeKey } = getForgeConfig();
  const key = appendHashSuffix(normalizeKey(relKey));
  const presignUrl = new URL("v1/storage/presign/put", forgeUrl + "/");
  presignUrl.searchParams.set("path", key);
  const presignResp = await fetch(presignUrl, {
    headers: { Authorization: `Bearer ${forgeKey}` }
  });
  if (!presignResp.ok) {
    const msg = await presignResp.text().catch(() => presignResp.statusText);
    throw new Error(`Storage presign failed (${presignResp.status}): ${msg}`);
  }
  const { url: s3Url } = await presignResp.json();
  if (!s3Url) throw new Error("Forge returned empty presign URL");
  const blob = typeof data === "string" ? new Blob([data], { type: contentType }) : new Blob([data], { type: contentType });
  const uploadResp = await fetch(s3Url, {
    method: "PUT",
    headers: { "Content-Type": contentType },
    body: blob
  });
  if (!uploadResp.ok) {
    throw new Error(`Storage upload to S3 failed (${uploadResp.status})`);
  }
  return { key, url: `/manus-storage/${key}` };
}

// server/admin.ts
import { jwtVerify as jwtVerify2, SignJWT as SignJWT2 } from "jose";
var ADMIN_COOKIE = "pie-admin-session";
var ADMIN_SCOPE = "pie-admin";
var signingSecret = new TextEncoder().encode(ENV.cookieSecret || "pie-development-secret");
function validateAdminCode(code) {
  return Boolean(process.env.ADMIN_CODE) && code === process.env.ADMIN_CODE;
}
function readCookie(req, name) {
  const raw = req.headers.cookie ?? "";
  const match = raw.split(";").map((part) => part.trim()).find((part) => part.startsWith(`${name}=`));
  return match?.slice(name.length + 1);
}
async function createAdminSession(userId) {
  return new SignJWT2({ scope: ADMIN_SCOPE }).setProtectedHeader({ alg: "HS256" }).setSubject(String(userId)).setIssuedAt().setExpirationTime("1h").sign(signingSecret);
}
async function hasAdminSession(req, userId) {
  const token = readCookie(req, ADMIN_COOKIE);
  if (!token) return false;
  try {
    const { payload } = await jwtVerify2(token, signingSecret);
    return payload.scope === ADMIN_SCOPE && payload.sub === String(userId);
  } catch {
    return false;
  }
}
function setAdminCookie(res, req, token) {
  res.cookie(ADMIN_COOKIE, token, { ...getSessionCookieOptions(req), maxAge: 60 * 60 * 1e3 });
}
function clearAdminCookie(res, req) {
  res.clearCookie(ADMIN_COOKIE, { ...getSessionCookieOptions(req), maxAge: -1 });
}

// server/routers.ts
var adminProcedure2 = protectedProcedure.use(async ({ ctx, next }) => {
  const isOwner = ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" && !isOwner) throw new TRPCError3({ code: "FORBIDDEN", message: "Admin access required" });
  if (!await hasAdminSession(ctx.req, ctx.user.id)) throw new TRPCError3({ code: "FORBIDDEN", message: "Unlock admin mode first" });
  return next();
});
var usernameSchema = z2.string().trim().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only");
var appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query((opts) => {
      if (!opts.ctx.user) return null;
      const isOwner = opts.ctx.user.openId === ENV.ownerOpenId;
      return isOwner && opts.ctx.user.role !== "admin" ? { ...opts.ctx.user, role: "admin" } : opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true };
    })
  }),
  community: router({
    overview: protectedProcedure.query(async ({ ctx }) => {
      await touchUser(ctx.user.id);
      return getOverview();
    }),
    members: protectedProcedure.input(z2.object({ search: z2.string().max(50).optional() }).optional()).query(({ input }) => searchMembers(input?.search)),
    settings: protectedProcedure.query(() => getSettings())
  }),
  profile: router({
    update: protectedProcedure.input(z2.object({ username: usernameSchema, bio: z2.string().trim().max(240) })).mutation(async ({ ctx, input }) => {
      const current = await searchMembers(input.username);
      const conflict = current.find((member) => member.username?.toLowerCase() === input.username.toLowerCase() && member.id !== ctx.user.id);
      if (conflict) throw new TRPCError3({ code: "CONFLICT", message: "That username is already taken" });
      return updateProfile(ctx.user.id, input.username, input.bio);
    })
  }),
  chat: router({
    send: protectedProcedure.input(z2.object({ content: z2.string().trim().min(1).max(600) })).mutation(async ({ ctx, input }) => {
      const recent = await getOverview();
      const mine = recent.messages.filter((message) => message.userId === ctx.user.id && message.createdAt.getTime() > Date.now() - 6e4);
      if (mine.length >= 8) throw new TRPCError3({ code: "TOO_MANY_REQUESTS", message: "Slow down for a moment" });
      return addMessage(ctx.user.id, input.content.replace(/[<>]/g, ""));
    })
  }),
  plans: router({
    create: protectedProcedure.input(z2.object({ title: z2.string().trim().min(3).max(120), description: z2.string().trim().max(600), planDate: z2.coerce.date(), location: z2.string().trim().max(160) })).mutation(({ ctx, input }) => addPlan(ctx.user.id, input.title, input.description, input.planDate, input.location)),
    attend: protectedProcedure.input(z2.object({ planId: z2.number().int().positive(), status: z2.enum(["going", "not_going"]) })).mutation(({ ctx, input }) => setAttendance(ctx.user.id, input.planId, input.status))
  }),
  announcements: router({
    create: adminProcedure2.input(z2.object({ title: z2.string().trim().min(3).max(140), content: z2.string().trim().min(3).max(2e3) })).mutation(({ ctx, input }) => addAnnouncement(ctx.user.id, input.title, input.content))
  }),
  memories: router({
    photos: protectedProcedure.input(z2.object({ albumId: z2.number().int().positive() })).query(({ input }) => getAlbumPhotos(input.albumId)),
    createAlbum: protectedProcedure.input(z2.object({ title: z2.string().trim().min(2).max(120), description: z2.string().trim().max(240) })).mutation(({ ctx, input }) => createAlbum(ctx.user.id, input.title, input.description)),
    upload: protectedProcedure.input(z2.object({ albumId: z2.number().int().positive(), filename: z2.string().trim().min(1).max(140), mimeType: z2.enum(["image/jpeg", "image/png", "image/webp"]), data: z2.string().max(7e6), caption: z2.string().trim().max(180).optional() })).mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.data, "base64");
      if (buffer.length > 5 * 1024 * 1024) throw new TRPCError3({ code: "BAD_REQUEST", message: "Images must be 5MB or smaller" });
      const stored = await storagePut(`pie/${ctx.user.id}/${Date.now()}-${input.filename}`, buffer, input.mimeType);
      return addPhoto(input.albumId, ctx.user.id, stored.url, stored.key, input.caption);
    })
  }),
  admin: router({
    unlock: protectedProcedure.input(z2.object({ code: z2.string().length(4) })).mutation(async ({ ctx, input }) => {
      if (!validateAdminCode(input.code)) throw new TRPCError3({ code: "UNAUTHORIZED", message: "That admin code is not valid" });
      const token = await createAdminSession(ctx.user.id);
      setAdminCookie(ctx.res, ctx.req, token);
      return { success: true };
    }),
    status: protectedProcedure.query(async ({ ctx }) => ({ unlocked: (ctx.user.role === "admin" || ctx.user.openId === ENV.ownerOpenId) && await hasAdminSession(ctx.req, ctx.user.id) })),
    lock: protectedProcedure.mutation(({ ctx }) => {
      clearAdminCookie(ctx.res, ctx.req);
      return { success: true };
    }),
    settings: adminProcedure2.input(z2.object({ key: z2.string().min(2).max(80), value: z2.string().max(1e3) })).mutation(({ input }) => setSetting(input.key, input.value)),
    removePlan: adminProcedure2.input(z2.object({ id: z2.number().int().positive() })).mutation(({ input }) => removePlan(input.id)),
    removeAnnouncement: adminProcedure2.input(z2.object({ id: z2.number().int().positive() })).mutation(({ input }) => removeAnnouncement(input.id)),
    removeAlbum: adminProcedure2.input(z2.object({ id: z2.number().int().positive() })).mutation(({ input }) => removeAlbum(input.id)),
    removeMessage: adminProcedure2.input(z2.object({ id: z2.number().int().positive() })).mutation(({ input }) => removeMessage(input.id))
  })
});

// server/_core/context.ts
async function createContext(opts) {
  let user = null;
  try {
    user = await sdk.authenticateRequest(opts.req);
  } catch (error) {
    user = null;
  }
  return {
    req: opts.req,
    res: opts.res,
    user
  };
}

// server/_core/vite.ts
import express from "express";
import fs2 from "fs";
import { nanoid } from "nanoid";
import path2 from "path";
import { createServer as createViteServer } from "vite";

// vite.config.ts
import { jsxLocPlugin } from "@builder.io/vite-plugin-jsx-loc";
import tailwindcss from "@tailwindcss/vite";
import react from "@vitejs/plugin-react";
import fs from "node:fs";
import path from "node:path";
import { defineConfig } from "vite";
import { vitePluginManusRuntime } from "vite-plugin-manus-runtime";
var PROJECT_ROOT = import.meta.dirname;
var LOG_DIR = path.join(PROJECT_ROOT, ".manus-logs");
var MAX_LOG_SIZE_BYTES = 1 * 1024 * 1024;
var TRIM_TARGET_BYTES = Math.floor(MAX_LOG_SIZE_BYTES * 0.6);
function ensureLogDir() {
  if (!fs.existsSync(LOG_DIR)) {
    fs.mkdirSync(LOG_DIR, { recursive: true });
  }
}
function trimLogFile(logPath, maxSize) {
  try {
    if (!fs.existsSync(logPath) || fs.statSync(logPath).size <= maxSize) {
      return;
    }
    const lines = fs.readFileSync(logPath, "utf-8").split("\n");
    const keptLines = [];
    let keptBytes = 0;
    const targetSize = TRIM_TARGET_BYTES;
    for (let i = lines.length - 1; i >= 0; i--) {
      const lineBytes = Buffer.byteLength(`${lines[i]}
`, "utf-8");
      if (keptBytes + lineBytes > targetSize) break;
      keptLines.unshift(lines[i]);
      keptBytes += lineBytes;
    }
    fs.writeFileSync(logPath, keptLines.join("\n"), "utf-8");
  } catch {
  }
}
function writeToLogFile(source, entries) {
  if (entries.length === 0) return;
  ensureLogDir();
  const logPath = path.join(LOG_DIR, `${source}.log`);
  const lines = entries.map((entry) => {
    const ts = (/* @__PURE__ */ new Date()).toISOString();
    return `[${ts}] ${JSON.stringify(entry)}`;
  });
  fs.appendFileSync(logPath, `${lines.join("\n")}
`, "utf-8");
  trimLogFile(logPath, MAX_LOG_SIZE_BYTES);
}
function vitePluginManusDebugCollector() {
  return {
    name: "manus-debug-collector",
    transformIndexHtml(html) {
      if (process.env.NODE_ENV === "production") {
        return html;
      }
      return {
        html,
        tags: [
          {
            tag: "script",
            attrs: {
              src: "/__manus__/debug-collector.js",
              defer: true
            },
            injectTo: "head"
          }
        ]
      };
    },
    configureServer(server) {
      server.middlewares.use("/__manus__/logs", (req, res, next) => {
        if (req.method !== "POST") {
          return next();
        }
        const handlePayload = (payload) => {
          if (payload.consoleLogs?.length > 0) {
            writeToLogFile("browserConsole", payload.consoleLogs);
          }
          if (payload.networkRequests?.length > 0) {
            writeToLogFile("networkRequests", payload.networkRequests);
          }
          if (payload.sessionEvents?.length > 0) {
            writeToLogFile("sessionReplay", payload.sessionEvents);
          }
          res.writeHead(200, { "Content-Type": "application/json" });
          res.end(JSON.stringify({ success: true }));
        };
        const reqBody = req.body;
        if (reqBody && typeof reqBody === "object") {
          try {
            handlePayload(reqBody);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
          return;
        }
        let body = "";
        req.on("data", (chunk) => {
          body += chunk.toString();
        });
        req.on("end", () => {
          try {
            const payload = JSON.parse(body);
            handlePayload(payload);
          } catch (e) {
            res.writeHead(400, { "Content-Type": "application/json" });
            res.end(JSON.stringify({ success: false, error: String(e) }));
          }
        });
      });
    }
  };
}
var plugins = [react(), tailwindcss(), jsxLocPlugin(), vitePluginManusRuntime(), vitePluginManusDebugCollector()];
var vite_config_default = defineConfig({
  plugins,
  resolve: {
    alias: {
      "@": path.resolve(import.meta.dirname, "client", "src"),
      "@shared": path.resolve(import.meta.dirname, "shared"),
      "@assets": path.resolve(import.meta.dirname, "attached_assets")
    }
  },
  envDir: path.resolve(import.meta.dirname),
  root: path.resolve(import.meta.dirname, "client"),
  publicDir: path.resolve(import.meta.dirname, "client", "public"),
  build: {
    outDir: path.resolve(import.meta.dirname, "dist/public"),
    emptyOutDir: true
  },
  server: {
    host: true,
    allowedHosts: [
      ".manuspre.computer",
      ".manus.computer",
      ".manus-asia.computer",
      ".manuscomputer.ai",
      ".manusvm.computer",
      "localhost",
      "127.0.0.1"
    ],
    fs: {
      strict: true,
      deny: ["**/.*"]
    }
  }
});

// server/_core/vite.ts
async function setupVite(app, server) {
  const serverOptions = {
    middlewareMode: true,
    hmr: { server },
    allowedHosts: true
  };
  const vite = await createViteServer({
    ...vite_config_default,
    configFile: false,
    server: serverOptions,
    appType: "custom"
  });
  app.use(vite.middlewares);
  app.use("*", async (req, res, next) => {
    const url = req.originalUrl;
    try {
      const clientTemplate = path2.resolve(
        import.meta.dirname,
        "../..",
        "client",
        "index.html"
      );
      let template = await fs2.promises.readFile(clientTemplate, "utf-8");
      template = template.replace(
        `src="/src/main.tsx"`,
        `src="/src/main.tsx?v=${nanoid()}"`
      );
      const page = await vite.transformIndexHtml(url, template);
      res.status(200).set({ "Content-Type": "text/html" }).end(page);
    } catch (e) {
      vite.ssrFixStacktrace(e);
      next(e);
    }
  });
}
function serveStatic(app) {
  const distPath = process.env.NODE_ENV === "development" ? path2.resolve(import.meta.dirname, "../..", "dist", "public") : path2.resolve(import.meta.dirname, "public");
  if (!fs2.existsSync(distPath)) {
    console.error(
      `Could not find the build directory: ${distPath}, make sure to build the client first`
    );
  }
  app.use(express.static(distPath));
  app.use("*", (_req, res) => {
    res.sendFile(path2.resolve(distPath, "index.html"));
  });
}

// server/_core/index.ts
function isPortAvailable(port) {
  return new Promise((resolve) => {
    const server = net.createServer();
    server.listen(port, () => {
      server.close(() => resolve(true));
    });
    server.on("error", () => resolve(false));
  });
}
async function findAvailablePort(startPort = 3e3) {
  for (let port = startPort; port < startPort + 20; port++) {
    if (await isPortAvailable(port)) {
      return port;
    }
  }
  throw new Error(`No available port found starting from ${startPort}`);
}
async function startServer() {
  const app = express2();
  const server = createServer(app);
  app.use(express2.json({ limit: "50mb" }));
  app.use(express2.urlencoded({ limit: "50mb", extended: true }));
  registerStorageProxy(app);
  registerOAuthRoutes(app);
  app.use(
    "/api/trpc",
    createExpressMiddleware({
      router: appRouter,
      createContext
    })
  );
  if (process.env.NODE_ENV === "development") {
    await setupVite(app, server);
  } else {
    serveStatic(app);
  }
  const preferredPort = parseInt(process.env.PORT || "3000");
  const port = await findAvailablePort(preferredPort);
  if (port !== preferredPort) {
    console.log(`Port ${preferredPort} is busy, using port ${port} instead`);
  }
  server.listen(port, () => {
    console.log(`Server running on http://localhost:${port}/`);
  });
}
startServer().catch(console.error);
