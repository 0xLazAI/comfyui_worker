import { randomBytes } from 'crypto';
import rTracer from 'cls-rtracer';
import { createLogger, format, transports } from 'winston';

const { combine, errors, prettyPrint, printf, splat, timestamp } = format;
const instanceId = randomBytes(3).toString('hex');

const lineFormat = printf(({ level, message, timestamp: time }) => {
  return `${time} ${level} ${instanceId} ${rTracer.id() || ''} ${message}`;
});

export const logger = createLogger({
  level: 'debug',
  format: combine(errors({ stack: true }), prettyPrint(), splat(), timestamp(), lineFormat),
  transports: [new transports.Console()],
});

export function currentRequestId(): string | undefined {
  const value = rTracer.id();
  return value ? String(value) : undefined;
}
