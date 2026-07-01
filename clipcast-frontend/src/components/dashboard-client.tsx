"use client";

import Dropzone from "shadcn-dropzone";
import Link from "next/link";
import { Button } from "./ui/button";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "./ui/tabs";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "./ui/card";
import { Input } from "./ui/input";
import {
  Loader2,
  LinkIcon,
  RefreshCw,
  UploadCloud,
  RotateCcw,
  X,
  Play,
  Eye,
  Trash2,
} from "lucide-react";
import { useEffect, useState } from "react";
import { generateUploadUrl } from "~/actions/s3";
import { toast } from "sonner";
import {
  processVideo,
  processYoutubeVideo,
  clearQueueItem,
} from "~/actions/generation";
import {
  TOAST_DURATION_SHORT,
  TOAST_DURATION_MEDIUM,
  TOAST_DURATION_LONG,
} from "~/lib/utils";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import {
  Table,
  TableBody,
  TableCell,
  TableHead,
  TableHeader,
  TableRow,
} from "./ui/table";
import { Badge } from "./ui/badge";
import { useRouter } from "next/navigation";

type UploadedFileRow = {
  id: string;
  s3Key: string;
  filename: string;
  youtubeUrl: string | null;
  status: string;
  clipMode: string | null;
  isPreview: boolean | null;
  clipsCount: number;
  errorMessage: string | null;
  createdAt: Date;
  updatedAt: Date;
};

