const JSON_HEADERS = {
  'cache-control': 'no-store',
  'content-type': 'application/json; charset=utf-8',
}

export class RequestError extends Error {
  constructor(code, message, status = 400) {
    super(message)
    this.name = 'RequestError'
    this.code = code
    this.status = status
  }
}

export function json(body, status = 200) {
  return new Response(JSON.stringify(body), {
    status,
    headers: JSON_HEADERS,
  })
}

export function requirePost(request) {
  if (request.method !== 'POST') {
    throw new RequestError('method_not_allowed', 'Use POST for this endpoint.', 405)
  }
}

export async function readJson(request) {
  const contentLength = Number(request.headers.get('content-length') ?? 0)

  if (contentLength > 4096) {
    throw new RequestError('request_too_large', 'Request body is too large.', 413)
  }

  try {
    const body = await request.json()

    if (!body || typeof body !== 'object' || Array.isArray(body)) {
      throw new Error('Invalid JSON object')
    }

    return body
  } catch {
    throw new RequestError('invalid_json', 'Send a valid JSON request body.')
  }
}

export function roomFromRpc(row) {
  const participantsCount = Number(row.participants_count)
  const maxParticipants = Number(row.max_participants)

  return {
    code: row.room_code,
    participantsCount,
    maxParticipants,
    status: participantsCount >= maxParticipants ? 'full' : 'waiting',
  }
}

export function errorResponse(error) {
  if (error instanceof RequestError) {
    return json({ error: { code: error.code, message: error.message } }, error.status)
  }

  console.error('Room API request failed', {
    code: error?.code ?? 'unknown',
    message: error?.message ?? 'Unknown server error',
  })

  return json(
    {
      error: {
        code: 'server_error',
        message: 'The room service is temporarily unavailable. Please try again.',
      },
    },
    500,
  )
}
