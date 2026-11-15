import { useCallback, useEffect, useRef, useState } from 'react';
import { freqToMidiAndCents, midiToFreq } from '../data/ocarinaData';
import { PitchReading } from '../types/ocarina';
import { detectPitchYIN } from '../utils/pitchDetector';

const EMPTY_READING: PitchReading = {
  frequency: null,
  midi: null,
  exactMidi: null,
  noteName: '—',
  cents: 0,
  clarity: 0,
  rms: 0,
};

export function useMicrophonePitch() {
  const [isListening, setIsListening] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reading, setReading] = useState<PitchReading>(EMPTY_READING);
  const [demoMidi, setDemoMidi] = useState<number | null>(null);
  const [demoCentsOffset, setDemoCentsOffset] = useState<number>(0);

  const ctxRef = useRef<AudioContext | null>(null);
  const streamRef = useRef<MediaStream | null>(null);
  const analyserRef = useRef<AnalyserNode | null>(null);
  const rafRef = useRef<number | null>(null);
  const bufferRef = useRef<Float32Array<ArrayBuffer> | null>(null);
  const historyRef = useRef<number[]>([]);

  const stopMic = useCallback(() => {
    if (rafRef.current !== null) {
      cancelAnimationFrame(rafRef.current);
      rafRef.current = null;
    }
    if (streamRef.current) {
      streamRef.current.getTracks().forEach((t) => t.stop());
      streamRef.current = null;
    }
    if (ctxRef.current) {
      ctxRef.current.close().catch(() => {});
      ctxRef.current = null;
    }
    analyserRef.current = null;
    historyRef.current = [];
    setIsListening(false);
    setDemoMidi(null);
    setReading(EMPTY_READING);
  }, []);

  const startMic = useCallback(async () => {
    setError(null);
    setDemoMidi(null);
    try {
      if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setError('Microphone access is not available in this browser context (requires HTTPS or localhost).');
        return false;
      }
      const stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          echoCancellation: false,
          noiseSuppression: false,
          autoGainControl: false,
        },
      });
      const AudioCtx = window.AudioContext || (window as unknown as { webkitAudioContext: typeof AudioContext }).webkitAudioContext;
      const ctx = new AudioCtx();
      if (ctx.state === 'suspended') {
        await ctx.resume();
      }
      const source = ctx.createMediaStreamSource(stream);
      const analyser = ctx.createAnalyser();
      analyser.fftSize = 2048;
      analyser.smoothingTimeConstant = 0.0;
      source.connect(analyser);

      ctxRef.current = ctx;
      streamRef.current = stream;
      analyserRef.current = analyser;
      bufferRef.current = new Float32Array(analyser.fftSize);
      setIsListening(true);

      const loop = () => {
        if (!analyserRef.current || !bufferRef.current || !ctxRef.current) return;
        analyserRef.current.getFloatTimeDomainData(bufferRef.current);
        const res = detectPitchYIN(bufferRef.current, ctxRef.current.sampleRate, {
          minFreq: 130,
          maxFreq: 2800,
          threshold: 0.14,
          rmsThreshold: 0.012,
        });

        if (res.frequency !== null && res.clarity > 0.65) {
          // Light 3-sample median/EMA smoothing for steady display
          historyRef.current.push(res.frequency);
          if (historyRef.current.length > 4) historyRef.current.shift();
          const sorted = [...historyRef.current].sort((a, b) => a - b);
          const smoothFreq = sorted[Math.floor(sorted.length / 2)];
          const mapped = freqToMidiAndCents(smoothFreq);
          setReading({
            ...res,
            frequency: smoothFreq,
            midi: mapped.midi,
            exactMidi: mapped.exactMidi,
            cents: mapped.cents,
            noteName: mapped.noteName,
          });
        } else {
          setReading((prev) => ({
            ...EMPTY_READING,
            rms: res.rms,
            clarity: res.clarity,
            // keep last rms for volume bar responsiveness
            noteName: prev.rms > 0.012 ? '…' : '—',
          }));
        }
        rafRef.current = requestAnimationFrame(loop);
      };
      rafRef.current = requestAnimationFrame(loop);
      return true;
    } catch (err) {
      const msg =
        err instanceof Error
          ? err.message
          : 'Permission denied or microphone unavailable.';
      setError(`Mic error: ${msg}. You can also use Demo Pitch Mode to test without a mic!`);
      setIsListening(false);
      return false;
    }
  }, []);

  // Demo simulated pitch mode for quiet environments or no-mic preview
  useEffect(() => {
    if (demoMidi === null) return;
    const freq = midiToFreq(demoMidi) * Math.pow(2, demoCentsOffset / 1200);
    const mapped = freqToMidiAndCents(freq);
    setReading({
      frequency: freq,
      midi: mapped.midi,
      exactMidi: mapped.exactMidi,
      noteName: mapped.noteName,
      cents: mapped.cents,
      clarity: 0.96,
      rms: 0.18,
    });
  }, [demoMidi, demoCentsOffset]);

  useEffect(() => {
    return () => {
      stopMic();
    };
  }, [stopMic]);

  return {
    isListening,
    isDemoActive: demoMidi !== null,
    error,
    reading,
    startMic,
    stopMic,
    triggerDemoNote: (midi: number | null, centsOffset = 0) => {
      if (midi === null) {
        setDemoMidi(null);
        if (!isListening) setReading(EMPTY_READING);
      } else {
        setDemoMidi(midi);
        setDemoCentsOffset(centsOffset);
      }
    },
  };
}
