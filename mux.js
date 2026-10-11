/* 쇼츠공방 MP4 묶음기 — WebCodecs로 만든 영상·소리 조각을 하나의 mp4 파일로 묶는다.
   지원: 영상 avc1(H.264) / vp09(VP9), 소리 mp4a(AAC) / Opus */
(function (root) {
  "use strict";
  function u8(n) { return new Uint8Array([n & 255]); }
  function u16(n) { return new Uint8Array([(n >>> 8) & 255, n & 255]); }
  function u24(n) { return new Uint8Array([(n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
  function u32(n) { return new Uint8Array([(n >>> 24) & 255, (n >>> 16) & 255, (n >>> 8) & 255, n & 255]); }
  function str(s) { const a = new Uint8Array(s.length); for (let i = 0; i < s.length; i++) a[i] = s.charCodeAt(i); return a; }
  function zeros(n) { return new Uint8Array(n); }
  function cat(parts) {
    let len = 0; for (const p of parts) len += p.length;
    const out = new Uint8Array(len); let o = 0; for (const p of parts) { out.set(p, o); o += p.length; } return out;
  }
  function box(type, ...parts) { const body = cat(parts.flat ? parts.flat(Infinity) : parts); return cat([u32(body.length + 8), str(type), body]); }
  function full(type, v, flags, ...parts) { return box(type, u8(v), u24(flags), ...parts); }
  const MATRIX = cat([u32(0x00010000), u32(0), u32(0), u32(0), u32(0x00010000), u32(0), u32(0), u32(0), u32(0x40000000)]);

  function toBytes(x) {
    if (!x) return null;
    if (x instanceof Uint8Array) return x;
    if (x instanceof ArrayBuffer) return new Uint8Array(x);
    if (ArrayBuffer.isView(x)) return new Uint8Array(x.buffer, x.byteOffset, x.byteLength);
    return null;
  }

  class Mp4Muxer {
    constructor(opt) {
      this.v = { codec: opt.video.codec, w: opt.video.width, h: opt.video.height, ts: 90000, samples: [], desc: null };
      this.a = opt.audio ? { codec: opt.audio.codec, rate: opt.audio.sampleRate, ch: opt.audio.numberOfChannels, ts: opt.audio.sampleRate, samples: [], desc: null } : null;
    }
    addVideoChunk(chunk, meta) {
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.v.desc) this.v.desc = toBytes(meta.decoderConfig.description).slice();
      this.v.samples.push({ data: d, t: chunk.timestamp, dur: chunk.duration || 0, key: chunk.type === "key" });
    }
    addAudioChunk(chunk, meta) {
      if (!this.a) return;
      const d = new Uint8Array(chunk.byteLength); chunk.copyTo(d);
      if (meta && meta.decoderConfig && meta.decoderConfig.description && !this.a.desc) this.a.desc = toBytes(meta.decoderConfig.description).slice();
      this.a.samples.push({ data: d, t: chunk.timestamp, dur: chunk.duration || 0, key: true });
    }
    // 원시 바이트로 넣기 (테스트용)
    addRaw(kind, data, tUs, durUs, key, desc) {
      const T = kind === "video" ? this.v : this.a;
      if (desc && !T.desc) T.desc = toBytes(desc).slice();
      T.samples.push({ data: toBytes(data), t: tUs, dur: durUs, key: !!key });
    }
    _deltas(T) {
      const s = T.samples; const out = [];
      for (let i = 0; i < s.length; i++) {
        let d;
        if (i < s.length - 1) d = s[i + 1].t - s[i].t; else d = s[i].dur || (i > 0 ? s[i].t - s[i - 1].t : 33333);
        if (d <= 0) d = s[i].dur || 1;
        out.push(Math.max(1, Math.round(d * T.ts / 1e6)));
      }
      return out;
    }
    _stts(deltas) {
      const runs = [];
      for (const d of deltas) { const r = runs[runs.length - 1]; if (r && r[1] === d) r[0]++; else runs.push([1, d]); }
      return full("stts", 0, 0, u32(runs.length), ...runs.map(r => cat([u32(r[0]), u32(r[1])])));
    }
    _videoEntry() {
      const v = this.v; const isAvc = /^avc1/.test(v.codec);
      const head = cat([zeros(6), u16(1), u16(0), u16(0), zeros(12), u16(v.w), u16(v.h), u32(0x00480000), u32(0x00480000), u32(0), u16(1), zeros(32), u16(0x0018), u16(0xffff)]);
      let child;
      if (isAvc) {
        if (!v.desc) throw new Error("H.264 설정 정보(avcC)가 없어요");
        child = box("avcC", v.desc);
      } else {
        const m = v.codec.split(".");
        const profile = parseInt(m[1] || "0", 10), level = parseInt(m[2] || "40", 10), depth = parseInt(m[3] || "8", 10);
        child = full("vpcC", 1, 0, u8(profile), u8(level), u8((depth << 4) | (1 << 1) | 0), u8(1), u8(1), u8(1), u16(0));
      }
      return box(isAvc ? "avc1" : "vp09", head, child);
    }
    _audioEntry() {
      const a = this.a; const isAac = /^mp4a/.test(a.codec);
      const head = cat([zeros(6), u16(1), zeros(8), u16(a.ch), u16(16), u16(0), u16(0), u32(a.rate << 16 >>> 0)]);
      if (isAac) {
        let asc = a.desc;
        if (!asc || !asc.length) { // AAC-LC 기본 설정 만들기
          const fi = [96000, 88200, 64000, 48000, 44100, 32000, 24000, 22050, 16000, 12000, 11025, 8000, 7350].indexOf(a.rate);
          asc = new Uint8Array([(2 << 3) | (fi >> 1), ((fi & 1) << 7) | (a.ch << 3)]);
        }
        const dsi = cat([u8(0x05), u8(asc.length), asc]);
        const dcd = cat([u8(0x04), u8(13 + dsi.length), u8(0x40), u8(0x15), u24(0), u32(192000), u32(192000), dsi]);
        const sl = cat([u8(0x06), u8(1), u8(2)]);
        const esd = cat([u8(0x03), u8(3 + dcd.length + sl.length), u16(1), u8(0), dcd, sl]);
        return box("mp4a", head, full("esds", 0, 0, esd));
      }
      // Opus: OpusHead(리틀엔디안)에서 pre-skip 읽기
      let preskip = 312, inRate = a.rate;
      if (a.desc && a.desc.length >= 19 && String.fromCharCode(...a.desc.slice(0, 8)) === "OpusHead") {
        preskip = a.desc[10] | (a.desc[11] << 8);
        inRate = (a.desc[12] | (a.desc[13] << 8) | (a.desc[14] << 16) | (a.desc[15] << 24)) >>> 0;
      }
      const dops = box("dOps", u8(0), u8(a.ch), u16(preskip), u32(inRate), u16(0), u8(0));
      return box("Opus", head, dops);
    }
    _trak(id, kind, entry, T, offsets, movieDurMs) {
      const deltas = this._deltas(T);
      const dur = deltas.reduce((x, y) => x + y, 0);
      const isV = kind === "video";
      const tkhd = full("tkhd", 0, 3, u32(0), u32(0), u32(id), u32(0), u32(movieDurMs), zeros(8), u16(0), u16(0), u16(isV ? 0 : 0x0100), u16(0), MATRIX,
        u32(isV ? (this.v.w << 16) >>> 0 : 0), u32(isV ? (this.v.h << 16) >>> 0 : 0));
      const mdhd = full("mdhd", 0, 0, u32(0), u32(0), u32(T.ts), u32(dur), u16(0x55c4), u16(0));
      const hdlr = full("hdlr", 0, 0, u32(0), str(isV ? "vide" : "soun"), zeros(12), str(isV ? "VideoHandler\0" : "SoundHandler\0"));
      const mhd = isV ? full("vmhd", 0, 1, u16(0), u16(0), u16(0), u16(0)) : full("smhd", 0, 0, u16(0), u16(0));
      const dinf = box("dinf", full("dref", 0, 0, u32(1), full("url ", 0, 1)));
      const stsd = full("stsd", 0, 0, u32(1), entry);
      const stsc = full("stsc", 0, 0, u32(1), u32(1), u32(1), u32(1));
      const stsz = full("stsz", 0, 0, u32(0), u32(T.samples.length), ...T.samples.map(s => u32(s.data.length)));
      const stco = full("stco", 0, 0, u32(offsets.length), ...offsets.map(o => u32(o)));
      const parts = [stsd, this._stts(deltas)];
      if (isV) {
        const keys = []; T.samples.forEach((s, i) => { if (s.key) keys.push(i + 1); });
        if (keys.length && keys.length < T.samples.length) parts.push(full("stss", 0, 0, u32(keys.length), ...keys.map(k => u32(k))));
      }
      parts.push(stsc, stsz, stco);
      const stbl = box("stbl", ...parts);
      return box("trak", tkhd, box("mdia", mdhd, hdlr, box("minf", mhd, dinf, stbl)));
    }
    finalize() {
      if (!this.v.samples.length) throw new Error("영상 조각이 없어요");
      const ftyp = box("ftyp", str("isom"), u32(0x200), str("isom"), str("iso2"), str(/^avc1/.test(this.v.codec) ? "avc1" : "iso6"), str("mp41"));
      const tracks = [this.v]; if (this.a && this.a.samples.length) tracks.push(this.a);
      let dataLen = 0; for (const T of tracks) for (const s of T.samples) dataLen += s.data.length;
      const mdatHead = cat([u32(dataLen + 8), str("mdat")]);
      let off = ftyp.length + mdatHead.length; const offs = [];
      for (const T of tracks) { const o = []; for (const s of T.samples) { o.push(off); off += s.data.length; } offs.push(o); }
      const durMs = Math.round(Math.max(...tracks.map(T => { const d = this._deltas(T).reduce((x, y) => x + y, 0); return d / T.ts * 1000; })));
      const traks = [this._trak(1, "video", this._videoEntry(), this.v, offs[0], durMs)];
      if (tracks[1]) traks.push(this._trak(2, "audio", this._audioEntry(), this.a, offs[1], durMs));
      const mvhd = full("mvhd", 0, 0, u32(0), u32(0), u32(1000), u32(durMs), u32(0x00010000), u16(0x0100), zeros(10), MATRIX, zeros(24), u32(tracks.length + 1));
      const moov = box("moov", mvhd, ...traks);
      const parts = [ftyp, mdatHead]; for (const T of tracks) for (const s of T.samples) parts.push(s.data); parts.push(moov);
      return parts; // Blob([...parts]) 로 만들기
    }
  }
  root.SGMp4Muxer = Mp4Muxer;
  if (typeof module !== "undefined") module.exports = Mp4Muxer;
})(typeof window !== "undefined" ? window : globalThis);
