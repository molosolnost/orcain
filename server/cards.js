// Card System - Source of Truth
// This file defines all cards with stable IDs and metadata

// Canonical CardId array (stable order)
const CARD_IDS = ['attack', 'defense', 'heal', 'counter'];

// GRASS is server-only placeholder (never sent to client)
const GRASS = 'GRASS';

// Card metadata
const CARD_METADATA = {
  'attack': {
    id: 'attack',
    title: 'Attack',
    type: 'ATTACK',
    icon: '⚔',
    color: { bg: '#ffebee', border: '#f44336', text: '#c62828' },
    description: 'Deals 2 damage',
    enabled: true
  },
  'defense': {
    id: 'defense',
    title: 'Defense',
    type: 'DEFENSE',
    icon: '🛡',
    color: { bg: '#e3f2fd', border: '#2196f3', text: '#1565c0' },
    description: 'Blocks attack',
    enabled: true
  },
  'heal': {
    id: 'heal',
    title: 'Heal',
    type: 'HEAL',
    icon: '💚',
    color: { bg: '#e8f5e9', border: '#4caf50', text: '#2e7d32' },
    description: 'Restores +1 HP',
    enabled: true
  },
  'counter': {
    id: 'counter',
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
  'attack': 'ATTACK',
  'defense': 'DEFENSE',
  'heal': 'HEAL',
  'counter': 'COUNTER'
};

// Reverse mapping: CardType -> CardId (for legacy compatibility)
const CARD_TYPE_TO_ID = {
  'ATTACK': 'attack',
  'DEFENSE': 'defense',
  'HEAL': 'heal',
  'COUNTER': 'counter'
};

// Default hand (4 cards) - will be replaced by deck builder later
const DEFAULT_HAND = ['attack', 'defense', 'heal', 'counter'];

// Get hand for account (currently returns default hand, later will use deck builder)
function getHandForAccount(accountId) {
  // TODO: Load from deck builder when implemented
  return [...DEFAULT_HAND];
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
  return CARD_IDS.filter(id => CARD_METADATA[id].enabled);
}

module.exports = {
  CARD_IDS,
  GRASS,
  CARD_METADATA,
  CARD_ID_TO_TYPE,
  CARD_TYPE_TO_ID,
  DEFAULT_HAND,
  getHandForAccount,
  isValidCardId,
  cardIdToType,
  cardTypeToId,
  getAllEnabledCardIds
};
