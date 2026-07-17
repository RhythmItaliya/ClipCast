"use client";

import {
  Link2,
  Music,
  Plus,
  Sparkles,
  Trash2,
  Upload,
  Wand2,
} from "lucide-react";
import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";
import { toast } from "sonner";
import {
  createAdvancedMix,
  createGeneratedTrack,
  generateAudioSourceUploadUrl,
  type AudioSourceInput,
  type AudioSourceRole,
  type MixTransformStrength,
} from "~/actions/audio";
import { Button } from "~/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "~/components/ui/card";
import { Input } from "~/components/ui/input";
import { Label } from "~/components/ui/label";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "~/components/ui/select";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "~/components/ui/tabs";

const GENRES = [
  "auto",
  "lofi",
  "ambient",
  "cinematic",
  "trap",
  "house",
  "pop",
  "bollywood",
  "rock",
] as const;

type LocalSource = {
  localId: string;
  kind: "youtube" | "s3";
  role: AudioSourceRole;
  label: string;
  url: string;
  file?: File;
  s3Key?: string;
};

function newSource(kind: "youtube" | "s3" = "youtube"): LocalSource {
  const id =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID()
      : `${Date.now()}-${Math.random()}`;
  return {
    localId: id,
    kind,
    role: "auto",
    label: kind === "youtube" ? "YouTube source" : "Audio file",
    url: "",
  };
}

