/** Standard result shape for server actions that either succeed or return a
 * user-displayable error. */
export type ActionResult = { success: boolean; error?: string };
