import {
  errorResponse,
  readForm,
  redirect,
  requirePost,
} from './_shared/http.js'
import { beginSpotifyOAuth } from './_shared/spotify-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const form = await readForm(request)
    const authorizationUrl = await beginSpotifyOAuth(
      form.get('code'),
      form.get('participantToken'),
    )
    return redirect(authorizationUrl, 302)
  } catch (error) {
    return errorResponse(error)
  }
}
