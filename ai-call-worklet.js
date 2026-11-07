/* Capture mono PCM on the audio thread. Outputs remain silent: no microphone feedback. */
class DeskTalkCallCapture extends AudioWorkletProcessor {
  constructor() { super(); this.buffer = new Float32Array(4096); this.offset = 0; }
  process(inputs) {
    const channel = inputs[0]?.[0];
    if (channel) for (let i = 0; i < channel.length; i++) {
      this.buffer[this.offset++] = channel[i];
      if (this.offset === this.buffer.length) {
        this.port.postMessage(this.buffer, [this.buffer.buffer]);
        this.buffer = new Float32Array(4096); this.offset = 0;
      }
    }
    return true;
  }
}
registerProcessor("desktalk-call-capture", DeskTalkCallCapture);
