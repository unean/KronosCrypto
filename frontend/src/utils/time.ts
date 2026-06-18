const TIMEZONE_PATTERN = /(?:Z|[+-]\d{2}:?\d{2})$/;

export function parseApiTime(value: string) {
  return new Date(TIMEZONE_PATTERN.test(value) ? value : `${value}Z`);
}

export function formatApiTime(value: string) {
  return parseApiTime(value).toLocaleString();
}

export function toUnixSeconds(value: string) {
  return Math.floor(parseApiTime(value).getTime() / 1000);
}

export function formatUnixSecondsLocal(value: number) {
  return new Date(value * 1000).toLocaleString(undefined, {
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}
