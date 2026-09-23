import { configureAppleShortcut } from './_shared/apple-shortcut-service.js'
import { errorResponse, json, readJson, requirePost } from './_shared/http.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    const endpoint = new URL(
      '/.netlify/functions/apple-shortcut-verify',
      request.url,
    ).toString()
    return json(await configureAppleShortcut(
      body.code,
      body.participantToken,
      endpoint,
    ))
  } catch (error) {
    return errorResponse(error)
  }
}
