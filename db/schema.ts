import { index, integer, sqliteTable, text, uniqueIndex } from "drizzle-orm/sqlite-core";

export const tasks = sqliteTable("tasks", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  text: text("text").notNull(),
  tag: text("tag").notNull().default("할 일"),
  done: integer("done", { mode: "boolean" }).notNull().default(false),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const shortcuts = sqliteTable("shortcuts", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  label: text("label").notNull(),
  url: text("url").notNull(),
  color: text("color").notNull().default("blue"),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const scheduleEvents = sqliteTable(
  "schedule_events",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    date: text("date").notNull(),
    title: text("title").notNull(),
    time: text("time"),
    location: text("location"),
    source: text("source").notNull().default("manual"),
    sourceImportId: integer("source_import_id"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [index("schedule_events_date_idx").on(table.date)],
);

export const timetableEntries = sqliteTable(
  "timetable_entries",
  {
    id: integer("id").primaryKey({ autoIncrement: true }),
    day: integer("day").notNull(),
    period: integer("period").notNull(),
    subject: text("subject").notNull(),
    location: text("location"),
    createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
  },
  (table) => [uniqueIndex("timetable_day_period_idx").on(table.day, table.period)],
);

export const academicImports = sqliteTable("academic_imports", {
  id: integer("id").primaryKey({ autoIncrement: true }),
  fileName: text("file_name").notNull(),
  r2Key: text("r2_key").notNull(),
  kind: text("kind").notNull().default("calendar"),
  detectedCount: integer("detected_count").notNull().default(0),
  createdAt: integer("created_at", { mode: "timestamp_ms" }).notNull(),
});

export const classStatus = sqliteTable("class_status", {
  id: integer("id").primaryKey(),
  total: integer("total").notNull().default(0),
  attendance: integer("attendance").notNull().default(0),
  absence: integer("absence").notNull().default(0),
  earlyDismissal: integer("early_dismissal").notNull().default(0),
  tardy: integer("tardy").notNull().default(0),
  updatedAt: integer("updated_at", { mode: "timestamp_ms" }).notNull(),
});
