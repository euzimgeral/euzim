import { Suspense } from "react";
import { connection } from "next/server";
import { notFound } from "next/navigation";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { StoryFlipbook } from "@/components/kids/story-flipbook";
import { getCurrentUser } from "@/lib/auth/get-user";
import { loadStoryForParent } from "@/lib/stories/load-story";
import { getQuizProgress } from "@/lib/stories/games-store";
import { loadPageFeedbackVotes } from "@/lib/stories/page-feedback";
import { recordStoryViewAction } from "@/lib/stories/view-actions";

async function StoryReaderPageInner({ id }: { id: string }) {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;

  const story = await loadStoryForParent(id, user.id);
  if (!story) notFound();

  await recordStoryViewAction(story.id);
  const progress = await getQuizProgress(story.id, user.id);
  const pageFeedback = await loadPageFeedbackVotes(story.id, user.id);

  return (
    <StoryFlipbook
      storyId={story.id}
      title={story.title}
      pages={story.pages}
      questions={story.questions}
      initialQuizScore={progress?.score ?? null}
      shareToken={story.shareToken ?? story.id}
      readingMode
      backHref="/app/parent"
      backLabel="Voltar para a biblioteca"
      showShare={false}
      enablePageFeedback
      initialPageFeedback={pageFeedback}
    />
  );
}

export default function StoryReaderPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando história…" />}>
      <StoryReaderPageBridge params={params} />
    </Suspense>
  );
}

async function StoryReaderPageBridge({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StoryReaderPageInner id={id} />;
}
