import { cronJobs } from "convex/server";
import { internal } from "./_generated/api";

/**
 * Scheduled jobs. Convex runs crons in UTC; India time is UTC+05:30 (no
 * daylight saving). Every job is safe to run twice: it never charges or
 * credits the same thing again.
 */
const crons = cronJobs();

// 23:59 India time every day = 18:29 UTC. It makes statements only on the
// last day of the month (and catches up on any missed last month).
crons.daily("month-end statements (23:59 IST)", { hourUTC: 18, minuteUTC: 29 }, internal.statements.monthEndJob, {});

// 00:05 India time = 18:35 UTC the day before: late fees after the
// deadline, "due soon" and "overdue" notices, and catch-up statements.
crons.daily("late fees and reminders (00:05 IST)", { hourUTC: 18, minuteUTC: 35 }, internal.statements.dailyJob, {});

// Every 5 minutes, forget Livoza Hub tickets used more than 10 minutes ago
// (they expire after 60 seconds, so they can't be reused anyway).
crons.interval("forget used hub tickets", { minutes: 5 }, internal.sso.deleteOldTickets, {});

export default crons;
