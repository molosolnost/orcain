export type Card = "ATTACK" | "DEFENSE" | "HEAL" | "COUNTER";

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
};

export type HelloOkPayload = {
  tokens: number;
};
