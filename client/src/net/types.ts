export type Card = "ATTACK" | "DEFENSE" | "HEAL" | "COUNTER" | "GRASS";

export type MatchFoundPayload = {
  matchId?: string;
  yourHp: number;
  oppHp: number;
  yourTokens: number;
  pot: number;
};

export type PrepStartPayload = {
  matchId: string;
  roundIndex: number;
  suddenDeath: boolean;
  deadlineTs: number;
  yourHp: number;
  oppHp: number;
  pot: number;
  yourTokens: number;
  cards: Card[];
};

export type StepRevealPayload = {
  matchId: string;
  roundIndex: number;
  stepIndex: number;
  yourCard: Card;
  oppCard: Card;
  yourHp: number;
  oppHp: number;
};

export type RoundEndPayload = {
  matchId: string;
  roundIndex: number;
  suddenDeath: boolean;
  yourHp: number;
  oppHp: number;
};

export type MatchEndPayload = {
  matchId?: string;
  winner: "YOU" | "OPPONENT";
  winnerId?: string;
  loserId?: string;
  yourHp: number;
  oppHp: number;
  yourTokens: number;
  reason: "normal" | "disconnect" | "timeout";
  message?: string;
};

export type HelloOkPayload = {
  tokens: number;
};

export type DraftLayoutPayload = {
  matchId: string;
  layout: (Card | null)[];
};
