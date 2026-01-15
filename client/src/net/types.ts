// Legacy Card type (for backward compatibility in UI)
export type Card = "ATTACK" | "DEFENSE" | "HEAL" | "COUNTER";

// CardId type (new stable card system)
export type CardId = "attack" | "defense" | "heal" | "counter";

export type MatchFoundPayload = {
  matchId?: string;
  yourHp: number;
  oppHp: number;
  yourTokens: number;
  pot: number;
  yourNickname?: string | null;
  oppNickname?: string | null;
  yourHand: CardId[]; // CardId[4] - source of truth from server
  matchMode?: 'PVP' | 'PVE' | 'TUTORIAL'; // Match mode: PVP | PVE | TUTORIAL
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
  yourHand: CardId[]; // CardId[4] - source of truth (replaces legacy 'cards')
  yourNickname?: string | null;
  oppNickname?: string | null;
  matchMode?: 'PVP' | 'PVE' | 'TUTORIAL'; // Match mode: PVP | PVE | TUTORIAL
};

export type StepRevealPayload = {
  matchId: string;
  roundIndex: number;
  stepIndex: number;
  yourCard: CardId; // CardId from server
  oppCard: CardId; // CardId from server
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
  matchMode?: 'PVP' | 'PVE' | 'TUTORIAL'; // Match mode: PVP | PVE | TUTORIAL
};

export type HelloOkPayload = {
  tokens: number;
  nickname?: string | null;
  tutorialCompleted?: boolean;
};
