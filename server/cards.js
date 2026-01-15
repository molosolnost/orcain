// Card System - Source of Truth
// This file defines all cards with stable IDs and metadata

const CARD_IDS = {
  ATTACK: 'attack',
  DEFENSE: 'defense',
  HEAL: 'heal',
  COUNTER: 'counter'
};

// Card metadata
const CARD_METADATA = {
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
const CARD_ID_TO_TYPE = {
  [CARD_IDS.ATTACK]: 'ATTACK',
  [CARD_IDS.DEFENSE]: 'DEFENSE',
  [CARD_IDS.HEAL]: 'HEAL',
  [CARD_IDS.COUNTER]: 'COUNTER'
};

// Reverse mapping: CardType -> CardId (for legacy compatibility)
const CARD_TYPE_TO_ID = {
  'ATTACK': CARD_IDS.ATTACK,
  'DEFENSE': CARD_IDS.DEFENSE,
  'HEAL': CARD_IDS.HEAL,
  'COUNTER': CARD_IDS.COUNTER
};

// Default deck (4 cards) - will be replaced by deck builder later
const DEFAULT_DECK = [
  CARD_IDS.ATTACK,
  CARD_IDS.DEFENSE,
  CARD_IDS.HEAL,
  CARD_IDS.COUNTER
];

// Get hand for account (currently returns default deck, later will use deck builder)
function getHandForAccount(accountId) {
  // TODO: Load from deck builder when implemented
  return [...DEFAULT_DECK];
}

// Validate card ID
function isValidCardId(cardId) {
  return cardId !== null && CARD_METADATA.hasOwnProperty(cardId);
}

// Convert CardId to CardType (for battle engine)
function cardIdToType(cardId) {
  if (cardId === null) return null;
  return CARD_ID_TO_TYPE[cardId] || null;
}

// Convert CardType to CardId (for legacy compatibility)
function cardTypeToId(cardType) {
  if (cardType === null) return null;
  return CARD_TYPE_TO_ID[cardType] || null;
}

// Get all enabled card IDs
function getAllEnabledCardIds() {
  return Object.values(CARD_IDS).filter(id => CARD_METADATA[id].enabled);
}

module.exports = {
  CARD_IDS,
  CARD_METADATA,
  CARD_ID_TO_TYPE,
  CARD_TYPE_TO_ID,
  DEFAULT_DECK,
  getHandForAccount,
  isValidCardId,
  cardIdToType,
  cardTypeToId,
  getAllEnabledCardIds
};
