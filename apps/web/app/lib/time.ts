export const EAT_TIME_ZONE = "Africa/Kampala";

const dateTimeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: EAT_TIME_ZONE,
  year: "numeric",
  month: "short",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const timeFormatter = new Intl.DateTimeFormat("en-GB", {
  timeZone: EAT_TIME_ZONE,
  hour: "2-digit",
  minute: "2-digit",
  hour12: false
});

const inputDateFormatter = new Intl.DateTimeFormat("en-CA", {
  timeZone: EAT_TIME_ZONE,
  year: "numeric",
  month: "2-digit",
  day: "2-digit"
});

function toValidDate(value: string | Date | null | undefined): Date | null {
  if (!value) {
    return null;
  }

  const date = value instanceof Date ? value : new Date(value);
  return Number.isNaN(date.getTime()) ? null : date;
}

export function formatEatDateTime(value: string | Date | null | undefined, fallback = "Not set"): string {
  const date = toValidDate(value);
  return date ? `${dateTimeFormatter.format(date)} EAT` : fallback;
}

export function formatEatTime(value: string | Date | null | undefined, fallback = "Not set"): string {
  const date = toValidDate(value);
  return date ? `${timeFormatter.format(date)} EAT` : fallback;
}

export function dateOnlyToEatEndOfDayIso(value: string): string {
  return new Date(`${value}T23:59:59+03:00`).toISOString();
}

export function dateTimeLocalToEatIso(value: string): string | undefined {
  if (!value) {
    return undefined;
  }

  const withSeconds = value.length === 16 ? `${value}:00` : value;
  return new Date(`${withSeconds}+03:00`).toISOString();
}

export function eatInputDateValue(date = new Date()): string {
  const parts = inputDateFormatter.formatToParts(date);
  const values = Object.fromEntries(parts.map((part) => [part.type, part.value]));
  return `${values.year}-${values.month}-${values.day}`;
}

export function addDaysEatInputValue(days: number): string {
  return eatInputDateValue(new Date(Date.now() + days * 24 * 60 * 60 * 1000));
}

export function todayEatInputValue(): string {
  return eatInputDateValue();
}
