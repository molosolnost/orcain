import { useEffect, useMemo, useState } from "react";
import orcainLogo from "../assets/orcain_logo.webp";
import menuBg from "../assets/orc-theme/menu_bg.svg";
import pvpButtonImage from "../assets/orc-theme/btn_pvp.svg";
import pveButtonImage from "../assets/orc-theme/btn_pve.svg";
import tutorialButtonImage from "../assets/orc-theme/btn_tutorial.svg";
import cancelButtonImage from "../assets/orc-theme/btn_cancel.svg";
import ornamentTopImage from "../assets/orc-theme/ornament_top.svg";
import ornamentBottomImage from "../assets/orc-theme/ornament_bottom.svg";
import { AVATAR_META, DEFAULT_AVATAR, DEFAULT_LANGUAGE, SUPPORTED_LANGUAGES, t, type AvatarId, type GameLanguage } from "../i18n";

const API_BASE = import.meta.env.VITE_API_BASE || "https://orcain-server.onrender.com";
const NICKNAME_CHANGE_COST_DEFAULT = 3;

// Build version badge: mode + sha
const buildMode: 'dev' | 'prod' = import.meta.env.PROD ? 'prod' : 'dev';
const buildId: string = import.meta.env.VITE_BUILD_SHA || 'local';
const isDebug = typeof window !== 'undefined' && new URLSearchParams(window.location.search).get('debug') === '1';
const showBuildBadge = isDebug || buildMode === 'dev';

interface MenuProps {
  onStartBattle: () => void;
  onStartPvE: () => void;
  onStartTutorial: () => void;
  onCancelSearch: () => void;
  onProfileUpdate: (payload: { nickname?: string | null; tokens?: number; language?: GameLanguage; avatar?: AvatarId }) => void;
  isSearching: boolean;
  tokens: number | null;
  nickname: string | null;
  language: GameLanguage;
  avatar: AvatarId;
  authToken: string | null;
  connected: boolean;
  tutorialCompleted: boolean;
}

function validateNickname(value: string, language: GameLanguage): string | null {
  const trimmed = value.trim();
  if (trimmed.length < 3 || trimmed.length > 16) {
    return t(language, "onboarding.nicknameLength");
  }
  const allowedPattern = /^[\p{L}\p{N}_\s-]+$/u;
  if (!allowedPattern.test(trimmed)) {
    return t(language, "onboarding.nicknameChars");
  }
  return null;
}

