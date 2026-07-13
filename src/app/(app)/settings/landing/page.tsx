"use client";

import { useEffect, useState, useCallback } from "react";
import { useRouter } from "next/navigation";
import { Plus, Trash2, ImagePlus, ExternalLink, Copy, Check, MapPin, Phone } from "lucide-react";
import {
  TelegramIcon,
  ViberIcon,
  WhatsappIcon,
  InstagramIcon,
  FacebookIcon,
  TiktokIcon,
  VkIcon,
  OkIcon,
  YoutubeIcon,
} from "@/components/landing/social-icons";
import { OwnerShell } from "@/components/owner-shell";
import { SpringCard } from "@/components/spring-card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { PressableScale } from "@/components/motion/pressable-scale";
import { FilePickerButton } from "@/components/file-picker-button";
import { InstructionQrSheet } from "@/components/instructions/instruction-qr-sheet";
import { StatusChip } from "@/components/status-chip";
import { AssetOrZoneIcon } from "@/components/icon-picker";
import { useI18n } from "@/components/i18n-provider";
import { compressImageFile } from "@/lib/client-image";
import { cn } from "@/lib/utils";
import { EffectPreview } from "@/components/landing/effect-preview";
import "@/components/landing/landing-themes.css";
import { InstructionEditor } from "@/components/instructions/instruction-editor";
import { EMPTY_DOC, type PMNode } from "@/lib/rich-text";

const THEME_KEYS = ["modern", "classic", "retro", "festival", "neon", "pixel"] as const;
type ThemeKey = (typeof THEME_KEYS)[number];
const EFFECT_KEYS = ["none", "snow", "confetti", "bubbles", "leaves", "sparks", "petals", "fireworks"] as const;
type EffectKey = (typeof EFFECT_KEYS)[number];

interface LandingData {
  id: string;
  status: "draft" | "published";
  previewToken: string;
  theme: ThemeKey;
  effect: EffectKey;
  tagline: string | null;
  aboutText: PMNode | null;
  galleryEnabled: boolean;
  ourFleetEnabled: boolean;
  showPrices: boolean;
  videoEnabled: boolean;
  videoYoutubeId: string | null;
  videoPoster: string | null;
  rulesInstructionId: string | null;
  contactPhone: string | null;
  contactTelegram: string | null;
  contactViber: string | null;
  contactWhatsapp: string | null;
  contactInstagram: string | null;
  contactFacebook: string | null;
  contactTiktok: string | null;
  contactVk: string | null;
  contactOk: string | null;
  contactYoutube: string | null;
  metaTitleOverride: string | null;
  metaDescriptionOverride: string | null;
  slug: string | null;
  tenantName: string;
  galleryPhotos: { id: string; url: string }[];
  zoneContents: { zoneId: string; photoUrl: string | null; caption: PMNode | null }[];
}

interface ZoneOption {
  id: string;
  name: string;
  pointId: string;
  pointName: string;
}

interface PointHint {
  id: string;
  name: string;
  address: string | null;
  hoursConfigured: boolean;
  iconKey: string | null;
}

interface InstructionOption {
  id: string;
  title: string;
  status: string;
}

const CONTACT_FIELDS = [
  { key: "contactPhone", labelKey: "phoneLabel", icon: Phone },
  { key: "contactTelegram", labelKey: "telegramLabel", icon: TelegramIcon },
  { key: "contactViber", labelKey: "viberLabel", icon: ViberIcon },
  { key: "contactWhatsapp", labelKey: "whatsappLabel", icon: WhatsappIcon },
  { key: "contactInstagram", labelKey: "instagramLabel", icon: InstagramIcon },
  { key: "contactFacebook", labelKey: "facebookLabel", icon: FacebookIcon },
  { key: "contactTiktok", labelKey: "tiktokLabel", icon: TiktokIcon },
  { key: "contactVk", labelKey: "vkLabel", icon: VkIcon },
  { key: "contactOk", labelKey: "okLabel", icon: OkIcon },
  { key: "contactYoutube", labelKey: "youtubeLabel", icon: YoutubeIcon },
] as const;

