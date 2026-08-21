import { StereoChannel } from '../../hooks/useAudioEngine';
import { Ditune2Node } from './Ditune2Node';

/**
 * Isolated experimental registration. Only the runtime type "Ditune2" is
 * intercepted. All existing effect types delegate to the original engine hooks,
 * keeping the backend implementation of Ditune v1 and every other plugin intact.
 */
const TYPE = 'Ditune2';
const MARKER = '__digidawDitune2Registration';

export function ensureDitune2Registered() {
  const proto = StereoChannel.prototype as any;
  const previous = proto[MARKER] as
    | { originalCreate: (...args: any[]) => any; originalUpdate: (...args: any[]) => any }
    | undefined;

  const originalCreate = previous?.originalCreate || proto.createEffectNodes;
  const originalUpdate = previous?.originalUpdate || proto.updateEffectInstance;
  if (typeof originalCreate !== 'function' || typeof originalUpdate !== 'function') {
    console.error('Ditune2 registration failed: StereoChannel effect hooks are unavailable.');
    return;
  }

  proto.createEffectNodes = function createEffectNodesWithDitune2(slot: any) {
    if (slot?.type === TYPE) return [new Ditune2Node(slot.params || {})];
    return originalCreate.call(this, slot);
  };

  proto.updateEffectInstance = function updateEffectInstanceWithDitune2(slot: any, instance: any) {
    if (slot?.type === TYPE) {
      const node = instance?.nodes?.[0];
      if (node instanceof Ditune2Node) node.update(slot.params || {});
      return;
    }
    return originalUpdate.call(this, slot, instance);
  };

  Object.defineProperty(proto, MARKER, {
    value: { originalCreate, originalUpdate },
    configurable: true,
    enumerable: false,
    writable: true,
  });
}

ensureDitune2Registered();
