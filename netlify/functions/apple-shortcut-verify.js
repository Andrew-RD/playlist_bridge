import { verifyAppleShortcut } from './_shared/apple-shortcut-service.js'
import { errorResponse, json, RequestError } from './_shared/http.js'

export default async function handler(request) {
  try {
    if (!['GET', 'POST'].includes(request.method)) {
      throw new RequestError(
        'method_not_allowed',
        'Use GET or POST for this endpoint.',
        405,
      )
    }

    return json(await verifyAppleShortcut(
      request.headers.get('authorization'),
    ))
  } catch (error) {
    return errorResponse(error)
  }
}
