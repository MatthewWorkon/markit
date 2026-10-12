import type { Component } from 'vue'
import {
  PhBookOpen,
  PhBriefcase,
  PhCalendarBlank,
  PhCamera,
  PhChartLine,
  PhClock,
  PhCloud,
  PhCode,
  PhCube,
  PhFlask,
  PhFolder,
  PhGameController,
  PhGlobeHemisphereWest,
  PhHardDrives,
  PhHeart,
  PhHouse,
  PhLaptop,
  PhLightbulb,
  PhMusicNotes,
  PhNewspaper,
  PhPalette,
  PhSparkle,
  PhTag,
  PhWrench,
} from '@phosphor-icons/vue'

/** 文件夹图标可选集（线性 Phosphor，与全站图标语言一致） */
export const FOLDER_ICONS: Record<string, Component> = {
  folder: PhFolder,
  code: PhCode,
  sparkle: PhSparkle,
  palette: PhPalette,
  lightbulb: PhLightbulb,
  hardDrives: PhHardDrives,
  newspaper: PhNewspaper,
  globe: PhGlobeHemisphereWest,
  briefcase: PhBriefcase,
  bookOpen: PhBookOpen,
  tag: PhTag,
  house: PhHouse,
  laptop: PhLaptop,
  clock: PhClock,
  calendar: PhCalendarBlank,
  cube: PhCube,
  gameController: PhGameController,
  cloud: PhCloud,
  chartLine: PhChartLine,
  wrench: PhWrench,
  flask: PhFlask,
  musicNotes: PhMusicNotes,
  camera: PhCamera,
  heart: PhHeart,
}

export const ICON_KEYS = Object.keys(FOLDER_ICONS)

/** 图标底色色板（淡底深字，与全站标签色板同族；flat 禁渐变） */
export const FOLDER_COLORS: Record<string, { bg: string; text: string }> = {
  neutral: { bg: '#ffffff', text: '#55554f' },
  blue: { bg: '#e9f0fb', text: '#35569c' },
  green: { bg: '#e9f5ec', text: '#2c7a42' },
  amber: { bg: '#faf0e3', text: '#96690b' },
  pink: { bg: '#f9e9f2', text: '#9c4473' },
  purple: { bg: '#efecf9', text: '#55489c' },
  teal: { bg: '#e3f2f1', text: '#1e6e64' },
  red: { bg: '#fcebea', text: '#c23830' },
}

export const COLOR_KEYS = Object.keys(FOLDER_COLORS)

export const DEFAULT_FOLDER_ICON = 'folder'
