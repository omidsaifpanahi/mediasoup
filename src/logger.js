// const Sentry      = require('winston-transport-sentry-node').default;
const { createLogger, format, transports } = require('winston');


const logger = createLogger({
    format: format.combine(
        format.timestamp({format: 'YYYY-MM-DD HH:mm:ss'}),
        format.prettyPrint(),
        format.align()
    ),
    transports: [],
    exitOnError: false, // do not exit on handled exceptions
});

if(process.env.NODE_ENV ==="production" || process.env.NODE_ENV === "development")
{
    // logger.add( new Sentry({
    //         sentry: { dsn:  process.env.SENTRY_DSN },
    //         level: 'error'
    //     })
    // )
}
else
{
    logger.add( new transports.Console());
}

module.exports = logger;
