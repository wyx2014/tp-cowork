/** Phone setup is local to this desktop profile. Secrets are write-only. */
export interface CallSetupRequest { caller?: string; sourceDirectory?: string }
export interface CallSetup {
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
export interface SaveCallSetup extends CallSetupRequest {
  caller: string
  phoneUrl: string
  pbx: string
  outgoingPrefix: string
  username?: string
  password?: string
}
