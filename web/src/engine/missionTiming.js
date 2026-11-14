export const DAY_MS = 86400000;

export function changePeriod(mission, period) {
  if (mission.period === period) return mission;
  return { ...mission, period, fromMs: null, toMs: null };
}

export function resolveMission(mission, periods) {
  if (mission.period === "next12") {
    const [fromMs, toMs] = periods.next12;
    return { ...mission, fromMs, toMs };
  }
  if (mission.period === "fixed" && mission.fromMs != null && mission.durationDays != null) {
    return { ...mission, toMs: mission.fromMs + mission.durationDays * DAY_MS };
  }
  return mission;
}

function missingTiming({ period, fromMs, toMs, durationDays }) {
  if (!period) return "Choose how to set the landing date.";
  if (period === "search") return "Choose a search range.";
  if (period === "fixed" && fromMs == null) return "Enter the landing date.";
  if (period === "custom" && (fromMs == null || toMs == null)) return "Enter the start and end dates.";
  return durationDays == null ? "Set the time on the surface." : null;
}

function missionProblem(mission, [first, last]) {
  const { fromMs, toMs, durationDays } = mission;
  if (!(toMs > fromMs)) return "The end date must be after the start date.";
  if (fromMs < first) return `Ephemeris starts on ${new Date(first).toISOString().slice(0, 10)}.`;
  if (toMs > last) return `Ephemeris ends on ${new Date(last).toISOString().slice(0, 10)}.`;
  if (toMs - fromMs < durationDays * DAY_MS) return `A ${durationDays}-day mission does not fit in this period.`;
  return null;
}

export function validateTiming(mission, periods) {
  const timingMissing = missingTiming(mission);
  return { timingMissing, problem: timingMissing ? null : missionProblem(mission, periods.range) };
}
