import { getPendingAppleSyncItems } from './_shared/spotify-apple-sync-service.js'
import { errorResponse, json, RequestError } from './_shared/http.js'

export default async function handler(request) {
  try {
    if (request.method !== 'GET') {
      throw new RequestError(
        'method_not_allowed',
        'Use GET for this endpoint.',
        405,
      )
    }

    return json(await getPendingAppleSyncItems(
      request.headers.get('authorization'),
    ))
  } catch (error) {
    return errorResponse(error)
  }
}
