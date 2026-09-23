import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { reportAppleSyncItem } from './_shared/spotify-apple-sync-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)

    return json(await reportAppleSyncItem(
      request.headers.get('authorization'),
      body.syncItemId,
      body.status,
    ))
  } catch (error) {
    return errorResponse(error)
  }
}