export default function LandingSettingsPage() {
  const t = useI18n();
  const router = useRouter();
  const [tab, setTab] = useState<"content" | "design" | "stats">("content");
  const [checking, setChecking] = useState(true);
  const [landing, setLanding] = useState<LandingData | null>(null);
  const [zones, setZones] = useState<ZoneOption[]>([]);
  const [points, setPoints] = useState<PointHint[]>([]);
  const [instructions, setInstructions] = useState<InstructionOption[]>([]);
  const [saving, setSaving] = useState(false);
  const [savedToast, setSavedToast] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [qrOpen, setQrOpen] = useState(false);
  const [linkCopied, setLinkCopied] = useState(false);
  // Список зон может быть большим при нескольких точках — фильтр по точке,
  // тот же dropdown-паттерн, что в /reports/[pointId] (решение пользователя
  // 2026-07-13). null означает "точка ещё не выбрана" — резолвится в первую
  // после загрузки points ниже.
  const [zonesPointId, setZonesPointId] = useState<string | null>(null);
  const [videoUrlInput, setVideoUrlInput] = useState("");
  const [savingVideo, setSavingVideo] = useState(false);
  const [videoError, setVideoError] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [landingRes, zonesRes, pointsRes, instructionsRes] = await Promise.all([
      fetch("/api/tenant/landing"),
      fetch("/api/zones"),
      fetch("/api/points"),
      fetch("/api/instructions"),
    ]);
    if (landingRes.status === 401) {
      router.replace("/login");
      return;
    }
    setLanding(await landingRes.json());
    const zonesData = await zonesRes.json();
    setZones(zonesData.zones ?? []);
    const pointsData = await pointsRes.json();
    setPoints(pointsData.points ?? []);
    const instructionsData = await instructionsRes.json();
    setInstructions((instructionsData.instructions ?? []).filter((i: InstructionOption) => i.status === "published"));
    setChecking(false);
  }, [router]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    load();
  }, [load]);
  /* eslint-enable react-hooks/set-state-in-effect */

  function update<K extends keyof LandingData>(key: K, value: LandingData[K]) {
    setLanding((prev) => (prev ? { ...prev, [key]: value } : prev));
  }

  async function saveContent() {
    if (!landing) return;
    setSaving(true);
    setError(null);
    try {
      const res = await fetch("/api/tenant/landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tagline: landing.tagline,
          aboutText: landing.aboutText,
          galleryEnabled: landing.galleryEnabled,
          ourFleetEnabled: landing.ourFleetEnabled,
          showPrices: landing.showPrices,
          rulesInstructionId: landing.rulesInstructionId,
          contactPhone: landing.contactPhone,
          contactTelegram: landing.contactTelegram,
          contactViber: landing.contactViber,
          contactWhatsapp: landing.contactWhatsapp,
          contactInstagram: landing.contactInstagram,
          contactFacebook: landing.contactFacebook,
          contactTiktok: landing.contactTiktok,
          contactVk: landing.contactVk,
          contactOk: landing.contactOk,
          contactYoutube: landing.contactYoutube,
          metaTitleOverride: landing.metaTitleOverride,
          metaDescriptionOverride: landing.metaDescriptionOverride,
        }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error ?? "Не удалось сохранить");
        return;
      }
      setSavedToast(true);
      setTimeout(() => setSavedToast(false), 1500);
      await load();
    } finally {
      setSaving(false);
    }
  }

  async function toggleOurFleet(next: boolean) {
    if (!landing) return;
    if (next) {
      const res = await fetch("/api/tenant/landing", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ ourFleetEnabled: true }),
      });
      if (!res.ok) {
        const data = await res.json();
        setError(data.error ?? t.landing.ourFleetDisabledHint);
        return;
      }
    }
    update("ourFleetEnabled", next);
  }

  // Тема/эффект — применяются сразу по клику на чип (тот же UX, что у
  // AccentPicker в /settings, не батчатся в общую кнопку "Сохранить" —
  // выбор одного варианта из фиксированного набора, а не текст для правки).
  async function selectTheme(next: ThemeKey) {
    if (!landing || landing.theme === next) return;
    update("theme", next);
    const res = await fetch("/api/tenant/landing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ theme: next }),
    });
    if (!res.ok) {
      update("theme", landing.theme);
      const data = await res.json();
      setError(data.error ?? "Не удалось сохранить тему");
    }
  }

  async function selectEffect(next: EffectKey) {
    if (!landing || landing.effect === next) return;
    update("effect", next);
    const res = await fetch("/api/tenant/landing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ effect: next }),
    });
    if (!res.ok) {
      update("effect", landing.effect);
      const data = await res.json();
      setError(data.error ?? "Не удалось сохранить эффект");
    }
  }

  async function saveVideo() {
    if (!videoUrlInput.trim()) return;
    setSavingVideo(true);
    setVideoError(null);
    try {
      const res = await fetch("/api/tenant/landing/video", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: videoUrlInput }),
      });
      const data = await res.json();
      if (!res.ok) {
        setVideoError(data.error ?? "Не удалось сохранить видео");
        return;
      }
      setVideoUrlInput("");
      await load();
    } finally {
      setSavingVideo(false);
    }
  }

  async function deleteVideo() {
    await fetch("/api/tenant/landing/video", { method: "DELETE" });
    await load();
  }

  // "Переключатель секции" и "Удалить видео" — два разных элемента (докс,
  // Шаг 6): выключение здесь НЕ стирает ссылку/обложку, только скрывает.
  async function toggleVideoEnabled(next: boolean) {
    if (!landing) return;
    const res = await fetch("/api/tenant/landing", {
      method: "PATCH",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ videoEnabled: next }),
    });
    if (!res.ok) {
      const data = await res.json();
      setVideoError(data.error ?? "Не удалось сохранить");
      return;
    }
    update("videoEnabled", next);
  }

  async function addGalleryPhoto(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    event.target.value = "";
    if (!file || !landing) return;
    const compressed = await compressImageFile(file);
    const formData = new FormData();
    formData.append("file", compressed);
    const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      setError(uploadData.error ?? "Не удалось загрузить фото");
      return;
    }
    await fetch("/api/tenant/landing/gallery", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ url: uploadData.url }),
    });
    await load();
  }

  async function removeGalleryPhoto(id: string) {
    await fetch(`/api/tenant/landing/gallery/${id}`, { method: "DELETE" });
    await load();
  }

  async function setZonePhoto(zoneId: string, file: File) {
    const compressed = await compressImageFile(file);
    const formData = new FormData();
    formData.append("file", compressed);
    const uploadRes = await fetch("/api/uploads", { method: "POST", body: formData });
    const uploadData = await uploadRes.json();
    if (!uploadRes.ok) {
      setError(uploadData.error ?? "Не удалось загрузить фото");
      return;
    }
    await fetch(`/api/tenant/landing/zones/${zoneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: uploadData.url }),
    });
    await load();
  }

  async function removeZonePhoto(zoneId: string) {
    await fetch(`/api/tenant/landing/zones/${zoneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ photoUrl: null }),
    });
    await load();
  }

  async function saveZoneCaption(zoneId: string, caption: PMNode) {
    await fetch(`/api/tenant/landing/zones/${zoneId}`, {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ caption }),
    });
  }

  async function publish() {
    const res = await fetch("/api/tenant/landing/publish", { method: "POST" });
    if (!res.ok) {
      const data = await res.json();
      setError(data.error ?? "Не удалось опубликовать");
      return;
    }
    await load();
  }

  async function unpublish() {
    await fetch("/api/tenant/landing/unpublish", { method: "POST" });
    await load();
  }

  async function copyPublicUrl() {
    await navigator.clipboard.writeText(publicUrl);
    setLinkCopied(true);
    setTimeout(() => setLinkCopied(false), 1500);
  }

  if (checking || !landing) return null;

  const publicUrl = landing.slug && typeof window !== "undefined" ? `${window.location.origin}/site/${landing.slug}` : "";
  const previewUrl =
    landing.slug && typeof window !== "undefined"
      ? `${window.location.origin}/site/${landing.slug}/preview/${landing.previewToken}`
      : "";
  const zoneContentByZoneId = new Map(landing.zoneContents.map((zc) => [zc.zoneId, zc]));
  const activeZonesPointId = zonesPointId ?? points[0]?.id ?? null;
  const visibleZones = zones.filter((z) => z.pointId === activeZonesPointId);

  return (
    <OwnerShell>
      <div className="flex flex-1 flex-col items-center bg-surface-0 px-4 py-10">
        <div className="flex w-full max-w-2xl flex-col gap-1">
          <div className="flex items-start justify-between gap-3">
            <h1 className="text-screen-title">{t.landing.settingsTitle}</h1>
            <StatusChip variant={landing.status === "published" ? "accent" : "neutral"}>
              {landing.status === "published" ? t.landing.statusPublishedLabel : t.landing.statusDraftLabel}
            </StatusChip>
          </div>
          <p className="mb-4 text-caption-airbnb">{t.landing.settingsHint}</p>

          {publicUrl && (
            <SpringCard hover={false} className="mb-4 flex flex-col gap-2">
              <div className="flex items-center justify-between gap-2">
                <a
                  href={publicUrl}
                  target="_blank"
                  rel="noreferrer"
                  className="flex min-w-0 items-center gap-1.5 truncate text-sm font-semibold text-primary"
                >
                  <ExternalLink className="size-4 shrink-0" />
                  <span className="truncate">{publicUrl}</span>
                </a>
                <PressableScale>
                  <Button
                    type="button"
                    variant="outline"
                    size="icon-sm"
                    onClick={copyPublicUrl}
                    aria-label={t.landing.copyLinkAction}
                  >
                    {linkCopied ? <Check className="size-3.5" /> : <Copy className="size-3.5" />}
                  </Button>
                </PressableScale>
              </div>
              <div className="flex flex-wrap gap-2">
                <PressableScale>
                  <a href={previewUrl} target="_blank" rel="noreferrer">
                    <Button type="button" variant="outline" size="sm">
                      {t.landing.previewButton}
                    </Button>
                  </a>
                </PressableScale>
                <PressableScale>
                  <Button type="button" variant="outline" size="sm" onClick={() => setQrOpen(true)}>
                    {t.landing.qrButton}
                  </Button>
                </PressableScale>
                {landing.status === "published" ? (
                  <PressableScale>
                    <Button type="button" variant="destructive" size="sm" onClick={unpublish}>
                      {t.landing.unpublishButton}
                    </Button>
                  </PressableScale>
                ) : (
                  <PressableScale>
                    <Button type="button" variant="dark" size="sm" onClick={publish}>
                      {t.landing.publishButton}
                    </Button>
                  </PressableScale>
                )}
              </div>
            </SpringCard>
          )}

          <div className="mb-4 flex w-full gap-1.5">
            {(
              [
                ["content", t.landing.tabContent],
                ["design", t.landing.tabDesign],
                ["stats", t.landing.tabStats],
              ] as const
            ).map(([key, label]) => (
              <button
                key={key}
                type="button"
                onClick={() => setTab(key)}
                className={cn(
                  "flex-1 rounded-full border px-3.5 py-1.5 text-center text-sm font-semibold",
                  tab === key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
                )}
              >
                {label}
              </button>
            ))}
          </div>

          {tab === "content" && (
            <div className="flex flex-col gap-4">
              <SpringCard hover={false} className="flex flex-col gap-3">
                <div className="flex flex-col gap-1">
                  <Label htmlFor="tagline">{t.landing.taglineLabel}</Label>
                  <Input
                    id="tagline"
                    placeholder={t.landing.taglinePlaceholder}
                    value={landing.tagline ?? ""}
                    onChange={(e) => update("tagline", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label>{t.landing.aboutLabel}</Label>
                  <InstructionEditor
                    content={landing.aboutText ?? EMPTY_DOC}
                    onChange={(json) => update("aboutText", json)}
                    heightClassName="h-64 min-h-0"
                  />
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-body-airbnb font-semibold">{t.landing.galleryTitle}</p>
                    <p className="text-caption-airbnb">{t.landing.galleryHint}</p>
                  </div>
                  <Switch checked={landing.galleryEnabled} onCheckedChange={(v) => update("galleryEnabled", v)} />
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-5">
                  {landing.galleryPhotos.map((photo) => (
                    <div key={photo.id} className="group relative aspect-square overflow-hidden rounded-control border border-border">
                      {/* eslint-disable-next-line @next/next/no-img-element */}
                      <img src={photo.url} alt="" className="size-full object-cover" />
                      <PressableScale className="absolute right-1 top-1">
                        <button
                          type="button"
                          onClick={() => removeGalleryPhoto(photo.id)}
                          className="rounded-full bg-foreground/70 p-1 text-background"
                        >
                          <Trash2 className="size-3.5" />
                        </button>
                      </PressableScale>
                    </div>
                  ))}
                  {landing.galleryPhotos.length < 10 && (
                    <label className="flex aspect-square cursor-pointer items-center justify-center rounded-control border-[1.5px] border-dashed border-border text-muted-foreground">
                      <Plus className="size-5" />
                      <input type="file" accept="image/jpeg,image/png,image/webp" className="hidden" onChange={addGalleryPhoto} />
                    </label>
                  )}
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-body-airbnb font-semibold">{t.landing.videoSectionTitle}</p>
                    <p className="text-caption-airbnb">{t.landing.videoSectionHint}</p>
                  </div>
                  <Switch
                    checked={landing.videoEnabled}
                    disabled={!landing.videoYoutubeId}
                    onCheckedChange={toggleVideoEnabled}
                  />
                </div>
                {landing.videoPoster && (
                  <div className="relative aspect-video w-full overflow-hidden rounded-control border border-border">
                    {/* eslint-disable-next-line @next/next/no-img-element */}
                    <img src={landing.videoPoster} alt="" className="size-full object-cover" />
                  </div>
                )}
                <div className="flex flex-col gap-1">
                  <Label htmlFor="videoUrl">{t.landing.videoUrlLabel}</Label>
                  <Input
                    id="videoUrl"
                    placeholder={t.landing.videoUrlPlaceholder}
                    value={videoUrlInput}
                    onChange={(e) => setVideoUrlInput(e.target.value)}
                  />
                </div>
                {videoError && <p className="text-sm text-destructive">{videoError}</p>}
                <div className="flex gap-2">
                  <PressableScale>
                    <Button type="button" variant="outline" size="sm" disabled={savingVideo} onClick={saveVideo}>
                      {landing.videoYoutubeId ? t.landing.videoReplaceButton : t.landing.videoAddButton}
                    </Button>
                  </PressableScale>
                  {landing.videoYoutubeId && (
                    <PressableScale>
                      <Button type="button" variant="destructive" size="sm" onClick={deleteVideo}>
                        {t.landing.videoDeleteButton}
                      </Button>
                    </PressableScale>
                  )}
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-4">
                <div>
                  <p className="text-body-airbnb font-semibold">{t.landing.zonesTitle}</p>
                  <p className="text-caption-airbnb">{t.landing.zonesHint}</p>
                </div>
                <div className="flex items-center justify-between gap-2 border-t border-border pt-3">
                  <div>
                    <p className="text-body-airbnb font-semibold">{t.landing.showPricesToggleLabel}</p>
                    <p className="text-caption-airbnb">{t.landing.showPricesHint}</p>
                  </div>
                  <Switch checked={landing.showPrices} onCheckedChange={(v) => update("showPrices", v)} />
                </div>
                {points.length > 1 && activeZonesPointId && (
                  <Select
                    value={activeZonesPointId}
                    onValueChange={(v) => v && setZonesPointId(v)}
                    items={points.map((p) => ({ value: p.id, label: p.name }))}
                  >
                    <SelectTrigger className="w-full">
                      <SelectValue>
                        <span className="flex items-center gap-2">
                          {(() => {
                            const current = points.find((p) => p.id === activeZonesPointId);
                            return current?.iconKey ? (
                              <AssetOrZoneIcon iconKey={current.iconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            );
                          })()}
                          {points.find((p) => p.id === activeZonesPointId)?.name}
                        </span>
                      </SelectValue>
                    </SelectTrigger>
                    <SelectContent>
                      {points.map((p) => (
                        <SelectItem key={p.id} value={p.id}>
                          <span className="flex items-center gap-2">
                            {p.iconKey ? (
                              <AssetOrZoneIcon iconKey={p.iconKey} className="size-5 shrink-0" />
                            ) : (
                              <MapPin className="size-5 shrink-0 text-muted-foreground" />
                            )}
                            {p.name}
                          </span>
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                )}
                {visibleZones.map((zone) => {
                  const content = zoneContentByZoneId.get(zone.id);
                  return (
                    <div key={zone.id} className="flex gap-3 border-t border-border pt-3 first:border-t-0 first:pt-0">
                      <div className="relative size-16 shrink-0 overflow-hidden rounded-control border border-border bg-muted">
                        {content?.photoUrl ? (
                          // eslint-disable-next-line @next/next/no-img-element
                          <img src={content.photoUrl} alt="" className="size-full object-cover" />
                        ) : (
                          <div className="flex size-full items-center justify-center text-muted-foreground">
                            <ImagePlus className="size-5" />
                          </div>
                        )}
                      </div>
                      <div className="flex min-w-0 grow flex-col gap-1.5">
                        <p className="truncate text-sm font-semibold">{zone.name}</p>
                        <InstructionEditor
                          content={content?.caption ?? EMPTY_DOC}
                          onBlur={(json) => saveZoneCaption(zone.id, json)}
                          heightClassName="h-44 min-h-0"
                        />
                        <div className="flex items-center gap-2">
                          <FilePickerButton
                            accept="image/jpeg,image/png,image/webp"
                            onFileSelected={(file) => setZonePhoto(zone.id, file)}
                            hasFile={!!content?.photoUrl}
                          />
                          {content?.photoUrl && (
                            <Button
                              type="button"
                              variant="link"
                              className="h-auto p-0 text-xs text-destructive"
                              onClick={() => removeZonePhoto(zone.id)}
                            >
                              {t.landing.removePhotoButton}
                            </Button>
                          )}
                        </div>
                      </div>
                    </div>
                  );
                })}
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <div className="flex items-center justify-between">
                  <div>
                    <p className="text-body-airbnb font-semibold">{t.landing.ourFleetToggleLabel}</p>
                    <p className="text-caption-airbnb">{t.landing.ourFleetHint}</p>
                  </div>
                  <Switch checked={landing.ourFleetEnabled} onCheckedChange={toggleOurFleet} />
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <p className="text-body-airbnb font-semibold">{t.landing.contactsTitle}</p>
                <div className="grid grid-cols-1 gap-2 sm:grid-cols-2">
                  {CONTACT_FIELDS.map(({ key, labelKey, icon: Icon }) => (
                    <div key={key} className="flex items-center gap-2">
                      <Icon className="size-4 shrink-0 text-muted-foreground" />
                      <Input
                        id={key}
                        aria-label={t.landing[labelKey]}
                        placeholder={t.landing[labelKey]}
                        value={landing[key] ?? ""}
                        onChange={(e) => update(key, e.target.value)}
                      />
                    </div>
                  ))}
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-2">
                <Label>{t.landing.rulesTitle}</Label>
                <Select
                  value={landing.rulesInstructionId ?? "none"}
                  onValueChange={(v) => update("rulesInstructionId", v === "none" ? null : v)}
                  items={[
                    { value: "none", label: t.landing.rulesNoneOption },
                    ...instructions.map((i) => ({ value: i.id, label: i.title })),
                  ]}
                >
                  <SelectTrigger className="w-full">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="none">{t.landing.rulesNoneOption}</SelectItem>
                    {instructions.map((i) => (
                      <SelectItem key={i.id} value={i.id}>
                        {i.title}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                {instructions.length === 0 && <p className="text-caption-airbnb">{t.landing.noPublishedInstructionsHint}</p>}
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <p className="text-body-airbnb font-semibold">{t.landing.seoTitle}</p>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="metaTitle">{t.landing.metaTitleLabel}</Label>
                  <Input
                    id="metaTitle"
                    value={landing.metaTitleOverride ?? ""}
                    onChange={(e) => update("metaTitleOverride", e.target.value)}
                  />
                </div>
                <div className="flex flex-col gap-1">
                  <Label htmlFor="metaDescription">{t.landing.metaDescriptionLabel}</Label>
                  <Input
                    id="metaDescription"
                    value={landing.metaDescriptionOverride ?? ""}
                    onChange={(e) => update("metaDescriptionOverride", e.target.value)}
                  />
                </div>
              </SpringCard>

              {error && <p className="text-sm text-destructive">{error}</p>}
              <PressableScale className="w-fit self-end">
                <Button type="button" variant="dark" disabled={saving} onClick={saveContent}>
                  {savedToast ? t.landing.savedToast : t.landing.saveButton}
                </Button>
              </PressableScale>
            </div>
          )}

          {tab === "design" && (
            <div className="flex flex-col gap-4">
              <SpringCard hover={false} className="flex flex-col gap-3">
                <div>
                  <p className="text-body-airbnb font-semibold">{t.landing.themeSectionTitle}</p>
                  <p className="text-caption-airbnb">{t.landing.themeSectionHint}</p>
                </div>
                <div className="grid grid-cols-3 gap-2 sm:grid-cols-6">
                  {THEME_KEYS.map((key) => {
                    const selected = landing.theme === key;
                    return (
                      <PressableScale key={key}>
                        <button
                          type="button"
                          data-landing-theme={key}
                          onClick={() => selectTheme(key)}
                          className="lt-card relative flex w-full flex-col items-center gap-1.5 p-2.5"
                        >
                          {selected && (
                            <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                              <Check className="size-3" />
                            </span>
                          )}
                          <span className="lt-status text-[9px] leading-none">Aa</span>
                          <span className="lt-h2 text-[11px] leading-tight">{t.landing.themeNames[key]}</span>
                        </button>
                      </PressableScale>
                    );
                  })}
                </div>
              </SpringCard>

              <SpringCard hover={false} className="flex flex-col gap-3">
                <div>
                  <p className="text-body-airbnb font-semibold">{t.landing.effectSectionTitle}</p>
                  <p className="text-caption-airbnb">{t.landing.effectSectionHint}</p>
                </div>
                <div className="grid grid-cols-4 gap-2 sm:grid-cols-7">
                  {EFFECT_KEYS.map((key) => {
                    const selected = landing.effect === key;
                    return (
                      <PressableScale key={key}>
                        <button
                          type="button"
                          onClick={() => selectEffect(key)}
                          className={cn(
                            "relative flex w-full flex-col items-center gap-1 rounded-control border p-2 text-center",
                            selected ? "border-primary bg-primary/10" : "border-border bg-card"
                          )}
                        >
                          {selected && (
                            <span className="absolute -right-1.5 -top-1.5 flex size-5 items-center justify-center rounded-full bg-primary text-primary-foreground ring-2 ring-background">
                              <Check className="size-3" />
                            </span>
                          )}
                          <span className="flex h-10 w-16 items-center justify-center overflow-hidden rounded-lg bg-muted">
                            <EffectPreview mode={key} />
                          </span>
                          <span className="text-[11px] leading-tight text-muted-foreground">{t.landing.effectNames[key]}</span>
                        </button>
                      </PressableScale>
                    );
                  })}
                </div>
              </SpringCard>
            </div>
          )}

          {tab === "stats" && <LandingStats />}
        </div>
      </div>

      {publicUrl && (
        <InstructionQrSheet open={qrOpen} onClose={() => setQrOpen(false)} title={landing.tenantName} url={publicUrl} />
      )}
    </OwnerShell>
  );
}

interface StatsData {
  summary: { visits: number; uniqueVisitors: number };
  series: { date: string; visits: number; uniqueVisitors: number }[];
  topSources: { source: string; count: number }[];
}

// "13 июля (Пн)" — row.date приходит как "YYYY-MM-DD" (без времени); парсим
// как локальную дату (не new Date(str), которая читает YYYY-MM-DD как UTC
// полночь и на отрицательных смещениях сдвигает день на минус один).
function formatStatsDayLabel(isoDate: string): string {
  const [year, month, day] = isoDate.split("-").map(Number);
  const date = new Date(year, month - 1, day);
  const dayMonth = date.toLocaleDateString(undefined, { day: "numeric", month: "long" });
  const weekday = date.toLocaleDateString(undefined, { weekday: "short" });
  return `${dayMonth} (${weekday.charAt(0).toUpperCase()}${weekday.slice(1)})`;
}

function LandingStats() {
  const t = useI18n();
  const [range, setRange] = useState<"today" | "7d" | "30d">("7d");
  const [data, setData] = useState<StatsData | null>(null);

  const loadStats = useCallback(async () => {
    const res = await fetch(`/api/tenant/landing/stats?range=${range}`);
    if (res.ok) setData(await res.json());
  }, [range]);

  /* eslint-disable react-hooks/set-state-in-effect */
  useEffect(() => {
    loadStats();
  }, [loadStats]);
  /* eslint-enable react-hooks/set-state-in-effect */

  const sourceLabel: Record<string, string> = {
    direct: t.landing.statsSourceDirect,
    search: t.landing.statsSourceSearch,
    social: t.landing.statsSourceSocial,
  };

  return (
    <div className="flex flex-col gap-4">
      <div className="flex gap-1.5">
        {(
          [
            ["today", t.landing.statsRangeToday],
            ["7d", t.landing.statsRange7d],
            ["30d", t.landing.statsRange30d],
          ] as const
        ).map(([key, label]) => (
          <button
            key={key}
            type="button"
            onClick={() => setRange(key)}
            className={cn(
              "flex-1 rounded-full border px-3 py-1.5 text-center text-sm font-semibold",
              range === key ? "border-primary bg-primary/10 text-primary" : "border-border bg-card text-muted-foreground"
            )}
          >
            {label}
          </button>
        ))}
      </div>

      {!data || (data.summary.visits === 0 && data.series.length === 0) ? (
        <SpringCard hover={false}>
          <p className="text-body-airbnb text-muted-foreground">{t.landing.statsNoData}</p>
        </SpringCard>
      ) : (
        <>
          <div className="grid grid-cols-2 gap-3">
            <SpringCard hover={false}>
              <p className="text-caption-airbnb">{t.landing.statsVisits}</p>
              <p className="text-2xl font-extrabold tabular-nums">{data.summary.visits}</p>
            </SpringCard>
            <SpringCard hover={false}>
              <p className="text-caption-airbnb">{t.landing.statsUniqueVisitors}</p>
              <p className="text-2xl font-extrabold tabular-nums">{data.summary.uniqueVisitors}</p>
            </SpringCard>
          </div>

          {data.series.length > 0 && (
            <SpringCard hover={false} className="flex flex-col gap-2">
              <p className="text-body-airbnb font-semibold">{t.landing.statsByDayTitle}</p>
              {data.series.map((row) => (
                <div key={row.date} className="flex items-center justify-between text-sm tabular-nums">
                  <span className="text-muted-foreground">{formatStatsDayLabel(row.date)}</span>
                  <span>
                    {row.visits} / {row.uniqueVisitors}
                  </span>
                </div>
              ))}
            </SpringCard>
          )}

          {data.topSources.length > 0 && (
            <SpringCard hover={false} className="flex flex-col gap-2">
              <p className="text-body-airbnb font-semibold">{t.landing.statsTopSources}</p>
              {data.topSources.map((s) => (
                <div key={s.source} className="flex items-center justify-between text-sm tabular-nums">
                  <span>{sourceLabel[s.source] ?? s.source}</span>
                  <span>{s.count}</span>
                </div>
              ))}
            </SpringCard>
          )}
        </>
      )}
    </div>
  );
}
