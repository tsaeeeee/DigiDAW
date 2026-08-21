# Ditune2 detector v0.2

This pass fixes two real-vocal failure modes from v0.1:

1. The detector previously kept only every fourth raw sample before YIN analysis. Real vocal harmonics could alias into the F0 band and lower confidence even when synthetic sine tests passed. v0.2 box-averages four source samples before 4:1 decimation and uses a longer 1024-sample analysis window with a fixed YIN comparison length.
2. A single rejected YIN frame previously made the pitch shifter immediately target unity ratio. v0.2 holds the last stable voiced correction for about 105 ms across normal consonant/breath gaps, then releases smoothly if voiced pitch does not return.

v0.2 also exposes input RMS, detector quality, analysis-ready state and voiced-hold time to browser telemetry so failures can be localized without guessing.