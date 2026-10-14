import {useCallback, useMemo, useState} from 'react';
import {NoticeReadGate, noticeGeometryScript} from './notice-read-gate';

export type NoticeObserver = (kind: string, data: object, gate: ReturnType<NoticeReadGate['inspect']>) => void;

export function useDeleteNotice(noticeUrl: string, localDocument: boolean, observe?: NoticeObserver) {
  const gate = useMemo(() => new NoticeReadGate(noticeUrl, localDocument), [noticeUrl, localDocument]);
  const [reading, setReading] = useState({gate, read: false});
  const publish = useCallback((read: boolean) => setReading({gate, read}), [gate]);
  const record = useCallback((kind: string, data: object = {}) => {
    observe?.(kind, data, gate.inspect());
  }, [gate, observe]);

  return {
    gate,
    read: reading.gate === gate && reading.read,
    reset(failed = false) {
      if (failed) gate.fail(); else gate.beginLoad();
      record(failed ? 'load-error' : 'load-start');
      publish(false);
    },
    loaded(url: string): string | null {
      const generation = gate.loadSucceeded(url);
      record('load-success', {url, generation});
      return generation === null ? null : noticeGeometryScript(generation);
    },
    message(url: string, data: string) {
      try {
        const geometry = JSON.parse(data);
        publish(gate.documentGeometry(url, geometry));
        record('document-geometry', {url, geometry});
      } catch {
        record('invalid-document-geometry');
      }
    },
    scroll(height: number, visible: number, y: number) {
      publish(gate.nativeGeometry(height, visible, y));
      record('native-geometry', {height, visible, y});
    },
    allows: (url: string) => gate.allows(url),
  };
}
