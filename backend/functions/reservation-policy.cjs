const MAX_PENDING_RESERVATIONS = 5;
const HOLD_DURATION_MS = 24 * 60 * 60 * 1000;

// Include legacy spellings as well as current canonical writes.
const PENDING_STATUSES = ['Pending', 'pending', 'Waiting List', 'waiting list', 'Waitlisted', 'waitlisted', 'waiting-list'];
const EXPIRABLE_STATUSES = [...PENDING_STATUSES, 'Accepted', 'accepted', 'Confirmed', 'confirmed', 'Ongoing', 'ongoing'];

function timestampMillis(value) {
  if (typeof value?.toMillis === 'function') return value.toMillis();
  if (value instanceof Date) return value.getTime();
  if (Number.isFinite(value?.seconds)) return value.seconds * 1000 + (value.nanoseconds || 0) / 1e6;
  if (typeof value === 'number') return value;
  return typeof value === 'string' ? Date.parse(value) : NaN;
}

module.exports = { MAX_PENDING_RESERVATIONS, HOLD_DURATION_MS, PENDING_STATUSES, EXPIRABLE_STATUSES, timestampMillis };
