import { postFunction } from './roomApi.js'

export function setupAppleShortcut(code, participantToken, options) {
  return postFunction(
    'apple-shortcut-setup',
    { code, participantToken },
    options,
  )
}

export function getAppleShortcutStatus(code, participantToken, options) {
  return postFunction(
    'apple-shortcut-status',
    { code, participantToken },
    options,
  )
}
