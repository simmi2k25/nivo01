import type { Socket } from 'socket.io-client';

type Peer = { pc: RTCPeerConnection; initiator: boolean; pending: RTCIceCandidateInit[]; stream: MediaStream };
type Signal = { sdp?: RTCSessionDescriptionInit; candidate?: RTCIceCandidateInit };

/**
 * Full mesh between booth participants. The newcomer initiates offers to everyone already there,
 * so two sides never offer at once. Video goes device-to-device; the server only relays signaling.
 */
export class Mesh {
  private peers = new Map<number, Peer>();
  private closed = false;

  constructor(
    private code: string,
    private socket: Socket,
    private iceServers: RTCIceServer[],
    private local: MediaStream | null,
    private onStream: (userId: number, stream: MediaStream | null) => void,
  ) {}

  private send(to: number, data: Signal) {
    this.socket.emit('booth:signal', { code: this.code, to, data });
  }

  private create(userId: number, initiator: boolean) {
    this.remove(userId);
    const pc = new RTCPeerConnection({ iceServers: this.iceServers });
    const peer: Peer = { pc, initiator, pending: [], stream: new MediaStream() };
    this.peers.set(userId, peer);

    if (this.local) for (const t of this.local.getTracks()) pc.addTrack(t, this.local);
    else {
      // No camera: still receive everyone else's video.
      pc.addTransceiver('video', { direction: 'recvonly' });
      pc.addTransceiver('audio', { direction: 'recvonly' });
    }

    pc.onicecandidate = (e) => e.candidate && this.send(userId, { candidate: e.candidate.toJSON() });
    pc.ontrack = (e) => {
      if (!peer.stream.getTracks().includes(e.track)) peer.stream.addTrack(e.track);
      this.onStream(userId, peer.stream);
    };
    pc.onconnectionstatechange = () => {
      // If a connection fails, the initiator restarts ICE automatically.
      if (pc.connectionState === 'failed' && peer.initiator && !this.closed) this.offer(userId, true);
    };
    return peer;
  }

  private async offer(userId: number, iceRestart = false) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    const offer = await peer.pc.createOffer({ iceRestart });
    await peer.pc.setLocalDescription(offer);
    this.send(userId, { sdp: peer.pc.localDescription!.toJSON() });
  }

  /** We just joined: call everyone who's already in the booth. */
  connectTo(userId: number) {
    this.create(userId, true);
    this.offer(userId).catch((e) => console.warn('[rtc] offer failed', e));
  }

  async handleSignal(from: number, data: Signal) {
    if (this.closed) return;
    let peer = this.peers.get(from);
    try {
      if (data.sdp) {
        if (data.sdp.type === 'offer') {
          if (!peer || peer.initiator) peer = this.create(from, false);
          await peer.pc.setRemoteDescription(data.sdp);
          const answer = await peer.pc.createAnswer();
          await peer.pc.setLocalDescription(answer);
          this.send(from, { sdp: peer.pc.localDescription!.toJSON() });
        } else if (peer) {
          await peer.pc.setRemoteDescription(data.sdp);
        }
        if (peer) {
          for (const c of peer.pending.splice(0)) await peer.pc.addIceCandidate(c).catch(() => {});
        }
      } else if (data.candidate && peer) {
        if (peer.pc.remoteDescription) await peer.pc.addIceCandidate(data.candidate).catch(() => {});
        else peer.pending.push(data.candidate);
      }
    } catch (e) {
      console.warn('[rtc] signal failed', e);
    }
  }

  remove(userId: number) {
    const peer = this.peers.get(userId);
    if (!peer) return;
    peer.pc.close();
    this.peers.delete(userId);
    this.onStream(userId, null);
  }

  /** Swaps the camera (front/back) on every connection without renegotiating. */
  async replaceVideo(track: MediaStreamTrack) {
    await Promise.all(
      [...this.peers.values()].map((p) => p.pc.getSenders().find((s) => s.track?.kind === 'video')?.replaceTrack(track)),
    );
  }

  setLocal(stream: MediaStream | null) {
    this.local = stream;
  }

  close() {
    this.closed = true;
    for (const id of [...this.peers.keys()]) this.remove(id);
  }
}
