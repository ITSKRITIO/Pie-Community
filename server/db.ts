import { and, asc, desc, eq, gte, like, lt, or } from "drizzle-orm";
import { drizzle } from "drizzle-orm/mysql2";
import { albums, announcements, InsertUser, messages, photos, plans, planParticipants, settings, users } from "../drizzle/schema";
import { ENV } from "./_core/env";

let _db: ReturnType<typeof drizzle> | null = null;

export async function getDb() {
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

export async function upsertUser(user: InsertUser): Promise<void> {
  if (!user.openId) throw new Error("User openId is required for upsert");
  const db = await getDb();
  if (!db) return;
  const isOwner = user.openId === ENV.ownerOpenId;
  const values: InsertUser = { openId: user.openId, name: user.name ?? null, email: user.email ?? null, loginMethod: user.loginMethod ?? null, role: user.role ?? (isOwner ? "admin" : "user"), lastSignedIn: user.lastSignedIn ?? new Date() };
  const updateSet: Record<string, unknown> = { name: values.name, email: values.email, loginMethod: values.loginMethod, lastSignedIn: values.lastSignedIn };
  if (user.role) updateSet.role = user.role;
  else if (isOwner) updateSet.role = "admin";
  await db.insert(users).values(values).onDuplicateKeyUpdate({ set: updateSet });
}

export async function getUserByOpenId(openId: string) {
  const db = await getDb();
  if (!db) return undefined;
  const result = await db.select().from(users).where(eq(users.openId, openId)).limit(1);
  return result[0];
}

export async function touchUser(userId: number) {
  const db = await getDb();
  if (!db) return;
  await db.update(users).set({ lastSeenAt: new Date() }).where(eq(users.id, userId));
}

export async function getOverview() {
  const db = await getDb();
  if (!db) return { members: [], messages: [], plans: [], announcements: [], albums: [], stats: { memberCount: 10, onlineCount: 4, messageCount: 0, albumCount: 0 } };
  const expiry = new Date(Date.now() - 24 * 60 * 60 * 1000);
  await db.delete(messages).where(lt(messages.createdAt, expiry));
  const [memberRows, messageRows, planRows, announcementRows, albumRows] = await Promise.all([
    db.select({ id: users.id, username: users.username, name: users.name, bio: users.bio, role: users.role, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt }).from(users).orderBy(desc(users.lastSeenAt)).limit(20),
    db.select({ id: messages.id, content: messages.content, createdAt: messages.createdAt, userId: users.id, username: users.username, name: users.name }).from(messages).leftJoin(users, eq(messages.userId, users.id)).where(gte(messages.createdAt, expiry)).orderBy(asc(messages.createdAt)).limit(100),
    db.select({ id: plans.id, title: plans.title, description: plans.description, planDate: plans.planDate, location: plans.location, createdAt: plans.createdAt, creatorId: users.id, creatorUsername: users.username, creatorName: users.name }).from(plans).leftJoin(users, eq(plans.creatorId, users.id)).orderBy(asc(plans.planDate)).limit(20),
    db.select({ id: announcements.id, title: announcements.title, content: announcements.content, createdAt: announcements.createdAt, authorId: users.id, authorUsername: users.username, authorName: users.name }).from(announcements).leftJoin(users, eq(announcements.authorId, users.id)).orderBy(desc(announcements.createdAt)).limit(10),
    db.select({ id: albums.id, title: albums.title, description: albums.description, coverUrl: albums.coverUrl, createdAt: albums.createdAt, creatorUsername: users.username }).from(albums).leftJoin(users, eq(albums.creatorId, users.id)).orderBy(desc(albums.createdAt)).limit(12),
  ]);
  return { members: memberRows, messages: messageRows, plans: planRows, announcements: announcementRows, albums: albumRows, stats: { memberCount: memberRows.length, onlineCount: memberRows.filter(m => m.lastSeenAt && m.lastSeenAt.getTime() > Date.now() - 15 * 60 * 1000).length, messageCount: messageRows.length, albumCount: albumRows.length } };
}

export async function searchMembers(search?: string) {
  const db = await getDb();
  if (!db) return [];
  const query = search?.trim();
  const condition = query ? or(like(users.username, `%${query}%`), like(users.name, `%${query}%`)) : undefined;
  return db.select({ id: users.id, username: users.username, name: users.name, bio: users.bio, role: users.role, lastSeenAt: users.lastSeenAt, createdAt: users.createdAt }).from(users).where(condition).orderBy(asc(users.username)).limit(30);
}

export async function updateProfile(userId: number, username: string, bio: string) {
  const db = await getDb();
  if (!db) return undefined;
  await db.update(users).set({ username, bio, updatedAt: new Date() }).where(eq(users.id, userId));
  const rows = await db.select().from(users).where(eq(users.id, userId)).limit(1);
  return rows[0];
}

export async function addMessage(userId: number, content: string) {
  const db = await getDb();
  if (!db) return { id: Date.now(), userId, content, createdAt: new Date() };
  const result = await db.insert(messages).values({ userId, content }).$returningId();
  return { id: result[0]?.id ?? Date.now(), userId, content, createdAt: new Date() };
}

export async function addPlan(userId: number, title: string, description: string, planDate: Date, location: string) {
  const db = await getDb();
  if (!db) return { id: Date.now(), creatorId: userId, title, description, planDate, location, createdAt: new Date() };
  const result = await db.insert(plans).values({ creatorId: userId, title, description, planDate, location }).$returningId();
  return { id: result[0]?.id ?? Date.now(), creatorId: userId, title, description, planDate, location, createdAt: new Date() };
}

export async function addAnnouncement(userId: number, title: string, content: string) {
  const db = await getDb();
  if (!db) return { id: Date.now(), authorId: userId, title, content, createdAt: new Date() };
  const result = await db.insert(announcements).values({ authorId: userId, title, content }).$returningId();
  return { id: result[0]?.id ?? Date.now(), authorId: userId, title, content, createdAt: new Date() };
}

export async function setSetting(key: string, value: string) {
  const db = await getDb();
  if (!db) return;
  await db.insert(settings).values({ key, value }).onDuplicateKeyUpdate({ set: { value, updatedAt: new Date() } });
}

export async function getSettings() {
  const db = await getDb();
  if (!db) return { siteName: "PIE", slogan: "Made to be connected." };
  const rows = await db.select().from(settings);
  return rows.reduce<Record<string, string>>((acc, row) => { acc[row.key] = row.value; return acc; }, { siteName: "PIE", slogan: "Made to be connected." });
}

export async function getAlbumPhotos(albumId: number) {
  const db = await getDb();
  if (!db) return [];
  return db.select({ id: photos.id, url: photos.url, caption: photos.caption, createdAt: photos.createdAt, uploaderUsername: users.username }).from(photos).leftJoin(users, eq(photos.uploaderId, users.id)).where(eq(photos.albumId, albumId)).orderBy(desc(photos.createdAt));
}

export async function createAlbum(userId: number, title: string, description: string) {
  const db = await getDb();
  if (!db) return { id: Date.now(), creatorId: userId, title, description, createdAt: new Date() };
  const result = await db.insert(albums).values({ creatorId: userId, title, description }).$returningId();
  return { id: result[0]?.id ?? Date.now(), creatorId: userId, title, description, createdAt: new Date() };
}

export async function addPhoto(albumId: number, uploaderId: number, url: string, fileKey: string, caption?: string) {
  const db = await getDb();
  if (!db) return { id: Date.now(), albumId, uploaderId, url, fileKey, caption: caption ?? null, createdAt: new Date() };
  const result = await db.insert(photos).values({ albumId, uploaderId, url, fileKey, caption }).$returningId();
  return { id: result[0]?.id ?? Date.now(), albumId, uploaderId, url, fileKey, caption: caption ?? null, createdAt: new Date() };
}

export async function setAttendance(userId: number, planId: number, status: "going" | "not_going") {
  const db = await getDb();
  if (!db) return { success: true };
  await db.insert(planParticipants).values({ planId, userId, status }).onDuplicateKeyUpdate({ set: { status } });
  return { success: true };
}

export async function removePlan(planId: number) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(plans).where(eq(plans.id, planId));
  return { success: true };
}

export async function removeAnnouncement(announcementId: number) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(announcements).where(eq(announcements.id, announcementId));
  return { success: true };
}

export async function removeAlbum(albumId: number) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(albums).where(eq(albums.id, albumId));
  return { success: true };
}

export async function removeMessage(messageId: number) {
  const db = await getDb();
  if (!db) return { success: true };
  await db.delete(messages).where(eq(messages.id, messageId));
  return { success: true };
}
