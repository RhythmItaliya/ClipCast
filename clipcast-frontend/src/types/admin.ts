/** Row shapes for the admin tables — mirror the selects in
 * src/actions/admin.ts. */

export type AdminUser = {
  id: string;
  name: string | null;
  email: string;
  role: "USER" | "ADMIN";
  banned: boolean;
  credits: number;
  createdAt: Date;
  _count: { clips: number; uploadedFiles: number };
};

export type AdminJob = {
  id: string;
  displayName: string | null;
  youtubeUrl: string | null;
  status: string;
  clipMode: string | null;
  isPreview: boolean | null;
  errorMessage: string | null;
  internalErrorDetail: string | null;
  processingSummary: string | null;
  createdAt: Date;
  updatedAt: Date;
  _count: { clips: number };
  user: { id: string; email: string; name: string | null };
};

export type AdminClip = {
  id: string;
  s3Key: string;
  clipMode: string;
  isPreview: boolean;
  title: string | null;
  duration: number | null;
  createdAt: Date;
  user: { id: string; email: string; name: string | null };
  uploadedFile: { displayName: string | null } | null;
};
