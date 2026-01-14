export type Card = "ATTACK" | "DEFENSE" | "HEAL" | "COUNTER";

export type MatchFoundPayload = {
  matchId?: string;
  yourHp: number;
  oppHp: number;
  yourTokens: number;
  pot: number;
  yourNickname?: string | null;
  oppNickname?: string | null;
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
  yourNickname?: string | null;
  oppNickname?: string | null;
};

export type StepRevealPayload = {
  matchId: string;
  roundIndex: number;
  stepIndex: number;
  yourCard: Card;
  oppCard: Card;
  yourHp: number;
  oppHp: number;
  yourNickname?: string | null;
  oppNickname?: string | null;
};

export type RoundEndPayload = {
  matchId: string;
  roundIndex: number;
  suddenDeath: boolean;
  yourHp: number;
  oppHp: number;
  yourNickname?: string | null;
  oppNickname?: string | null;
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
  yourNickname?: string | null;
  oppNickname?: string | null;
};

export type HelloOkPayload = {
  tokens: number;
  nickname?: string | null;
};
