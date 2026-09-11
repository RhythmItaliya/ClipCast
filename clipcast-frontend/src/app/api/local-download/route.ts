/**
 * TEMP — Local yt-dlp fallback download endpoint.
 *
 * This route runs yt-dlp directly on the dev machine and uploads the result
 * to S3. It is ONLY used as a fallback when the Modal cloud downloader fails
 * (e.g. YouTube bot-detection blocks all proxies). It runs on the local
 * Next.js server, so it only works in local development.
 *
 * To enable: set LOCAL_DOWNLOAD_ENDPOINT=http://localhost:3000/api/local-download
 * in your .env. Remove this env var (and this file) once the Modal downloader
 * is fixed or a residential proxy is configured.
 *
 * Request body (same shape as postCloudDownloader):
 *   { youtube_url: string, s3_key: string, audio_only?: boolean }
 *
 * Response (same shape as Modal downloader completed response):
 *   { status: "completed", s3_key, duration, source_bytes, title?, uploader? }
 */

import { execFile } from "child_process";
import * as fs from "fs";
import * as os from "os";
import * as path from "path";
import { promisify } from "util";
import { PutObjectCommand, S3Client } from "@aws-sdk/client-s3";
import { NextRequest, NextResponse } from "next/server";
import { env } from "~/env";

const execFileAsync = promisify(execFile);

function getS3Client() {
  return new S3Client({
    region: env.AWS_REGION,
    credentials: {
      accessKeyId: env.AWS_ACCESS_KEY_ID,
      secretAccessKey: env.AWS_SECRET_ACCESS_KEY,
    },
  });
}

/** Resolve the yt-dlp binary: YT_DLP_PATH env var, then PATH. */
function resolveYtDlp(): string {
  if (env.YT_DLP_PATH) return env.YT_DLP_PATH;
  // Try common locations on Linux
  for (const candidate of [
    "/usr/local/bin/yt-dlp",
    "/usr/bin/yt-dlp",
    `${os.homedir()}/.local/bin/yt-dlp`,
  ]) {
    if (fs.existsSync(candidate)) return candidate;
  }
  return "yt-dlp"; // fall through to PATH
}

/**
 * Find a JavaScript runtime yt-dlp can use to solve YouTube's "n challenge"
 * (needed for most video formats). Returns the runtime name (deno/node/bun) if
 * one is on PATH, else null so we simply omit the flag rather than forcing a
 * runtime that isn't installed (which makes yt-dlp error out immediately).
 */
function resolveJsRuntime(): string | null {
  for (const rt of ["deno", "node", "bun"]) {
    for (const dir of (process.env.PATH ?? "").split(path.delimiter)) {
      if (dir && fs.existsSync(path.join(dir, rt))) return rt;
    }
  }
  return null;
}

