/**
 * Inngest serve endpoint: /api/inngest.
 *
 * `serve()` exposes the single HTTP endpoint the Inngest runtime uses to
 * discover and drive our background jobs — GET for function introspection,
 * POST to execute a step, PUT to (re)register with the Inngest server. Every
 * background function (clip + audio pipelines, cron schedulers, cancellation
 * sync, email sender) must be listed here to be reachable.
 */
import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
  processVideoFn,
  processAudioFn,
  dailyClipScheduler,
  syncInngestCancellation,
  sendEmailFn,
  weeklySummaryScheduler,
} from "~/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processVideoFn,
    processAudioFn,
    dailyClipScheduler,
    syncInngestCancellation,
    sendEmailFn,
    weeklySummaryScheduler,
  ],
});
