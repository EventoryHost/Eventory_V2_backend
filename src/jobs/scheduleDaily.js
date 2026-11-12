const DAY_MS = 24 * 60 * 60 * 1000;
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

export const runHourIst = (value, fallback) => {
  const hour = Number(value);
  return value !== undefined && value !== "" && Number.isInteger(hour) && hour >= 0 && hour <= 23
    ? hour
    : fallback;
};

export const msUntilNextRun = (hourIst, now = Date.now()) => {
  const istNow = now + IST_OFFSET_MS;
  const todayRun = istNow - (istNow % DAY_MS) + hourIst * 60 * 60 * 1000;
  const next = todayRun > istNow ? todayRun : todayRun + DAY_MS;
  return next - istNow;
};

export function scheduleDaily(run, hourIst) {
  const scheduleNext = () => {
    const timer = setTimeout(async () => {
      await run();
      scheduleNext();
    }, msUntilNextRun(hourIst));
    timer.unref();
  };

  run();
  scheduleNext();
}
