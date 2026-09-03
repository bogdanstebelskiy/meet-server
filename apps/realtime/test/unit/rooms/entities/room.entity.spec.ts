import { Room } from '../../../../src/rooms/entities/room.entity';
import { Peer } from '../../../../src/rooms/entities/peer.entity';

describe('Room', () => {
  const fakeRouter = () => ({ close: jest.fn() }) as any;
  const fakeWorker = () => ({}) as any;

  it('adds and removes peers, tracking isEmpty()', () => {
    const room = new Room('room-1', fakeRouter(), fakeWorker());
    const peer = new Peer('peer-1', 'Alice');

    room.addPeer(peer);
    expect(room.peers.get('peer-1')).toBe(peer);
    expect(room.isEmpty()).toBe(false);

    room.removePeer('peer-1');
    expect(room.peers.has('peer-1')).toBe(false);
    expect(room.isEmpty()).toBe(true);
  });

  it('removePeer is a no-op for an unknown peer id, not a throw', () => {
    const room = new Room('room-1', fakeRouter(), fakeWorker());

    expect(() => room.removePeer('missing')).not.toThrow();
  });

  it('removePeer closes the peer so its transports/producers/consumers cascade-close', () => {
    const room = new Room('room-1', fakeRouter(), fakeWorker());
    const peer = new Peer('peer-1', 'Alice');
    const closeSpy = jest.fn();
    peer.close = closeSpy;
    room.addPeer(peer);

    room.removePeer('peer-1');

    expect(closeSpy).toHaveBeenCalledTimes(1);
  });

  it('getOtherPeers excludes the given peer id', () => {
    const room = new Room('room-1', fakeRouter(), fakeWorker());
    const peer1 = new Peer('peer-1', 'Alice');
    const peer2 = new Peer('peer-2', 'Bob');
    room.addPeer(peer1);
    room.addPeer(peer2);

    expect(room.getOtherPeers('peer-1')).toEqual([peer2]);
  });

  it('getOtherPeers returns everyone when the given id is not in the room', () => {
    const room = new Room('room-1', fakeRouter(), fakeWorker());
    const peer1 = new Peer('peer-1', 'Alice');
    room.addPeer(peer1);

    expect(room.getOtherPeers('never-joined')).toEqual([peer1]);
  });

  it('close() closes the router', () => {
    const router = fakeRouter();
    const room = new Room('room-1', router, fakeWorker());

    room.close();

    expect(router.close).toHaveBeenCalledTimes(1);
  });
});
