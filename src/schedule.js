const { DateTime } = require('luxon');

const DAY_NAMES = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];

function validateTimezone(tz) {
  try {
    const d = DateTime.now().setZone(tz);
    return d.isValid;
  } catch (_e) {
    return false;
  }
}

function hhmmToMinutes(hhmm) {
  const [h, m] = (hhmm || '').split(':').map((v) => parseInt(v, 10));
  if (Number.isNaN(h) || Number.isNaN(m)) return null;
  if (h < 0 || h > 23 || m < 0 || m > 59) return null;
  return h * 60 + m;
}

function minutesToHHMM(mins) {
  const h = Math.floor(mins / 60);
  const m = mins % 60;
  return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
}

function normalizeIntervals(intervals) {
  // Sort, merge overlaps, and clamp to [0, 1440]
  const sorted = intervals
    .filter((iv) => typeof iv.start === 'number' && typeof iv.end === 'number' && iv.start < iv.end)
    .map((iv) => ({ start: Math.max(0, iv.start), end: Math.min(1440, iv.end) }))
    .filter((iv) => iv.start < iv.end)
    .sort((a, b) => a.start - b.start);

  const merged = [];
  for (const iv of sorted) {
    const last = merged[merged.length - 1];
    if (!last || iv.start > last.end) {
      merged.push({ ...iv });
    } else {
      last.end = Math.max(last.end, iv.end);
    }
  }
  return merged;
}

function parseScheduleFromBody(body) {
  const schedule = { version: 1, windowsPerDay: {} };
  for (let d = 0; d < 7; d += 1) {
    const allDay = !!body[`d${d}_all_day`];
    const dayIntervals = [];
    if (allDay) {
      dayIntervals.push({ start: 0, end: 1440 });
    } else {
      for (let r = 1; r <= 3; r += 1) {
        const s = body[`d${d}_r${r}_start`];
        const e = body[`d${d}_r${r}_end`];
        if (s && e) {
          const sm = hhmmToMinutes(s);
          const em = hhmmToMinutes(e);
          if (sm === null || em === null) {
            throw new Error(`Invalid time for ${DAY_NAMES[d]} interval ${r}.`);
          }
          if (sm >= em) {
            throw new Error(`${DAY_NAMES[d]} interval ${r} start must be before end.`);
          }
          dayIntervals.push({ start: sm, end: em });
        }
      }
    }
    schedule.windowsPerDay[d] = normalizeIntervals(dayIntervals);
  }
  return schedule;
}

function isSecretVisibleNow(schedule, timezone) {
  const now = DateTime.now().setZone(timezone);
  if (!now.isValid) return false;
  const day = now.weekday % 7; // Monday=1..Sunday=7 => map to 0..6 with Sunday as 0
  const dayIndex = (day === 0 ? 0 : day); // After modulo, Sunday becomes 0, others keep 1..6
  const minutes = now.hour * 60 + now.minute;
  const intervals = schedule.windowsPerDay[dayIndex] || [];
  for (const iv of intervals) {
    if (minutes >= iv.start && minutes < iv.end) return true;
  }
  return false;
}

function scheduleToDisplayRows(schedule) {
  const rows = [];
  for (let d = 0; d < 7; d += 1) {
    const intervals = schedule.windowsPerDay[d] || [];
    const formatted = intervals.map((iv) => ({ start: minutesToHHMM(iv.start), end: minutesToHHMM(iv.end) }));
    rows.push({ dayIndex: d, dayName: DAY_NAMES[d], intervals: formatted });
  }
  return rows;
}

function buildDefaultExampleSchedule() {
  const schedule = { version: 1, windowsPerDay: {} };
  for (let d = 0; d < 7; d += 1) {
    if (d === 5) {
      // Friday all day visible
      schedule.windowsPerDay[d] = [{ start: 0, end: 1440 }];
    } else {
      // 13:00 - 17:00 visible
      schedule.windowsPerDay[d] = [{ start: 13 * 60, end: 17 * 60 }];
    }
  }
  return schedule;
}

function hasEverEnteredHiddenSinceCreation(createdAtIso, schedule, timezone) {
  const created = DateTime.fromISO(createdAtIso, { zone: 'utc' });
  const nowUtc = DateTime.utc();
  // Scan minute-by-minute up to 14 days or until now, whichever first, to detect the first hidden minute
  // This is conservative but ensures we respect the "lock after first hidden" rule.
  const maxScanMinutes = Math.min(14 * 24 * 60, Math.max(0, Math.floor(nowUtc.diff(created, 'minutes').minutes)));
  for (let i = 0; i <= maxScanMinutes; i += 1) {
    const ts = created.plus({ minutes: i });
    const tsLocal = ts.setZone(timezone);
    const day = tsLocal.weekday % 7;
    const dayIndex = (day === 0 ? 0 : day);
    const minutes = tsLocal.hour * 60 + tsLocal.minute;
    const intervals = schedule.windowsPerDay[dayIndex] || [];
    let visible = false;
    for (const iv of intervals) {
      if (minutes >= iv.start && minutes < iv.end) {
        visible = true;
        break;
      }
    }
    if (!visible) {
      return true;
    }
  }
  // If we scanned the whole range and didn't find hidden, we can also conservatively
  // check whether the schedule is always-visible for a whole week
  let alwaysVisible = true;
  for (let d = 0; d < 7; d += 1) {
    const intervals = schedule.windowsPerDay[d] || [];
    if (!(intervals.length === 1 && intervals[0].start === 0 && intervals[0].end === 1440)) {
      alwaysVisible = false;
      break;
    }
  }
  if (alwaysVisible) return false;
  // If not always visible, it's possible hidden occurs after our scan window
  // but to be safe, treat as not-yet-hidden. Locking will trigger as soon as a hidden state is detected.
  return false;
}

module.exports = {
  DAY_NAMES,
  validateTimezone,
  parseScheduleFromBody,
  isSecretVisibleNow,
  scheduleToDisplayRows,
  buildDefaultExampleSchedule,
  hasEverEnteredHiddenSinceCreation,
};


