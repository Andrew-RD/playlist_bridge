import { errorResponse, json, redirect } from './_shared/http.js'
import {
  completeSpotifyConnection,
  consumeSpotifyOAuthState,
  spotifyRoomReturnUrl,
  spotifyRootReturnUrl,
} from './_shared/spotify-service.js'

export default async function handler(request) {
  if (request.method !== 'GET') {
    return json(
      {
        error: {
          code: 'method_not_allowed',
          message: 'Use GET for this endpoint.',
        },
      },
      405,
    )
  }

  const url = new URL(request.url)
  const state = url.searchParams.get('state')

  if (!state) {
    try {
      return redirect(spotifyRootReturnUrl('state_error'))
    } catch (error) {
      return errorResponse(error)
    }
  }

  let context

  try {
    context = await consumeSpotifyOAuthState(state)
  } catch (error) {
    console.error('Spotify callback rejected', {
      code: error?.code || 'state_error',
      status: error?.status || 500,
    })

    try {
      return redirect(spotifyRootReturnUrl('state_error'))
    } catch (redirectError) {
      return errorResponse(redirectError)
    }
  }

  const spotifyError = url.searchParams.get('error')

  if (spotifyError) {
    return redirect(
      spotifyRoomReturnUrl(
        context.code,
        spotifyError === 'access_denied' ? 'denied' : 'error',
      ),
    )
  }

  try {
    await completeSpotifyConnection(context, url.searchParams.get('code'))
    return redirect(spotifyRoomReturnUrl(context.code, 'connected'))
  } catch (error) {
    console.error('Spotify callback failed', {
      code: error?.code || 'callback_error',
      status: error?.status || 500,
    })

    return redirect(
      spotifyRoomReturnUrl(
        context.code,
        error?.code === 'spotify_already_connected'
          ? 'already_connected'
          : 'error',
      ),
    )
  }
}
