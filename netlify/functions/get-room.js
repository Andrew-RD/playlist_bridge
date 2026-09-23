import { errorResponse, json, readJson, requirePost } from './_shared/http.js'
import { getRoom } from './_shared/room-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    const body = await readJson(request)
    return json(await getRoom(body.code, body.participantToken))
  } catch (error) {
    return errorResponse(error)
  }
}
