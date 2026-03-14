type RandomGenerator = () => number;

export const mean = (values: number[]) => values.reduce((sum, value) => sum + value, 0) / Math.max(values.length, 1);

export const variance = (values: number[]) => {
  const avg = mean(values);

  return mean(values.map((value) => (value - avg) ** 2));
};

export const standardDeviation = (values: number[]) => Math.sqrt(variance(values));

export const clamp = (value: number, min: number, max: number) => Math.min(max, Math.max(min, value));

export const americanToDecimalOdds = (americanOdds: number) => {
  if (americanOdds > 0) {
    return americanOdds / 100 + 1;
  }

  return 100 / Math.abs(americanOdds) + 1;
};

export const americanToImpliedProbability = (odds: number) => {
  if (odds > 0) {
    return 100 / (odds + 100);
  }

  return Math.abs(odds) / (Math.abs(odds) + 100);
};

export const expectedValue = (winProbability: number, americanOdds: number) => {
  const decimalOdds = americanToDecimalOdds(americanOdds);
  const profitIfWin = decimalOdds - 1;

  return winProbability * profitIfWin - (1 - winProbability);
};

export const kellyFraction = (winProbability: number, americanOdds: number) => {
  const b = americanToDecimalOdds(americanOdds) - 1;

  if (b <= 0) {
    return 0;
  }

  const q = 1 - winProbability;

  return clamp((b * winProbability - q) / b, 0, 0.12);
};

export const zScore = (value: number, avg: number, stdDev: number) => {
  if (stdDev === 0) {
    return 0;
  }

  return (value - avg) / stdDev;
};

const erf = (value: number) => {
  const sign = value < 0 ? -1 : 1;
  const absolute = Math.abs(value);
  const a1 = 0.254829592;
  const a2 = -0.284496736;
  const a3 = 1.421413741;
  const a4 = -1.453152027;
  const a5 = 1.061405429;
  const p = 0.3275911;
  const t = 1 / (1 + p * absolute);
  const y = 1 - (((((a5 * t + a4) * t + a3) * t + a2) * t + a1) * t * Math.exp(-absolute * absolute));

  return sign * y;
};

export const normalCdf = (value: number, avg: number, stdDev: number) => {
  if (stdDev <= 0) {
    return value < avg ? 0 : 1;
  }

  return 0.5 * (1 + erf((value - avg) / (stdDev * Math.sqrt(2))));
};

export const normalizedProbabilities = (odds: number[]) => {
  const implied = odds.map(americanToImpliedProbability);
  const total = implied.reduce((sum, value) => sum + value, 0);

  if (total === 0) {
    return implied.map(() => 0);
  }

  return implied.map((value) => value / total);
};

const hashString = (value: string) => {
  let hash = 2166136261;

  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }

  return hash >>> 0;
};

const createSeededRandom = (seed: string): RandomGenerator => {
  let state = hashString(seed) || 1;

  return () => {
    state ^= state << 13;
    state ^= state >>> 17;
    state ^= state << 5;

    return ((state >>> 0) % 1_000_000) / 1_000_000;
  };
};

const sampleStandardNormal = (random: RandomGenerator) => {
  const first = Math.max(random(), 1e-9);
  const second = Math.max(random(), 1e-9);

  return Math.sqrt(-2 * Math.log(first)) * Math.cos(2 * Math.PI * second);
};

export const monteCarloWinRate = ({
  seed,
  iterations,
  meanValue,
  stdDev,
  comparator,
}: {
  seed: string;
  iterations: number;
  meanValue: number;
  stdDev: number;
  comparator: (sample: number) => boolean;
}) => {
  const random = createSeededRandom(seed);
  let wins = 0;

  for (let index = 0; index < iterations; index += 1) {
    const sample = meanValue + sampleStandardNormal(random) * Math.max(stdDev, 0.001);

    if (comparator(sample)) {
      wins += 1;
    }
  }

  return wins / iterations;
};