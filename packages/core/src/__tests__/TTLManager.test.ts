import { describe, it, expect } from 'vitest'
import { TTLManager } from '../TTLManager.js'

describe('TTLManager', () => {
  describe('computeExpiresAt', () => {
    it('adds a positive ttl to createdAt', () => {
      expect(TTLManager.computeExpiresAt(1000, 500)).toBe(1500)
    })

    it('returns undefined when ttl is omitted', () => {
      expect(TTLManager.computeExpiresAt(1000)).toBeUndefined()
    })

    it('returns undefined for zero or negative ttl', () => {
      expect(TTLManager.computeExpiresAt(1000, 0)).toBeUndefined()
      expect(TTLManager.computeExpiresAt(1000, -10)).toBeUndefined()
    })
  })

  describe('isExpired', () => {
    it('is false when there is no expiry', () => {
      expect(TTLManager.isExpired({ expiresAt: undefined }, 9999)).toBe(false)
    })

    it('is true when expiry is at or before now', () => {
      expect(TTLManager.isExpired({ expiresAt: 1000 }, 1000)).toBe(true)
      expect(TTLManager.isExpired({ expiresAt: 1000 }, 1001)).toBe(true)
    })

    it('is false when expiry is in the future', () => {
      expect(TTLManager.isExpired({ expiresAt: 1000 }, 999)).toBe(false)
    })

    it('uses Date.now() by default', () => {
      expect(TTLManager.isExpired({ expiresAt: Date.now() - 1000 })).toBe(true)
      expect(TTLManager.isExpired({ expiresAt: Date.now() + 100_000 })).toBe(false)
    })
  })

  describe('remaining', () => {
    it('returns Infinity when there is no expiry', () => {
      expect(TTLManager.remaining({ expiresAt: undefined })).toBe(Infinity)
    })

    it('returns the remaining milliseconds', () => {
      expect(TTLManager.remaining({ expiresAt: 1500 }, 1000)).toBe(500)
    })

    it('clamps expired entries to zero', () => {
      expect(TTLManager.remaining({ expiresAt: 500 }, 1000)).toBe(0)
    })
  })

  describe('slide', () => {
    it('extends expiry by ttl from now', () => {
      expect(TTLManager.slide(500, 1000)).toBe(1500)
    })

    it('returns undefined for no ttl', () => {
      expect(TTLManager.slide(undefined, 1000)).toBeUndefined()
    })
  })
})
