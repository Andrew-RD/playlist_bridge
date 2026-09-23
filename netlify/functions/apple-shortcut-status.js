import { getAppleShortcutStatus } from './_shared/apple-shortcut-service.js'
import { errorResponse, json, readJson, requirePost } from './_shared/http.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    return json(await getAppleShortcutStatus(body.code, body.participantToken))
  } catch (error) {
    return errorResponse(error)
  }
}
