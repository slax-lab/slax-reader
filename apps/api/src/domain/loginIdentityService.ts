import { addDays } from 'date-fns'
import { EmailAuthIdentityConflictError, EmailAuthUseExistingLoginError, UserAccountDeletedError } from '@/const/err'
import { inject, injectable } from '@/decorators/di'
import { UserRepo, type LoginEmailOwner, type LoginIdentityTransaction, type LoginProvider, type userInfoPO } from '@/infra/repository/dbUser'

function isEmailFrozen(deletedAt: Date | null) {
  return deletedAt !== null && addDays(deletedAt, 30).getTime() >= Date.now()
}

function singleEmailOwner(owners: LoginEmailOwner[]) {
  const active = owners.filter(owner => !owner.deleted_at)
  if (active.length > 1 || owners.some(owner => isEmailFrozen(owner.deleted_at))) throw EmailAuthIdentityConflictError()
  return active[0]
}

async function hasOtherEmailOwner(tx: LoginIdentityTransaction, key: string, userId: number) {
  const owners = await tx.findEmailOwners(key)
  return owners.some(owner => owner.id !== userId && (!owner.deleted_at || isEmailFrozen(owner.deleted_at)))
}

async function getLegacyAppleOwner(tx: LoginIdentityTransaction, placeholder: string) {
  const account = await tx.findProfileEmail(placeholder)
  if (!account) return undefined
  if (isEmailFrozen(account.deleted_at)) throw EmailAuthIdentityConflictError()
  return account.deleted_at ? undefined : account.id
}

async function getProviderOwner(tx: LoginIdentityTransaction, provider: LoginProvider, subject: string) {
  const matches = await tx.findProviderOwners(provider, subject)
  if (matches.length > 1) throw EmailAuthIdentityConflictError()
  return matches[0]?.user_id
}

async function lockActiveAccount(tx: LoginIdentityTransaction, userId: number) {
  const account = await tx.lockAccount(userId)
  if (!account || account.deleted_at) throw UserAccountDeletedError()
  return account
}

async function attachIdentity(tx: LoginIdentityTransaction, userId: number, platform: LoginProvider | 'mail', key: string, label: string) {
  const existing = await tx.findBinding(userId, platform)
  if (existing) {
    if (existing.platform_id !== key || (platform === 'mail' && existing.user_name !== label)) throw EmailAuthIdentityConflictError()
    return
  }
  await tx.createBinding(userId, platform, key, label)
}

@injectable()
export class LoginIdentityService {
  constructor(@inject(UserRepo) private users: UserRepo) {}

  public async signInWithEmail(key: string, deliveryEmail: string, profile: userInfoPO) {
    return this.users.withLoginIdentityTransaction({ emailKey: key }, async tx => {
      const owner = singleEmailOwner(await tx.findEmailOwners(key))
      if (owner) {
        if (owner.login_key !== key) throw EmailAuthUseExistingLoginError()
        if (owner.delivery_email !== deliveryEmail) throw EmailAuthIdentityConflictError()
        await lockActiveAccount(tx, owner.id)
        return { user: await tx.recordLogin(owner.id, profile), isNew: false }
      }
      const user = await tx.saveRegistration({ ...profile, email: deliveryEmail })
      await attachIdentity(tx, user.id, 'mail', key, deliveryEmail)
      return { user, isNew: true }
    })
  }

  public async linkLoginEmail(userId: number, key: string, deliveryEmail: string) {
    await this.users.withLoginIdentityTransaction({ emailKey: key }, async tx => {
      await lockActiveAccount(tx, userId)
      const owner = singleEmailOwner(await tx.findEmailOwners(key))
      if (owner && owner.id !== userId) throw EmailAuthIdentityConflictError()
      await attachIdentity(tx, userId, 'mail', key, deliveryEmail)
    })
  }

  public async signInWithProvider(provider: LoginProvider, subject: string, profile: userInfoPO) {
    const key = profile.email.trim().toLowerCase()
    const placeholder = `${subject}@appleid.apple.com`
    return this.users.withLoginIdentityTransaction({ emailKey: key, provider: { type: provider, subject } }, async tx => {
      const subjectOwner = await getProviderOwner(tx, provider, subject)
      // Earlier Apple logins could leave only a deterministic profile address.
      const legacyApple = subjectOwner === undefined && provider === 'apple' ? await getLegacyAppleOwner(tx, placeholder) : undefined
      const legacyOwner = subjectOwner === undefined && legacyApple === undefined ? singleEmailOwner(await tx.findEmailOwners(key)) : undefined
      const id = subjectOwner ?? legacyApple ?? legacyOwner?.id
      let email = profile.email
      let providerEmail = profile.email
      if (id !== undefined) {
        const account = await lockActiveAccount(tx, id)
        const boundEmail = await tx.findBinding(id, 'mail')
        if (legacyOwner && (boundEmail || account.email !== profile.email)) throw EmailAuthUseExistingLoginError()
        if (legacyApple !== undefined && key !== placeholder.toLowerCase() && (await hasOtherEmailOwner(tx, key, id))) providerEmail = ''
        if (boundEmail || legacyApple !== undefined || (provider === 'apple' && profile.email === placeholder)) {
          email = account.email
        } else if (account.email !== email && (await hasOtherEmailOwner(tx, key, id))) {
          // The verified subject still identifies this account when a new provider email is unavailable.
          email = account.email
        }
      }
      const user = await tx.saveRegistration({ ...profile, id, email })
      await attachIdentity(tx, user.id, provider, subject, providerEmail)
      return { user, isNew: id === undefined }
    })
  }

  public async linkLoginProvider(userId: number, provider: LoginProvider, subject: string, email: string) {
    const key = email.trim().toLowerCase()
    return this.users.withLoginIdentityTransaction({ emailKey: key, provider: { type: provider, subject } }, async tx => {
      await lockActiveAccount(tx, userId)
      const subjectOwner = await getProviderOwner(tx, provider, subject)
      if (subjectOwner !== undefined && subjectOwner !== userId) throw EmailAuthIdentityConflictError()
      if (subjectOwner === undefined) {
        const owner = singleEmailOwner(await tx.findEmailOwners(key))
        if (owner && owner.id !== userId) throw EmailAuthIdentityConflictError()
        if (provider === 'apple') {
          const legacy = await getLegacyAppleOwner(tx, `${subject}@appleid.apple.com`)
          if (legacy !== undefined && legacy !== userId) throw EmailAuthIdentityConflictError()
        }
      }
      await attachIdentity(tx, userId, provider, subject, email)
    })
  }
}
