import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { getSpotifyRoomState } from './_shared/spotify-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    const spotify = await getSpotifyRoomState(body.code, body.participantToken)
    return json({ spotify })
  } catch (error) {
    return errorResponse(error)
  }
}
