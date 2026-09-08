/**
 * 装配层：路由、屏幕、状态、本地驱动（单机、教程）和服务端驱动（联机）。
 *
 * 这是唯一一个把所有东西串起来的包——`apps/` 下的三个壳只负责挂载它，不写业务。
 * 允许依赖：`core`、`content`、`protocol`、`design`、`platform`、`canvas`、`ui`，也就是全部。
 * 反过来 `packages/` 里的包一个都不许依赖它，只有 `apps/` 下的壳可以。
 *
 * 目录：
 * - `match/`：对局驱动（本地和联机两种），屏幕只认它这一个接口；
 * - `net/`：大厅和房间的 WebSocket 客户端、会话；
 * - `save/`：本机存档（收藏和胜场、牌组），走 `platform.storage`；
 * - `audio/`：音效表、背景音乐、静音开关，走 `platform.audio`；
 * - `dev/`：开发专用页面（组件目录页、调试场景），生产构建剔除。
 *
 * 这几个模块一律不直接碰 `localStorage`、`Audio` 这类浏览器全局——平台差异全在 `platform` 里，
 * 也只有这样才测得了（测试里换成 `createFakePlatform()`）。
 */

export { App } from './App'
export type { MusicTrack } from './audio/music'
export { currentTrack, MUSIC_TRACKS, onTrackReplay, playTrack, stopMusic } from './audio/music'
export { restoreMuted, setMuted, toggleMuted, useMuted } from './audio/mute'
export type { SoundId } from './audio/sounds'
export {
  HOME_INTRO_DELAY_MS,
  playButtonClick,
  playHomeIntro,
  playSkillTargeting,
  playUrge,
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
export type { ServerDriver, ServerDriverOptions } from './match/serverDriver'
export { createServerDriver } from './match/serverDriver'
export { lobbyUrl, roomUrl } from './net/endpoints'
export type { LobbyClient, LobbyClientOptions } from './net/lobbyClient'
export { createLobbyClient, LobbyError } from './net/lobbyClient'
export type { DecksData, SavedDeck } from './save/deckStore'
export {
  createDeck,
  DECK_NAME_MAX,
  deleteDeck,
  loadDecks,
  MAX_DECKS,
  putDeck,
  renameDeck,
  resetDecks,
  setCurrentDeck,
  updateDeckCards,
} from './save/deckStore'
export type { SaveData } from './save/saveStore'
export {
  loadSave,
  markTutorialDone,
  recordWin,
  resetSave,
  saveHero,
  saveOwnedOrder,
} from './save/saveStore'