export default function Menu({
  onStartBattle,
  onStartPvE,
  onStartTutorial,
  onCancelSearch,
  onProfileUpdate,
  isSearching,
  tokens,
  nickname,
  language,
  avatar,
  authToken,
  connected,
  tutorialCompleted
}: MenuProps) {
  const [pvpPressed, setPvpPressed] = useState(false);
  const [profileOpen, setProfileOpen] = useState(false);
  const [profileLanguage, setProfileLanguage] = useState<GameLanguage>(language || DEFAULT_LANGUAGE);
  const [profileAvatar, setProfileAvatar] = useState<AvatarId>(avatar || DEFAULT_AVATAR);
  const [profileNickname, setProfileNickname] = useState(nickname || "");
  const [profileInfo, setProfileInfo] = useState<string | null>(null);
  const [profileError, setProfileError] = useState<string | null>(null);
  const [profileLoading, setProfileLoading] = useState(false);
  const [nicknameLoading, setNicknameLoading] = useState(false);
  const [nicknameCost, setNicknameCost] = useState(NICKNAME_CHANGE_COST_DEFAULT);

  // Кнопка Start Battle disabled если tokens !== null && tokens < 1
  const hasEnoughTokens = connected && tokens !== null && tokens >= 1;
  const canStartPvE = connected;
  const pvpDisabledReason = connected ? t(language, "menu.notEnoughTokens") : t(language, "menu.waitConnection");
  const isCompact = typeof window !== "undefined" ? window.innerHeight < 740 : false;

  const hasProfileSettingsChanges = profileLanguage !== language || profileAvatar !== avatar;
  const isRename = !!nickname && profileNickname.trim().length > 0 && nickname.trim().toLowerCase() !== profileNickname.trim().toLowerCase();

  const activeAvatarMeta = useMemo(() => AVATAR_META[avatar] || AVATAR_META[DEFAULT_AVATAR], [avatar]);

  useEffect(() => {
    if (!profileOpen) return;
    setProfileLanguage(language || DEFAULT_LANGUAGE);
    setProfileAvatar(avatar || DEFAULT_AVATAR);
    setProfileNickname(nickname || "");
    setProfileInfo(null);
    setProfileError(null);
  }, [profileOpen, language, avatar, nickname]);

  // Debug mode: adjust overlay opacity
  const overlayOpacity = isDebug ? 0.52 : 0.38;
  const bgOpacity = isDebug ? 0.85 : 1;

  const handleSaveProfileSettings = async () => {
    if (!authToken) {
      setProfileError(t(language, "common.error"));
      return;
    }
    if (!hasProfileSettingsChanges) {
      setProfileInfo(t(language, "profile.settingsSaved"));
      setProfileError(null);
      return;
    }

    setProfileLoading(true);
    setProfileError(null);
    setProfileInfo(null);
    try {
      const response = await fetch(`${API_BASE}/account/profile`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({
          language: profileLanguage,
          avatar: profileAvatar
        })
      });

      if (!response.ok) {
        const text = await response.text();
        let message = t(language, "common.error");
        try {
          const parsed = JSON.parse(text);
          message = parsed.message || parsed.error || message;
        } catch (e) {
          message = text || message;
        }
        setProfileError(message);
        return;
      }

      const data = await response.json();
      const nextLanguage = data.language === "en" || data.language === "ru" ? data.language : profileLanguage;
      const nextAvatar = (typeof data.avatar === "string" ? data.avatar : profileAvatar) as AvatarId;
      onProfileUpdate({
        language: nextLanguage,
        avatar: nextAvatar
      });
      setProfileInfo(t(nextLanguage, "profile.settingsSaved"));
      setProfileError(null);
    } catch (error) {
      setProfileError(t(language, "common.error"));
    } finally {
      setProfileLoading(false);
    }
  };

  const handleNicknameChange = async () => {
    if (!authToken) {
      setProfileError(t(language, "common.error"));
      return;
    }
    if (!profileNickname.trim()) {
      setProfileError(t(language, "profile.needNickname"));
      return;
    }

    const validationError = validateNickname(profileNickname, language);
    if (validationError) {
      setProfileError(validationError);
      return;
    }

    setNicknameLoading(true);
    setProfileError(null);
    setProfileInfo(null);
    try {
      const response = await fetch(`${API_BASE}/account/nickname`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          Authorization: `Bearer ${authToken}`
        },
        body: JSON.stringify({ nickname: profileNickname.trim() })
      });

      const text = await response.text();
      let data: any = {};
      try {
        data = text ? JSON.parse(text) : {};
      } catch (e) {
        data = {};
      }

      if (!response.ok) {
        if (data.nicknameChangeCost) {
          setNicknameCost(Number(data.nicknameChangeCost) || NICKNAME_CHANGE_COST_DEFAULT);
        }
        if (data.error === "not_enough_tokens") {
          setProfileError(t(language, "profile.notEnoughTokens"));
        } else if (data.error === "nickname_taken") {
          setProfileError(t(language, "onboarding.nicknameTaken"));
        } else {
          setProfileError(data.message || data.error || t(language, "common.error"));
        }
        return;
      }

      if (data.nicknameChangeCost) {
        setNicknameCost(Number(data.nicknameChangeCost) || NICKNAME_CHANGE_COST_DEFAULT);
      }

      onProfileUpdate({
        nickname: data.nickname || profileNickname.trim(),
        tokens: typeof data.tokens === "number" ? data.tokens : undefined
      });
      setProfileNickname(data.nickname || profileNickname.trim());
      setProfileInfo(t(language, "profile.nicknameSaved"));
      setProfileError(null);
    } catch (error) {
      setProfileError(t(language, "common.error"));
    } finally {
      setNicknameLoading(false);
    }
  };

  return (
    <div style={{ 
      position: "relative",
      width: "100%",
      height: "100%",
      minHeight: 0,
      overflow: "hidden",
      paddingTop: "env(safe-area-inset-top, 0px)",
      paddingBottom: "env(safe-area-inset-bottom, 0px)",
      display: "flex",
      flexDirection: "column",
      alignItems: "center",
      justifyContent: "center"
    }}>
      {/* Background layer */}
      <div style={{
        position: "absolute",
        inset: 0,
        backgroundImage: `url(${menuBg})`,
        backgroundSize: "cover",
        backgroundPosition: "center",
        backgroundRepeat: "no-repeat",
        opacity: bgOpacity,
        pointerEvents: "none"
      }} />
      
      {/* Dark overlay */}
      <div style={{
        position: "absolute",
        inset: 0,
        background: `linear-gradient(180deg, rgba(10, 14, 10, ${overlayOpacity - 0.05}) 0%, rgba(6, 10, 8, ${overlayOpacity + 0.04}) 100%)`,
        pointerEvents: "none"
      }} />

      <img
        src={ornamentTopImage}
        alt=""
        style={{
          position: "absolute",
          top: "max(8px, calc(env(safe-area-inset-top, 0px) + 2px))",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(94vw, 620px)",
          opacity: 0.9,
          pointerEvents: "none",
          zIndex: 1
        }}
      />

      <img
        src={ornamentBottomImage}
        alt=""
        style={{
          position: "absolute",
          bottom: "max(8px, calc(env(safe-area-inset-bottom, 0px) + 2px))",
          left: "50%",
          transform: "translateX(-50%)",
          width: "min(94vw, 620px)",
          opacity: 0.9,
          pointerEvents: "none",
          zIndex: 1
        }}
      />
      
      {/* Content layer */}
      <div style={{
        position: "relative",
        zIndex: 2,
        pointerEvents: "auto",
        display: "flex",
        flexDirection: "column",
        alignItems: "center",
        justifyContent: "center",
        gap: isCompact ? "14px" : "18px",
        width: "100%",
        maxWidth: "520px",
        boxSizing: "border-box",
        padding: `max(44px, calc(env(safe-area-inset-top, 0px) + 38px)) 20px max(44px, calc(env(safe-area-inset-bottom, 0px) + 38px))`
      }}>
        <div style={{ width: "100%", display: "flex", justifyContent: "flex-end", marginBottom: "-10px" }}>
          <button
            onClick={() => setProfileOpen(true)}
            style={{
              display: "inline-flex",
              alignItems: "center",
              gap: "8px",
              borderRadius: "999px",
              border: "1px solid rgba(255,255,255,0.34)",
              background: "rgba(0,0,0,0.32)",
              color: "#fff",
              padding: "8px 12px",
              cursor: "pointer",
              fontSize: "13px",
              fontWeight: 700
            }}
          >
            <span style={{ fontSize: "17px", lineHeight: 1 }}>{activeAvatarMeta.emoji}</span>
            {t(language, "menu.profile")}
          </button>
        </div>
        <img
          src={orcainLogo}
          alt="ORCAIN logo"
          style={{
            width: "min(78vw, 360px)",
            height: "auto",
            margin: isCompact ? "0 auto 10px" : "0 auto 16px",
            display: "block",
            userSelect: "none",
            pointerEvents: "none",
          }}
        />
        {nickname && (
          <div style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#ddd", marginTop: "-6px", textAlign: "center" }}>
            {activeAvatarMeta.emoji} {t(language, "menu.welcome")}, <strong>{nickname}</strong>
          </div>
        )}
        {!connected && (
          <div style={{ fontSize: "13px", color: "#ffcc80", textAlign: "center", maxWidth: "330px", lineHeight: 1.35 }}>
            {t(language, "menu.connecting")}
          </div>
        )}
        <div style={{ fontSize: "clamp(18px, 5vw, 22px)", fontWeight: 700 }}>
          {t(language, "menu.tokens")}: {tokens === null ? "—" : tokens}
        </div>
        
        {isSearching ? (
          <>
            <div style={{ fontSize: "clamp(15px, 4vw, 18px)", color: "#ddd" }}>{t(language, "menu.searching")}</div>
            <button 
              onClick={onCancelSearch}
              style={{
                cursor: "pointer",
                width: "min(360px, 90vw)",
                minHeight: isCompact ? "84px" : "94px",
                borderRadius: "14px",
                border: "none",
                backgroundColor: "transparent",
                padding: 0,
                overflow: "hidden",
                boxShadow: "0 8px 22px rgba(0,0,0,0.34)"
              }}
            >
              <img
                src={cancelButtonImage}
                alt={t(language, "common.cancel")}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  pointerEvents: "none",
                  userSelect: "none",
                  display: "block"
                }}
              />
            </button>
          </>
        ) : (
          <>
            <button 
              onClick={onStartBattle}
              disabled={!hasEnoughTokens}
              aria-label="Start PvP battle"
              onPointerDown={() => {
                if (hasEnoughTokens) setPvpPressed(true);
              }}
              onPointerUp={() => setPvpPressed(false)}
              onPointerLeave={() => setPvpPressed(false)}
              onPointerCancel={() => setPvpPressed(false)}
              style={{
                padding: 0,
                cursor: hasEnoughTokens ? "pointer" : "not-allowed",
                width: "min(390px, 94vw)",
                minHeight: isCompact ? "84px" : "94px",
                borderRadius: "14px",
                border: "none",
                backgroundColor: "transparent",
                position: "relative",
                overflow: "hidden",
                touchAction: "manipulation",
                transform: pvpPressed ? "scale(0.98)" : "scale(1)",
                transition: "transform 120ms ease, filter 180ms ease, box-shadow 180ms ease, opacity 180ms ease",
                filter: hasEnoughTokens
                  ? (pvpPressed ? "brightness(0.9)" : "none")
                  : "grayscale(0.35) brightness(0.52)",
                boxShadow: hasEnoughTokens
                  ? (pvpPressed ? "0 4px 14px rgba(0,0,0,0.32)" : "0 8px 22px rgba(0,0,0,0.36)")
                  : "0 4px 10px rgba(0,0,0,0.24)",
                opacity: hasEnoughTokens ? 1 : 0.86
              }}
            >
              <img
                src={pvpButtonImage}
                alt=""
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  pointerEvents: "none",
                  userSelect: "none",
                  display: "block"
                }}
              />
              {!hasEnoughTokens && (
                <div
                  style={{
                    position: "absolute",
                    inset: 0,
                    backgroundColor: "rgba(0, 0, 0, 0.42)",
                    pointerEvents: "none"
                  }}
                />
              )}
            </button>
            {!hasEnoughTokens && (
              <div style={{ fontSize: "12px", color: "#ddd", marginTop: "-6px", textAlign: "center" }}>
                {pvpDisabledReason}
              </div>
            )}
            <button 
              onClick={onStartPvE}
              disabled={!canStartPvE}
              style={{
                cursor: canStartPvE ? "pointer" : "not-allowed",
                backgroundColor: "transparent",
                border: "none",
                borderRadius: "14px",
                width: "min(390px, 94vw)",
                minHeight: isCompact ? "84px" : "94px",
                fontWeight: 700,
                opacity: canStartPvE ? 1 : 0.55,
                padding: 0,
                overflow: "hidden",
                boxShadow: canStartPvE ? "0 8px 22px rgba(0,0,0,0.34)" : "0 5px 12px rgba(0,0,0,0.22)"
              }}
            >
              <img
                src={pveButtonImage}
                alt={canStartPvE ? "Start PvE Training" : "Waiting for connection"}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  pointerEvents: "none",
                  userSelect: "none",
                  display: "block"
                }}
              />
            </button>
            <button
              onClick={onStartTutorial}
              style={{
                cursor: "pointer",
                backgroundColor: "transparent",
                border: "none",
                borderRadius: "14px",
                width: "min(390px, 94vw)",
                minHeight: isCompact ? "84px" : "94px",
                fontWeight: 700,
                padding: 0,
                overflow: "hidden",
                boxShadow: "0 8px 22px rgba(0,0,0,0.34)",
                filter: tutorialCompleted ? "saturate(0.75) brightness(0.96)" : "none"
              }}
            >
              <img
                src={tutorialButtonImage}
                alt={tutorialCompleted ? "Repeat Interactive Tutorial" : "Interactive Tutorial (Recommended)"}
                draggable={false}
                style={{
                  width: "100%",
                  height: "100%",
                  objectFit: "contain",
                  pointerEvents: "none",
                  userSelect: "none",
                  display: "block"
                }}
              />
            </button>
            <div style={{ fontSize: "12px", color: "#ddd", textAlign: "center", maxWidth: "320px", lineHeight: 1.4 }}>
              {t(language, "menu.tutorialHint")}
            </div>
          </>
        )}
        {showBuildBadge && (
          <div style={{ 
            position: "absolute", 
            bottom: "20px", 
            fontSize: "11px", 
            color: isDebug ? "#999" : "#666",
            opacity: buildMode === "prod" && !isDebug ? 0.3 : 0.7,
            textAlign: "center",
            fontFamily: "monospace"
          }}>
            {buildMode} • {buildId}
          </div>
        )}
      </div>

      {profileOpen && (
        <div
          style={{
            position: "absolute",
            inset: 0,
            zIndex: 10,
            background: "rgba(0,0,0,0.72)",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            padding: "16px"
          }}
        >
          <div
            style={{
              width: "min(620px, 96vw)",
              maxHeight: "min(86vh, 760px)",
              overflowY: "auto",
              background: "linear-gradient(180deg, rgba(30, 36, 28, 0.96) 0%, rgba(18, 22, 16, 0.96) 100%)",
              border: "1px solid rgba(255,255,255,0.22)",
              borderRadius: "16px",
              boxShadow: "0 18px 44px rgba(0,0,0,0.48)",
              padding: "18px",
              color: "#f1f1f1"
            }}
          >
            <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: "10px" }}>
              <h2 style={{ margin: 0, fontSize: "22px" }}>{t(language, "profile.title")}</h2>
              <button
                onClick={() => setProfileOpen(false)}
                style={{
                  border: "1px solid rgba(255,255,255,0.25)",
                  borderRadius: "8px",
                  background: "rgba(0,0,0,0.25)",
                  color: "#fff",
                  padding: "7px 12px",
                  cursor: "pointer"
                }}
              >
                {t(language, "profile.close")}
              </button>
            </div>

            <div style={{ marginTop: "16px", padding: "12px", borderRadius: "10px", background: "rgba(255,255,255,0.04)" }}>
              <div style={{ fontSize: "13px", opacity: 0.88 }}>
                {t(language, "profile.currentNickname")}: <strong>{nickname || "—"}</strong>
              </div>
              <div style={{ fontSize: "13px", opacity: 0.88, marginTop: "6px" }}>
                {t(language, "menu.tokens")}: <strong>{tokens === null ? "—" : tokens}</strong>
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>{t(language, "profile.avatar")}</div>
              <div style={{ fontSize: "13px", opacity: 0.84, marginBottom: "8px" }}>{t(language, "profile.chooseAvatar")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: "8px" }}>
                {(Object.keys(AVATAR_META) as AvatarId[]).map((id) => {
                  const isActive = profileAvatar === id;
                  const meta = AVATAR_META[id];
                  return (
                    <button
                      key={id}
                      onClick={() => {
                        setProfileAvatar(id);
                        setProfileInfo(null);
                        setProfileError(null);
                      }}
                      style={{
                        borderRadius: "10px",
                        border: isActive ? "1px solid #ffa726" : "1px solid rgba(255,255,255,0.18)",
                        background: isActive ? "rgba(255, 167, 38, 0.18)" : "rgba(0,0,0,0.22)",
                        color: "#fff",
                        padding: "10px 8px",
                        cursor: "pointer",
                        display: "flex",
                        alignItems: "center",
                        justifyContent: "center",
                        gap: "8px",
                        fontSize: "14px"
                      }}
                    >
                      <span style={{ fontSize: "20px", lineHeight: 1 }}>{meta.emoji}</span>
                      <span>{meta.label[language]}</span>
                    </button>
                  );
                })}
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 700, marginBottom: "10px" }}>{t(language, "common.language")}</div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: "8px" }}>
                {SUPPORTED_LANGUAGES.map((langCode) => (
                  <button
                    key={langCode}
                    onClick={() => {
                      setProfileLanguage(langCode);
                      setProfileInfo(null);
                      setProfileError(null);
                    }}
                    style={{
                      borderRadius: "10px",
                      border: profileLanguage === langCode ? "1px solid #64b5f6" : "1px solid rgba(255,255,255,0.18)",
                      background: profileLanguage === langCode ? "rgba(100, 181, 246, 0.16)" : "rgba(0,0,0,0.22)",
                      color: "#fff",
                      padding: "10px",
                      cursor: "pointer",
                      fontWeight: 700
                    }}
                  >
                    {langCode === "ru" ? "Русский" : "English"}
                  </button>
                ))}
              </div>
            </div>

            <div style={{ marginTop: "16px" }}>
              <div style={{ fontWeight: 700, marginBottom: "8px" }}>{t(language, "profile.changeNickname")}</div>
              <input
                type="text"
                value={profileNickname}
                onChange={(e) => {
                  setProfileNickname(e.target.value);
                  setProfileError(null);
                  setProfileInfo(null);
                }}
                maxLength={16}
                placeholder={t(language, "profile.nicknamePlaceholder")}
                style={{
                  width: "100%",
                  padding: "11px 12px",
                  borderRadius: "10px",
                  border: "1px solid rgba(255,255,255,0.2)",
                  background: "rgba(0,0,0,0.32)",
                  color: "#fff",
                  boxSizing: "border-box"
                }}
              />
              <div style={{ marginTop: "8px", fontSize: "12px", opacity: 0.8 }}>
                {t(language, "profile.nicknameHint")} {isRename && t(language, "profile.nicknameCost", { cost: nicknameCost })}
              </div>
              <button
                onClick={handleNicknameChange}
                disabled={nicknameLoading}
                style={{
                  marginTop: "10px",
                  border: "none",
                  borderRadius: "10px",
                  background: "#4caf50",
                  color: "#fff",
                  padding: "10px 14px",
                  cursor: nicknameLoading ? "not-allowed" : "pointer",
                  opacity: nicknameLoading ? 0.7 : 1,
                  fontWeight: 700
                }}
              >
                {nicknameLoading ? t(language, "profile.savingSettings") : t(language, "profile.changeNickname")}
              </button>
            </div>

            {(profileError || profileInfo) && (
              <div
                style={{
                  marginTop: "14px",
                  borderRadius: "10px",
                  border: profileError ? "1px solid rgba(244,67,54,0.6)" : "1px solid rgba(102,187,106,0.65)",
                  background: profileError ? "rgba(244,67,54,0.12)" : "rgba(102,187,106,0.12)",
                  color: profileError ? "#ffcdd2" : "#dcedc8",
                  padding: "10px 12px",
                  fontSize: "13px"
                }}
              >
                {profileError || profileInfo}
              </div>
            )}

            <button
              onClick={handleSaveProfileSettings}
              disabled={profileLoading}
              style={{
                marginTop: "16px",
                width: "100%",
                border: "none",
                borderRadius: "12px",
                background: "#1976d2",
                color: "#fff",
                padding: "12px 16px",
                fontSize: "16px",
                fontWeight: 800,
                cursor: profileLoading ? "not-allowed" : "pointer",
                opacity: profileLoading ? 0.72 : 1
              }}
            >
              {profileLoading ? t(language, "profile.savingSettings") : t(language, "profile.saveSettings")}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
