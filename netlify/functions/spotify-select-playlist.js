import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { selectSpotifyPlaylist } from './_shared/spotify-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    const spotify = await selectSpotifyPlaylist(
      body.code,
      body.participantToken,
      body.playlistId,
    )
    return json({ spotify })
  } catch (error) {
    return errorResponse(error)
  }
}
