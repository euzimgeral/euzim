"use client";

import { useCallback, useEffect, useRef, useState } from "react";
import Link from "next/link";
import { Eye, Heart, Share2, Sparkles } from "lucide-react";
import { Tabs, TabsContent, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Button } from "@/components/ui/button";
import { StoryUsageTracker } from "@/components/parent/story-usage-tracker";
import { CharactersPanel, type CharacterManageRow } from "@/components/parent/characters-panel";
import { NewStoryForm } from "@/components/parent/new-story-form";
import type { BillingSnapshot } from "@/components/parent/subscription-panel";
import {
  StoryJobNotifier,
  trackStoryJob,
} from "@/components/parent/story-job-notifier";
import { WallpaperDialog } from "@/components/parent/wallpaper-dialog";
import { ShareAppButton } from "@/components/referral/share-app-button";
import { ShareProfileButton } from "@/components/social/share-profile-button";
import { PendingRequestsBanner } from "@/components/social/pending-requests-banner";
import { PendingVisibilityBanner } from "@/components/social/pending-visibility-banner";
import { VisibilityToggle } from "@/components/social/visibility-toggle";
import type { StoryUsage } from "@/lib/stories/usage";
import type { ChildFamilyMeta } from "@/lib/characters/types";
import type { StoryVisibility } from "@/lib/social/types";
import type { PendingFriendship } from "@/lib/social/types";
import type { PendingVisibilityRequest } from "@/lib/social/visibility-collab";

type StoryListItem = {
  id: string;
  title: string;
  coverImageUrl?: string | null;
  wallpaperImageUrl?: string | null;
  createdAt?: string;
  visibility?: StoryVisibility;
  viewCount?: number;
  likeCount?: number;
  hasCollaborators?: boolean;
};

function ParentShareMenu() {
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement | null>(null);

  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDoc);
    return () => document.removeEventListener("mousedown", onDoc);
  }, [open]);

  return (
    <div className="relative" ref={rootRef}>
      <Button
        type="button"
        size="lg"
        variant="outline"
        className="size-11 shrink-0 p-0"
        aria-label="Compartilhar"
        aria-expanded={open}
        onClick={() => setOpen((v) => !v)}
      >
        <Share2 className="size-4" />
      </Button>
      {open ? (
        <div className="absolute right-0 z-20 mt-2 w-56 space-y-2 rounded-xl border border-border/70 bg-background p-3 shadow-lg sm:left-0 sm:right-auto">
          <ShareProfileButton />
          <ShareAppButton compact />
        </div>
      ) : null}
    </div>
  );
}

