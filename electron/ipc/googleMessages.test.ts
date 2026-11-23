import { describe, expect, it } from 'vitest'
import { missingScopes } from './googleMessages'
import { REQUIRED_SCOPES } from './googleConfig'

describe('checking what Google granted', () => {
  it('finds nothing missing when every box was ticked', () => {
    const granted = ['openid', 'email', ...REQUIRED_SCOPES, 'https://www.googleapis.com/auth/drive.file'].join(' ')
    expect(missingScopes(granted, REQUIRED_SCOPES)).toEqual([])
  })
  it('finds the Docs scope missing when that box was unticked', () => {
    expect(missingScopes('openid email https://www.googleapis.com/auth/drive.readonly', REQUIRED_SCOPES)).toEqual([
      'https://www.googleapis.com/auth/documents',
    ])
  })
  it('assumes nothing when Google sends no scope list', () => {
    expect(missingScopes(undefined, REQUIRED_SCOPES)).toEqual([])
  })
})
