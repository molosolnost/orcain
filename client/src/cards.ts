// Card System - Source of Truth (Client)
// This file mirrors server card definitions

export const CARD_IDS = {
  ATTACK: 'attack',
  DEFENSE: 'defense',
  HEAL: 'heal',
  COUNTER: 'counter'
} as const;

export type CardId = typeof CARD_IDS[keyof typeof CARD_IDS];

export interface CardMetadata {
  id: CardId;
  title: string;
  type: 'ATTACK' | 'DEFENSE' | 'HEAL' | 'COUNTER';
  icon: string;
  color: {
    bg: string;
    border: string;
    text: string;
  };
  description: string;
  enabled: boolean;
}

export const CARD_METADATA: Record<CardId, CardMetadata> = {
  [CARD_IDS.ATTACK]: {
    id: CARD_IDS.ATTACK,
    title: 'Attack',
    type: 'ATTACK',
    icon: '⚔',
    color: { bg: '#ffebee', border: '#f44336', text: '#c62828' },
    description: 'Deals 2 damage',
    enabled: true
  },
  [CARD_IDS.DEFENSE]: {
    id: CARD_IDS.DEFENSE,
    title: 'Defense',
    type: 'DEFENSE',
    icon: '🛡',
    color: { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0' },
    description: 'Blocks attack',
    enabled: true
  },
  [CARD_IDS.HEAL]: {
    id: CARD_IDS.HEAL,
    title: 'Heal',
    type: 'HEAL',
    icon: '💚',
    color: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32' },
    description: 'Restores +1 HP',
    enabled: true
  },
  [CARD_IDS.COUNTER]: {
    id: CARD_IDS.COUNTER,
    title: 'Counter',
    type: 'COUNTER',
    icon: '🟣',
    color: { bg: '#f3e5f5', border: '#9c27b0', text: '#6a1b9a' },
    description: 'Reflects attack',
    enabled: true
  }
};

// Mapping: CardId -> CardType (for battle engine compatibility)
export const CARD_ID_TO_TYPE: Record<CardId, 'ATTACK' | 'DEFENSE' | 'HEAL' | 'COUNTER'> = {
  [CARD_IDS.ATTACK]: 'ATTACK',
  [CARD_IDS.DEFENSE]: 'DEFENSE',
  [CARD_IDS.HEAL]: 'HEAL',
  [CARD_IDS.COUNTER]: 'COUNTER'
};

// Validate card ID
export function isValidCardId(cardId: string | null): cardId is CardId {
  if (cardId === null) return false;
  return cardId in CARD_METADATA;
}

// Convert CardId to CardType (for battle engine)
export function cardIdToType(cardId: CardId | null): 'ATTACK' | 'DEFENSE' | 'HEAL' | 'COUNTER' | null {
  if (cardId === null) return null;
  return cardId ? CARD_ID_TO_TYPE[cardId] || null : null;
}

// Get card metadata
export function getCardMetadata(cardId: CardId): CardMetadata | null {
  return CARD_METADATA[cardId] || null;
}
