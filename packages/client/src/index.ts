/**
 * 装配层：路由、屏幕、状态、本地驱动（单机）和服务端驱动（联机）。
 *
 * 这是唯一一个把所有东西串起来的包——`apps/` 下的三个壳只负责挂载它，不写业务。
 * 允许依赖：`core`、`content`、`protocol`、`design`、`platform`、`canvas`、`ui`，也就是全部。
 * 反过来 `packages/` 里的包一个都不许依赖它，只有 `apps/` 下的壳可以。
 *
 * 目录：
 * - `app/`：应用壳（路由表、平台能力和当前对局两个 Context）；
 * - `screens/`：屏幕（首页、选英雄、开包、房间、对局、加载页，以及设置 / 账号 / 关于
 *   三个文字页），画布里那一套由各自的 *Stage 接线；
 * - `match/`：对局驱动（本地和联机两种）和纹理加载，屏幕只认 driver 这一个接口；
 * - `net/`：大厅和房间的 WebSocket 客户端、会话；
 * - `save/`：本机存档（收藏和胜场、牌组），走 `platform.storage`；
 * - `audio/`：音效表、背景音乐、静音开关，走 `platform.audio`；
 * - `preload/`：图片清单、首屏闸门和后台队列，走 `platform.images`；
 * - `dev/`：开发专用页面（组件目录页、调试场景），生产构建剔除。
 *
 * 这几个模块一律不直接碰 `localStorage`、`Audio`、`Image`——平台差异全在 `platform` 里，
 * 也只有这样才测得了（测试里换成 `createFakePlatform()`）。
 */

/*
 * 平台实现从这里转一手给壳用。
 *
 * apps/ 下的壳只许依赖 client 这一个包（见 .dependency-cruiser.cjs 的
 *「依赖方向-apps-只挂-client」），所以「建哪一套平台实现」这个选择要经过装配层的门。
 * 三个壳各转各的：web 壳拿 `createWebPlatform`，Steam 壳拿 `createElectronPlatform`
 *（迁移第 35 条）。
 *
 * 手机壳那一套（`createCapacitorPlatform`，第 36 条）**不在这儿**，在第二个入口
 * `@ai-duel/client/capacitor`（见 src/capacitor.ts）——它会把有副作用的
 * `@capacitor/core` 拖进产物，放在这里等于让网页壳和 Steam 壳白背一份用不到的运行时。
 */
export { createElectronPlatform, createWebPlatform } from '@ai-duel/platform'
export { App } from './App'
export type { MatchMode } from './app/MatchSession'
export { applyReducedMotion } from './app/reducedMotion'
export type { MusicTrack } from './audio/music'
export { currentTrack, MUSIC_TRACKS, onTrackReplay, playTrack, stopMusic } from './audio/music'
export { restoreMuted, setMuted, toggleMuted, useMuted } from './audio/mute'
export type { SoundId } from './audio/sounds'
export {
  HOME_INTRO_DELAY_MS,
  playButtonClick,
  playHomeIntro,
  playSkillTargeting,
  preloadSounds,
  SOUNDS,
} from './audio/sounds'
export type {
  MatchDriver,
  MatchEventBatch,
  MatchLink,
  MatchStatus,
  MatchView,
  PeerState,
} from './match/driver'
export type { LocalDriver, LocalDriverOptions } from './match/localDriver'
export { createLocalDriver, isLocalDriver } from './match/localDriver'
export type { LocalMatchOptions } from './match/localMatch'
export { createHotSeatMatch, createTestMatch } from './match/localMatch'
export type { AutopilotTimers, QuizAnswersFor } from './match/quizAutopilot'
export { QUIZ_AUTOPILOT_DELAY_MS } from './match/quizAutopilot'
export type { ServerDriver, ServerDriverOptions } from './match/serverDriver'
export { createServerDriver, isServerDriver } from './match/serverDriver'
export { lobbyUrl, roomUrl } from './net/endpoints'
export type { LobbyClient, LobbyClientOptions } from './net/lobbyClient'
export { createLobbyClient, LobbyError } from './net/lobbyClient'
export { HERO_IMAGES, INFO_IMAGES, PRELOAD_GROUPS } from './preload/manifests'
export type { PreloadState } from './preload/preload'
export { PRELOAD_STALL_MS, preloadAll, preloadInBackground, preloadState } from './preload/preload'
export { useAssets, useBackgroundPreload } from './preload/useAssets'
export type { DecksData, SavedDeck } from './save/deckStore'
export {
  createDeck,
  DECK_NAME_MAX,
  deleteDeck,
  loadDecks,
  MAX_DECKS,
  renameDeck,
  resetDecks,
  setCurrentDeck,
  updateDeckCards,
} from './save/deckStore'
export type { SaveData } from './save/saveStore'
export {
  loadSave,
  recordWin,
  resetSave,
  saveHero,
  saveOwnedOrder,
  setReducedMotion,
} from './save/saveStore'
