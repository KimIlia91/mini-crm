import { config } from 'zod'

/**
 * Parse without generated code: the CSP forbids eval, and Zod would otherwise probe for it when the
 * first object schema is created (a reported, if caught, CSP violation). Must be imported first.
 */
config({ jitless: true })
