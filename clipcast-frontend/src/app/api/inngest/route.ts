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
