import { index, int, mysqlEnum, mysqlTable, text, timestamp, unique, varchar } from "drizzle-orm/mysql-core";

export const users = mysqlTable("users", {
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
  lastSignedIn: timestamp("lastSignedIn").defaultNow().notNull(),
}, (table) => ({ usernameIdx: index("users_username_idx").on(table.username) }));

export const messages = mysqlTable("messages", {
  id: int("id").autoincrement().primaryKey(),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  content: varchar("content", { length: 600 }).notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ userIdx: index("messages_user_idx").on(table.userId), createdIdx: index("messages_created_idx").on(table.createdAt) }));

export const plans = mysqlTable("plans", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  description: text("description"),
  planDate: timestamp("planDate").notNull(),
  location: varchar("location", { length: 160 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ dateIdx: index("plans_date_idx").on(table.planDate), creatorIdx: index("plans_creator_idx").on(table.creatorId) }));

export const planParticipants = mysqlTable("planParticipants", {
  id: int("id").autoincrement().primaryKey(),
  planId: int("planId").notNull().references(() => plans.id, { onDelete: "cascade" }),
  userId: int("userId").notNull().references(() => users.id, { onDelete: "cascade" }),
  status: mysqlEnum("status", ["going", "not_going"]).notNull().default("going"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
}, (table) => ({ pair: unique("plan_participant_pair").on(table.planId, table.userId), planIdx: index("participants_plan_idx").on(table.planId) }));

export const announcements = mysqlTable("announcements", {
  id: int("id").autoincrement().primaryKey(),
  authorId: int("authorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 140 }).notNull(),
  content: text("content").notNull(),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
}, (table) => ({ createdIdx: index("announcements_created_idx").on(table.createdAt) }));

export const albums = mysqlTable("albums", {
  id: int("id").autoincrement().primaryKey(),
  creatorId: int("creatorId").notNull().references(() => users.id, { onDelete: "cascade" }),
  title: varchar("title", { length: 120 }).notNull(),
  description: varchar("description", { length: 240 }),
  coverUrl: text("coverUrl"),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const photos = mysqlTable("photos", {
  id: int("id").autoincrement().primaryKey(),
  albumId: int("albumId").notNull().references(() => albums.id, { onDelete: "cascade" }),
  uploaderId: int("uploaderId").notNull().references(() => users.id, { onDelete: "cascade" }),
  url: text("url").notNull(),
  fileKey: text("fileKey").notNull(),
  caption: varchar("caption", { length: 180 }),
  createdAt: timestamp("createdAt").defaultNow().notNull(),
});

export const settings = mysqlTable("settings", {
  id: int("id").autoincrement().primaryKey(),
  key: varchar("key", { length: 80 }).notNull().unique(),
  value: text("value").notNull(),
  updatedAt: timestamp("updatedAt").defaultNow().onUpdateNow().notNull(),
});

export type User = typeof users.$inferSelect;
export type InsertUser = typeof users.$inferInsert;
export type Message = typeof messages.$inferSelect;
export type Plan = typeof plans.$inferSelect;
export type Announcement = typeof announcements.$inferSelect;
export type Album = typeof albums.$inferSelect;
export type Photo = typeof photos.$inferSelect;
