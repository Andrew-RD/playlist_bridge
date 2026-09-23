import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { listSpotifyPlaylists } from './_shared/spotify-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    return json(await listSpotifyPlaylists(body.code, body.participantToken))
  } catch (error) {
    return errorResponse(error)
  }
}
