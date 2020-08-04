import winston from "winston";

/**
 * The current environment simplified to either dev or prod only. If NODE_ENV is not set to dev we are assumed to be in
 * production
 */
const environment = process.env.NODE_ENV === 'dev' ? 'dev' : 'prod';
/**
 * The current date at the time this file is loaded
 */
const now = new Date();
/**
 * The {@link now} value formatted as a Y-M-D string
 */
const nowString = `${now.getUTCFullYear()}-${now.getUTCMonth()}-${now.getUTCDay()}`;

/**
 * Constructs a logger either at the info or debug level in the logs folder. If in a development environment, it will
 * add a transport to log to the console.
 */
const logger = winston.createLogger({
    level: environment === 'dev' ? 'debug' : 'info',
    transports: [
        new winston.transports.File({
            dirname: 'logs',
            filename: `summary-${environment}.${nowString}.log`,
            format: winston.format.json(),
        }),
        ...(environment === 'prod' ? [] : [
            new winston.transports.Console({
                format: winston.format.simple(),
            }),
        ]),
    ],
});

/**
 * Default export is logger described by {@link logger}. This will log to console or file depending on environment with
 * either debug or info level.
 */
export default logger;

/**
 * Utility named export, see {@link logger}.
 */
export const __ = logger;
