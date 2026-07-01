import { serve } from "inngest/next";
import { inngest } from "../../../inngest/client";
import {
  processVideoFn,
  dailyClipScheduler,
  syncInngestCancellation,
} from "~/inngest/functions";

export const { GET, POST, PUT } = serve({
  client: inngest,
  functions: [processVideoFn, dailyClipScheduler, syncInngestCancellation],
});
