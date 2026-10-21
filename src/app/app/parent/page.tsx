import { Suspense } from "react";
import { connection } from "next/server";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import { ParentDashboard } from "@/components/parent/parent-dashboard";
import { AvatarRefreshBanner } from "@/components/parent/avatar-refresh-banner";
import { PendingGiftsBanner } from "@/components/referral/pending-gifts-banner";
import type { BillingSnapshot } from "@/components/parent/subscription-panel";
import type { CharacterManageRow, ChildFamilyMeta } from "@/lib/characters/types";
import { getCurrentUser } from "@/lib/auth/get-user";
import { readMockOnboarding } from "@/lib/auth/mock-session";
import { MONTHLY_STORY_LIMIT } from "@/lib/billing/character-packs";
import { getAvatarRefreshStatus } from "@/lib/onboarding/avatar-refresh";
import { listPendingFriendRequests } from "@/lib/social/friend-actions";
import { listPendingVisibilityApprovalsForUser } from "@/lib/social/visibility-collab";
import { getStoryUsage } from "@/lib/stories/usage";
import { listStoriesForParent } from "@/lib/stories/load-story";
import { countMockStoriesThisMonth } from "@/lib/stories/mock-store";
import { isSupabaseConfigured } from "@/lib/supabase/config";
import { createClient } from "@/lib/supabase/server";
import { createAdminClient } from "@/lib/supabase/admin";
import {
  describeStripeKeyIssue,
  isStripeCheckoutReady,
  stripeMissingKeys,
} from "@/lib/stripe/config";