export async function POST(req: NextRequest) {
  // Safety guard: this endpoint must never be reachable in production.
  // LOCAL_DOWNLOAD_ENDPOINT should never be set to a public URL.
  if (env.NODE_ENV === "production") {
    return NextResponse.json(
      { detail: "Local download endpoint is disabled in production." },
      { status: 403 },
    );
  }

  let body: {
    youtube_url?: string;
    s3_key?: string;
    audio_only?: boolean;
  };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ detail: "Invalid JSON body." }, { status: 400 });
  }

  const { youtube_url: youtubeUrl, s3_key: s3Key, audio_only: audioOnly = false } = body;

  if (!youtubeUrl || !s3Key) {
    return NextResponse.json(
      { detail: "youtube_url and s3_key are required." },
      { status: 422 },
    );
  }

  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), "clipcast-local-dl-"));
  const outputTemplate = path.join(tmpDir, "source.%(ext)s");
  const ytDlp = resolveYtDlp();

  try {
    // Cookie auth first — it decides the player-client choice below. YT_DLP_COOKIES
    // may be EITHER a path to a Netscape cookies.txt OR the file's contents pasted
    // inline; a path is cleaner for local dev (no multiline value in .env).
    let cookiesPath: string | null = null;
    const rawCookies = env.YT_DLP_COOKIES?.trim();
    if (rawCookies) {
      if (fs.existsSync(rawCookies)) {
        cookiesPath = rawCookies; // it's a file path
      } else {
        cookiesPath = path.join(tmpDir, "yt_cookies.txt");
        fs.writeFileSync(cookiesPath, env.YT_DLP_COOKIES!);
      }
    }

    // Build yt-dlp args — mirror of the Modal worker's _run_yt_dlp().
    const args: string[] = [
      "--no-playlist",
      "--no-progress",
      "--retries", "3",
      "--fragment-retries", "3",
      "--socket-timeout", "30",
      "--write-info-json",
    ];

    // Player client depends on whether we're signed in:
    //  • With cookies → let yt-dlp use its default (web) clients, which serve
    //    the full quality ladder (720p+). Forcing ios/mweb here would cap us at
    //    360p because those clients need a GVS PO Token for higher formats.
    //  • Without cookies → force ios,mweb, which dodges "confirm you're not a
    //    bot" (at the cost of only offering the 360p progressive format).
    if (!cookiesPath) {
      args.push("--extractor-args", "youtube:player_client=ios,mweb");
    }

    // JS runtime for YouTube's "n challenge". Only add the flag if a runtime is
    // actually installed — forcing one that's missing makes yt-dlp error out.
    const jsRuntime = resolveJsRuntime();
    if (jsRuntime) {
      args.push("--js-runtimes", jsRuntime);
    } else {
      console.warn(
        "[local-download] No JS runtime (deno/node/bun) found — some formats " +
          "may be unavailable. Install one, or set YT_DLP_COOKIES.",
      );
    }

    // Proxy: usually the local machine's home IP works fine (YouTube blocks
    // datacenter IPs, not residential), so disable any ambient proxy with an
    // empty --proxy. If YT_DLP_PROXY is set (home IP rate-limited), use it.
    // NOTE: yt-dlp has no "--no-proxy" flag; empty --proxy is how you opt out.
    args.push("--proxy", env.YT_DLP_PROXY ?? "");

    if (cookiesPath) {
      args.push("--cookies", cookiesPath);
    }

    if (audioOnly) {
      args.push("-f", "bestaudio/best");
    } else {
      args.push(
        "-f", "bv*[height<=2160]+ba/b[height<=2160]/b",
        "--merge-output-format", "mp4",
        "--remux-video", "mp4",
      );
    }

    args.push("-o", outputTemplate, youtubeUrl);

    console.log(`[local-download] TEMP: running yt-dlp locally for ${youtubeUrl}`);
    await execFileAsync(ytDlp, args, { timeout: 30 * 60 * 1000 }); // 30 min max

    // Find the downloaded file (exclude .part / .info.json sidecars)
    const files = fs.readdirSync(tmpDir).filter((f) => {
      const ext = path.extname(f);
      return (
        !f.endsWith(".part") &&
        !f.endsWith(".ytdl") &&
        !f.endsWith(".info.json") &&
        ext !== ""
      );
    });

    if (files.length === 0) {
      return NextResponse.json(
        { detail: "yt-dlp produced no output file." },
        { status: 502 },
      );
    }

    // Pick the largest file (in case of sidecars slipping through)
    const sourceFile = files
      .map((f) => ({ f, size: fs.statSync(path.join(tmpDir, f)).size }))
      .sort((a, b) => b.size - a.size)[0]!;
    const sourcePath = path.join(tmpDir, sourceFile.f);

    // Read duration from info JSON (best-effort)
    let duration = 0;
    let title: string | undefined;
    let uploader: string | undefined;
    const infoFiles = fs.readdirSync(tmpDir).filter((f) => f.endsWith(".info.json"));
    if (infoFiles.length > 0) {
      try {
        const info = JSON.parse(
          fs.readFileSync(path.join(tmpDir, infoFiles[0]!), "utf8"),
        ) as { duration?: number; title?: string; uploader?: string; channel?: string };
        duration = info.duration ?? 0;
        title = info.title;
        uploader = info.uploader ?? info.channel;
      } catch {
        // Non-fatal — pipeline handles missing duration gracefully.
      }
    }

    // Upload to S3
    console.log(`[local-download] TEMP: uploading ${sourceFile.f} (${(sourceFile.size / 1_048_576).toFixed(1)} MB) to S3 key ${s3Key}`);
    const fileBuffer = fs.readFileSync(sourcePath);
    await getS3Client().send(
      new PutObjectCommand({
        Bucket: env.S3_BUCKET_NAME,
        Key: s3Key,
        Body: fileBuffer,
        ContentType: audioOnly ? "audio/mp4" : "video/mp4",
      }),
    );

    console.log(`[local-download] TEMP: upload complete → ${s3Key}`);
    return NextResponse.json({
      status: "completed",
      s3_key: s3Key,
      duration,
      source_bytes: sourceFile.size,
      title: title ?? null,
      uploader: uploader ?? null,
    });
  } catch (err) {
    const msg = err instanceof Error ? err.message : String(err);
    console.error(`[local-download] TEMP: failed for ${youtubeUrl}:`, msg);
    return NextResponse.json(
      { detail: `Local download failed: ${msg.slice(0, 800)}` },
      { status: 502 },
    );
  } finally {
    // Clean up temp files regardless of success/failure
    fs.rmSync(tmpDir, { recursive: true, force: true });
  }
}
