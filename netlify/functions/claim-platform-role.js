import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { claimPlatformRole } from './_shared/platform-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    return json(await claimPlatformRole(
      body.code,
      body.participantToken,
      body.role,
    ))
  } catch (error) {
    return errorResponse(error)
  }
}