async function ParentPageInner() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;

  let usage = await getStoryUsage();
  if (usage.source !== "supabase") {
    const mockCount = await countMockStoriesThisMonth(user.id);
    usage = {
      used: Math.max(usage.used, mockCount),
      limit: MONTHLY_STORY_LIMIT,
      source: usage.source,
    };
  }

  let characters: CharacterManageRow[] = [];
  let childName: string | null = null;
  let childAvatarUrl: string | null = null;
  let childAgeYears: number | null = null;
  let childMeta: ChildFamilyMeta | null = null;
  let billing: BillingSnapshot = {
    subscriptionStatus: "none",
    planId: null,
    stripeCustomerId: null,
    extraCharacters: 0,
    stripeReady: isStripeCheckoutReady(),
    missingKeys: stripeMissingKeys(),
    keyIssue: describeStripeKeyIssue(),
  };

  if (!isSupabaseConfigured() || user.isMock) {
    const onboarding = await readMockOnboarding();
    childName = onboarding?.child?.displayName ?? null;
    childAgeYears = onboarding?.child?.ageYears ?? null;
    if (childName) {
      characters = [{ id: "mock-primary", name: childName, isPrimary: true }];
      if (onboarding?.friend?.displayName) {
        characters.push({
          id: "mock-friend",
          name: onboarding.friend.displayName,
          isPrimary: false,
          kind: onboarding.friend.kind,
        });
      }
    }
  } else {
    const db = createAdminClient() ?? (await createClient());
    if (db) {
      const { data: children } = await db
        .from("children")
        .select(
          "id, display_name, avatar_url, birth_date, gender, preferences, has_father, father_name, father_birth_date, has_mother, mother_name, mother_birth_date",
        )
        .eq("parent_id", user.id)
        .order("created_at", { ascending: true })
        .limit(1);

      const child = children?.[0];
      childName = child?.display_name ?? null;
      childAvatarUrl = child?.avatar_url ?? null;
      if (child) {
        childMeta = {
          id: child.id,
          displayName: child.display_name,
          birthDate: child.birth_date,
          gender: child.gender,
          hasFather: Boolean(child.has_father),
          fatherName: child.father_name,
          fatherBirthDate: child.father_birth_date,
          hasMother: Boolean(child.has_mother),
          motherName: child.mother_name,
          motherBirthDate: child.mother_birth_date,
        };
      }

      const pixar = (
        child?.preferences && typeof child.preferences === "object"
          ? (child.preferences as Record<string, unknown>).pixar
          : null
      ) as
        | {
            child_hero?: string;
            child_face_sheet?: string;
            child_body_sheet?: string;
            friend_hero?: string;
            friend_sheet?: string;
          }
        | null
        | undefined;

      const { data: chars } = await db
        .from("characters")
        .select(
          "id, name, is_primary, avatar_url, relationship, relationship_other, gender, birth_date, kind, description",
        )
        .eq("parent_id", user.id)
        .order("created_at", { ascending: true });

      if (chars) {
        const firstFriendId = chars.find((c) => !c.is_primary)?.id ?? null;
        characters = chars.map((c) => {
          const isPrimary = Boolean(c.is_primary);
          const studySheets: { label: string; url: string }[] = [];
          if (isPrimary) {
            if (pixar?.child_face_sheet) {
              studySheets.push({
                label: "Rosto — turnaround",
                url: pixar.child_face_sheet,
              });
            }
            if (pixar?.child_body_sheet) {
              studySheets.push({
                label: "Corpo — turnaround",
                url: pixar.child_body_sheet,
              });
            }
          } else if (c.id === firstFriendId && pixar?.friend_sheet) {
            studySheets.push({
              label: "Personagem — turnaround",
              url: pixar.friend_sheet,
            });
          }
          return {
            id: c.id,
            name: c.name,
            isPrimary,
            avatarUrl:
              c.avatar_url ||
              (isPrimary
                ? pixar?.child_hero
                : c.id === firstFriendId
                  ? pixar?.friend_hero
                  : null) ||
              null,
            relationship: c.relationship,
            relationshipOther: c.relationship_other,
            gender: c.gender,
            birthDate: c.birth_date,
            kind: c.kind,
            description: c.description,
            studySheets,
          };
        });
      }
      const prefs = (child?.preferences ?? {}) as {
        age_years?: number;
      };
      if (typeof prefs.age_years === "number") {
        childAgeYears = prefs.age_years;
      } else if (child?.birth_date) {
        // Após await connection() — seguro com cacheComponents
        const parts = child.birth_date.split("-").map(Number);
        const y = parts[0];
        const mo = parts[1];
        const day = parts[2];
        if (y && mo && day) {
          const now = new Date();
          let age = now.getFullYear() - y;
          const m = now.getMonth() + 1 - mo;
          if (m < 0 || (m === 0 && now.getDate() < day)) age -= 1;
          if (age >= 0 && age < 18) childAgeYears = age;
        }
      }

      const { data: profile } = await db
        .from("users")
        .select(
          "subscription_status, subscription_plan_id, stripe_customer_id, extra_characters_available",
        )
        .eq("id", user.id)
        .maybeSingle();

      if (profile) {
        billing = {
          ...billing,
          subscriptionStatus: profile.subscription_status,
          planId: profile.subscription_plan_id,
          stripeCustomerId: profile.stripe_customer_id,
          extraCharacters:
            typeof profile.extra_characters_available === "number"
              ? profile.extra_characters_available
              : 0,
        };
      }
    }

    if (!childName) {
      childName = (await readMockOnboarding())?.child?.displayName ?? null;
      if (childName && characters.length === 0) {
        characters = [{ id: "mock-primary", name: childName, isPrimary: true }];
      }
    }
  }

  const stories = await listStoriesForParent(user.id);
  const refreshStatus = await getAvatarRefreshStatus(user.id);
  const [friendRequests, visibilityRequests] = await Promise.all([
    listPendingFriendRequests(user.id),
    listPendingVisibilityApprovalsForUser(user.id),
  ]);

  return (
    <AppShell user={user} title="Criação">
      <div className="space-y-4">
        <AvatarRefreshBanner status={refreshStatus} />
        <PendingGiftsBanner compact />
        <ParentDashboard
          usage={usage}
          characters={characters}
          childName={childName}
          childAvatarUrl={childAvatarUrl}
          childAgeYears={childAgeYears}
          childMeta={childMeta}
          stories={stories}
          billing={billing}
          friendRequests={friendRequests}
          visibilityRequests={visibilityRequests}
        />
      </div>
    </AppShell>
  );
}

export default function ParentPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando Criação…" />}>
      <ParentPageInner />
    </Suspense>
  );
}
