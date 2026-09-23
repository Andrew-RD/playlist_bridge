import { errorResponse, json, requirePost } from './_shared/http.js'
import { createRoom } from './_shared/room-service.js'

export default async function handler(request) {
  try {
    requirePost(request)
    return json(await createRoom(), 201)
  } catch (error) {
    return errorResponse(error)
  }
}
