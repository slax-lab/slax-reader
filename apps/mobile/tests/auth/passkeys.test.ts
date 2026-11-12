import test from 'node:test';
import assert from 'node:assert/strict';
import {loginWithPasskey, registerPasskey} from '../../src/auth/passkeys.ts';

const options = {challenge: 'challenge', rpId: 'reader.test'};
const credential = {id: 'credential', rawId: 'credential', type: 'public-key', response: {}} as any;

test('mailbox-first login uses server options and the existing login endpoint', async () => {
  const calls: unknown[] = [], signal = new AbortController().signal;
  const result = await loginWithPasskey({email: 'reader@example.com', signal, isCurrent: () => true,
    api: {getPasskeyLoginChallenge: async (email, received) => {calls.push([email, received]); return {purpose: 'login', request_id: 'request', options} as any;},
      loginPasskey: async (body, received) => {calls.push([body, received]); return {token: 'token', user_id: 'owner'};}},
    native: {authenticate: async received => {assert.equal(received, options); return credential;}}});
  assert.deepEqual(result, {token: 'token', user_id: 'owner'});
  assert.deepEqual(calls, [['reader@example.com', signal], [{type: 'passkey', email: 'reader@example.com', request_id: 'request', credential}, signal]]);
});

test('cancelled or replaced native login cannot dispatch session completion', async () => {
  for (const cancelled of [true, false]) {
    let current = true, completed = false;
    const result = await loginWithPasskey({email: 'reader@example.com', signal: new AbortController().signal, isCurrent: () => current,
      api: {getPasskeyLoginChallenge: async () => ({request_id: 'request', options}) as any, loginPasskey: async () => {completed = true; return {token: 'bad', user_id: 'bad'};}},
      native: {authenticate: async () => {current = cancelled; return cancelled ? null : credential;}}});
    assert.equal(result, null); assert.equal(completed, false);
  }
});

test('registration sends credential to server only while its account owner remains current', async () => {
  let current = true, registered = false;
  const result = await registerPasskey({name: 'iPhone', signal: new AbortController().signal, isCurrent: () => current,
    api: {getPasskeyRegistrationChallenge: async () => ({request_id: 'request', options}) as any, registerPasskey: async () => {registered = true; return {linked: true};}},
    native: {register: async () => {current = false; return credential;}}});
  assert.equal(result, false); assert.equal(registered, false);
});
