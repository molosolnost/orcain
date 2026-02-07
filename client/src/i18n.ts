export type GameLanguage = 'ru' | 'en';

export type AvatarId = 'orc' | 'knight' | 'mage' | 'rogue' | 'ranger' | 'paladin';
export type LeagueKey = 'wood' | 'iron' | 'bronze' | 'silver' | 'gold' | 'mythic';

export const DEFAULT_LANGUAGE: GameLanguage = 'ru';
export const DEFAULT_AVATAR: AvatarId = 'orc';
export const DEFAULT_LEAGUE_KEY: LeagueKey = 'wood';
export const SUPPORTED_LANGUAGES: GameLanguage[] = ['ru', 'en'];
export const LEAGUE_META: Record<LeagueKey, { label: Record<GameLanguage, string> }> = {
  wood: {
    label: { ru: 'Деревянная', en: 'Wooden' }
  },
  iron: {
    label: { ru: 'Железная', en: 'Iron' }
  },
  bronze: {
    label: { ru: 'Бронзовая', en: 'Bronze' }
  },
  silver: {
    label: { ru: 'Серебряная', en: 'Silver' }
  },
  gold: {
    label: { ru: 'Золотая', en: 'Gold' }
  },
  mythic: {
    label: { ru: 'Мифическая', en: 'Mythic' }
  }
};

export const AVATAR_META: Record<AvatarId, { emoji: string; label: Record<GameLanguage, string> }> = {
  orc: {
    emoji: '🪓',
    label: { ru: 'Орк', en: 'Orc' }
  },
  knight: {
    emoji: '🛡️',
    label: { ru: 'Рыцарь', en: 'Knight' }
  },
  mage: {
    emoji: '🔮',
    label: { ru: 'Маг', en: 'Mage' }
  },
  rogue: {
    emoji: '🗡️',
    label: { ru: 'Разбойник', en: 'Rogue' }
  },
  ranger: {
    emoji: '🏹',
    label: { ru: 'Следопыт', en: 'Ranger' }
  },
  paladin: {
    emoji: '⚔️',
    label: { ru: 'Паладин', en: 'Paladin' }
  }
};

type TranslationKey =
  | 'common.loading'
  | 'common.error'
  | 'common.save'
  | 'common.cancel'
  | 'common.language'
  | 'common.league'
  | 'common.rating'
  | 'login.title'
  | 'login.createAccount'
  | 'login.creatingAccount'
  | 'login.createError'
  | 'onboarding.title'
  | 'onboarding.subtitle'
  | 'onboarding.placeholder'
  | 'onboarding.saveAndContinue'
  | 'onboarding.saving'
  | 'onboarding.nicknameTaken'
  | 'onboarding.nicknameRequired'
  | 'onboarding.nicknameLength'
  | 'onboarding.nicknameChars'
  | 'onboarding.saveFailed'
  | 'menu.welcome'
  | 'menu.tokens'
  | 'menu.connecting'
  | 'menu.searching'
  | 'menu.notEnoughTokens'
  | 'menu.waitConnection'
  | 'menu.tutorialHint'
  | 'menu.profile'
  | 'profile.title'
  | 'profile.avatar'
  | 'profile.changeNickname'
  | 'profile.currentNickname'
  | 'profile.nicknamePlaceholder'
  | 'profile.nicknameHint'
  | 'profile.nicknameCost'
  | 'profile.saveSettings'
  | 'profile.savingSettings'
  | 'profile.nicknameSaved'
  | 'profile.settingsSaved'
  | 'profile.needNickname'
  | 'profile.notEnoughTokens'
  | 'profile.close'
  | 'profile.chooseAvatar';

