import { Suspense } from "react";
import { connection } from "next/server";
import Link from "next/link";
import { ArrowLeft } from "lucide-react";
import { AppPageFallback } from "@/components/app/app-page-fallback";
import { AppShell } from "@/components/app/app-shell";
import {
  ProfilePanel,
  type ProfileSnapshot,
} from "@/components/parent/profile-panel";
import type { BillingSnapshot } from "@/components/parent/subscription-panel";
import { Button } from "@/components/ui/button";
import { getCurrentUser } from "@/lib/auth/get-user";
import { countAcceptedFriends } from "@/lib/social/friend-actions";
import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import {
  describeStripeKeyIssue,
  isStripeCheckoutReady,
  stripeMissingKeys,
} from "@/lib/stripe/config";
import { loadSubscriptionPlans } from "@/lib/billing/plans-catalog-load";

async function ParentSettingsPageInner() {
  await connection();
  const user = await getCurrentUser();
  if (!user) return null;
  const catalogPlans = await loadSubscriptionPlans();

  const db = createAdminClient() ?? (await createClient());
  let profile: ProfileSnapshot = {
    email: user.email,
    fullName: user.fullName || "",
    phone: "",
    cpf: "",
    storiesCount: 0,
    charactersCount: 0,
    friendsCount: 0,
  };
  let billing: BillingSnapshot = {
    subscriptionStatus: "none",
    planId: null,
    stripeCustomerId: null,
    extraCharacters: 0,
    stripeReady: isStripeCheckoutReady(),
    missingKeys: stripeMissingKeys(),
    keyIssue: describeStripeKeyIssue(),
  };

  if (db) {
    const { data: row } = await db
      .from("users")
      .select(
        "full_name, display_name, phone, cpf, email, subscription_status, subscription_plan_id, stripe_customer_id, extra_characters_available",
      )
      .eq("id", user.id)
      .maybeSingle();

    if (row) {
      profile = {
        email: row.email || user.email,
        fullName: row.full_name || row.display_name || user.fullName || "",
        phone: row.phone || "",
        cpf: row.cpf || "",
        storiesCount: 0,
        charactersCount: 0,
        friendsCount: 0,
      };
      billing = {
        ...billing,
        subscriptionStatus: row.subscription_status,
        planId: row.subscription_plan_id,
        stripeCustomerId: row.stripe_customer_id,
        extraCharacters:
          typeof row.extra_characters_available === "number"
            ? row.extra_characters_available
            : 0,
      };
    }

    const [{ count: storiesCount }, { count: charactersCount }] =
      await Promise.all([
        db
          .from("stories")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", user.id),
        db
          .from("characters")
          .select("id", { count: "exact", head: true })
          .eq("parent_id", user.id),
      ]);
    profile.storiesCount = storiesCount ?? 0;
    profile.charactersCount = charactersCount ?? 0;
    profile.friendsCount = await countAcceptedFriends(user.id);
  }

  return (
    <AppShell user={user} title="Perfil">
      <div className="space-y-6">
        <Button asChild variant="ghost" size="sm">
          <Link href="/app/parent" className="gap-1.5">
            <ArrowLeft className="size-3.5" />
            Voltar
          </Link>
        </Button>
        <ProfilePanel
          profile={profile}
          billing={billing}
          plans={catalogPlans}
        />
      </div>
    </AppShell>
  );
}

export default function ParentSettingsPage() {
  return (
    <Suspense fallback={<AppPageFallback label="Carregando perfil…" />}>
      <ParentSettingsPageInner />
    </Suspense>
  );
}
