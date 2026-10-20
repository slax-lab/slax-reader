import React from 'react';
import {createLiveActivity, type LiveActivityFactory} from 'expo-widgets';
import {Text, VStack} from '@expo/ui/swift-ui';
import type {ActivityPayload, ActivityPort} from './controller.ts';

const activityName = 'SlaxReadingSessionActivity';

function layout(state: ActivityPayload, environment: {isStale?: boolean}) {
  const stale = state.stale || environment.isStale;
  const count = `${state.readCount}/${state.goal}`;
  const status = stale ? 'Reading session may be out of date' : 'Reading session';
  return {
    banner: <VStack alignment="leading" spacing={4}><Text>{status}</Text><Text>{count} articles opened</Text></VStack>,
    compactLeading: <Text>{state.readCount}</Text>,
    compactTrailing: <Text>/{state.goal}</Text>,
    minimal: <Text>{state.readCount}</Text>,
    expandedCenter: <VStack alignment="leading" spacing={4}><Text>{status}</Text><Text>{count} articles opened</Text></VStack>,
  };
}

type ActivityFactory = LiveActivityFactory<ActivityPayload>;
type ActivityInstance = ReturnType<ActivityFactory['getInstances']>[number];

/** Thin adapter over Expo's public local Live Activity API; no push tokens are requested. */
export function createReadingActivityPort(factory: ActivityFactory, supported: () => boolean): ActivityPort {
  const instances = new Map<string, ActivityInstance>();
  const find = (id: string) => {
    let activity = instances.get(id);
    if (!activity) {
      activity = factory.getInstances().find(item => item.getId() === id);
      if (activity) instances.set(id, activity);
    }
    if (!activity) throw new Error('Reading activity is no longer available');
    return activity;
  };
  return {
    supported,
    async start(payload) {
      const activity = factory.start(payload, undefined, new Date(payload.staleAt));
      const id = activity.getId();
      instances.set(id, activity);
      return id;
    },
    async update(id, payload) {await find(id).update(payload, new Date(payload.staleAt));},
    async end(id, payload) {await find(id).end('immediate', payload, new Date()); instances.delete(id);},
  };
}

export function createReadingActivityFactory() {
  return createLiveActivity<ActivityPayload>(activityName, layout);
}
