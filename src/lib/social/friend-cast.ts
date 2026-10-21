import { createAdminClient } from "@/lib/supabase/admin";
import { createClient } from "@/lib/supabase/server";
import { loadPrimaryAuthors } from "@/lib/social/primary-author";

export type FriendCastCharacter = {
  id: string;
  name: string;
  isPrimary?: boolean;
  avatarUrl?: string | null;
  parentId: string;
  traits?: unknown;
  description?: string | null;
  kind?: string | null;
  gender?: string | null;
  source: "own" | "friend";
};

export type AcceptedFriendCast = {
  userId: string;
  label: string;
  authorAvatarUrl: string | null;
  email?: string | null;
  characters: FriendCastCharacter[];
};

async function dbClient() {
  return createAdminClient() ?? (await createClient());
}

export async function listAcceptedFriendIds(userId: string): Promise<string[]> {
  const db = await dbClient();
  if (!db) return [];

  const { data } = await db
    .from("friendships")
    .select("requester_id, addressee_id, status")
    .eq("status", "accepted")
    .or(`requester_id.eq.${userId},addressee_id.eq.${userId}`);

  const ids = new Set<string>();
  for (const f of data ?? []) {
    const other =
      f.requester_id === userId ? f.addressee_id : f.requester_id;
    if (other) ids.add(other);
  }
  return [...ids];
}

export async function assertAcceptedFriendship(
  userId: string,
  friendParentId: string,
): Promise<boolean> {
  if (!friendParentId || friendParentId === userId) return false;
  const ids = await listAcceptedFriendIds(userId);
  return ids.includes(friendParentId);
}

async function loadCharactersForParents(
  parentIds: string[],
  sourceByParent: Map<string, "own" | "friend">,
): Promise<FriendCastCharacter[]> {
  const db = await dbClient();
  if (!db || parentIds.length === 0) return [];

  const { data: chars } = await db
    .from("characters")
    .select(
      "id, parent_id, name, avatar_url, is_primary, traits, description, kind, gender",
    )
    .in("parent_id", parentIds)
    .order("created_at", { ascending: true });

  const { data: children } = await db
    .from("children")
    .select("parent_id, avatar_url, preferences")
    .in("parent_id", parentIds);

  const pixarByParent = new Map<string, { hero?: string }>();
  for (const child of children ?? []) {
    const prefs = (child.preferences ?? {}) as {
      pixar?: { child_hero?: string };
    };
    pixarByParent.set(child.parent_id, {
      hero: prefs.pixar?.child_hero || child.avatar_url || undefined,
    });
  }

  return (chars ?? []).map((c) => {
    const source = sourceByParent.get(c.parent_id) ?? "own";
    const pixar = pixarByParent.get(c.parent_id);
    return {
      id: c.id,
      name: c.name,
      isPrimary: Boolean(c.is_primary),
      avatarUrl: c.avatar_url || (c.is_primary ? pixar?.hero : null) || null,
      parentId: c.parent_id,
      traits: c.traits,
      description: c.description,
      kind: c.kind,
      gender: c.gender,
      source,
    };
  });
}

/** Amigos aceitos + personagens de cada um (para o wizard). */
export async function listAcceptedFriendsWithCharacters(
  userId: string,
): Promise<AcceptedFriendCast[]> {
  const friendIds = await listAcceptedFriendIds(userId);
  if (friendIds.length === 0) return [];

  const db = await dbClient();
  if (!db) return [];

  const authors = await loadPrimaryAuthors(db, friendIds);
  const { data: userRows } = await db
    .from("users")
    .select("id, email, full_name, display_name")
    .in("id", friendIds);
  const emailById = new Map(
    (userRows ?? []).map((u) => [u.id, u.email as string | null]),
  );
  const nameById = new Map(
    (userRows ?? []).map((u) => [
      u.id,
      (u.full_name || u.display_name || null) as string | null,
    ]),
  );
  const sourceByParent = new Map(
    friendIds.map((id) => [id, "friend" as const]),
  );
  const chars = await loadCharactersForParents(friendIds, sourceByParent);
  const byParent = new Map<string, FriendCastCharacter[]>();
  for (const c of chars) {
    const list = byParent.get(c.parentId) ?? [];
    list.push(c);
    byParent.set(c.parentId, list);
  }

  return friendIds.map((id) => {
    const author = authors.get(id) ?? { name: "Amigo", avatarUrl: null };
    const parentName = nameById.get(id);
    return {
      userId: id,
      label: parentName || author.name,
      authorAvatarUrl: author.avatarUrl,
      email: emailById.get(id) ?? null,
      characters: byParent.get(id) ?? [],
    };
  });
}

/** Personagens do usuário + de um amigo aceito. */
export async function loadCombinedCastCharacters(input: {
  userId: string;
  friendParentId: string;
}): Promise<{ error?: string; characters?: FriendCastCharacter[] }> {
  const ok = await assertAcceptedFriendship(
    input.userId,
    input.friendParentId,
  );
  if (!ok) return { error: "Amizade não encontrada ou não aceita." };

  const sourceByParent = new Map<string, "own" | "friend">([
    [input.userId, "own"],
    [input.friendParentId, "friend"],
  ]);
  const characters = await loadCharactersForParents(
    [input.userId, input.friendParentId],
    sourceByParent,
  );
  return { characters };
}

export async function loadCharactersByIdsForStory(input: {
  userId: string;
  characterIds: string[];
  friendParentId?: string | null;
}): Promise<FriendCastCharacter[]> {
  const ids = [...new Set(input.characterIds.filter(Boolean))];
  if (ids.length === 0) return [];

  const db = await dbClient();
  if (!db) return [];

  const allowedParents = new Set<string>([input.userId]);
  if (input.friendParentId) {
    const ok = await assertAcceptedFriendship(
      input.userId,
      input.friendParentId,
    );
    if (ok) allowedParents.add(input.friendParentId);
  }

  const { data: chars } = await db
    .from("characters")
    .select(
      "id, parent_id, name, avatar_url, is_primary, traits, description, kind, gender",
    )
    .in("id", ids);

  const filtered = (chars ?? []).filter((c) =>
    allowedParents.has(c.parent_id),
  );
  const parentIds = [...new Set(filtered.map((c) => c.parent_id))];

  const { data: children } = await db
    .from("children")
    .select("parent_id, avatar_url, preferences")
    .in("parent_id", parentIds);

  const pixarByParent = new Map<string, string | null>();
  for (const child of children ?? []) {
    const prefs = (child.preferences ?? {}) as {
      pixar?: { child_hero?: string; friend_hero?: string };
    };
    pixarByParent.set(
      child.parent_id,
      prefs.pixar?.child_hero || child.avatar_url || null,
    );
  }

  const order = new Map(ids.map((id, i) => [id, i]));
  return filtered
    .map((c) => ({
      id: c.id,
      name: c.name,
      isPrimary: Boolean(c.is_primary),
      avatarUrl:
        c.avatar_url ||
        (c.is_primary ? pixarByParent.get(c.parent_id) : null) ||
        null,
      parentId: c.parent_id,
      traits: c.traits,
      description: c.description,
      kind: c.kind,
      gender: c.gender,
      source:
        c.parent_id === input.userId
          ? ("own" as const)
          : ("friend" as const),
    }))
    .sort((a, b) => (order.get(a.id) ?? 0) - (order.get(b.id) ?? 0));
}
