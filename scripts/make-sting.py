# Pliny's chapter sting: about four seconds, a warm plucked figure that rises and resolves.
# Synthesized from scratch (sine partials with a soft attack and a long tail), so it is ours to use.
import numpy as np
from scipy.io import wavfile
from scipy.signal import fftconvolve

SR = 44100
rng = np.random.default_rng(7)

def pluck(freq, dur, amp=1.0):
    t = np.arange(int(SR * dur)) / SR
    # A mallet-like tone: fundamental plus a few quieter, faster-fading partials.
    tone = sum(a * np.sin(2 * np.pi * freq * m * t) * np.exp(-t * d)
               for m, a, d in [(1, 1.0, 2.2), (2, 0.38, 3.6), (3, 0.16, 5.5), (4.02, 0.07, 8.0)])
    attack = np.minimum(1, t / 0.012)
    return amp * tone * attack

total = 4.4
out = np.zeros(int(SR * total))
# D major, rising then settling on the fifth: D4, A4, D5, F#5, then a soft A4 + D4 underneath.
notes = [(0.00, 293.66, 1.8, 0.80), (0.22, 440.00, 1.8, 0.72), (0.44, 587.33, 2.2, 0.78),
         (0.74, 739.99, 2.6, 0.70), (1.30, 440.00, 2.8, 0.42), (1.30, 146.83, 3.0, 0.50)]
for start, freq, dur, amp in notes:
    n = pluck(freq, dur, amp)
    i = int(SR * start)
    out[i:i + len(n)] += n[:len(out) - i]

# A short, quiet room: decaying noise as an impulse response.
ir_t = np.arange(int(SR * 1.4)) / SR
ir = rng.standard_normal(len(ir_t)) * np.exp(-ir_t * 4.5)
wet = fftconvolve(out, ir)[:len(out)]
out = out + 0.10 * wet / np.max(np.abs(wet)) * np.max(np.abs(out))

# Fade the tail out, leave a breath of silence at each end, and keep it well below full scale
# so it sits under the narrator's level instead of jumping out.
fade = int(SR * 1.2)
out[-fade:] *= np.linspace(1, 0, fade) ** 2
out = np.concatenate([np.zeros(int(SR * 0.35)), out, np.zeros(int(SR * 0.45))])
out = out / np.max(np.abs(out)) * 0.42
wavfile.write('sting.wav', SR, (out * 32767).astype(np.int16))
print('seconds', round(len(out) / SR, 2))
