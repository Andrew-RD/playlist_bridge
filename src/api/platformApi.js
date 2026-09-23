import { postFunction } from './roomApi.js'

export function claimPlatformRole(code, participantToken, role, options) {
  return postFunction(
    'claim-platform-role',
    { code, participantToken, role },
    options,
  )
}