const STRINGS: Record<TranslationKey, Record<GameLanguage, string>> = {
  'common.loading': { ru: 'Загрузка...', en: 'Loading...' },
  'common.error': { ru: 'Ошибка', en: 'Error' },
  'common.save': { ru: 'Сохранить', en: 'Save' },
  'common.cancel': { ru: 'Отмена', en: 'Cancel' },
  'common.language': { ru: 'Язык', en: 'Language' },
  'common.league': { ru: 'Лига', en: 'League' },
  'common.rating': { ru: 'Рейтинг', en: 'Rating' },
  'login.title': { ru: 'ORCAIN', en: 'ORCAIN' },
  'login.createAccount': { ru: 'Создать аккаунт', en: 'Create account' },
  'login.creatingAccount': { ru: 'Создаём аккаунт...', en: 'Creating account...' },
  'login.createError': { ru: 'Не удалось создать аккаунт. Попробуйте снова.', en: 'Failed to create account. Please try again.' },
  'onboarding.title': { ru: 'Добро пожаловать в ORCAIN', en: 'Welcome to ORCAIN' },
  'onboarding.subtitle': { ru: 'Выберите уникальный никнейм, чтобы начать игру', en: 'Choose your unique nickname to start playing' },
  'onboarding.placeholder': { ru: 'Введите никнейм (3-16 символов)', en: 'Enter your nickname (3-16 characters)' },
  'onboarding.saveAndContinue': { ru: 'Сохранить и продолжить', en: 'Save & Continue' },
  'onboarding.saving': { ru: 'Сохранение...', en: 'Saving...' },
  'onboarding.nicknameTaken': { ru: 'Этот никнейм уже занят. Выберите другой.', en: 'Nickname is already taken. Please choose another.' },
  'onboarding.nicknameRequired': { ru: 'Никнейм обязателен', en: 'Nickname is required' },
  'onboarding.nicknameLength': { ru: 'Никнейм должен быть длиной 3-16 символов', en: 'Nickname must be 3-16 characters long' },
  'onboarding.nicknameChars': { ru: 'Допустимы только буквы, цифры, пробел, дефис и подчёркивание', en: 'Nickname can only contain letters, numbers, underscore, space, and hyphen' },
  'onboarding.saveFailed': { ru: 'Не удалось сохранить никнейм. Попробуйте снова.', en: 'Failed to set nickname. Please try again.' },
  'menu.welcome': { ru: 'Добро пожаловать', en: 'Welcome' },
  'menu.tokens': { ru: 'Токены', en: 'Tokens' },
  'menu.connecting': { ru: 'Подключаемся к серверу... Кнопки PvP/PvE станут активны автоматически.', en: 'Connecting to server... PvP/PvE buttons will unlock automatically after connection.' },
  'menu.searching': { ru: 'Ищем соперника…', en: 'Searching opponent…' },
  'menu.notEnoughTokens': { ru: 'Недостаточно токенов', en: 'Not enough tokens' },
  'menu.waitConnection': { ru: 'Ожидание подключения', en: 'Waiting for connection' },
  'menu.tutorialHint': { ru: 'Без таймера. Пошаговые подсказки: какую карту и в какой слот поставить, и почему.', en: 'No timer. You will be guided step by step: which card goes to which slot and why.' },
  'menu.profile': { ru: 'Профиль', en: 'Profile' },
  'profile.title': { ru: 'Профиль игрока', en: 'Player Profile' },
  'profile.avatar': { ru: 'Аватар', en: 'Avatar' },
  'profile.changeNickname': { ru: 'Смена никнейма', en: 'Change Nickname' },
  'profile.currentNickname': { ru: 'Текущий ник', en: 'Current nickname' },
  'profile.nicknamePlaceholder': { ru: 'Новый никнейм', en: 'New nickname' },
  'profile.nicknameHint': { ru: 'Если у вас уже есть ник, смена будет платной.', en: 'If you already have a nickname, rename will cost tokens.' },
  'profile.nicknameCost': { ru: 'Стоимость смены: {cost} ток.', en: 'Rename cost: {cost} tokens.' },
  'profile.saveSettings': { ru: 'Сохранить настройки', en: 'Save settings' },
  'profile.savingSettings': { ru: 'Сохраняем...', en: 'Saving...' },
  'profile.nicknameSaved': { ru: 'Никнейм обновлён', en: 'Nickname updated' },
  'profile.settingsSaved': { ru: 'Профиль обновлён', en: 'Profile updated' },
  'profile.needNickname': { ru: 'Введите никнейм', en: 'Please enter a nickname' },
  'profile.notEnoughTokens': { ru: 'Недостаточно токенов для смены никнейма', en: 'Not enough tokens to change nickname' },
  'profile.close': { ru: 'Закрыть', en: 'Close' },
  'profile.chooseAvatar': { ru: 'Выберите аватар', en: 'Choose avatar' }
};

export function t(language: GameLanguage, key: TranslationKey, vars?: Record<string, string | number>): string {
  const source = STRINGS[key]?.[language] || STRINGS[key]?.[DEFAULT_LANGUAGE] || key;
  if (!vars) return source;
  return Object.entries(vars).reduce((acc, [name, value]) => acc.replace(`{${name}}`, String(value)), source);
}
