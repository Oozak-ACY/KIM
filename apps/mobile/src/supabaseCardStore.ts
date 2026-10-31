import type { Card, CardStore } from "@kim/core";
import { supabase } from "./supabase";

type CardRow = {
  id: string;
  cue: string;
  essence: string;
  created_at: string;
};

function toCard(row: CardRow): Card {
  return {
    id: row.id,
    cue: row.cue,
    essence: row.essence,
    createdAt: new Date(row.created_at),
  };
}

export const supabaseCardStore: CardStore = {
  async add(card) {
    const { data, error } = await supabase
      .from("cards")
      .insert({
        cue: card.cue,
        essence: card.essence,
        created_at: card.createdAt.toISOString(),
      })
      .select("id, cue, essence, created_at")
      .single();
    if (error) throw error;
    return toCard(data);
  },

  async list() {
    const { data, error } = await supabase
      .from("cards")
      .select("id, cue, essence, created_at")
      .order("created_at", { ascending: false });
    if (error) throw error;
    return data.map(toCard);
  },
};
