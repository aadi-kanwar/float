import { cronJobs } from "convex/server";

/** Scheduled jobs. Every job is safe to run twice (it never double-charges or double-credits). */
const crons = cronJobs();

export default crons;
