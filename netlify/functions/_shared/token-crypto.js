import {
  createCipheriv,
  createDecipheriv,
  randomBytes,
} from 'node:crypto'

const ALGORITHM = 'aes-256-gcm'
const AAD = Buffer.from('playlist-bridge:spotify-token:v1', 'utf8')
const IV_LENGTH = 12
let encryptionKey

function decodeKey(value) {
  if (value.startsWith('base64:')) {
    return Buffer.from(value.slice(7), 'base64')
  }

  if (value.startsWith('hex:')) {
    return Buffer.from(value.slice(4), 'hex')
  }

  if (/^[0-9a-f]{64}$/i.test(value)) {
    return Buffer.from(value, 'hex')
  }

  const base64Key = Buffer.from(value, 'base64')
  if (base64Key.length === 32) return base64Key

  return Buffer.from(value, 'utf8')
}

function getEncryptionKey() {
  if (encryptionKey) return encryptionKey

  const configuredKey = process.env.TOKEN_ENCRYPTION_KEY

  if (!configuredKey) {
    throw new Error('Token encryption is not configured')
  }

  const decodedKey = decodeKey(configuredKey.trim())

  if (decodedKey.length !== 32) {
    throw new Error('TOKEN_ENCRYPTION_KEY must decode to exactly 32 bytes')
  }

  encryptionKey = decodedKey
  return encryptionKey
}

export function encryptToken(plaintext) {
  if (typeof plaintext !== 'string' || !plaintext) {
    throw new Error('Cannot encrypt an empty token')
  }

  const iv = randomBytes(IV_LENGTH)
  const cipher = createCipheriv(ALGORITHM, getEncryptionKey(), iv)
  cipher.setAAD(AAD)
  const ciphertext = Buffer.concat([
    cipher.update(plaintext, 'utf8'),
    cipher.final(),
  ])
  const authTag = cipher.getAuthTag()

  return [
    'v1',
    iv.toString('base64url'),
    authTag.toString('base64url'),
    ciphertext.toString('base64url'),
  ].join('.')
}

export function decryptToken(encryptedValue) {
  const [version, ivValue, authTagValue, ciphertextValue] =
    String(encryptedValue).split('.')

  if (version !== 'v1' || !ivValue || !authTagValue || !ciphertextValue) {
    throw new Error('Encrypted token has an unsupported format')
  }

  const decipher = createDecipheriv(
    ALGORITHM,
    getEncryptionKey(),
    Buffer.from(ivValue, 'base64url'),
  )
  decipher.setAAD(AAD)
  decipher.setAuthTag(Buffer.from(authTagValue, 'base64url'))

  return Buffer.concat([
    decipher.update(Buffer.from(ciphertextValue, 'base64url')),
    decipher.final(),
  ]).toString('utf8')
}
