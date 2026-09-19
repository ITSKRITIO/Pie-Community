import { z } from "zod";
import { getSessionCookieOptions } from "./_core/cookies";
import { COOKIE_NAME } from "@shared/const";
import { systemRouter } from "./_core/systemRouter";
import { protectedProcedure, publicProcedure, router } from "./_core/trpc";
import { addAnnouncement, addMessage, addPhoto, addPlan, createAlbum, getAlbumPhotos, getOverview, getSettings, removeAlbum, removeAnnouncement, removeMessage, removePlan, searchMembers, setAttendance, setSetting, touchUser, updateProfile } from "./db";
import { TRPCError } from "@trpc/server";
import { storagePut } from "./storage";
import { clearAdminCookie, createAdminSession, hasAdminSession, setAdminCookie, validateAdminCode } from "./admin";
import { ENV } from "./_core/env";

const adminProcedure = protectedProcedure.use(async ({ ctx, next }) => {
  const isOwner = ctx.user.openId === ENV.ownerOpenId;
  if (ctx.user.role !== "admin" && !isOwner) throw new TRPCError({ code: "FORBIDDEN", message: "Admin access required" });
  if (!(await hasAdminSession(ctx.req, ctx.user.id))) throw new TRPCError({ code: "FORBIDDEN", message: "Unlock admin mode first" });
  return next();
});

const usernameSchema = z.string().trim().min(2).max(32).regex(/^[a-zA-Z0-9_]+$/, "Use letters, numbers, and underscores only");

export const appRouter = router({
  system: systemRouter,
  auth: router({
    me: publicProcedure.query(opts => {
      if (!opts.ctx.user) return null;
      const isOwner = opts.ctx.user.openId === ENV.ownerOpenId;
      return isOwner && opts.ctx.user.role !== "admin" ? { ...opts.ctx.user, role: "admin" as const } : opts.ctx.user;
    }),
    logout: publicProcedure.mutation(({ ctx }) => {
      const cookieOptions = getSessionCookieOptions(ctx.req);
      ctx.res.clearCookie(COOKIE_NAME, { ...cookieOptions, maxAge: -1 });
      return { success: true } as const;
    }),
  }),
  community: router({
    overview: protectedProcedure.query(async ({ ctx }) => { await touchUser(ctx.user.id); return getOverview(); }),
    members: protectedProcedure.input(z.object({ search: z.string().max(50).optional() }).optional()).query(({ input }) => searchMembers(input?.search)),
    settings: protectedProcedure.query(() => getSettings()),
  }),
  profile: router({
    update: protectedProcedure.input(z.object({ username: usernameSchema, bio: z.string().trim().max(240) })).mutation(async ({ ctx, input }) => {
      const current = await searchMembers(input.username);
      const conflict = current.find(member => member.username?.toLowerCase() === input.username.toLowerCase() && member.id !== ctx.user.id);
      if (conflict) throw new TRPCError({ code: "CONFLICT", message: "That username is already taken" });
      return updateProfile(ctx.user.id, input.username, input.bio);
    }),
  }),
  chat: router({
    send: protectedProcedure.input(z.object({ content: z.string().trim().min(1).max(600) })).mutation(async ({ ctx, input }) => {
      const recent = await getOverview();
      const mine = recent.messages.filter(message => message.userId === ctx.user.id && message.createdAt.getTime() > Date.now() - 60_000);
      if (mine.length >= 8) throw new TRPCError({ code: "TOO_MANY_REQUESTS", message: "Slow down for a moment" });
      return addMessage(ctx.user.id, input.content.replace(/[<>]/g, ""));
    }),
  }),
  plans: router({
    create: protectedProcedure.input(z.object({ title: z.string().trim().min(3).max(120), description: z.string().trim().max(600), planDate: z.coerce.date(), location: z.string().trim().max(160) })).mutation(({ ctx, input }) => addPlan(ctx.user.id, input.title, input.description, input.planDate, input.location)),
    attend: protectedProcedure.input(z.object({ planId: z.number().int().positive(), status: z.enum(["going", "not_going"]) })).mutation(({ ctx, input }) => setAttendance(ctx.user.id, input.planId, input.status)),
  }),
  announcements: router({
    create: adminProcedure.input(z.object({ title: z.string().trim().min(3).max(140), content: z.string().trim().min(3).max(2000) })).mutation(({ ctx, input }) => addAnnouncement(ctx.user.id, input.title, input.content)),
  }),
  memories: router({
    photos: protectedProcedure.input(z.object({ albumId: z.number().int().positive() })).query(({ input }) => getAlbumPhotos(input.albumId)),
    createAlbum: protectedProcedure.input(z.object({ title: z.string().trim().min(2).max(120), description: z.string().trim().max(240) })).mutation(({ ctx, input }) => createAlbum(ctx.user.id, input.title, input.description)),
    upload: protectedProcedure.input(z.object({ albumId: z.number().int().positive(), filename: z.string().trim().min(1).max(140), mimeType: z.enum(["image/jpeg", "image/png", "image/webp"]), data: z.string().max(7_000_000), caption: z.string().trim().max(180).optional() })).mutation(async ({ ctx, input }) => {
      const buffer = Buffer.from(input.data, "base64");
      if (buffer.length > 5 * 1024 * 1024) throw new TRPCError({ code: "BAD_REQUEST", message: "Images must be 5MB or smaller" });
      const stored = await storagePut(`pie/${ctx.user.id}/${Date.now()}-${input.filename}`, buffer, input.mimeType);
      return addPhoto(input.albumId, ctx.user.id, stored.url, stored.key, input.caption);
    }),
  }),
  admin: router({
    unlock: protectedProcedure.input(z.object({ code: z.string().length(4) })).mutation(async ({ ctx, input }) => {
      if (!validateAdminCode(input.code)) throw new TRPCError({ code: "UNAUTHORIZED", message: "That admin code is not valid" });
      const token = await createAdminSession(ctx.user.id);
      setAdminCookie(ctx.res, ctx.req, token);
      return { success: true } as const;
    }),
    status: protectedProcedure.query(async ({ ctx }) => ({ unlocked: (ctx.user.role === "admin" || ctx.user.openId === ENV.ownerOpenId) && await hasAdminSession(ctx.req, ctx.user.id) })),
    lock: protectedProcedure.mutation(({ ctx }) => { clearAdminCookie(ctx.res, ctx.req); return { success: true } as const; }),
    settings: adminProcedure.input(z.object({ key: z.string().min(2).max(80), value: z.string().max(1000) })).mutation(({ input }) => setSetting(input.key, input.value)),
    removePlan: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => removePlan(input.id)),
    removeAnnouncement: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => removeAnnouncement(input.id)),
    removeAlbum: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => removeAlbum(input.id)),
    removeMessage: adminProcedure.input(z.object({ id: z.number().int().positive() })).mutation(({ input }) => removeMessage(input.id)),
  }),
});

export type AppRouter = typeof appRouter;