export function ParentDashboard({
  usage,
  characters,
  childName,
  childAvatarUrl,
  childAgeYears,
  childMeta,
  stories,
  billing,
  friendRequests = [],
  visibilityRequests = [],
}: {
  usage: StoryUsage;
  characters: CharacterManageRow[];
  childName?: string | null;
  childAvatarUrl?: string | null;
  childAgeYears?: number | null;
  childMeta?: ChildFamilyMeta | null;
  stories: StoryListItem[];
  billing: BillingSnapshot;
  friendRequests?: PendingFriendship[];
  visibilityRequests?: PendingVisibilityRequest[];
}) {
  const remaining = Math.max(0, usage.limit - usage.used);
  const primary =
    characters.find((c) => c.isPrimary) ?? characters[0] ?? null;
  const friend = characters.find((c) => !c.isPrimary) ?? null;
  const heroUrl = childAvatarUrl || primary?.avatarUrl || null;
  const heroName = childName || primary?.name || "sua criança";
  const isFirstStory = stories.length === 0;
  const [tab, setTab] = useState("create");

  const onJobQueued = useCallback((jobId: string) => {
    trackStoryJob(jobId);
  }, []);

  return (
    <div className="space-y-6">
      <StoryJobNotifier />

      <PendingRequestsBanner requests={friendRequests} kidsMode={false} />
      <PendingVisibilityBanner requests={visibilityRequests} />

      <section className="relative overflow-hidden rounded-3xl border border-border/60 bg-[radial-gradient(ellipse_at_top_left,_oklch(0.95_0.04_85),_transparent_55%),radial-gradient(ellipse_at_bottom_right,_oklch(0.94_0.03_210),_transparent_50%)] p-5 sm:p-7">
        <div className="flex flex-col items-center gap-5 sm:flex-row sm:items-center">
          <div className="relative shrink-0">
            <div className="size-36 overflow-hidden rounded-3xl border-4 border-background shadow-md sm:size-44">
              {heroUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img
                  src={heroUrl}
                  alt={heroName}
                  className="h-full w-full object-cover"
                />
              ) : (
                <div className="flex h-full w-full items-center justify-center bg-muted text-muted-foreground">
                  <Sparkles className="size-8" />
                </div>
              )}
            </div>
          </div>
          <div className="flex flex-1 flex-col justify-center space-y-2 text-center sm:text-left">
            <h1 className="font-heading text-3xl font-semibold tracking-tight sm:text-4xl">
              {heroName}
            </h1>
            <p className="max-w-md text-sm text-muted-foreground sm:text-base">
              Tudo pronto para criar histórias
            </p>
            <div className="flex flex-wrap items-center justify-center gap-2 pt-1 sm:justify-start">
              <Button asChild size="lg">
                <a href="#criar-historia">
                  {isFirstStory ? "Criar primeira história" : "Criar história"}
                </a>
              </Button>
              <ParentShareMenu />
            </div>
          </div>
        </div>
      </section>

      <StoryUsageTracker usage={usage} />

      <Tabs value={tab} onValueChange={setTab} className="gap-4">
        <TabsList>
          <TabsTrigger value="create">Nova História</TabsTrigger>
          <TabsTrigger value="library">Biblioteca</TabsTrigger>
          <TabsTrigger value="characters">Personagens</TabsTrigger>
        </TabsList>

        <TabsContent value="create" className="space-y-4" id="criar-historia">
          <NewStoryForm
            childName={childName}
            friendName={friend?.name ?? null}
            remaining={remaining}
            characters={characters}
            childAgeYears={childAgeYears ?? null}
            onJobQueued={onJobQueued}
          />
        </TabsContent>

        <TabsContent value="library" className="space-y-4">
          {stories.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Ainda não há histórias. Crie a primeira na aba Nova História.
            </p>
          ) : (
            <ul className="grid gap-3">
              {stories.map((story) => {
                const wallpaperUrl =
                  story.wallpaperImageUrl || story.coverImageUrl || "";
                const dateLabel = story.createdAt
                  ? new Date(story.createdAt).toLocaleString("pt-BR", {
                      dateStyle: "short",
                      timeStyle: "short",
                    })
                  : null;
                return (
                  <li
                    key={story.id}
                    className="rounded-xl border border-border/70 p-3 transition hover:border-foreground/40"
                  >
                    <div className="flex gap-3">
                      {story.coverImageUrl ? (
                        // eslint-disable-next-line @next/next/no-img-element
                        <img
                          src={story.coverImageUrl}
                          alt=""
                          className="size-20 shrink-0 rounded-md object-cover sm:size-24"
                        />
                      ) : (
                        <div className="size-20 shrink-0 rounded-md bg-muted sm:size-24" />
                      )}
                      <div className="flex min-w-0 flex-1 flex-col justify-between gap-2">
                        <div className="min-w-0 space-y-1">
                          <p className="truncate font-medium">{story.title}</p>
                          {dateLabel ? (
                            <p className="text-xs text-muted-foreground">
                              {dateLabel}
                            </p>
                          ) : null}
                          <p className="flex flex-wrap items-center gap-3 text-xs text-muted-foreground">
                            <span className="inline-flex items-center gap-1">
                              <Eye className="size-3.5" />
                              {story.viewCount ?? 0}
                            </span>
                            <span className="inline-flex items-center gap-1">
                              <Heart className="size-3.5" />
                              {story.likeCount ?? 0}
                            </span>
                          </p>
                        </div>
                        <div className="flex flex-wrap items-center gap-2">
                          <Button asChild size="sm" variant="outline">
                            <Link href={`/app/parent/stories/${story.id}`}>
                              Ler
                            </Link>
                          </Button>
                          {wallpaperUrl ? (
                            <WallpaperDialog
                              imageUrl={wallpaperUrl}
                              title={story.title}
                              triggerLabel="Wallpaper"
                              size="sm"
                              variant="secondary"
                            />
                          ) : (
                            <Button size="sm" variant="secondary" disabled>
                              Wallpaper
                            </Button>
                          )}
                          <VisibilityToggle
                            storyId={story.id}
                            initial={story.visibility ?? "private"}
                            iconOnly
                            hasCollaborators={Boolean(story.hasCollaborators)}
                          />
                        </div>
                      </div>
                    </div>
                  </li>
                );
              })}
            </ul>
          )}
        </TabsContent>

        <TabsContent value="characters">
          <CharactersPanel
            characters={characters}
            billing={billing}
            childMeta={childMeta ?? null}
          />
        </TabsContent>
      </Tabs>
    </div>
  );
}
