import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
  processVideoFn,
  dailyClipScheduler,
  syncInngestCancellation,
  sendEmailFn,
  weeklySummaryScheduler,
} from "~/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [
    processVideoFn,
    dailyClipScheduler,
    syncInngestCancellation,
    sendEmailFn,
    weeklySummaryScheduler,
  ],
});