export function DashboardClient({
  uploadedFiles: initialUploadedFiles,
}: {
  uploadedFiles: UploadedFileRow[];
}) {
  const [localUploadedFiles, setLocalUploadedFiles] =
    useState<UploadedFileRow[]>(initialUploadedFiles);

  const [files, setFiles] = useState<File[]>([]);
  const [uploading, setUploading] = useState(false);
  const [refreshing, setRefreshing] = useState(false);
  const [youtubeUrl, setYoutubeUrl] = useState("");
  const [processingYt, setProcessingYt] = useState(false);
  const [clipMode, setClipMode] = useState("all");
  const [previewOnly, setPreviewOnly] = useState(false);
  const [retryingId, setRetryingId] = useState<string | null>(null);
  const [cancellingId, setCancellingId] = useState<string | null>(null);
  const [clearingId, setClearingId] = useState<string | null>(null);
  const router = useRouter();

  const fetchQueueStatus = async () => {
    try {
      const res = await fetch("/api/queue-status");
      if (res.ok) {
        const data = await res.json();
        const parsedFiles = data.uploadedFiles.map((file: any) => ({
          ...file,
          createdAt: new Date(file.createdAt),
          updatedAt: new Date(file.updatedAt),
        }));
        setLocalUploadedFiles(parsedFiles);
      }
    } catch (e) {
      console.error("Failed to fetch queue status", e);
    }
  };

  // Sync state with props in case of external RSC refresh
  useEffect(() => {
    setLocalUploadedFiles(initialUploadedFiles);
  }, [initialUploadedFiles]);

  // Auto-poll every 10 seconds while any file is still in progress
  const hasActiveJobs = localUploadedFiles.some(
    (f) => f.status === "queued" || f.status === "processing",
  );

  useEffect(() => {
    let interval: NodeJS.Timeout;
    if (hasActiveJobs) {
      interval = setInterval(() => {
        fetchQueueStatus();
      }, 10_000);
    } else {
      router.refresh();
    }
    return () => clearInterval(interval);
  }, [hasActiveJobs]);

  useEffect(() => {
    const handleBeforeUnload = (e: BeforeUnloadEvent) => {
      if (uploading || processingYt) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", handleBeforeUnload);
    return () => window.removeEventListener("beforeunload", handleBeforeUnload);
  }, [uploading, processingYt]);

  const handleRefresh = async () => {
    setRefreshing(true);
    await fetchQueueStatus();
    setTimeout(() => setRefreshing(false), 600);
  };

  const handleDrop = (acceptedFiles: File[]) => {
    setFiles(acceptedFiles);
  };

  const handleRetry = async (fileId: string) => {
    setRetryingId(fileId);
    try {
      const res = await fetch("/api/reset-stuck-jobs", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const data = (await res.json()) as { reset: number; message: string };
      if (res.ok && data.reset > 0) {
        toast.success("Job re-queued!", {
          description: "The job has been reset and will process again.",
          duration: 4000,
        });
        await fetchQueueStatus();
      } else {
        toast.error("Could not retry", {
          description: data.message ?? "The job may have already completed.",
        });
      }
    } catch {
      toast.error("Retry failed", {
        description: "An unexpected error occurred.",
      });
    } finally {
      setRetryingId(null);
    }
  };

  const handleCancel = async (fileId: string) => {
    setCancellingId(fileId);
    try {
      const res = await fetch("/api/cancel-job", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ fileId }),
      });
      const data = (await res.json()) as {
        cancelled?: boolean;
        message?: string;
        error?: string;
      };
      if (res.ok && data.cancelled) {
        toast.success("Job cancelled", {
          description: "The processing job has been stopped.",
          duration: TOAST_DURATION_SHORT,
        });
        await fetchQueueStatus();
      } else {
        toast.error("Could not cancel", {
          description:
            data.error ?? data.message ?? "The job may have already completed.",
        });
      }
    } catch {
      toast.error("Cancel failed", {
        description: "An unexpected error occurred.",
      });
    } finally {
      setCancellingId(null);
    }
  };

  const handleClearQueue = async (fileId: string) => {
    setClearingId(fileId);
    try {
      const res = await clearQueueItem(fileId);
      if (res.success) {
        toast.success("Job cleared from queue.");
        await fetchQueueStatus();
      } else {
        toast.error(res.error || "Could not clear job.");
      }
    } catch {
      toast.error("Failed to clear queue item.");
    } finally {
      setClearingId(null);
    }
  };

  const handleYoutubeSubmit = async () => {
    if (!youtubeUrl.trim() || processingYt) return;
    setProcessingYt(true);
    try {
      const result = await processYoutubeVideo(
        youtubeUrl.trim(),
        clipMode,
        previewOnly,
      );
      if (!result.success) {
        toast.error("Invalid URL", {
          description: result.error ?? "Could not queue this YouTube video.",
        });
        return;
      }
      setYoutubeUrl("");
      toast.success("YouTube video queued!", {
        description:
          "Your video is downloading and will be processed automatically. Check the queue status below.",
        duration: TOAST_DURATION_LONG,
      });
      await fetchQueueStatus();
    } catch {
      toast.error("Failed to queue YouTube video", {
        description: "An unexpected error occurred. Please try again.",
      });
    } finally {
      setProcessingYt(false);
    }
  };

  const handleUpload = async () => {
    if (files.length === 0 || uploading) return;

    const file = files[0]!;
    setUploading(true);

    try {
      const { success, signedUrl, uploadedFileId } = await generateUploadUrl({
        filename: file.name,
        contentType: file.type,
      });

      if (!success) throw new Error("Failed to get upload URL");

      const uploadResponse = await fetch(signedUrl, {
        method: "PUT",
        body: file,
        headers: { "Content-Type": file.type },
      });

      if (!uploadResponse.ok)
        throw new Error(`Upload failed with status: ${uploadResponse.status}`);

      await processVideo(uploadedFileId, clipMode, previewOnly);

      setFiles([]);

      toast.success("Video uploaded successfully", {
        description:
          "Your video has been scheduled for processing. Check the queue status below.",
        duration: TOAST_DURATION_MEDIUM,
      });
      await fetchQueueStatus();
    } catch {
      toast.error("Upload failed", {
        description:
          "There was a problem uploading your video. Please try again.",
      });
    } finally {
      setUploading(false);
    }
  };

  // ── Shared Queue Status Table ───────────────────────────────────────────────
  const QueueStatusTable = () =>
    localUploadedFiles.length > 0 ? (
      <div className="pt-6">
        <div className="mb-2 flex items-center justify-between">
          <h3 className="text-md font-medium">Queue status</h3>
          <Button
            variant="outline"
            size="sm"
            onClick={handleRefresh}
            disabled={refreshing}
          >
            {refreshing ? (
              <Loader2 className="mr-2 h-4 w-4 animate-spin" />
            ) : (
              <RefreshCw className="mr-2 h-4 w-4" />
            )}
            Refresh
          </Button>
        </div>
        <div className="max-h-[300px] overflow-auto rounded-md border">
          <Table>
            <TableHeader>
              <TableRow>
                <TableHead>File</TableHead>
                <TableHead>Uploaded</TableHead>
                <TableHead>Status</TableHead>
                <TableHead>Clips</TableHead>
                <TableHead>Action</TableHead>
              </TableRow>
            </TableHeader>
            <TableBody>
              {localUploadedFiles.map((item) => {
                const showRetry =
                  item.status === "failed" || item.status === "cancelled";
                const showCancel =
                  item.status === "queued" || item.status === "processing";

                return (
                  <TableRow key={item.id}>
                    <TableCell className="max-w-xs font-medium">
                      <div className="flex flex-col gap-1">
                        <div className="flex items-center gap-2 truncate">
                          <span className="truncate">{item.filename}</span>
                          {item.youtubeUrl && (
                            <a
                              href={item.youtubeUrl}
                              target="_blank"
                              rel="noopener noreferrer"
                              className="shrink-0 text-red-500 transition-colors hover:text-red-600"
                              title="Open original YouTube video"
                            >
                              <Play className="h-4 w-4 fill-current" />
                            </a>
                          )}
                        </div>
                        {item.clipMode && (
                          <div className="flex items-center gap-1">
                            {item.isPreview && (
                              <Badge
                                variant="secondary"
                                className="h-4 px-1 py-0 text-[10px]"
                              >
                                <Eye className="mr-1 h-3 w-3" />
                                Preview
                              </Badge>
                            )}
                            <Badge
                              variant="outline"
                              className="h-4 px-1 py-0 text-[10px] capitalize"
                            >
                              {item.clipMode}
                            </Badge>
                          </div>
                        )}
                      </div>
                    </TableCell>
                    <TableCell className="text-muted-foreground text-sm">
                      {new Date(item.createdAt).toLocaleDateString()}
                    </TableCell>
                    <TableCell>
                      {item.status === "queued" && (
                        <Badge
                          variant="outline"
                          className="border-blue-300 bg-blue-50 text-blue-600"
                        >
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Queued
                        </Badge>
                      )}
                      {item.status === "processing" && (
                        <Badge
                          variant="outline"
                          className="border-yellow-300 bg-yellow-50 text-yellow-700"
                        >
                          <Loader2 className="mr-1 h-3 w-3 animate-spin" />
                          Processing
                        </Badge>
                      )}
                      {item.status === "processed" && (
                        <Badge
                          variant="outline"
                          className="border-green-300 bg-green-50 text-green-700"
                        >
                          Done
                        </Badge>
                      )}
                      {item.status === "no credits" && (
                        <Badge variant="destructive">No credits</Badge>
                      )}
                      {item.status === "failed" && (
                        <div className="flex flex-col gap-0.5">
                          <Badge variant="destructive">Failed</Badge>
                          {item.errorMessage && (
                            <span className="max-w-[160px] text-xs text-red-500">
                              {item.errorMessage}
                            </span>
                          )}
                        </div>
                      )}
                      {item.status === "cancelled" && (
                        <Badge variant="secondary">Cancelled</Badge>
                      )}
                    </TableCell>
                    <TableCell>
                      {item.status === "processed" ? (
                        item.clipsCount > 0 ? (
                          <span className="font-medium">
                            {item.clipsCount} clip
                            {item.clipsCount !== 1 ? "s" : ""}
                          </span>
                        ) : (
                          <span className="text-muted-foreground text-sm">
                            0 clips
                          </span>
                        )
                      ) : item.status === "no credits" ||
                        item.status === "failed" ||
                        item.status === "cancelled" ? (
                        <span className="text-muted-foreground">—</span>
                      ) : (
                        <span className="text-muted-foreground text-sm">
                          Pending…
                        </span>
                      )}
                    </TableCell>
                    <TableCell>
                      <div className="flex items-center gap-2">
                        {showRetry && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleRetry(item.id)}
                            disabled={
                              retryingId === item.id || cancellingId === item.id
                            }
                            title="Retry job"
                          >
                            {retryingId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <RotateCcw className="h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {showCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleCancel(item.id)}
                            disabled={
                              cancellingId === item.id || retryingId === item.id
                            }
                            title="Cancel job"
                          >
                            {cancellingId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <X className="text-muted-foreground hover:text-destructive h-4 w-4" />
                            )}
                          </Button>
                        )}
                        {!showCancel && (
                          <Button
                            variant="ghost"
                            size="sm"
                            onClick={() => handleClearQueue(item.id)}
                            disabled={
                              clearingId === item.id || retryingId === item.id
                            }
                            title="Clear from queue"
                          >
                            {clearingId === item.id ? (
                              <Loader2 className="h-4 w-4 animate-spin" />
                            ) : (
                              <Trash2 className="text-muted-foreground hover:text-destructive h-4 w-4" />
                            )}
                          </Button>
                        )}
                      </div>
                    </TableCell>
                  </TableRow>
                );
              })}
            </TableBody>
          </Table>
        </div>
      </div>
    ) : null;

  return (
    <div className="mx-auto flex max-w-5xl flex-col space-y-6 px-4 py-8">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">
            Podcast Clipper
          </h1>
          <p className="text-muted-foreground">
            Upload your podcast and get AI-generated clips instantly
          </p>
        </div>
        <div className="flex gap-2">
          <Link href="/dashboard/youtube">
            <Button variant="outline">YouTube Channel</Button>
          </Link>
          <Link href="/dashboard/billing">
            <Button>Buy Credits</Button>
          </Link>
        </div>
      </div>

      {/* Clip Mode Selector — shared across all input tabs */}
      <div className="flex flex-wrap items-center gap-3 rounded-lg border p-3">
        <div className="flex items-center gap-2">
          <span className="text-sm font-medium">Clip Mode:</span>
          <Select value={clipMode} onValueChange={setClipMode}>
            <SelectTrigger className="w-44">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              <SelectItem value="all">All Modes</SelectItem>
              <SelectItem value="qa">Q&amp;A Mode</SelectItem>
              <SelectItem value="educational">Educational Mode</SelectItem>
              <SelectItem value="motivational">Motivational Mode</SelectItem>
              <SelectItem value="highlights">Highlights Mode</SelectItem>
            </SelectContent>
          </Select>
        </div>
        <div className="flex items-center gap-2">
          <input
            type="checkbox"
            id="preview-toggle"
            checked={previewOnly}
            onChange={(e) => setPreviewOnly(e.target.checked)}
            className="h-4 w-4 rounded border"
          />
          <label htmlFor="preview-toggle" className="text-sm">
            Preview mode{" "}
            <span className="text-muted-foreground text-xs">
              (fast 480p, pick favourites then render full quality)
            </span>
          </label>
        </div>
      </div>

      <Tabs defaultValue="upload">
        <TabsList>
          <TabsTrigger value="upload">Upload</TabsTrigger>
          <TabsTrigger value="youtube">
            <LinkIcon className="mr-1.5 h-4 w-4" />
            YouTube URL
          </TabsTrigger>
        </TabsList>

        {/* ── Upload Tab ───────────────────────────────────────────────────── */}
        <TabsContent value="upload">
          <Card>
            <CardHeader>
              <CardTitle>Upload Podcast</CardTitle>
              <CardDescription>
                Upload your audio or video file to generate clips
              </CardDescription>
            </CardHeader>
            <CardContent>
              <Dropzone
                onDrop={handleDrop}
                accept={{ "video/mp4": [".mp4"] }}
                maxSize={500 * 1024 * 1024}
                disabled={uploading}
                maxFiles={1}
              >
                {() => (
                  <>
                    <div className="flex flex-col items-center justify-center space-y-4 rounded-lg p-10 text-center">
                      <UploadCloud className="text-muted-foreground h-12 w-12" />
                      <p className="font-medium">Drag and drop your file</p>
                      <p className="text-muted-foreground text-sm">
                        or click to browse (MP4 up to 500MB)
                      </p>
                      <Button
                        className="cursor-pointer"
                        variant="default"
                        size="sm"
                        disabled={uploading}
                      >
                        Select File
                      </Button>
                    </div>
                  </>
                )}
              </Dropzone>

              <div className="mt-2 flex items-start justify-between">
                <div>
                  {files.length > 0 && (
                    <div className="space-y-1 text-sm">
                      <p className="font-medium">Selected file:</p>
                      {files.map((file) => (
                        <p key={file.name} className="text-muted-foreground">
                          {file.name}
                        </p>
                      ))}
                    </div>
                  )}
                </div>
                <Button
                  disabled={files.length === 0 || uploading}
                  onClick={handleUpload}
                >
                  {uploading ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Uploading...
                    </>
                  ) : (
                    "Upload and Generate Clips"
                  )}
                </Button>
              </div>

              <QueueStatusTable />
            </CardContent>
          </Card>
        </TabsContent>

        {/* ── YouTube URL Tab ──────────────────────────────────────────────── */}
        <TabsContent value="youtube">
          <Card>
            <CardHeader>
              <CardTitle>Process YouTube Video</CardTitle>
              <CardDescription>
                Paste a YouTube link — the video downloads automatically on our
                GPU servers. No file upload needed.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="flex gap-2">
                <Input
                  placeholder="https://www.youtube.com/watch?v=..."
                  value={youtubeUrl}
                  onChange={(e) => setYoutubeUrl(e.target.value)}
                  onKeyDown={(e) => e.key === "Enter" && handleYoutubeSubmit()}
                  disabled={processingYt}
                  className="flex-1"
                />
                <Button
                  onClick={handleYoutubeSubmit}
                  disabled={!youtubeUrl.trim() || processingYt}
                >
                  {processingYt ? (
                    <>
                      <Loader2 className="mr-2 h-4 w-4 animate-spin" />
                      Queuing…
                    </>
                  ) : (
                    "Generate Clips"
                  )}
                </Button>
              </div>
              <p className="text-muted-foreground text-xs">
                Supports standard YouTube URLs, shortened <code>youtu.be</code>{" "}
                links, and YouTube Shorts.
              </p>

              <div className="rounded-md border border-yellow-200 bg-yellow-50 p-3">
                <p className="flex items-center gap-2 text-xs text-yellow-800">
                  <span className="font-bold"> Notice :</span> YouTube downloads
                  may be blocked in cloud environments due to IP restrictions.{" "}
                  <span className="font-semibold underline">
                    This feature works perfectly in the local environment.
                  </span>
                </p>
              </div>

              {/* Queue status is visible here too */}
              <QueueStatusTable />
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
