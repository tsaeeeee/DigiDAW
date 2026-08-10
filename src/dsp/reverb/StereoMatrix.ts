/**
 * Mid/Side Encoding/Decoding and Stereo Width Matrix
 */
export class StereoMatrix {
  /**
   * Convert Mid/Side mode input
   */
  public processInputMode(inL: number, inR: number, mode: number): { l: number; r: number } {
    if (mode === 1) {
      // Side focus: extract stereo difference signal
      const side = (inL - inR) * 0.7071;
      return { l: side, r: -side };
    }
    return { l: inL, r: inR };
  }

  /**
   * Adjust stereo separation/width (-100% = Mono, 0% = Normal, +100% = Extra Wide)
   */
  public applyStereoSeparation(outL: number, outR: number, separationPct: number): { l: number; r: number } {
    const normSep = Math.max(-1, Math.min(1, separationPct / 100));
    
    // Mid and Side components
    const mid = (outL + outR) * 0.5;
    const side = (outL - outR) * 0.5;

    // Scale Side component: 1 + normSep (0 = mono when normSep=-1, 1 when normSep=0, 2 when normSep=+1)
    const sideGain = Math.max(0, 1.0 + normSep);

    const newSide = side * sideGain;

    return {
      l: mid + newSide,
      r: mid - newSide,
    };
  }
}
