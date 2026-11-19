/** Phone setup is local to this desktop profile. Secrets are write-only. */
export type PhoneType = 'cisco' | 'yealink'
export interface CallSetupRequest { type?: PhoneType; caller?: string; sourceDirectory?: string }
export interface CallSetup {
  type: PhoneType
  caller: string
  phoneUrl: string
  pbx: string
  outgoingPrefix: string
  sourceDirectory: string
  usernameConfigured: boolean
  passwordConfigured: boolean
  confirmed: boolean
  issues: string[]
}
export type SaveCallSetup = { type: 'cisco' } | {
  type?: 'yealink'
  sourceDirectory?: string
  caller: string
  phoneUrl: string
  pbx: string
  outgoingPrefix: string
  username?: string
  password?: string
}