export function AudioStudioClient() {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [uploading, setUploading] = useState(false);

  const [prompt, setPrompt] = useState("");
  const [genre, setGenre] = useState<string>("auto");
  const [mixGenre, setMixGenre] = useState<string>("auto");
  const [transformStrength, setTransformStrength] =
    useState<MixTransformStrength>("auto");
  const [remixDuration, setRemixDuration] = useState("auto");
  const [sources, setSources] = useState<LocalSource[]>([
    { ...newSource("youtube"), role: "auto", label: "Song A (X)" },
    { ...newSource("youtube"), role: "auto", label: "Song B (ABC)" },
  ]);

  function updateSource(localId: string, patch: Partial<LocalSource>) {
    setSources((current) =>
      current.map((source) =>
        source.localId === localId ? { ...source, ...patch } : source,
      ),
    );
  }

  function addSource(kind: "youtube" | "s3") {
    if (sources.length >= 6) {
      toast.error("Use up to 6 sources in one mix.");
      return;
    }
    setSources((current) => [...current, newSource(kind)]);
  }

  function removeSource(localId: string) {
    setSources((current) =>
      current.length > 1
        ? current.filter((source) => source.localId !== localId)
        : current,
    );
  }

  function handleResult(result: { success: boolean; error?: string }) {
    if (result.success) {
      toast.success("Added to your queue. We'll email you when it's ready.");
      setPrompt("");
      router.push("/dashboard/queue");
    } else {
      toast.error(result.error ?? "Something went wrong. Please try again.");
    }
  }

  async function prepareMixSources(): Promise<AudioSourceInput[]> {
    const prepared: AudioSourceInput[] = [];
    for (const source of sources) {
      if (source.kind === "youtube") {
        if (!source.url.trim()) continue;
        prepared.push({
          kind: "youtube",
          url: source.url.trim(),
          role: source.role,
          label: source.label,
        });
        continue;
      }

      let s3Key = source.s3Key;
      if (!s3Key && source.file) {
        const upload = await generateAudioSourceUploadUrl({
          filename: source.file.name,
          contentType: source.file.type || "audio/mpeg",
          size: source.file.size,
        });
        if (!upload.success) throw new Error(upload.error);
        const response = await fetch(upload.signedUrl, {
          method: "PUT",
          body: source.file,
          headers: { "Content-Type": source.file.type || "audio/mpeg" },
        });
        if (!response.ok) {
          throw new Error("Could not upload one audio file. Please try again.");
        }
        s3Key = upload.key;
        updateSource(source.localId, { s3Key });
      }
      if (!s3Key) continue;
      prepared.push({
        kind: "s3",
        s3Key,
        role: source.role,
        label: source.file?.name ?? source.label,
      });
    }
    return prepared;
  }

  function submitMix() {
    startTransition(async () => {
      try {
        setUploading(true);
        const prepared = await prepareMixSources();
        handleResult(
          await createAdvancedMix(
            prepared,
            transformStrength,
            // "auto" → 0 tells the mixer to pick the length musically.
            remixDuration === "auto" ? 0 : Number(remixDuration),
            mixGenre,
          ),
        );
      } catch (error) {
        toast.error(error instanceof Error ? error.message : "Could not start mix.");
      } finally {
        setUploading(false);
      }
    });
  }

  function submitGenerate() {
    startTransition(async () =>
      handleResult(await createGeneratedTrack(prompt, genre)),
    );
  }

  const hasMixInput = sources.some((source) =>
    source.kind === "youtube" ? source.url.trim() : source.file || source.s3Key,
  );

  return (
    <div className="w-full">
      <Tabs defaultValue="mix">
        <TabsList className="mb-6">
          <TabsTrigger value="mix">
            <Music className="mr-2 h-4 w-4" /> AI mix
          </TabsTrigger>
          <TabsTrigger value="generate">
            <Wand2 className="mr-2 h-4 w-4" /> Compose
          </TabsTrigger>
        </TabsList>

        <TabsContent value="mix">
          <Card>
            <CardHeader>
              <CardTitle>Viral hook mix (X × ABC)</CardTitle>
              <CardDescription>
                Add one or two songs (YouTube or audio). We extract every stem,
                find the catchiest part of each, focus on the tune, and join them
                into a short clip with a beat-matched transition and studio FX.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-3">
                {sources.map((source, index) => (
                  <div
                    key={source.localId}
                    className="border-border grid gap-3 rounded-md border p-3 md:grid-cols-[140px_140px_1fr_40px]"
                  >
                    <div className="space-y-2">
                      <Label>Source</Label>
                      <Select
                        value={source.kind}
                        onValueChange={(value: "youtube" | "s3") =>
                          updateSource(source.localId, {
                            kind: value,
                            url: "",
                            file: undefined,
                            s3Key: undefined,
                            label:
                              value === "youtube"
                                ? `YouTube ${index + 1}`
                                : `Audio ${index + 1}`,
                          })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="youtube">YouTube</SelectItem>
                          <SelectItem value="s3">Audio file</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>Role</Label>
                      <Select
                        value={source.role}
                        onValueChange={(value: AudioSourceRole) =>
                          updateSource(source.localId, { role: value })
                        }
                      >
                        <SelectTrigger>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          <SelectItem value="auto">Auto</SelectItem>
                          <SelectItem value="vocal">Vocal</SelectItem>
                          <SelectItem value="bed">Bed</SelectItem>
                          <SelectItem value="extra">Extra</SelectItem>
                        </SelectContent>
                      </Select>
                    </div>

                    <div className="space-y-2">
                      <Label>
                        {source.kind === "youtube" ? "YouTube link" : "Audio file"}
                      </Label>
                      {source.kind === "youtube" ? (
                        <div className="relative">
                          <Link2 className="text-muted-foreground pointer-events-none absolute top-2.5 left-3 h-4 w-4" />
                          <Input
                            className="pl-9"
                            placeholder="https://youtube.com/watch?v=..."
                            value={source.url}
                            onChange={(event) =>
                              updateSource(source.localId, {
                                url: event.target.value,
                              })
                            }
                          />
                        </div>
                      ) : (
                        <Input
                          type="file"
                          accept="audio/mpeg,audio/mp3,audio/wav,audio/x-wav,audio/mp4,audio/aac,audio/flac,audio/ogg"
                          onChange={(event) =>
                            updateSource(source.localId, {
                              file: event.target.files?.[0],
                              s3Key: undefined,
                            })
                          }
                        />
                      )}
                    </div>

                    <div className="flex items-end">
                      <Button
                        type="button"
                        variant="outline"
                        size="icon"
                        onClick={() => removeSource(source.localId)}
                        disabled={sources.length === 1}
                        aria-label="Remove source"
                      >
                        <Trash2 className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>

              <div className="flex flex-wrap gap-2">
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addSource("youtube")}
                >
                  <Plus className="h-4 w-4" /> YouTube
                </Button>
                <Button
                  type="button"
                  variant="outline"
                  onClick={() => addSource("s3")}
                >
                  <Upload className="h-4 w-4" /> Audio file
                </Button>
              </div>

              <div className="space-y-2">
                <Label htmlFor="mix-genre">Target genre</Label>
                <Select value={mixGenre} onValueChange={setMixGenre}>
                  <SelectTrigger id="mix-genre">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {GENRES.map((item) => (
                      <SelectItem
                        key={item}
                        value={item}
                        className="capitalize"
                      >
                        {item === "auto" ? "Auto (match the songs)" : item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-muted-foreground text-xs">
                  Convert the best part of your song{sources.length > 1 ? "s" : ""} into
                  this style. Auto keeps the source genre.
                </p>
              </div>

              <div className="space-y-2">
                <Label htmlFor="transform-strength">Beat originality</Label>
                <Select
                  value={transformStrength}
                  onValueChange={(value: MixTransformStrength) =>
                    setTransformStrength(value)
                  }
                >
                  <SelectTrigger id="transform-strength">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto decide</SelectItem>
                    <SelectItem value="clean">Clean mix</SelectItem>
                    <SelectItem value="subtle">Subtle update</SelectItem>
                    <SelectItem value="transformed">Transformed</SelectItem>
                    <SelectItem value="max">Max change</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <div className="space-y-2">
                <Label htmlFor="remix-duration">Viral clip length</Label>
                <Select value={remixDuration} onValueChange={setRemixDuration}>
                  <SelectTrigger id="remix-duration">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="auto">Auto (AI decides)</SelectItem>
                    <SelectItem value="15">15 seconds</SelectItem>
                    <SelectItem value="20">20 seconds</SelectItem>
                    <SelectItem value="30">30 seconds</SelectItem>
                    <SelectItem value="45">45 seconds</SelectItem>
                    <SelectItem value="59">59 seconds (max)</SelectItem>
                  </SelectContent>
                </Select>
              </div>

              <Button
                onClick={submitMix}
                disabled={pending || uploading || !hasMixInput}
                className="w-full"
              >
                <Sparkles className="mr-2 h-4 w-4" />
                {pending || uploading ? "Adding..." : "Create AI mix"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>

        <TabsContent value="generate">
          <Card>
            <CardHeader>
              <CardTitle>Compose a track</CardTitle>
              <CardDescription>
                Gemini shapes the producer prompt, then the music model renders
                the track and the audio rater checks the master.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              <div className="space-y-2">
                <Label htmlFor="prompt">Song idea</Label>
                <Input
                  id="prompt"
                  placeholder="Hindi x English dance-pop hook with tabla, warm bass, glossy chorus"
                  value={prompt}
                  onChange={(event) => setPrompt(event.target.value)}
                />
              </div>
              <div className="space-y-2">
                <Label htmlFor="genre">Genre</Label>
                <Select value={genre} onValueChange={setGenre}>
                  <SelectTrigger id="genre">
                    <SelectValue placeholder="Pick a genre" />
                  </SelectTrigger>
                  <SelectContent>
                    {GENRES.map((item) => (
                      <SelectItem key={item} value={item} className="capitalize">
                        {item}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <Button
                onClick={submitGenerate}
                disabled={pending || (!prompt.trim() && !genre)}
                className="w-full"
              >
                <Wand2 className="mr-2 h-4 w-4" />
                {pending ? "Adding..." : "Compose track"}
              </Button>
            </CardContent>
          </Card>
        </TabsContent>
      </Tabs>
    </div>
  );
}
